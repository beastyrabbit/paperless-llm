import {
  ApplyJournalSchema,
  type CatalogCandidate,
  CatalogCandidatePageSchema,
  CatalogCandidateSchema,
  type CatalogChairDecision,
  CatalogCurrentHashSchema,
  type CatalogEntityKind,
  type CatalogEpoch,
  type TypedApiErrorCode,
  CatalogEpochListQuerySchema,
  CatalogEpochPageSchema,
  CatalogEpochSchema,
  type CatalogFreshnessProjection,
  type CatalogProposalEvidenceExpired,
  type CatalogProposalPage,
  CatalogProposalPageSchema,
  CatalogProposalSchema,
  CouncilEvidencePageSchema,
  canonicalSha256,
  type HashPrecondition,
  type PageRequest,
} from "@repo/api-contracts";
import { Effect, Either } from "effect";
import { NotFoundError, ValidationError } from "../../errors/index.js";
import { CatalogEvidenceService } from "../../services/CatalogEvidenceService.js";
import type { Correspondent, CustomField, DocumentType, Tag } from "../../models/index.js";
import { catalogCouncilEntityFingerprint } from "../../services/catalog-council/index.js";
import { OperationalLedgerService } from "../../services/OperationalLedgerService.js";
import type {
  ApplyJournalRecord,
  CatalogEpochRecord,
  CatalogProposalValues,
  CompactChairDecisionRecord,
  CouncilRecord,
  OperationalLedgerData,
  ProposalRecord,
} from "../../services/operational-ledger/types.js";
import { PaperlessService } from "../../services/PaperlessService.js";
import type { PaperlessAssignmentReceipt } from "../../services/paperless/types.js";
import { pageRequestEffect, paginate, requestEffect, responseEffect } from "../query-utils.js";

const REQUIRED_REVIEWER_ROLES = [
  "taxonomy_curator",
  "document_evidence_auditor",
  "counterexample_hunter",
] as const;

const catalogKinds = new Set<CatalogEntityKind>([
  "tag",
  "correspondent",
  "document_type",
  "custom_field",
]);

const isCatalogKind = (value: string): value is CatalogEntityKind =>
  catalogKinds.has(value as CatalogEntityKind);

