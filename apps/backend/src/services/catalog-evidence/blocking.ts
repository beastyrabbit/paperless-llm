import { canonicalSha256, type HashPrecondition } from "@repo/api-contracts";
import { digest, shortHash } from "./hash.js";
import { conceptTokens, nameSignals, nameTokens, tokenJaccard } from "./normalization.js";
import { assignmentSets, hasAssignment } from "./receipts.js";
import type {
  CatalogCandidateExclusion,
  CatalogEvidenceEntity,
  CatalogEvidenceEpoch,
  CatalogEvidenceKind,
  CatalogEvidenceSignal,
  CatalogMergeCandidate,
  CatalogRiskFlag,
  CatalogUnusedReview,
} from "./types.js";

const HIGH_RISK_TERMS = [
  "court",
  "gericht",
  "health",
  "medical",
  "tax",
  "steuer",
  "legal",
  "lawyer",
  "anwalt",
];

const MAX_CANDIDATES = 500;
const MAX_PAIR_BUCKET_SIZE = 200;

const candidateScore = (signals: readonly CatalogEvidenceSignal[]) =>
  signals.reduce((total, signal) => {
    if (signal === "normalized_name") return total + 1;
    if (signal === "acronym") return total + 0.8;
    if (signal === "spelling_variant") return total + 0.75;
    if (signal === "language_variant") return total + 0.65;
    if (signal === "co_occurrence_overlap") return total + 0.55;
    if (signal === "correspondent_identity") return total + 0.45;
    return total + 0.35;
  }, 0);

const distributionOverlap = (
  leftIds: readonly number[],
  rightIds: readonly number[],
  usageForDocument: (documentId: number) => number | null,
): number => {
  const count = (ids: readonly number[]) => {
    const result = new Map<number, number>();
    for (const documentId of ids) {
      const usageId = usageForDocument(documentId);
      if (usageId !== null) result.set(usageId, (result.get(usageId) ?? 0) + 1);
    }
    return result;
  };
  const left = count(leftIds);
  const right = count(rightIds);
  const keys = new Set([...left.keys(), ...right.keys()]);
  if (keys.size === 0) return 0;
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    intersection += Math.min(left.get(key) ?? 0, right.get(key) ?? 0);
    union += Math.max(left.get(key) ?? 0, right.get(key) ?? 0);
  }
  return union === 0 ? 0 : intersection / union;
};

const pairSignals = (
  kind: CatalogEvidenceKind,
  x: CatalogEvidenceEntity,
  y: CatalogEvidenceEntity,
  epoch: CatalogEvidenceEpoch,
): readonly CatalogEvidenceSignal[] => {
  const signals = new Set<CatalogEvidenceSignal>(nameSignals(x.name, y.name));
  const xIds = epoch.snapshots
    .filter((snapshot) => hasAssignment(snapshot, kind, x.id))
    .map((snapshot) => snapshot.documentId);
  const yIds = epoch.snapshots
    .filter((snapshot) => hasAssignment(snapshot, kind, y.id))
    .map((snapshot) => snapshot.documentId);
  const sets = assignmentSets(xIds, yIds);

  if (sets.bothDocumentIds.length > 0) {
    const overlap = sets.bothDocumentIds.length / Math.min(xIds.length || 1, yIds.length || 1);
    if (overlap >= 0.2) signals.add("co_occurrence_overlap");
  }

  const tokenOverlap = tokenJaccard(nameTokens(x.name), nameTokens(y.name));
  if (kind === "correspondent" && tokenOverlap >= 0.34) signals.add("correspondent_identity");

  if (kind === "correspondent") {
    const usage = distributionOverlap(xIds, yIds, (documentId) => {
      const snapshot = epoch.snapshots.find((item) => item.documentId === documentId);
      return snapshot?.documentTypeId ?? null;
    });
    if (usage >= 0.5) signals.add("document_type_usage");
  } else if (kind === "document_type") {
    const usage = distributionOverlap(xIds, yIds, (documentId) => {
      const snapshot = epoch.snapshots.find((item) => item.documentId === documentId);
      return snapshot?.correspondentId ?? null;
    });
    if (usage >= 0.5) signals.add("document_type_usage");
  }

  return [...signals].sort();
};

const candidateIdFor = (
  epochId: string,
  kind: CatalogEvidenceKind,
  xId: number,
  yId: number,
): string => `cand_${shortHash({ epochId, kind, xId, yId }, 24)}`;

const documentCount = (entity: CatalogEvidenceEntity): number => entity.document_count ?? 0;

