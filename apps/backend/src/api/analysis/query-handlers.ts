import {
  type AnalysisEntityLabels,
  type AnalysisExpiredEvidenceProjection,
  type AnalysisFailure,
  AnalysisFailureQueuePageSchema,
  AnalysisProposalPageSchema,
  type AnalysisProposalProjection,
  AnalysisProposalProjectionSchema,
  AnalysisReviewQueuePageSchema,
  type AnalysisRun,
  AnalysisRunListQuerySchema,
  AnalysisRunPageSchema,
  AnalysisRunSchema,
  type HashPrecondition,
  type PageRequest,
  type PaperlessDocumentPage,
  PaperlessDocumentPageSchema,
} from "@repo/api-contracts";
import { Effect, Either } from "effect";
import { NotFoundError } from "../../errors/index.js";
import { getAnalysisProposalEvidence } from "../../services/document-analysis/evidence-store.js";
import { OperationalLedgerService } from "../../services/OperationalLedgerService.js";
import type {
  AnalysisCustomFieldValue,
  AnalysisProposalValues,
  AnalysisRunRecord,
  OperationalLedgerData,
  ProposalRecord,
  RandomCycleRecord,
  SanitizedFailureRecord,
} from "../../services/operational-ledger/types.js";
import { PaperlessService } from "../../services/PaperlessService.js";
import { pageRequestEffect, paginate, requestEffect, responseEffect } from "../query-utils.js";

export const randomCycleCommandEndpoints = [
  { method: "POST", path: "/api/analysis/random-cycle/select" },
  { method: "POST", path: "/api/analysis/random-cycle/reset" },
] as const;

export const randomCycleGetEndpoints = [] as const;

export interface RandomCycleReadModel {
  readonly cycleKey: string;
  readonly cursor: number;
  readonly selectedRunIds: readonly string[];
  readonly resetCount: number;
  readonly updatedAt: string;
  readonly currentDocuments: PaperlessDocumentPage;
}

const byUpdatedDesc = <T extends { readonly updatedAt: string; readonly createdAt?: string }>(
  left: T,
  right: T,
) => {
  const rightTime = Date.parse(right.updatedAt ?? right.createdAt ?? "");
  const leftTime = Date.parse(left.updatedAt ?? left.createdAt ?? "");
  return rightTime - leftTime;
};

const compactFailure = (failure: SanitizedFailureRecord): AnalysisFailure => ({
  code: failure.code,
  message: failure.message,
  failedAt: failure.failedAt,
  retryable: failure.retryable,
  provider: failure.provider,
});

const fallbackFailure = (run: AnalysisRunRecord): AnalysisFailure => ({
  code: "UNKNOWN",
  message: "Analysis run failed without a stored sanitized failure.",
  failedAt: run.updatedAt,
  retryable: false,
});

const hydrateRun = (
  run: AnalysisRunRecord,
): Effect.Effect<AnalysisRun, unknown, PaperlessService> =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const snapshot = yield* paperless.getDocumentSnapshot(run.documentId);
    return yield* responseEffect(AnalysisRunSchema, {
      runId: run.runId,
      state: run.state,
      documentId: run.documentId,
      forceOcr: run.forceOcr,
      sourcePdfHash: snapshot.sourcePdfHash,
      documentStateHash: snapshot.stateHash,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      completedAt: run.completedAt,
      retryCount: run.retryCount,
      failure: run.failure ? compactFailure(run.failure) : null,
    });
  });

export const listAnalysisRuns = (
  request: PageRequest & { readonly state?: string; readonly documentId?: number } = {},
) =>
  Effect.gen(function* () {
    const pageRequest = yield* requestEffect(AnalysisRunListQuerySchema, request, [
      "cursor",
      "limit",
      "state",
      "documentId",
    ]);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const runs = Object.values(snapshot.analysisRuns)
      .filter((run) => (pageRequest.state ? run.state === pageRequest.state : true))
      .filter((run) => (pageRequest.documentId ? run.documentId === pageRequest.documentId : true))
      .sort(byUpdatedDesc);
    const page = paginate(runs, pageRequest);
    const items = yield* Effect.all(page.items.map(hydrateRun), { concurrency: 8 });
    return yield* responseEffect(AnalysisRunPageSchema, { items, page: page.page });
  });