const catalogProposalRecords = (snapshot: OperationalLedgerData, epochId?: string) =>
  Object.values(snapshot.proposals)
    .filter((proposal) => proposal.scope === "catalog")
    .filter((proposal) => (epochId ? proposal.ownerId === epochId : true))
    .filter(
      (proposal): proposal is ProposalRecord & { readonly proposedValues: CatalogProposalValues } =>
        proposal.proposedValues?.scope === "catalog",
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

const epochDto = (epoch: CatalogEpochRecord, snapshot: OperationalLedgerData): CatalogEpoch => {
  const proposals = catalogProposalRecords(snapshot, epoch.epochId);
  const evidence = Object.values(snapshot.councilRecords).filter(
    (record) => record.epochId === epoch.epochId,
  );
  const candidates = new Set(proposals.flatMap((proposal) => proposal.proposedValues.candidateIds));
  return {
    epochId: epoch.epochId,
    state: epoch.state,
    scope: epoch.scope.filter(isCatalogKind),
    paperlessCatalogHash: epoch.paperlessCatalogHash,
    createdAt: epoch.createdAt,
    updatedAt: epoch.updatedAt,
    completedAt: epoch.completedAt,
    retryCount: epoch.retryCount,
    candidateCount: Math.max(epoch.candidateCount, candidates.size),
    evidenceCount: Math.max(epoch.evidenceCount, evidence.length),
    proposalCount: Math.max(epoch.proposalCount, proposals.length),
  };
};

export const listCatalogEpochs = (
  request: PageRequest & { readonly state?: string; readonly kind?: string } = {},
) =>
  Effect.gen(function* () {
    const pageRequest = yield* requestEffect(CatalogEpochListQuerySchema, request, [
      "cursor",
      "limit",
      "state",
      "kind",
    ]);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const epochs = Object.values(snapshot.catalogEpochs)
      .filter((epoch) => (pageRequest.state ? epoch.state === pageRequest.state : true))
      .filter((epoch) => (pageRequest.kind ? epoch.scope.includes(pageRequest.kind) : true))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const page = paginate(epochs, pageRequest);
    const items = page.items.map((epoch) => epochDto(epoch, snapshot));
    return yield* responseEffect(CatalogEpochPageSchema, { items, page: page.page });
  });

export const getCatalogEpoch = (epochId: string) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const epoch = snapshot.catalogEpochs[epochId];
    if (!epoch) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog epoch ${epochId} not found`,
          resource: "catalog_epoch",
          id: epochId,
        }),
      );
    }
    return yield* responseEffect(CatalogEpochSchema, epochDto(epoch, snapshot));
  });

const SUPPORTED_SCOPE_KINDS = new Set<CatalogEntityKind>([
  "tag",
  "correspondent",
  "document_type",
]);

/**
 * Typed degradation error for the catalog-hash GET. `toHttpError` renders any
 * error carrying `{ status, code, message }` into the frozen TypedApiError body,
 * so a Paperless read failure surfaces as a typed 503 (not an opaque 500).
 */
export class CatalogQueryError extends Error {
  constructor(
    readonly status: 502 | 503,
    readonly code: TypedApiErrorCode,
    message: string,
  ) {
    super(message.slice(0, 1_200));
    this.name = "CatalogQueryError";
  }
}

/**
 * Side-effect-free hydration of the current Paperless catalog precondition for a
 * scope. Returns the same `catalogFingerprint` a fresh epoch scan observes, so
 * the very first manual epoch can source its `expectedPaperlessCatalogHash`
 * without a prior epoch. No mutation (GET).
 */
export const getCurrentCatalogHash = (rawScope: readonly string[]) =>
  Effect.gen(function* () {
    const unique = [...new Set(rawScope)];
    if (unique.length === 0) {
      return yield* Effect.fail(
        new ValidationError({
          message: "At least one catalog entity kind is required",
          field: "kind",
        }),
      );
    }
    if (unique.includes("custom_field")) {
      return yield* Effect.fail(
        new ValidationError({
          message: "custom_field is not supported for catalog optimization",
          field: "kind",
        }),
      );
    }
    const scope = unique.filter((kind): kind is "tag" | "correspondent" | "document_type" =>
      SUPPORTED_SCOPE_KINDS.has(kind as CatalogEntityKind),
    );
    if (scope.length !== unique.length) {
      return yield* Effect.fail(
        new ValidationError({ message: "Unknown catalog entity kind", field: "kind" }),
      );
    }
    const evidence = yield* CatalogEvidenceService;
    const paperlessCatalogHash = yield* evidence.observeCatalogFingerprint(scope).pipe(
      Effect.mapError(
        (cause) =>
          new CatalogQueryError(
            503,
            "PAPERLESS_UNAVAILABLE",
            `Could not observe the current Paperless catalog: ${
              cause instanceof Error ? cause.message : String(cause)
            }`,
          ),
      ),
    );
    return yield* responseEffect(CatalogCurrentHashSchema, {
      paperlessCatalogHash,
      scope: [...scope],
    });
  });

const entityName = (
  kind: CatalogEntityKind,
  entityId: number,
): Effect.Effect<string, unknown, PaperlessService> =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const values: readonly (Tag | Correspondent | DocumentType | CustomField)[] =
      kind === "tag"
        ? yield* paperless.getTags()
        : kind === "correspondent"
          ? yield* paperless.getCorrespondents()
          : kind === "document_type"
            ? yield* paperless.getDocumentTypes()
            : yield* paperless.getCustomFields();
    const entity = values.find((value) => value.id === entityId);
    if (!entity) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog ${kind} ${entityId} not found`,
          resource: kind,
          id: entityId,
        }),
      );
    }
    return entity.name;
  });

