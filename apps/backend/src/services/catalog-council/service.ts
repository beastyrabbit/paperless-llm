import { canonicalSha256, type HashPrecondition } from "@repo/api-contracts";
import { Context, Effect, Layer } from "effect";
import { CatalogEvidenceService } from "../CatalogEvidenceService.js";
import { CodexRuntimeService } from "../CodexRuntimeService.js";
import { digest } from "../catalog-evidence/hash.js";
import type {
  CatalogEvidenceEpoch,
  CatalogEvidenceReport,
  CatalogMergeCandidate,
} from "../catalog-evidence/types.js";
import { OperationalLedgerService } from "../OperationalLedgerService.js";
import type {
  CatalogProposalApplicationBlockedReason,
  CatalogProposalSafetyInputs,
} from "../operational-ledger/types.js";
import { unsafeDependenciesForDossier } from "./dependencies.js";
import { catalogCouncilEntityFingerprint } from "./fingerprint.js";
import {
  chairPrompt,
  newEntityChairPrompt,
  newEntityReviewerPrompt,
  reviewerPrompt,
} from "./prompts.js";
import {
  CHAIR_OUTPUT_JSON_SCHEMA,
  ChairOutputSchema,
  REVIEWER_OUTPUT_JSON_SCHEMA,
  ReviewerOutputSchema,
} from "./schemas.js";
import type {
  CatalogCouncilChairOutput,
  CatalogCouncilDecision,
  CatalogCouncilNewEntityDecision,
  CatalogCouncilNewEntityRequest,
  CatalogCouncilOptimizeResult,
  CatalogCouncilPersistedRecords,
  CatalogCouncilReviewerOutput,
  CatalogCouncilReviewerRole,
  CatalogCouncilReviewOptions,
  CatalogCouncilRunCandidateOptions,
  CatalogCouncilScoutingOptions,
  CatalogCouncilScoutResult,
  CompactCatalogCouncilVote,
  UnsafePaperlessDependency,
} from "./types.js";

const REVIEWER_ROLES: readonly CatalogCouncilReviewerRole[] = [
  "taxonomy_curator",
  "document_evidence_auditor",
  "counterexample_hunter",
];

const citationIds = (dossier: CatalogEvidenceReport): ReadonlySet<string> =>
  new Set(dossier.citations.map((citation) => citation.citationId));

const freshnessHashFor = (dossier: CatalogEvidenceReport) =>
  digest("catalog_council_freshness", {
    finalFreshness: dossier.finalFreshness,
    xReceiptHash: dossier.finalFreshness.xReceiptHash,
    yReceiptHash: dossier.finalFreshness.yReceiptHash,
  });

interface EntityDirection {
  readonly sourceEntityId: number;
  readonly targetEntityId: number;
}

const defaultDirection = (dossier: CatalogEvidenceReport): EntityDirection => ({
  sourceEntityId: dossier.candidate.xEntityId,
  targetEntityId: dossier.candidate.yEntityId,
});

const receiptForEntityId = (dossier: CatalogEvidenceReport, entityId: number) => {
  if (entityId === dossier.candidate.xEntityId) return dossier.xReceipt;
  if (entityId === dossier.candidate.yEntityId) return dossier.yReceipt;
  throw new Error(`Catalog council direction references entity outside dossier pair: ${entityId}`);
};

const assertChairMergeDirection = ({
  dossier,
  chair,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly chair: CatalogCouncilChairOutput;
}): EntityDirection => {
  const { sourceEntityId, targetEntityId } = chair;
  if (
    !Number.isInteger(sourceEntityId) ||
    !Number.isInteger(targetEntityId) ||
    sourceEntityId <= 0 ||
    targetEntityId <= 0
  ) {
    throw new Error("Catalog council chair returned non-positive merge direction IDs");
  }
  if (sourceEntityId === targetEntityId) {
    throw new Error("Catalog council chair returned the same source and target entity ID");
  }
  const expected = new Set([dossier.candidate.xEntityId, dossier.candidate.yEntityId]);
  if (
    expected.size !== 2 ||
    !expected.has(sourceEntityId) ||
    !expected.has(targetEntityId) ||
    new Set([sourceEntityId, targetEntityId]).size !== expected.size
  ) {
    throw new Error(
      "Catalog council chair selected a merge direction outside the dossier X/Y pair",
    );
  }
  return { sourceEntityId, targetEntityId };
};

const directionForDecision = ({
  dossier,
  chair,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly chair: CatalogCouncilChairOutput | null;
}): EntityDirection =>
  chair?.approval === "approve_merge"
    ? assertChairMergeDirection({ dossier, chair })
    : defaultDirection(dossier);

