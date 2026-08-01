export { buildCandidateExclusions, buildMergeCandidates, buildUnusedReviews } from "./blocking.js";
export type { BuildCatalogEvidenceEpochOptions } from "./engine.js";
export {
  buildCatalogEvidenceEpoch,
  collectCandidateEvidence,
  createCatalogEvidenceEngine,
  expandCandidateEvidence,
} from "./engine.js";
export {
  buildEvidenceReport,
  selectEvidenceBatch,
  validateCitationIds,
} from "./evidence.js";
export { nameSignals, normalizeCatalogName } from "./normalization.js";
export type {
  CatalogEvidenceDocumentCitationSource,
  CatalogEvidenceReadPort,
} from "./read-port.js";
export {
  assignmentSets,
  filterDescriptorFor,
  hasAssignment,
  readAssignmentReceipt,
} from "./receipts.js";
export type {
  AssignmentSets,
  BoundedExcerpt,
  CatalogCandidateExclusion,
  CatalogDossierCitation,
  CatalogEvidenceEntity,
  CatalogEvidenceEpoch,
  CatalogEvidenceKind,
  CatalogEvidencePolicy,
  CatalogEvidenceReport,
  CatalogEvidenceSignal,
  CatalogEvidenceSnapshot,
  CatalogExpansionRecord,
  CatalogMergeCandidate,
  CatalogUnusedReview,
  CoveragePolicy,
  EntityAssignmentReceipt,
  EvidenceBatch,
  FinalFreshnessCheck,
} from "./types.js";
