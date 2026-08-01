import { canonicalSha256 } from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  CatalogEvidenceService,
  type CatalogEvidenceService as CatalogEvidenceServiceType,
} from "../../../src/services/CatalogEvidenceService.js";
import { CodexRuntimeService } from "../../../src/services/CodexRuntimeService.js";
import {
  CatalogCouncilService,
  CatalogCouncilServiceLive,
} from "../../../src/services/catalog-council/index.js";
import {
  buildEvidenceReport,
  citationFor,
} from "../../../src/services/catalog-evidence/evidence.js";
import { digest } from "../../../src/services/catalog-evidence/hash.js";
import type {
  CatalogEvidenceEpoch,
  CatalogEvidenceReport,
  CatalogMergeCandidate,
  EntityAssignmentReceipt,
  FinalFreshnessCheck,
} from "../../../src/services/catalog-evidence/types.js";
import type { CodexRunRequest, CodexRunResult } from "../../../src/services/codex/types.js";
import { OperationalLedgerService } from "../../../src/services/OperationalLedgerService.js";
import type {
  RecordChairDecisionInput,
  RecordCouncilInput,
  RecordProposalInput,
} from "../../../src/services/operational-ledger/service.js";

const hash = (value: unknown) => canonicalSha256({ test: "catalog-council", value });

const receipt = (entityId: number, name: string): EntityAssignmentReceipt => ({
  kind: "tag",
  entityId,
  name,
  filterDescriptor: { path: "/documents/", params: { tags__id: entityId } },
  expectedApiCount: 2,
  fetchedCount: 2,
  nameHash: hash({ entityId, name }),
  documentIds: [1, 2],
  receiptCount: 2,
  documentIdsHash: hash([1, 2]),
  documents: [
    { documentId: 1, modified: "2026-07-20T10:00:00Z", stateHash: hash("doc-1") },
    { documentId: 2, modified: "2026-07-21T10:00:00Z", stateHash: hash("doc-2") },
  ],
  assignmentHash: hash({ entityId, ids: [1, 2] }),
  stateHash: hash({ receipt: entityId }),
  pageCount: 1,
  capturedAt: "2026-07-22T10:00:00Z",
  complete: true,
  consistencyErrors: [],
});

const candidate = (overrides: Partial<CatalogMergeCandidate> = {}): CatalogMergeCandidate => ({
  candidateId: "cand_test",
  epochId: "epoch_test",
  kind: "tag",
  xEntityId: 1,
  yEntityId: 2,
  xName: "Telekom",
  yName: "Deutsche Telekom",
  signals: ["normalized_name"],
  riskFlags: [],
  requiresHumanReview: false,
  score: 1,
  expectedEvidenceFingerprint: hash("expected-evidence"),
  expectedProposalFingerprint: hash("expected-proposal"),
  preconditions: [{ kind: "catalog_epoch", digest: hash("precondition") }],
  rationale: "Blocked by deterministic discovery only.",
  createdAt: "2026-07-22T10:00:00Z",
  ...overrides,
});

const finalFreshness = (complete = true): FinalFreshnessCheck => ({
  required: true,
  performed: true,
  complete,
  xReceiptHash: hash("fresh-x"),
  yReceiptHash: hash("fresh-y"),
  reproducedInitialReceipts: complete,
  checkedAt: "2026-07-22T10:05:00Z",
});

