import {
  type AnalysisRunState,
  type ApplyJournal,
  type CatalogState,
  type CompactChairDecisionLedgerContract,
  type CouncilReviewerRole,
  canonicalSha256,
  compareAndSetAnalysisRunState,
  compareAndSetCatalogState,
  type HashPrecondition,
  type Sha256Digest,
  type StorageLedgerEntry,
} from "@repo/api-contracts";
import { Context, Effect, Layer } from "effect";
import {
  emptyOperationalLedger,
  loadOperationalLedger,
  persistOperationalLedger,
  resolveOperationalLedgerPaths,
} from "./persistence.js";
import {
  assertAllowedLedgerEntry,
  assertNonSecretSetting,
  assertStoragePolicySafe,
  normalizeSettingValue,
  sanitizeStoredMessage,
} from "./policy.js";
import type {
  AnalysisProposalValues,
  AnalysisRunRecord,
  ApplyJournalRecord,
  ApplyJournalStepRecord,
  CatalogEpochRecord,
  CatalogProposalApplicationBlockedReason,
  CatalogProposalRiskFlag,
  CatalogProposalValues,
  CompactChairDecisionRecord,
  CompactionRecord,
  CouncilRecord,
  LeaseAcquireInput,
  LeaseAcquireResult,
  LeaseRecord,
  OperationalLedgerData,
  OperationalLedgerPaths,
  OperationalLedgerSettings,
  OperationalLedgerSettingValue,
  ProposalDecision,
  ProposalOutcome,
  ProposalRecord,
  ProviderUsageRecord,
  RandomCycleRecord,
  SanitizedFailureRecord,
} from "./types.js";
import { catalogProposalApplicationBlockedReasons, catalogProposalRiskFlags } from "./types.js";

export class OperationalLedgerError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OperationalLedgerError";
  }
}

export class OperationalLedgerConflictError extends OperationalLedgerError {
  readonly status = 409;
  constructor(
    message: string,
    readonly current: string,
    readonly expected: string,
    readonly requested: string,
  ) {
    super(message, "stateTransition");
    this.name = "OperationalLedgerConflictError";
  }
}

export interface CreateAnalysisRunInput {
  readonly runId: string;
  readonly documentId: number;
  readonly forceOcr?: boolean;
  readonly sourcePdfHash?: Sha256Digest | null;
  readonly documentStateHash: Sha256Digest;
  readonly createdAt?: string;
}

export interface CreateCatalogEpochInput {
  readonly epochId: string;
  readonly scope: readonly string[];
  readonly paperlessCatalogHash: Sha256Digest;
  readonly candidateCount?: number;
  readonly evidenceCount?: number;
  readonly proposalCount?: number;
  readonly createdAt?: string;
}

export interface RecordProposalInput {
  readonly proposalId: string;
  readonly ownerId: string;
  readonly scope: "analysis" | "catalog";
  readonly proposalHash: Sha256Digest;
  readonly proposedValues: AnalysisProposalValues | CatalogProposalValues;
  readonly valueHash?: Sha256Digest;
  readonly evidenceIds?: readonly string[];
  readonly coverage?: number | null;
  readonly rationale: string;
  readonly preconditions: readonly HashPrecondition[];
  readonly createdAt?: string;
}

export interface RecordCouncilInput {
  readonly evidenceId: string;
  readonly epochId: string;
  readonly candidateId: string;
  readonly proposalId?: string | null;
  readonly reviewer: CouncilReviewerRole;
  readonly verdict: CouncilRecord["verdict"];
  readonly evidenceDocumentIds: readonly number[];
  readonly inspectedDocuments: number;
  readonly totalDocuments: number;
  readonly xReceiptCount: number;
  readonly yReceiptCount?: number | null;
  readonly xReceiptHash: Sha256Digest;
  readonly yReceiptHash?: Sha256Digest | null;
  readonly proposalFingerprint: Sha256Digest;
  readonly evidenceFingerprint: Sha256Digest;
  readonly rationale: string;
  readonly dissent?: string | null;
  readonly createdAt?: string;
  readonly decidedAt?: string;
}

export interface RecordProposalDecisionInput {
  readonly expectedDecision: ProposalDecision;
  readonly decision: ProposalOutcome;
  readonly outcome?: ProposalOutcome | null;
  readonly decidedAt?: string;
}

export interface RecordChairDecisionInput extends CompactChairDecisionLedgerContract {}

export interface RecordFailureInput {
  readonly code: SanitizedFailureRecord["code"];
  readonly message: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly preconditions?: readonly HashPrecondition[];
  readonly failedAt?: string;
}

export interface RecordProviderUsageInput {
  readonly usageId?: string;
  readonly provider: string;
  readonly model: string;
  readonly operation: ProviderUsageRecord["operation"];
  readonly runId?: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly costMicros?: number | null;
  readonly latencyMs?: number | null;
  readonly recordedAt?: string;
}

export interface RecordRandomCycleInput {
  readonly cycleKey: string;
  readonly documentIds: readonly number[];
  readonly cursor: number;
  readonly selectedRunId?: string;
  readonly reset?: boolean;
  readonly updatedAt?: string;
}

