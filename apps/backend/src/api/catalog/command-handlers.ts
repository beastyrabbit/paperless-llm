import {
  CatalogActionAcceptedSchema,
  type CatalogApplyAccepted,
  CatalogApplyAcceptedSchema,
  CatalogApplyBodySchema,
  CatalogCancelBodySchema,
  CatalogEpochAcceptedSchema,
  type CatalogEpochId,
  type CatalogEpochStartBody,
  CatalogEpochStartBodySchema,
  CatalogProposalDecisionBodySchema,
  type CatalogState,
  canonicalSha256,
  type Sha256Digest,
  type StorageLedgerEntry,
} from "@repo/api-contracts";
import { Effect, Either, Fiber, Schema } from "effect";
import { NotFoundError } from "../../errors/index.js";
import { CatalogEvidenceService } from "../../services/CatalogEvidenceService.js";
import {
  CatalogApplyConflict,
  CatalogApplyMutationPort,
  CatalogApplyService,
  type CatalogApplySupportedKind,
  catalogApplyFingerprintForLiveState,
} from "../../services/catalog-apply/index.js";
import {
  type CatalogCouncilRunCandidateOptions,
  type CatalogCouncilScoutingOptions,
  CatalogCouncilService,
} from "../../services/catalog-council/index.js";
import type { CatalogEvidenceKind } from "../../services/catalog-evidence/types.js";
import {
  OperationalLedgerConflictError,
  OperationalLedgerError,
  OperationalLedgerService,
} from "../../services/OperationalLedgerService.js";
import type {
  CatalogEpochRecord,
  OperationalLedgerData,
  ProposalRecord,
} from "../../services/operational-ledger/types.js";
import { responseEffect } from "../query-utils.js";

type CatalogProposalRecord = ProposalRecord & {
  readonly proposedValues: Extract<
    NonNullable<ProposalRecord["proposedValues"]>,
    { readonly scope: "catalog" }
  >;
};

type CatalogCommandStatus = 409 | 502 | 503;
type CatalogCommandCode =
  | "CAPABILITY_UNAVAILABLE"
  | "HUMAN_DECISION_REQUIRED"
  | "PROVIDER_FAILURE"
  | "PROVIDER_MALFORMED"
  | "STALE_PRECONDITION"
  | "STATE_TRANSITION_CONFLICT";

export class CatalogCommandError extends Error {
  constructor(
    readonly status: CatalogCommandStatus,
    readonly code: CatalogCommandCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message.slice(0, 1_200));
    this.name = "CatalogCommandError";
  }
}

export interface CatalogCommandConfig extends CatalogCouncilRunCandidateOptions {
  readonly candidateLimit?: CatalogCouncilScoutingOptions["candidateLimit"];
  readonly baseUrl?: string;
  readonly now?: () => string;
  readonly epochPageLimit?: number;
  readonly epochMaxScanAttempts?: number;
}

export interface CatalogCommandRuntime {
  readonly schedule: (
    taskId: string,
    effect: Effect.Effect<void, never, unknown>,
  ) => Effect.Effect<void, CatalogCommandError, unknown>;
  readonly cancel: (taskId: string) => Effect.Effect<boolean, never>;
}

export const catalogCommandEndpoints = [
  { method: "POST", path: "/api/catalog/epochs" },
  { method: "POST", path: "/api/catalog/epochs/{epochId}/cancel" },
  { method: "POST", path: "/api/catalog/proposals/{proposalId}/approve" },
  { method: "POST", path: "/api/catalog/proposals/{proposalId}/reject" },
  { method: "POST", path: "/api/catalog/proposals/{proposalId}/apply" },
] as const;

const DEFAULT_BASE_URL = "";
const COMMAND_MARKER_PREFIX = "d7.catalog_command:";
const COMMAND_EPOCH_ID_PREFIX = "cat_epoch_cmd_";

const commandNow = (config: CatalogCommandConfig): string =>
  (config.now ?? (() => new Date().toISOString()))();

const progressUrl = (config: CatalogCommandConfig, epochId: string): string =>
  `${config.baseUrl ?? DEFAULT_BASE_URL}/api/catalog/epochs/${epochId}/progress`;