const dossier = ({
  exhaustive = true,
  fresh = true,
  riskCandidate = candidate(),
}: {
  readonly exhaustive?: boolean;
  readonly fresh?: boolean;
  readonly riskCandidate?: CatalogMergeCandidate;
} = {}): CatalogEvidenceReport => {
  const xReceipt = receipt(1, "Telekom");
  const yReceipt = receipt(2, "Deutsche Telekom");
  const docs = [
    {
      id: 1,
      title: "Telekom bill",
      content: `Telekom account service evidence ${"alpha ".repeat(30)}`,
      created: "2026-01-01T00:00:00Z",
      modified: "2026-07-20T10:00:00Z",
      correspondent: 10,
      document_type: 20,
      tags: [1, 2],
    },
    {
      id: 2,
      title: "Deutsche Telekom bill",
      content: `Deutsche Telekom account service evidence ${"beta ".repeat(30)}`,
      created: "2026-02-01T00:00:00Z",
      modified: "2026-07-21T10:00:00Z",
      correspondent: 10,
      document_type: 20,
      tags: [1, 2],
    },
  ];
  const citations = (exhaustive ? docs : docs.slice(0, 1)).map((doc) =>
    citationFor({ doc, candidateId: riskCandidate.candidateId, xReceipt, yReceipt }),
  );
  return buildEvidenceReport({
    candidate: riskCandidate,
    xReceipt,
    yReceipt,
    snapshots: docs.map((doc) => ({
      documentId: doc.id,
      stateHash: hash(`doc-${doc.id}`),
      modified: doc.modified,
      created: doc.created,
      tagIds: doc.tags,
      correspondentId: doc.correspondent,
      documentTypeId: doc.document_type,
      metadataSignature: hash({ metadata: doc.id }),
      contentSignature: hash({ content: doc.id }),
    })),
    citations,
    expansions: [],
    finalFreshness: exhaustive ? finalFreshness(fresh) : finalFreshness(false),
    catalogFingerprint: hash("catalog"),
    freshnessFingerprint: hash("freshness"),
    epochFingerprint: hash("epoch"),
  });
};

const freshnessHashFor = (report: CatalogEvidenceReport) =>
  digest("catalog_council_freshness", {
    finalFreshness: report.finalFreshness,
    xReceiptHash: report.finalFreshness.xReceiptHash,
    yReceiptHash: report.finalFreshness.yReceiptHash,
  });

const createCodexLayer = (
  options: {
    readonly decisiveCounterexample?: boolean;
    readonly forgedEvidence?: boolean;
    readonly reviewerRecommendation?:
      | "merge"
      | "keep_separate"
      | "needs_review"
      | "new_entity_allowed";
    readonly chairApproval?:
      | "approve_merge"
      | "approve_new_entity"
      | "keep_separate"
      | "needs_review";
    readonly chairSourceEntityId?: number;
    readonly chairTargetEntityId?: number;
    readonly reviewerRoleOverride?:
      | "taxonomy_curator"
      | "document_evidence_auditor"
      | "counterexample_hunter";
  } = {},
) => {
  const calls: CodexRunRequest[] = [];
  let active = 0;
  let maxActive = 0;
  const runStructured = vi.fn((request: CodexRunRequest) =>
    Effect.async<CodexRunResult>((resume) => {
      calls.push(request);
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        const prompt = JSON.parse(request.prompt) as {
          role?: string;
          task: string;
          expectedCoverageHash?: string;
          expectedFreshnessHash?: string;
          request?: { coverageHash: string; freshnessHash: string; evidenceCitationIds: string[] };
          dossier?: {
            candidate?: { xEntityId: number; yEntityId: number };
            citationIds: string[];
            coverageHash: string;
          };
        };
        const coverageHash =
          prompt.expectedCoverageHash ?? prompt.request?.coverageHash ?? hash("coverage");
        const freshnessHash =
          prompt.expectedFreshnessHash ?? prompt.request?.freshnessHash ?? hash("freshness");
        const evidenceIds = options.forgedEvidence
          ? ["citation_forged"]
          : (prompt.request?.evidenceCitationIds ?? prompt.dossier?.citationIds ?? []).slice(0, 1);
        const output =
          request.structuredOutputKind === "chair"
            ? {
                approval:
                  options.chairApproval ??
                  (prompt.task === "catalog_new_entity_chair"
                    ? "approve_new_entity"
                    : "approve_merge"),
                rationale: "chair compact rationale",
                sourceEntityId:
                  options.chairSourceEntityId ?? prompt.dossier?.candidate?.xEntityId ?? 1,
                targetEntityId:
                  options.chairTargetEntityId ?? prompt.dossier?.candidate?.yEntityId ?? 2,
                evidenceCitationIds: evidenceIds,
                coverageHash,
                freshnessHash,
              }
            : {
                reviewer: options.reviewerRoleOverride ?? prompt.role,
                recommendation:
                  options.reviewerRecommendation ??
                  (prompt.task === "catalog_new_entity_reviewer" ? "new_entity_allowed" : "merge"),
                rationale: "reviewer compact rationale",
                evidenceCitationIds: evidenceIds,
                coverageHash,
                freshnessHash,
                decisiveCounterexample:
                  options.decisiveCounterexample && prompt.role === "counterexample_hunter",
                counterexampleCitationIds:
                  options.decisiveCounterexample && prompt.role === "counterexample_hunter"
                    ? evidenceIds
                    : [],
              };
        active -= 1;
        resume(
          Effect.succeed({
            output,
            rawOutput: JSON.stringify(output),
            usage: {},
            caps: { stdoutBytes: 0, stderrBytes: 0 },
            exitCode: 0,
            signal: null,
            redactedLog: {},
          } as CodexRunResult),
        );
      }, 5);
    }),
  );
  return {
    layer: Layer.succeed(CodexRuntimeService, { runStructured }),
    mocks: { runStructured, calls, maxActive: () => maxActive },
  };
};

