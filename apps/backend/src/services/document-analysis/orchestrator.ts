import {
  type ApplyJournal,
  canonicalSha256,
  type HashPrecondition,
  type Sha256Digest,
} from "@repo/api-contracts";
import { Context, Effect, Layer } from "effect";
import type { Document, DocumentUpdate } from "../../models/index.js";
import {
  type DocumentAnalysisInput,
  DocumentAnalysisSkill,
} from "../../skills/DocumentAnalysisSkill.js";
import { CodexRuntimeService } from "../CodexRuntimeService.js";
import { MistralOcrService } from "../MistralOcrService.js";
import { OperationalLedgerService } from "../OperationalLedgerService.js";
import type {
  AnalysisProposalValues,
  AnalysisRunRecord,
  ProposalRecord,
} from "../operational-ledger/types.js";
import { PaperlessService } from "../PaperlessService.js";
import { classifyFailure, DocumentAnalysisOrchestrationError } from "./errors.js";
import { rememberAnalysisProposalEvidence } from "./evidence-store.js";
import { approvedOcrLabel, type OcrSelection, selectOrRunOcr } from "./ocr.js";
import {
  type AnalysisPolicy,
  normalizeAnalysisProposalForPolicy,
  proposalValueHash,
} from "./proposals.js";
import { makeOcrMyPdfGenerator, type SearchablePdfGenerator } from "./searchable-pdf.js";

export interface DocumentAnalysisRunRequest {
  readonly documentId: number;
  readonly runId?: string;
  readonly forceOcr?: boolean;
  readonly configuredCustomFieldIds: readonly number[];
  readonly systemTagIds?: readonly number[];
  readonly workflowTagIds?: readonly number[];
  readonly aiAnalyseTagId?: number | null;
  readonly parentTagIds?: readonly number[];
  readonly catalogSnapshot?: Record<string, unknown>;
  readonly catalogSnapshotHash?: Sha256Digest;
  readonly guidance?: string;
  readonly mode?: "automatic" | "review";
}

export interface DocumentAnalysisRunOutcome {
  readonly run: AnalysisRunRecord;
  readonly proposal: ProposalRecord;
  readonly autoApply: boolean;
  readonly ocrHash: Sha256Digest;
  readonly reusedOcrVersionId: number | null;
}

export interface ApplyAnalysisProposalRequest {
  readonly proposalId: string;
  readonly expectedProposalHash?: Sha256Digest;
  readonly configuredCustomFieldIds: readonly number[];
  readonly systemTagIds?: readonly number[];
  readonly parentTagIds?: readonly number[];
  readonly aiAnalyseTagId?: number | null;
  readonly expectedCatalogSnapshotHash?: Sha256Digest;
}

export interface ApplyAnalysisProposalOutcome {
  readonly proposalId: string;
  readonly journalId: string;
  readonly documentId: number;
  readonly afterHash: Sha256Digest;
}

export interface ApplyRecoveryResult {
  readonly journalId: string;
  readonly proposalId: string;
  readonly status: "verified_applied" | "resumed_applied" | "marked_conflict" | "skipped";
}

export interface RecoverInterruptedAppliesOptions {
  readonly configuredCustomFieldIds: readonly number[];
  readonly systemTagIds: readonly number[];
  readonly parentTagIds: readonly number[];
  readonly workflowTagIds?: readonly number[];
  readonly aiAnalyseTagId?: number | null;
}

export interface DocumentAnalysisOrchestrator {
  readonly run: (
    request: DocumentAnalysisRunRequest,
  ) => Effect.Effect<DocumentAnalysisRunOutcome, DocumentAnalysisOrchestrationError>;
  readonly applyApprovedProposal: (
    request: ApplyAnalysisProposalRequest,
  ) => Effect.Effect<ApplyAnalysisProposalOutcome, DocumentAnalysisOrchestrationError>;
  readonly recoverInterruptedApplies: (
    options: RecoverInterruptedAppliesOptions,
  ) => Effect.Effect<readonly ApplyRecoveryResult[], DocumentAnalysisOrchestrationError>;
}

export interface DocumentAnalysisOrchestratorOptions {
  readonly searchablePdfGenerator?: SearchablePdfGenerator;
  readonly leaseTtlMs?: number;
}

export const DocumentAnalysisOrchestrator = Context.GenericTag<DocumentAnalysisOrchestrator>(
  "DocumentAnalysisOrchestrator",
);

const runIdForDocument = (documentId: number): string =>
  `ana_run_document_${documentId}_${Date.now().toString(36)}`;

const evidencePrecondition = (ocr: OcrSelection): HashPrecondition => ({
  kind: "source_pdf",
  digest: canonicalSha256({
    sourceHash: ocr.source.sourceHash,
    ocrHash: ocr.ocrHash,
    contentHash: ocr.contentHash,
    model: ocr.model,
    optionsVersion: ocr.optionsVersion,
  }),
});