const liveReceipt = (
  kind: CatalogEntityKind,
  entityId: number,
): Effect.Effect<PaperlessAssignmentReceipt | null, unknown, PaperlessService> =>
  Effect.gen(function* () {
    if (kind === "custom_field") return null;
    const paperless = yield* PaperlessService;
    if (kind === "tag") return yield* paperless.readTagAssignmentReceipt(entityId);
    if (kind === "correspondent") {
      return yield* paperless.readCorrespondentAssignmentReceipt(entityId);
    }
    return yield* paperless.readDocumentTypeAssignmentReceipt(entityId);
  });

const candidateReceipt = (
  kind: CatalogEntityKind,
  entityId: number,
): Effect.Effect<CatalogCandidate["x"], unknown, PaperlessService> =>
  Effect.gen(function* () {
    const [name, receipt] = yield* Effect.all([
      entityName(kind, entityId),
      liveReceipt(kind, entityId),
    ]);
    const documentIds = receipt?.documentIds ?? [];
    return {
      entityId,
      nameHash: canonicalSha256({ kind, entityId, name }),
      receiptCount: receipt?.fetchedCount ?? 0,
      documentIdsHash: canonicalSha256([...documentIds].sort((left, right) => left - right)),
      // Transient live name (never persisted) so the UI can render it beside the id.
      name,
    };
  });

/**
 * A side-effect-free snapshot of an entity's current Paperless name. Falls back
 * to `null` when the entity no longer exists (e.g. already deleted/merged).
 */
const entitySnapshot = (
  kind: CatalogEntityKind,
  entityId: number,
): Effect.Effect<{ readonly entityId: number; readonly kind: CatalogEntityKind; readonly name: string | null }, never, PaperlessService> =>
  entityName(kind, entityId).pipe(
    Effect.map((name) => ({ entityId, kind, name })),
    Effect.catchAll(() => Effect.succeed({ entityId, kind, name: null })),
  );

const defaultPreconditions = (
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
): readonly HashPrecondition[] => proposal.preconditions;

const hydrateCandidate = (
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
  candidateId: string,
  epoch: CatalogEpochRecord,
): Effect.Effect<CatalogCandidate, unknown, PaperlessService> =>
  Effect.gen(function* () {
    const values = proposal.proposedValues;
    const x = yield* candidateReceipt(values.entityKind, values.sourceEntityId);
    const y =
      values.targetEntityId === null
        ? null
        : yield* candidateReceipt(values.entityKind, values.targetEntityId);
    return yield* responseEffect(CatalogCandidateSchema, {
      candidateId,
      epochId: epoch.epochId,
      kind: values.entityKind,
      intendedAction: values.intendedAction,
      x,
      y,
      proposedValue: values.proposedValue,
      expectedEvidenceFingerprint: values.expectedEvidenceFingerprint,
      expectedProposalFingerprint: values.expectedProposalFingerprint,
      preconditions: defaultPreconditions(proposal),
      rationale: proposal.rationale,
      createdAt: proposal.createdAt,
    });
  });