const safetyInputsForDossier = ({
  dossier,
  applicationBlockedReasons,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
}): CatalogProposalSafetyInputs => ({
  candidateRiskFlags: [...dossier.candidate.riskFlags].sort(),
  coverageRiskFlags: [...dossier.coveragePolicy.riskFlags].sort(),
  requiresHumanReview: dossier.candidate.requiresHumanReview,
  applicationBlockedReasons: [
    ...applicationBlockedReasons,
  ].sort() as readonly CatalogProposalApplicationBlockedReason[],
});

const entityFingerprint = ({
  label,
  entityId,
  dossier,
  applicationBlockedReasons,
}: {
  readonly label: "source" | "target";
  readonly entityId: number;
  readonly dossier: CatalogEvidenceReport;
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
}) => {
  const receipt = receiptForEntityId(dossier, entityId);
  return catalogCouncilEntityFingerprint({
    label,
    kind: dossier.candidate.kind,
    entityId: receipt.entityId,
    currentNameHash: receipt.nameHash,
    receiptHash: receipt.stateHash,
    assignmentHash: receipt.assignmentHash,
    receiptCount: receipt.receiptCount,
    documentIdsHash: receipt.documentIdsHash,
    safetyInputs: safetyInputsForDossier({ dossier, applicationBlockedReasons }),
  });
};

const freshDependencyFingerprint = (
  dossier: CatalogEvidenceReport,
  applicationBlockedReasons: readonly UnsafePaperlessDependency[],
) =>
  digest("catalog_council_fresh_dependency", {
    epochFingerprint: dossier.epochFingerprint,
    catalogFingerprint: dossier.catalogFingerprint,
    freshnessFingerprint: dossier.freshnessFingerprint,
    xReceiptHash: dossier.xReceipt.stateHash,
    yReceiptHash: dossier.yReceipt.stateHash,
    xNameHash: dossier.xReceipt.nameHash,
    yNameHash: dossier.yReceipt.nameHash,
    finalFreshness: dossier.finalFreshness,
    safetyInputs: safetyInputsForDossier({ dossier, applicationBlockedReasons }),
  });

const proposalIdFor = (dossier: CatalogEvidenceReport) =>
  `prop_${canonicalSha256({
    candidateId: dossier.candidate.candidateId,
    xEntityId: dossier.candidate.xEntityId,
    yEntityId: dossier.candidate.yEntityId,
    coverageHash: dossier.coverageHash,
    evidenceFingerprint: dossier.dossierFingerprint,
  }).slice(0, 24)}`;

const evidenceIdFor = (
  dossier: CatalogEvidenceReport,
  role: CatalogCouncilReviewerRole,
  proposalId: string,
) =>
  `evidence_${canonicalSha256({
    candidateId: dossier.candidate.candidateId,
    role,
    proposalId,
    coverageHash: dossier.coverageHash,
  }).slice(0, 24)}`;

const evidenceFingerprintFor = (dossier: CatalogEvidenceReport) =>
  digest("catalog_council_evidence_fingerprint", {
    dossierFingerprint: dossier.dossierFingerprint,
    coverageHash: dossier.coverageHash,
    freshnessHash: freshnessHashFor(dossier),
    inspectedDocumentIds: dossier.inspectedDocumentIds,
    xReceiptHash: dossier.xReceipt.stateHash,
    yReceiptHash: dossier.yReceipt.stateHash,
    xAssignmentHash: dossier.xReceipt.assignmentHash,
    yAssignmentHash: dossier.yReceipt.assignmentHash,
  });

const compactReviewerVote = (vote: CatalogCouncilReviewerOutput): CompactCatalogCouncilVote => ({
  role: vote.reviewer,
  recommendation: vote.recommendation,
  rationale: vote.rationale.slice(0, 500),
  evidenceCitationIds: [...new Set(vote.evidenceCitationIds)].sort(),
  coverageHash: vote.coverageHash,
  freshnessHash: vote.freshnessHash,
});

const compactChairVote = (vote: CatalogCouncilChairOutput): CompactCatalogCouncilVote => ({
  role: "chair",
  recommendation: vote.approval,
  rationale: vote.rationale.slice(0, 500),
  evidenceCitationIds: [...new Set(vote.evidenceCitationIds)].sort(),
  coverageHash: vote.coverageHash,
  freshnessHash: vote.freshnessHash,
});

const assertKnownEvidence = ({
  evidenceIds,
  validIds,
  label,
}: {
  readonly evidenceIds: readonly string[];
  readonly validIds: ReadonlySet<string>;
  readonly label: string;
}) => {
  const forged = evidenceIds.filter((id) => !validIds.has(id));
  if (forged.length > 0) {
    throw new Error(`${label} cited evidence IDs outside dossier: ${forged.join(",")}`);
  }
};