const documentStateForPrompt = (
  snapshot: unknown,
  document: Document,
  sourceHash: Sha256Digest,
  ocrHash: Sha256Digest,
) => ({
  snapshot,
  liveMetadata: {
    title: document.title,
    originalFileName: document.original_file_name,
    correspondentId: document.correspondent,
    correspondentName: document.correspondent_name ?? null,
    documentTypeId: document.document_type,
    documentTypeName: document.document_type_name ?? null,
    tagIds: [...document.tags],
    tagNames: [...(document.tag_names ?? [])],
    customFields: [...(document.custom_fields ?? [])],
  },
  sourceHash,
  ocrHash,
});

const liveCatalogSnapshot = (paperless: PaperlessService) =>
  Effect.gen(function* () {
    const [tags, correspondents, documentTypes, customFields] = yield* Effect.all([
      paperless.getTags(),
      paperless.getCorrespondents(),
      paperless.getDocumentTypes(),
      paperless.getCustomFields(),
    ]);
    const byId = <T extends { readonly id: number; readonly name: string }>(items: readonly T[]) =>
      [...items]
        .map((item) => ({ id: item.id, name: item.name }))
        .sort((left, right) => left.id - right.id);
    const snapshot = {
      tags: byId(tags),
      correspondents: byId(correspondents),
      documentTypes: byId(documentTypes),
      customFields: [...customFields]
        .map((field) => ({ id: field.id, name: field.name, dataType: field.data_type }))
        .sort((left, right) => left.id - right.id),
    };
    return { snapshot, hash: canonicalSha256(snapshot) };
  });

interface LiveCatalogSnapshot {
  readonly snapshot: {
    readonly tags: readonly { readonly id: number; readonly name: string }[];
    readonly correspondents: readonly { readonly id: number; readonly name: string }[];
    readonly documentTypes: readonly { readonly id: number; readonly name: string }[];
    readonly customFields: readonly {
      readonly id: number;
      readonly name: string;
      readonly dataType: string;
    }[];
  };
  readonly hash: Sha256Digest;
}

const requireLiveTrigger = (doc: Document, aiAnalyseTagId?: number | null): void => {
  if (
    aiAnalyseTagId !== null &&
    aiAnalyseTagId !== undefined &&
    !doc.tags.includes(aiAnalyseTagId)
  ) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "ai-analyse trigger was withdrawn from the live Paperless document.",
      true,
    );
  }
};

const validateProposedIds = (
  values: AnalysisProposalValues,
  catalog: LiveCatalogSnapshot,
  policy: AnalysisPolicy,
): void => {
  const tagIds = new Set(catalog.snapshot.tags.map((tag) => tag.id));
  const correspondentIds = new Set(catalog.snapshot.correspondents.map((item) => item.id));
  const documentTypeIds = new Set(catalog.snapshot.documentTypes.map((item) => item.id));
  const customFieldIds = new Set(catalog.snapshot.customFields.map((item) => item.id));
  const forbiddenOrdinaryTags = new Set(
    policy.aiAnalyseTagId !== null && policy.aiAnalyseTagId !== undefined
      ? [policy.aiAnalyseTagId]
      : [],
  );
  for (const tagId of values.ordinaryTagIds) {
    if (!tagIds.has(tagId) || forbiddenOrdinaryTags.has(tagId)) {
      throw new DocumentAnalysisOrchestrationError(
        "STALE_PRECONDITION",
        `Analysis proposal contains an invalid ordinary tag id: ${tagId}`,
        false,
      );
    }
  }
  if (values.correspondentId !== null && !correspondentIds.has(values.correspondentId)) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      `Analysis proposal contains an invalid correspondent id: ${values.correspondentId}`,
      false,
    );
  }
  if (values.documentTypeId !== null && !documentTypeIds.has(values.documentTypeId)) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      `Analysis proposal contains an invalid document type id: ${values.documentTypeId}`,
      false,
    );
  }
  for (const field of values.customFields) {
    if (!customFieldIds.has(field.customFieldId)) {
      throw new DocumentAnalysisOrchestrationError(
        "STALE_PRECONDITION",
        `Analysis proposal contains an invalid custom field id: ${field.customFieldId}`,
        false,
      );
    }
  }
};

const analysisPolicy = (
  request: DocumentAnalysisRunRequest | ApplyAnalysisProposalRequest,
  configuredCustomFieldIds: readonly number[] = request.configuredCustomFieldIds,
): AnalysisPolicy => ({
  configuredCustomFieldIds,
  systemTagIds: [],
  parentTagIds: [],
  workflowTagIds: [],
  aiAnalyseTagId: request.aiAnalyseTagId,
});

const markFailure = (
  ledger: OperationalLedgerService,
  runId: string,
  error: unknown,
): Effect.Effect<DocumentAnalysisOrchestrationError, never> =>
  Effect.gen(function* () {
    const failure = classifyFailure(error);
    const snapshot = yield* Effect.either(ledger.getSnapshot());
    const existing = snapshot._tag === "Right" ? snapshot.right.analysisRuns[runId] : undefined;
    if (existing) {
      yield* Effect.ignore(
        ledger.recordAnalysisFailure(runId, {
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          provider:
            failure.code === "PROVIDER_FAILURE" || failure.code === "PROVIDER_MALFORMED"
              ? "document-analysis"
              : undefined,
        }),
      );
      if (existing.state === "analyzing") {
        yield* Effect.ignore(ledger.transitionAnalysisRunState(runId, "analyzing", "failed"));
      }
    }
    return failure;
  });