export const listCatalogCandidates = (epochId: string, request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const epoch = snapshot.catalogEpochs[epochId];
    if (!epoch) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog epoch ${epochId} not found`,
          resource: "catalog_epoch",
          id: epochId,
        }),
      );
    }
    const candidates = catalogProposalRecords(snapshot, epochId).flatMap((proposal) =>
      proposal.proposedValues.candidateIds.map((candidateId) => ({ proposal, candidateId })),
    );
    const page = paginate(candidates, pageRequest);
    const items = yield* Effect.all(
      page.items.map(({ proposal, candidateId }) => hydrateCandidate(proposal, candidateId, epoch)),
      { concurrency: 8 },
    );
    return yield* responseEffect(CatalogCandidatePageSchema, { items, page: page.page });
  });

const evidenceDto = (record: CouncilRecord) => ({
  evidenceId: record.evidenceId,
  epochId: record.epochId,
  candidateId: record.candidateId,
  reviewer: record.reviewer,
  evidenceDocumentIds: [...record.evidenceDocumentIds],
  inspectedDocuments: record.inspectedDocuments,
  totalDocuments: record.totalDocuments,
  coverage: record.coverage,
  xReceiptCount: record.xReceiptCount,
  yReceiptCount: record.yReceiptCount,
  xReceiptHash: record.xReceiptHash,
  yReceiptHash: record.yReceiptHash,
  verdict: record.verdict,
  dissent: record.dissent,
  counterexamples: [],
  rationale: record.rationale,
  evidenceFingerprint: record.evidenceFingerprint,
  createdAt: record.createdAt,
});

const proposalForCouncilRecord = (snapshot: OperationalLedgerData, record: CouncilRecord) =>
  record.proposalId
    ? catalogProposalRecords(snapshot, record.epochId).find(
        (proposal) => proposal.proposalId === record.proposalId,
      )
    : catalogProposalRecords(snapshot, record.epochId).find((proposal) =>
        proposal.proposedValues.candidateIds.includes(record.candidateId),
      );

const receiptDocumentIds = (receipt: PaperlessAssignmentReceipt | null): readonly number[] =>
  receipt?.documentIds ?? [];

const hash = (kind: string, value: unknown) => canonicalSha256({ kind, value });

const idsHash = (ids: readonly number[]) =>
  hash(
    "catalog_evidence_document_ids",
    [...ids].sort((left, right) => left - right),
  );

const receiptStateHash = (nameHash: ReturnType<typeof hash>, receipt: PaperlessAssignmentReceipt) =>
  hash("catalog_evidence_entity_receipt", {
    kind: receipt.kind,
    entityId: receipt.entityId,
    nameHash,
    filterDescriptor: receipt.filterDescriptor,
    expectedApiCount: receipt.expectedApiCount,
    fetchedCount: receipt.fetchedCount,
    pageCount: receipt.pageCount,
    capturedAt: receipt.capturedAt,
    documentIds: [...receipt.documentIds].sort((left, right) => left - right),
    documents: [...receipt.documents].sort((left, right) => left.documentId - right.documentId),
    assignmentHash: receipt.assignmentHash,
  });

interface LiveEntityProof {
  readonly entityId: number;
  readonly nameHash: ReturnType<typeof hash>;
  readonly receiptCount: number;
  readonly documentIdsHash: ReturnType<typeof idsHash>;
  readonly assignmentHash: PaperlessAssignmentReceipt["assignmentHash"];
  readonly stateHash: ReturnType<typeof receiptStateHash>;
  readonly receipt: PaperlessAssignmentReceipt;
}

const liveEntityProof = (
  kind: CatalogEntityKind,
  entityId: number,
): Effect.Effect<LiveEntityProof, unknown, PaperlessService> =>
  Effect.gen(function* () {
    const name = yield* entityName(kind, entityId);
    const receipt = yield* liveReceipt(kind, entityId);
    if (!receipt) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog ${kind} ${entityId} has no assignment receipt`,
          resource: kind,
          id: entityId,
        }),
      );
    }
    const nameHash = hash("catalog_evidence_entity_name", { kind, entityId, name });
    return {
      entityId,
      nameHash,
      receiptCount: receipt.fetchedCount,
      documentIdsHash: idsHash(receipt.documentIds),
      assignmentHash: receipt.assignmentHash,
      stateHash: receiptStateHash(nameHash, receipt),
      receipt,
    };
  });

const receiptUnion = (
  xReceipt: PaperlessAssignmentReceipt | null,
  yReceipt: PaperlessAssignmentReceipt | null,
): ReadonlySet<number> =>
  new Set([...receiptDocumentIds(xReceipt), ...receiptDocumentIds(yReceipt)]);