const statusUrl = (config: CatalogCommandConfig, epochId: string): string =>
  `${config.baseUrl ?? DEFAULT_BASE_URL}/api/catalog/epochs/${epochId}`;

const taskUrl = (config: CatalogCommandConfig, epochId: string, proposalId?: string): string =>
  proposalId
    ? `${config.baseUrl ?? DEFAULT_BASE_URL}/api/catalog/proposals/${proposalId}`
    : `${config.baseUrl ?? DEFAULT_BASE_URL}/api/catalog/epochs/${epochId}`;

export const makeDaemonCatalogCommandRuntime = (): CatalogCommandRuntime => {
  const fibers = new Map<string, Fiber.RuntimeFiber<void, never>>();
  return {
    schedule: (taskId, effect) =>
      Effect.gen(function* () {
        if (fibers.has(taskId)) return;
        const fiber = yield* Effect.forkDaemon(effect);
        fibers.set(taskId, fiber);
        yield* Effect.forkDaemon(
          Fiber.await(fiber).pipe(
            Effect.zipRight(
              Effect.sync(() => {
                fibers.delete(taskId);
              }),
            ),
          ),
        );
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CatalogCommandError(
              503,
              "CAPABILITY_UNAVAILABLE",
              `Unable to schedule catalog command: ${String(cause)}`,
              cause,
            ),
        ),
      ),
    cancel: (taskId) =>
      Effect.gen(function* () {
        const fiber = fibers.get(taskId);
        if (!fiber) return false;
        fibers.delete(taskId);
        yield* Fiber.interrupt(fiber);
        return true;
      }),
  };
};

const decodeBody = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  allowedKeys: readonly string[],
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, CatalogCommandError> =>
  Effect.gen(function* () {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return yield* Effect.fail(
        new CatalogCommandError(502, "PROVIDER_MALFORMED", "Command body must be an object."),
      );
    }
    const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key));
    if (unknownKeys.length > 0) {
      return yield* Effect.fail(
        new CatalogCommandError(
          502,
          "PROVIDER_MALFORMED",
          `Command body contains unknown keys: ${unknownKeys.join(", ")}`,
        ),
      );
    }
    const decoded = Schema.decodeUnknownEither(schema)(input);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new CatalogCommandError(502, "PROVIDER_MALFORMED", "Command body failed schema decode."),
      );
    }
    return decoded.right;
  });

const mapCommandCause = (cause: unknown): CatalogCommandError => {
  if (cause instanceof CatalogCommandError) return cause;
  if (cause instanceof OperationalLedgerConflictError) {
    return new CatalogCommandError(409, "STATE_TRANSITION_CONFLICT", cause.message, cause);
  }
  if (cause instanceof OperationalLedgerError) {
    return new CatalogCommandError(409, "STATE_TRANSITION_CONFLICT", cause.message, cause);
  }
  if (cause instanceof CatalogApplyConflict) {
    return new CatalogCommandError(
      cause.retryable ? 503 : 409,
      cause.code === "TASK_FAILED" ? "PROVIDER_FAILURE" : "STALE_PRECONDITION",
      cause.message,
      cause,
    );
  }
  if (cause instanceof NotFoundError) {
    return new CatalogCommandError(409, "STALE_PRECONDITION", cause.message, cause);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/capability|unavailable|lease/i.test(message)) {
    return new CatalogCommandError(503, "CAPABILITY_UNAVAILABLE", message, cause);
  }
  if (/provider|malformed|decode|schema/i.test(message)) {
    return new CatalogCommandError(502, "PROVIDER_MALFORMED", message, cause);
  }
  return new CatalogCommandError(409, "STALE_PRECONDITION", message, cause);
};

const commandResponse = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Effect.Effect<Schema.Schema.Type<S>, CatalogCommandError> =>
  responseEffect(schema, value).pipe(
    Effect.mapError(
      (error) =>
        new CatalogCommandError(
          502,
          "PROVIDER_MALFORMED",
          error instanceof Error ? error.message : "Response does not match frozen schema.",
          error,
        ),
    ),
  );