const assertVoteHashes = ({
  vote,
  coverageHash,
  freshnessHash,
  label,
}: {
  readonly vote: { readonly coverageHash: string; readonly freshnessHash: string };
  readonly coverageHash: string;
  readonly freshnessHash: string;
  readonly label: string;
}) => {
  if (vote.coverageHash !== coverageHash || vote.freshnessHash !== freshnessHash) {
    throw new Error(`${label} returned hashes that do not match the dossier`);
  }
};

const allCitedIds = (votes: readonly CompactCatalogCouncilVote[]) =>
  [...new Set(votes.flatMap((vote) => vote.evidenceCitationIds))].sort();

const compactPersistence = ({
  decision,
  dossier,
  proposalId,
  votes,
  citedEvidenceIds,
  freshnessHash,
  direction,
  applicationBlockedReasons,
  createdAt,
}: {
  readonly decision: CatalogCouncilDecision["decision"];
  readonly dossier: CatalogEvidenceReport;
  readonly proposalId: string | null;
  readonly votes: readonly CompactCatalogCouncilVote[];
  readonly citedEvidenceIds: readonly string[];
  readonly freshnessHash: CatalogCouncilDecision["freshnessHash"];
  readonly direction: EntityDirection;
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
  readonly createdAt: string;
}): CatalogCouncilDecision["persistenceRecord"] => {
  const decisionId = `council_${canonicalSha256({
    candidateId: dossier.candidate.candidateId,
    decision,
    votes,
    coverageHash: dossier.coverageHash,
    freshnessHash,
    createdAt,
  }).slice(0, 24)}`;
  return {
    decisionId,
    candidateId: dossier.candidate.candidateId,
    proposalId,
    decision,
    humanReviewRequired: true,
    automaticApplication: "disabled",
    applicationBlockedReasons,
    sourceEntityId: direction.sourceEntityId,
    targetEntityId: direction.targetEntityId,
    votes,
    citedEvidenceIds,
    coverageHash: dossier.coverageHash,
    freshnessHash,
    dossierFingerprint: dossier.dossierFingerprint,
    xReceiptHash: dossier.xReceipt.stateHash,
    yReceiptHash: dossier.yReceipt.stateHash,
    xReceiptCount: dossier.xReceipt.receiptCount,
    yReceiptCount: dossier.yReceipt.receiptCount,
    inspectedDocumentCount: dossier.inspectedDocumentIds.length,
    totalDocumentCount: dossier.assignmentSets.unionDocumentIds.length,
    sourceEntityFingerprint: entityFingerprint({
      label: "source",
      entityId: direction.sourceEntityId,
      dossier,
      applicationBlockedReasons,
    }),
    targetEntityFingerprint: entityFingerprint({
      label: "target",
      entityId: direction.targetEntityId,
      dossier,
      applicationBlockedReasons,
    }),
    freshDependencyFingerprint: freshDependencyFingerprint(dossier, applicationBlockedReasons),
    createdAt,
  };
};

const decisionFromVotes = ({
  dossier,
  reviewers,
  chair,
  options,
  createdAt,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly reviewers: readonly CatalogCouncilReviewerOutput[];
  readonly chair: CatalogCouncilChairOutput | null;
  readonly options: CatalogCouncilReviewOptions;
  readonly createdAt: string;
}): CatalogCouncilDecision => {
  const freshnessHash = freshnessHashFor(dossier);
  const validIds = citationIds(dossier);
  for (const reviewer of reviewers) {
    assertKnownEvidence({
      evidenceIds: [...reviewer.evidenceCitationIds, ...reviewer.counterexampleCitationIds],
      validIds,
      label: reviewer.reviewer,
    });
    assertVoteHashes({
      vote: reviewer,
      coverageHash: dossier.coverageHash,
      freshnessHash,
      label: reviewer.reviewer,
    });
  }
  if (chair) {
    assertKnownEvidence({ evidenceIds: chair.evidenceCitationIds, validIds, label: "chair" });
    assertVoteHashes({
      vote: chair,
      coverageHash: dossier.coverageHash,
      freshnessHash,
      label: "chair",
    });
  }

  const compactReviewers = reviewers.map(compactReviewerVote);
  const chairVote = chair ? compactChairVote(chair) : null;
  const votes = chairVote ? [...compactReviewers, chairVote] : compactReviewers;
  const decisiveCounterexample = reviewers.find(
    (reviewer) => reviewer.decisiveCounterexample || reviewer.counterexampleCitationIds.length > 0,
  );
  const applicationBlockedReasons = unsafeDependenciesForDossier(
    dossier,
    options.unsafeDependencies,
  );
  const direction = directionForDecision({ dossier, chair });
  const canMerge =
    !decisiveCounterexample &&
    chair?.approval === "approve_merge" &&
    new Set(reviewers.map((reviewer) => reviewer.reviewer)).size === REVIEWER_ROLES.length &&
    REVIEWER_ROLES.every((role) => reviewers.some((reviewer) => reviewer.reviewer === role)) &&
    reviewers.every((reviewer) => reviewer.recommendation === "merge") &&
    exactExhaustiveFreshCoverage(dossier);
  const decision = decisiveCounterexample
    ? "keep_separate"
    : canMerge
      ? "merge_review_ready"
      : "needs_review";
  const citedEvidenceIds = allCitedIds(votes);
  const persistenceRecord = compactPersistence({
    decision,
    dossier,
    proposalId: null,
    votes,
    citedEvidenceIds,
    freshnessHash,
    direction,
    applicationBlockedReasons,
    createdAt,
  });

  return {
    decisionId: persistenceRecord.decisionId,
    candidateId: dossier.candidate.candidateId,
    proposalId: null,
    decision,
    humanReviewRequired: true,
    automaticApplication: "disabled",
    applicationBlockedReasons,
    sourceEntityId: persistenceRecord.sourceEntityId,
    targetEntityId: persistenceRecord.targetEntityId,
    reviewerVotes: compactReviewers,
    chairVote,
    citedEvidenceIds,
    coverageHash: dossier.coverageHash,
    freshnessHash,
    coveragePolicy: dossier.coveragePolicy,
    finalFreshness: dossier.finalFreshness,
    riskFlags: [
      ...new Set([...dossier.candidate.riskFlags, ...dossier.coveragePolicy.riskFlags]),
    ].sort(),
    sourceEntityFingerprint: persistenceRecord.sourceEntityFingerprint,
    targetEntityFingerprint: persistenceRecord.targetEntityFingerprint,
    freshDependencyFingerprint: persistenceRecord.freshDependencyFingerprint,
    rationale: decisiveCounterexample
      ? `Decisive counterexample from ${decisiveCounterexample.reviewer}; keep separate.`
      : canMerge
        ? "Unanimous reviewers and chair approval produced a human-review merge dossier."
        : "Council did not satisfy exhaustive unanimous merge requirements.",
    createdAt,
    persistenceRecord: {
      ...persistenceRecord,
      applicationBlockedReasons,
    },
    persistedRecords: null,
  };
};