const hasOnlyLiveReceiptDocuments = (
  documentIds: readonly number[],
  liveDocuments: ReadonlySet<number>,
) => documentIds.every((documentId) => liveDocuments.has(documentId));

const liveReceiptsFor = (
  values: CatalogProposalValues,
): Effect.Effect<
  | {
      readonly status: "available";
      readonly xProof: LiveEntityProof;
      readonly yProof: LiveEntityProof | null;
    }
  | { readonly status: "current_missing" },
  unknown,
  PaperlessService
> =>
  Effect.gen(function* () {
    const xProof = yield* Effect.either(liveEntityProof(values.entityKind, values.sourceEntityId));
    const yProof =
      values.targetEntityId === null
        ? Either.right(null)
        : yield* Effect.either(liveEntityProof(values.entityKind, values.targetEntityId));
    if (Either.isLeft(xProof) || Either.isLeft(yProof)) return { status: "current_missing" };
    return {
      status: "available",
      xProof: xProof.right,
      yProof: yProof.right,
    };
  });

const liveReceiptPreconditions = (receipts: {
  readonly xProof: LiveEntityProof;
  readonly yProof: LiveEntityProof | null;
}): readonly HashPrecondition[] => [
  { kind: "council_evidence", digest: receipts.xProof.stateHash },
  ...(receipts.yProof
    ? ([{ kind: "council_evidence", digest: receipts.yProof.stateHash }] as const)
    : []),
];

const expectedReceiptHashes = (records: readonly CouncilRecord[]) =>
  records.flatMap((record) => [
    record.xReceiptHash,
    ...(record.yReceiptHash ? [record.yReceiptHash] : []),
  ]);

const hasChangedReceipts = (
  records: readonly CouncilRecord[],
  receipts: {
    readonly xProof: LiveEntityProof;
    readonly yProof: LiveEntityProof | null;
  },
) => {
  const currentHashes = new Set([
    receipts.xProof.stateHash,
    receipts.xProof.assignmentHash,
    ...(receipts.yProof ? [receipts.yProof.stateHash, receipts.yProof.assignmentHash] : []),
  ]);
  return expectedReceiptHashes(records).some((hash) => !currentHashes.has(hash));
};

const entityFingerprint = ({
  label,
  kind,
  proof,
  values,
}: {
  readonly label: "source" | "target";
  readonly kind: CatalogEntityKind;
  readonly proof: LiveEntityProof;
  readonly values: CatalogProposalValues;
}) =>
  catalogCouncilEntityFingerprint({
    label,
    kind,
    entityId: proof.entityId,
    currentNameHash: proof.nameHash,
    receiptHash: proof.stateHash,
    assignmentHash: proof.assignmentHash,
    receiptCount: proof.receiptCount,
    documentIdsHash: proof.documentIdsHash,
    safetyInputs: {
      candidateRiskFlags: values.candidateRiskFlags,
      coverageRiskFlags: values.coverageRiskFlags,
      requiresHumanReview: values.requiresHumanReview,
      applicationBlockedReasons: values.applicationBlockedReasons,
    },
  });

const hasReplayableSafetyInputs = (values: CatalogProposalValues): boolean =>
  Array.isArray(values.candidateRiskFlags) &&
  Array.isArray(values.coverageRiskFlags) &&
  typeof values.requiresHumanReview === "boolean" &&
  Array.isArray(values.applicationBlockedReasons);

