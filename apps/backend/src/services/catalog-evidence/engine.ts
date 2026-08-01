import { type CatalogEpochId, CatalogEpochIdSchema } from "@repo/api-contracts";
import { Effect, Schema } from "effect";
import type { Document } from "../../models/index.js";
import { buildMergeCandidates, buildUnusedReviews } from "./blocking.js";
import {
  buildEvidenceReport,
  citationFor,
  selectEvidenceBatch,
  validateCitationIds,
} from "./evidence.js";
import { digest, shortHash } from "./hash.js";
import type { CatalogEvidenceReadPort } from "./read-port.js";
import { assignmentSets, readAssignmentReceipt } from "./receipts.js";
import type {
  CatalogDossierCitation,
  CatalogEvidenceEntity,
  CatalogEvidenceEpoch,
  CatalogEvidenceKind,
  CatalogEvidenceReport,
  CatalogEvidenceSnapshot,
  CatalogExpansionRecord,
  CatalogMergeCandidate,
  CatalogObservation,
  EntityAssignmentReceipt,
  FinalFreshnessCheck,
} from "./types.js";

const ALL_SCOPE: readonly CatalogEvidenceKind[] = ["tag", "correspondent", "document_type"];

const emptyEntities = (): Record<CatalogEvidenceKind, readonly CatalogEvidenceEntity[]> => ({
  tag: [],
  correspondent: [],
  document_type: [],
});

export interface BuildCatalogEvidenceEpochOptions {
  readonly scope?: readonly CatalogEvidenceKind[];
  readonly createdAt?: string;
  readonly pageLimit?: number;
  readonly maxScanAttempts?: number;
  readonly epochId?: CatalogEpochId | string;
}

const validateEpochId = (epochId: CatalogEpochId | string) =>
  Schema.decodeUnknown(CatalogEpochIdSchema)(epochId).pipe(
    Effect.mapError(() => new Error(`Invalid catalog evidence epoch ID: ${epochId}`)),
  );

const assertEntity = (
  epoch: CatalogEvidenceEpoch,
  kind: CatalogEvidenceKind,
  entityId: number,
): CatalogEvidenceEntity => {
  const entity = epoch.entities[kind].find((item) => item.id === entityId);
  if (!entity)
    throw new Error(`Catalog ${kind} ${entityId} was not found in epoch ${epoch.epochId}`);
  return entity;
};

const fetchDocuments = (readPort: CatalogEvidenceReadPort, documentIds: readonly number[]) =>
  Effect.forEach(
    [...new Set(documentIds)].sort((left, right) => left - right),
    (documentId) => readPort.getDocumentCitationSource(documentId),
    { concurrency: 4 },
  );

const paginateAllSnapshots = (readPort: CatalogEvidenceReadPort, pageLimit = 250) =>
  Effect.gen(function* () {
    const snapshots: CatalogEvidenceSnapshot[] = [];
    let cursor: string | undefined;

    do {
      const page = yield* readPort.listDocumentSnapshotsPage({ cursor, limit: pageLimit });
      for (const item of page.items) {
        snapshots.push({
          documentId: item.documentId,
          stateHash: item.stateHash,
          modified: item.modified,
          created: item.created,
          tagIds: item.tagIds,
          correspondentId: item.correspondentId,
          documentTypeId: item.documentTypeId,
          metadataSignature: item.metadataSignature,
          contentSignature: item.contentSignature,
        });
      }
      cursor = page.page.nextCursor ?? undefined;
    } while (cursor);

    return snapshots.sort((left, right) => left.documentId - right.documentId);
  });

const observationsMatch = (
  left: CatalogObservation,
  right: CatalogObservation,
  scope: readonly CatalogEvidenceKind[],
): boolean =>
  left.catalogFingerprint === right.catalogFingerprint &&
  left.freshnessFingerprint === right.freshnessFingerprint &&
  left.totalDocuments === right.totalDocuments &&
  scope.every((kind) => left.entityCounts[kind] === right.entityCounts[kind]);