const hasDecisiveCounterexample = (reviewers: readonly CatalogCouncilReviewerOutput[]) =>
  reviewers.some(
    (reviewer) => reviewer.decisiveCounterexample || reviewer.counterexampleCitationIds.length > 0,
  );

const exactExhaustiveFreshCoverage = (dossier: CatalogEvidenceReport): boolean => {
  const liveUnion = new Set(dossier.assignmentSets.unionDocumentIds);
  const inspected = new Set(dossier.inspectedDocumentIds);
  const inspectedHasNoDuplicates = dossier.inspectedDocumentIds.length === inspected.size;
  const liveUnionHasNoDuplicates =
    dossier.assignmentSets.unionDocumentIds.length === liveUnion.size;
  const sameMembers =
    inspected.size === liveUnion.size &&
    [...inspected].every((documentId) => liveUnion.has(documentId)) &&
    [...liveUnion].every((documentId) => inspected.has(documentId));
  return (
    liveUnion.size > 0 &&
    inspectedHasNoDuplicates &&
    liveUnionHasNoDuplicates &&
    sameMembers &&
    dossier.coveragePolicy.inspectedCount === liveUnion.size &&
    dossier.coveragePolicy.liveAssignedCount === liveUnion.size &&
    dossier.coveragePolicy.coverage === 1 &&
    dossier.coveragePolicy.policy === "exhaustive_fresh" &&
    dossier.coveragePolicy.exhaustive &&
    dossier.coveragePolicy.freshnessComplete &&
    dossier.finalFreshness.complete &&
    dossier.finalFreshness.reproducedInitialReceipts
  );
};

const positiveMergeSanitizer = ({
  dossier,
  reviewers,
  chair,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly reviewers: readonly CatalogCouncilReviewerOutput[];
  readonly chair: CatalogCouncilChairOutput | null;
}): boolean =>
  new Set(reviewers.map((reviewer) => reviewer.reviewer)).size === REVIEWER_ROLES.length &&
  REVIEWER_ROLES.every((role) => reviewers.some((reviewer) => reviewer.reviewer === role)) &&
  reviewers.every((reviewer) => reviewer.recommendation === "merge") &&
  chair?.approval === "approve_merge" &&
  directionForDecision({ dossier, chair }).sourceEntityId > 0 &&
  !hasDecisiveCounterexample(reviewers) &&
  exactExhaustiveFreshCoverage(dossier);

const assertReviewerRole = (
  output: CatalogCouncilReviewerOutput,
  expectedRole: CatalogCouncilReviewerRole,
) => {
  if (output.reviewer !== expectedRole) {
    throw new Error(
      `Catalog council reviewer role mismatch: expected ${expectedRole}, received ${output.reviewer}`,
    );
  }
  return output;
};