const hasStoredEntityFingerprints = (
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
  proofs: {
    readonly xProof: LiveEntityProof;
    readonly yProof: LiveEntityProof | null;
  },
) => {
  if (!hasReplayableSafetyInputs(proposal.proposedValues)) return false;
  if (!proofs.yProof) return false;
  const preconditionDigests = new Set(
    proposal.preconditions.map((precondition) => precondition.digest),
  );
  const source = entityFingerprint({
    label: "source",
    kind: proposal.proposedValues.entityKind,
    proof: proofs.xProof,
    values: proposal.proposedValues,
  });
  const target = entityFingerprint({
    label: "target",
    kind: proposal.proposedValues.entityKind,
    proof: proofs.yProof,
    values: proposal.proposedValues,
  });
  return preconditionDigests.has(source) && preconditionDigests.has(target);
};

const expiredEvidence = (
  reason: CatalogProposalEvidenceExpired["reason"],
): CatalogProposalEvidenceExpired => ({
  availability: "evidence_expired",
  needsReview: true,
  requiresRefresh: true,
  reason,
});

const freshnessProjection = (
  expectedPreconditions: readonly HashPrecondition[],
  status: CatalogFreshnessProjection["status"],
  currentPreconditions?: readonly HashPrecondition[],
): CatalogFreshnessProjection => ({
  status,
  stale: status === "stale",
  currentMissing: status === "current_missing",
  expectedPreconditions,
  currentPreconditions,
});

const chairDecisionDto = (chair: CompactChairDecisionRecord): CatalogChairDecision => ({
  availability: "decision_recorded",
  verdict: chair.verdict,
  action: chair.action,
  sourceEntityId: chair.sourceEntityId,
  targetEntityId: chair.targetEntityId,
  rationale: chair.rationale,
  dissent: chair.dissent,
  evidenceIds: [...chair.evidenceIds],
  confidence: chair.confidence,
  proposalFingerprint: chair.proposalFingerprint,
  evidenceFingerprint: chair.evidenceFingerprint,
  coverageHash: chair.coverageHash,
  coverageCount: chair.coverageCount,
  inspectedDocumentCount: chair.inspectedDocumentCount,
  totalDocumentCount: chair.totalDocumentCount,
  decidedAt: chair.decidedAt,
});

const chairMatchesProposal = (
  chair: CompactChairDecisionRecord,
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
  epoch: CatalogEpochRecord,
) =>
  chair.epochId === epoch.epochId &&
  chair.proposalId === proposal.proposalId &&
  chair.sourceEntityId === proposal.proposedValues.sourceEntityId &&
  chair.targetEntityId === proposal.proposedValues.targetEntityId &&
  chair.proposalFingerprint === proposal.proposedValues.expectedProposalFingerprint &&
  chair.evidenceFingerprint === proposal.proposedValues.expectedEvidenceFingerprint &&
  chair.candidateIds.every((candidateId) =>
    proposal.proposedValues.candidateIds.includes(candidateId),
  );