const runCouncil = <A, E, R>(
  layer: Layer.Layer<R>,
  effect: Effect.Effect<A, E, R | CatalogCouncilService>,
) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.mergeAll(CatalogCouncilServiceLive, layer))));

const createLedgerLayer = () => {
  const proposals: RecordProposalInput[] = [];
  const councilVotes: RecordCouncilInput[] = [];
  const chairDecisions: RecordChairDecisionInput[] = [];
  const ledger = {
    recordProposal: vi.fn((input: RecordProposalInput) => {
      proposals.push(input);
      return Effect.succeed({
        proposalId: input.proposalId,
        proposedValues: input.proposedValues,
        evidenceIds: input.evidenceIds ?? [],
        preconditions: input.preconditions,
      });
    }),
    recordCouncilVote: vi.fn((input: RecordCouncilInput) => {
      councilVotes.push(input);
      return Effect.succeed({
        evidenceId: input.evidenceId,
        reviewer: input.reviewer,
        verdict: input.verdict,
        proposalId: input.proposalId ?? null,
      });
    }),
    recordChairDecision: vi.fn((input: RecordChairDecisionInput) => {
      chairDecisions.push(input);
      return Effect.succeed(input);
    }),
  } as unknown as OperationalLedgerService;
  return {
    layer: Layer.succeed(OperationalLedgerService, ledger),
    mocks: { proposals, councilVotes, chairDecisions, ledger },
  };
};