export const catalogEpochStateHash = (epoch: CatalogEpochRecord): Sha256Digest =>
  canonicalSha256({
    epochId: epoch.epochId,
    state: epoch.state,
    paperlessCatalogHash: epoch.paperlessCatalogHash,
    candidateCount: epoch.candidateCount,
    evidenceCount: epoch.evidenceCount,
    proposalCount: epoch.proposalCount,
    retryCount: epoch.retryCount,
    updatedAt: epoch.updatedAt,
    completedAt: epoch.completedAt,
  });

const markerEvidenceId = (marker: string): string => `${COMMAND_MARKER_PREFIX}${marker}`;

const acceptanceMarker = (input: {
  readonly action: string;
  readonly epochId?: string;
  readonly proposalId?: string;
  readonly idempotencyKey?: string;
  readonly expectedProposalFingerprint?: Sha256Digest;
  readonly expectedEvidenceFingerprint?: Sha256Digest;
  readonly expectedEpochStateHash?: Sha256Digest;
  readonly bodyHash?: Sha256Digest;
}): string =>
  canonicalSha256({
    schemaVersion: "d7.catalog-command.acceptance.v1",
    ...input,
  });

const acceptedCommandEntry = (
  snapshot: OperationalLedgerData,
  marker: string,
): StorageLedgerEntry | null => {
  const evidenceId = markerEvidenceId(marker);
  for (const entry of [...snapshot.ledgerEntries].reverse()) {
    if (entry.evidenceIds?.includes(evidenceId)) return entry;
  }
  return null;
};

const recordAcceptedCommand = (input: {
  readonly marker: string;
  readonly action: "start" | "cancel" | "approve" | "reject" | "apply";
  readonly epochId: string;
  readonly taskKey: string;
  readonly acceptedAt: string;
  readonly proposalId?: string;
  readonly hashes?: readonly Sha256Digest[];
}) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    yield* ledger
      .appendLedgerEntry({
        kind: "state_journal",
        proposalId: input.proposalId,
        state: `accepted:${input.action}`,
        timestamp: input.acceptedAt,
        hashes: input.hashes,
        valueHash: canonicalSha256({
          marker: input.marker,
          action: input.action,
          epochId: input.epochId,
          proposalId: input.proposalId ?? null,
          taskKey: input.taskKey,
        }),
        rationale: `taskKey=${input.taskKey};action=${input.action};epochId=${input.epochId}`,
        evidenceIds: [markerEvidenceId(input.marker)],
      })
      .pipe(Effect.mapError(mapCommandCause));
  });

const deterministicCommandEpochId = (body: CatalogEpochStartBody): CatalogEpochId =>
  `${COMMAND_EPOCH_ID_PREFIX}${canonicalSha256({
    schemaVersion: "d7.catalog-command.epoch-id.v1",
    scope: [...body.scope].sort(),
    expectedPaperlessCatalogHash: body.expectedPaperlessCatalogHash,
    runtime: body.runtime ?? null,
    idempotencyKey: body.idempotencyKey,
  }).slice(0, 24)}` as CatalogEpochId;

const duplicateStrings = (values: readonly string[]) =>
  values.filter((value, index) => values.indexOf(value) !== index);

const requireEpoch = (
  snapshot: OperationalLedgerData,
  epochId: string,
): Effect.Effect<CatalogEpochRecord, CatalogCommandError> => {
  const epoch = snapshot.catalogEpochs[epochId];
  if (!epoch) {
    return Effect.fail(
      new CatalogCommandError(409, "STALE_PRECONDITION", `Catalog epoch ${epochId} was not found.`),
    );
  }
  return Effect.succeed(epoch);
};

const requireProposal = (
  snapshot: OperationalLedgerData,
  proposalId: string,
): Effect.Effect<CatalogProposalRecord, CatalogCommandError> => {
  const proposal = snapshot.proposals[proposalId];
  if (!proposal || proposal.scope !== "catalog" || proposal.proposedValues?.scope !== "catalog") {
    return Effect.fail(
      new CatalogCommandError(
        409,
        "STALE_PRECONDITION",
        `Catalog proposal ${proposalId} was not found or has been compacted.`,
      ),
    );
  }
  return Effect.succeed(proposal as CatalogProposalRecord);
};