const runReviewers = ({
  codex,
  dossier,
  freshnessHash,
}: {
  readonly codex: CodexRuntimeService;
  readonly dossier: CatalogEvidenceReport;
  readonly freshnessHash: string;
}) =>
  Effect.all(
    REVIEWER_ROLES.map((role) =>
      codex
        .runStructured({
          prompt: reviewerPrompt({ role, dossier, freshnessHash }),
          schema: ReviewerOutputSchema,
          jsonSchema: REVIEWER_OUTPUT_JSON_SCHEMA,
          structuredOutputKind: "reviewer",
          reasoningEffort: "high",
        })
        .pipe(
          Effect.map((result) =>
            assertReviewerRole(result.output as CatalogCouncilReviewerOutput, role),
          ),
        ),
    ),
    { concurrency: 3 },
  );

const runChair = ({
  codex,
  dossier,
  reviewers,
  freshnessHash,
}: {
  readonly codex: CodexRuntimeService;
  readonly dossier: CatalogEvidenceReport;
  readonly reviewers: readonly CatalogCouncilReviewerOutput[];
  readonly freshnessHash: string;
}) =>
  codex
    .runStructured({
      prompt: chairPrompt({
        dossier,
        reviewerSummaries: reviewers.map(compactReviewerVote),
        freshnessHash,
      }),
      schema: ChairOutputSchema,
      jsonSchema: CHAIR_OUTPUT_JSON_SCHEMA,
      structuredOutputKind: "chair",
      reasoningEffort: "xhigh",
    })
    .pipe(Effect.map((result) => result.output as CatalogCouncilChairOutput));

const expandToTerminalCoverage = ({
  evidence,
  dossier,
  maxExpansions,
}: {
  readonly evidence: CatalogEvidenceService;
  readonly dossier: CatalogEvidenceReport;
  readonly maxExpansions: number;
}) =>
  Effect.gen(function* () {
    let current = dossier;
    for (let index = 0; index < maxExpansions; index += 1) {
      if (current.coveragePolicy.policy !== "needs_expansion") return current;
      if (current.nextBatch.documentIds.length === 0) return current;
      current = yield* evidence.expandEvidence(current, {
        documentIds: current.nextBatch.documentIds,
      });
    }
    return current;
  });

const citationDocumentIds = (
  dossier: CatalogEvidenceReport,
  evidenceIds: readonly string[],
): readonly number[] => {
  const byId = new Map(dossier.citations.map((citation) => [citation.citationId, citation]));
  return [
    ...new Set(
      evidenceIds
        .map((id) => byId.get(id)?.documentId)
        .filter((id): id is number => id !== undefined),
    ),
  ].sort((left, right) => left - right);
};

const proposalPreconditions = ({
  dossier,
  direction,
  applicationBlockedReasons,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly direction: EntityDirection;
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
}): readonly HashPrecondition[] => [
  ...dossier.candidate.preconditions,
  { kind: "catalog_epoch", digest: dossier.epochFingerprint },
  { kind: "council_evidence", digest: dossier.coverageHash },
  { kind: "council_evidence", digest: dossier.xReceipt.stateHash },
  { kind: "council_evidence", digest: dossier.yReceipt.stateHash },
  { kind: "council_evidence", digest: freshnessHashFor(dossier) },
  {
    kind: "council_evidence",
    digest: entityFingerprint({
      label: "source",
      entityId: direction.sourceEntityId,
      dossier,
      applicationBlockedReasons,
    }),
  },
  {
    kind: "council_evidence",
    digest: entityFingerprint({
      label: "target",
      entityId: direction.targetEntityId,
      dossier,
      applicationBlockedReasons,
    }),
  },
  {
    kind: "council_evidence",
    digest: freshDependencyFingerprint(dossier, applicationBlockedReasons),
  },
];

