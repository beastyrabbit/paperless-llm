import {
  AnalysisActionAcceptedSchema,
  AnalysisCancelBodySchema,
  AnalysisDecisionBodySchema,
  AnalysisForceOcrBodySchema,
  AnalysisRetryBodySchema,
  AnalysisRunAcceptedSchema,
  type AnalysisRunStartBody,
  type AnalysisRunState,
  canonicalSha256,
  type PaperlessDocumentSnapshot,
  RandomCycleResetBodySchema,
  RandomCycleSelectAcceptedSchema,
  RandomCycleSelectBodySchema,
  type Sha256Digest,
  type StorageLedgerEntry,
  strictDecodeAnalysisRunStartBody,
} from "@repo/api-contracts";
import { Effect, Either, Fiber, Schema } from "effect";
import type { Document } from "../../models/index.js";
import { DocumentAnalysisOrchestrationError } from "../../services/document-analysis/errors.js";
import {
  DocumentAnalysisOrchestrator,
  type DocumentAnalysisRunRequest,
  type RecoverInterruptedAppliesOptions,
} from "../../services/document-analysis/orchestrator.js";
import {
  OperationalLedgerConflictError,
  OperationalLedgerError,
  OperationalLedgerService,
} from "../../services/OperationalLedgerService.js";
import type {
  AnalysisRunRecord,
  OperationalLedgerData,
  ProposalRecord,
} from "../../services/operational-ledger/types.js";
import { PaperlessService } from "../../services/PaperlessService.js";
import { responseEffect } from "../query-utils.js";

type AnalysisCommandStatus = 409 | 502 | 503;

export class AnalysisCommandError extends Error {
  constructor(
    readonly status: AnalysisCommandStatus,
    readonly code:
      | "STALE_PRECONDITION"
      | "STATE_TRANSITION_CONFLICT"
      | "PROVIDER_MALFORMED"
      | "PROVIDER_FAILURE"
      | "CAPABILITY_UNAVAILABLE",
    message: string,
    readonly cause?: unknown,
  ) {
    super(message.slice(0, 1_200));
    this.name = "AnalysisCommandError";
  }
}

export interface AnalysisCommandConfig extends RecoverInterruptedAppliesOptions {
  readonly guidance?: string;
  readonly baseUrl?: string;
  readonly now?: () => string;
  readonly runIdFactory?: (input: {
    readonly documentId: number;
    readonly requestId?: string;
    readonly purpose: "start" | "retry" | "force_ocr" | "random_cycle";
    readonly cycleKey?: string;
    readonly triggerRevision?: Sha256Digest;
  }) => string;
  readonly leaseTtlMs?: number;
}

export interface AnalysisCommandRuntime {
  readonly schedule: (
    taskId: string,
    effect: Effect.Effect<void, never, never>,
  ) => Effect.Effect<void, AnalysisCommandError>;
  readonly cancel: (taskId: string) => Effect.Effect<boolean, never>;
}

export interface AnalysisStreamRegistrationDescriptor {
  readonly method: "GET";
  readonly path: "/api/analysis/runs/{runId}/progress";
  readonly responseContentType: "text/event-stream";
  readonly events: readonly [
    "analysis.run.state",
    "analysis.proposal.bundle",
    "analysis.failure",
    "analysis.heartbeat",
  ];
}

export const analysisCommandEndpoints = [
  { method: "POST", path: "/api/analysis/runs" },
  { method: "POST", path: "/api/analysis/runs/{runId}/apply" },
  { method: "POST", path: "/api/analysis/runs/{runId}/reject" },
  { method: "POST", path: "/api/analysis/runs/{runId}/retry" },
  { method: "POST", path: "/api/analysis/runs/{runId}/cancel" },
  { method: "POST", path: "/api/analysis/runs/{runId}/force-ocr" },
  { method: "POST", path: "/api/analysis/random-cycle/select" },
  { method: "POST", path: "/api/analysis/random-cycle/reset" },
] as const;

export const analysisCommandListDescriptors = [
  { method: "GET", path: "/api/analysis/review" },
  { method: "GET", path: "/api/analysis/failed" },
] as const;

export const analysisStreamRegistrationDescriptor: AnalysisStreamRegistrationDescriptor = {
  method: "GET",
  path: "/api/analysis/runs/{runId}/progress",
  responseContentType: "text/event-stream",
  events: [
    "analysis.run.state",
    "analysis.proposal.bundle",
    "analysis.failure",
    "analysis.heartbeat",
  ],
};

const DEFAULT_BASE_URL = "";
const MAX_RANDOM_CYCLE_PAGE_SIZE = 250;
const COMMAND_MARKER_PREFIX = "d6.analysis_command:";
const DEFAULT_COMMAND_LEASE_TTL_MS = 5 * 60 * 1000;

const commandNow = (config: AnalysisCommandConfig): string =>
  (config.now ?? (() => new Date().toISOString()))();

