import {
  canonicalSha256,
  type Sha256Digest,
  type StorageLedgerEntry,
  sourcePdfHash,
} from "@repo/api-contracts";
import { Context, Deferred, Duration, Effect, Fiber, Layer, Ref } from "effect";
import { OperationalLedgerService } from "../OperationalLedgerService.js";
import { PaperlessService } from "../PaperlessService.js";
import { classifyFailure, sanitizeFailureMessage } from "./errors.js";
import {
  DocumentAnalysisOrchestrator,
  type DocumentAnalysisRunOutcome,
  type RecoverInterruptedAppliesOptions,
} from "./orchestrator.js";

const SCANNER_SCHEMA_VERSION = "d2.ai-analyse-automation-scanner.v2" as const;
const SCANNER_LEASE_RESOURCE = "ai-analyse-automation-scanner";
const SCANNER_RUN_ID_PREFIX = "ana_auto_";
const SCANNER_STATE_PREFIX = "ai_analyse_scanner:";
const SCANNER_RETRY_STATE = "ai_analyse_scanner:human_retry";
const DOCUMENT_EVIDENCE_PREFIX = "d2.ai-analyse.document:";
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LEASE_TTL_MS = 15 * 60 * 1000;

export type AiAnalyseAttemptStatus =
  | "processing"
  | "succeeded"
  | "awaiting_review"
  | "paused_failure"
  | "canceled";

export interface AiAnalyseAutomationScannerOptions extends RecoverInterruptedAppliesOptions {
  readonly enabled: boolean;
  readonly scope?: "disabled" | "canary" | "all";
  readonly canaryDocumentIds?: readonly number[];
  readonly aiAnalyseTagId: number;
  readonly transientTagIds?: readonly number[];
  readonly forceOcr?: boolean;
  readonly intervalMs?: number;
  readonly leaseTtlMs?: number;
}

export interface AiAnalyseAttemptRecord {
  readonly documentId: number;
  readonly runId: string;
  readonly runKey: Sha256Digest;
  readonly triggerRevision: Sha256Digest;
  readonly sourceConfigHash: Sha256Digest;
  readonly sourceHash: Sha256Digest;
  readonly configHash: Sha256Digest;
  readonly status: AiAnalyseAttemptStatus;
  readonly failureMessage: string | null;
  readonly retryRequestedAt: string | null;
  readonly updatedAt: string;
}

export interface AiAnalyseDocumentResult {
  readonly documentId: number;
  readonly runId: string | null;
  readonly status:
    | "applied"
    | "awaiting_review"
    | "paused_failure"
    | "deduped"
    | "not_triggered"
    | "canceled";
  readonly reason: string | null;
}

export interface AiAnalyseScanResult {
  readonly status: "disabled" | "busy" | "completed" | "canceled";
  readonly scannedPages: number;
  readonly candidateCount: number;
  readonly processedCount: number;
  readonly results: readonly AiAnalyseDocumentResult[];
}

export interface AiAnalyseAutomationStatus {
  readonly running: boolean;
  readonly enabled: boolean;
  readonly currentDocumentId: number | null;
  readonly lastScanAt: string | null;
}

export interface AiAnalyseAutomationScanner {
  readonly scanOnce: () => Effect.Effect<AiAnalyseScanResult, never>;
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => Effect.Effect<void, never>;
  readonly trigger: () => Effect.Effect<void, never>;
  readonly getStatus: () => Effect.Effect<AiAnalyseAutomationStatus, never>;
  readonly requestHumanRetry: (
    documentId: number,
  ) => Effect.Effect<AiAnalyseAttemptRecord | null, never>;
}

export const AiAnalyseAutomationScanner = Context.GenericTag<AiAnalyseAutomationScanner>(
  "AiAnalyseAutomationScanner",
);

const nowIso = () => new Date().toISOString();

const uniqueSortedNumbers = (values: readonly number[]) =>
  [...new Set(values)].sort((left, right) => left - right);

const documentEvidenceId = (documentId: number): string =>
  `${DOCUMENT_EVIDENCE_PREFIX}${documentId}`;

const documentIdFromEntry = (entry: StorageLedgerEntry): number | null => {
  const marker = entry.evidenceIds?.find((id) => id.startsWith(DOCUMENT_EVIDENCE_PREFIX));
  if (!marker) return null;
  const documentId = Number(marker.slice(DOCUMENT_EVIDENCE_PREFIX.length));
  return Number.isSafeInteger(documentId) && documentId > 0 ? documentId : null;
};