const persistDecision = ({
  ledger,
  decision,
  dossier,
  reviewers,
  chair,
  createdAt,
}: {
  readonly ledger: OperationalLedgerService;
  readonly decision: CatalogCouncilDecision;
  readonly dossier: CatalogEvidenceReport;
  readonly reviewers: readonly CatalogCouncilReviewerOutput[];
  readonly chair: CatalogCouncilChairOutput | null;
  readonly createdAt: string;
}): Effect.Effect<CatalogCouncilDecision, unknown> =>
  Effect.gen(function* () {
    const proposalId = proposalIdFor(dossier);
    const evidenceFingerprint = evidenceFingerprintFor(dossier);
    const direction = {
      sourceEntityId: decision.persistenceRecord.sourceEntityId,
      targetEntityId: decision.persistenceRecord.targetEntityId,
    };
    const safetyInputs = safetyInputsForDossier({
      dossier,
      applicationBlockedReasons: decision.applicationBlockedReasons,
    });
    const proposedValues = {
      scope: "catalog" as const,
      entityKind: dossier.candidate.kind,
      intendedAction: "merge" as const,
      sourceEntityId: direction.sourceEntityId,
      targetEntityId: direction.targetEntityId,
      proposedValue: null,
      candidateIds: [dossier.candidate.candidateId],
      evidenceDocumentIds: dossier.inspectedDocumentIds,
      expectedProposalFingerprint: dossier.candidate.expectedProposalFingerprint,
      expectedEvidenceFingerprint: evidenceFingerprint,
      ...safetyInputs,
    };
    const preconditions = proposalPreconditions({
      dossier,
      direction,
      applicationBlockedReasons: decision.applicationBlockedReasons,
    });
    const proposal = yield* ledger.recordProposal({
      proposalId,
      ownerId: dossier.candidate.epochId,
      scope: "catalog",
      proposalHash: digest("catalog_council_proposal", { proposedValues, preconditions }),
      proposedValues,
      evidenceIds: decision.citedEvidenceIds,
      coverage: dossier.coveragePolicy.coverage,
      rationale: "Catalog council recorded a compact merge review proposal.",
      preconditions,
      createdAt,
    });
    const reviewerRecords = yield* Effect.forEach(reviewers, (reviewer) => {
      const evidenceCitationIds = [
        ...new Set([...reviewer.evidenceCitationIds, ...reviewer.counterexampleCitationIds]),
      ].sort();
      return ledger.recordCouncilVote({
        evidenceId: evidenceIdFor(dossier, reviewer.reviewer, proposalId),
        epochId: dossier.candidate.epochId,
        candidateId: dossier.candidate.candidateId,
        proposalId,
        reviewer: reviewer.reviewer,
        verdict:
          reviewer.recommendation === "merge" || reviewer.recommendation === "new_entity_allowed"
            ? "support"
            : reviewer.recommendation === "keep_separate" || reviewer.decisiveCounterexample
              ? "oppose"
              : "abstain",
        evidenceDocumentIds: citationDocumentIds(dossier, evidenceCitationIds),
        inspectedDocuments: dossier.inspectedDocumentIds.length,
        totalDocuments: dossier.assignmentSets.unionDocumentIds.length,
        xReceiptCount: dossier.xReceipt.receiptCount,
        yReceiptCount: dossier.yReceipt.receiptCount,
        xReceiptHash: dossier.xReceipt.stateHash,
        yReceiptHash: dossier.yReceipt.stateHash,
        proposalFingerprint: dossier.candidate.expectedProposalFingerprint,
        evidenceFingerprint,
        rationale: reviewer.rationale,
        dissent:
          reviewer.recommendation === "merge" && !reviewer.decisiveCounterexample
            ? null
            : reviewer.rationale,
        createdAt,
        decidedAt: createdAt,
      });
    });
    const chairDecision = yield* ledger.recordChairDecision({
      kind: "compact_chair_decision",
      epochId: dossier.candidate.epochId,
      candidateIds: [dossier.candidate.candidateId],
      proposalId,
      verdict:
        decision.decision === "merge_review_ready"
          ? "approve"
          : decision.decision === "keep_separate"
            ? "reject"
            : "needs_human",
      action: decision.decision === "keep_separate" ? "reject" : "request_review",
      sourceEntityId: direction.sourceEntityId,
      targetEntityId: direction.targetEntityId,
      rationale: chair?.rationale ?? decision.rationale,
      dissent: decision.decision === "merge_review_ready" ? null : decision.rationale,
      evidenceIds: reviewerRecords.map((record) => record.evidenceId),
      confidence: decision.decision === "merge_review_ready" ? 1 : 0,
      proposalFingerprint: dossier.candidate.expectedProposalFingerprint,
      evidenceFingerprint,
      coverageHash: dossier.coverageHash,
      coverageCount: dossier.coveragePolicy.inspectedCount,
      inspectedDocumentCount: dossier.inspectedDocumentIds.length,
      totalDocumentCount: dossier.assignmentSets.unionDocumentIds.length,
      createdAt,
      decidedAt: createdAt,
    });
    const persistedRecords: CatalogCouncilPersistedRecords = {
      proposal,
      reviewerRecords,
      chairDecision,
    };
    return {
      ...decision,
      proposalId,
      persistenceRecord: {
        ...decision.persistenceRecord,
        proposalId,
      },
      persistedRecords,
    };
  });