const requireExpectedProposalFingerprint = (
  proposal: ProposalRecord,
  expectedProposalFingerprint: Sha256Digest,
): Effect.Effect<void, CatalogCommandError> => {
  if (
    proposal.proposedValues?.scope === "catalog" &&
    proposal.proposedValues.expectedProposalFingerprint === expectedProposalFingerprint
  ) {
    return Effect.void;
  }
  return Effect.fail(
    new CatalogCommandError(
      409,
      "STALE_PRECONDITION",
      "Catalog proposal fingerprint does not match the expected precondition.",
    ),
  );
};

const requireHumanAuthoredReason = (
  reason: string | undefined,
): Effect.Effect<string, CatalogCommandError> => {
  const normalized = reason?.replace(/\s+/g, " ").trim();
  if (normalized) return Effect.succeed(normalized);
  return Effect.fail(
    new CatalogCommandError(
      409,
      "HUMAN_DECISION_REQUIRED",
      "Catalog proposal cleanup decisions require a human-authored reason.",
    ),
  );
};

const catalogEvidenceScope = (
  scope: CatalogEpochStartBody["scope"],
): Effect.Effect<readonly CatalogEvidenceKind[], CatalogCommandError> => {
  if (scope.includes("custom_field")) {
    return Effect.fail(
      new CatalogCommandError(
        503,
        "CAPABILITY_UNAVAILABLE",
        "Catalog optimization commands do not support custom_field evidence yet.",
      ),
    );
  }
  return Effect.succeed(scope as readonly CatalogEvidenceKind[]);
};

const transitionEpoch = (epochId: string, expected: CatalogState, next: CatalogState) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    return yield* ledger
      .transitionCatalogEpochState(epochId, expected, next)
      .pipe(Effect.mapError(mapCommandCause));
  });

const failCatalogEpochFromCurrentState = (epochId: string) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
    const epoch = snapshot.catalogEpochs[epochId];
    if (!epoch || ["applied", "canceled", "failed", "rejected"].includes(epoch.state)) {
      return;
    }
    if (epoch.state === "queued") {
      yield* transitionEpoch(epochId, "queued", "collecting");
      yield* transitionEpoch(epochId, "collecting", "failed");
      return;
    }
    yield* transitionEpoch(epochId, epoch.state, "failed");
  });

const swallowBackgroundFailure = (effect: Effect.Effect<unknown, unknown, unknown>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchAll(() => Effect.void),
  );

const backgroundOptimization = (epochId: string, config: CatalogCommandConfig) =>
  Effect.gen(function* () {
    const run = Effect.gen(function* () {
      const evidence = yield* CatalogEvidenceService;
      const council = yield* CatalogCouncilService;
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const epochRecord = yield* requireEpoch(snapshot, epochId);
      if (epochRecord.state === "queued") {
        yield* transitionEpoch(epochId, "queued", "collecting");
      }
      const epoch = yield* evidence.buildEpoch({
        scope: yield* catalogEvidenceScope(epochRecord.scope as CatalogEpochStartBody["scope"]),
        createdAt: epochRecord.createdAt,
        pageLimit: config.epochPageLimit,
        maxScanAttempts: config.epochMaxScanAttempts,
        epochId,
      });
      if (
        epoch.epochId !== epochId ||
        epoch.catalogFingerprint !== epochRecord.paperlessCatalogHash
      ) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STALE_PRECONDITION",
            "Catalog evidence epoch changed before optimization could run.",
          ),
        );
      }
      const candidates = (yield* evidence.blockCandidates(epoch)).slice(
        0,
        config.candidateLimit ?? 10,
      );
      const afterCollect = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (afterCollect.catalogEpochs[epochId]?.state === "collecting") {
        yield* transitionEpoch(epochId, "collecting", "evidence_ready");
      }
      const afterEvidence = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (afterEvidence.catalogEpochs[epochId]?.state === "evidence_ready") {
        yield* transitionEpoch(epochId, "evidence_ready", "council_review");
      }
      yield* Effect.forEach(
        candidates,
        (candidate) =>
          council.runCandidate(epoch, candidate, {
            createdAt: epochRecord.createdAt,
            unsafeDependencies: config.unsafeDependencies,
            maxExpansions: config.maxExpansions,
          }),
        { concurrency: 1, discard: true },
      );
      const afterCouncil = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (afterCouncil.catalogEpochs[epochId]?.state === "council_review") {
        yield* transitionEpoch(epochId, "council_review", "proposed");
      }
    });
    yield* run.pipe(
      Effect.catchAll((cause) =>
        failCatalogEpochFromCurrentState(epochId).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.zipRight(Effect.fail(cause)),
        ),
      ),
      Effect.catchAll(() => Effect.void),
      Effect.asVoid,
    );
  });

