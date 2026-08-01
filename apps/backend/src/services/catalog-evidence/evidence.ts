import type { Document } from "../../models/index.js";
import { digest, idsHash, shortHash } from "./hash.js";
import { assignmentSets } from "./receipts.js";
import type {
  AssignmentSets,
  BoundedExcerpt,
  CatalogDossierCitation,
  CatalogEvidenceReport,
  CatalogEvidenceSnapshot,
  CatalogExpansionRecord,
  CatalogMergeCandidate,
  CatalogRiskFlag,
  CoveragePolicy,
  EntityAssignmentReceipt,
  EvidenceBatch,
  FinalFreshnessCheck,
  ReceiptDocumentState,
} from "./types.js";

const pickEvenly = (ids: readonly number[], count: number): readonly number[] => {
  if (ids.length <= count) return [...ids];
  const selected = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const offset = Math.round((index * (ids.length - 1)) / Math.max(1, count - 1));
    const id = ids[offset];
    if (id !== undefined) selected.add(id);
  }
  return [...selected];
};

const receiptStateFor = (
  documentId: number,
  receiptDocuments: readonly ReceiptDocumentState[],
): ReceiptDocumentState | undefined =>
  receiptDocuments.find((document) => document.documentId === documentId);

const byReceiptModified = (
  ids: readonly number[],
  receiptDocuments: readonly ReceiptDocumentState[],
) =>
  [...ids].sort((left, right) => {
    const leftState = receiptStateFor(left, receiptDocuments);
    const rightState = receiptStateFor(right, receiptDocuments);
    return (leftState?.modified ?? "").localeCompare(rightState?.modified ?? "") || left - right;
  });

const catalogDistributionIds = (
  ids: readonly number[],
  snapshots: readonly CatalogEvidenceSnapshot[],
  count: number,
): readonly number[] => {
  const buckets = new Map<string, number[]>();
  for (const id of ids) {
    const snapshot = snapshots.find((item) => item.documentId === id);
    const bucket = snapshot
      ? `c:${snapshot.correspondentId ?? "none"}|t:${snapshot.documentTypeId ?? "none"}|tags:${[...snapshot.tagIds].sort((left, right) => left - right).join(".")}`
      : "missing";
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), id]);
  }
  return [...buckets.values()]
    .map((bucket) => bucket.sort((left, right) => left - right)[0])
    .filter((id): id is number => id !== undefined)
    .sort((left, right) => left - right)
    .slice(0, count);
};

const clusterRepresentatives = (
  ids: readonly number[],
  snapshots: readonly CatalogEvidenceSnapshot[],
  signature: (snapshot: CatalogEvidenceSnapshot) => string | undefined,
  count: number,
): readonly number[] => {
  const buckets = new Map<string, number[]>();
  for (const id of ids) {
    const snapshot = snapshots.find((item) => item.documentId === id);
    const key = snapshot ? (signature(snapshot) ?? "missing") : "missing";
    buckets.set(key, [...(buckets.get(key) ?? []), id]);
  }
  return [...buckets.entries()]
    .sort(
      ([leftKey, leftIds], [rightKey, rightIds]) =>
        rightIds.length - leftIds.length || leftKey.localeCompare(rightKey),
    )
    .map(([, bucketIds]) => bucketIds.sort((left, right) => left - right)[0])
    .filter((id): id is number => id !== undefined)
    .slice(0, count);
};

const contentOutliers = (
  ids: readonly number[],
  snapshots: readonly CatalogEvidenceSnapshot[],
  count: number,
): readonly number[] => {
  const signed = ids
    .map((id) => ({
      id,
      signature: snapshots.find((item) => item.documentId === id)?.contentSignature,
    }))
    .filter(
      (item): item is { readonly id: number; readonly signature: string } =>
        typeof item.signature === "string" && item.signature.trim().length > 0,
    );
  if (new Set(signed.map((item) => item.signature)).size < 2) return [];
  return signed
    .map(({ id, signature }) => ({
      id,
      score: signature.length + new Set(signature.split(/[^A-Za-z0-9]+/).filter(Boolean)).size,
    }))
    .sort((left, right) => right.score - left.score || left.id - right.id)
    .slice(0, count)
    .map((item) => item.id);
};