export interface CatalogCouncilService {
  readonly optimizeCatalog: (
    options?: CatalogCouncilScoutingOptions & CatalogCouncilRunCandidateOptions,
  ) => Effect.Effect<
    CatalogCouncilOptimizeResult,
    unknown,
    CatalogEvidenceService | CodexRuntimeService | OperationalLedgerService
  >;
  readonly runCandidate: (
    epoch: CatalogEvidenceEpoch,
    candidate: CatalogMergeCandidate,
    options?: CatalogCouncilRunCandidateOptions,
  ) => Effect.Effect<
    CatalogCouncilDecision,
    unknown,
    CatalogEvidenceService | CodexRuntimeService | OperationalLedgerService
  >;
  readonly scoutMergeDossiers: (
    options?: CatalogCouncilScoutingOptions,
  ) => Effect.Effect<CatalogCouncilScoutResult, unknown, CatalogEvidenceService>;
  readonly reviewMergeDossier: (
    dossier: CatalogEvidenceReport,
    options?: CatalogCouncilReviewOptions,
  ) => Effect.Effect<CatalogCouncilDecision, unknown, CodexRuntimeService>;
  readonly reviewNewEntity: (
    request: CatalogCouncilNewEntityRequest,
    options?: { readonly createdAt?: string },
  ) => Effect.Effect<CatalogCouncilNewEntityDecision, unknown, CodexRuntimeService>;
}

export const CatalogCouncilService =
  Context.GenericTag<CatalogCouncilService>("CatalogCouncilService");