const scopedConfigHash = (options: AiAnalyseAutomationScannerOptions): Sha256Digest =>
  canonicalSha256({
    schemaVersion: SCANNER_SCHEMA_VERSION,
    aiAnalyseTagId: options.aiAnalyseTagId,
    configuredCustomFieldIds: uniqueSortedNumbers(options.configuredCustomFieldIds),
    systemTagIds: uniqueSortedNumbers(options.systemTagIds),
    parentTagIds: uniqueSortedNumbers(options.parentTagIds),
    workflowTagIds: uniqueSortedNumbers(options.workflowTagIds ?? []),
    transientTagIds: uniqueSortedNumbers(options.transientTagIds ?? []),
    scope: options.scope ?? (options.enabled ? "all" : "disabled"),
    canaryDocumentIds: uniqueSortedNumbers(options.canaryDocumentIds ?? []),
    forceOcr: options.forceOcr === true,
  });

const triggerRevision = (input: {
  readonly documentId: number;
  readonly stateHash: Sha256Digest;
  readonly modified: string;
  readonly tagIds: readonly number[];
}): Sha256Digest =>
  canonicalSha256({
    documentId: input.documentId,
    stateHash: input.stateHash,
    modified: input.modified,
    tagIds: uniqueSortedNumbers(input.tagIds),
  });

const attemptKey = (documentId: number, runKey: Sha256Digest) => `${documentId}:${runKey}`;

const runIdForAttempt = (documentId: number, runKey: Sha256Digest): string =>
  `${SCANNER_RUN_ID_PREFIX}${documentId}_${runKey.slice(0, 16)}`;

const scannerResult = (
  documentId: number,
  runId: string | null,
  status: AiAnalyseDocumentResult["status"],
  reason: string | null = null,
): AiAnalyseDocumentResult => ({ documentId, runId, status, reason });

const isSoleTransientTrigger = (
  tagIds: readonly number[],
  options: AiAnalyseAutomationScannerOptions,
): boolean => {
  if (!tagIds.includes(options.aiAnalyseTagId)) return false;
  const transientTags = new Set([
    options.aiAnalyseTagId,
    ...(options.transientTagIds ?? options.workflowTagIds ?? []),
  ]);
  for (const tagId of tagIds) {
    if (tagId !== options.aiAnalyseTagId && transientTags.has(tagId)) return false;
  }
  return true;
};

const statusFromState = (state: string | undefined): AiAnalyseAttemptStatus | null => {
  if (!state?.startsWith(SCANNER_STATE_PREFIX)) return null;
  const status = state.slice(SCANNER_STATE_PREFIX.length);
  if (
    status === "processing" ||
    status === "succeeded" ||
    status === "awaiting_review" ||
    status === "paused_failure" ||
    status === "canceled"
  ) {
    return status;
  }
  return null;
};

const attemptFromEntry = (entry: StorageLedgerEntry): AiAnalyseAttemptRecord | null => {
  if (entry.kind !== "ids_hashes_state" || !entry.runId?.startsWith(SCANNER_RUN_ID_PREFIX)) {
    return null;
  }
  const status = statusFromState(entry.state);
  const hashes = entry.hashes ?? [];
  const [runKey, triggerRev, sourceConfigHash, sourceHash, configHash] = hashes;
  const documentId = documentIdFromEntry(entry);
  if (
    !status ||
    !documentId ||
    !runKey ||
    !triggerRev ||
    !sourceConfigHash ||
    !sourceHash ||
    !configHash
  ) {
    return null;
  }
  return {
    documentId,
    runId: entry.runId,
    runKey,
    triggerRevision: triggerRev,
    sourceConfigHash,
    sourceHash,
    configHash,
    status,
    failureMessage: entry.rationale ?? null,
    retryRequestedAt: null,
    updatedAt: entry.timestamp,
  };
};

const latestAttempts = (
  entries: readonly StorageLedgerEntry[],
): ReadonlyMap<string, AiAnalyseAttemptRecord> => {
  const attempts = new Map<string, AiAnalyseAttemptRecord>();
  const retries = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind === "retry_timestamps" && entry.state === SCANNER_RETRY_STATE) {
      const documentId = documentIdFromEntry(entry);
      const runKey = entry.valueHash ?? entry.hashes?.[0];
      if (documentId && runKey) retries.set(attemptKey(documentId, runKey), entry.timestamp);
      continue;
    }
    const attempt = attemptFromEntry(entry);
    if (!attempt) continue;
    attempts.set(attemptKey(attempt.documentId, attempt.runKey), attempt);
  }
  return new Map(
    [...attempts.entries()].map(([key, attempt]) => {
      const retryAt = retries.get(key);
      return [
        key,
        {
          ...attempt,
          retryRequestedAt:
            attempt.status === "paused_failure" && retryAt && retryAt > attempt.updatedAt
              ? retryAt
              : null,
        },
      ];
    }),
  );
};