const byCreated = (ids: readonly number[], snapshots: readonly CatalogEvidenceSnapshot[]) =>
  [...ids].sort((left, right) => {
    const leftSnapshot = snapshots.find((item) => item.documentId === left);
    const rightSnapshot = snapshots.find((item) => item.documentId === right);
    return (
      (leftSnapshot?.created ?? "").localeCompare(rightSnapshot?.created ?? "") || left - right
    );
  });

export const selectEvidenceBatch = ({
  documentIds,
  receiptDocuments,
  snapshots,
  sets,
  batchSize = 30,
}: {
  readonly documentIds: readonly number[];
  readonly receiptDocuments: readonly ReceiptDocumentState[];
  readonly snapshots: readonly CatalogEvidenceSnapshot[];
  readonly sets?: AssignmentSets;
  readonly batchSize?: number;
}): EvidenceBatch => {
  const sorted = [...new Set(documentIds)].sort((left, right) => left - right);
  const modified = byReceiptModified(sorted, receiptDocuments);
  const created = byCreated(sorted, snapshots);
  const createdOldestDocumentIds = created.slice(0, 4);
  const createdNewestDocumentIds = created.slice(-4);
  const modifiedOldestDocumentIds = modified.slice(0, 4);
  const modifiedNewestDocumentIds = modified.slice(-4);
  const evenDocumentIds = pickEvenly(sorted, 6);
  const xOnlyDocumentIds = (sets?.xOnlyDocumentIds ?? []).slice(0, 3);
  const yOnlyDocumentIds = (sets?.yOnlyDocumentIds ?? []).slice(0, 3);
  const bothDocumentIds = (sets?.bothDocumentIds ?? []).slice(0, 3);
  const catalogDistributionDocumentIds = catalogDistributionIds(sorted, snapshots, 4);
  const metadataClusterDocumentIds = clusterRepresentatives(
    sorted,
    snapshots,
    (snapshot) => snapshot.metadataSignature,
    4,
  );
  const documentSignatureClusterDocumentIds = clusterRepresentatives(
    sorted,
    snapshots,
    (snapshot) => snapshot.contentSignature,
    4,
  );
  const semanticOutlierDocumentIds = contentOutliers(sorted, snapshots, 4);
  const selected = new Set<number>();

  for (const id of [
    ...xOnlyDocumentIds,
    ...yOnlyDocumentIds,
    ...bothDocumentIds,
    ...createdOldestDocumentIds,
    ...createdNewestDocumentIds,
    ...modifiedOldestDocumentIds,
    ...modifiedNewestDocumentIds,
    ...evenDocumentIds,
    ...catalogDistributionDocumentIds,
    ...metadataClusterDocumentIds,
    ...documentSignatureClusterDocumentIds,
    ...semanticOutlierDocumentIds,
  ]) {
    if (selected.size >= batchSize) break;
    selected.add(id);
  }
  for (const id of sorted) {
    if (selected.size >= batchSize) break;
    selected.add(id);
  }

  const finalIds = [...selected].sort((left, right) => left - right);
  return {
    documentIds: finalIds,
    createdOldestDocumentIds,
    createdNewestDocumentIds,
    modifiedOldestDocumentIds: modifiedOldestDocumentIds.filter((id) => finalIds.includes(id)),
    modifiedNewestDocumentIds: modifiedNewestDocumentIds.filter((id) => finalIds.includes(id)),
    evenDocumentIds: evenDocumentIds.filter((id) => finalIds.includes(id)),
    xOnlyDocumentIds: xOnlyDocumentIds.filter((id) => finalIds.includes(id)),
    yOnlyDocumentIds: yOnlyDocumentIds.filter((id) => finalIds.includes(id)),
    bothDocumentIds: bothDocumentIds.filter((id) => finalIds.includes(id)),
    catalogDistributionDocumentIds: catalogDistributionDocumentIds.filter((id) =>
      finalIds.includes(id),
    ),
    metadataClusterDocumentIds: metadataClusterDocumentIds.filter((id) => finalIds.includes(id)),
    documentSignatureClusterDocumentIds: documentSignatureClusterDocumentIds.filter((id) =>
      finalIds.includes(id),
    ),
    semanticOutlierDocumentIds: semanticOutlierDocumentIds.filter((id) => finalIds.includes(id)),
    batchHash: idsHash(finalIds),
  };
};