const epoch = {
  epochId: "epoch_test",
  scope: ["tag"],
  createdAt: "2026-07-22T10:00:00Z",
  catalogFingerprint: hash("catalog"),
  freshnessFingerprint: hash("freshness"),
  epochFingerprint: hash("epoch"),
  scanStart: {
    observedAt: "2026-07-22T10:00:00Z",
    catalogFingerprint: hash("catalog"),
    freshnessFingerprint: hash("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 2,
  },
  scanEnd: {
    observedAt: "2026-07-22T10:00:01Z",
    catalogFingerprint: hash("catalog"),
    freshnessFingerprint: hash("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 2,
  },
  scanAttempts: 1,
  unstable: false,
  totalDocuments: 2,
  entities: { tag: [], correspondent: [], document_type: [] },
  snapshots: [],
  policy: {},
} satisfies CatalogEvidenceEpoch;

const createEvidenceLayer = ({
  initial = dossier({ exhaustive: false }),
  expanded = dossier(),
}: {
  readonly initial?: CatalogEvidenceReport;
  readonly expanded?: CatalogEvidenceReport;
} = {}) => {
  const evidence = {
    buildEpoch: vi.fn(() => Effect.succeed(epoch)),
    blockCandidates: vi.fn(() => Effect.succeed([initial.candidate])),
    collectEvidence: vi.fn(() => Effect.succeed(initial)),
    expandEvidence: vi.fn(() => Effect.succeed(expanded)),
    listUnusedReviews: vi.fn(() => Effect.succeed([])),
    validateCitationIds: vi.fn(),
  } as unknown as CatalogEvidenceServiceType;
  return {
    layer: Layer.succeed(CatalogEvidenceService, evidence),
    mocks: evidence as CatalogEvidenceServiceType & {
      collectEvidence: ReturnType<typeof vi.fn>;
      expandEvidence: ReturnType<typeof vi.fn>;
      blockCandidates: ReturnType<typeof vi.fn>;
      buildEpoch: ReturnType<typeof vi.fn>;
    },
  };
};

const createCandidateRunLayer = ({
  codex = createCodexLayer(),
  evidence = createEvidenceLayer(),
  ledger = createLedgerLayer(),
} = {}) => ({
  layer: Layer.mergeAll(codex.layer, evidence.layer, ledger.layer),
  codex: codex.mocks,
  evidence: evidence.mocks,
  ledger: ledger.mocks,
});

describe("CatalogCouncilService", () => {
  it("runs three reviewers in parallel, then xhigh chair, and emits compact human-review merge readiness", async () => {
    const report = dossier();
    const { layer, mocks } = createCodexLayer();
    const decision = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(report, {
          createdAt: "2026-07-22T10:10:00Z",
        });
      }),
    );

    expect(mocks.runStructured).toHaveBeenCalledTimes(4);
    expect(mocks.maxActive()).toBe(3);
    expect(mocks.calls.slice(0, 3).map((call) => call.structuredOutputKind)).toEqual([
      "reviewer",
      "reviewer",
      "reviewer",
    ]);
    expect(mocks.calls[3]).toMatchObject({
      structuredOutputKind: "chair",
      reasoningEffort: "xhigh",
    });
    expect(decision.decision).toBe("merge_review_ready");
    expect(decision.humanReviewRequired).toBe(true);
    expect(decision.automaticApplication).toBe("disabled");
    expect(decision.coverageHash).toBe(report.coverageHash);
    expect(decision.freshnessHash).toBe(freshnessHashFor(report));
    expect(decision.persistenceRecord).not.toHaveProperty("rawOutput");
    expect(decision.persistenceRecord).not.toHaveProperty("prompt");
  });

  it("stops before chair and keeps separate on a decisive counterexample", async () => {
    const report = dossier();
    const { layer, mocks } = createCodexLayer({ decisiveCounterexample: true });
    const decision = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(report);
      }),
    );

    expect(mocks.runStructured).toHaveBeenCalledTimes(3);
    expect(decision.decision).toBe("keep_separate");
    expect(decision.chairVote).toBeNull();
    expect(decision.rationale).toContain("Decisive counterexample");
  });

  it("refuses positive merge readiness without exhaustive fresh evidence even with unanimous votes", async () => {
    const report = dossier({ exhaustive: false });
    const { layer } = createCodexLayer();
    const decision = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(report);
      }),
    );

    expect(decision.decision).toBe("needs_review");
    expect(decision.coveragePolicy.exhaustive).toBe(false);
  });

  it("rejects forged cited evidence IDs", async () => {
    const { layer } = createCodexLayer({ forgedEvidence: true });
    await expect(
      runCouncil(
        layer,
        Effect.gen(function* () {
          const council = yield* CatalogCouncilService;
          return yield* council.reviewMergeDossier(dossier());
        }),
      ),
    ).rejects.toThrow("cited evidence IDs outside dossier");
  });

  it("identifies unsafe Paperless dependencies and disables automatic application", async () => {
    const report = dossier({
      riskCandidate: candidate({
        riskFlags: ["hierarchical", "matching_rule", "dependency_risk", "forced_review_high_risk"],
        requiresHumanReview: true,
      }),
    });
    const { layer } = createCodexLayer();
    const decision = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(report, {
          unsafeDependencies: ["saved_views", "inbox"],
        });
      }),
    );

    expect(decision.automaticApplication).toBe("disabled");
    expect(decision.applicationBlockedReasons).toEqual(
      expect.arrayContaining([
        "nested_tags",
        "matching_rules",
        "workflows",
        "permissions",
        "saved_views",
        "inbox",
      ]),
    );
  });

  it("requires two reviewers plus chair for ordinary-processing new catalog entities", async () => {
    const request = {
      requestId: "new-tag-1",
      kind: "tag" as const,
      proposedName: "Fiber Contract",
      source: "ordinary_processing" as const,
      rationale: "Ordinary processing found a repeated catalog concept.",
      evidenceCitationIds: ["citation_new_1"],
      authenticEvidenceIds: ["citation_new_1"],
      coverageHash: hash("new-coverage"),
      freshnessHash: hash("new-freshness"),
    };
    const approved = await runCouncil(
      createCodexLayer().layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewNewEntity(request);
      }),
    );
    const rejected = await runCouncil(
      createCodexLayer({ reviewerRecommendation: "needs_review" }).layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewNewEntity(request);
      }),
    );

    expect(approved.decision).toBe("new_entity_review_ready");
    expect(approved.humanReviewRequired).toBe(true);
    expect(approved.automaticApplication).toBe("disabled");
    expect(approved.reviewerVotes).toHaveLength(2);
    expect(approved.chairVote?.recommendation).toBe("approve_new_entity");
    expect(rejected.decision).toBe("needs_review");
  });

  it("scouts deterministic candidates and evidence through the F5 evidence service without Paperless writes", async () => {
    const report = dossier();
    const evidence = {
      buildEpoch: vi.fn(() => Effect.succeed(epoch)),
      blockCandidates: vi.fn(() => Effect.succeed([report.candidate])),
      collectEvidence: vi.fn(() => Effect.succeed(report)),
      listUnusedReviews: vi.fn(() => Effect.succeed([])),
      expandEvidence: vi.fn(),
      validateCitationIds: vi.fn(),
    } as unknown as CatalogEvidenceServiceType;
    const layer = Layer.mergeAll(
      Layer.succeed(CatalogEvidenceService, evidence),
      createCodexLayer().layer,
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.scoutMergeDossiers({ scope: ["tag"], candidateLimit: 1 });
      }).pipe(Effect.provide(Layer.mergeAll(CatalogCouncilServiceLive, layer))),
    );

    expect(result.candidates).toEqual([report.candidate]);
    expect(result.dossiers).toEqual([report]);
    expect(evidence.buildEpoch).toHaveBeenCalledWith({
      scope: ["tag"],
      createdAt: undefined,
    });
    expect(evidence.collectEvidence).toHaveBeenCalledWith(epoch, report.candidate);
  });

  it("runCandidate expands deterministically to exact exhaustive fresh coverage before positive merge readiness", async () => {
    const partial = dossier({ exhaustive: false });
    const final = dossier();
    const context = createCandidateRunLayer({
      evidence: createEvidenceLayer({ initial: partial, expanded: final }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, final.candidate, {
          createdAt: "2026-07-22T10:10:00Z",
        });
      }),
    );

    expect(context.evidence.collectEvidence).toHaveBeenCalledTimes(1);
    expect(context.evidence.expandEvidence).toHaveBeenCalledWith(partial, {
      documentIds: partial.nextBatch.documentIds,
    });
    expect(context.codex.runStructured).toHaveBeenCalledTimes(7);
    expect(decision.decision).toBe("merge_review_ready");
    expect(decision.coveragePolicy.inspectedCount).toBe(2);
    expect(decision.coveragePolicy.liveAssignedCount).toBe(2);
    expect(decision.persistedRecords?.reviewerRecords).toHaveLength(3);
    expect(context.ledger.proposals).toHaveLength(1);
    expect(context.ledger.proposals[0]?.proposedValues).toMatchObject({
      candidateRiskFlags: [],
      coverageRiskFlags: [],
      requiresHumanReview: false,
      applicationBlockedReasons: [],
    });
    expect(context.ledger.councilVotes.map((vote) => vote.reviewer).sort()).toEqual([
      "counterexample_hunter",
      "document_evidence_auditor",
      "taxonomy_curator",
    ]);
    expect(context.ledger.chairDecisions[0]).toMatchObject({
      verdict: "approve",
      action: "request_review",
      sourceEntityId: 1,
      targetEntityId: 2,
      coverageCount: 2,
      inspectedDocumentCount: 2,
      totalDocumentCount: 2,
    });
  });

  it("persists the chair-selected reverse merge direction", async () => {
    const context = createCandidateRunLayer({
      codex: createCodexLayer({ chairSourceEntityId: 2, chairTargetEntityId: 1 }),
      evidence: createEvidenceLayer({ initial: dossier(), expanded: dossier() }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, dossier().candidate);
      }),
    );

    expect(decision.decision).toBe("merge_review_ready");
    expect(decision.sourceEntityId).toBe(2);
    expect(decision.targetEntityId).toBe(1);
    expect(decision.persistenceRecord).toMatchObject({
      sourceEntityId: 2,
      targetEntityId: 1,
    });
    expect(context.ledger.proposals[0]?.proposedValues).toMatchObject({
      sourceEntityId: 2,
      targetEntityId: 1,
    });
    expect(context.ledger.proposals[0]?.preconditions.map(({ digest }) => digest)).toEqual(
      expect.arrayContaining([decision.sourceEntityFingerprint, decision.targetEntityFingerprint]),
    );
    expect(context.ledger.chairDecisions[0]).toMatchObject({
      sourceEntityId: 2,
      targetEntityId: 1,
    });
  });

  it("runCandidate persists sorted compact safety inputs for fingerprint replay", async () => {
    const riskCandidate = candidate({
      riskFlags: ["matching_rule", "dependency_risk", "forced_review_high_risk"],
      requiresHumanReview: true,
    });
    const report = dossier({ riskCandidate });
    const context = createCandidateRunLayer({
      evidence: createEvidenceLayer({ initial: report, expanded: report }),
    });

    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, riskCandidate, {
          unsafeDependencies: ["saved_views", "inbox"],
        });
      }),
    );

    expect(decision.applicationBlockedReasons).toEqual([
      "inbox",
      "matching_rules",
      "permissions",
      "saved_views",
      "workflows",
    ]);
    expect(context.ledger.proposals[0]?.proposedValues).toMatchObject({
      candidateRiskFlags: ["dependency_risk", "forced_review_high_risk", "matching_rule"],
      coverageRiskFlags: [],
      requiresHumanReview: true,
      applicationBlockedReasons: [
        "inbox",
        "matching_rules",
        "permissions",
        "saved_views",
        "workflows",
      ],
    });
    expect(context.ledger.chairDecisions[0]).toMatchObject({
      verdict: "approve",
      action: "request_review",
    });
  });

  it("rejects chair merge directions outside the dossier pair or with equal IDs", async () => {
    await expect(
      runCouncil(
        createCodexLayer({ chairSourceEntityId: 99, chairTargetEntityId: 1 }).layer,
        Effect.gen(function* () {
          const council = yield* CatalogCouncilService;
          return yield* council.reviewMergeDossier(dossier());
        }),
      ),
    ).rejects.toThrow("outside the dossier X/Y pair");

    await expect(
      runCouncil(
        createCodexLayer({ chairSourceEntityId: 1, chairTargetEntityId: 1 }).layer,
        Effect.gen(function* () {
          const council = yield* CatalogCouncilService;
          return yield* council.reviewMergeDossier(dossier());
        }),
      ),
    ).rejects.toThrow("same source and target entity ID");
  });

  it("rejects reviewer outputs whose role does not match the invoked persona", async () => {
    await expect(
      runCouncil(
        createCodexLayer({ reviewerRoleOverride: "document_evidence_auditor" }).layer,
        Effect.gen(function* () {
          const council = yield* CatalogCouncilService;
          return yield* council.reviewMergeDossier(dossier());
        }),
      ),
    ).rejects.toThrow("reviewer role mismatch");
  });

  it("requires exact inspected/fresh-union set equality, not only equal counts", async () => {
    const report = dossier();
    const wrongMemberReport: CatalogEvidenceReport = {
      ...report,
      inspectedDocumentIds: [1, 999],
      coveragePolicy: {
        ...report.coveragePolicy,
        policy: "exhaustive_fresh",
        inspectedCount: 2,
        liveAssignedCount: 2,
        coverage: 1,
        exhaustive: true,
        freshnessComplete: true,
      },
    };
    const decision = await runCouncil(
      createCodexLayer().layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(wrongMemberReport);
      }),
    );

    expect(decision.decision).toBe("needs_review");
    expect(decision.persistenceRecord.inspectedDocumentCount).toBe(2);
    expect(decision.persistenceRecord.totalDocumentCount).toBe(2);
  });

  it("changes entity fingerprints when the current receipt name hash changes", async () => {
    const original = dossier();
    const renamed: CatalogEvidenceReport = {
      ...original,
      xReceipt: {
        ...original.xReceipt,
        nameHash: hash({ entityId: 1, name: "Telekom AG" }),
      },
    };
    const layer = createCodexLayer().layer;

    const first = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(original);
      }),
    );
    const second = await runCouncil(
      layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.reviewMergeDossier(renamed);
      }),
    );

    expect(second.sourceEntityFingerprint).not.toBe(first.sourceEntityFingerprint);
    expect(second.persistenceRecord.sourceEntityFingerprint).toBe(second.sourceEntityFingerprint);
  });

  it("runCandidate fails stale after exhaustive expansion when final receipts move", async () => {
    const context = createCandidateRunLayer({
      evidence: createEvidenceLayer({
        initial: dossier({ exhaustive: false }),
        expanded: dossier({ fresh: false }),
      }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, dossier().candidate);
      }),
    );

    expect(decision.decision).toBe("needs_review");
    expect(decision.coveragePolicy.policy).toBe("stale_after_exhaustive");
    expect(context.ledger.chairDecisions[0]?.verdict).toBe("needs_human");
  });

  it("persists only compact proposal, reviewer, and chair records with replayable linkage", async () => {
    const context = createCandidateRunLayer({
      evidence: createEvidenceLayer({ initial: dossier(), expanded: dossier() }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, dossier().candidate);
      }),
    );
    const serialized = JSON.stringify({
      proposals: context.ledger.proposals,
      councilVotes: context.ledger.councilVotes,
      chairDecisions: context.ledger.chairDecisions,
    });

    expect(decision.proposalId).toMatch(/^prop_/);
    expect(context.ledger.proposals[0]).toMatchObject({
      proposalId: decision.proposalId,
      scope: "catalog",
      proposedValues: expect.objectContaining({
        sourceEntityId: 1,
        targetEntityId: 2,
        intendedAction: "merge",
        candidateIds: [decision.candidateId],
        candidateRiskFlags: [],
        coverageRiskFlags: [],
        requiresHumanReview: false,
        applicationBlockedReasons: [],
      }),
    });
    expect(
      context.ledger.councilVotes.every((vote) => vote.proposalId === decision.proposalId),
    ).toBe(true);
    expect(context.ledger.chairDecisions[0]?.proposalId).toBe(decision.proposalId);
    expect(serialized).not.toContain("Telekom bill");
    expect(serialized).not.toContain("UNTRUSTED_DOCUMENT_TEXT");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("rawOutput");
  });

  it("rejects forged new-entity citations against the authentic evidence set", async () => {
    await expect(
      runCouncil(
        createCodexLayer({ forgedEvidence: true }).layer,
        Effect.gen(function* () {
          const council = yield* CatalogCouncilService;
          return yield* council.reviewNewEntity({
            requestId: "new-tag-forged",
            kind: "tag",
            proposedName: "Forged",
            source: "ordinary_processing",
            rationale: "forged",
            evidenceCitationIds: ["citation_real"],
            authenticEvidenceIds: ["citation_real"],
            coverageHash: hash("coverage"),
            freshnessHash: hash("freshness"),
          });
        }),
      ),
    ).rejects.toThrow("cited evidence IDs outside dossier");
  });

  it("rejects partial coverage for positive merge even with unanimous reviewers and chair", async () => {
    const partial = dossier({ exhaustive: false });
    const context = createCandidateRunLayer({
      evidence: createEvidenceLayer({ initial: partial, expanded: partial }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, partial.candidate, { maxExpansions: 0 });
      }),
    );

    expect(decision.decision).toBe("needs_review");
    expect(decision.coveragePolicy.policy).toBe("needs_expansion");
    expect(context.ledger.chairDecisions[0]?.verdict).toBe("needs_human");
  });

  it("persists early concrete counterexample as keep_separate without expansion or chair Codex call", async () => {
    const context = createCandidateRunLayer({
      codex: createCodexLayer({ decisiveCounterexample: true }),
      evidence: createEvidenceLayer({
        initial: dossier({ exhaustive: false }),
        expanded: dossier(),
      }),
    });
    const decision = await runCouncil(
      context.layer,
      Effect.gen(function* () {
        const council = yield* CatalogCouncilService;
        return yield* council.runCandidate(epoch, dossier().candidate);
      }),
    );

    expect(decision.decision).toBe("keep_separate");
    expect(context.evidence.expandEvidence).not.toHaveBeenCalled();
    expect(context.codex.runStructured).toHaveBeenCalledTimes(3);
    expect(context.ledger.chairDecisions[0]).toMatchObject({
      verdict: "reject",
      action: "reject",
    });
  });
});