const toDocumentUpdate = (
  proposedValues: AnalysisProposalValues,
  policy: AnalysisPolicy,
  content?: string,
): DocumentUpdate => {
  const ordinaryTags = new Set(
    proposedValues.ordinaryTagIds.filter((tagId) => tagId !== policy.aiAnalyseTagId),
  );
  return {
    title: proposedValues.title,
    correspondent: proposedValues.correspondentId,
    document_type: proposedValues.documentTypeId,
    tags: [...ordinaryTags].sort((left, right) => left - right),
    custom_fields: proposedValues.customFields.map((field) => ({
      field: field.customFieldId,
      value: field.operation === "remove" ? null : field.value,
    })),
    ...(content !== undefined ? { content } : {}),
  };
};

const analysisValuesFromRecord = (record: ProposalRecord): AnalysisProposalValues => {
  if (!record.proposedValues || record.proposedValues.scope !== "analysis") {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Analysis proposal values are no longer available for application.",
      false,
    );
  }
  if (proposalValueHash(record.proposedValues) !== record.valueHash) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Analysis proposal value hash no longer matches persisted values.",
      false,
    );
  }
  return record.proposedValues;
};

const journalIdForProposal = (proposalId: string): string => `journal_${proposalId}`;

const makeApplyJournal = (input: {
  readonly proposalId: string;
  readonly runId: string;
  readonly status: ApplyJournal["status"];
  readonly preconditions: readonly HashPrecondition[];
  readonly beforeHash: Sha256Digest;
  readonly sourceHash?: Sha256Digest;
  readonly ocrHash?: Sha256Digest;
  readonly afterHash?: Sha256Digest | null;
  readonly uploadTaskId?: string | null;
  readonly failedStep?: string;
}): ApplyJournal => {
  const timestamp = new Date().toISOString();
  const metadataStatus =
    input.status === "succeeded"
      ? "succeeded"
      : input.status === "failed" || input.status === "conflict"
        ? "failed"
        : "pending";
  return {
    journalId: journalIdForProposal(input.proposalId),
    proposalId: input.proposalId,
    epochId: `cat_epoch_${input.runId}`,
    idempotencyKey: journalIdForProposal(input.proposalId),
    status: input.status,
    preconditions: input.preconditions,
    steps: [
      {
        stepId: "preread",
        operation: "describe",
        paperlessTaskId: null,
        beforeHash: input.beforeHash,
        afterHash: null,
        status: "succeeded",
        recordedAt: timestamp,
      },
      {
        stepId: "upload-searchable-pdf",
        operation: "create",
        paperlessTaskId: input.uploadTaskId ?? null,
        beforeHash: input.sourceHash ?? input.beforeHash,
        afterHash: input.ocrHash ?? null,
        status:
          input.status === "succeeded"
            ? "succeeded"
            : input.status === "applying"
              ? "pending"
              : input.failedStep === "upload-searchable-pdf"
                ? "failed"
                : "skipped",
        recordedAt: timestamp,
      },
      {
        stepId: "metadata-and-content",
        operation: "describe",
        paperlessTaskId: null,
        beforeHash: input.beforeHash,
        afterHash: input.afterHash ?? null,
        status: metadataStatus,
        recordedAt: timestamp,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const assertFreshPreconditions = (
  record: ProposalRecord,
  runRecord: AnalysisRunRecord,
  prereadHash: Sha256Digest,
  ocr: OcrSelection,
  expectedCatalogSnapshotHash?: Sha256Digest,
): void => {
  const paperlessPrecondition = record.preconditions.find(
    (precondition) => precondition.kind === "paperless_document_state",
  );
  if (
    paperlessPrecondition?.digest !== prereadHash ||
    runRecord.documentStateHash !== prereadHash
  ) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Approved analysis proposal is stale because Paperless document state changed.",
      true,
    );
  }
  const sourcePrecondition = record.preconditions.find(
    (precondition) => precondition.kind === "source_pdf",
  );
  const currentOcrPrecondition = evidencePrecondition(ocr);
  if (sourcePrecondition?.digest !== currentOcrPrecondition.digest) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Approved analysis proposal is stale because the OCR source identity changed.",
      true,
    );
  }
  const catalogPrecondition = record.preconditions.find(
    (precondition) => precondition.kind === "catalog_epoch",
  );
  if (!catalogPrecondition || catalogPrecondition.digest !== expectedCatalogSnapshotHash) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Approved analysis proposal is stale because the catalog snapshot changed.",
      true,
    );
  }
};

