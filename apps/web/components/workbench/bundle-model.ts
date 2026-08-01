/**
 * Pure helpers that bridge live Paperless values + the analysis proposal
 * projection into the diff/evidence view-models, plus the safety gates and
 * hash/idempotency inputs the whole-bundle actions require.
 *
 * No React / network here so it can be unit-tested directly.
 */
import {
  type AnalysisAvailableProposalProjection,
  type AnalysisEntityLabels,
  type AnalysisProposalProjection,
  type AnalysisRun,
  canonicalSha256,
  type DocumentDetail,
  type Sha256Digest,
} from "@repo/api-contracts";
import type { DocumentBaseline, EntityLabels } from "./view-types";

// --- projection discrimination -----------------------------------------------
export const isAvailableProjection = (
  projection: AnalysisProposalProjection,
): projection is AnalysisAvailableProposalProjection =>
  projection.evidenceAvailability === "available";

export const isExpiredProjection = (projection: AnalysisProposalProjection): boolean =>
  projection.evidenceAvailability === "evidence_expired";

/** The document changed under the proposal, or its current state can't be read. */
export const isStaleProjection = (projection: AnalysisProposalProjection): boolean =>
  projection.freshness.stale || projection.freshness.currentMissing;

export type FreshnessStatus = AnalysisProposalProjection["freshness"]["status"];

export const freshnessStatus = (projection: AnalysisProposalProjection): FreshnessStatus =>
  projection.freshness.status;

/**
 * Whole-bundle approval is only safe when the evidence is present, the current
 * Paperless state still matches the analyzed state, and the run is awaiting a
 * decision. Anything else would fail the server's precondition check.
 */
export const canApproveBundle = (
  projection: AnalysisProposalProjection,
  run: Pick<AnalysisRun, "state"> | null,
): boolean =>
  isAvailableProjection(projection) &&
  !isStaleProjection(projection) &&
  run?.state === "awaiting_review";

/** A stale/expired run needs a fresh read before it can produce an appliable bundle. */
export const shouldOfferForceOcr = (
  projection: AnalysisProposalProjection | null,
  run: Pick<AnalysisRun, "state"> | null,
): boolean => {
  if (!run) return false;
  const activeOrReviewable =
    run.state === "awaiting_review" || run.state === "failed" || run.state === "retrying";
  if (!activeOrReviewable) return false;
  if (!projection) return run.state === "failed";
  return isStaleProjection(projection) || isExpiredProjection(projection);
};

// --- current Paperless values → diff baseline --------------------------------
export const formatCustomFieldValue = (value: unknown): string => {
  if (value == null || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

/**
 * Adapt the live document detail into the `DocumentBaseline` the diff model
 * consumes (the "current" side of the bundle diff).
 */
export const documentDetailToBaseline = (document: DocumentDetail): DocumentBaseline => ({
  documentId: document.id as DocumentBaseline["documentId"],
  title: document.title,
  correspondentId: document.correspondent_id,
  documentTypeId: document.document_type_id,
  ordinaryTagIds: document.tags.map((tag) => tag.id),
  customFields: document.custom_fields.map((field) => ({
    customFieldId: field.field,
    value: formatCustomFieldValue(field.value),
  })),
});

export interface CatalogIndex {
  readonly tags: ReadonlyMap<number, string>;
  readonly customFields: ReadonlyMap<number, string>;
  readonly correspondents: ReadonlyMap<number, string>;
  readonly documentTypes: ReadonlyMap<number, string>;
}

export const emptyCatalogIndex: CatalogIndex = {
  tags: new Map(),
  customFields: new Map(),
  correspondents: new Map(),
  documentTypes: new Map(),
};

const recordFromMap = (map: ReadonlyMap<number, string>): Record<number, string> => {
  const record: Record<number, string> = {};
  for (const [id, name] of map) record[id] = name;
  return record;
};

/**
 * Build the id→name lookup the diff renders. Names for correspondents and
 * document types are only known for the current document (Paperless exposes no
 * bulk list here); everything else falls back to a `#id` chip in the renderer.
 */
export const buildEntityLabels = (
  index: CatalogIndex,
  current: DocumentDetail | null,
  proposalLabels?: AnalysisEntityLabels,
): EntityLabels => {
  const correspondents = recordFromMap(index.correspondents);
  const documentTypes = recordFromMap(index.documentTypes);
  const tags = recordFromMap(index.tags);
  for (const tag of proposalLabels?.tags ?? []) tags[tag.id] = tag.name;
  for (const correspondent of proposalLabels?.correspondents ?? []) {
    correspondents[correspondent.id] = correspondent.name;
  }
  for (const documentType of proposalLabels?.documentTypes ?? []) {
    documentTypes[documentType.id] = documentType.name;
  }
  if (current) {
    if (current.correspondent_id != null && current.correspondent) {
      correspondents[current.correspondent_id] = current.correspondent;
    }
    if (current.document_type_id != null && current.document_type) {
      documentTypes[current.document_type_id] = current.document_type;
    }
    for (const tag of current.tags) tags[tag.id] = tag.name;
  }
  return {
    tags,
    correspondents,
    documentTypes,
    customFields: recordFromMap(index.customFields),
  };
};

// --- run state hash (client replica) -----------------------------------------
/**
 * Client-side replica of the backend's `analysisRunStateHash` (see
 * apps/backend/src/api/analysis/command-handlers.ts). Required as the
 * `expectedRunStateHash` precondition for retry / cancel / force-OCR. Uses the
 * same canonical JSON hashing exported from the contracts package, so the
 * digest matches the server's compare-and-set.
 */
export const computeRunStateHash = (run: AnalysisRun): Sha256Digest =>
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

// --- idempotency -------------------------------------------------------------
/** Idempotency keys must be 8–128 chars; a UUID satisfies that and dedupes retries. */
export const newIdempotencyKey = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // Fallback (non-secure contexts): still ≥8 chars and unique enough per click.
  return `idem-${Date.now().toString(36)}-${Math.round(Math.random() * 1e9).toString(36)}`;
};