const latestPausedAttemptForDocument = (
  entries: readonly StorageLedgerEntry[],
  documentId: number,
): AiAnalyseAttemptRecord | null =>
  [...latestAttempts(entries).values()]
    .filter((attempt) => attempt.documentId === documentId && attempt.status === "paused_failure")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;

const appendAttempt = (
  ledger: OperationalLedgerService,
  attempt: AiAnalyseAttemptRecord,
): Effect.Effect<StorageLedgerEntry, unknown> =>
  ledger.appendLedgerEntry({
    kind: "ids_hashes_state",
    runId: attempt.runId,
    state: `${SCANNER_STATE_PREFIX}${attempt.status}`,
    timestamp: attempt.updatedAt,
    hashes: [
      attempt.runKey,
      attempt.triggerRevision,
      attempt.sourceConfigHash,
      attempt.sourceHash,
      attempt.configHash,
    ],
    evidenceIds: [documentEvidenceId(attempt.documentId)],
    rationale: attempt.failureMessage ?? undefined,
    valueHash: attempt.runKey,
  });

const appendHumanRetry = (
  ledger: OperationalLedgerService,
  attempt: AiAnalyseAttemptRecord,
  retriedAt: string,
): Effect.Effect<StorageLedgerEntry, unknown> =>
  ledger.appendLedgerEntry({
    kind: "retry_timestamps",
    runId: attempt.runId,
    state: SCANNER_RETRY_STATE,
    timestamp: retriedAt,
    hashes: [attempt.runKey],
    evidenceIds: [documentEvidenceId(attempt.documentId)],
    valueHash: attempt.runKey,
  });

const sameHashPausedWithoutRetry = (
  existing: AiAnalyseAttemptRecord | undefined,
  runKey: Sha256Digest,
): boolean =>
  existing?.runKey === runKey &&
  existing.status === "paused_failure" &&
  existing.retryRequestedAt === null;

const sameHashTerminal = (
  existing: AiAnalyseAttemptRecord | undefined,
  runKey: Sha256Digest,
): AiAnalyseAttemptStatus | null => {
  if (!existing || existing.runKey !== runKey) return null;
  if (existing.status === "succeeded" || existing.status === "awaiting_review")
    return existing.status;
  return null;
};

const listTriggeredDocuments = (
  paperless: PaperlessService,
  options: AiAnalyseAutomationScannerOptions,
): Effect.Effect<
  {
    readonly pages: number;
    readonly candidates: readonly number[];
  },
  unknown
> =>
  Effect.gen(function* () {
    const receipt = yield* paperless.readTagAssignmentReceipt(options.aiAnalyseTagId);
    const scope = options.scope ?? (options.enabled ? "all" : "disabled");
    const canaryDocumentIds = new Set(options.canaryDocumentIds ?? []);
    const candidates: number[] = [];
    for (const item of receipt.documents) {
      if (scope === "disabled") continue;
      if (scope === "canary" && !canaryDocumentIds.has(item.documentId)) continue;
      const live = yield* paperless.getDocument(item.documentId);
      if (isSoleTransientTrigger(live.tags, options)) candidates.push(item.documentId);
    }
    return { pages: receipt.pageCount, candidates };
  });

const latestOriginalSourceHash = (
  paperless: PaperlessService,
  documentId: number,
): Effect.Effect<Sha256Digest, unknown> =>
  Effect.gen(function* () {
    const original = yield* paperless.selectOriginalPdfVersion(documentId);
    const bytes = original
      ? yield* paperless.downloadVersionPdf(documentId, original.id)
      : yield* paperless.downloadPdf(documentId);
    return sourcePdfHash(bytes);
  });

const buildAttemptIdentity = (
  documentId: number,
  input: {
    readonly stateHash: Sha256Digest;
    readonly modified: string;
    readonly tagIds: readonly number[];
  },
  sourceHash: Sha256Digest,
  options: AiAnalyseAutomationScannerOptions,
) => {
  const configHash = scopedConfigHash(options);
  const currentTriggerRevision = triggerRevision({ documentId, ...input });
  const sourceConfigHash = canonicalSha256({ sourceHash, configHash });
  const runKey = canonicalSha256({
    triggerRevision: currentTriggerRevision,
    sourceConfigHash,
  });
  return {
    runId: runIdForAttempt(documentId, runKey),
    runKey,
    triggerRevision: currentTriggerRevision,
    sourceConfigHash,
    sourceHash,
    configHash,
  };
};