const assertSourceCatalogPreconditions = (
  record: ProposalRecord,
  ocr: OcrSelection,
  catalogHash: Sha256Digest,
): void => {
  const sourcePrecondition = record.preconditions.find(
    (precondition) => precondition.kind === "source_pdf",
  );
  if (sourcePrecondition?.digest !== evidencePrecondition(ocr).digest) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Interrupted apply cannot resume because the OCR source identity changed.",
      true,
    );
  }
  const catalogPrecondition = record.preconditions.find(
    (precondition) => precondition.kind === "catalog_epoch",
  );
  if (!catalogPrecondition || catalogPrecondition.digest !== catalogHash) {
    throw new DocumentAnalysisOrchestrationError(
      "STALE_PRECONDITION",
      "Interrupted apply cannot resume because the catalog snapshot changed.",
      true,
    );
  }
};

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const customFieldMap = (doc: Document): Map<number, unknown> => {
  const fields = new Map<number, unknown>();
  for (const field of doc.custom_fields ?? []) {
    if (
      field &&
      typeof field === "object" &&
      typeof (field as { field?: unknown }).field === "number"
    ) {
      fields.set((field as { field: number }).field, (field as { value?: unknown }).value ?? null);
    }
  }
  return fields;
};

const finalMetadataMatches = (
  doc: Document,
  values: AnalysisProposalValues,
  expectedTags: readonly number[],
  expectedContent: string,
): boolean => {
  if (doc.title !== values.title) return false;
  if (doc.correspondent !== values.correspondentId) return false;
  if (doc.document_type !== values.documentTypeId) return false;
  if (
    JSON.stringify([...doc.tags].sort((left, right) => left - right)) !==
    JSON.stringify(expectedTags)
  ) {
    return false;
  }
  if (doc.content !== expectedContent) return false;
  const fields = customFieldMap(doc);
  for (const field of values.customFields) {
    const expected = field.operation === "remove" ? null : field.value;
    if (!sameJson(fields.get(field.customFieldId) ?? null, expected)) return false;
  }
  return true;
};

const hasApprovedOcrVersion = (ocr: OcrSelection): boolean => ocr.reusedVersion !== null;

export const makeDocumentAnalysisOrchestrator = (
  options: DocumentAnalysisOrchestratorOptions = {},
): Effect.Effect<
  DocumentAnalysisOrchestrator,
  never,
  PaperlessService | MistralOcrService | OperationalLedgerService | CodexRuntimeService