const defaultRunIdFactory: NonNullable<AnalysisCommandConfig["runIdFactory"]> = (input) =>
  `ana_run_${input.purpose}_${canonicalSha256({
    documentId: input.documentId,
    requestId: input.requestId ?? null,
    cycleKey: input.cycleKey ?? null,
    triggerRevision: input.triggerRevision ?? null,
  }).slice(0, 32)}`;

const progressUrl = (config: AnalysisCommandConfig, runId: string): string =>
  `${config.baseUrl ?? DEFAULT_BASE_URL}/api/analysis/runs/${runId}/progress`;

const statusUrl = (config: AnalysisCommandConfig, runId: string): string =>
  `${config.baseUrl ?? DEFAULT_BASE_URL}/api/analysis/runs/${runId}`;

const taskUrl = (config: AnalysisCommandConfig, runId: string): string =>
  `${config.baseUrl ?? DEFAULT_BASE_URL}/api/analysis/runs/${runId}`;

export const makeDaemonAnalysisCommandRuntime = (): AnalysisCommandRuntime => {
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
            new AnalysisCommandError(
              503,
              "CAPABILITY_UNAVAILABLE",
              `Unable to schedule analysis command: ${String(cause)}`,
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
): Effect.Effect<Schema.Schema.Type<S>, AnalysisCommandError> =>
  Effect.gen(function* () {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      return yield* Effect.fail(
        new AnalysisCommandError(502, "PROVIDER_MALFORMED", "Command body must be an object."),
      );
    }
    const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key));
    if (unknownKeys.length > 0) {
      return yield* Effect.fail(
        new AnalysisCommandError(
          502,
          "PROVIDER_MALFORMED",
          `Command body contains unknown keys: ${unknownKeys.join(", ")}`,
        ),
      );
    }
    const decoded = Schema.decodeUnknownEither(schema)(input);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new AnalysisCommandError(502, "PROVIDER_MALFORMED", "Command body failed schema decode."),
      );
    }
    return decoded.right;
  });

const decodeStartBody = (
  input: unknown,
): Effect.Effect<AnalysisRunStartBody, AnalysisCommandError> =>
  Effect.gen(function* () {
    const decoded = strictDecodeAnalysisRunStartBody(input);
    if (!decoded.ok) {
      return yield* Effect.fail(
        new AnalysisCommandError(502, "PROVIDER_MALFORMED", "Command body failed schema decode."),
      );
    }
    return decoded.value;
  });

const mapCommandCause = (cause: unknown): AnalysisCommandError => {
  if (cause instanceof AnalysisCommandError) return cause;
  if (cause instanceof OperationalLedgerConflictError) {
    return new AnalysisCommandError(409, "STATE_TRANSITION_CONFLICT", cause.message, cause);
  }
  if (cause instanceof OperationalLedgerError) {
    return new AnalysisCommandError(409, "STATE_TRANSITION_CONFLICT", cause.message, cause);
  }
  if (cause instanceof DocumentAnalysisOrchestrationError) {
    if (cause.code === "STALE_PRECONDITION" || cause.code === "STATE_TRANSITION_CONFLICT") {
      return new AnalysisCommandError(409, cause.code, cause.message, cause);
    }
    if (cause.code === "PROVIDER_MALFORMED" || cause.code === "PROVIDER_FAILURE") {
      return new AnalysisCommandError(502, cause.code, cause.message, cause);
    }
    return new AnalysisCommandError(503, "CAPABILITY_UNAVAILABLE", cause.message, cause);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/capability|unavailable/i.test(message)) {
    return new AnalysisCommandError(503, "CAPABILITY_UNAVAILABLE", message, cause);
  }
  if (/provider|malformed|decode|schema/i.test(message)) {
    return new AnalysisCommandError(502, "PROVIDER_MALFORMED", message, cause);
  }
  return new AnalysisCommandError(409, "STALE_PRECONDITION", message, cause);
};

const commandResponse = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Effect.Effect<Schema.Schema.Type<S>, AnalysisCommandError> =>
  responseEffect(schema, value).pipe(
    Effect.mapError(
      (error) =>
        new AnalysisCommandError(
          502,
          "PROVIDER_MALFORMED",
          error instanceof Error ? error.message : "Response does not match frozen schema.",
          error,
        ),
    ),
  );

const requireCapabilities = (
  paperless: PaperlessService,
): Effect.Effect<void, AnalysisCommandError> =>
  Effect.try({
    try: () => {
      const descriptor = paperless.capability?.descriptor;
      if (
        !descriptor?.supportsFullPagination ||
        !descriptor.supportsOriginalContent ||
        !descriptor.supportsVersionContent ||
        !descriptor.supportsConditionalPreconditions
      ) {
        throw new AnalysisCommandError(
          503,
          "CAPABILITY_UNAVAILABLE",
          "Paperless capability descriptor does not satisfy analysis command requirements.",
        );
      }
    },
    catch: mapCommandCause,
  });