const liveApplyFingerprint = (proposal: ProposalRecord) =>
  Effect.gen(function* () {
    if (proposal.proposedValues?.scope !== "catalog") {
      return yield* Effect.fail(
        new CatalogCommandError(409, "STALE_PRECONDITION", "Catalog proposal values are missing."),
      );
    }
    const values = proposal.proposedValues;
    const kind = values.entityKind as CatalogApplySupportedKind;
    const mutation = yield* CatalogApplyMutationPort;
    const sourceEntity = yield* mutation
      .readEntity(kind, values.sourceEntityId)
      .pipe(Effect.mapError(mapCommandCause));
    if (!sourceEntity?.exists) {
      return yield* Effect.fail(
        new CatalogCommandError(409, "STALE_PRECONDITION", "Source catalog entity is missing."),
      );
    }
    const targetEntity =
      values.targetEntityId === null
        ? null
        : yield* mutation
            .readEntity(kind, values.targetEntityId)
            .pipe(Effect.mapError(mapCommandCause));
    if (values.targetEntityId !== null && !targetEntity?.exists) {
      return yield* Effect.fail(
        new CatalogCommandError(409, "STALE_PRECONDITION", "Target catalog entity is missing."),
      );
    }
    const source = yield* mutation
      .readAssignmentReceipt(kind, values.sourceEntityId)
      .pipe(Effect.mapError(mapCommandCause));
    const target =
      values.targetEntityId === null
        ? null
        : yield* mutation
            .readAssignmentReceipt(kind, values.targetEntityId)
            .pipe(Effect.mapError(mapCommandCause));
    return catalogApplyFingerprintForLiveState({
      receipts: { kind, source, target },
      sourceEntity,
      targetEntity,
    });
  });