const enumerationMatchesObservation = ({
  entities,
  snapshots,
  observation,
  scope,
}: {
  readonly entities: Readonly<Record<CatalogEvidenceKind, readonly CatalogEvidenceEntity[]>>;
  readonly snapshots: readonly CatalogEvidenceSnapshot[];
  readonly observation: CatalogObservation;
  readonly scope: readonly CatalogEvidenceKind[];
}): boolean =>
  snapshots.length === observation.totalDocuments &&
  scope.every((kind) => entities[kind].length === observation.entityCounts[kind]);

export const buildCatalogEvidenceEpoch = (
  readPort: CatalogEvidenceReadPort,
  options: BuildCatalogEvidenceEpochOptions = {},
) =>
  Effect.gen(function* () {
    const scope = [...new Set(options.scope ?? ALL_SCOPE)].sort() as CatalogEvidenceKind[];
    const createdAt = options.createdAt ?? new Date().toISOString();
    const maxScanAttempts = options.maxScanAttempts ?? 3;
    const providedEpochId =
      options.epochId === undefined ? null : yield* validateEpochId(options.epochId);

    for (let attempt = 1; attempt <= maxScanAttempts; attempt += 1) {
      const scanStart = yield* readPort.observeCatalog(scope);
      const policy = yield* readPort.getPolicy();
      const entities = emptyEntities();
      for (const kind of scope) {
        entities[kind] = [...(yield* readPort.listEntities(kind))].sort(
          (left, right) => left.id - right.id,
        );
      }
      const snapshots = yield* paginateAllSnapshots(readPort, options.pageLimit);
      const scanEnd = yield* readPort.observeCatalog(scope);
      const stable =
        observationsMatch(scanStart, scanEnd, scope) &&
        enumerationMatchesObservation({ entities, snapshots, observation: scanEnd, scope });

      if (!stable && attempt < maxScanAttempts) continue;
      if (!stable) {
        return yield* Effect.fail(
          new Error(`Catalog evidence epoch unstable after ${maxScanAttempts} scan attempts`),
        );
      }

      const catalogFingerprint = scanEnd.catalogFingerprint;
      const freshnessFingerprint = scanEnd.freshnessFingerprint;
      const epochFingerprint = digest("catalog_evidence_epoch", {
        catalogFingerprint,
        freshnessFingerprint,
        scope,
        createdAt,
        scanStart,
        scanEnd,
        entities: Object.fromEntries(
          scope.map((kind) => [
            kind,
            entities[kind].map((entity) => ({
              id: entity.id,
              name: entity.name,
              slug: entity.slug,
              document_count: entity.document_count ?? null,
              match: entity.match ?? null,
            })),
          ]),
        ),
      });

      return {
        epochId:
          providedEpochId ??
          (`cat_epoch_${shortHash(
            { catalogFingerprint, freshnessFingerprint, createdAt },
            24,
          )}` as CatalogEpochId),
        scope,
        createdAt,
        catalogFingerprint,
        freshnessFingerprint,
        epochFingerprint,
        scanStart,
        scanEnd,
        scanAttempts: attempt,
        unstable: false,
        totalDocuments: snapshots.length,
        entities,
        snapshots,
        policy,
      } satisfies CatalogEvidenceEpoch;
    }

    return yield* Effect.fail(new Error("Catalog evidence epoch scan did not run"));
  });