const sortedUniqueNumbers = (values: readonly number[]) =>
  [...new Set(values)].sort((left, right) => left - right);

const duplicateNumbers = (values: readonly number[]) =>
  values.filter((value, index) => values.indexOf(value) !== index);

export const analysisRunStateHash = (run: AnalysisRunRecord): Sha256Digest =>
  canonicalSha256({
    runId: run.runId,
    documentId: run.documentId,
    forceOcr: run.forceOcr,
    state: run.state,
    documentStateHash: run.documentStateHash,
    retryCount: run.retryCount,
    updatedAt: run.updatedAt,
    failure: run.failure
      ? {
          code: run.failure.code,
          failedAt: run.failure.failedAt,
          messageHash: canonicalSha256(run.failure.message),
          retryable: run.failure.retryable,
        }
      : null,
  });

const triggerRevisionHash = (
  documentId: number,
  snapshot: PaperlessDocumentSnapshot,
  tagIds: readonly number[],
  config: AnalysisCommandConfig,
): Sha256Digest =>
  canonicalSha256({
    schemaVersion: "d6.analysis-command.trigger.v1",
    documentId,
    stateHash: snapshot.stateHash,
    sourcePdfHash: snapshot.sourcePdfHash,
    modified: snapshot.modified,
    tagIds: sortedUniqueNumbers(tagIds),
    aiAnalyseTagId: config.aiAnalyseTagId ?? null,
    configuredCustomFieldIds: sortedUniqueNumbers(config.configuredCustomFieldIds),
    systemTagIds: sortedUniqueNumbers(config.systemTagIds),
    parentTagIds: sortedUniqueNumbers(config.parentTagIds),
    workflowTagIds: sortedUniqueNumbers(config.workflowTagIds ?? []),
  });

interface TriggeredDocument {
  readonly document: Document;
  readonly snapshot: PaperlessDocumentSnapshot;
  readonly triggerRevision: Sha256Digest;
  readonly tagAdded: boolean;
}

const markerEvidenceId = (marker: string): string => `${COMMAND_MARKER_PREFIX}${marker}`;

const acceptanceMarker = (input: {
  readonly action: string;
  readonly runId?: string;
  readonly documentId?: number;
  readonly idempotencyKey?: string;
  readonly requestId?: string;
  readonly bodyHash?: Sha256Digest;
  readonly cycleKey?: string;
}): string =>
  canonicalSha256({
    schemaVersion: "d6.analysis-command.acceptance.v1",
    ...input,
  });

const taskKeyFromRationale = (rationale?: string): string | null => {
  const match = /^taskKey=([^;]+)(?:;|$)/.exec(rationale ?? "");
  return match?.[1] ?? null;
};

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
  readonly action: string;
  readonly runId: string;
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
        runId: input.runId,
        proposalId: input.proposalId,
        state: `accepted:${input.action}`,
        timestamp: input.acceptedAt,
        hashes: input.hashes,
        valueHash: canonicalSha256({
          marker: input.marker,
          action: input.action,
          runId: input.runId,
          taskKey: input.taskKey,
          proposalId: input.proposalId ?? null,
        }),
        rationale: `taskKey=${input.taskKey};action=${input.action}`,
        evidenceIds: [markerEvidenceId(input.marker)],
      })
      .pipe(Effect.mapError(mapCommandCause));
  });

const releaseDocumentLease = (leaseId: string, leaseRunId: string) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    yield* ledger.releaseLease(leaseId, leaseRunId).pipe(Effect.ignore);
  });

const documentPrecondition = (snapshot: PaperlessDocumentSnapshot) => [
  { kind: "paperless_document_state" as const, digest: snapshot.stateHash },
];

const verifyTriggeredDocument = (
  paperless: PaperlessService,
  documentId: number,
  config: AnalysisCommandConfig,
  tagAdded: boolean,
): Effect.Effect<TriggeredDocument, AnalysisCommandError> =>
  Effect.gen(function* () {
    const document = yield* paperless
      .getDocument(documentId)
      .pipe(Effect.mapError(mapCommandCause));
    if (config.aiAnalyseTagId === null || config.aiAnalyseTagId === undefined) {
      return yield* Effect.fail(
        new AnalysisCommandError(
          503,
          "CAPABILITY_UNAVAILABLE",
          "ai-analyse tag id is required for analysis command trigger preparation.",
        ),
      );
    }
    if (!document.tags.includes(config.aiAnalyseTagId)) {
      return yield* Effect.fail(
        new AnalysisCommandError(
          409,
          "STALE_PRECONDITION",
          "ai-analyse trigger was not present after Paperless reread.",
        ),
      );
    }
    const snapshot = yield* paperless
      .getDocumentSnapshot(documentId)
      .pipe(Effect.mapError(mapCommandCause));
    return {
      document,
      snapshot,
      tagAdded,
      triggerRevision: triggerRevisionHash(documentId, snapshot, document.tags, config),
    };
  });

