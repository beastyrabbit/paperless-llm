import {
  type ApplyJournal,
  type ApplyJournalStep,
  canonicalSha256,
  type HashPrecondition,
  type PaperlessTask,
  type Sha256Digest,
} from "@repo/api-contracts";
import { Context, Effect, Layer } from "effect";
import type {
  CatalogProposalValues,
  OperationalLedgerData,
  ProposalRecord,
} from "../operational-ledger/types.js";
import type { PaperlessAssignmentReceipt } from "../paperless/types.js";
import type {
  ApplyReviewedCatalogProposalRequest,
  CatalogApplyConflictCode,
  CatalogApplyReceiptSet,
  CatalogApplyRecoveryOptions,
  CatalogApplyRecoveryResult,
  CatalogApplyResult,
  CatalogApplyService as CatalogApplyServiceType,
  CatalogApplySupportedKind,
} from "./types.js";
import { CatalogApplyConflict } from "./types.js";

const DEFAULT_BATCH_SIZE = 30;
const DEFAULT_LEASE_TTL_MS = 60_000;

export type CatalogApplyAssignmentOperation =
  | "modify_tags"
  | "set_correspondent"
  | "set_document_type";

export interface CatalogApplyAssignmentBatchRequest {
  readonly operation: CatalogApplyAssignmentOperation;
  readonly documentIds: readonly number[];
  readonly preconditions: readonly HashPrecondition[];
  readonly parameters:
    | { readonly addTagIds: readonly number[]; readonly removeTagIds: readonly number[] }
    | { readonly correspondentId: number }
    | { readonly documentTypeId: number };
  readonly payloadHash: Sha256Digest;
  readonly idempotencyKey: string;
}

export interface CatalogApplyEntityState {
  readonly kind: CatalogApplySupportedKind;
  readonly entityId: number;
  readonly exists: boolean;
  readonly name: string | null;
  readonly dependencyHash: Sha256Digest;
  readonly blockedReasons: readonly string[];
}

export interface CatalogApplyDocumentMutationState {
  readonly documentId: number;
  readonly assignmentHash: Sha256Digest;
  readonly hasSourceAssignment: boolean;
  readonly hasTargetAssignment: boolean;
}

export interface CatalogApplyMutationPort {
  readonly readEntity: (
    kind: CatalogApplySupportedKind,
    entityId: number,
  ) => Effect.Effect<CatalogApplyEntityState | null, unknown>;
  readonly findEntityByName: (
    kind: CatalogApplySupportedKind,
    name: string,
  ) => Effect.Effect<CatalogApplyEntityState | null, unknown>;
  readonly readAssignmentReceipt: (
    kind: CatalogApplySupportedKind,
    entityId: number,
  ) => Effect.Effect<PaperlessAssignmentReceipt, unknown>;
  readonly readDocumentMutationState: (
    kind: CatalogApplySupportedKind,
    documentId: number,
    sourceEntityId: number,
    targetEntityId: number | null,
  ) => Effect.Effect<CatalogApplyDocumentMutationState, unknown>;
  readonly submitAssignmentBatch: (
    request: CatalogApplyAssignmentBatchRequest,
  ) => Effect.Effect<PaperlessTask, unknown>;
  readonly pollTask: (
    taskId: string,
    options?: { readonly timeoutMs?: number; readonly intervalMs?: number },
  ) => Effect.Effect<PaperlessTask, unknown>;
  readonly deleteEntity: (
    kind: CatalogApplySupportedKind,
    entityId: number,
  ) => Effect.Effect<void, unknown>;
  readonly renameEntity: (
    kind: CatalogApplySupportedKind,
    entityId: number,
    name: string,
  ) => Effect.Effect<unknown, unknown>;
  readonly invalidateCatalogCache: () => Effect.Effect<void, unknown>;
}

export interface CatalogApplyLeaseRecord {
  readonly leaseId: string;
  readonly owner: string;
  readonly runId: string;
}

export interface CatalogApplyLedgerPort {
  readonly getSnapshot: () => Effect.Effect<
    Pick<OperationalLedgerData, "applyJournals" | "chairDecisions" | "proposals">,
    unknown
  >;
  readonly recordApplyJournal: (journal: ApplyJournal) => Effect.Effect<ApplyJournal, unknown>;
  readonly acquireLease: (input: {
    readonly scope: "mutation";
    readonly resourceId: string;
    readonly owner: string;
    readonly runId: string;
    readonly ttlMs?: number;
  }) => Effect.Effect<
    {
      readonly acquired: boolean;
      readonly lease: CatalogApplyLeaseRecord;
      readonly staleRecovered: boolean;
    },
    unknown
  >;
  readonly heartbeatLease: (
    leaseId: string,
    runId: string,
  ) => Effect.Effect<CatalogApplyLeaseRecord | null, unknown>;
  readonly releaseLease: (leaseId: string, runId: string) => Effect.Effect<boolean, unknown>;
  readonly recordProposalDecision: (
    proposalId: string,
    input: {
      readonly expectedDecision: "approved";
      readonly decision: "applied" | "conflict";
      readonly outcome?: "applied" | "conflict";
    },
  ) => Effect.Effect<ProposalRecord, unknown>;
}

export const CatalogApplyMutationPort = Context.GenericTag<CatalogApplyMutationPort>(
  "CatalogApplyMutationPort",
);

export const CatalogApplyLedgerPort =
  Context.GenericTag<CatalogApplyLedgerPort>("CatalogApplyLedgerPort");

const nowIso = () => new Date().toISOString();

const sortedUnique = (values: readonly number[]) =>
  [...new Set(values)].sort((left, right) => left - right);

const chunk = <T>(values: readonly T[], size: number): readonly (readonly T[])[] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const hash = (scope: string, value: unknown) => canonicalSha256({ scope, value });