export const collectCandidateEvidence = (
  readPort: CatalogEvidenceReadPort,
  epoch: CatalogEvidenceEpoch,
  candidate: CatalogMergeCandidate,
  options: { readonly createdAt?: string; readonly batchSize?: number } = {},
): Effect.Effect<CatalogEvidenceReport, unknown> =>
  Effect.gen(function* () {
    const xEntity = assertEntity(epoch, candidate.kind, candidate.xEntityId);
    const yEntity = assertEntity(epoch, candidate.kind, candidate.yEntityId);
    const xReceipt = yield* readAssignmentReceipt({
      readPort,
      kind: candidate.kind,
      entity: xEntity,
    });
    const yReceipt = yield* readAssignmentReceipt({
      readPort,
      kind: candidate.kind,
      entity: yEntity,
    });
    const sets = assignmentSets(xReceipt.documentIds, yReceipt.documentIds);
    const receiptDocuments = [...xReceipt.documents, ...yReceipt.documents];
    const batch = selectEvidenceBatch({
      documentIds: sets.unionDocumentIds,
      receiptDocuments,
      snapshots: epoch.snapshots,
      batchSize: options.batchSize ?? 30,
      sets,
    });
    const citations = yield* fetchCitations({
      readPort,
      candidate,
      xReceipt,
      yReceipt,
      documentIds: batch.documentIds,
    });
    const finalFreshness =
      citations.length === sets.unionDocumentIds.length
        ? yield* finalFreshnessCheck({
            readPort,
            candidate,
            xEntity,
            yEntity,
            xReceipt,
            yReceipt,
          })
        : emptyFinalFreshness(false);

    return buildEvidenceReport({
      candidate,
      xReceipt,
      yReceipt,
      snapshots: epoch.snapshots,
      citations,
      expansions: [],
      finalFreshness,
      catalogFingerprint: epoch.catalogFingerprint,
      freshnessFingerprint: epoch.freshnessFingerprint,
      epochFingerprint: epoch.epochFingerprint,
    });
  });

const fetchCitations = ({
  readPort,
  candidate,
  xReceipt,
  yReceipt,
  documentIds,
}: {
  readonly readPort: CatalogEvidenceReadPort;
  readonly candidate: CatalogMergeCandidate;
  readonly xReceipt: EntityAssignmentReceipt;
  readonly yReceipt: EntityAssignmentReceipt;
  readonly documentIds: readonly number[];
}): Effect.Effect<readonly CatalogDossierCitation[], unknown> =>
  Effect.gen(function* () {
    const documents = (yield* fetchDocuments(readPort, documentIds)) as readonly Pick<
      Document,
      | "id"
      | "title"
      | "content"
      | "created"
      | "modified"
      | "correspondent"
      | "document_type"
      | "tags"
    >[];
    return documents
      .map((doc) => citationFor({ doc, candidateId: candidate.candidateId, xReceipt, yReceipt }))
      .sort((left, right) => left.documentId - right.documentId);
  });

export const expandCandidateEvidence = (
  readPort: CatalogEvidenceReadPort,
  dossier: CatalogEvidenceReport,
  request: { readonly documentIds: readonly number[]; readonly expandedAt?: string },
): Effect.Effect<CatalogEvidenceReport, unknown> =>
  Effect.gen(function* () {
    const union = new Set(dossier.assignmentSets.unionDocumentIds);
    const requested = [...new Set(request.documentIds)].sort((left, right) => left - right);
    const rejected = requested.filter((documentId) => !union.has(documentId));
    if (rejected.length > 0) {
      return yield* Effect.fail(
        new Error(
          `Expansion requested documents outside candidate receipts: ${rejected.join(",")}`,
        ),
      );
    }
    const inspected = new Set(dossier.inspectedDocumentIds);
    const accepted = requested.filter((documentId) => !inspected.has(documentId));
    const newCitations = yield* fetchCitations({
      readPort,
      candidate: dossier.candidate,
      xReceipt: dossier.xReceipt,
      yReceipt: dossier.yReceipt,
      documentIds: accepted,
    });
    const citationsById = new Map(
      [...dossier.citations, ...newCitations].map((citation) => [citation.documentId, citation]),
    );
    const citations = [...citationsById.values()].sort(
      (left, right) => left.documentId - right.documentId,
    );
    const expandedAt = request.expandedAt ?? new Date().toISOString();
    const expansion: CatalogExpansionRecord = {
      requestedDocumentIds: requested,
      acceptedDocumentIds: accepted,
      rejectedDocumentIds: [],
      expandedAt,
      expansionHash: digest("catalog_evidence_expansion", {
        candidateId: dossier.candidate.candidateId,
        requested,
        accepted,
        expandedAt,
      }),
    };
    const finalFreshness =
      citations.length === dossier.assignmentSets.unionDocumentIds.length
        ? yield* finalFreshnessCheck({
            readPort,
            candidate: dossier.candidate,
            xEntity: {
              id: dossier.xReceipt.entityId,
              name: dossier.xReceipt.name,
              slug: "",
            },
            yEntity: {
              id: dossier.yReceipt.entityId,
              name: dossier.yReceipt.name,
              slug: "",
            },
            xReceipt: dossier.xReceipt,
            yReceipt: dossier.yReceipt,
          })
        : dossier.finalFreshness;
    return buildEvidenceReport({
      candidate: dossier.candidate,
      xReceipt: dossier.xReceipt,
      yReceipt: dossier.yReceipt,
      snapshots: dossier.assignmentSnapshots,
      citations,
      expansions: [...dossier.expansions, expansion],
      finalFreshness,
      catalogFingerprint: dossier.catalogFingerprint,
      freshnessFingerprint: dossier.freshnessFingerprint,
      epochFingerprint: dossier.epochFingerprint,
    });
  });

