import { canonicalSha256, type Sha256Digest } from "@repo/api-contracts";
import { Context, Effect, Layer } from "effect";
import {
  type BuildCatalogEvidenceEpochOptions,
  type CatalogDossierCitation,
  type CatalogEvidenceEpoch,
  type CatalogEvidenceKind,
  type CatalogEvidencePolicy,
  type CatalogEvidenceReport,
  type CatalogMergeCandidate,
  type CatalogUnusedReview,
  createCatalogEvidenceEngine,
} from "./catalog-evidence/index.js";
import type { CatalogEvidenceReadPort as CatalogEvidenceReadPortContract } from "./catalog-evidence/read-port.js";
import { PaperlessService } from "./PaperlessService.js";

export interface CatalogEvidenceService {
  readonly buildEpoch: (
    options?: BuildCatalogEvidenceEpochOptions,
  ) => Effect.Effect<CatalogEvidenceEpoch, unknown>;
  readonly blockCandidates: (
    epoch: CatalogEvidenceEpoch,
  ) => Effect.Effect<readonly CatalogMergeCandidate[], unknown>;
  readonly listUnusedReviews: (
    epoch: CatalogEvidenceEpoch,
  ) => Effect.Effect<readonly CatalogUnusedReview[], unknown>;
  readonly collectEvidence: (
    epoch: CatalogEvidenceEpoch,
    candidate: CatalogMergeCandidate,
    options?: { readonly createdAt?: string; readonly batchSize?: number },
  ) => Effect.Effect<CatalogEvidenceReport, unknown>;
  readonly expandEvidence: (
    dossier: CatalogEvidenceReport,
    request: { readonly documentIds: readonly number[]; readonly expandedAt?: string },
  ) => Effect.Effect<CatalogEvidenceReport, unknown>;
  readonly validateCitationIds: (
    candidateId: string,
    requestedCitationIds: readonly string[],
    evidence: CatalogEvidenceReport,
  ) => Effect.Effect<readonly CatalogDossierCitation[], unknown>;
  /**
   * Side-effect-free observation of the current Paperless catalog fingerprint
   * for a scope — the same `catalogFingerprint` a fresh epoch scan produces.
   * Lets the very first manual epoch source its `expectedPaperlessCatalogHash`
   * precondition without a prior epoch. No mutation.
   */
  readonly observeCatalogFingerprint: (
    scope: readonly CatalogEvidenceKind[],
  ) => Effect.Effect<Sha256Digest, unknown>;
}

export const CatalogEvidenceService =
  Context.GenericTag<CatalogEvidenceService>("CatalogEvidenceService");

export const CatalogEvidenceReadPort =
  Context.GenericTag<CatalogEvidenceReadPortContract>("CatalogEvidenceReadPort");

export const CatalogEvidenceServiceLive = Layer.effect(
  CatalogEvidenceService,
  Effect.gen(function* () {
    const readPort = yield* CatalogEvidenceReadPort;
    const engine = createCatalogEvidenceEngine(readPort);
    return {
      ...engine,
      observeCatalogFingerprint: (scope: readonly CatalogEvidenceKind[]) =>
        Effect.map(readPort.observeCatalog(scope), (observation) => observation.catalogFingerprint),
    } satisfies CatalogEvidenceService;
  }),
);