const boundedExcerpt = (doc: Pick<Document, "id" | "content">, charLimit = 120): BoundedExcerpt => {
  const content = doc.content ?? "";
  const segmentLimit = Math.max(1, Math.floor(charLimit / 3));
  const middleStart = Math.max(0, Math.floor(content.length / 2) - Math.floor(segmentLimit / 2));
  const excerpt = {
    start: content.slice(0, segmentLimit),
    middle: content.slice(middleStart, middleStart + segmentLimit),
    end: content.slice(Math.max(0, content.length - segmentLimit)),
    charLimit,
    delimiter: "UNTRUSTED_DOCUMENT_TEXT" as const,
  };
  return {
    ...excerpt,
    excerptHash: digest("catalog_evidence_bounded_excerpt", { documentId: doc.id, excerpt }),
  };
};

export const citationFor = ({
  doc,
  candidateId,
  xReceipt,
  yReceipt,
}: {
  readonly doc: Pick<
    Document,
    "id" | "title" | "content" | "created" | "modified" | "correspondent" | "document_type" | "tags"
  >;
  readonly candidateId: string;
  readonly xReceipt: EntityAssignmentReceipt;
  readonly yReceipt: EntityAssignmentReceipt;
}): CatalogDossierCitation => {
  const receiptSides = [
    ...(xReceipt.documentIds.includes(doc.id) ? ["x" as const] : []),
    ...(yReceipt.documentIds.includes(doc.id) ? ["y" as const] : []),
  ];
  const state =
    xReceipt.documents.find((item) => item.documentId === doc.id) ??
    yReceipt.documents.find((item) => item.documentId === doc.id);
  return {
    citationId: `citation_${shortHash({ candidateId, documentId: doc.id, receiptSides }, 24)}`,
    documentId: doc.id,
    receiptSides,
    title: doc.title,
    created: doc.created,
    modified: doc.modified,
    stateHash: state?.stateHash ?? digest("catalog_evidence_missing_state", { documentId: doc.id }),
    correspondentId: doc.correspondent,
    documentTypeId: doc.document_type,
    tagIds: [...doc.tags].sort((left, right) => left - right),
    excerpt: boundedExcerpt(doc),
  };
};

const coveragePolicy = ({
  liveAssignedCount,
  inspectedCount,
  finalFreshness,
  riskFlags,
}: {
  readonly liveAssignedCount: number;
  readonly inspectedCount: number;
  readonly finalFreshness: FinalFreshnessCheck;
  readonly riskFlags: readonly CatalogRiskFlag[];
}): CoveragePolicy => {
  const coverage = liveAssignedCount === 0 ? 0 : inspectedCount / liveAssignedCount;
  if (liveAssignedCount === 0) {
    return {
      policy: "unused_review",
      inspectedCount,
      liveAssignedCount,
      coverage,
      exhaustive: false,
      freshnessComplete: false,
      riskFlags,
      reason: "Zero-doc entities do not yield semantic merge proof.",
    };
  }
  if (inspectedCount < liveAssignedCount) {
    return {
      policy: "needs_expansion",
      inspectedCount,
      liveAssignedCount,
      coverage,
      exhaustive: false,
      freshnessComplete: false,
      riskFlags,
      reason: "Dossier has not inspected every live assigned document.",
    };
  }
  if (finalFreshness.complete) {
    return {
      policy: "exhaustive_fresh",
      inspectedCount,
      liveAssignedCount,
      coverage,
      exhaustive: true,
      freshnessComplete: true,
      riskFlags,
      reason:
        "Every live assigned document is cited and final receipt re-read reproduced initial receipts.",
    };
  }
  return {
    policy: "stale_after_exhaustive",
    inspectedCount,
    liveAssignedCount,
    coverage,
    exhaustive: true,
    freshnessComplete: false,
    riskFlags,
    reason:
      "Every live assigned document is cited, but final receipt freshness did not reproduce initial receipts.",
  };
};