const finalStatusFromOutcome = (outcome: DocumentAnalysisRunOutcome): AiAnalyseAttemptStatus =>
  outcome.run.state === "succeeded" ? "succeeded" : "awaiting_review";

const recoveryOptionsFromConfig = (
  options: AiAnalyseAutomationScannerOptions,
): RecoverInterruptedAppliesOptions => ({
  configuredCustomFieldIds: options.configuredCustomFieldIds,
  systemTagIds: options.systemTagIds,
  parentTagIds: options.parentTagIds,
  workflowTagIds: options.workflowTagIds,
  aiAnalyseTagId: options.aiAnalyseTagId,
});

const resolveInterruptedAttempt = (
  ledger: OperationalLedgerService,
  attempt: AiAnalyseAttemptRecord | undefined,
): Effect.Effect<AiAnalyseAttemptRecord | undefined, unknown> =>
  Effect.gen(function* () {
    if (!attempt || attempt.status !== "processing") return attempt;
    const snapshot = yield* ledger.getSnapshot();
    const run = snapshot.analysisRuns[attempt.runId];
    if (!run) return attempt;
    if (run.state === "succeeded" || run.state === "awaiting_review") {
      const updated = {
        ...attempt,
        status: run.state === "succeeded" ? "succeeded" : "awaiting_review",
        failureMessage: null,
        retryRequestedAt: null,
        updatedAt: nowIso(),
      } satisfies AiAnalyseAttemptRecord;
      yield* appendAttempt(ledger, updated);
      return updated;
    }
    if (run.state === "failed" || run.state === "canceled") {
      const updated = {
        ...attempt,
        status: "paused_failure",
        failureMessage: run.failure?.message ?? `Analysis run ended in ${run.state}.`,
        retryRequestedAt: null,
        updatedAt: nowIso(),
      } satisfies AiAnalyseAttemptRecord;
      yield* appendAttempt(ledger, updated);
      return updated;
    }
    return attempt;
  });

export const makeAiAnalyseAutomationScanner = (
  options: AiAnalyseAutomationScannerOptions,
): Effect.Effect<
  AiAnalyseAutomationScanner,
  never,
  PaperlessService | OperationalLedgerService | DocumentAnalysisOrchestrator