export interface OperationalLedgerService {
  readonly paths: OperationalLedgerPaths;
  readonly getSnapshot: () => Effect.Effect<OperationalLedgerData, OperationalLedgerError>;
  readonly getSnapshotJson: () => Effect.Effect<string, OperationalLedgerError>;
  readonly setSetting: (
    key: string,
    value: OperationalLedgerSettingValue,
  ) => Effect.Effect<OperationalLedgerSettings, OperationalLedgerError>;
  readonly appendLedgerEntry: (
    entry: StorageLedgerEntry,
  ) => Effect.Effect<StorageLedgerEntry, OperationalLedgerError>;
  readonly createAnalysisRun: (
    input: CreateAnalysisRunInput,
  ) => Effect.Effect<AnalysisRunRecord, OperationalLedgerError>;
  readonly transitionAnalysisRunState: (
    runId: string,
    expected: AnalysisRunState,
    next: AnalysisRunState,
  ) => Effect.Effect<AnalysisRunRecord, OperationalLedgerError | OperationalLedgerConflictError>;
  readonly recordAnalysisFailure: (
    runId: string,
    input: RecordFailureInput,
  ) => Effect.Effect<AnalysisRunRecord, OperationalLedgerError>;
  readonly createCatalogEpoch: (
    input: CreateCatalogEpochInput,
  ) => Effect.Effect<CatalogEpochRecord, OperationalLedgerError>;
  readonly transitionCatalogEpochState: (
    epochId: string,
    expected: CatalogState,
    next: CatalogState,
  ) => Effect.Effect<CatalogEpochRecord, OperationalLedgerError | OperationalLedgerConflictError>;
  readonly recordProposal: (
    input: RecordProposalInput,
  ) => Effect.Effect<ProposalRecord, OperationalLedgerError>;
  readonly recordProposalDecision: (
    proposalId: string,
    input: RecordProposalDecisionInput,
  ) => Effect.Effect<ProposalRecord, OperationalLedgerError>;
  readonly recordCouncilVote: (
    input: RecordCouncilInput,
  ) => Effect.Effect<CouncilRecord, OperationalLedgerError>;
  readonly recordChairDecision: (
    input: RecordChairDecisionInput,
  ) => Effect.Effect<CompactChairDecisionRecord, OperationalLedgerError>;
  readonly recordApplyJournal: (
    journal: ApplyJournal,
  ) => Effect.Effect<ApplyJournal, OperationalLedgerError>;
  readonly acquireLease: (
    input: LeaseAcquireInput,
  ) => Effect.Effect<LeaseAcquireResult, OperationalLedgerError>;
  readonly heartbeatLease: (
    leaseId: string,
    runId: string,
    ttlMs?: number,
  ) => Effect.Effect<LeaseRecord | null, OperationalLedgerError>;
  readonly releaseLease: (
    leaseId: string,
    runId: string,
  ) => Effect.Effect<boolean, OperationalLedgerError>;
  readonly recordProviderUsage: (
    input: RecordProviderUsageInput,
  ) => Effect.Effect<ProviderUsageRecord, OperationalLedgerError>;
  readonly recordRandomCycle: (
    input: RecordRandomCycleInput,
  ) => Effect.Effect<RandomCycleRecord, OperationalLedgerError>;
  readonly compact: (now?: Date) => Effect.Effect<CompactionRecord, OperationalLedgerError>;
}

export const OperationalLedgerService = Context.GenericTag<OperationalLedgerService>(
  "OperationalLedgerService",
);

const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;
const terminalAnalysisStates = new Set<AnalysisRunState>([
  "succeeded",
  "failed",
  "canceled",
  "rejected",
]);
const terminalCatalogStates = new Set<CatalogState>(["applied", "failed", "canceled", "rejected"]);
const proposalDecisionTransitions = {
  undecided: ["approved", "rejected", "deferred", "canceled", "failed", "conflict"],
  approved: ["applied", "failed", "conflict", "canceled"],
  rejected: [],
  deferred: [],
  applied: [],
  failed: [],
  conflict: [],
  canceled: [],
} as const satisfies Record<ProposalDecision, readonly ProposalDecision[]>;
const councilReviewerRoles = new Set<CouncilReviewerRole>([
  "taxonomy_curator",
  "document_evidence_auditor",
  "counterexample_hunter",
]);
const councilVerdicts = new Set<CouncilRecord["verdict"]>(["support", "oppose", "abstain"]);
const chairVerdicts = new Set<CompactChairDecisionRecord["verdict"]>([
  "approve",
  "reject",
  "needs_human",
]);
const chairActions = new Set<CompactChairDecisionRecord["action"]>([
  "approve",
  "reject",
  "defer",
  "request_review",
]);

const nowIso = (): string => new Date().toISOString();
const leaseId = (scope: LeaseAcquireInput["scope"], resourceId: string | number): string =>
  `${scope}:${String(resourceId)}`;