const latestApplyJournalForProposal = (
  snapshot: OperationalLedgerData,
  proposalId: string,
): ApplyJournalRecord | null =>
  Object.values(snapshot.applyJournals)
    .filter((journal) => journal.proposalId === proposalId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;

const validateChairEvidence = (
  chair: CompactChairDecisionRecord,
  councilRecords: readonly CouncilRecord[],
  liveDocuments: ReadonlySet<number>,
) => {
  if (
    chair.totalDocumentCount !== liveDocuments.size ||
    chair.inspectedDocumentCount !== liveDocuments.size ||
    chair.coverageCount !== liveDocuments.size
  ) {
    return null;
  }
  const byId = new Map(councilRecords.map((record) => [record.evidenceId, record]));
  const selected = chair.evidenceIds.map((evidenceId) => byId.get(evidenceId));
  if (selected.some((record) => record === undefined)) return null;
  const records = selected as CouncilRecord[];
  const roles = new Set(records.map((record) => record.reviewer));
  if (!REQUIRED_REVIEWER_ROLES.every((role) => roles.has(role))) return null;
  if (
    records.some(
      (record) =>
        record.proposalFingerprint !== chair.proposalFingerprint ||
        record.evidenceFingerprint !== chair.evidenceFingerprint ||
        !hasOnlyLiveReceiptDocuments(record.evidenceDocumentIds, liveDocuments),
    )
  ) {
    return null;
  }
  const documentIds = [...new Set(records.flatMap((record) => record.evidenceDocumentIds))].sort(
    (left, right) => left - right,
  );
  if (documentIds.length !== liveDocuments.size) return null;
  if (!documentIds.every((documentId) => liveDocuments.has(documentId))) return null;
  return documentIds.length > 0 ? documentIds : null;
};

const catalogProposalFreshness = (
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
  records: readonly CouncilRecord[],
  liveReceipts:
    | {
        readonly status: "available";
        readonly xProof: LiveEntityProof;
        readonly yProof: LiveEntityProof | null;
      }
    | { readonly status: "current_missing" },
  expectedPreconditions: readonly HashPrecondition[],
) => {
  if (liveReceipts.status === "current_missing") {
    return freshnessProjection(expectedPreconditions, "current_missing");
  }
  const currentPreconditions = liveReceiptPreconditions(liveReceipts);
  return freshnessProjection(
    expectedPreconditions,
    hasChangedReceipts(records, liveReceipts) ||
      !hasStoredEntityFingerprints(proposal, liveReceipts)
      ? "stale"
      : "fresh",
    currentPreconditions.length > 0 ? currentPreconditions : undefined,
  );
};

export const listCatalogEvidence = (epochId: string, request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    if (!snapshot.catalogEpochs[epochId]) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog epoch ${epochId} not found`,
          resource: "catalog_epoch",
          id: epochId,
        }),
      );
    }
    const records = yield* Effect.all(
      Object.values(snapshot.councilRecords)
        .filter((record) => record.epochId === epochId)
        .filter((record) => record.evidenceDocumentIds.length > 0)
        .map((record) =>
          Effect.gen(function* () {
            const proposal = proposalForCouncilRecord(snapshot, record);
            if (!proposal) return null;
            const receipts = yield* liveReceiptsFor(proposal.proposedValues);
            if (receipts.status === "current_missing") return null;
            return hasOnlyLiveReceiptDocuments(
              record.evidenceDocumentIds,
              receiptUnion(receipts.xProof.receipt, receipts.yProof?.receipt ?? null),
            )
              ? record
              : null;
          }),
        ),
      { concurrency: 8 },
    );
    const page = paginate(
      records
        .filter((record): record is CouncilRecord => record !== null)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
      pageRequest,
    );
    return yield* responseEffect(CouncilEvidencePageSchema, {
      items: page.items.map(evidenceDto),
      page: page.page,
    });
  });

const hydrateProposal = (
  proposal: ProposalRecord & { readonly proposedValues: CatalogProposalValues },
  epoch: CatalogEpochRecord,
  snapshot: OperationalLedgerData,
): Effect.Effect<CatalogProposalPage["items"][number], unknown, PaperlessService> =>
  Effect.gen(function* () {
    const values = proposal.proposedValues;
    const latestApplyJournal = latestApplyJournalForProposal(snapshot, proposal.proposalId);
    const expectedPreconditions = defaultPreconditions(proposal);
    const matchingCouncilRecords = Object.values(snapshot.councilRecords).filter(
      (record) =>
        record.epochId === epoch.epochId &&
        (record.proposalId === proposal.proposalId ||
          values.candidateIds.includes(record.candidateId)),
    );
    const liveReceipts = yield* liveReceiptsFor(values);
    const freshness = catalogProposalFreshness(
      proposal,
      matchingCouncilRecords,
      liveReceipts,
      expectedPreconditions,
    );
    const chair = snapshot.chairDecisions[proposal.proposalId];
    const liveDocuments =
      liveReceipts.status === "available"
        ? receiptUnion(liveReceipts.xProof.receipt, liveReceipts.yProof?.receipt ?? null)
        : new Set<number>();
    const evidenceDocumentIds =
      chair &&
      chairMatchesProposal(chair, proposal, epoch) &&
      liveReceipts.status === "available" &&
      hasStoredEntityFingerprints(proposal, liveReceipts) &&
      freshness.status === "fresh"
        ? validateChairEvidence(chair, matchingCouncilRecords, liveDocuments)
        : null;
    const evidence =
      chair && evidenceDocumentIds
        ? {
            availability: "available" as const,
            evidenceDocumentIds,
            chair: chairDecisionDto(chair),
          }
        : expiredEvidence(chair ? "process_restarted" : "chair_decision_missing");
    const currentEntities = {
      x: yield* entitySnapshot(values.entityKind, values.sourceEntityId),
      y:
        values.targetEntityId === null
          ? null
          : yield* entitySnapshot(values.entityKind, values.targetEntityId),
    };
    return yield* responseEffect(CatalogProposalSchema, {
      projectionVersion: "catalog_proposal_projection.v2",
      proposalId: proposal.proposalId,
      epochId: epoch.epochId,
      kind: values.entityKind,
      intendedAction: values.intendedAction,
      xEntityId: values.sourceEntityId,
      yEntityId: values.targetEntityId,
      currentEntities,
      proposedValue: values.proposedValue,
      candidateIds: [...values.candidateIds],
      evidence,
      expectedProposalFingerprint: values.expectedProposalFingerprint,
      expectedEvidenceFingerprint: values.expectedEvidenceFingerprint,
      proposalHash: proposal.proposalHash,
      preconditions: expectedPreconditions,
      freshness,
      decision: {
        status: proposal.decision,
        outcome: proposal.outcome,
        decidedAt: proposal.decidedAt,
      },
      apply: latestApplyJournal
        ? {
            status: latestApplyJournal.status,
            latestJournalId: latestApplyJournal.journalId,
            stepCount: latestApplyJournal.stepCount,
            updatedAt: latestApplyJournal.updatedAt,
          }
        : {
            status: "not_started" as const,
            latestJournalId: null,
            stepCount: 0,
            updatedAt: null,
          },
      rationale: proposal.rationale,
      createdAt: proposal.createdAt,
    });
  });

export const listCatalogProposals = (epochId: string, request: PageRequest = {}) =>
  Effect.gen(function* () {
    const pageRequest = yield* pageRequestEffect(request);
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const epoch = snapshot.catalogEpochs[epochId];
    if (!epoch) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog epoch ${epochId} not found`,
          resource: "catalog_epoch",
          id: epochId,
        }),
      );
    }
    const records = catalogProposalRecords(snapshot, epochId);
    const page = paginate(records, pageRequest);
    const items = yield* Effect.all(
      page.items.map((proposal) => hydrateProposal(proposal, epoch, snapshot)),
      { concurrency: 4 },
    );
    return yield* responseEffect(CatalogProposalPageSchema, { items, page: page.page });
  });

export const getCatalogApplyJournal = (proposalId: string) =>
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    const snapshot = yield* ledger.getSnapshot();
    const proposal = snapshot.proposals[proposalId];
    const journal = Object.values(snapshot.applyJournals)
      .filter((candidate) => candidate.proposalId === proposalId)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
    if (!proposal || !journal) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Catalog apply journal for proposal ${proposalId} not found`,
          resource: "catalog_apply_journal",
          id: proposalId,
        }),
      );
    }

    return yield* responseEffect(ApplyJournalSchema, {
      journalId: journal.journalId,
      proposalId: journal.proposalId,
      epochId: journal.epochId,
      idempotencyKey: journal.idempotencyKeyHash,
      status: journal.status,
      preconditions:
        proposal.preconditions.length > 0
          ? proposal.preconditions
          : journal.preconditionHashes.map((digest) => ({ kind: "catalog_epoch" as const, digest })),
      steps: journal.steps,
      createdAt: journal.createdAt,
      updatedAt: journal.updatedAt,
    });
  });