const fail = (
  code: CatalogApplyConflictCode,
  message: string,
  retryable = false,
  details: Readonly<Record<string, unknown>> = {},
) => Effect.fail(new CatalogApplyConflict(code, message, retryable, details));

export const catalogApplyFingerprintForReceipts = ({
  kind,
  source,
  target,
}: CatalogApplyReceiptSet) =>
  hash("catalog_apply_catalog_fingerprint", {
    kind,
    source: {
      entityId: source.entityId,
      assignmentHash: source.assignmentHash,
      documentIds: source.documentIds,
    },
    target: target
      ? {
          entityId: target.entityId,
          assignmentHash: target.assignmentHash,
          documentIds: target.documentIds,
        }
      : null,
  });

export const catalogApplyFingerprintForLiveState = ({
  receipts,
  sourceEntity,
  targetEntity,
}: {
  readonly receipts: CatalogApplyReceiptSet;
  readonly sourceEntity: CatalogApplyEntityState;
  readonly targetEntity: CatalogApplyEntityState | null;
}) =>
  hash("catalog_apply_live_catalog_fingerprint", {
    receiptFingerprint: catalogApplyFingerprintForReceipts(receipts),
    sourceEntity: {
      entityId: sourceEntity.entityId,
      exists: sourceEntity.exists,
      nameHash: hash("catalog_apply_entity_name", sourceEntity.name),
      dependencyHash: sourceEntity.dependencyHash,
      blockedReasons: [...sourceEntity.blockedReasons].sort(),
    },
    targetEntity: targetEntity
      ? {
          entityId: targetEntity.entityId,
          exists: targetEntity.exists,
          nameHash: hash("catalog_apply_entity_name", targetEntity.name),
          dependencyHash: targetEntity.dependencyHash,
          blockedReasons: [...targetEntity.blockedReasons].sort(),
        }
      : null,
  });

const journalIdFor = (proposalId: string, idempotencyKey: string) =>
  `journal_${canonicalSha256({ proposalId, idempotencyKey }).slice(0, 24)}`;

const step = ({
  stepId,
  operation,
  paperlessTaskId = null,
  beforeHash,
  afterHash = null,
  status,
  errorCode,
  recordedAt,
}: {
  readonly stepId: string;
  readonly operation: ApplyJournalStep["operation"];
  readonly paperlessTaskId?: string | null;
  readonly beforeHash: Sha256Digest;
  readonly afterHash?: Sha256Digest | null;
  readonly status: ApplyJournalStep["status"];
  readonly errorCode?: string;
  readonly recordedAt: string;
}): ApplyJournalStep => ({
  stepId,
  operation,
  paperlessTaskId,
  beforeHash,
  afterHash,
  status,
  ...(errorCode ? { errorCode } : {}),
  recordedAt,
});

const isSupportedKind = (kind: string): kind is CatalogApplySupportedKind =>
  kind === "tag" || kind === "correspondent" || kind === "document_type";

const catalogValuesFromProposal = (
  proposal: ProposalRecord,
): Effect.Effect<CatalogProposalValues, CatalogApplyConflict> => {
  if (proposal.scope !== "catalog" || proposal.proposedValues?.scope !== "catalog") {
    return fail("INVALID_PROPOSAL", "Catalog apply requires an uncompacted catalog proposal");
  }
  return Effect.succeed(proposal.proposedValues);
};

const readReceipt = (
  mutation: CatalogApplyMutationPort,
  kind: CatalogApplySupportedKind,
  entityId: number,
) => mutation.readAssignmentReceipt(kind, entityId);

const readReceipts = (
  mutation: CatalogApplyMutationPort,
  kind: CatalogApplySupportedKind,
  sourceEntityId: number,
  targetEntityId: number | null,
) =>
  Effect.gen(function* () {
    const source = yield* readReceipt(mutation, kind, sourceEntityId);
    const target =
      targetEntityId === null ? null : yield* readReceipt(mutation, kind, targetEntityId);
    return { kind, source, target } satisfies CatalogApplyReceiptSet;
  });

const readLiveState = (
  mutation: CatalogApplyMutationPort,
  kind: CatalogApplySupportedKind,
  sourceEntityId: number,
  targetEntityId: number | null,
) =>
  Effect.gen(function* () {
    const sourceEntity = yield* mutation.readEntity(kind, sourceEntityId);
    if (!sourceEntity?.exists) {
      return yield* fail("ENTITY_NOT_FOUND", "Source catalog entity is missing", false, {
        kind,
        sourceEntityId,
      });
    }
    const targetEntity =
      targetEntityId === null ? null : yield* mutation.readEntity(kind, targetEntityId);
    if (targetEntityId !== null && !targetEntity?.exists) {
      return yield* fail("ENTITY_NOT_FOUND", "Target catalog entity is missing", false, {
        kind,
        targetEntityId,
      });
    }
    const receipts = yield* readReceipts(mutation, kind, sourceEntityId, targetEntityId);
    return {
      receipts,
      sourceEntity,
      targetEntity,
      fingerprint: catalogApplyFingerprintForLiveState({
        receipts,
        sourceEntity,
        targetEntity,
      }),
    };
  });

const bulkOperationForKind = (kind: CatalogApplySupportedKind): CatalogApplyAssignmentOperation => {
  if (kind === "tag") return "modify_tags";
  if (kind === "correspondent") return "set_correspondent";
  return "set_document_type";
};

const bulkPayloadForKind = (
  kind: CatalogApplySupportedKind,
  sourceEntityId: number,
  targetEntityId: number,
) => {
  if (kind === "tag") return { addTagIds: [targetEntityId], removeTagIds: [sourceEntityId] };
  if (kind === "correspondent") return { correspondentId: targetEntityId };
  return { documentTypeId: targetEntityId };
};