const generatedRunId = (scope: string, resourceId: string | number): string =>
  `lease_${scope}_${String(resourceId)}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const nonNegativeInteger = (value: number | undefined): number =>
  Math.max(0, Math.floor(Number.isFinite(value ?? 0) ? (value ?? 0) : 0));
const boundedCoverage = (value: number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return Math.min(1, Math.max(0, value));
};

const normalizeRationale = (value: string): string => sanitizeStoredMessage(value).slice(0, 1_200);

const positiveInteger = (value: number): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new OperationalLedgerError(
      `Expected a positive integer, received ${String(value)}`,
      "validate",
    );
  }
  return value;
};

const assertCouncilInput = (input: RecordCouncilInput): void => {
  if (!councilReviewerRoles.has(input.reviewer)) {
    throw new OperationalLedgerError(
      `Invalid council reviewer role: ${String(input.reviewer)}`,
      "recordCouncilVote",
    );
  }
  if (!councilVerdicts.has(input.verdict)) {
    throw new OperationalLedgerError(
      `Invalid council verdict: ${String(input.verdict)}`,
      "recordCouncilVote",
    );
  }
  if (input.evidenceDocumentIds.length === 0 || input.evidenceDocumentIds.length > 250) {
    throw new OperationalLedgerError(
      "Council evidence must reference 1 to 250 documents",
      "recordCouncilVote",
    );
  }
  if (input.inspectedDocuments > input.totalDocuments) {
    throw new OperationalLedgerError(
      "Council inspected document count cannot exceed total documents",
      "recordCouncilVote",
    );
  }
};

const proposalValueHash = (values: AnalysisProposalValues | CatalogProposalValues): Sha256Digest =>
  canonicalSha256(values);

const compactProposalRecord = (record: ProposalRecord, compactedAt: string): ProposalRecord => ({
  ...record,
  proposedValues: null,
  rationale: "Compacted after retention window.",
  compactedAt,
});

const applyJournalRecord = (journal: ApplyJournal): ApplyJournalRecord => ({
  kind: "apply_journal",
  journalId: journal.journalId,
  proposalId: journal.proposalId,
  epochId: journal.epochId,
  idempotencyKeyHash: canonicalSha256(journal.idempotencyKey),
  status: journal.status,
  preconditionHashes: journal.preconditions.map((precondition) => precondition.digest),
  steps: journal.steps.map(
    (step): ApplyJournalStepRecord => ({
      stepId: step.stepId,
      operation: step.operation,
      paperlessTaskId: step.paperlessTaskId,
      beforeHash: step.beforeHash,
      afterHash: step.afterHash,
      status: step.status,
      errorCode: step.errorCode,
      recordedAt: step.recordedAt,
    }),
  ),
  stepCount: journal.steps.length,
  createdAt: journal.createdAt,
  updatedAt: journal.updatedAt,
  compactedAt: null,
});

const compactApplyJournalRecord = (
  record: ApplyJournalRecord,
  compactedAt: string,
): ApplyJournalRecord => ({
  ...record,
  steps: [],
  compactedAt,
});

const uniqueStrings = (
  values: readonly string[],
  operation: string,
  label: string,
): readonly string[] => {
  if (values.length === 0) {
    throw new OperationalLedgerError(`${label} must not be empty`, operation);
  }
  if (new Set(values).size !== values.length) {
    throw new OperationalLedgerError(`${label} must be unique`, operation);
  }
  return [...values];
};

const sortedUniqueEnumStrings = <T extends string>(
  values: readonly string[],
  allowed: ReadonlySet<T>,
  operation: string,
  label: string,
): readonly T[] => {
  const sorted = [...new Set(values)].sort();
  const invalid = sorted.find((value) => !allowed.has(value as T));
  if (invalid) {
    throw new OperationalLedgerError(`Invalid ${label}: ${invalid}`, operation);
  }
  return sorted as unknown as readonly T[];
};

const catalogProposalRiskFlagSet = new Set<CatalogProposalRiskFlag>(catalogProposalRiskFlags);
const catalogProposalApplicationBlockedReasonSet = new Set<CatalogProposalApplicationBlockedReason>(
  catalogProposalApplicationBlockedReasons,
);

const normalizeCatalogProposalValues = (values: CatalogProposalValues): CatalogProposalValues => {
  if (typeof values.requiresHumanReview !== "boolean") {
    throw new OperationalLedgerError(
      "Catalog proposal requiresHumanReview must be boolean",
      "recordProposal",
    );
  }
  return {
    ...values,
    candidateRiskFlags: sortedUniqueEnumStrings(
      values.candidateRiskFlags,
      catalogProposalRiskFlagSet,
      "recordProposal",
      "catalog candidate risk flag",
    ),
    coverageRiskFlags: sortedUniqueEnumStrings(
      values.coverageRiskFlags,
      catalogProposalRiskFlagSet,
      "recordProposal",
      "catalog coverage risk flag",
    ),
    requiresHumanReview: values.requiresHumanReview,
    applicationBlockedReasons: sortedUniqueEnumStrings(
      values.applicationBlockedReasons,
      catalogProposalApplicationBlockedReasonSet,
      "recordProposal",
      "catalog application blocked reason",
    ),
  };
};

const normalizeProposalValues = (
  values: AnalysisProposalValues | CatalogProposalValues,
): AnalysisProposalValues | CatalogProposalValues =>
  values.scope === "catalog" ? normalizeCatalogProposalValues(values) : values;

const assertChairDecisionInput = (input: RecordChairDecisionInput): void => {
  if (!chairVerdicts.has(input.verdict)) {
    throw new OperationalLedgerError(
      `Invalid chair verdict: ${String(input.verdict)}`,
      "recordChairDecision",
    );
  }
  if (!chairActions.has(input.action)) {
    throw new OperationalLedgerError(
      `Invalid chair action: ${String(input.action)}`,
      "recordChairDecision",
    );
  }
  positiveInteger(input.sourceEntityId);
  if (input.targetEntityId !== null) positiveInteger(input.targetEntityId);
  if (input.sourceEntityId === input.targetEntityId) {
    throw new OperationalLedgerError(
      "Chair source and target entity ids must be directional and distinct",
      "recordChairDecision",
    );
  }
  if (input.confidence < 0 || input.confidence > 1) {
    throw new OperationalLedgerError(
      "Chair confidence must be between 0 and 1",
      "recordChairDecision",
    );
  }
  if (input.coverageCount > input.inspectedDocumentCount) {
    throw new OperationalLedgerError(
      "Chair coverage count cannot exceed inspected document count",
      "recordChairDecision",
    );
  }
  if (input.inspectedDocumentCount > input.totalDocumentCount) {
    throw new OperationalLedgerError(
      "Chair inspected document count cannot exceed total document count",
      "recordChairDecision",
    );
  }
};

const chairDecisionRecord = (input: RecordChairDecisionInput): CompactChairDecisionRecord => {
  assertChairDecisionInput(input);
  return {
    kind: "compact_chair_decision",
    epochId: input.epochId,
    candidateIds: uniqueStrings(input.candidateIds, "recordChairDecision", "Chair candidate ids"),
    proposalId: input.proposalId,
    verdict: input.verdict,
    action: input.action,
    sourceEntityId: input.sourceEntityId,
    targetEntityId: input.targetEntityId,
    rationale: normalizeRationale(input.rationale),
    dissent: input.dissent ? normalizeRationale(input.dissent) : null,
    evidenceIds: uniqueStrings(input.evidenceIds, "recordChairDecision", "Chair evidence ids"),
    confidence: boundedCoverage(input.confidence) ?? 0,
    proposalFingerprint: input.proposalFingerprint,
    evidenceFingerprint: input.evidenceFingerprint,
    coverageHash: input.coverageHash,
    coverageCount: nonNegativeInteger(input.coverageCount),
    inspectedDocumentCount: nonNegativeInteger(input.inspectedDocumentCount),
    totalDocumentCount: positiveInteger(input.totalDocumentCount),
    createdAt: input.createdAt,
    decidedAt: input.decidedAt,
  };
};

const chairReplayFingerprint = (record: CompactChairDecisionRecord): Sha256Digest =>
  canonicalSha256({
    epochId: record.epochId,
    candidateIds: record.candidateIds,
    proposalId: record.proposalId,
    verdict: record.verdict,
    action: record.action,
    sourceEntityId: record.sourceEntityId,
    targetEntityId: record.targetEntityId,
    rationale: record.rationale,
    dissent: record.dissent,
    evidenceIds: record.evidenceIds,
    confidence: record.confidence,
    proposalFingerprint: record.proposalFingerprint,
    evidenceFingerprint: record.evidenceFingerprint,
    coverageHash: record.coverageHash,
    coverageCount: record.coverageCount,
    inspectedDocumentCount: record.inspectedDocumentCount,
    totalDocumentCount: record.totalDocumentCount,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
  });

const chairDecisionConflicts = (
  existing: CompactChairDecisionRecord,
  next: CompactChairDecisionRecord,
): boolean => chairReplayFingerprint(existing) !== chairReplayFingerprint(next);

const ledgerEntry = (entry: StorageLedgerEntry): StorageLedgerEntry =>
  assertAllowedLedgerEntry(entry);

const addEntry = (
  data: OperationalLedgerData,
  entry: StorageLedgerEntry,
): OperationalLedgerData => ({
  ...data,
  ledgerEntries: [...data.ledgerEntries, ledgerEntry(entry)],
});

const completedBefore = (
  record: { readonly completedAt: string | null },
  cutoffMs: number,
): boolean => record.completedAt !== null && Date.parse(record.completedAt) < cutoffMs;

const recordTimestampBefore = (
  record: {
    readonly recordedAt?: string;
    readonly createdAt?: string;
    readonly updatedAt?: string;
  },
  cutoffMs: number,
): boolean => {
  const timestamp = record.recordedAt ?? record.createdAt ?? record.updatedAt;
  return typeof timestamp === "string" && Date.parse(timestamp) < cutoffMs;
};

export const makeOperationalLedgerService = (
  paths = resolveOperationalLedgerPaths(),
): Effect.Effect<OperationalLedgerService, OperationalLedgerError> =>
  Effect.gen(function* () {
    let data = yield* Effect.try({
      try: () => loadOperationalLedger(paths),
      catch: (error) =>
        new OperationalLedgerError(
          `Failed to load operational ledger: ${String(error)}`,
          "load",
          error,
        ),
    });
    const mutex = yield* Effect.makeSemaphore(1);

    const mutate = <A>(
      operation: string,
      apply: (current: OperationalLedgerData) => {
        readonly data: OperationalLedgerData;
        readonly value: A;
      },
    ): Effect.Effect<A, OperationalLedgerError> =>
      mutex.withPermits(1)(
        Effect.try({
          try: () => {
            const applied = apply(data);
            const updated: OperationalLedgerData = {
              ...applied.data,
              updatedAt: nowIso(),
            };
            assertStoragePolicySafe(updated);
            persistOperationalLedger(updated, paths);
            data = updated;
            return applied.value;
          },
          catch: (error) =>
            error instanceof OperationalLedgerError
              ? error
              : new OperationalLedgerError(
                  `Operational ledger mutation failed during ${operation}: ${String(error)}`,
                  operation,
                  error,
                ),
        }),
      );

    const requireRun = (current: OperationalLedgerData, runId: string): AnalysisRunRecord => {
      const run = current.analysisRuns[runId];
      if (!run)
        throw new OperationalLedgerError(`Analysis run not found: ${runId}`, "getAnalysisRun");
      return run;
    };

    const requireEpoch = (current: OperationalLedgerData, epochId: string): CatalogEpochRecord => {
      const epoch = current.catalogEpochs[epochId];
      if (!epoch)
        throw new OperationalLedgerError(`Catalog epoch not found: ${epochId}`, "getCatalogEpoch");
      return epoch;
    };

    return {
      paths,

      getSnapshot: () =>
        mutex.withPermits(1)(
          Effect.try({
            try: () => JSON.parse(JSON.stringify(data)) as OperationalLedgerData,
            catch: (error) =>
              new OperationalLedgerError(
                `Failed to clone operational ledger: ${String(error)}`,
                "getSnapshot",
                error,
              ),
          }),
        ),

      getSnapshotJson: () =>
        mutex.withPermits(1)(
          Effect.try({
            try: () => `${JSON.stringify(data, null, 2)}\n`,
            catch: (error) =>
              new OperationalLedgerError(
                `Failed to serialize operational ledger: ${String(error)}`,
                "getSnapshotJson",
                error,
              ),
          }),
        ),

      setSetting: (key, value) =>
        mutate("setSetting", (current) => {
          const settingKey = assertNonSecretSetting(key, value);
          const settingValue = normalizeSettingValue(settingKey, value);
          const settings: OperationalLedgerSettings = {
            ...current.settings,
            retentionDays:
              settingKey === "retentionDays" && typeof settingValue === "number"
                ? Math.max(1, Math.floor(settingValue))
                : current.settings.retentionDays,
            updatedAt: nowIso(),
            values: { ...current.settings.values, [settingKey]: settingValue },
          };
          const next = addEntry(
            { ...current, settings },
            {
              kind: "settings",
              timestamp: settings.updatedAt,
              valueHash: canonicalSha256({ key: settingKey, value: settingValue }),
            },
          );
          return { data: next, value: settings };
        }),

      appendLedgerEntry: (entry) =>
        mutate("appendLedgerEntry", (current) => {
          const cleanEntry = ledgerEntry(entry);
          return {
            data: { ...current, ledgerEntries: [...current.ledgerEntries, cleanEntry] },
            value: cleanEntry,
          };
        }),

      createAnalysisRun: (input) =>
        mutate("createAnalysisRun", (current) => {
          assertStoragePolicySafe(input);
          const createdAt = input.createdAt ?? nowIso();
          const run: AnalysisRunRecord = {
            kind: "ids_hashes_state",
            runId: input.runId,
            documentId: input.documentId,
            forceOcr: input.forceOcr ?? false,
            state: "queued",
            sourcePdfHash: input.sourcePdfHash ?? null,
            documentStateHash: input.documentStateHash,
            proposalIds: [],
            retryCount: 0,
            failure: null,
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
          };
          const next = addEntry(
            { ...current, analysisRuns: { ...current.analysisRuns, [run.runId]: run } },
            {
              kind: "ids_hashes_state",
              runId: run.runId,
              state: run.state,
              timestamp: createdAt,
              hashes: [run.documentStateHash, ...(run.sourcePdfHash ? [run.sourcePdfHash] : [])],
            },
          );
          return { data: next, value: run };
        }),

      transitionAnalysisRunState: (runId, expected, nextState) =>
        mutate("transitionAnalysisRunState", (current) => {
          const run = requireRun(current, runId);
          const result = compareAndSetAnalysisRunState(run.state, expected, nextState);
          if (!result.ok) {
            throw new OperationalLedgerConflictError(
              result.error.message,
              result.error.current,
              result.error.expected,
              result.error.requested,
            );
          }
          const updatedAt = nowIso();
          const updated: AnalysisRunRecord = {
            ...run,
            state: result.state,
            retryCount: result.state === "retrying" ? run.retryCount + 1 : run.retryCount,
            updatedAt,
            completedAt: terminalAnalysisStates.has(result.state) ? updatedAt : run.completedAt,
          };
          const next = addEntry(
            { ...current, analysisRuns: { ...current.analysisRuns, [runId]: updated } },
            {
              kind: "state_journal",
              runId,
              state: result.state,
              timestamp: updatedAt,
              hashes: [updated.documentStateHash],
            },
          );
          return { data: next, value: updated };
        }),

      recordAnalysisFailure: (runId, input) =>
        mutate("recordAnalysisFailure", (current) => {
          const run = requireRun(current, runId);
          assertStoragePolicySafe(input);
          const failedAt = input.failedAt ?? nowIso();
          const failure: SanitizedFailureRecord = {
            kind: "sanitized_failure",
            code: input.code,
            message: sanitizeStoredMessage(input.message),
            failedAt,
            retryable: input.retryable,
            provider: input.provider,
            preconditionHashes: input.preconditions?.map((precondition) => precondition.digest),
          };
          const updated: AnalysisRunRecord = { ...run, failure, updatedAt: failedAt };
          const next = addEntry(
            { ...current, analysisRuns: { ...current.analysisRuns, [runId]: updated } },
            {
              kind: "sanitized_failure",
              runId,
              timestamp: failedAt,
              hashes: failure.preconditionHashes,
              rationale: failure.message,
            },
          );
          return { data: next, value: updated };
        }),

      createCatalogEpoch: (input) =>
        mutate("createCatalogEpoch", (current) => {
          assertStoragePolicySafe(input);
          const createdAt = input.createdAt ?? nowIso();
          const epoch: CatalogEpochRecord = {
            kind: "ids_hashes_state",
            epochId: input.epochId,
            state: "queued",
            scope: input.scope,
            paperlessCatalogHash: input.paperlessCatalogHash,
            candidateCount: nonNegativeInteger(input.candidateCount),
            evidenceCount: nonNegativeInteger(input.evidenceCount),
            proposalCount: nonNegativeInteger(input.proposalCount),
            retryCount: 0,
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
          };
          const next = addEntry(
            { ...current, catalogEpochs: { ...current.catalogEpochs, [epoch.epochId]: epoch } },
            {
              kind: "ids_hashes_state",
              state: epoch.state,
              timestamp: createdAt,
              hashes: [epoch.paperlessCatalogHash],
            },
          );
          return { data: next, value: epoch };
        }),

      transitionCatalogEpochState: (epochId, expected, nextState) =>
        mutate("transitionCatalogEpochState", (current) => {
          const epoch = requireEpoch(current, epochId);
          const result = compareAndSetCatalogState(epoch.state, expected, nextState);
          if (!result.ok) {
            throw new OperationalLedgerConflictError(
              result.error.message,
              result.error.current,
              result.error.expected,
              result.error.requested,
            );
          }
          const updatedAt = nowIso();
          const updated: CatalogEpochRecord = {
            ...epoch,
            state: result.state,
            updatedAt,
            completedAt: terminalCatalogStates.has(result.state) ? updatedAt : epoch.completedAt,
          };
          const next = addEntry(
            { ...current, catalogEpochs: { ...current.catalogEpochs, [epochId]: updated } },
            {
              kind: "state_journal",
              state: result.state,
              timestamp: updatedAt,
              hashes: [updated.paperlessCatalogHash],
            },
          );
          return { data: next, value: updated };
        }),

      recordProposal: (input) =>
        mutate("recordProposal", (current) => {
          const proposedValues = normalizeProposalValues(input.proposedValues);
          assertStoragePolicySafe({ ...input, proposedValues });
          if (input.scope !== proposedValues.scope) {
            throw new OperationalLedgerError(
              `Proposal value scope mismatch: ${input.scope} != ${proposedValues.scope}`,
              "recordProposal",
            );
          }
          const createdAt = input.createdAt ?? nowIso();
          const valueHash = input.valueHash ?? proposalValueHash(proposedValues);
          const record: ProposalRecord = {
            kind:
              input.scope === "analysis"
                ? "undecided_analysis_proposal_values"
                : "undecided_catalog_proposal_values",
            scope: input.scope,
            proposalId: input.proposalId,
            ownerId: input.ownerId,
            proposalHash: input.proposalHash,
            valueHash,
            proposedValues,
            evidenceIds: input.evidenceIds ?? [],
            coverage: boundedCoverage(input.coverage),
            rationale: normalizeRationale(input.rationale),
            preconditions: input.preconditions,
            decision: "undecided",
            outcome: null,
            createdAt,
            decidedAt: null,
            compactedAt: null,
          };
          const analysisRun = current.analysisRuns[input.ownerId];
          const analysisRuns = analysisRun
            ? {
                ...current.analysisRuns,
                [input.ownerId]: {
                  ...analysisRun,
                  proposalIds: [...analysisRun.proposalIds, input.proposalId],
                  updatedAt: createdAt,
                },
              }
            : current.analysisRuns;
          const next = addEntry(
            {
              ...current,
              analysisRuns,
              proposals: { ...current.proposals, [record.proposalId]: record },
            },
            {
              kind: record.kind,
              runId: input.scope === "analysis" ? input.ownerId : undefined,
              proposalId: record.proposalId,
              timestamp: createdAt,
              hashes: [
                record.proposalHash,
                ...record.preconditions.map((precondition) => precondition.digest),
              ],
              evidenceIds: record.evidenceIds,
              coverage: record.coverage ?? undefined,
              valueHash: record.valueHash,
              rationale: record.rationale,
            },
          );
          return { data: next, value: record };
        }),

      recordProposalDecision: (proposalId, input) =>
        mutate("recordProposalDecision", (current) => {
          assertStoragePolicySafe(input);
          const proposal = current.proposals[proposalId];
          if (!proposal) {
            throw new OperationalLedgerError(
              `Proposal not found: ${proposalId}`,
              "recordProposalDecision",
            );
          }
          if (proposal.decision !== input.expectedDecision) {
            throw new OperationalLedgerConflictError(
              `Proposal decision compare-and-set failed: expected ${input.expectedDecision}, found ${proposal.decision}.`,
              proposal.decision,
              input.expectedDecision,
              input.decision,
            );
          }
          const allowedTransitions = proposalDecisionTransitions[
            proposal.decision
          ] as readonly ProposalDecision[];
          if (!allowedTransitions.includes(input.decision)) {
            throw new OperationalLedgerConflictError(
              `Illegal proposal decision transition from ${proposal.decision} to ${input.decision}.`,
              proposal.decision,
              input.expectedDecision,
              input.decision,
            );
          }
          const decidedAt = input.decidedAt ?? nowIso();
          const updated: ProposalRecord = {
            ...proposal,
            decision: input.decision,
            outcome: input.outcome ?? input.decision,
            decidedAt,
          };
          const next = addEntry(
            {
              ...current,
              proposals: { ...current.proposals, [proposalId]: updated },
            },
            {
              kind: "human_decision",
              proposalId,
              state: updated.outcome ?? updated.decision,
              timestamp: decidedAt,
              hashes: [updated.proposalHash, updated.valueHash],
            },
          );
          return { data: next, value: updated };
        }),

      recordCouncilVote: (input) =>
        mutate("recordCouncilVote", (current) => {
          assertStoragePolicySafe(input);
          assertCouncilInput(input);
          const createdAt = input.createdAt ?? nowIso();
          const decidedAt = input.decidedAt ?? createdAt;
          const inspectedDocuments = nonNegativeInteger(input.inspectedDocuments);
          const totalDocuments = positiveInteger(input.totalDocuments);
          const evidenceDocumentIds = [...input.evidenceDocumentIds];
          const record: CouncilRecord = {
            kind: "compact_council_vote",
            evidenceId: input.evidenceId,
            epochId: input.epochId,
            candidateId: input.candidateId,
            proposalId: input.proposalId ?? null,
            reviewer: input.reviewer,
            verdict: input.verdict,
            evidenceDocumentIds,
            inspectedDocuments,
            totalDocuments,
            coverage: totalDocuments === 0 ? 0 : inspectedDocuments / totalDocuments,
            coverageHash: canonicalSha256({
              evidenceDocumentIds: evidenceDocumentIds.sort((left, right) => left - right),
              inspectedDocuments,
              totalDocuments,
            }),
            xReceiptCount: nonNegativeInteger(input.xReceiptCount),
            yReceiptCount:
              input.yReceiptCount === null || input.yReceiptCount === undefined
                ? null
                : nonNegativeInteger(input.yReceiptCount),
            xReceiptHash: input.xReceiptHash,
            yReceiptHash: input.yReceiptHash ?? null,
            proposalFingerprint: input.proposalFingerprint,
            evidenceFingerprint: input.evidenceFingerprint,
            rationale: normalizeRationale(input.rationale),
            dissent: input.dissent ? normalizeRationale(input.dissent) : null,
            createdAt,
            decidedAt,
          };
          const next = addEntry(
            {
              ...current,
              councilRecords: { ...current.councilRecords, [record.evidenceId]: record },
            },
            {
              kind: "compact_council_vote",
              timestamp: createdAt,
              hashes: [
                record.proposalFingerprint,
                record.evidenceFingerprint,
                record.coverageHash,
                record.xReceiptHash,
                ...(record.yReceiptHash ? [record.yReceiptHash] : []),
              ],
              evidenceIds: [record.evidenceId, ...record.evidenceDocumentIds.map(String)],
              coverage: record.coverage,
              rationale: record.rationale,
            },
          );
          return { data: next, value: record };
        }),

      recordChairDecision: (input) =>
        mutate("recordChairDecision", (current) => {
          assertStoragePolicySafe(input);
          const record = chairDecisionRecord(input);
          const existing = current.chairDecisions[record.proposalId];
          if (existing) {
            if (chairDecisionConflicts(existing, record)) {
              throw new OperationalLedgerError(
                `Conflicting chair decision for proposal: ${record.proposalId}`,
                "recordChairDecision",
              );
            }
            return { data: current, value: existing };
          }

          const candidateSet = new Set(record.candidateIds);
          const conflictingLink = Object.values(current.chairDecisions).find(
            (decision) =>
              decision.proposalId !== record.proposalId &&
              decision.candidateIds.some((candidateId) => candidateSet.has(candidateId)),
          );
          if (conflictingLink) {
            throw new OperationalLedgerError(
              `Chair candidate already linked to proposal: ${conflictingLink.proposalId}`,
              "recordChairDecision",
            );
          }

          const next = addEntry(
            {
              ...current,
              chairDecisions: {
                ...current.chairDecisions,
                [record.proposalId]: record,
              },
            },
            {
              kind: "compact_chair_decision",
              proposalId: record.proposalId,
              state: record.action,
              timestamp: record.decidedAt,
              hashes: [record.proposalFingerprint, record.evidenceFingerprint, record.coverageHash],
              evidenceIds: record.evidenceIds,
              coverage: record.confidence,
              rationale: record.rationale,
              valueHash: chairReplayFingerprint(record),
            },
          );
          return { data: next, value: record };
        }),

      recordApplyJournal: (journal) =>
        mutate("recordApplyJournal", (current) => {
          assertStoragePolicySafe(journal);
          const record = applyJournalRecord(journal);
          const next = addEntry(
            {
              ...current,
              applyJournals: { ...current.applyJournals, [record.journalId]: record },
            },
            {
              kind: "apply_journal",
              proposalId: record.proposalId,
              state: record.status,
              timestamp: record.updatedAt,
              hashes: record.preconditionHashes,
            },
          );
          return { data: next, value: journal };
        }),

      acquireLease: (input) =>
        mutate<LeaseAcquireResult>("acquireLease", (current) => {
          assertStoragePolicySafe(input);
          const id = leaseId(input.scope, input.resourceId);
          const existing = current.leases[id];
          const nowMs = Date.now();
          const existingExpiry = existing ? Date.parse(existing.expiresAt) : Number.NaN;
          if (existing && Number.isFinite(existingExpiry) && existingExpiry > nowMs) {
            return {
              data: current,
              value: { acquired: false, lease: existing, staleRecovered: false },
            };
          }
          const timestamp = new Date(nowMs).toISOString();
          const lease: LeaseRecord = {
            kind: "lease_record",
            leaseId: id,
            scope: input.scope,
            resourceId: String(input.resourceId),
            owner: input.owner,
            runId: input.runId ?? generatedRunId(input.scope, input.resourceId),
            acquiredAt: timestamp,
            heartbeatAt: timestamp,
            expiresAt: new Date(nowMs + (input.ttlMs ?? DEFAULT_LEASE_TTL_MS)).toISOString(),
          };
          const next = addEntry(
            { ...current, leases: { ...current.leases, [id]: lease } },
            {
              kind: "lease_record",
              runId: lease.runId,
              timestamp,
              valueHash: canonicalSha256({
                leaseId: id,
                owner: lease.owner,
                expiresAt: lease.expiresAt,
              }),
            },
          );
          return {
            data: next,
            value: { acquired: true, lease, staleRecovered: existing !== undefined },
          };
        }),

      heartbeatLease: (id, runId, ttlMs) =>
        mutate("heartbeatLease", (current) => {
          const existing = current.leases[id];
          if (!existing || existing.runId !== runId) return { data: current, value: null };
          const nowMs = Date.now();
          const heartbeatAt = new Date(nowMs).toISOString();
          const lease: LeaseRecord = {
            ...existing,
            heartbeatAt,
            expiresAt: new Date(nowMs + (ttlMs ?? DEFAULT_LEASE_TTL_MS)).toISOString(),
          };
          const next = addEntry(
            { ...current, leases: { ...current.leases, [id]: lease } },
            {
              kind: "lease_record",
              runId,
              timestamp: heartbeatAt,
              valueHash: canonicalSha256({ leaseId: id, heartbeatAt }),
            },
          );
          return { data: next, value: lease };
        }),

      releaseLease: (id, runId) =>
        mutate("releaseLease", (current) => {
          const existing = current.leases[id];
          if (!existing || existing.runId !== runId) return { data: current, value: false };
          const leases = { ...current.leases };
          delete leases[id];
          const next = addEntry(
            { ...current, leases },
            {
              kind: "lease_record",
              runId,
              timestamp: nowIso(),
              valueHash: canonicalSha256({ leaseId: id, released: true }),
            },
          );
          return { data: next, value: true };
        }),

      recordProviderUsage: (input) =>
        mutate("recordProviderUsage", (current) => {
          assertStoragePolicySafe(input);
          const recordedAt = input.recordedAt ?? nowIso();
          const promptTokens = nonNegativeInteger(input.promptTokens);
          const completionTokens = nonNegativeInteger(input.completionTokens);
          const record: ProviderUsageRecord = {
            kind: "usage_record",
            usageId:
              input.usageId ?? `usage_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            provider: input.provider,
            model: input.model,
            operation: input.operation,
            runId: input.runId,
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
            costMicros:
              input.costMicros === null || input.costMicros === undefined
                ? null
                : nonNegativeInteger(input.costMicros),
            latencyMs:
              input.latencyMs === null || input.latencyMs === undefined
                ? null
                : nonNegativeInteger(input.latencyMs),
            recordedAt,
          };
          const next = addEntry(
            { ...current, providerUsage: [...current.providerUsage, record] },
            {
              kind: "usage_record",
              runId: record.runId,
              timestamp: recordedAt,
              valueHash: canonicalSha256(record),
            },
          );
          return { data: next, value: record };
        }),

      recordRandomCycle: (input) =>
        mutate("recordRandomCycle", (current) => {
          assertStoragePolicySafe(input);
          const updatedAt = input.updatedAt ?? nowIso();
          const existing = current.randomCycles[input.cycleKey];
          const record: RandomCycleRecord = {
            kind: "random_cycle_state",
            cycleKey: input.cycleKey,
            documentIdHashes: input.documentIds.map((documentId) =>
              canonicalSha256({ cycleKey: input.cycleKey, documentId }),
            ),
            cursor: Math.max(0, Math.floor(input.cursor)),
            selectedRunIds: input.selectedRunId
              ? [...(existing?.selectedRunIds ?? []), input.selectedRunId]
              : (existing?.selectedRunIds ?? []),
            resetCount: (existing?.resetCount ?? 0) + (input.reset ? 1 : 0),
            updatedAt,
          };
          const next = addEntry(
            { ...current, randomCycles: { ...current.randomCycles, [record.cycleKey]: record } },
            {
              kind: "random_cycle_state",
              runId: input.selectedRunId,
              timestamp: updatedAt,
              hashes: record.documentIdHashes,
              valueHash: canonicalSha256(record),
            },
          );
          return { data: next, value: record };
        }),

      compact: (now = new Date()) =>
        mutate("compact", (current) => {
          const cutoffMs = now.getTime() - current.settings.retentionDays * 24 * 60 * 60 * 1000;
          const cutoff = new Date(cutoffMs).toISOString();
          const compactedAt = now.toISOString();
          const ledgerEntries = current.ledgerEntries.filter(
            (entry) => Date.parse(entry.timestamp) >= cutoffMs,
          );
          const providerUsage = current.providerUsage.filter(
            (record) => Date.parse(record.recordedAt) >= cutoffMs,
          );

          const analysisRuns = Object.fromEntries(
            Object.entries(current.analysisRuns).filter(
              ([, record]) => !completedBefore(record, cutoffMs),
            ),
          );
          const catalogEpochs = Object.fromEntries(
            Object.entries(current.catalogEpochs).filter(
              ([, record]) => !completedBefore(record, cutoffMs),
            ),
          );
          let compactedProposals = 0;
          const proposals = Object.fromEntries(
            Object.entries(current.proposals).map(([id, record]) => {
              const decisionTimestamp = record.decidedAt
                ? Date.parse(record.decidedAt)
                : Number.NaN;
              if (
                record.outcome !== null &&
                Number.isFinite(decisionTimestamp) &&
                decisionTimestamp < cutoffMs &&
                record.proposedValues !== null
              ) {
                compactedProposals += 1;
                return [id, compactProposalRecord(record, compactedAt)];
              }
              return [id, record];
            }),
          );
          const councilRecords = Object.fromEntries(
            Object.entries(current.councilRecords).filter(
              ([, record]) => !recordTimestampBefore(record, cutoffMs),
            ),
          );
          let compactedApplyJournals = 0;
          const applyJournals = Object.fromEntries(
            Object.entries(current.applyJournals).map(([id, record]) => {
              if (Date.parse(record.updatedAt) < cutoffMs && record.steps.length > 0) {
                compactedApplyJournals += 1;
                return [id, compactApplyJournalRecord(record, compactedAt)];
              }
              return [id, record];
            }),
          );

          const compaction: CompactionRecord = {
            kind: "coverage_summary",
            compactionId: `compact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            cutoff,
            compactedAt,
            removedLedgerEntries: current.ledgerEntries.length - ledgerEntries.length,
            removedProviderUsage: current.providerUsage.length - providerUsage.length,
            removedRuns:
              Object.keys(current.analysisRuns).length - Object.keys(analysisRuns).length,
            removedCatalogEpochs:
              Object.keys(current.catalogEpochs).length - Object.keys(catalogEpochs).length,
            removedProposals: Object.keys(current.proposals).length - Object.keys(proposals).length,
            removedCouncilRecords:
              Object.keys(current.councilRecords).length - Object.keys(councilRecords).length,
            removedApplyJournals:
              Object.keys(current.applyJournals).length - Object.keys(applyJournals).length,
            compactedProposals,
            compactedApplyJournals,
          };

          const next = addEntry(
            {
              ...current,
              ledgerEntries,
              providerUsage,
              analysisRuns,
              catalogEpochs,
              proposals,
              councilRecords,
              applyJournals,
              compactions: [...current.compactions, compaction],
            },
            {
              kind: "coverage_summary",
              timestamp: compactedAt,
              coverage: 1,
              valueHash: canonicalSha256(compaction),
            },
          );
          return { data: next, value: compaction };
        }),
    };
  });

export const OperationalLedgerServiceLive = Layer.effect(
  OperationalLedgerService,
  makeOperationalLedgerService(),
);

export const makeEmptyOperationalLedger = emptyOperationalLedger;