export const makeCatalogCouncilService = (): CatalogCouncilService => ({
  optimizeCatalog: (options = {}) =>
    Effect.gen(function* () {
      const evidence = yield* CatalogEvidenceService;
      const epoch = yield* evidence.buildEpoch({
        scope: options.scope,
        createdAt: options.createdAt,
      });
      const candidates = (yield* evidence.blockCandidates(epoch)).slice(
        0,
        options.candidateLimit ?? 10,
      );
      const decisions = yield* Effect.forEach(
        candidates,
        (candidate) =>
          makeCatalogCouncilService().runCandidate(epoch, candidate, {
            createdAt: options.createdAt,
            unsafeDependencies: options.unsafeDependencies,
            maxExpansions: options.maxExpansions,
          }),
        { concurrency: 1 },
      );
      return { epoch, candidates, decisions };
    }),

  runCandidate: (epoch, candidate, options = {}) =>
    Effect.gen(function* () {
      const evidence = yield* CatalogEvidenceService;
      const codex = yield* CodexRuntimeService;
      const ledger = yield* OperationalLedgerService;
      const createdAt = options.createdAt ?? new Date().toISOString();
      const initialDossier = yield* evidence.collectEvidence(epoch, candidate);
      const initialFreshnessHash = freshnessHashFor(initialDossier);
      const initialReviewers = yield* runReviewers({
        codex,
        dossier: initialDossier,
        freshnessHash: initialFreshnessHash,
      });
      if (hasDecisiveCounterexample(initialReviewers)) {
        const decision = decisionFromVotes({
          dossier: initialDossier,
          reviewers: initialReviewers,
          chair: null,
          options,
          createdAt,
        });
        return yield* persistDecision({
          ledger,
          decision,
          dossier: initialDossier,
          reviewers: initialReviewers,
          chair: null,
          createdAt,
        });
      }

      const finalDossier = yield* expandToTerminalCoverage({
        evidence,
        dossier: initialDossier,
        maxExpansions: options.maxExpansions ?? 1_000,
      });
      const finalFreshnessHash = freshnessHashFor(finalDossier);
      const finalReviewers =
        finalDossier.dossierFingerprint === initialDossier.dossierFingerprint
          ? initialReviewers
          : yield* runReviewers({
              codex,
              dossier: finalDossier,
              freshnessHash: finalFreshnessHash,
            });
      if (hasDecisiveCounterexample(finalReviewers)) {
        const decision = decisionFromVotes({
          dossier: finalDossier,
          reviewers: finalReviewers,
          chair: null,
          options,
          createdAt,
        });
        return yield* persistDecision({
          ledger,
          decision,
          dossier: finalDossier,
          reviewers: finalReviewers,
          chair: null,
          createdAt,
        });
      }
      const chair = yield* runChair({
        codex,
        dossier: finalDossier,
        reviewers: finalReviewers,
        freshnessHash: finalFreshnessHash,
      });
      const reviewedDecision = decisionFromVotes({
        dossier: finalDossier,
        reviewers: finalReviewers,
        chair,
        options,
        createdAt,
      });
      const decision = positiveMergeSanitizer({
        dossier: finalDossier,
        reviewers: finalReviewers,
        chair,
      })
        ? reviewedDecision
        : {
            ...reviewedDecision,
            decision: "needs_review" as const,
            rationale: "Council did not satisfy sanitized positive-merge requirements.",
            persistenceRecord: {
              ...reviewedDecision.persistenceRecord,
              decision: "needs_review" as const,
            },
          };
      return yield* persistDecision({
        ledger,
        decision,
        dossier: finalDossier,
        reviewers: finalReviewers,
        chair,
        createdAt,
      });
    }),

  scoutMergeDossiers: (options = {}) =>
    Effect.gen(function* () {
      const evidence = yield* CatalogEvidenceService;
      const epoch = yield* evidence.buildEpoch({
        scope: options.scope,
        createdAt: options.createdAt,
      });
      const candidates = (yield* evidence.blockCandidates(epoch)).slice(
        0,
        options.candidateLimit ?? 10,
      );
      const dossiers = yield* Effect.forEach(
        candidates,
        (candidate) => evidence.collectEvidence(epoch, candidate),
        { concurrency: 2 },
      );
      return { epoch, candidates, dossiers };
    }),

  reviewMergeDossier: (dossier, options = {}) =>
    Effect.gen(function* () {
      const codex = yield* CodexRuntimeService;
      const createdAt = options.createdAt ?? new Date().toISOString();
      const freshnessHash = freshnessHashFor(dossier);
      const reviewers = yield* runReviewers({ codex, dossier, freshnessHash });
      if (hasDecisiveCounterexample(reviewers)) {
        return decisionFromVotes({ dossier, reviewers, chair: null, options, createdAt });
      }
      const chair = yield* runChair({ codex, dossier, reviewers, freshnessHash });
      return decisionFromVotes({ dossier, reviewers, chair, options, createdAt });
    }),

  reviewNewEntity: (request, options = {}) =>
    Effect.gen(function* () {
      const codex = yield* CodexRuntimeService;
      const createdAt = options.createdAt ?? new Date().toISOString();
      const authenticEvidenceIds = new Set(request.authenticEvidenceIds);
      assertKnownEvidence({
        evidenceIds: request.evidenceCitationIds,
        validIds: authenticEvidenceIds,
        label: "new_entity_request",
      });
      const reviewerRoles: readonly CatalogCouncilReviewerRole[] = [
        "taxonomy_curator",
        "document_evidence_auditor",
      ];
      const reviewers = yield* Effect.all(
        reviewerRoles.map((role) =>
          codex
            .runStructured({
              prompt: newEntityReviewerPrompt({ role, request }),
              schema: ReviewerOutputSchema,
              jsonSchema: REVIEWER_OUTPUT_JSON_SCHEMA,
              structuredOutputKind: "reviewer",
              reasoningEffort: "high",
            })
            .pipe(
              Effect.map((result) =>
                assertReviewerRole(result.output as CatalogCouncilReviewerOutput, role),
              ),
            ),
        ),
        { concurrency: 2 },
      );
      for (const reviewer of reviewers) {
        assertKnownEvidence({
          evidenceIds: [...reviewer.evidenceCitationIds, ...reviewer.counterexampleCitationIds],
          validIds: authenticEvidenceIds,
          label: reviewer.reviewer,
        });
        assertVoteHashes({
          vote: reviewer,
          coverageHash: request.coverageHash,
          freshnessHash: request.freshnessHash,
          label: reviewer.reviewer,
        });
      }
      const chair = yield* codex
        .runStructured({
          prompt: newEntityChairPrompt({
            request,
            reviewerSummaries: reviewers.map(compactReviewerVote),
          }),
          schema: ChairOutputSchema,
          jsonSchema: CHAIR_OUTPUT_JSON_SCHEMA,
          structuredOutputKind: "chair",
          reasoningEffort: "xhigh",
        })
        .pipe(Effect.map((result) => result.output as CatalogCouncilChairOutput));
      assertVoteHashes({
        vote: chair,
        coverageHash: request.coverageHash,
        freshnessHash: request.freshnessHash,
        label: "chair",
      });
      assertKnownEvidence({
        evidenceIds: chair.evidenceCitationIds,
        validIds: authenticEvidenceIds,
        label: "chair",
      });
      const compactReviewers = reviewers.map(compactReviewerVote);
      const chairVote = compactChairVote(chair);
      const approvals = reviewers.filter(
        (reviewer) => reviewer.recommendation === "new_entity_allowed",
      ).length;
      const approved = approvals >= 2 && chair.approval === "approve_new_entity";
      const citedEvidenceIds = allCitedIds([...compactReviewers, chairVote]);
      return {
        decisionId: `new_entity_${canonicalSha256({
          requestId: request.requestId,
          compactReviewers,
          chairVote,
          createdAt,
        }).slice(0, 24)}`,
        requestId: request.requestId,
        decision: approved ? "new_entity_review_ready" : "needs_review",
        humanReviewRequired: true,
        automaticApplication: "disabled",
        reviewerVotes: compactReviewers,
        chairVote,
        citedEvidenceIds,
        coverageHash: request.coverageHash,
        freshnessHash: request.freshnessHash,
        rationale: approved
          ? "Two reviewers and chair approved a human-review new entity dossier."
          : "New entity request did not receive the required reviewer and chair approvals.",
        createdAt,
      };
    }),
});

export const CatalogCouncilServiceLive = Layer.succeed(
  CatalogCouncilService,
  makeCatalogCouncilService(),
);