const readDocumentStates = (
  mutation: CatalogApplyMutationPort,
  kind: CatalogApplySupportedKind,
  sourceEntityId: number,
  targetEntityId: number | null,
  documentIds: readonly number[],
) =>
  Effect.all(
    documentIds.map((documentId) =>
      mutation.readDocumentMutationState(kind, documentId, sourceEntityId, targetEntityId),
    ),
  );

const targetCoversExpected = (
  target: PaperlessAssignmentReceipt | null,
  expectedDocumentIds: readonly number[],
) => {
  if (!target) return expectedDocumentIds.length === 0;
  const targetIds = new Set(target.documentIds);
  return expectedDocumentIds.every((documentId) => targetIds.has(documentId));
};

const sourceIsZero = (source: PaperlessAssignmentReceipt) => source.documentIds.length === 0;

const assertPostMergeVerified = ({
  post,
  expectedTargetDocumentIds,
}: {
  readonly post: CatalogApplyReceiptSet;
  readonly expectedTargetDocumentIds: readonly number[];
}) => {
  if (!targetCoversExpected(post.target, expectedTargetDocumentIds) || !sourceIsZero(post.source)) {
    return fail(
      "POSTREAD_VERIFICATION_FAILED",
      "Postread did not verify target coverage and zero source",
      true,
      {
        sourceDocumentIds: post.source.documentIds,
        targetDocumentIds: post.target?.documentIds ?? [],
        expectedTargetDocumentIds,
      },
    );
  }
  return Effect.void;
};

const assertDeleteVerified = (post: CatalogApplyReceiptSet) =>
  sourceIsZero(post.source)
    ? Effect.void
    : fail(
        "POSTREAD_VERIFICATION_FAILED",
        "Delete preread source still has assigned documents",
        false,
        {
          sourceDocumentIds: post.source.documentIds,
        },
      );

const existingJournal = (
  snapshot: Pick<OperationalLedgerData, "applyJournals">,
  journalId: string,
) => snapshot.applyJournals[journalId];

const journal = ({
  journalId,
  proposal,
  idempotencyKey,
  status,
  steps,
  createdAt,
  updatedAt,
}: {
  readonly journalId: string;
  readonly proposal: ProposalRecord;
  readonly idempotencyKey: string;
  readonly status: ApplyJournal["status"];
  readonly steps: readonly ApplyJournalStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}): ApplyJournal => ({
  journalId,
  proposalId: proposal.proposalId,
  epochId: proposal.ownerId,
  idempotencyKey,
  status,
  preconditions: proposal.preconditions,
  steps: [...steps],
  createdAt,
  updatedAt,
});

const validateRequest = ({
  request,
  proposal,
  chairDecision,
  values,
}: {
  readonly request: ApplyReviewedCatalogProposalRequest;
  readonly proposal: ProposalRecord;
  readonly chairDecision: ApplyReviewedCatalogProposalRequest["chairDecision"];
  readonly values: CatalogProposalValues;
}) => {
  if (!isSupportedKind(values.entityKind)) {
    return fail("UNSUPPORTED_KIND", `Catalog apply does not support ${values.entityKind}`);
  }
  if (values.applicationBlockedReasons.length > 0) {
    return fail("UNSAFE_DEPENDENCY", "Catalog proposal has unresolved unsafe dependencies", false, {
      unsafeDependencies: values.applicationBlockedReasons,
    });
  }
  if (proposal.decision !== "approved") {
    return fail("NOT_HUMAN_APPROVED", "Catalog proposal must be human-approved before apply");
  }
  if (
    chairDecision.verdict !== "approve" ||
    chairDecision.action !== "request_review" ||
    chairDecision.proposalId !== proposal.proposalId
  ) {
    return fail("NOT_HUMAN_APPROVED", "Chair record does not approve the catalog proposal");
  }
  if (
    values.expectedProposalFingerprint !== request.expectedProposalFingerprint ||
    chairDecision.proposalFingerprint !== request.expectedProposalFingerprint
  ) {
    return fail("STALE_PROPOSAL", "Catalog proposal fingerprint does not match the apply request");
  }
  if (chairDecision.evidenceFingerprint !== request.expectedEvidenceFingerprint) {
    return fail("STALE_EVIDENCE", "Catalog evidence fingerprint does not match the apply request");
  }
  if (
    chairDecision.sourceEntityId !== values.sourceEntityId ||
    chairDecision.targetEntityId !== values.targetEntityId
  ) {
    return fail("INVALID_PROPOSAL", "Chair direction does not match proposal values");
  }
  if (values.intendedAction === "merge" && values.targetEntityId === null) {
    return fail("INVALID_PROPOSAL", "Merge proposals require a target entity");
  }
  if (values.intendedAction === "rename" && !values.proposedValue) {
    return fail("INVALID_PROPOSAL", "Rename proposals require a proposed value");
  }
  if (values.intendedAction === "delete" && values.targetEntityId !== null) {
    return fail("INVALID_PROPOSAL", "Delete proposals must not include a target entity");
  }
  return Effect.void;
};

const finalStatusForExisting = (status: ApplyJournal["status"]) =>
  status === "succeeded" || status === "conflict" || status === "canceled";

const resourceIdsForMutation = ({
  kind,
  sourceEntityId,
  targetEntityId,
  documentIds,
}: {
  readonly kind: CatalogApplySupportedKind;
  readonly sourceEntityId: number;
  readonly targetEntityId: number | null;
  readonly documentIds: readonly number[];
}) =>
  [
    `catalog:${kind}:${sourceEntityId}`,
    ...(targetEntityId === null ? [] : [`catalog:${kind}:${targetEntityId}`]),
    ...documentIds.map((documentId) => `doc:${documentId}`),
  ].sort();