const configuredIds = (
  epoch: CatalogEvidenceEpoch,
  key: "workflowEntityIds" | "systemEntityIds" | "dependencyEntityIds" | "highRiskEntityIds",
  kind: CatalogEvidenceKind,
): ReadonlySet<number> => new Set(epoch.policy[key]?.[kind] ?? []);

const hasMatchingRule = (entity: CatalogEvidenceEntity): boolean =>
  typeof entity.match === "string" && entity.match.trim().length > 0;

const riskFlagsForEntity = (
  epoch: CatalogEvidenceEpoch,
  kind: CatalogEvidenceKind,
  entity: CatalogEvidenceEntity,
): readonly CatalogRiskFlag[] => {
  const flags = new Set<CatalogRiskFlag>();
  const normalized = entity.name.toLocaleLowerCase();
  const slug = entity.slug.toLocaleLowerCase();
  if (
    configuredIds(epoch, "highRiskEntityIds", kind).has(entity.id) ||
    HIGH_RISK_TERMS.some((term) => normalized.includes(term) || slug.includes(term))
  ) {
    flags.add("forced_review_high_risk");
  }
  if (normalized.includes("/") || slug.includes("/") || normalized.includes("::")) {
    flags.add("hierarchical");
  }
  if (hasMatchingRule(entity)) flags.add("matching_rule");
  if (configuredIds(epoch, "dependencyEntityIds", kind).has(entity.id))
    flags.add("dependency_risk");
  return [...flags].sort();
};

export const exclusionForEntity = (
  epoch: CatalogEvidenceEpoch,
  kind: CatalogEvidenceKind,
  entity: CatalogEvidenceEntity,
): CatalogCandidateExclusion | null => {
  if (kind === "tag" && "is_inbox_tag" in entity && entity.is_inbox_tag) {
    return { kind, entityId: entity.id, name: entity.name, reason: "inbox", flags: [] };
  }
  if (configuredIds(epoch, "workflowEntityIds", kind).has(entity.id)) {
    return { kind, entityId: entity.id, name: entity.name, reason: "workflow_system", flags: [] };
  }
  if (configuredIds(epoch, "systemEntityIds", kind).has(entity.id)) {
    return { kind, entityId: entity.id, name: entity.name, reason: "workflow_system", flags: [] };
  }
  if (configuredIds(epoch, "dependencyEntityIds", kind).has(entity.id)) {
    return {
      kind,
      entityId: entity.id,
      name: entity.name,
      reason: "system_dependency",
      flags: ["dependency_risk"],
    };
  }
  if (documentCount(entity) === 0) {
    return { kind, entityId: entity.id, name: entity.name, reason: "zero_use", flags: [] };
  }
  return null;
};

export const buildCandidateExclusions = (
  epoch: CatalogEvidenceEpoch,
): readonly CatalogCandidateExclusion[] =>
  epoch.scope.flatMap((kind) =>
    epoch.entities[kind]
      .map((entity) => exclusionForEntity(epoch, kind, entity))
      .filter((exclusion): exclusion is CatalogCandidateExclusion => exclusion !== null),
  );

export const buildUnusedReviews = (epoch: CatalogEvidenceEpoch): readonly CatalogUnusedReview[] =>
  epoch.scope.flatMap((kind) =>
    epoch.entities[kind]
      .filter((entity) => documentCount(entity) === 0)
      .sort((left, right) => left.id - right.id)
      .map((entity) => ({
        reviewId: `unused_${shortHash({ epochId: epoch.epochId, kind, entityId: entity.id }, 24)}`,
        epochId: epoch.epochId,
        kind,
        entityId: entity.id,
        name: entity.name,
        nameHash: digest("catalog_evidence_unused_name", {
          kind,
          entityId: entity.id,
          name: entity.name,
        }),
        rationale:
          "Entity has zero assigned documents and is eligible only for unused-catalog review.",
        createdAt: epoch.createdAt,
      })),
  );