export const makeCatalogEvidenceReadPortFromPaperlessLive = (
  policy: CatalogEvidencePolicy,
): Layer.Layer<CatalogEvidenceReadPortContract, unknown, PaperlessService> =>
  Layer.effect(
    CatalogEvidenceReadPort,
    Effect.gen(function* () {
      const paperless = yield* PaperlessService;
      const listEntities = (kind: CatalogEvidenceKind) => {
        if (kind === "tag") return paperless.getTags();
        if (kind === "correspondent") return paperless.getCorrespondents();
        return paperless.getDocumentTypes();
      };
      const listAllDocumentSnapshots = Effect.gen(function* () {
        const snapshots = [];
        let cursor: string | undefined;
        do {
          const page = yield* paperless.listDocumentsPage({ cursor, limit: 250 });
          for (const item of page.items) {
            snapshots.push({
              documentId: item.documentId,
              stateHash: canonicalSha256({
                kind: "catalog_evidence_adapter_document_state",
                documentId: item.documentId,
                modified: item.modified,
                correspondentId: item.correspondentId,
                documentTypeId: item.documentTypeId,
                tagIds: [...item.tagIds].sort((left, right) => left - right),
              }),
              modified: item.modified,
              tagIds: item.tagIds,
              correspondentId: item.correspondentId,
              documentTypeId: item.documentTypeId,
              metadataSignature: canonicalSha256({
                kind: "catalog_evidence_adapter_metadata_signature",
                documentId: item.documentId,
                correspondentId: item.correspondentId,
                documentTypeId: item.documentTypeId,
                tagIds: [...item.tagIds].sort((left, right) => left - right),
              }),
            });
          }
          cursor = page.page.nextCursor ?? undefined;
        } while (cursor);
        return snapshots.sort((left, right) => left.documentId - right.documentId);
      });
      return {
        observeCatalog: (scope) =>
          Effect.gen(function* () {
            const entityCounts = {
              tag: 0,
              correspondent: 0,
              document_type: 0,
            };
            const entities = [];
            for (const kind of scope) {
              const items = yield* listEntities(kind);
              entityCounts[kind] = items.length;
              entities.push({
                kind,
                items: items.map((item) => ({
                  id: item.id,
                  name: item.name,
                  slug: item.slug,
                  document_count: item.document_count ?? null,
                  match: item.match ?? null,
                })),
              });
            }
            const snapshots = yield* listAllDocumentSnapshots;
            const catalogFingerprint = canonicalSha256({
              kind: "catalog_evidence_adapter_catalog_observation",
              scope,
              entities,
            });
            const freshnessFingerprint = canonicalSha256({
              kind: "catalog_evidence_adapter_freshness_observation",
              catalogFingerprint,
              snapshots: snapshots.map((snapshot) => ({
                documentId: snapshot.documentId,
                stateHash: snapshot.stateHash,
                modified: snapshot.modified,
                correspondentId: snapshot.correspondentId,
                documentTypeId: snapshot.documentTypeId,
                tagIds: [...snapshot.tagIds].sort((left, right) => left - right),
              })),
            });
            return {
              observedAt: new Date().toISOString(),
              catalogFingerprint,
              freshnessFingerprint,
              entityCounts,
              totalDocuments: snapshots.length,
            };
          }),
        getPolicy: () => Effect.succeed(policy),
        listEntities,
        listDocumentSnapshotsPage: (request) =>
          Effect.gen(function* () {
            const page = yield* paperless.listDocumentsPage(request);
            return {
              items: page.items.map((item) => ({
                documentId: item.documentId,
                stateHash: canonicalSha256({
                  kind: "catalog_evidence_adapter_document_state",
                  documentId: item.documentId,
                  modified: item.modified,
                  correspondentId: item.correspondentId,
                  documentTypeId: item.documentTypeId,
                  tagIds: [...item.tagIds].sort((left, right) => left - right),
                }),
                modified: item.modified,
                tagIds: item.tagIds,
                correspondentId: item.correspondentId,
                documentTypeId: item.documentTypeId,
                metadataSignature: canonicalSha256({
                  kind: "catalog_evidence_adapter_metadata_signature",
                  documentId: item.documentId,
                  correspondentId: item.correspondentId,
                  documentTypeId: item.documentTypeId,
                  tagIds: [...item.tagIds].sort((left, right) => left - right),
                }),
              })),
              page: page.page,
            };
          }),
        readAssignmentReceipt: (kind, entityId) => {
          if (kind === "tag") return paperless.readTagAssignmentReceipt(entityId);
          if (kind === "correspondent") {
            return paperless.readCorrespondentAssignmentReceipt(entityId);
          }
          return paperless.readDocumentTypeAssignmentReceipt(entityId);
        },
        getDocumentCitationSource: (documentId) => paperless.getDocument(documentId),
      } satisfies CatalogEvidenceReadPortContract;
    }),
  );

export const CatalogEvidenceReadPortFromPaperlessLive = Layer.fail(
  new Error(
    "CatalogEvidenceReadPortFromPaperlessLive requires a resolved CatalogEvidencePolicy; use makeCatalogEvidenceReadPortFromPaperlessLive(policy).",
  ),
);

export type {
  AssignmentSets,
  BoundedExcerpt,
  CatalogCandidateExclusion,
  CatalogDossierCitation,
  CatalogEvidenceEpoch,
  CatalogEvidenceKind,
  CatalogEvidencePolicy,
  CatalogEvidenceReport,
  CatalogEvidenceSignal,
  CatalogMergeCandidate,
  CatalogUnusedReview,
  CoveragePolicy,
  EntityAssignmentReceipt,
  EvidenceBatch,
  FinalFreshnessCheck,
} from "./catalog-evidence/index.js";
export type {
  CatalogEvidenceDocumentCitationSource,
  CatalogEvidenceReadPort as CatalogEvidenceReadPortContract,
} from "./catalog-evidence/read-port.js";