export const getAnalysisRun = (runId: string) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const run = snapshot.analysisRuns[runId];
    if (!run) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Analysis run ${runId} not found`,
          resource: "analysis_run",
          id: runId,
        }),
      );
    }
    return yield* responseEffect(AnalysisRunSchema, yield* hydrateRun(run));
  });

const safeNewTagCandidate = (
  candidate: AnalysisProposalValues["newTagCandidates"][number],
): AnalysisProposalProjection["proposed"]["newTagCandidates"][number] => ({
  candidateKey: candidate.candidateKey,
  name: candidate.name,
  color: candidate.color,
  rationale: candidate.rationale,
});

const customFieldDecision = (
  field: AnalysisCustomFieldValue,
): AnalysisProposalProjection["proposed"]["customFields"][number] => ({
  customFieldId:
    field.customFieldId as AnalysisProposalProjection["proposed"]["customFields"][number]["customFieldId"],
  operation: field.operation,
  value: field.value,
  valueHash: field.valueHash,
});

const proposalPreconditions = (proposal: ProposalRecord): readonly HashPrecondition[] =>
  proposal.preconditions;

const expiredEvidenceReason = (
  proposal: ProposalRecord,
): AnalysisExpiredEvidenceProjection["reason"] => {
  if (proposal.compactedAt) return "retention_compacted";
  return proposal.evidenceIds.length > 0 ? "process_restarted" : "transient_evidence_missing";
};

const expectedDocumentPrecondition = (preconditions: readonly HashPrecondition[]) =>
  preconditions.find((precondition) => precondition.kind === "paperless_document_state");

const availableProposalValues = (
  evidence: NonNullable<ReturnType<typeof getAnalysisProposalEvidence>>,
  values: AnalysisProposalValues,
) => {
  const candidatesByKey = new Map(
    evidence.proposed.newTagCandidates.map((candidate) => [candidate.candidateKey, candidate]),
  );
  const customFieldsById = new Map<number, (typeof evidence.proposed.customFields)[number]>(
    evidence.proposed.customFields.map((field) => [field.customFieldId, field]),
  );
  const newTagCandidates = values.newTagCandidates.map((candidate) =>
    candidatesByKey.get(candidate.candidateKey),
  );
  const customFields = values.customFields.map((field) =>
    customFieldsById.get(field.customFieldId),
  );
  if (
    newTagCandidates.some((candidate) => candidate === undefined) ||
    customFields.some((field) => field === undefined)
  ) {
    return null;
  }
  return {
    title: values.title,
    correspondentId: values.correspondentId,
    documentTypeId: values.documentTypeId,
    ordinaryTagIds: [...values.ordinaryTagIds],
    newTagCandidates: newTagCandidates.filter(
      (candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined,
    ),
    customFields: customFields.map((field, index) => ({
      ...field,
      operation: values.customFields[index]?.operation ?? field?.operation,
      value: values.customFields[index]?.value ?? field?.value,
      valueHash: values.customFields[index]?.valueHash ?? field?.valueHash,
    })),
  };
};

const currentProposalEntityLabels = (
  paperless: PaperlessService,
  values: AnalysisProposalValues,
): Effect.Effect<AnalysisEntityLabels, unknown> =>
  Effect.gen(function* () {
    const requestedTagIds = new Set(values.ordinaryTagIds);
    const requestedCorrespondentIds = new Set(
      values.correspondentId == null ? [] : [values.correspondentId],
    );
    const requestedDocumentTypeIds = new Set(
      values.documentTypeId == null ? [] : [values.documentTypeId],
    );

    const [tags, correspondents, documentTypes] = yield* Effect.all(
      [
        requestedTagIds.size > 0 ? paperless.getTags() : Effect.succeed([]),
        requestedCorrespondentIds.size > 0 ? paperless.getCorrespondents() : Effect.succeed([]),
        requestedDocumentTypeIds.size > 0 ? paperless.getDocumentTypes() : Effect.succeed([]),
      ],
      { concurrency: 3 },
    );

    const byId = <T extends { readonly id: number; readonly name: string }>(
      entities: readonly T[],
      requestedIds: ReadonlySet<number>,
    ) =>
      entities
        .filter((entity) => requestedIds.has(entity.id))
        .map((entity) => ({ id: entity.id, name: entity.name }))
        .sort((left, right) => left.id - right.id);

    return {
      tags: byId(tags, requestedTagIds),
      correspondents: byId(correspondents, requestedCorrespondentIds),
      documentTypes: byId(documentTypes, requestedDocumentTypeIds),
    };
  });

const hydrateAnalysisProposal = (
  proposal: ProposalRecord,
  snapshot: OperationalLedgerData,
): Effect.Effect<AnalysisProposalProjection | null, unknown, PaperlessService> =>
  Effect.gen(function* () {
    if (proposal.scope !== "analysis" || proposal.proposedValues?.scope !== "analysis") return null;
    const run = snapshot.analysisRuns[proposal.ownerId];
    if (!run) return null;

    const paperless = yield* PaperlessService;
    const document = yield* Effect.either(paperless.getDocumentSnapshot(run.documentId));
    const values = proposal.proposedValues;
    const entityLabels = yield* currentProposalEntityLabels(paperless, values);
    const expectedPreconditions = proposalPreconditions(proposal);
    const expectedDocument = expectedDocumentPrecondition(expectedPreconditions);
    const currentPreconditions = Either.isRight(document)
      ? [{ kind: "paperless_document_state" as const, digest: document.right.stateHash }]
      : undefined;
    const stale =
      expectedDocument !== undefined &&
      Either.isRight(document) &&
      expectedDocument.digest !== document.right.stateHash;
    const currentMissing = Either.isLeft(document);
    const evidence = getAnalysisProposalEvidence(proposal.proposalId, {
      runId: proposal.ownerId,
      documentId: run.documentId,
      proposalHash: proposal.proposalHash,
    });
    const availableValues =
      evidence && values.scope === "analysis" ? availableProposalValues(evidence, values) : null;
    const freshness = {
      status: currentMissing
        ? ("current_missing" as const)
        : stale
          ? ("stale" as const)
          : ("fresh" as const),
      stale,
      currentMissing,
      expectedPreconditions,
      currentPreconditions,
    };

    if (evidence && availableValues) {
      return yield* responseEffect(AnalysisProposalProjectionSchema, {
        ...evidence,
        evidenceAvailability: "available",
        proposed: availableValues,
        preconditions: expectedPreconditions,
        freshness,
        entityLabels,
      });
    }

    return yield* responseEffect(AnalysisProposalProjectionSchema, {
      proposalId: proposal.proposalId,
      runId: proposal.ownerId,
      documentId: run.documentId,
      proposalHash: proposal.proposalHash,
      evidenceAvailability: "evidence_expired",
      evidence: {
        availability: "evidence_expired",
        requiresRefresh: true,
        refreshAction: "retry",
        reason: expiredEvidenceReason(proposal),
      },
      proposed: {
        title: values.title,
        correspondentId: values.correspondentId,
        documentTypeId: values.documentTypeId,
        ordinaryTagIds: [...values.ordinaryTagIds],
        newTagCandidates: values.newTagCandidates.map((candidate) =>
          safeNewTagCandidate(candidate),
        ),
        customFields: values.customFields.map((field) => customFieldDecision(field)),
      },
      review: {
        required: true,
        reasons: ["evidence_expired"],
        rationale: proposal.rationale,
      },
      rationale: proposal.rationale,
      preconditions: expectedPreconditions,
      freshness,
      entityLabels,
      createdAt: proposal.createdAt,
    });
  });

const compactProposalRecords = (snapshot: OperationalLedgerData, runId?: string) =>
  Object.values(snapshot.proposals)
    .filter((proposal) => proposal.scope === "analysis")
    .filter((proposal) => (runId ? proposal.ownerId === runId : true))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

export const listAnalysisProposals = (runId: string, request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    if (!snapshot.analysisRuns[runId]) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Analysis run ${runId} not found`,
          resource: "analysis_run",
          id: runId,
        }),
      );
    }
    const page = paginate(compactProposalRecords(snapshot, runId), pageRequest);
    const hydrated = yield* Effect.all(
      page.items.map((proposal) => hydrateAnalysisProposal(proposal, snapshot)),
      { concurrency: 8 },
    );
    return yield* responseEffect(AnalysisProposalPageSchema, {
      items: hydrated.filter(
        (proposal): proposal is AnalysisProposalProjection => proposal !== null,
      ),
      page: page.page,
    });
  });