export const buildMergeCandidates = (
  epoch: CatalogEvidenceEpoch,
  options: { readonly createdAt?: string; readonly candidateCap?: number } = {},
): readonly CatalogMergeCandidate[] => {
  const createdAt = options.createdAt ?? epoch.createdAt;
  const candidates: CatalogMergeCandidate[] = [];
  const cap = options.candidateCap ?? MAX_CANDIDATES;

  for (const kind of epoch.scope) {
    const entities = [...epoch.entities[kind]]
      .filter((entity) => exclusionForEntity(epoch, kind, entity) === null)
      .sort((left, right) => left.id - right.id);
    const pairs = candidatePairs(kind, entities);
    for (const [x, y] of pairs) {
      const signals = pairSignals(kind, x, y, epoch);
      if (signals.length === 0) continue;
      const ordered = x.id < y.id ? [x, y] : [y, x];
      const [orderedX, orderedY] = ordered as [CatalogEvidenceEntity, CatalogEvidenceEntity];
      const riskFlags = [
        ...new Set([
          ...riskFlagsForEntity(epoch, kind, orderedX),
          ...riskFlagsForEntity(epoch, kind, orderedY),
        ]),
      ].sort();
      const candidateId = candidateIdFor(epoch.epochId, kind, orderedX.id, orderedY.id);
      const score = candidateScore(signals);
      const preconditionDigest = digest("catalog_evidence_candidate_precondition", {
        epochFingerprint: epoch.epochFingerprint,
        kind,
        xEntityId: orderedX.id,
        yEntityId: orderedY.id,
        signals,
      });
      const preconditions: readonly HashPrecondition[] = [
        { kind: "catalog_epoch", digest: preconditionDigest },
      ];
      const expectedEvidenceFingerprint = digest("catalog_evidence_expected_evidence", {
        candidateId,
        epochFingerprint: epoch.epochFingerprint,
        signals,
      });
      const expectedProposalFingerprint = canonicalSha256({
        kind: "catalog_evidence_expected_proposal",
        candidateId,
        xEntityId: orderedX.id,
        yEntityId: orderedY.id,
        expectedEvidenceFingerprint,
      });
      candidates.push({
        candidateId,
        epochId: epoch.epochId,
        kind,
        xEntityId: orderedX.id,
        yEntityId: orderedY.id,
        xName: orderedX.name,
        yName: orderedY.name,
        signals,
        riskFlags,
        requiresHumanReview: riskFlags.length > 0,
        score,
        expectedEvidenceFingerprint,
        expectedProposalFingerprint,
        preconditions,
        rationale: `Blocked deterministic ${kind} merge candidate using ${signals.join(", ")}.`,
        createdAt,
      });
    }
  }

  return candidates
    .sort((left, right) => {
      const score = right.score - left.score;
      if (score !== 0) return score;
      const leftRisk = Number(left.requiresHumanReview);
      const rightRisk = Number(right.requiresHumanReview);
      if (leftRisk !== rightRisk) return rightRisk - leftRisk;
      return left.candidateId.localeCompare(right.candidateId);
    })
    .slice(0, cap);
};

const candidatePairs = (
  kind: CatalogEvidenceKind,
  entities: readonly CatalogEvidenceEntity[],
): readonly (readonly [CatalogEvidenceEntity, CatalogEvidenceEntity])[] => {
  const buckets = new Map<string, CatalogEvidenceEntity[]>();
  for (const entity of entities) {
    const keys = new Set([
      `norm:${nameTokens(entity.name).join(" ")}`,
      `concept:${conceptTokens(entity.name).join(" ")}`,
      `acronym:${nameTokens(entity.name)
        .map((token) => token[0])
        .join("")}`,
      ...nameTokens(entity.name).map((token) => `token:${token}`),
    ]);
    if (kind !== "tag") keys.add(`usage:${entity.document_count ?? 0}`);
    for (const key of keys) {
      if (key.endsWith(":")) continue;
      buckets.set(key, [...(buckets.get(key) ?? []), entity]);
    }
  }

  const pairMap = new Map<string, readonly [CatalogEvidenceEntity, CatalogEvidenceEntity]>();
  for (const bucket of [...buckets.values()].sort((left, right) => {
    const leftId = left[0]?.id ?? 0;
    const rightId = right[0]?.id ?? 0;
    return leftId - rightId || left.length - right.length;
  })) {
    const sorted = [...bucket].sort((left, right) => left.id - right.id);
    if (sorted.length > MAX_PAIR_BUCKET_SIZE) continue;
    for (let leftIndex = 0; leftIndex < sorted.length; leftIndex += 1) {
      const left = sorted[leftIndex];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < sorted.length; rightIndex += 1) {
        const right = sorted[rightIndex];
        if (!right) continue;
        const key = `${Math.min(left.id, right.id)}:${Math.max(left.id, right.id)}`;
        pairMap.set(key, left.id < right.id ? [left, right] : [right, left]);
      }
    }
  }
  return [...pairMap.values()];
};