const acquireMutationLeases = ({
  ledger,
  resourceIds,
  owner,
  runId,
  ttlMs,
}: {
  readonly ledger: CatalogApplyLedgerPort;
  readonly resourceIds: readonly string[];
  readonly owner: string;
  readonly runId: string;
  readonly ttlMs: number;
}) =>
  Effect.gen(function* () {
    const acquired: CatalogApplyLeaseRecord[] = [];
    for (const resourceId of [...new Set(resourceIds)].sort()) {
      const lease = yield* ledger.acquireLease({
        scope: "mutation",
        resourceId,
        owner,
        runId,
        ttlMs,
      });
      if (!lease.acquired) {
        for (const held of acquired.reverse()) {
          yield* ledger.releaseLease(held.leaseId, held.runId).pipe(Effect.ignore);
        }
        return yield* fail("LEASE_BUSY", "Catalog mutation lease is already held", true, {
          resourceId,
          leaseId: lease.lease.leaseId,
          owner: lease.lease.owner,
        });
      }
      acquired.push(lease.lease);
      yield* ledger.heartbeatLease(lease.lease.leaseId, lease.lease.runId).pipe(Effect.ignore);
    }
    return acquired;
  });

const releaseMutationLeases = (
  ledger: CatalogApplyLedgerPort,
  leases: readonly CatalogApplyLeaseRecord[],
) =>
  Effect.all(
    [...leases]
      .reverse()
      .map((lease) => ledger.releaseLease(lease.leaseId, lease.runId).pipe(Effect.ignore)),
    { discard: true },
  );

const persistedReviewFromSnapshot = (
  snapshot: Pick<OperationalLedgerData, "chairDecisions" | "proposals">,
  request: ApplyReviewedCatalogProposalRequest,
) =>
  Effect.gen(function* () {
    const persistedProposal = snapshot.proposals[request.proposal.proposalId];
    if (!persistedProposal) {
      return yield* fail("INVALID_PROPOSAL", "Persisted proposal was not found");
    }
    const persistedChair = Object.values(snapshot.chairDecisions)
      .filter((decision) => decision.proposalId === persistedProposal.proposalId)
      .sort((left, right) => right.decidedAt.localeCompare(left.decidedAt))[0];
    if (!persistedChair) {
      return yield* fail("NOT_HUMAN_APPROVED", "Persisted chair decision was not found");
    }
    const values = yield* catalogValuesFromProposal(persistedProposal);
    yield* validateRequest({
      request,
      proposal: persistedProposal,
      chairDecision: persistedChair,
      values,
    });
    return {
      proposal: persistedProposal,
      chairDecision: persistedChair,
      values,
      request: {
        ...request,
        proposal: persistedProposal,
        chairDecision: persistedChair,
      },
    };
  });