const prepareTriggeredDocument = (
  config: AnalysisCommandConfig,
  input: {
    readonly documentId: number;
    readonly command: string;
    readonly requestKey: string;
  },
): Effect.Effect<
  TriggeredDocument,
  AnalysisCommandError,
  PaperlessService | OperationalLedgerService
> =>
  Effect.gen(function* () {
    if (config.aiAnalyseTagId === null || config.aiAnalyseTagId === undefined) {
      return yield* Effect.fail(
        new AnalysisCommandError(
          503,
          "CAPABILITY_UNAVAILABLE",
          "ai-analyse tag id is required for analysis command trigger preparation.",
        ),
      );
    }
    const aiAnalyseTagId = config.aiAnalyseTagId;
    const ledger = yield* OperationalLedgerService;
    const paperless = yield* PaperlessService;
    yield* requireCapabilities(paperless);
    const leaseRunId = `ana_cmd_${input.command}_${input.documentId}_${input.requestKey.slice(0, 12)}`;
    const lease = yield* ledger
      .acquireLease({
        scope: "document",
        resourceId: input.documentId,
        owner: "analysis-command",
        runId: leaseRunId,
        ttlMs: config.leaseTtlMs ?? DEFAULT_COMMAND_LEASE_TTL_MS,
      })
      .pipe(Effect.mapError(mapCommandCause));
    if (!lease.acquired) {
      return yield* Effect.fail(
        new AnalysisCommandError(
          409,
          "STATE_TRANSITION_CONFLICT",
          `Document mutation lease is held by run ${lease.lease.runId}.`,
        ),
      );
    }

    return yield* Effect.gen(function* () {
      const live = yield* paperless
        .getDocument(input.documentId)
        .pipe(Effect.mapError(mapCommandCause));
      const beforeSnapshot = yield* paperless
        .getDocumentSnapshot(input.documentId)
        .pipe(Effect.mapError(mapCommandCause));
      if (live.tags.includes(aiAnalyseTagId)) {
        return yield* verifyTriggeredDocument(paperless, input.documentId, config, false);
      }

      const nextTags = sortedUniqueNumbers([...live.tags, aiAnalyseTagId]);
      const addTag = paperless.updateDocumentExact(
        input.documentId,
        { tags: nextTags },
        {
          preconditions: documentPrecondition(beforeSnapshot),
          preserveTagIds: new Set([
            ...config.systemTagIds,
            ...config.parentTagIds,
            ...(config.workflowTagIds ?? []),
            aiAnalyseTagId,
          ]),
        },
      );
      const addResult = yield* Effect.either(addTag);
      if (Either.isLeft(addResult)) {
        const reread = yield* Effect.either(
          verifyTriggeredDocument(paperless, input.documentId, config, true),
        );
        if (Either.isRight(reread)) return reread.right;
        return yield* Effect.fail(mapCommandCause(addResult.left));
      }
      return yield* verifyTriggeredDocument(paperless, input.documentId, config, true);
    }).pipe(Effect.ensuring(releaseDocumentLease(lease.lease.leaseId, lease.lease.runId)));
  });

const requireRun = (
  snapshot: OperationalLedgerData,
  runId: string,
): Effect.Effect<AnalysisRunRecord, AnalysisCommandError> => {
  const run = snapshot.analysisRuns[runId];
  if (!run) {
    return Effect.fail(
      new AnalysisCommandError(409, "STALE_PRECONDITION", `Analysis run ${runId} was not found.`),
    );
  }
  return Effect.succeed(run);
};

const proposalForRun = (
  snapshot: OperationalLedgerData,
  run: AnalysisRunRecord,
  expectedProposalHash: Sha256Digest,
): Effect.Effect<ProposalRecord, AnalysisCommandError> => {
  const proposal = run.proposalIds
    .map((proposalId) => snapshot.proposals[proposalId])
    .find(
      (candidate): candidate is ProposalRecord =>
        candidate !== undefined &&
        candidate.scope === "analysis" &&
        candidate.ownerId === run.runId &&
        candidate.proposalHash === expectedProposalHash,
    );
  if (!proposal) {
    return Effect.fail(
      new AnalysisCommandError(
        409,
        "STALE_PRECONDITION",
        "No analysis proposal matched the expected proposal hash for this run.",
      ),
    );
  }
  if (proposal.decision !== "undecided") {
    return Effect.fail(
      new AnalysisCommandError(
        409,
        "STATE_TRANSITION_CONFLICT",
        `Analysis proposal ${proposal.proposalId} is already ${proposal.decision}.`,
      ),
    );
  }
  return Effect.succeed(proposal);
};