> =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const mistralOcr = yield* MistralOcrService;
    const ledger = yield* OperationalLedgerService;
    const codex = yield* CodexRuntimeService;
    const searchablePdf = options.searchablePdfGenerator ?? makeOcrMyPdfGenerator();
    const leaseTtlMs = options.leaseTtlMs ?? 15 * 60 * 1000;

    const run = (request: DocumentAnalysisRunRequest) =>
      Effect.gen(function* () {
        const runId = request.runId ?? runIdForDocument(request.documentId);
        const lease = yield* ledger.acquireLease({
          scope: "analysis",
          resourceId: request.documentId,
          owner: "document-analysis",
          runId,
          ttlMs: leaseTtlMs,
        });
        if (!lease.acquired) {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STATE_TRANSITION_CONFLICT",
              `Document analysis lease is held by run ${lease.lease.runId}`,
              true,
            ),
          );
        }

        return yield* Effect.gen(function* () {
          const liveBeforeProvider = yield* paperless.getDocument(request.documentId);
          yield* Effect.try({
            try: () => requireLiveTrigger(liveBeforeProvider, request.aiAnalyseTagId),
            catch: classifyFailure,
          });
          const catalog = yield* liveCatalogSnapshot(paperless);
          const snapshot = yield* paperless.getDocumentSnapshot(request.documentId);
          const ocr = yield* selectOrRunOcr(paperless, mistralOcr, request);
          const liveBeforeCodex = yield* paperless.getDocument(request.documentId);
          yield* Effect.try({
            try: () => requireLiveTrigger(liveBeforeCodex, request.aiAnalyseTagId),
            catch: classifyFailure,
          });
          yield* ledger.createAnalysisRun({
            runId,
            documentId: request.documentId,
            forceOcr: request.forceOcr,
            sourcePdfHash: ocr.source.sourceHash,
            documentStateHash: snapshot.stateHash,
          });
          yield* ledger.transitionAnalysisRunState(runId, "queued", "reading_paperless");
          yield* ledger.transitionAnalysisRunState(runId, "reading_paperless", "ocr_requested");
          yield* ledger.transitionAnalysisRunState(runId, "ocr_requested", "hashing_source");
          yield* ledger.transitionAnalysisRunState(runId, "hashing_source", "analyzing");

          const input: DocumentAnalysisInput = {
            runId,
            documentId: request.documentId,
            documentState: documentStateForPrompt(
              snapshot,
              liveBeforeCodex,
              ocr.source.sourceHash,
              ocr.ocrHash,
            ),
            ocrPreview: ocr.preview as unknown as Record<string, unknown>,
            catalogSnapshot: catalog.snapshot,
            configuredCustomFieldIds: catalog.snapshot.customFields.map((field) => field.id),
            policy: {
              forbiddenWorkflowTagIds:
                request.aiAnalyseTagId !== null && request.aiAnalyseTagId !== undefined
                  ? [request.aiAnalyseTagId]
                  : [],
              forbiddenSystemTagIds: [],
            },
            guidance: request.guidance,
          };
          const result = yield* DocumentAnalysisSkill.run(input, {
            reasoningEffort: "medium",
          }).pipe(Effect.provideService(CodexRuntimeService, codex));
          const liveBeforeProposal = yield* paperless.getDocument(request.documentId);
          yield* Effect.try({
            try: () => requireLiveTrigger(liveBeforeProposal, request.aiAnalyseTagId),
            catch: classifyFailure,
          });
          const proposalCatalog = yield* liveCatalogSnapshot(paperless);
          if (proposalCatalog.hash !== catalog.hash) {
            return yield* Effect.fail(
              new DocumentAnalysisOrchestrationError(
                "STALE_PRECONDITION",
                "Catalog snapshot changed while document analysis was running.",
                true,
              ),
            );
          }
          const policy = analysisPolicy(
            request,
            catalog.snapshot.customFields.map((field) => field.id),
          );
          const normalized = normalizeAnalysisProposalForPolicy(result.output.proposal, policy);
          yield* Effect.try({
            try: () => validateProposedIds(normalized.proposedValues, catalog, policy),
            catch: classifyFailure,
          });
          const preconditions = [
            ...normalized.preconditions,
            {
              kind: "paperless_document_state",
              digest: snapshot.stateHash,
            } satisfies HashPrecondition,
            evidencePrecondition(ocr),
            { kind: "catalog_epoch", digest: catalog.hash } satisfies HashPrecondition,
          ];
          const proposal = yield* ledger.recordProposal({
            proposalId: result.output.proposal.proposalId,
            ownerId: runId,
            scope: "analysis",
            proposalHash: result.output.proposal.proposalHash,
            valueHash: proposalValueHash(normalized.proposedValues),
            proposedValues: normalized.proposedValues,
            evidenceIds: normalized.evidenceIds,
            coverage: normalized.strongEvidenceCount / 5,
            rationale: normalized.proposal.rationale,
            preconditions,
          });
          const reviewedRun = yield* ledger.transitionAnalysisRunState(
            runId,
            "analyzing",
            "awaiting_review",
          );
          rememberAnalysisProposalEvidence({
            ...normalized.proposal,
            runId: runId as typeof normalized.proposal.runId,
            documentId: request.documentId as typeof normalized.proposal.documentId,
            preconditions,
          });
          const shouldAutoApply =
            normalized.shouldApplyAutomatically && (request.mode ?? "automatic") === "automatic";
          const finalRun = shouldAutoApply
            ? yield* Effect.gen(function* () {
                yield* ledger.recordProposalDecision(proposal.proposalId, {
                  expectedDecision: "undecided",
                  decision: "approved",
                  outcome: "approved",
                });
                return yield* ledger.transitionAnalysisRunState(
                  runId,
                  "awaiting_review",
                  "approved",
                );
              })
            : reviewedRun;
          if (shouldAutoApply) {
            yield* applyApprovedProposal({
              proposalId: proposal.proposalId,
              expectedProposalHash: proposal.proposalHash,
              configuredCustomFieldIds: request.configuredCustomFieldIds,
              systemTagIds: request.systemTagIds,
              parentTagIds: request.parentTagIds,
              aiAnalyseTagId: request.aiAnalyseTagId,
            });
            const afterApply = yield* ledger.getSnapshot();
            const appliedRun = afterApply.analysisRuns[runId];
            return {
              run: appliedRun ?? finalRun,
              proposal,
              autoApply: shouldAutoApply,
              ocrHash: ocr.ocrHash,
              reusedOcrVersionId: ocr.reusedVersion?.versionId ?? null,
            };
          }

          return {
            run: finalRun,
            proposal,
            autoApply: shouldAutoApply,
            ocrHash: ocr.ocrHash,
            reusedOcrVersionId: ocr.reusedVersion?.versionId ?? null,
          };
        }).pipe(
          Effect.catchAll((error) =>
            Effect.flatMap(markFailure(ledger, runId, error), (failure) => Effect.fail(failure)),
          ),
          Effect.ensuring(ledger.releaseLease(lease.lease.leaseId, runId).pipe(Effect.ignore)),
        );
      }).pipe(Effect.catchAll((error) => Effect.fail(classifyFailure(error))));

    const applyApprovedProposal = (request: ApplyAnalysisProposalRequest) =>
      Effect.gen(function* () {
        const snapshot = yield* ledger.getSnapshot();
        const record = snapshot.proposals[request.proposalId];
        if (!record || record.scope !== "analysis") {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STALE_PRECONDITION",
              "Analysis proposal not found.",
              false,
            ),
          );
        }
        if (request.expectedProposalHash && request.expectedProposalHash !== record.proposalHash) {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STALE_PRECONDITION",
              "Expected proposal hash does not match current proposal.",
              true,
            ),
          );
        }
        if (record.decision !== "approved") {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "REJECTED",
              `Analysis proposal ${request.proposalId} is not approved.`,
              false,
            ),
          );
        }
        const runRecord = snapshot.analysisRuns[record.ownerId];
        if (!runRecord) {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STALE_PRECONDITION",
              "Analysis run not found.",
              false,
            ),
          );
        }
        if (runRecord.state !== "approved") {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STATE_TRANSITION_CONFLICT",
              `Analysis run ${record.ownerId} must be approved before apply; found ${runRecord.state}.`,
              true,
            ),
          );
        }
        const documentId = runRecord.documentId;
        const lease = yield* ledger.acquireLease({
          scope: "mutation",
          resourceId: documentId,
          owner: "document-analysis-apply",
          runId: record.ownerId,
          ttlMs: leaseTtlMs,
        });
        if (!lease.acquired) {
          return yield* Effect.fail(
            new DocumentAnalysisOrchestrationError(
              "STATE_TRANSITION_CONFLICT",
              `Document mutation lease is held by run ${lease.lease.runId}`,
              true,
            ),
          );
        }

        return yield* Effect.gen(function* () {
          const current = yield* paperless.getDocument(documentId);
          yield* Effect.try({
            try: () => requireLiveTrigger(current, request.aiAnalyseTagId),
            catch: classifyFailure,
          });
          const catalog = yield* liveCatalogSnapshot(paperless);
          const preread = yield* paperless.getDocumentSnapshot(documentId);
          const source = yield* selectOrRunOcr(paperless, mistralOcr, {
            documentId,
            forceOcr: false,
          });
          yield* Effect.try({
            try: () =>
              assertFreshPreconditions(record, runRecord, preread.stateHash, source, catalog.hash),
            catch: classifyFailure,
          });
          const values = yield* Effect.try({
            try: () => analysisValuesFromRecord(record),
            catch: classifyFailure,
          });
          const policy = analysisPolicy(
            request,
            catalog.snapshot.customFields.map((field) => field.id),
          );
          yield* Effect.try({
            try: () => validateProposedIds(values, catalog, policy),
            catch: classifyFailure,
          });
          const update = toDocumentUpdate(values, policy, source.markdown);
          const expectedTags = update.tags ?? [];
          const liveBeforeMutation = yield* paperless.getDocument(documentId);
          yield* Effect.try({
            try: () => requireLiveTrigger(liveBeforeMutation, request.aiAnalyseTagId),
            catch: classifyFailure,
          });
          yield* ledger.transitionAnalysisRunState(record.ownerId, "approved", "applying");
          yield* ledger.recordApplyJournal(
            makeApplyJournal({
              proposalId: request.proposalId,
              runId: record.ownerId,
              status: "applying",
              preconditions: record.preconditions,
              beforeHash: preread.stateHash,
              sourceHash: source.source.sourceHash,
              ocrHash: source.ocrHash,
            }),
          );

          const upload = source.reusedVersion
            ? null
            : yield* Effect.gen(function* () {
                const searchable = yield* searchablePdf.generate(source.source.pdfBytes);
                const created = yield* paperless.uploadOcrPdfVersion(
                  documentId,
                  searchable,
                  approvedOcrLabel(
                    source.source.sourceHash,
                    source.ocrHash,
                    source.contentHash,
                    source.model,
                    source.optionsVersion,
                  ),
                );
                const createdVersion = created.version_id ?? created.id;
                const patchedVersion =
                  typeof createdVersion === "number"
                    ? yield* paperless.patchVersionContent(
                        documentId,
                        createdVersion,
                        source.markdown,
                      )
                    : null;
                if (typeof createdVersion === "number") {
                  const patchedContent =
                    typeof patchedVersion?.content === "string"
                      ? patchedVersion.content
                      : source.markdown;
                  if (patchedContent !== source.markdown) {
                    return yield* Effect.fail(
                      new DocumentAnalysisOrchestrationError(
                        "STALE_PRECONDITION",
                        "Paperless searchable OCR version content verification failed after patch.",
                        true,
                      ),
                    );
                  }
                }
                return created;
              });
          const updated = yield* paperless.updateDocumentExact(documentId, update, {
            preconditions: [{ kind: "paperless_document_state", digest: preread.stateHash }],
            preserveTagIds: new Set(),
            managedCustomFieldIds: new Set(policy.configuredCustomFieldIds),
          });
          const reread = yield* paperless.rereadAfterMutation(documentId, [
            { kind: "paperless_document_state", digest: preread.stateHash },
          ]);
          const finalDocument = yield* paperless.getDocument(documentId);
          if (!finalMetadataMatches(finalDocument, values, expectedTags, source.markdown)) {
            return yield* Effect.fail(
              new DocumentAnalysisOrchestrationError(
                "STALE_PRECONDITION",
                "Paperless final metadata/content verification failed after apply.",
                true,
              ),
            );
          }
          if (
            !hasApprovedOcrVersion(source) &&
            typeof (upload?.version_id ?? upload?.id) !== "number"
          ) {
            return yield* Effect.fail(
              new DocumentAnalysisOrchestrationError(
                "PAPERLESS_UNAVAILABLE",
                "Paperless did not return a searchable OCR version id.",
                true,
              ),
            );
          }
          const journalId = journalIdForProposal(request.proposalId);
          yield* ledger.recordApplyJournal({
            ...makeApplyJournal({
              proposalId: request.proposalId,
              runId: record.ownerId,
              status: "succeeded",
              preconditions: record.preconditions,
              beforeHash: preread.stateHash,
              sourceHash: source.source.sourceHash,
              ocrHash: source.ocrHash,
              afterHash: reread.afterHash,
              uploadTaskId: upload?.task_id ?? null,
            }),
            journalId,
          });
          yield* ledger.recordProposalDecision(request.proposalId, {
            expectedDecision: "approved",
            decision: "applied",
          });
          yield* ledger.transitionAnalysisRunState(record.ownerId, "applying", "succeeded");
          return {
            proposalId: request.proposalId,
            journalId,
            documentId: updated.id,
            afterHash: reread.afterHash,
          };
        }).pipe(
          Effect.catchAll((error) => {
            const failure = classifyFailure(error);
            return Effect.gen(function* () {
              const latest = yield* Effect.either(ledger.getSnapshot());
              const runState =
                latest._tag === "Right"
                  ? latest.right.analysisRuns[record.ownerId]?.state
                  : undefined;
              if (runState === "applying") {
                yield* Effect.ignore(
                  ledger.transitionAnalysisRunState(record.ownerId, "applying", "failed"),
                );
              }
              return yield* Effect.fail(failure);
            });
          }),
          Effect.ensuring(
            ledger.releaseLease(lease.lease.leaseId, record.ownerId).pipe(Effect.ignore),
          ),
        );
      }).pipe(Effect.catchAll((error) => Effect.fail(classifyFailure(error))));

    const recoverInterruptedApplies = (recoveryOptions: RecoverInterruptedAppliesOptions) =>
      Effect.gen(function* () {
        const snapshot = yield* ledger.getSnapshot();
        const results: ApplyRecoveryResult[] = [];
        for (const journal of Object.values(snapshot.applyJournals).filter(
          (candidate) => candidate.status === "applying",
        )) {
          const record = snapshot.proposals[journal.proposalId];
          const runRecord = record ? snapshot.analysisRuns[record.ownerId] : undefined;
          if (!record || record.scope !== "analysis" || !runRecord) {
            results.push({
              journalId: journal.journalId,
              proposalId: journal.proposalId,
              status: "skipped",
            });
            continue;
          }
          if (record.decision !== "approved") {
            results.push({
              journalId: journal.journalId,
              proposalId: journal.proposalId,
              status: "skipped",
            });
            continue;
          }
          const lease = yield* ledger.acquireLease({
            scope: "mutation",
            resourceId: runRecord.documentId,
            owner: "document-analysis-recovery",
            runId: record.ownerId,
            ttlMs: leaseTtlMs,
          });
          if (!lease.acquired) {
            results.push({
              journalId: journal.journalId,
              proposalId: journal.proposalId,
              status: "skipped",
            });
            continue;
          }
          const values = yield* Effect.try({
            try: () => analysisValuesFromRecord(record),
            catch: classifyFailure,
          });
          yield* Effect.gen(function* () {
            const catalog = yield* liveCatalogSnapshot(paperless);
            const current = yield* paperless.getDocument(runRecord.documentId);
            const source = yield* selectOrRunOcr(paperless, mistralOcr, {
              documentId: runRecord.documentId,
              forceOcr: false,
            });
            const policy: AnalysisPolicy = {
              configuredCustomFieldIds: catalog.snapshot.customFields.map((field) => field.id),
              systemTagIds: [],
              parentTagIds: [],
              workflowTagIds: [],
              aiAnalyseTagId: recoveryOptions.aiAnalyseTagId,
            };
            yield* Effect.try({
              try: () => {
                assertSourceCatalogPreconditions(record, source, catalog.hash);
                validateProposedIds(values, catalog, policy);
              },
              catch: classifyFailure,
            });
            const update = toDocumentUpdate(values, policy, source.markdown);
            const expectedTags = update.tags ?? [];
            const beforeHash = journal.steps[0]?.beforeHash ?? runRecord.documentStateHash;
            if (finalMetadataMatches(current, values, expectedTags, source.markdown)) {
              yield* ledger.recordApplyJournal({
                ...makeApplyJournal({
                  proposalId: record.proposalId,
                  runId: record.ownerId,
                  status: "succeeded",
                  preconditions: record.preconditions,
                  beforeHash,
                  sourceHash: source.source.sourceHash,
                  ocrHash: source.ocrHash,
                  afterHash: runRecord.documentStateHash,
                }),
                journalId: journal.journalId,
              });
              yield* ledger.recordProposalDecision(record.proposalId, {
                expectedDecision: "approved",
                decision: "applied",
              });
              if (runRecord.state === "applying") {
                yield* ledger.transitionAnalysisRunState(record.ownerId, "applying", "succeeded");
              }
              results.push({
                journalId: journal.journalId,
                proposalId: record.proposalId,
                status: "verified_applied",
              });
              return;
            }

            const currentSnapshot = yield* paperless.getDocumentSnapshot(runRecord.documentId);
            if (currentSnapshot.stateHash !== beforeHash) {
              yield* ledger.recordApplyJournal({
                ...makeApplyJournal({
                  proposalId: record.proposalId,
                  runId: record.ownerId,
                  status: "conflict",
                  preconditions: record.preconditions,
                  beforeHash,
                  sourceHash: source.source.sourceHash,
                  ocrHash: source.ocrHash,
                  afterHash: null,
                  failedStep: "metadata-and-content",
                }),
                journalId: journal.journalId,
              });
              if (runRecord.state === "applying") {
                yield* ledger.transitionAnalysisRunState(record.ownerId, "applying", "failed");
              }
              results.push({
                journalId: journal.journalId,
                proposalId: record.proposalId,
                status: "marked_conflict",
              });
              return;
            }

            yield* Effect.try({
              try: () => requireLiveTrigger(current, recoveryOptions.aiAnalyseTagId),
              catch: classifyFailure,
            });
            const upload = source.reusedVersion
              ? null
              : yield* Effect.gen(function* () {
                  const searchable = yield* searchablePdf.generate(source.source.pdfBytes);
                  const created = yield* paperless.uploadOcrPdfVersion(
                    runRecord.documentId,
                    searchable,
                    approvedOcrLabel(
                      source.source.sourceHash,
                      source.ocrHash,
                      source.contentHash,
                      source.model,
                      source.optionsVersion,
                    ),
                  );
                  const createdVersion = created.version_id ?? created.id;
                  const patchedVersion =
                    typeof createdVersion === "number"
                      ? yield* paperless.patchVersionContent(
                          runRecord.documentId,
                          createdVersion,
                          source.markdown,
                        )
                      : null;
                  if (
                    typeof createdVersion !== "number" ||
                    (typeof patchedVersion?.content === "string" &&
                      patchedVersion.content !== source.markdown)
                  ) {
                    return yield* Effect.fail(
                      new DocumentAnalysisOrchestrationError(
                        "PAPERLESS_UNAVAILABLE",
                        "Recovery could not verify searchable OCR version upload.",
                        true,
                      ),
                    );
                  }
                  return created;
                });
            const metadataWrite = yield* Effect.either(
              paperless.updateDocumentExact(runRecord.documentId, update, {
                preconditions: [{ kind: "paperless_document_state", digest: beforeHash }],
                preserveTagIds: new Set(),
                managedCustomFieldIds: new Set(policy.configuredCustomFieldIds),
              }),
            );
            const afterMetadataDocument = yield* paperless.getDocument(runRecord.documentId);
            if (
              metadataWrite._tag === "Left" &&
              !finalMetadataMatches(afterMetadataDocument, values, expectedTags, source.markdown)
            ) {
              return yield* Effect.fail(classifyFailure(metadataWrite.left));
            }
            const reread = yield* paperless.rereadAfterMutation(runRecord.documentId, [
              { kind: "paperless_document_state", digest: beforeHash },
            ]);
            const finalDocument =
              metadataWrite._tag === "Left"
                ? afterMetadataDocument
                : yield* paperless.getDocument(runRecord.documentId);
            if (!finalMetadataMatches(finalDocument, values, expectedTags, source.markdown)) {
              return yield* Effect.fail(
                new DocumentAnalysisOrchestrationError(
                  "STALE_PRECONDITION",
                  "Recovery final metadata/content verification failed.",
                  true,
                ),
              );
            }
            yield* ledger.recordApplyJournal({
              ...makeApplyJournal({
                proposalId: record.proposalId,
                runId: record.ownerId,
                status: "succeeded",
                preconditions: record.preconditions,
                beforeHash,
                sourceHash: source.source.sourceHash,
                ocrHash: source.ocrHash,
                afterHash: reread.afterHash,
                uploadTaskId: upload?.task_id ?? null,
              }),
              journalId: journal.journalId,
            });
            yield* ledger.recordProposalDecision(record.proposalId, {
              expectedDecision: "approved",
              decision: "applied",
            });
            if (runRecord.state === "applying") {
              yield* ledger.transitionAnalysisRunState(record.ownerId, "applying", "succeeded");
            }
            results.push({
              journalId: journal.journalId,
              proposalId: record.proposalId,
              status: "resumed_applied",
            });
          }).pipe(
            Effect.ensuring(
              ledger.releaseLease(lease.lease.leaseId, record.ownerId).pipe(Effect.ignore),
            ),
          );
        }
        return results;
      }).pipe(Effect.catchAll((error) => Effect.fail(classifyFailure(error))));

    return { run, applyApprovedProposal, recoverInterruptedApplies };
  });

export const DocumentAnalysisOrchestratorLive = (
  options: DocumentAnalysisOrchestratorOptions = {},
) => Layer.effect(DocumentAnalysisOrchestrator, makeDocumentAnalysisOrchestrator(options));