const applyWithLease = ({
  request,
  values,
  existingSteps,
  journalIdOverride,
}: {
  readonly request: ApplyReviewedCatalogProposalRequest;
  readonly values: CatalogProposalValues;
  readonly existingSteps: readonly ApplyJournalStep[];
  readonly journalIdOverride?: string;
}) =>
  Effect.gen(function* () {
    const mutation = yield* CatalogApplyMutationPort;
    const ledger = yield* CatalogApplyLedgerPort;
    const kind = values.entityKind as CatalogApplySupportedKind;
    const createdAt = request.createdAt ?? nowIso();
    const id =
      journalIdOverride ?? journalIdFor(request.proposal.proposalId, request.idempotencyKey);
    const steps: ApplyJournalStep[] = [...existingSteps];
    const tasks: PaperlessTask[] = [];

    const record = (status: ApplyJournal["status"]) =>
      ledger.recordApplyJournal(
        journal({
          journalId: id,
          proposal: request.proposal,
          idempotencyKey: request.idempotencyKey,
          status,
          steps,
          createdAt,
          updatedAt: nowIso(),
        }),
      );

    const runJournaledTask = ({
      stepId,
      operation,
      documentIds,
      parameters,
      idempotencyKey,
      beforeHash,
    }: {
      readonly stepId: string;
      readonly operation: CatalogApplyAssignmentOperation;
      readonly documentIds: readonly number[];
      readonly parameters: CatalogApplyAssignmentBatchRequest["parameters"];
      readonly idempotencyKey: string;
      readonly beforeHash: Sha256Digest;
    }) =>
      Effect.gen(function* () {
        const documentBefore = yield* readDocumentStates(
          mutation,
          kind,
          values.sourceEntityId,
          values.targetEntityId,
          documentIds,
        );
        const payloadHash = hash("catalog_apply_bulk_payload", {
          operation,
          documentIds,
          parameters,
          documentBefore,
        });
        steps.push(
          step({
            stepId,
            operation: "merge",
            beforeHash: payloadHash,
            afterHash: null,
            status: "pending",
            recordedAt: nowIso(),
          }),
        );
        yield* record("accepted");

        const submitted = yield* mutation.submitAssignmentBatch({
          operation,
          documentIds,
          preconditions: request.proposal.preconditions,
          parameters,
          payloadHash,
          idempotencyKey,
        });
        tasks.push(submitted);
        steps.push(
          step({
            stepId,
            operation: "merge",
            paperlessTaskId: submitted.taskId,
            beforeHash: payloadHash,
            afterHash: submitted.resultHash,
            status: "running",
            recordedAt: nowIso(),
          }),
        );
        yield* record("applying");

        const outcome = yield* Effect.either(
          mutation.pollTask(submitted.taskId, {
            timeoutMs: request.taskPollTimeoutMs,
            intervalMs: request.taskPollIntervalMs,
          }),
        );
        if (outcome._tag === "Left" || outcome.right.status !== "succeeded") {
          const task =
            outcome._tag === "Right"
              ? outcome.right
              : ({
                  taskId: submitted.taskId,
                  status: "failed",
                  submittedAt: submitted.submittedAt,
                  updatedAt: nowIso(),
                  resultHash: null,
                } satisfies PaperlessTask);
          steps.push(
            step({
              stepId,
              operation: "merge",
              paperlessTaskId: task.taskId,
              beforeHash: payloadHash,
              afterHash: null,
              status: "failed",
              errorCode:
                outcome._tag === "Left"
                  ? outcome.left instanceof CatalogApplyConflict
                    ? outcome.left.code
                    : "AMBIGUOUS_WRITE"
                  : (outcome.right.errorCode ?? "TASK_FAILED"),
              recordedAt: nowIso(),
            }),
          );
          yield* record("failed");
          if (outcome._tag === "Left") {
            return yield* fail(
              outcome.left instanceof CatalogApplyConflict ? outcome.left.code : "AMBIGUOUS_WRITE",
              "Paperless task polling failed after task acceptance",
              true,
              {
                taskId: submitted.taskId,
              },
            );
          }
          return yield* fail("TASK_FAILED", "Paperless task did not succeed", true, {
            taskId: outcome.right.taskId,
            status: outcome.right.status,
            errorCode: outcome.right.errorCode,
          });
        }
        const task = outcome.right;
        const documentAfter = yield* readDocumentStates(
          mutation,
          kind,
          values.sourceEntityId,
          values.targetEntityId,
          documentIds,
        );
        steps.push(
          step({
            stepId,
            operation: "merge",
            paperlessTaskId: task.taskId,
            beforeHash: payloadHash,
            afterHash: hash("catalog_apply_batch_after", {
              task,
              documentAfter,
              priorBeforeHash: beforeHash,
            }),
            status: "succeeded",
            recordedAt: nowIso(),
          }),
        );
        yield* record("applying");
        return task;
      });

    const preLive = yield* readLiveState(
      mutation,
      kind,
      values.sourceEntityId,
      values.targetEntityId,
    );
    const pre = preLive.receipts;
    const preFingerprint = preLive.fingerprint;
    const blockedReasons = [
      ...preLive.sourceEntity.blockedReasons,
      ...(preLive.targetEntity?.blockedReasons ?? []),
    ];
    if (blockedReasons.length > 0) {
      steps.push(
        step({
          stepId: "preread",
          operation: "describe",
          beforeHash: request.expectedCatalogFingerprint,
          afterHash: preFingerprint,
          status: "failed",
          errorCode: "UNSAFE_DEPENDENCY",
          recordedAt: nowIso(),
        }),
      );
      yield* record("conflict");
      return yield* fail("UNSAFE_DEPENDENCY", "Live Paperless dependencies block apply", false, {
        unsafeDependencies: blockedReasons,
      });
    }
    if (existingSteps.length === 0 && preFingerprint !== request.expectedCatalogFingerprint) {
      steps.push(
        step({
          stepId: "preread",
          operation: "describe",
          beforeHash: request.expectedCatalogFingerprint,
          afterHash: preFingerprint,
          status: "failed",
          errorCode: "STALE_CATALOG",
          recordedAt: nowIso(),
        }),
      );
      yield* record("conflict");
      return yield* fail(
        "STALE_CATALOG",
        "Current catalog receipts do not match apply request",
        false,
        {
          expectedCatalogFingerprint: request.expectedCatalogFingerprint,
          currentCatalogFingerprint: preFingerprint,
        },
      );
    }

    steps.push(
      step({
        stepId: "preread",
        operation: "describe",
        beforeHash: request.expectedCatalogFingerprint,
        afterHash: preFingerprint,
        status: "succeeded",
        recordedAt: nowIso(),
      }),
    );
    yield* record("applying");

    if (values.intendedAction === "rename") {
      const collision = yield* mutation.findEntityByName(kind, values.proposedValue ?? "");
      if (collision && collision.entityId !== values.sourceEntityId) {
        steps.push(
          step({
            stepId: "verify-rename-collision",
            operation: "rename",
            beforeHash: preFingerprint,
            afterHash: hash("catalog_apply_rename_collision", collision),
            status: "failed",
            errorCode: "STALE_CATALOG",
            recordedAt: nowIso(),
          }),
        );
        yield* record("conflict");
        return yield* fail(
          "STALE_CATALOG",
          "Rename target collides with an existing entity",
          false,
          {
            collidingEntityId: collision.entityId,
          },
        );
      }
      if (preLive.sourceEntity.name === values.proposedValue) {
        steps.push(
          step({
            stepId: "rename-noop",
            operation: "rename",
            beforeHash: preFingerprint,
            afterHash: preFingerprint,
            status: "skipped",
            recordedAt: nowIso(),
          }),
        );
        const finalJournal = yield* record("succeeded");
        yield* ledger.recordProposalDecision(request.proposal.proposalId, {
          expectedDecision: "approved",
          decision: "applied",
        });
        return {
          status: existingSteps.length > 0 ? "resumed_applied" : "already_applied",
          proposalId: request.proposal.proposalId,
          journal: finalJournal,
          leaseId: null,
          sourceEntityId: values.sourceEntityId,
          targetEntityId: values.targetEntityId,
          migrationDocumentIds: [],
          paperlessTasks: tasks,
          preApplyCatalogFingerprint: preFingerprint,
          postApplyCatalogFingerprint: preFingerprint,
        } satisfies CatalogApplyResult;
      }
      yield* mutation.renameEntity(kind, values.sourceEntityId, values.proposedValue ?? "");
      yield* mutation.invalidateCatalogCache();
      const renamed = yield* readLiveState(mutation, kind, values.sourceEntityId, null);
      if (renamed.sourceEntity.name !== values.proposedValue) {
        steps.push(
          step({
            stepId: "verify-rename",
            operation: "rename",
            beforeHash: preFingerprint,
            afterHash: renamed.fingerprint,
            status: "failed",
            errorCode: "POSTREAD_VERIFICATION_FAILED",
            recordedAt: nowIso(),
          }),
        );
        yield* record("conflict");
        return yield* fail("POSTREAD_VERIFICATION_FAILED", "Rename postread did not verify name");
      }
      const afterHash = renamed.fingerprint;
      steps.push(
        step({
          stepId: "rename-entity",
          operation: "rename",
          beforeHash: preFingerprint,
          afterHash,
          status: "succeeded",
          recordedAt: nowIso(),
        }),
      );
      const finalJournal = yield* record("succeeded");
      yield* ledger.recordProposalDecision(request.proposal.proposalId, {
        expectedDecision: "approved",
        decision: "applied",
      });
      return {
        status: existingSteps.length > 0 ? "resumed_applied" : "applied",
        proposalId: request.proposal.proposalId,
        journal: finalJournal,
        leaseId: null,
        sourceEntityId: values.sourceEntityId,
        targetEntityId: values.targetEntityId,
        migrationDocumentIds: [],
        paperlessTasks: tasks,
        preApplyCatalogFingerprint: preFingerprint,
        postApplyCatalogFingerprint: afterHash,
      } satisfies CatalogApplyResult;
    }

    if (values.intendedAction === "delete") {
      const deleteProof = yield* Effect.either(assertDeleteVerified(pre));
      if (deleteProof._tag === "Left") {
        steps.push(
          step({
            stepId: "verify-empty-source-before-delete",
            operation: "delete",
            beforeHash: preFingerprint,
            afterHash: null,
            status: "failed",
            errorCode:
              deleteProof.left instanceof CatalogApplyConflict
                ? deleteProof.left.code
                : "POSTREAD_VERIFICATION_FAILED",
            recordedAt: nowIso(),
          }),
        );
        yield* record("conflict");
        return yield* Effect.fail(deleteProof.left);
      }
      yield* mutation.deleteEntity(kind, values.sourceEntityId);
      yield* mutation.invalidateCatalogCache();
      const deleted = yield* mutation.readEntity(kind, values.sourceEntityId);
      if (deleted?.exists) {
        steps.push(
          step({
            stepId: "verify-delete-absence",
            operation: "delete",
            beforeHash: preFingerprint,
            afterHash: hash("catalog_apply_delete_still_present", deleted),
            status: "failed",
            errorCode: "POSTREAD_VERIFICATION_FAILED",
            recordedAt: nowIso(),
          }),
        );
        yield* record("conflict");
        return yield* fail("POSTREAD_VERIFICATION_FAILED", "Deleted entity was still present");
      }
      steps.push(
        step({
          stepId: "delete-empty-source",
          operation: "delete",
          beforeHash: preFingerprint,
          afterHash: hash("catalog_apply_deleted_entity", {
            kind,
            entityId: values.sourceEntityId,
          }),
          status: "succeeded",
          recordedAt: nowIso(),
        }),
      );
      const finalJournal = yield* record("succeeded");
      yield* ledger.recordProposalDecision(request.proposal.proposalId, {
        expectedDecision: "approved",
        decision: "applied",
      });
      return {
        status: existingSteps.length > 0 ? "resumed_applied" : "applied",
        proposalId: request.proposal.proposalId,
        journal: finalJournal,
        leaseId: null,
        sourceEntityId: values.sourceEntityId,
        targetEntityId: null,
        migrationDocumentIds: [],
        paperlessTasks: tasks,
        preApplyCatalogFingerprint: preFingerprint,
        postApplyCatalogFingerprint: null,
      } satisfies CatalogApplyResult;
    }

    if (values.intendedAction !== "merge" || values.targetEntityId === null) {
      return yield* fail(
        "INVALID_PROPOSAL",
        `Unsupported catalog apply action ${values.intendedAction}`,
      );
    }

    const originalSourceIds = sortedUnique(values.evidenceDocumentIds);
    const currentSourceIds = sortedUnique(pre.source.documentIds);
    const targetBeforeIds = sortedUnique(pre.target?.documentIds ?? []);
    const expectedTargetIds = sortedUnique([...targetBeforeIds, ...originalSourceIds]);
    const batchSize = Math.max(1, Math.min(request.batchSize ?? DEFAULT_BATCH_SIZE, 100));

    for (const [index, ids] of chunk(currentSourceIds, batchSize).entries()) {
      yield* runJournaledTask({
        stepId: `migrate-${index}`,
        operation: bulkOperationForKind(kind),
        documentIds: ids,
        parameters: bulkPayloadForKind(kind, values.sourceEntityId, values.targetEntityId),
        idempotencyKey: `${request.idempotencyKey}:migrate:${index}`,
        beforeHash: pre.source.assignmentHash,
      });
    }

    yield* mutation.invalidateCatalogCache();
    const afterTargetWriteLive = yield* readLiveState(
      mutation,
      kind,
      values.sourceEntityId,
      values.targetEntityId,
    );
    const afterTargetWrite = afterTargetWriteLive.receipts;
    if (!targetCoversExpected(afterTargetWrite.target, expectedTargetIds)) {
      steps.push(
        step({
          stepId: "verify-target-coverage-before-source-removal",
          operation: "merge",
          beforeHash: preFingerprint,
          afterHash: afterTargetWriteLive.fingerprint,
          status: "failed",
          errorCode: "POSTREAD_VERIFICATION_FAILED",
          recordedAt: nowIso(),
        }),
      );
      yield* record("conflict");
      return yield* fail(
        "POSTREAD_VERIFICATION_FAILED",
        "Target coverage was not verified before source removal",
        true,
      );
    }

    yield* mutation.invalidateCatalogCache();
    const postMigrationLive = yield* readLiveState(
      mutation,
      kind,
      values.sourceEntityId,
      values.targetEntityId,
    );
    const postMigration = postMigrationLive.receipts;
    yield* assertPostMergeVerified({
      post: postMigration,
      expectedTargetDocumentIds: expectedTargetIds,
    });
    const postMigrationFingerprint = postMigrationLive.fingerprint;
    steps.push(
      step({
        stepId: "verify-before-delete",
        operation: "merge",
        beforeHash: preFingerprint,
        afterHash: postMigrationFingerprint,
        status: "succeeded",
        recordedAt: nowIso(),
      }),
    );
    yield* record("applying");

    yield* mutation.deleteEntity(kind, values.sourceEntityId);
    yield* mutation.invalidateCatalogCache();
    const deletedSource = yield* mutation.readEntity(kind, values.sourceEntityId);
    if (deletedSource?.exists) {
      steps.push(
        step({
          stepId: "verify-delete-absence",
          operation: "delete",
          beforeHash: postMigration.source.assignmentHash,
          afterHash: hash("catalog_apply_delete_still_present", deletedSource),
          status: "failed",
          errorCode: "POSTREAD_VERIFICATION_FAILED",
          recordedAt: nowIso(),
        }),
      );
      yield* record("conflict");
      return yield* fail("POSTREAD_VERIFICATION_FAILED", "Merged source entity was still present");
    }
    steps.push(
      step({
        stepId: "delete-verified-source",
        operation: "delete",
        beforeHash: postMigration.source.assignmentHash,
        afterHash: hash("catalog_apply_deleted_entity", { kind, entityId: values.sourceEntityId }),
        status: "succeeded",
        recordedAt: nowIso(),
      }),
    );
    const finalJournal = yield* record("succeeded");
    yield* ledger.recordProposalDecision(request.proposal.proposalId, {
      expectedDecision: "approved",
      decision: "applied",
    });
    return {
      status: existingSteps.length > 0 ? "resumed_applied" : "applied",
      proposalId: request.proposal.proposalId,
      journal: finalJournal,
      leaseId: null,
      sourceEntityId: values.sourceEntityId,
      targetEntityId: values.targetEntityId,
      migrationDocumentIds: originalSourceIds,
      paperlessTasks: tasks,
      preApplyCatalogFingerprint: preFingerprint,
      postApplyCatalogFingerprint: postMigrationFingerprint,
    } satisfies CatalogApplyResult;
  });