const requireRunHash = (
  run: AnalysisRunRecord,
  expectedRunStateHash: Sha256Digest,
): Effect.Effect<void, AnalysisCommandError> =>
  analysisRunStateHash(run) === expectedRunStateHash
    ? Effect.void
    : Effect.fail(
        new AnalysisCommandError(
          409,
          "STALE_PRECONDITION",
          "Analysis run state hash does not match the expected precondition.",
        ),
      );

const transitionRun = (runId: string, expected: AnalysisRunState, next: AnalysisRunState) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    return yield* ledger
      .transitionAnalysisRunState(runId, expected, next)
      .pipe(Effect.mapError(mapCommandCause));
  });

const runRequest = (
  config: AnalysisCommandConfig,
  input: {
    readonly runId: string;
    readonly documentId: number;
    readonly forceOcr?: boolean;
  },
): DocumentAnalysisRunRequest => ({
  runId: input.runId,
  documentId: input.documentId,
  forceOcr: input.forceOcr,
  configuredCustomFieldIds: config.configuredCustomFieldIds,
  systemTagIds: config.systemTagIds,
  workflowTagIds: config.workflowTagIds,
  aiAnalyseTagId: config.aiAnalyseTagId,
  parentTagIds: config.parentTagIds,
  guidance: config.guidance,
  mode: "review",
});

const swallowBackgroundFailure = (effect: Effect.Effect<unknown, unknown, never>) =>
  effect.pipe(
    Effect.asVoid,
    Effect.catchAll(() => Effect.void),
  );

const allPaperlessDocuments = (
  paperless: PaperlessService,
): Effect.Effect<readonly PaperlessDocumentSnapshot[], unknown> =>
  Effect.gen(function* () {
    const documents: PaperlessDocumentSnapshot[] = [];
    let cursor: string | undefined;
    do {
      const page = yield* paperless.listDocumentsPage({
        cursor,
        limit: MAX_RANDOM_CYCLE_PAGE_SIZE,
      });
      documents.push(...page.items);
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);
    return documents;
  });