export const buildEvidenceReport = ({
  candidate,
  xReceipt,
  yReceipt,
  snapshots,
  citations,
  expansions,
  finalFreshness,
  catalogFingerprint,
  freshnessFingerprint,
  epochFingerprint,
}: {
  readonly candidate: CatalogMergeCandidate;
  readonly xReceipt: EntityAssignmentReceipt;
  readonly yReceipt: EntityAssignmentReceipt;
  readonly snapshots: readonly CatalogEvidenceSnapshot[];
  readonly citations: readonly CatalogDossierCitation[];
  readonly expansions: readonly CatalogExpansionRecord[];
  readonly finalFreshness: FinalFreshnessCheck;
  readonly catalogFingerprint: string;
  readonly freshnessFingerprint: string;
  readonly epochFingerprint: string;
}): CatalogEvidenceReport => {
  const sets = assignmentSets(xReceipt.documentIds, yReceipt.documentIds);
  const receiptDocuments = [...xReceipt.documents, ...yReceipt.documents];
  const inspectedDocumentIds = [...new Set(citations.map((citation) => citation.documentId))].sort(
    (left, right) => left - right,
  );
  const remainingDocumentIds = sets.unionDocumentIds.filter(
    (id) => !inspectedDocumentIds.includes(id),
  );
  const union = new Set(sets.unionDocumentIds);
  const assignmentSnapshots = snapshots
    .filter((snapshot) => union.has(snapshot.documentId))
    .sort((left, right) => left.documentId - right.documentId);
  const riskFlags: CatalogRiskFlag[] = assignmentSnapshots.some(
    (snapshot) =>
      typeof snapshot.contentSignature !== "string" || snapshot.contentSignature.trim() === "",
  )
    ? ["missing_semantic_signature"]
    : [];
  const batch = selectEvidenceBatch({
    documentIds: sets.unionDocumentIds,
    receiptDocuments,
    snapshots: assignmentSnapshots,
    sets,
  });
  const nextBatch = selectEvidenceBatch({
    documentIds: remainingDocumentIds,
    receiptDocuments,
    snapshots: assignmentSnapshots,
    sets: {
      xOnlyDocumentIds: sets.xOnlyDocumentIds.filter((id) => remainingDocumentIds.includes(id)),
      yOnlyDocumentIds: sets.yOnlyDocumentIds.filter((id) => remainingDocumentIds.includes(id)),
      bothDocumentIds: sets.bothDocumentIds.filter((id) => remainingDocumentIds.includes(id)),
      unionDocumentIds: remainingDocumentIds,
    },
  });
  const policy = coveragePolicy({
    liveAssignedCount: sets.unionDocumentIds.length,
    inspectedCount: inspectedDocumentIds.length,
    finalFreshness,
    riskFlags,
  });
  const coverageHash = digest("catalog_evidence_coverage", {
    candidateId: candidate.candidateId,
    inspectedDocumentIds,
    totalDocumentIds: sets.unionDocumentIds,
    coveragePolicy: policy,
  });
  const dossierFingerprint = digest("catalog_evidence_dossier", {
    candidateId: candidate.candidateId,
    xReceiptHash: xReceipt.stateHash,
    yReceiptHash: yReceipt.stateHash,
    coverageHash,
    citationIds: citations.map((citation) => citation.citationId),
    expansions,
    finalFreshness,
  });

  return {
    candidate,
    xReceipt,
    yReceipt,
    assignmentSets: sets,
    assignmentSnapshots,
    batch,
    inspectedDocumentIds,
    nextBatch,
    citations,
    expansions,
    coveragePolicy: policy,
    finalFreshness,
    coverageHash,
    dossierFingerprint,
    catalogFingerprint: catalogFingerprint as CatalogEvidenceReport["catalogFingerprint"],
    freshnessFingerprint: freshnessFingerprint as CatalogEvidenceReport["freshnessFingerprint"],
    epochFingerprint: epochFingerprint as CatalogEvidenceReport["epochFingerprint"],
  };
};

export const validateCitationIds = (
  candidateId: string,
  requestedCitationIds: readonly string[],
  dossier: CatalogEvidenceReport,
): readonly CatalogDossierCitation[] => {
  const validDocumentIds = new Set(dossier.assignmentSets.unionDocumentIds);
  const byId = new Map(dossier.citations.map((citation) => [citation.citationId, citation]));
  return requestedCitationIds.map((citationId) => {
    if (!/^citation_[A-Za-z0-9_-]+$/.test(citationId)) {
      throw new Error(`Invalid citation ID format: ${citationId}`);
    }
    const citation = byId.get(citationId);
    if (!citation) throw new Error(`Citation ID is not present in this dossier: ${citationId}`);
    if (!validDocumentIds.has(citation.documentId)) {
      throw new Error(
        `Citation ${citationId} references a document outside candidate ${candidateId} receipts`,
      );
    }
    return citation;
  });
};