const finalStateAlreadyApplied = ({
  values,
  receipts,
}: {
  readonly values: CatalogProposalValues;
  readonly receipts: CatalogApplyReceiptSet;
}) => {
  if (values.intendedAction === "delete") return sourceIsZero(receipts.source);
  if (values.intendedAction === "merge") {
    return (
      values.targetEntityId !== null &&
      sourceIsZero(receipts.source) &&
      targetCoversExpected(receipts.target, values.evidenceDocumentIds)
    );
  }
  return false;
};

export const makeCatalogApplyService = (): CatalogApplyServiceType => ({
  applyReviewedProposal: (request) =>
    Effect.gen(function* () {
      const ledger = yield* CatalogApplyLedgerPort;
      const snapshot = yield* ledger.getSnapshot();
      const persisted = yield* persistedReviewFromSnapshot(snapshot, request);
      const { values } = persisted;
      const effectiveRequest = persisted.request;
      const id = journalIdFor(effectiveRequest.proposal.proposalId, request.idempotencyKey);
      const existing = existingJournal(snapshot, id);
      if (existing?.status === "succeeded") {
        return {
          status: "already_applied",
          proposalId: effectiveRequest.proposal.proposalId,
          journal: {
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            epochId: existing.epochId,
            idempotencyKey: request.idempotencyKey,
            status: existing.status,
            preconditions: effectiveRequest.proposal.preconditions,
            steps: existing.steps,
            createdAt: existing.createdAt,
            updatedAt: existing.updatedAt,
          },
          leaseId: null,
          sourceEntityId: values.sourceEntityId,
          targetEntityId: values.targetEntityId,
          migrationDocumentIds: values.evidenceDocumentIds,
          paperlessTasks: [],
          preApplyCatalogFingerprint: null,
          postApplyCatalogFingerprint: existing.steps.at(-1)?.afterHash ?? null,
        } satisfies CatalogApplyResult;
      }
      if (existing && finalStatusForExisting(existing.status)) {
        return yield* fail(
          "AMBIGUOUS_WRITE",
          "Existing terminal journal is not successful",
          false,
          {
            journalId: existing.journalId,
            status: existing.status,
          },
        );
      }

      const leases = yield* acquireMutationLeases({
        ledger,
        resourceIds: resourceIdsForMutation({
          kind: values.entityKind as CatalogApplySupportedKind,
          sourceEntityId: values.sourceEntityId,
          targetEntityId: values.targetEntityId,
          documentIds: values.intendedAction === "merge" ? values.evidenceDocumentIds : [],
        }),
        owner: effectiveRequest.proposal.proposalId,
        runId: id,
        ttlMs: request.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
      });
      return yield* applyWithLease({
        request: effectiveRequest,
        values,
        existingSteps: existing?.steps ?? [],
      }).pipe(
        Effect.map((result) => ({ ...result, leaseId: leases[0]?.leaseId ?? null })),
        Effect.ensuring(releaseMutationLeases(ledger, leases)),
      );
    }),

  recoverInterruptedApplies: (options: CatalogApplyRecoveryOptions = {}) =>
    Effect.gen(function* () {
      const ledger = yield* CatalogApplyLedgerPort;
      const mutation = yield* CatalogApplyMutationPort;
      const snapshot = yield* ledger.getSnapshot();
      const results: CatalogApplyRecoveryResult[] = [];
      for (const existing of Object.values(snapshot.applyJournals).sort((left, right) =>
        left.journalId.localeCompare(right.journalId),
      )) {
        if (finalStatusForExisting(existing.status)) {
          results.push({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            status: "skipped",
          });
          continue;
        }
        const proposal = snapshot.proposals[existing.proposalId];
        const chair = Object.values(snapshot.chairDecisions).find(
          (decision) => decision.proposalId === existing.proposalId,
        );
        if (!proposal || !chair || proposal.proposedValues?.scope !== "catalog") {
          results.push({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            status: "marked_conflict",
          });
          continue;
        }
        const values = proposal.proposedValues;
        if (!isSupportedKind(values.entityKind)) {
          results.push({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            status: "marked_conflict",
          });
          continue;
        }
        const recoverySteps = [...existing.steps];
        for (const running of existing.steps.filter(
          (entry) => entry.status === "running" && entry.paperlessTaskId,
        )) {
          const polled = yield* mutation.pollTask(running.paperlessTaskId ?? "", {
            timeoutMs: options.taskPollTimeoutMs,
            intervalMs: options.taskPollIntervalMs,
          });
          recoverySteps.push(
            step({
              stepId: `recovery-poll-${polled.taskId}`,
              operation: running.operation,
              paperlessTaskId: polled.taskId,
              beforeHash: running.beforeHash,
              afterHash: polled.resultHash,
              status: polled.status === "succeeded" ? "succeeded" : "failed",
              errorCode:
                polled.status === "succeeded" ? undefined : (polled.errorCode ?? "TASK_FAILED"),
              recordedAt: options.recoveredAt ?? nowIso(),
            }),
          );
        }
        yield* mutation.invalidateCatalogCache();
        const live = yield* readLiveState(
          mutation,
          values.entityKind,
          values.sourceEntityId,
          values.targetEntityId,
        );
        if (finalStateAlreadyApplied({ values, receipts: live.receipts })) {
          yield* ledger.recordApplyJournal({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            epochId: existing.epochId,
            idempotencyKey: existing.journalId,
            status: "succeeded",
            preconditions: proposal.preconditions,
            steps: [
              ...recoverySteps,
              step({
                stepId: "recovery-reread",
                operation: "describe",
                beforeHash: hash("catalog_apply_recovery", existing.preconditionHashes),
                afterHash: live.fingerprint,
                status: "succeeded",
                recordedAt: options.recoveredAt ?? nowIso(),
              }),
            ],
            createdAt: existing.createdAt,
            updatedAt: options.recoveredAt ?? nowIso(),
          });
          yield* ledger.recordProposalDecision(proposal.proposalId, {
            expectedDecision: "approved",
            decision: "applied",
          });
          results.push({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            status: "resumed_applied",
          });
          continue;
        }
        const recoveryRequest: ApplyReviewedCatalogProposalRequest = {
          proposal,
          chairDecision: chair,
          expectedProposalFingerprint: values.expectedProposalFingerprint,
          expectedEvidenceFingerprint: chair.evidenceFingerprint,
          expectedCatalogFingerprint: live.fingerprint,
          idempotencyKey: existing.journalId,
          createdAt: existing.createdAt,
          taskPollIntervalMs: options.taskPollIntervalMs,
          taskPollTimeoutMs: options.taskPollTimeoutMs,
        };
        const leases = yield* acquireMutationLeases({
          ledger,
          resourceIds: resourceIdsForMutation({
            kind: values.entityKind,
            sourceEntityId: values.sourceEntityId,
            targetEntityId: values.targetEntityId,
            documentIds: live.receipts.source.documentIds,
          }),
          owner: proposal.proposalId,
          runId: existing.journalId,
          ttlMs: DEFAULT_LEASE_TTL_MS,
        });
        const resumed = yield* Effect.either(
          applyWithLease({
            request: recoveryRequest,
            values,
            existingSteps: recoverySteps,
            journalIdOverride: existing.journalId,
          }).pipe(Effect.ensuring(releaseMutationLeases(ledger, leases))),
        );
        if (resumed._tag === "Right") {
          results.push({
            journalId: existing.journalId,
            proposalId: existing.proposalId,
            status: "resumed_applied",
          });
          continue;
        }
        yield* ledger.recordApplyJournal({
          journalId: existing.journalId,
          proposalId: existing.proposalId,
          epochId: existing.epochId,
          idempotencyKey: existing.journalId,
          status: "conflict",
          preconditions: proposal.preconditions,
          steps: [
            ...recoverySteps,
            step({
              stepId: "recovery-reread",
              operation: "describe",
              beforeHash: hash("catalog_apply_recovery", existing.preconditionHashes),
              afterHash: live.fingerprint,
              status: "failed",
              errorCode:
                resumed.left instanceof CatalogApplyConflict
                  ? resumed.left.code
                  : "AMBIGUOUS_WRITE",
              recordedAt: options.recoveredAt ?? nowIso(),
            }),
          ],
          createdAt: existing.createdAt,
          updatedAt: options.recoveredAt ?? nowIso(),
        });
        results.push({
          journalId: existing.journalId,
          proposalId: existing.proposalId,
          status: "marked_conflict",
        });
      }
      return results;
    }),
});

export const CatalogApplyService =
  Context.GenericTag<CatalogApplyServiceType>("CatalogApplyService");

export const CatalogApplyServiceLive = Layer.succeed(
  CatalogApplyService,
  makeCatalogApplyService(),
);