const emptyFinalFreshness = (required: boolean): FinalFreshnessCheck => ({
  required,
  performed: false,
  complete: false,
  xReceiptHash: null,
  yReceiptHash: null,
  reproducedInitialReceipts: false,
  checkedAt: null,
});

const finalFreshnessCheck = ({
  readPort,
  candidate,
  xEntity,
  yEntity,
  xReceipt,
  yReceipt,
}: {
  readonly readPort: CatalogEvidenceReadPort;
  readonly candidate: CatalogMergeCandidate;
  readonly xEntity: CatalogEvidenceEntity;
  readonly yEntity: CatalogEvidenceEntity;
  readonly xReceipt: EntityAssignmentReceipt;
  readonly yReceipt: EntityAssignmentReceipt;
}): Effect.Effect<FinalFreshnessCheck, unknown> =>
  Effect.gen(function* () {
    const checkedAt = new Date().toISOString();
    const freshX = yield* readAssignmentReceipt({
      readPort,
      kind: candidate.kind,
      entity: xEntity,
    });
    const freshY = yield* readAssignmentReceipt({
      readPort,
      kind: candidate.kind,
      entity: yEntity,
    });
    const reproducedInitialReceipts =
      freshX.assignmentHash === xReceipt.assignmentHash &&
      freshY.assignmentHash === yReceipt.assignmentHash;
    return {
      required: true,
      performed: true,
      complete: freshX.complete && freshY.complete && reproducedInitialReceipts,
      xReceiptHash: freshX.stateHash,
      yReceiptHash: freshY.stateHash,
      reproducedInitialReceipts,
      checkedAt,
    } satisfies FinalFreshnessCheck;
  });

export const createCatalogEvidenceEngine = (readPort: CatalogEvidenceReadPort) => ({
  buildEpoch: (options?: Parameters<typeof buildCatalogEvidenceEpoch>[1]) =>
    buildCatalogEvidenceEpoch(readPort, options),
  blockCandidates: (epoch: CatalogEvidenceEpoch) => Effect.succeed(buildMergeCandidates(epoch)),
  listUnusedReviews: (epoch: CatalogEvidenceEpoch) => Effect.succeed(buildUnusedReviews(epoch)),
  collectEvidence: (
    epoch: CatalogEvidenceEpoch,
    candidate: CatalogMergeCandidate,
    options?: Parameters<typeof collectCandidateEvidence>[3],
  ) => collectCandidateEvidence(readPort, epoch, candidate, options),
  expandEvidence: (
    dossier: CatalogEvidenceReport,
    request: { readonly documentIds: readonly number[]; readonly expandedAt?: string },
  ) => expandCandidateEvidence(readPort, dossier, request),
  validateCitationIds: (
    candidateId: string,
    requestedCitationIds: readonly string[],
    evidence: CatalogEvidenceReport,
  ) =>
    Effect.try({
      try: () => validateCitationIds(candidateId, requestedCitationIds, evidence),
      catch: (error) => error,
    }),
});