> =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const ledger = yield* OperationalLedgerService;
    const documentAnalysis = yield* DocumentAnalysisOrchestrator;
    const runningRef = yield* Ref.make(false);
    const currentDocumentRef = yield* Ref.make<number | null>(null);
    const lastScanRef = yield* Ref.make<string | null>(null);
    const triggerRef = yield* Ref.make<Deferred.Deferred<void, never> | null>(null);
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);

    const processDocument = (documentId: number): Effect.Effect<AiAnalyseDocumentResult, never> =>
      Effect.gen(function* () {
        const liveBefore = yield* Effect.either(paperless.getDocument(documentId));
        if (liveBefore._tag === "Left") {
          return scannerResult(documentId, null, "paused_failure", "live_document_unavailable");
        }
        if (!isSoleTransientTrigger(liveBefore.right.tags, options)) {
          return scannerResult(documentId, null, "not_triggered", "trigger_withdrawn_or_not_sole");
        }

        const currentSnapshot = yield* Effect.either(paperless.getDocumentSnapshot(documentId));
        if (currentSnapshot._tag === "Left") {
          return scannerResult(documentId, null, "paused_failure", "snapshot_unavailable");
        }
        const selectedSourceHash = yield* Effect.either(
          latestOriginalSourceHash(paperless, documentId),
        );
        if (selectedSourceHash._tag === "Left") {
          return scannerResult(documentId, null, "paused_failure", "source_unavailable");
        }
        const identity = buildAttemptIdentity(
          documentId,
          {
            stateHash: currentSnapshot.right.stateHash,
            modified: currentSnapshot.right.modified,
            tagIds: currentSnapshot.right.tagIds,
          },
          selectedSourceHash.right,
          options,
        );
        const ledgerSnapshot = yield* ledger.getSnapshot();
        const attempts = latestAttempts(ledgerSnapshot.ledgerEntries);
        const existing = yield* resolveInterruptedAttempt(
          ledger,
          attempts.get(attemptKey(documentId, identity.runKey)),
        );
        const terminal = sameHashTerminal(existing, identity.runKey);
        if (terminal === "succeeded") {
          return scannerResult(documentId, identity.runId, "deduped", "already_succeeded");
        }
        if (terminal === "awaiting_review") {
          return scannerResult(documentId, identity.runId, "deduped", "awaiting_review");
        }
        if (sameHashPausedWithoutRetry(existing, identity.runKey)) {
          return scannerResult(documentId, identity.runId, "deduped", "paused_failure");
        }

        const startedAt = nowIso();
        yield* appendAttempt(ledger, {
          documentId,
          runId: identity.runId,
          runKey: identity.runKey,
          triggerRevision: identity.triggerRevision,
          sourceConfigHash: identity.sourceConfigHash,
          sourceHash: identity.sourceHash,
          configHash: identity.configHash,
          status: "processing",
          failureMessage: null,
          retryRequestedAt: existing?.retryRequestedAt ?? null,
          updatedAt: startedAt,
        });
        yield* Ref.set(currentDocumentRef, documentId);

        const outcome = yield* Effect.either(
          documentAnalysis.run({
            documentId,
            runId: identity.runId,
            forceOcr: options.forceOcr,
            configuredCustomFieldIds: options.configuredCustomFieldIds,
            systemTagIds: options.systemTagIds,
            parentTagIds: options.parentTagIds,
            workflowTagIds: options.workflowTagIds,
            aiAnalyseTagId: options.aiAnalyseTagId,
            mode: "automatic",
          }),
        );
        yield* Ref.set(currentDocumentRef, null);

        if (outcome._tag === "Left") {
          const failure = classifyFailure(outcome.left);
          const updatedAt = nowIso();
          yield* appendAttempt(ledger, {
            documentId,
            runId: identity.runId,
            runKey: identity.runKey,
            triggerRevision: identity.triggerRevision,
            sourceConfigHash: identity.sourceConfigHash,
            sourceHash: identity.sourceHash,
            configHash: identity.configHash,
            status: "paused_failure",
            failureMessage: sanitizeFailureMessage(failure.message),
            retryRequestedAt: null,
            updatedAt,
          });
          return scannerResult(documentId, identity.runId, "paused_failure", failure.code);
        }

        const status = finalStatusFromOutcome(outcome.right);
        const liveAfter = yield* Effect.either(paperless.getDocument(documentId));
        const verifiedApplied =
          status === "succeeded" &&
          liveAfter._tag === "Right" &&
          !liveAfter.right.tags.includes(options.aiAnalyseTagId);
        const updatedAt = nowIso();
        if (status === "succeeded" && !verifiedApplied) {
          yield* appendAttempt(ledger, {
            documentId,
            runId: identity.runId,
            runKey: identity.runKey,
            triggerRevision: identity.triggerRevision,
            sourceConfigHash: identity.sourceConfigHash,
            sourceHash: identity.sourceHash,
            configHash: identity.configHash,
            status: "paused_failure",
            failureMessage:
              "Automatic analysis succeeded but ai-analyse trigger removal was not verified.",
            retryRequestedAt: null,
            updatedAt,
          });
          return scannerResult(
            documentId,
            identity.runId,
            "paused_failure",
            "trigger_removal_not_verified",
          );
        }

        yield* appendAttempt(ledger, {
          documentId,
          runId: identity.runId,
          runKey: identity.runKey,
          triggerRevision: identity.triggerRevision,
          sourceConfigHash: identity.sourceConfigHash,
          sourceHash: identity.sourceHash,
          configHash: identity.configHash,
          status,
          failureMessage: null,
          retryRequestedAt: null,
          updatedAt,
        });
        return scannerResult(
          documentId,
          identity.runId,
          status === "succeeded" ? "applied" : "awaiting_review",
        );
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed(scannerResult(documentId, null, "paused_failure", "scanner_error")),
        ),
        Effect.ensuring(Ref.set(currentDocumentRef, null)),
      );

    const scanOnce = (): Effect.Effect<AiAnalyseScanResult, never> =>
      Effect.gen(function* () {
        const scope = options.scope ?? (options.enabled ? "all" : "disabled");
        if (!options.enabled || scope === "disabled") {
          return {
            status: "disabled",
            scannedPages: 0,
            candidateCount: 0,
            processedCount: 0,
            results: [],
          } satisfies AiAnalyseScanResult;
        }
        const lease = yield* Effect.either(
          ledger.acquireLease({
            scope: "analysis",
            resourceId: SCANNER_LEASE_RESOURCE,
            owner: "ai-analyse-automation-scanner",
            ttlMs: options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS,
          }),
        );
        if (lease._tag === "Left" || !lease.right.acquired) {
          return {
            status: "busy",
            scannedPages: 0,
            candidateCount: 0,
            processedCount: 0,
            results: [],
          } satisfies AiAnalyseScanResult;
        }

        return yield* Effect.gen(function* () {
          yield* documentAnalysis
            .recoverInterruptedApplies(recoveryOptionsFromConfig(options))
            .pipe(Effect.catchAll(() => Effect.succeed([])));
          const listed = yield* Effect.either(listTriggeredDocuments(paperless, options));
          if (listed._tag === "Left") {
            return {
              status: "completed",
              scannedPages: 0,
              candidateCount: 0,
              processedCount: 0,
              results: [],
            } satisfies AiAnalyseScanResult;
          }
          const results: AiAnalyseDocumentResult[] = [];
          for (const candidate of listed.right.candidates) {
            const result = yield* processDocument(candidate);
            results.push(result);
          }
          yield* Ref.set(lastScanRef, nowIso());
          return {
            status: "completed",
            scannedPages: listed.right.pages,
            candidateCount: listed.right.candidates.length,
            processedCount: results.filter(
              (result) =>
                result.status === "applied" ||
                result.status === "awaiting_review" ||
                result.status === "paused_failure",
            ).length,
            results,
          } satisfies AiAnalyseScanResult;
        }).pipe(
          Effect.ensuring(
            ledger
              .releaseLease(lease.right.lease.leaseId, lease.right.lease.runId)
              .pipe(Effect.ignore),
          ),
        );
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            status: "canceled",
            scannedPages: 0,
            candidateCount: 0,
            processedCount: 0,
            results: [],
          } satisfies AiAnalyseScanResult),
        ),
      );

    const loop = Effect.gen(function* () {
      while (yield* Ref.get(runningRef)) {
        yield* scanOnce();
        const trigger = yield* Deferred.make<void, never>();
        yield* Ref.set(triggerRef, trigger);
        yield* Effect.race(
          Effect.sleep(Duration.millis(options.intervalMs ?? DEFAULT_INTERVAL_MS)),
          Deferred.await(trigger),
        );
        yield* Ref.set(triggerRef, null);
      }
    }).pipe(Effect.catchAll(() => Effect.void)) as Effect.Effect<void, never, never>;

    return {
      scanOnce,
      start: () =>
        Effect.gen(function* () {
          if (yield* Ref.get(runningRef)) return;
          yield* Ref.set(runningRef, true);
          const fiber = yield* Effect.forkDaemon(loop);
          yield* Ref.set(fiberRef, fiber as Fiber.RuntimeFiber<void, never>);
        }),
      stop: () =>
        Effect.gen(function* () {
          yield* Ref.set(runningRef, false);
          const trigger = yield* Ref.get(triggerRef);
          if (trigger) yield* Deferred.succeed(trigger, undefined);
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) yield* Fiber.interrupt(fiber);
          yield* Ref.set(fiberRef, null);
        }),
      trigger: () =>
        Effect.gen(function* () {
          const trigger = yield* Ref.get(triggerRef);
          if (trigger) yield* Deferred.succeed(trigger, undefined);
        }),
      getStatus: () =>
        Effect.gen(function* () {
          return {
            running: yield* Ref.get(runningRef),
            enabled: options.enabled,
            currentDocumentId: yield* Ref.get(currentDocumentRef),
            lastScanAt: yield* Ref.get(lastScanRef),
          };
        }),
      requestHumanRetry: (documentId) =>
        Effect.gen(function* () {
          const snapshot = yield* ledger.getSnapshot();
          const paused = latestPausedAttemptForDocument(snapshot.ledgerEntries, documentId);
          if (!paused) return null;
          const retriedAt = nowIso();
          yield* appendHumanRetry(ledger, paused, retriedAt);
          return { ...paused, retryRequestedAt: retriedAt, updatedAt: retriedAt };
        }).pipe(Effect.catchAll(() => Effect.succeed(null))),
    };
  });

export const AiAnalyseAutomationScannerLive = (options: AiAnalyseAutomationScannerOptions) =>
  Layer.effect(AiAnalyseAutomationScanner, makeAiAnalyseAutomationScanner(options));