export const makeAnalysisCommandHandlers = (
  config: AnalysisCommandConfig,
  runtime: AnalysisCommandRuntime = makeDaemonAnalysisCommandRuntime(),
) => {
  const runIdFactory = config.runIdFactory ?? defaultRunIdFactory;

  const startAnalysis = (rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeStartBody(rawBody);
      const marker = acceptanceMarker({
        action: "start",
        documentId: body.documentId,
        requestId: body.requestId,
        bodyHash: canonicalSha256(rawBody),
      });
      const ledger = yield* OperationalLedgerService;
      const before = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(before, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisRunAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          state: before.analysisRuns[previous.runId]?.state ?? "queued",
          acceptedAt: previous.timestamp,
          progressUrl: progressUrl(config, previous.runId),
          statusUrl: statusUrl(config, previous.runId),
        });
      }

      const triggered = yield* prepareTriggeredDocument(config, {
        documentId: body.documentId,
        command: "start",
        requestKey: marker,
      });
      const afterTrigger = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const repeated = acceptedCommandEntry(afterTrigger, marker);
      if (repeated?.runId) {
        return yield* commandResponse(AnalysisRunAcceptedSchema, {
          status: 202,
          runId: repeated.runId,
          state: afterTrigger.analysisRuns[repeated.runId]?.state ?? "queued",
          acceptedAt: repeated.timestamp,
          progressUrl: progressUrl(config, repeated.runId),
          statusUrl: statusUrl(config, repeated.runId),
        });
      }

      const analysis = yield* DocumentAnalysisOrchestrator;
      const runId = runIdFactory({
        purpose: "start",
        documentId: body.documentId,
        requestId: body.requestId ?? marker,
        triggerRevision: triggered.triggerRevision,
      });
      const existingRun = afterTrigger.analysisRuns[runId];
      const acceptedAt = commandNow(config);
      if (!existingRun) {
        const taskKey = `analysis:start:${runId}`;
        yield* runtime.schedule(
          taskKey,
          swallowBackgroundFailure(
            analysis.run(
              runRequest(config, { runId, documentId: body.documentId, forceOcr: body.forceOcr }),
            ),
          ),
        );
        yield* recordAcceptedCommand({
          marker,
          action: "start",
          runId,
          taskKey,
          acceptedAt,
          hashes: [triggered.triggerRevision, triggered.snapshot.stateHash],
        });
      }
      return yield* commandResponse(AnalysisRunAcceptedSchema, {
        status: 202,
        runId,
        state: existingRun?.state ?? "queued",
        acceptedAt,
        progressUrl: progressUrl(config, runId),
        statusUrl: statusUrl(config, runId),
      });
    });

  const applyAnalysisRun = (runId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        AnalysisDecisionBodySchema,
        ["expectedProposalHash", "reason", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "apply",
        runId,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          proposalId: previous.proposalId,
          action: "apply",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const run = yield* requireRun(snapshot, runId);
      if (run.state !== "awaiting_review") {
        return yield* Effect.fail(
          new AnalysisCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Analysis run ${runId} is ${run.state}, not awaiting_review.`,
          ),
        );
      }
      const proposal = yield* proposalForRun(snapshot, run, body.expectedProposalHash);
      const acceptedAt = commandNow(config);
      yield* ledger
        .recordProposalDecision(proposal.proposalId, {
          expectedDecision: proposal.decision,
          decision: "approved",
          outcome: "approved",
          decidedAt: acceptedAt,
        })
        .pipe(Effect.mapError(mapCommandCause));
      yield* transitionRun(runId, "awaiting_review", "approved");
      const analysis = yield* DocumentAnalysisOrchestrator;
      const taskKey = `analysis:apply:${proposal.proposalId}`;
      yield* runtime.schedule(
        taskKey,
        swallowBackgroundFailure(
          analysis.applyApprovedProposal({
            proposalId: proposal.proposalId,
            expectedProposalHash: body.expectedProposalHash,
            configuredCustomFieldIds: config.configuredCustomFieldIds,
            systemTagIds: config.systemTagIds,
            parentTagIds: config.parentTagIds,
            aiAnalyseTagId: config.aiAnalyseTagId,
          }),
        ),
      );
      yield* recordAcceptedCommand({
        marker,
        action: "apply",
        runId,
        proposalId: proposal.proposalId,
        taskKey,
        acceptedAt,
        hashes: [body.expectedProposalHash],
      });
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId,
        proposalId: proposal.proposalId,
        action: "apply",
        taskUrl: taskUrl(config, runId),
        acceptedAt,
      });
    });

  const rejectAnalysisRun = (runId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        AnalysisDecisionBodySchema,
        ["expectedProposalHash", "reason", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "reject",
        runId,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          proposalId: previous.proposalId,
          action: "reject",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const run = yield* requireRun(snapshot, runId);
      if (run.state !== "awaiting_review") {
        return yield* Effect.fail(
          new AnalysisCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Analysis run ${runId} is ${run.state}, not awaiting_review.`,
          ),
        );
      }
      const proposal = yield* proposalForRun(snapshot, run, body.expectedProposalHash);
      const acceptedAt = commandNow(config);
      yield* ledger
        .recordProposalDecision(proposal.proposalId, {
          expectedDecision: proposal.decision,
          decision: "rejected",
          outcome: "rejected",
          decidedAt: acceptedAt,
        })
        .pipe(Effect.mapError(mapCommandCause));
      yield* transitionRun(runId, "awaiting_review", "rejected");
      yield* recordAcceptedCommand({
        marker,
        action: "reject",
        runId,
        proposalId: proposal.proposalId,
        taskKey: `analysis:reject:${proposal.proposalId}`,
        acceptedAt,
        hashes: [body.expectedProposalHash],
      });
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId,
        proposalId: proposal.proposalId,
        action: "reject",
        taskUrl: taskUrl(config, runId),
        acceptedAt,
      });
    });

  const retryAnalysisRun = (runId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        AnalysisRetryBodySchema,
        ["expectedRunStateHash", "reason", "forceOcr", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "retry",
        runId,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          action: "retry",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const run = yield* requireRun(snapshot, runId);
      yield* requireRunHash(run, body.expectedRunStateHash);
      if (run.state !== "awaiting_review" && run.state !== "failed") {
        return yield* Effect.fail(
          new AnalysisCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Analysis run ${runId} cannot be retried from ${run.state}.`,
          ),
        );
      }
      const triggered = yield* prepareTriggeredDocument(config, {
        documentId: run.documentId,
        command: "retry",
        requestKey: marker,
      });
      const acceptedAt = commandNow(config);
      const analysis = yield* DocumentAnalysisOrchestrator;
      const targetRunId =
        run.state === "failed"
          ? runIdFactory({
              purpose: "retry",
              documentId: run.documentId,
              requestId: `${runId}:${body.idempotencyKey}`,
              triggerRevision: triggered.triggerRevision,
            })
          : runId;
      if (run.state === "awaiting_review") {
        yield* transitionRun(runId, "awaiting_review", "retrying");
      }
      const latestSnapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (run.state === "awaiting_review" || !latestSnapshot.analysisRuns[targetRunId]) {
        const taskKey = `analysis:retry:${targetRunId}`;
        yield* runtime.schedule(
          taskKey,
          swallowBackgroundFailure(
            analysis.run(
              runRequest(config, {
                runId: targetRunId,
                documentId: run.documentId,
                forceOcr: body.forceOcr ?? run.forceOcr,
              }),
            ),
          ),
        );
        yield* recordAcceptedCommand({
          marker,
          action: "retry",
          runId: targetRunId,
          taskKey,
          acceptedAt,
          hashes: [triggered.triggerRevision, triggered.snapshot.stateHash],
        });
      }
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId: targetRunId,
        action: "retry",
        taskUrl: taskUrl(config, targetRunId),
        acceptedAt,
      });
    });

  const forceOcrAnalysisRun = (runId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        AnalysisForceOcrBodySchema,
        ["expectedRunStateHash", "reason", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "force_ocr",
        runId,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          action: "force_ocr",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const run = yield* requireRun(snapshot, runId);
      yield* requireRunHash(run, body.expectedRunStateHash);
      if (run.state !== "awaiting_review" && run.state !== "failed") {
        return yield* Effect.fail(
          new AnalysisCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Analysis run ${runId} cannot force OCR from ${run.state}.`,
          ),
        );
      }
      const triggered = yield* prepareTriggeredDocument(config, {
        documentId: run.documentId,
        command: "force_ocr",
        requestKey: marker,
      });
      const acceptedAt = commandNow(config);
      const analysis = yield* DocumentAnalysisOrchestrator;
      const targetRunId =
        run.state === "failed"
          ? runIdFactory({
              purpose: "force_ocr",
              documentId: run.documentId,
              requestId: `${runId}:${body.idempotencyKey}`,
              triggerRevision: triggered.triggerRevision,
            })
          : runId;
      if (run.state === "awaiting_review") {
        yield* transitionRun(runId, "awaiting_review", "retrying");
      }
      const latestSnapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (run.state === "awaiting_review" || !latestSnapshot.analysisRuns[targetRunId]) {
        const taskKey = `analysis:force_ocr:${targetRunId}`;
        yield* runtime.schedule(
          taskKey,
          swallowBackgroundFailure(
            analysis.run(
              runRequest(config, {
                runId: targetRunId,
                documentId: run.documentId,
                forceOcr: true,
              }),
            ),
          ),
        );
        yield* recordAcceptedCommand({
          marker,
          action: "force_ocr",
          runId: targetRunId,
          taskKey,
          acceptedAt,
          hashes: [triggered.triggerRevision, triggered.snapshot.stateHash],
        });
      }
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId: targetRunId,
        action: "force_ocr",
        taskUrl: taskUrl(config, targetRunId),
        acceptedAt,
      });
    });

  const cancelAnalysisRun = (runId: string, rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        AnalysisCancelBodySchema,
        ["expectedRunStateHash", "reason", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "cancel",
        runId,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          action: "cancel",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const run = yield* requireRun(snapshot, runId);
      yield* requireRunHash(run, body.expectedRunStateHash);
      if (["succeeded", "failed", "canceled", "rejected"].includes(run.state)) {
        return yield* Effect.fail(
          new AnalysisCommandError(
            409,
            "STATE_TRANSITION_CONFLICT",
            `Analysis run ${runId} is already terminal.`,
          ),
        );
      }
      yield* transitionRun(runId, run.state, "canceled");
      const acceptedTasks = snapshot.ledgerEntries
        .filter((entry) => entry.runId === runId && entry.state?.startsWith("accepted:"))
        .map((entry) => taskKeyFromRationale(entry.rationale))
        .filter((taskKey): taskKey is string => taskKey !== null);
      if (acceptedTasks.length === 0) {
        yield* runtime.cancel(`analysis:run:${runId}`);
      } else {
        yield* Effect.all(
          acceptedTasks.map((taskKey) => runtime.cancel(taskKey)),
          {
            discard: true,
          },
        );
      }
      const acceptedAt = commandNow(config);
      yield* recordAcceptedCommand({
        marker,
        action: "cancel",
        runId,
        taskKey: `analysis:cancel:${runId}`,
        acceptedAt,
        hashes: [body.expectedRunStateHash],
      });
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId,
        action: "cancel",
        taskUrl: taskUrl(config, runId),
        acceptedAt,
      });
    });

  const selectRandomCycle = (rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        RandomCycleSelectBodySchema,
        ["cycleKey", "excludeDocumentIds", "forceOcr"],
        rawBody,
      );
      const duplicateExcludedDocumentIds = duplicateNumbers(body.excludeDocumentIds ?? []);
      if (duplicateExcludedDocumentIds.length > 0) {
        return yield* Effect.fail(
          new AnalysisCommandError(
            502,
            "PROVIDER_MALFORMED",
            "Random-cycle excludeDocumentIds contains duplicate document IDs.",
          ),
        );
      }
      const paperless = yield* PaperlessService;
      yield* requireCapabilities(paperless);
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const current = snapshot.randomCycles[body.cycleKey];
      const cursor = current?.cursor ?? 0;
      const marker = acceptanceMarker({
        action: "random_select",
        cycleKey: body.cycleKey,
        bodyHash: canonicalSha256({ body, cursor }),
      });
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        const run = snapshot.analysisRuns[previous.runId];
        return yield* commandResponse(RandomCycleSelectAcceptedSchema, {
          status: 202,
          cycleKey: body.cycleKey,
          runId: previous.runId,
          documentId: run?.documentId ?? 1,
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const documents = yield* allPaperlessDocuments(paperless).pipe(
        Effect.mapError(mapCommandCause),
      );
      const excluded = new Set(body.excludeDocumentIds ?? []);
      const eligible = documents
        .filter((document) => !excluded.has(document.documentId))
        .sort((left, right) => left.documentId - right.documentId);
      if (eligible.length === 0) {
        return yield* Effect.fail(
          new AnalysisCommandError(
            503,
            "CAPABILITY_UNAVAILABLE",
            "No documents are available for random-cycle selection.",
          ),
        );
      }
      const selected = eligible[cursor % eligible.length] as PaperlessDocumentSnapshot;
      const triggered = yield* prepareTriggeredDocument(config, {
        documentId: selected.documentId,
        command: "random",
        requestKey: marker,
      });
      const runId = runIdFactory({
        purpose: "random_cycle",
        documentId: selected.documentId,
        cycleKey: body.cycleKey,
        requestId: `${body.cycleKey}:${cursor}`,
        triggerRevision: triggered.triggerRevision,
      });
      const acceptedAt = commandNow(config);
      yield* ledger
        .recordRandomCycle({
          cycleKey: body.cycleKey,
          documentIds: eligible.map((document) => document.documentId),
          cursor: cursor + 1,
          selectedRunId: runId,
          updatedAt: acceptedAt,
        })
        .pipe(Effect.mapError(mapCommandCause));
      const analysis = yield* DocumentAnalysisOrchestrator;
      const latestSnapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      if (!latestSnapshot.analysisRuns[runId]) {
        const taskKey = `analysis:random:${runId}`;
        yield* runtime.schedule(
          taskKey,
          swallowBackgroundFailure(
            analysis.run(
              runRequest(config, {
                runId,
                documentId: selected.documentId,
                forceOcr: body.forceOcr,
              }),
            ),
          ),
        );
        yield* recordAcceptedCommand({
          marker,
          action: "random_select",
          runId,
          taskKey,
          acceptedAt,
          hashes: [triggered.triggerRevision, triggered.snapshot.stateHash],
        });
      }
      return yield* commandResponse(RandomCycleSelectAcceptedSchema, {
        status: 202,
        cycleKey: body.cycleKey,
        runId,
        documentId: selected.documentId,
        taskUrl: taskUrl(config, runId),
        acceptedAt,
      });
    });

  const resetRandomCycle = (rawBody: unknown) =>
    Effect.gen(function* () {
      const body = yield* decodeBody(
        RandomCycleResetBodySchema,
        ["cycleKey", "idempotencyKey"],
        rawBody,
      );
      const marker = acceptanceMarker({
        action: "random_reset",
        cycleKey: body.cycleKey,
        idempotencyKey: body.idempotencyKey,
      });
      const ledger = yield* OperationalLedgerService;
      const snapshot = yield* ledger.getSnapshot().pipe(Effect.mapError(mapCommandCause));
      const previous = acceptedCommandEntry(snapshot, marker);
      if (previous?.runId) {
        return yield* commandResponse(AnalysisActionAcceptedSchema, {
          status: 202,
          runId: previous.runId,
          action: "cancel",
          taskUrl: taskUrl(config, previous.runId),
          acceptedAt: previous.timestamp,
        });
      }
      const runId = runIdFactory({
        purpose: "random_cycle",
        documentId: 1,
        cycleKey: body.cycleKey,
        requestId: `reset:${body.idempotencyKey}`,
      });
      const acceptedAt = commandNow(config);
      yield* ledger
        .recordRandomCycle({
          cycleKey: body.cycleKey,
          documentIds: [],
          cursor: 0,
          reset: true,
          updatedAt: acceptedAt,
        })
        .pipe(Effect.mapError(mapCommandCause));
      yield* recordAcceptedCommand({
        marker,
        action: "random_reset",
        runId,
        taskKey: `analysis:random_reset:${body.cycleKey}`,
        acceptedAt,
      });
      return yield* commandResponse(AnalysisActionAcceptedSchema, {
        status: 202,
        runId,
        action: "cancel",
        taskUrl: taskUrl(config, runId),
        acceptedAt,
      });
    });

  return {
    startAnalysis,
    applyAnalysisRun,
    rejectAnalysisRun,
    retryAnalysisRun,
    cancelAnalysisRun,
    forceOcrAnalysisRun,
    selectRandomCycle,
    resetRandomCycle,
    streamRegistrationDescriptor: analysisStreamRegistrationDescriptor,
    commandEndpoints: analysisCommandEndpoints,
    commandListDescriptors: analysisCommandListDescriptors,
  };
};
