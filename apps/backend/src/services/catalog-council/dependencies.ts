import type { CatalogEvidenceReport } from "../catalog-evidence/types.js";
import type { UnsafePaperlessDependency } from "./types.js";

export const unsafeDependenciesForDossier = (
  dossier: CatalogEvidenceReport,
  configured: readonly UnsafePaperlessDependency[] = [],
): readonly UnsafePaperlessDependency[] => {
  const dependencies = new Set<UnsafePaperlessDependency>(configured);
  for (const flag of dossier.candidate.riskFlags) {
    if (flag === "hierarchical") dependencies.add("nested_tags");
    if (flag === "matching_rule") dependencies.add("matching_rules");
    if (flag === "dependency_risk") dependencies.add("workflows");
    if (flag === "forced_review_high_risk") dependencies.add("permissions");
  }
  for (const flag of dossier.coveragePolicy.riskFlags) {
    if (flag === "missing_semantic_signature") dependencies.add("missing_semantic_signature");
  }
  return [...dependencies].sort();
};