export const listAnalysisReviewQueue = (request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const records = compactProposalRecords(snapshot).filter(
      (proposal) => proposal.decision === "undecided",
    );
    const page = paginate(records, pageRequest);
    const hydrated = yield* Effect.all(
      page.items.map((proposal) => hydrateAnalysisProposal(proposal, snapshot)),
      { concurrency: 8 },
    );
    const items = hydrated
      .filter((proposal): proposal is AnalysisProposalProjection => proposal !== null)
      .filter((proposal) => proposal.review.required)
      .map((proposal) => ({
        runId: proposal.runId,
        proposalId: proposal.proposalId,
        documentId: proposal.documentId,
        reasons: proposal.review.reasons,
        proposalHash: proposal.proposalHash,
        createdAt: proposal.createdAt,
      }));
    return yield* responseEffect(AnalysisReviewQueuePageSchema, { items, page: page.page });
  });

export const listAnalysisFailures = (request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const records = Object.values(snapshot.analysisRuns)
      .filter((run) => run.failure !== null || run.state === "failed")
      .sort(byUpdatedDesc);
    const page = paginate(records, pageRequest);
    const items = page.items.map((run) => ({
      runId: run.runId,
      documentId: run.documentId,
      failure: run.failure ? compactFailure(run.failure) : fallbackFailure(run),
      retryCount: run.retryCount,
      updatedAt: run.updatedAt,
    }));
    return yield* responseEffect(AnalysisFailureQueuePageSchema, { items, page: page.page });
  });

const compactCycle = (
  cycle: RandomCycleRecord,
  currentDocuments: PaperlessDocumentPage,
): RandomCycleReadModel => ({
  cycleKey: cycle.cycleKey,
  cursor: cycle.cursor,
  selectedRunIds: [...cycle.selectedRunIds],
  resetCount: cycle.resetCount,
  updatedAt: cycle.updatedAt,
  currentDocuments,
});

export const getRandomCycleWorkbench = (cycleKey: string, request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const paperless = yield* PaperlessService;
    const snapshot = yield* ledger.getSnapshot();
    const cycle = snapshot.randomCycles[cycleKey];
    if (!cycle) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Random cycle ${cycleKey} not found`,
          resource: "random_cycle",
          id: cycleKey,
        }),
      );
    }
    const documents = yield* paperless.listDocumentsPage(pageRequest);
    const currentDocuments = yield* responseEffect(PaperlessDocumentPageSchema, documents);
    return compactCycle(cycle, currentDocuments);
  });