export const makeCatalogCommandHandlers = (
  config: CatalogCommandConfig = {},
  runtime: CatalogCommandRuntime = makeDaemonCatalogCommandRuntime(),
) => {
  const startCatalogOptimization = (rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        CatalogEpochStartBodySchema,
        ["scope", "expectedPaperlessCatalogHash", "runtime", "idempotencyKey"],
        rawBody,
      );
      if (duplicateStrings(body.scope).length > 0) {
        return yield* Effect.fail(
          new CatalogCommandError(
            502,
            "PROVIDER_MALFORMED",
            "Catalog epoch scope contains duplicate entity kinds.",
          ),
        );
      }
      const marker = acceptanceMarker({
        action: "start",
        idempotencyKey: body.idempotencyKey,
        bodyHash: canonicalSha256(body),
      });
      const ledger = yield* OperationalLedgerService;
      const before = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(before, marker);
      const epochId = deterministicCommandEpochId(body);
      if (previous?.state === "accepted:start") {
        const epoch = before.catalogEpochs[epochId];
        if (epoch) {
          return yield* commandResponse(CatalogEpochAcceptedSchema, {
            status: 202,
            epochId: epoch.epochId,
            state: epoch.state,
            acceptedAt: previous.timestamp,
            progressUrl: progressUrl(config, epoch.epochId),
            statusUrl: statusUrl(config, epoch.epochId),
          });
        }
      }

      const createdAt = commandNow(config);
      const queuedEpoch =
        before.catalogEpochs[epochId] ??
        (yield* ledger
          .createCatalogEpoch({
            epochId,
            scope: body.scope,
            paperlessCatalogHash: body.expectedPaperlessCatalogHash,
            createdAt,
          })
          .pipe(Effect.mapError(mapCommandCause)));
      const taskKey = `catalog:optimize:${epochId}`;
      yield* runtime.schedule(taskKey, backgroundOptimization(epochId, config));
      yield* recordAcceptedCommand({
        marker,
        action: "start",
        epochId,
        taskKey,
        acceptedAt: createdAt,
        hashes: [body.expectedPaperlessCatalogHash],
      });
      return yield* commandResponse(CatalogEpochAcceptedSchema, {
        status: 202,
        epochId,
        state: queuedEpoch.state,
        acceptedAt: createdAt,
        progressUrl: progressUrl(config, epochId),
        statusUrl: statusUrl(config, epochId),
      });
    });

  const cancelCatalogOptimization = (epochId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        CatalogCancelBodySchema,
        ["expectedEpochStateHash", "reason", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "cancel",
        epochId,
        idempotencyKey: body.idempotencyKey,
        expectedEpochStateHash: body.expectedEpochStateHash,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.state === "accepted:cancel") {
        return yield* commandResponse(CatalogActionAcceptedSchema, {
          status: 202,
          epochId,
          action: "cancel",
          taskUrl: taskUrl(config, epochId),
          acceptedAt: previous.timestamp,
        });
      }
      const epoch = yield* requireEpoch(snapshot, epochId);
      if (catalogEpochStateHash(epoch) !== body.expectedEpochStateHash) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STALE_PRECONDITION",
            "Catalog epoch state hash does not match the cancel precondition.",
          ),
        );
      }
      if (["applied", "canceled", "failed", "rejected"].includes(epoch.state)) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Catalog epoch ${epochId} is already terminal.`,
          ),
        );
      }
      yield* transitionEpoch(epochId, epoch.state, "canceled");
      yield* runtime.cancel(`catalog:optimize:${epochId}`);
      const acceptedAt = commandNow(config);
      yield* recordAcceptedCommand({
        marker,
        action: "cancel",
        epochId,
        taskKey: `catalog:cancel:${epochId}`,
        acceptedAt,
        hashes: [body.expectedEpochStateHash],
      });
      return yield* commandResponse(CatalogActionAcceptedSchema, {
        status: 202,
        epochId,
        action: "cancel",
        taskUrl: taskUrl(config, epochId),
        acceptedAt,
      });
    });

  const decideCatalogProposal = (
    proposalId: string,
    action: "approve" | "reject",
    rawBody: unknown,
  ) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        CatalogProposalDecisionBodySchema,
        ["expectedProposalFingerprint", "reason", "idempotencyKey"],
        rawBody,
      );
      const reason = yield* requireHumanAuthoredReason(body.reason);
      const marker = acceptanceMarker({
        action,
        proposalId,
        idempotencyKey: body.idempotencyKey,
        expectedProposalFingerprint: body.expectedProposalFingerprint,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.state === `accepted:${action}`) {
        return yield* commandResponse(CatalogActionAcceptedSchema, {
          status: 202,
          epochId:
            /epochId=([^;]+)/.exec(previous.rationale ?? "")?.[1] ??
            snapshot.proposals[proposalId]?.ownerId ??
            "cat_epoch_unknown",
          proposalId,
          action,
          taskUrl: taskUrl(
            config,
            snapshot.proposals[proposalId]?.ownerId ?? "cat_epoch_unknown",
            proposalId,
          ),
          acceptedAt: previous.timestamp,
        });
      }
      const proposal = yield* requireProposal(snapshot, proposalId);
      yield* requireExpectedProposalFingerprint(proposal, body.expectedProposalFingerprint);
      if (proposal.decision !== "undecided") {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Catalog proposal ${proposalId} is already ${proposal.decision}.`,
          ),
        );
      }
      const acceptedAt = commandNow(config);
      yield* ledger
        .recordProposalDecision(proposalId, {
          expectedDecision: proposal.decision,
          decision: action === "approve" ? "approved" : "rejected",
          outcome: action === "approve" ? "approved" : "rejected",
          decidedAt: acceptedAt,
        })
        .pipe(Effect.mapError(mapCommandCause));
      yield* recordAcceptedCommand({
        marker,
        action,
        epochId: proposal.ownerId,
        proposalId,
        taskKey: `catalog:${action}:${proposalId}`,
        acceptedAt,
        hashes: [body.expectedProposalFingerprint, canonicalSha256(reason)],
      });
      return yield* commandResponse(CatalogActionAcceptedSchema, {
        status: 202,
        epochId: proposal.ownerId,
        proposalId,
        action,
        taskUrl: taskUrl(config, proposal.ownerId, proposalId),
        acceptedAt,
      });
    });

  const applyCatalogProposal = (proposalId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        CatalogApplyBodySchema,
        ["expectedProposalFingerprint", "expectedEvidenceFingerprint", "idempotencyKey", "dryRun"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "apply",
        proposalId,
        idempotencyKey: body.idempotencyKey,
        expectedProposalFingerprint: body.expectedProposalFingerprint,
        expectedEvidenceFingerprint: body.expectedEvidenceFingerprint,
        bodyHash: canonicalSha256({ dryRun: body.dryRun ?? false }),
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.state === "accepted:apply") {
        const epochId =
          /epochId=([^;]+)/.exec(previous.rationale ?? "")?.[1] ??
          snapshot.proposals[proposalId]?.ownerId ??
          "cat_epoch_unknown";
        return yield* commandResponse(CatalogApplyAcceptedSchema, {
          status: 202,
          epochId,
          proposalId,
          action: "apply",
          taskUrl: taskUrl(config, epochId, proposalId),
          acceptedAt: previous.timestamp,
        });
      }
      const proposal = yield* requireProposal(snapshot, proposalId);
      yield* requireExpectedProposalFingerprint(proposal, body.expectedProposalFingerprint);
      if (proposal.decision !== "approved") {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Catalog proposal ${proposalId} must be approved before apply.`,
          ),
        );
      }
      if (
        proposal.proposedValues.expectedEvidenceFingerprint !== body.expectedEvidenceFingerprint
      ) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STALE_PRECONDITION",
            "Catalog evidence fingerprint does not match the apply precondition.",
          ),
        );
      }
      const chairDecision = Object.values(snapshot.chairDecisions)
        .filter((chair) => chair.proposalId === proposalId)
        .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
      if (!chairDecision) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STALE_PRECONDITION",
            "Catalog apply requires a compact chair decision.",
          ),
        );
      }
      if (
        chairDecision.proposalFingerprint !== body.expectedProposalFingerprint ||
        chairDecision.evidenceFingerprint !== body.expectedEvidenceFingerprint
      ) {
        return yield* Effect.fail(
          new CatalogCommandError(
            409,
            "STALE_PRECONDITION",
            "Catalog chair decision fingerprints do not match the apply preconditions.",
          ),
        );
      }
      const expectedCatalogFingerprint = yield* liveApplyFingerprint(proposal);
      const acceptedAt = commandNow(config);
      const taskKey = `catalog:apply:${proposalId}:${body.idempotencyKey}`;
      if (!body.dryRun) {
        const apply = yield* CatalogApplyService;
        yield* runtime.schedule(
          taskKey,
          swallowBackgroundFailure(
            Effect.suspend(() =>
              apply.applyReviewedProposal({
                proposal,
                chairDecision,
                expectedProposalFingerprint: body.expectedProposalFingerprint,
                expectedEvidenceFingerprint: body.expectedEvidenceFingerprint,
                expectedCatalogFingerprint,
                idempotencyKey: body.idempotencyKey,
                createdAt: acceptedAt,
              }),
            ),
          ),
        );
      }
      yield* recordAcceptedCommand({
        marker,
        action: "apply",
        epochId: proposal.ownerId,
        proposalId,
        taskKey,
        acceptedAt,
        hashes: [
          body.expectedProposalFingerprint,
          body.expectedEvidenceFingerprint,
          expectedCatalogFingerprint,
        ],
      });
      const response: CatalogApplyAccepted = {
        status: 202,
        epochId: proposal.ownerId,
        proposalId,
        action: "apply",
        taskUrl: taskUrl(config, proposal.ownerId, proposalId),
        acceptedAt,
      };
      return yield* commandResponse(CatalogApplyAcceptedSchema, response);
    });

  return {
    startCatalogOptimization,
    cancelCatalogOptimization,
    approveCatalogProposal: (proposalId: string, rawBody: unknown) =>
      decideCatalogProposal(proposalId, "approve", rawBody),
    rejectCatalogProposal: (proposalId: string, rawBody: unknown) =>
      decideCatalogProposal(proposalId, "reject", rawBody),
    applyCatalogProposal,
  };
};
