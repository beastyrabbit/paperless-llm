import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { canonicalSha256, type HashPrecondition } from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type CatalogCommandRuntime,
  makeCatalogCommandHandlers,
} from "../../src/api/catalog/command-handlers.js";
import {
  CatalogQueryError,
  getCatalogEpoch,
  getCurrentCatalogHash,
  listCatalogCandidates,
  listCatalogEpochs,
  listCatalogEvidence,
  listCatalogProposals,
} from "../../src/api/catalog/query-handlers.js";
import { CatalogEvidenceService } from "../../src/services/CatalogEvidenceService.js";
import { CodexRuntimeService } from "../../src/services/CodexRuntimeService.js";
import {
  type ApplyReviewedCatalogProposalRequest,
  CatalogApplyMutationPort,
  CatalogApplyService,
} from "../../src/services/catalog-apply/index.js";
import {
  CatalogCouncilService,
  CatalogCouncilServiceLive,
  catalogCouncilEntityFingerprint,
} from "../../src/services/catalog-council/index.js";
import { buildEvidenceReport, citationFor } from "../../src/services/catalog-evidence/evidence.js";
import type {
  CatalogEvidenceEpoch,
  CatalogEvidenceReport,
  CatalogMergeCandidate,
  EntityAssignmentReceipt,
  FinalFreshnessCheck,
} from "../../src/services/catalog-evidence/types.js";
import type { CodexRunRequest, CodexRunResult } from "../../src/services/codex/types.js";
import {
  makeOperationalLedgerService,
  OperationalLedgerService,
  type OperationalLedgerServiceApi,
} from "../../src/services/OperationalLedgerService.js";
import { emptyOperationalLedger } from "../../src/services/operational-ledger/persistence.js";
import type { OperationalLedgerData } from "../../src/services/operational-ledger/types.js";
import {
  PaperlessService,
  type PaperlessService as PaperlessServiceApi,
} from "../../src/services/PaperlessService.js";

const digest = (value: string) => canonicalSha256({ test: value });
const now = "2026-07-22T10:00:00.000Z";

const precondition = (value: string): HashPrecondition => ({
  kind: "catalog_epoch",
  digest: digest(value),
});

const hash = (kind: string, value: unknown) => canonicalSha256({ kind, value });

const idsHash = (ids: readonly number[]) =>
  hash(
    "catalog_evidence_document_ids",
    [...ids].sort((left, right) => left - right),
  );

const receiptFixture = (entityId: number, name: string, documentIds: readonly number[]) => {
  const assignmentHash = digest(`assignment-${entityId}`);
  const nameHash = hash("catalog_evidence_entity_name", {
    kind: "tag",
    entityId,
    name,
  });
  const receipt = {
    kind: "tag" as const,
    entityId,
    filterDescriptor: { path: "/documents/" as const, params: { tags__id: entityId } },
    expectedApiCount: documentIds.length,
    fetchedCount: documentIds.length,
    pageCount: 1,
    documentIds,
    documents: [],
    capturedAt: now,
    assignmentHash,
    complete: true as const,
  };
  const stateHash = hash("catalog_evidence_entity_receipt", {
    kind: receipt.kind,
    entityId,
    nameHash,
    filterDescriptor: receipt.filterDescriptor,
    expectedApiCount: receipt.expectedApiCount,
    fetchedCount: receipt.fetchedCount,
    pageCount: receipt.pageCount,
    capturedAt: receipt.capturedAt,
    documentIds: [...documentIds].sort((left, right) => left - right),
    documents: [],
    assignmentHash,
  });
  return {
    receipt,
    nameHash,
    stateHash,
    documentIdsHash: idsHash(documentIds),
  };
};

const d3Receipt = (
  entityId: number,
  name: string,
  documentIds: readonly number[],
): EntityAssignmentReceipt => {
  const proof = receiptFixture(entityId, name, documentIds);
  return {
    ...proof.receipt,
    name,
    nameHash: proof.nameHash,
    receiptCount: proof.receipt.fetchedCount,
    documentIdsHash: proof.documentIdsHash,
    documents: documentIds.map((documentId) => ({
      documentId,
      modified: `2026-07-${String(10 + (documentId % 20)).padStart(2, "0")}T10:00:00.000Z`,
      stateHash: digest(`doc-${documentId}`),
    })),
    stateHash: proof.stateHash,
    consistencyErrors: [],
  };
};

const d3Candidate = (overrides: Partial<CatalogMergeCandidate> = {}): CatalogMergeCandidate => ({
  candidateId: "cand_vendor_merge",
  epochId: "cat_epoch_d3_d5",
  kind: "tag",
  xEntityId: 10,
  yEntityId: 20,
  xName: "Vendor GmbH",
  yName: "Vendor",
  signals: ["normalized_name"],
  riskFlags: [],
  requiresHumanReview: true,
  score: 1,
  expectedEvidenceFingerprint: digest("expected-evidence"),
  expectedProposalFingerprint: digest("expected-proposal"),
  preconditions: [precondition("d3-epoch")],
  rationale: "Duplicate vendor tags from deterministic evidence.",
  createdAt: now,
  ...overrides,
});

const d3Epoch = {
  epochId: "cat_epoch_d3_d5",
  scope: ["tag"],
  createdAt: now,
  catalogFingerprint: digest("catalog"),
  freshnessFingerprint: digest("freshness"),
  epochFingerprint: digest("epoch-fingerprint"),
  scanStart: {
    observedAt: now,
    catalogFingerprint: digest("catalog"),
    freshnessFingerprint: digest("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 3,
  },
  scanEnd: {
    observedAt: now,
    catalogFingerprint: digest("catalog"),
    freshnessFingerprint: digest("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 3,
  },
  scanAttempts: 1,
  unstable: false,
  totalDocuments: 3,
  entities: { tag: [], correspondent: [], document_type: [] },
  snapshots: [],
  policy: {},
} satisfies CatalogEvidenceEpoch;

const d3Freshness = (): FinalFreshnessCheck => ({
  required: true,
  performed: true,
  complete: true,
  xReceiptHash: receiptFixture(10, "Vendor GmbH", [101, 202]).stateHash,
  yReceiptHash: receiptFixture(20, "Vendor", [101, 202, 303]).stateHash,
  reproducedInitialReceipts: true,
  checkedAt: now,
});

const d3Report = (candidate = d3Candidate()): CatalogEvidenceReport => {
  const xReceipt = d3Receipt(10, "Vendor GmbH", [101, 202]);
  const yReceipt = d3Receipt(20, "Vendor", [101, 202, 303]);
  const docs = [101, 202, 303].map((id) => ({
    id,
    title: `Doc ${id}`,
    content: `Vendor duplicate evidence ${id} ${"alpha ".repeat(30)}`,
    created: `2026-01-${String(id % 20).padStart(2, "0")}T00:00:00.000Z`,
    modified: `2026-07-${String(10 + (id % 20)).padStart(2, "0")}T10:00:00.000Z`,
    correspondent: 1,
    document_type: 2,
    tags: id === 303 ? [20] : [10, 20],
  }));
  return buildEvidenceReport({
    candidate,
    xReceipt,
    yReceipt,
    snapshots: docs.map((doc) => ({
      documentId: doc.id,
      stateHash: digest(`doc-${doc.id}`),
      modified: doc.modified,
      created: doc.created,
      tagIds: doc.tags,
      correspondentId: doc.correspondent,
      documentTypeId: doc.document_type,
      metadataSignature: digest(`metadata-${doc.id}`),
      contentSignature: digest(`content-${doc.id}`),
    })),
    citations: docs.map((doc) =>
      citationFor({ doc, candidateId: candidate.candidateId, xReceipt, yReceipt }),
    ),
    expansions: [],
    finalFreshness: d3Freshness(),
    catalogFingerprint: d3Epoch.catalogFingerprint,
    freshnessFingerprint: d3Epoch.freshnessFingerprint,
    epochFingerprint: d3Epoch.epochFingerprint,
  });
};

const codexLayerForD3 = () => {
  const roleIndexes: Record<string, number> = {
    taxonomy_curator: 0,
    document_evidence_auditor: 1,
    counterexample_hunter: 2,
  };
  const runStructured = vi.fn((request: CodexRunRequest) =>
    Effect.succeed({
      output: (() => {
        const prompt = JSON.parse(request.prompt) as {
          role?: string;
          task: string;
          expectedCoverageHash?: string;
          expectedFreshnessHash?: string;
          dossier?: {
            candidate?: { xEntityId: number; yEntityId: number };
            citationIds: string[];
            coverageHash: string;
          };
        };
        const citationIds = prompt.dossier?.citationIds ?? [];
        if (request.structuredOutputKind === "chair") {
          return {
            approval: "approve_merge",
            sourceEntityId: prompt.dossier?.candidate?.xEntityId ?? 10,
            targetEntityId: prompt.dossier?.candidate?.yEntityId ?? 20,
            rationale: "chair compact rationale",
            evidenceCitationIds: citationIds,
            coverageHash: prompt.dossier?.coverageHash ?? prompt.expectedCoverageHash,
            freshnessHash: prompt.expectedFreshnessHash,
          };
        }
        const role = prompt.role ?? "taxonomy_curator";
        return {
          reviewer: role,
          recommendation: "merge",
          rationale: "reviewer compact rationale",
          evidenceCitationIds: [citationIds[roleIndexes[role] ?? 0]].filter(
            (id): id is string => typeof id === "string",
          ),
          coverageHash: prompt.dossier?.coverageHash ?? prompt.expectedCoverageHash,
          freshnessHash: prompt.expectedFreshnessHash,
          decisiveCounterexample: false,
          counterexampleCitationIds: [],
        };
      })(),
      rawOutput: "{}",
      usage: {},
      caps: { stdoutBytes: 0, stderrBytes: 0 },
      exitCode: 0,
      signal: null,
      redactedLog: {},
    } as CodexRunResult),
  );
  return Layer.succeed(CodexRuntimeService, { runStructured });
};

const entityFingerprint = (
  label: "source" | "target",
  proof: ReturnType<typeof receiptFixture>,
  entityId: number,
) =>
  catalogCouncilEntityFingerprint({
    label,
    kind: "tag",
    entityId,
    currentNameHash: proof.nameHash,
    receiptHash: proof.stateHash,
    assignmentHash: proof.receipt.assignmentHash,
    receiptCount: proof.receipt.documentIds.length,
    documentIdsHash: proof.documentIdsHash,
    safetyInputs: {
      candidateRiskFlags: [],
      coverageRiskFlags: [],
      requiresHumanReview: true,
      applicationBlockedReasons: [],
    },
  });

const catalogLedger = (): OperationalLedgerData => {
  const ledger = emptyOperationalLedger(now);
  const candidatePreconditions = [precondition("epoch")];
  const sourceProof = receiptFixture(10, "Vendor GmbH", [101, 202]);
  const targetProof = receiptFixture(20, "Vendor", [101, 202, 303]);
  const preconditions = [
    ...candidatePreconditions,
    {
      kind: "council_evidence" as const,
      digest: entityFingerprint("source", sourceProof, 10),
    },
    {
      kind: "council_evidence" as const,
      digest: entityFingerprint("target", targetProof, 20),
    },
  ];
  return {
    ...ledger,
    catalogEpochs: {
      cat_epoch_main: {
        kind: "ids_hashes_state",
        epochId: "cat_epoch_main",
        state: "proposed",
        scope: ["tag"],
        paperlessCatalogHash: digest("paperless-catalog"),
        candidateCount: 2,
        evidenceCount: 3,
        proposalCount: 1,
        retryCount: 0,
        createdAt: "2026-07-22T09:00:00.000Z",
        updatedAt: "2026-07-22T09:20:00.000Z",
        completedAt: null,
      },
    },
    proposals: {
      prop_catalog_merge: {
        kind: "undecided_catalog_proposal_values",
        scope: "catalog",
        proposalId: "prop_catalog_merge",
        ownerId: "cat_epoch_main",
        proposalHash: digest("proposal"),
        valueHash: digest("values"),
        proposedValues: {
          scope: "catalog",
          entityKind: "tag",
          intendedAction: "merge",
          sourceEntityId: 10,
          targetEntityId: 20,
          proposedValue: null,
          candidateIds: ["cand_vendor_merge", "cand_vendor_alias"],
          evidenceDocumentIds: [101, 202],
          expectedProposalFingerprint: digest("expected-proposal"),
          expectedEvidenceFingerprint: digest("expected-evidence"),
          candidateRiskFlags: [],
          coverageRiskFlags: [],
          requiresHumanReview: true,
          applicationBlockedReasons: [],
        },
        evidenceIds: ["evidence_curator", "evidence_auditor", "evidence_hunter"],
        coverage: 0.4,
        rationale: "Merge duplicate vendor tags using compact council facts.",
        preconditions,
        decision: "undecided",
        outcome: null,
        createdAt: "2026-07-22T09:25:00.000Z",
        decidedAt: null,
        compactedAt: null,
      },
    },
    councilRecords: {
      evidence_curator: {
        kind: "compact_council_vote",
        evidenceId: "evidence_curator",
        epochId: "cat_epoch_main",
        candidateId: "cand_vendor_merge",
        proposalId: "prop_catalog_merge",
        reviewer: "taxonomy_curator",
        verdict: "support",
        evidenceDocumentIds: [101],
        inspectedDocuments: 10,
        totalDocuments: 50,
        coverage: 0.2,
        coverageHash: digest("coverage-1"),
        xReceiptCount: 4,
        yReceiptCount: 6,
        xReceiptHash: sourceProof.stateHash,
        yReceiptHash: targetProof.stateHash,
        proposalFingerprint: digest("expected-proposal"),
        evidenceFingerprint: digest("expected-evidence"),
        rationale: "Names normalize to the same vendor.",
        dissent: null,
        createdAt: "2026-07-22T09:26:00.000Z",
        decidedAt: "2026-07-22T09:26:00.000Z",
      },
      evidence_auditor: {
        kind: "compact_council_vote",
        evidenceId: "evidence_auditor",
        epochId: "cat_epoch_main",
        candidateId: "cand_vendor_merge",
        proposalId: "prop_catalog_merge",
        reviewer: "document_evidence_auditor",
        verdict: "support",
        evidenceDocumentIds: [202],
        inspectedDocuments: 12,
        totalDocuments: 50,
        coverage: 0.24,
        coverageHash: digest("coverage-2"),
        xReceiptCount: 4,
        yReceiptCount: 6,
        xReceiptHash: sourceProof.stateHash,
        yReceiptHash: targetProof.stateHash,
        proposalFingerprint: digest("expected-proposal"),
        evidenceFingerprint: digest("expected-evidence"),
        rationale: "Assignments overlap in recent documents.",
        dissent: null,
        createdAt: "2026-07-22T09:27:00.000Z",
        decidedAt: "2026-07-22T09:27:00.000Z",
      },
      evidence_hunter: {
        kind: "compact_council_vote",
        evidenceId: "evidence_hunter",
        epochId: "cat_epoch_main",
        candidateId: "cand_vendor_merge",
        proposalId: "prop_catalog_merge",
        reviewer: "counterexample_hunter",
        verdict: "support",
        evidenceDocumentIds: [303],
        inspectedDocuments: 8,
        totalDocuments: 50,
        coverage: 0.16,
        coverageHash: digest("coverage-3"),
        xReceiptCount: 4,
        yReceiptCount: 6,
        xReceiptHash: sourceProof.stateHash,
        yReceiptHash: targetProof.stateHash,
        proposalFingerprint: digest("expected-proposal"),
        evidenceFingerprint: digest("expected-evidence"),
        rationale: "No counterexamples in the sampled documents.",
        dissent: null,
        createdAt: "2026-07-22T09:28:00.000Z",
        decidedAt: "2026-07-22T09:28:00.000Z",
      },
    },
    chairDecisions: {
      prop_catalog_merge: {
        kind: "compact_chair_decision",
        epochId: "cat_epoch_main",
        candidateIds: ["cand_vendor_merge", "cand_vendor_alias"],
        proposalId: "prop_catalog_merge",
        verdict: "approve",
        action: "approve",
        sourceEntityId: 10,
        targetEntityId: 20,
        rationale: "Chair approved the compact council decision.",
        dissent: null,
        evidenceIds: ["evidence_curator", "evidence_auditor", "evidence_hunter"],
        confidence: 0.91,
        proposalFingerprint: digest("expected-proposal"),
        evidenceFingerprint: digest("expected-evidence"),
        coverageHash: digest("chair-coverage"),
        coverageCount: 3,
        inspectedDocumentCount: 3,
        totalDocumentCount: 3,
        createdAt: "2026-07-22T09:29:00.000Z",
        decidedAt: "2026-07-22T09:30:00.000Z",
      },
    },
  };
};

const ledgerLayer = (data: OperationalLedgerData) => {
  const mutations = {
    setSetting: vi.fn(() => Effect.die("ledger write")),
    appendLedgerEntry: vi.fn(() => Effect.die("ledger write")),
    createAnalysisRun: vi.fn(() => Effect.die("ledger write")),
    transitionAnalysisRunState: vi.fn(() => Effect.die("ledger write")),
    recordAnalysisFailure: vi.fn(() => Effect.die("ledger write")),
    createCatalogEpoch: vi.fn(() => Effect.die("ledger write")),
    transitionCatalogEpochState: vi.fn(() => Effect.die("ledger write")),
    recordProposal: vi.fn(() => Effect.die("ledger write")),
    recordProposalDecision: vi.fn(() => Effect.die("ledger write")),
    recordCouncilVote: vi.fn(() => Effect.die("ledger write")),
    recordChairDecision: vi.fn(() => Effect.die("ledger write")),
    recordApplyJournal: vi.fn(() => Effect.die("ledger write")),
    acquireLease: vi.fn(() => Effect.die("ledger write")),
    heartbeatLease: vi.fn(() => Effect.die("ledger write")),
    releaseLease: vi.fn(() => Effect.die("ledger write")),
    recordProviderUsage: vi.fn(() => Effect.die("ledger write")),
    recordRandomCycle: vi.fn(() => Effect.die("ledger write")),
    compact: vi.fn(() => Effect.die("ledger write")),
  };
  const service = {
    paths: { dataDir: "/tmp", file: "/tmp/ledger.json" },
    getSnapshot: vi.fn(() => Effect.succeed(JSON.parse(JSON.stringify(data)))),
    getSnapshotJson: vi.fn(() => Effect.succeed(JSON.stringify(data))),
    ...mutations,
  } as unknown as OperationalLedgerServiceApi;
  return { layer: Layer.succeed(OperationalLedgerService, service), mutations };
};

const paperlessLayer = (
  options: {
    readonly missingSourceEntity?: boolean;
    readonly changedReceipts?: boolean;
    readonly renamedSourceEntity?: boolean;
    readonly deletedSourceEntityWithEmptyReceipt?: boolean;
  } = {},
) => {
  const writes = {
    updateDocument: vi.fn(() => Effect.die("paperless write")),
    updateDocumentExact: vi.fn(() => Effect.die("paperless write")),
    replaceDocumentMetadataExact: vi.fn(() => Effect.die("paperless write")),
    deleteTag: vi.fn(() => Effect.die("paperless write")),
    renameTag: vi.fn(() => Effect.die("paperless write")),
    mergeTags: vi.fn(() => Effect.die("paperless write")),
    submitBulkOperation: vi.fn(() => Effect.die("paperless write")),
    addNote: vi.fn(() => Effect.die("paperless write")),
  };
  const receipt = (entityId: number) => {
    if (options.missingSourceEntity && entityId === 10)
      return Effect.fail(new Error("missing tag"));
    const proof = receiptFixture(
      entityId,
      entityId === 10 ? "Vendor GmbH" : "Vendor",
      options.deletedSourceEntityWithEmptyReceipt && entityId === 10
        ? []
        : entityId === 10
          ? [101, 202]
          : [101, 202, 303],
    );
    return Effect.succeed({
      ...proof.receipt,
      assignmentHash:
        options.changedReceipts && entityId === 20
          ? digest("changed-assignment-20")
          : proof.receipt.assignmentHash,
    });
  };
  const service = {
    getTags: vi.fn(() =>
      Effect.succeed([
        ...(options.missingSourceEntity || options.deletedSourceEntityWithEmptyReceipt
          ? []
          : [
              {
                id: 10,
                name: options.renamedSourceEntity ? "Vendor Renamed GmbH" : "Vendor GmbH",
                slug: "vendor-gmbh",
              },
            ]),
        { id: 20, name: "Vendor", slug: "vendor" },
      ]),
    ),
    readTagAssignmentReceipt: vi.fn(receipt),
    ...writes,
  } as unknown as PaperlessServiceApi;
  return { layer: Layer.succeed(PaperlessService, service), writes };
};

const d3EvidenceLayer = (report: CatalogEvidenceReport) =>
  Layer.succeed(CatalogEvidenceService, {
    buildEpoch: vi.fn(() => Effect.succeed(d3Epoch)),
    blockCandidates: vi.fn(() => Effect.succeed([report.candidate])),
    collectEvidence: vi.fn(() => Effect.succeed(report)),
    expandEvidence: vi.fn(() => Effect.succeed(report)),
    listUnusedReviews: vi.fn(() => Effect.succeed([])),
    validateCitationIds: vi.fn(),
  } as unknown as CatalogEvidenceService);

const runD3CandidateIntoLedger = async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-d3-d5-"));
  const ledger = await Effect.runPromise(
    makeOperationalLedgerService({
      dataDir: tempDir,
      file: path.join(tempDir, "operational-ledger.json"),
    }),
  );
  const report = d3Report();
  await Effect.runPromise(
    ledger.createCatalogEpoch({
      epochId: d3Epoch.epochId,
      scope: d3Epoch.scope,
      paperlessCatalogHash: d3Epoch.catalogFingerprint,
      candidateCount: 1,
      evidenceCount: 3,
      proposalCount: 1,
      createdAt: now,
    }),
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const council = yield* CatalogCouncilService;
      return yield* council.runCandidate(d3Epoch, report.candidate, { createdAt: now });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          CatalogCouncilServiceLive,
          d3EvidenceLayer(report),
          codexLayerForD3(),
          Layer.succeed(OperationalLedgerService, ledger),
        ),
      ),
    ),
  );
  const snapshot = await Effect.runPromise(ledger.getSnapshot());
  return { tempDir, ledger, snapshot };
};

const commandRuntime = () => {
  const scheduled: { taskId: string; effect: Effect.Effect<void, never, unknown> }[] = [];
  const runtime: CatalogCommandRuntime = {
    schedule: vi.fn((taskId, effect) => {
      scheduled.push({ taskId, effect });
      return Effect.void;
    }),
    cancel: vi.fn(() => Effect.succeed(true)),
  };
  return { runtime, scheduled };
};

describe("catalog query handlers", () => {
  const expectNoMutations = (
    ledger: ReturnType<typeof ledgerLayer>,
    paperless: ReturnType<typeof paperlessLayer>,
  ) => {
    expect(Object.values(ledger.mutations).every((mock) => mock.mock.calls.length === 0)).toBe(
      true,
    );
    expect(Object.values(paperless.writes).every((mock) => mock.mock.calls.length === 0)).toBe(
      true,
    );
  };

  it("hydrates catalog candidates from live Paperless receipts with strict pagination", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogCandidates("cat_epoch_main", { limit: 1 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items).toHaveLength(1);
    expect(page.page).toMatchObject({ hasNextPage: true, limit: 1 });
    expect(page.items[0]).toMatchObject({
      candidateId: "cand_vendor_merge",
      // Live Paperless names are hydrated on the transient receipt (never persisted).
      x: { entityId: 10, receiptCount: 2, name: "Vendor GmbH" },
      y: { entityId: 20, receiptCount: 3, name: "Vendor" },
    });
    expectNoMutations(ledger, paperless);
  });

  it("rejects invalid or unknown catalog GET query parameters before widening reads", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer();
    const layer = Layer.merge(ledger.layer, paperless.layer);

    await expect(
      Effect.runPromise(
        Effect.either(listCatalogEpochs({ kind: "unknown_kind" })).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    await expect(
      Effect.runPromise(
        Effect.either(listCatalogEpochs({ state: "bogus" })).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    await expect(
      Effect.runPromise(
        Effect.either(
          listCatalogCandidates("cat_epoch_main", { proposalId: "forged" } as never),
        ).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    expectNoMutations(ledger, paperless);
  });

  it("keeps every catalog GET projection side-effect-free", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer();
    const layer = Layer.merge(ledger.layer, paperless.layer);

    await Effect.runPromise(listCatalogEpochs({ limit: 10 }).pipe(Effect.provide(layer)));
    await Effect.runPromise(getCatalogEpoch("cat_epoch_main").pipe(Effect.provide(layer)));
    await Effect.runPromise(
      listCatalogCandidates("cat_epoch_main", { limit: 10 }).pipe(Effect.provide(layer)),
    );
    await Effect.runPromise(
      listCatalogEvidence("cat_epoch_main", { limit: 10 }).pipe(Effect.provide(layer)),
    );
    await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(Effect.provide(layer)),
    );

    expectNoMutations(ledger, paperless);
  });

  it("returns council evidence from compact ledger facts without writes", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogEvidence("cat_epoch_main", { limit: 2 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items).toHaveLength(2);
    expect(page.page.hasNextPage).toBe(true);
    expect(page.items[0]?.evidenceId).toBe("evidence_hunter");
    expectNoMutations(ledger, paperless);
  });

  it("hydrates catalog proposals only from typed compact chair records and verified live citations", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      projectionVersion: "catalog_proposal_projection.v2",
      proposalId: "prop_catalog_merge",
      // Live Paperless names hydrated beside the ids (transient, never persisted).
      currentEntities: {
        x: { entityId: 10, kind: "tag", name: "Vendor GmbH" },
        y: { entityId: 20, kind: "tag", name: "Vendor" },
      },
      decision: {
        status: "undecided",
        outcome: null,
        decidedAt: null,
      },
      apply: {
        status: "not_started",
        latestJournalId: null,
        stepCount: 0,
        updatedAt: null,
      },
      evidence: {
        availability: "available",
        evidenceDocumentIds: [101, 202, 303],
        chair: {
          availability: "decision_recorded",
          verdict: "approve",
          action: "approve",
          evidenceIds: ["evidence_curator", "evidence_auditor", "evidence_hunter"],
          confidence: 0.91,
        },
      },
      freshness: {
        status: "fresh",
        currentMissing: false,
        stale: false,
      },
    });
    expect(page.items[0]).not.toHaveProperty("votes");
    expect(page.items[0]).not.toHaveProperty("safetyDependencies");
    expectNoMutations(ledger, paperless);
  });

  it("exposes persisted human decision and latest apply progress on catalog proposals", async () => {
    const data = catalogLedger();
    const proposal = data.proposals.prop_catalog_merge;
    if (!proposal) throw new Error("expected catalog proposal");
    data.proposals.prop_catalog_merge = {
      ...proposal,
      decision: "approved",
      outcome: "approved",
      decidedAt: "2026-07-22T09:31:00.000Z",
    };
    data.applyJournals.journal_catalog_apply_current = {
      kind: "apply_journal",
      journalId: "journal_catalog_apply_current",
      proposalId: "prop_catalog_merge",
      epochId: "cat_epoch_main",
      idempotencyKeyHash: digest("apply-idempotency"),
      status: "applying",
      preconditionHashes: [digest("precondition")],
      steps: [
        {
          stepId: "step_1",
          operation: "merge",
          paperlessTaskId: "task_1",
          beforeHash: digest("before"),
          afterHash: null,
          status: "running",
          recordedAt: "2026-07-22T09:32:00.000Z",
        },
      ],
      stepCount: 1,
      createdAt: "2026-07-22T09:32:00.000Z",
      updatedAt: "2026-07-22T09:33:00.000Z",
      compactedAt: null,
    };
    const ledger = ledgerLayer(data);
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      decision: {
        status: "approved",
        outcome: "approved",
        decidedAt: "2026-07-22T09:31:00.000Z",
      },
      apply: {
        status: "applying",
        latestJournalId: "journal_catalog_apply_current",
        stepCount: 1,
        updatedAt: "2026-07-22T09:33:00.000Z",
      },
    });
    expectNoMutations(ledger, paperless);
  });

  it("hydrates a real D3 persisted catalog proposal and marks live name, receipt, or safety drift stale", async () => {
    const { tempDir, snapshot } = await runD3CandidateIntoLedger();
    try {
      const proposal = Object.values(snapshot.proposals).find(
        (record) => record.scope === "catalog" && record.proposedValues?.scope === "catalog",
      );
      if (!proposal || proposal.proposedValues?.scope !== "catalog") {
        throw new Error("expected persisted catalog proposal");
      }
      expect(proposal.proposedValues).toMatchObject({
        candidateRiskFlags: [],
        coverageRiskFlags: [],
        requiresHumanReview: true,
        applicationBlockedReasons: [],
      });

      const hydrate = (
        data: OperationalLedgerData,
        options: Parameters<typeof paperlessLayer>[0] = {},
      ) =>
        Effect.runPromise(
          listCatalogProposals(d3Epoch.epochId, { limit: 10 }).pipe(
            Effect.provide(Layer.merge(ledgerLayer(data).layer, paperlessLayer(options).layer)),
          ),
        );

      const fresh = await hydrate(snapshot);
      expect(fresh.items[0]).toMatchObject({
        proposalId: proposal.proposalId,
        evidence: {
          availability: "available",
          evidenceDocumentIds: [101, 202, 303],
          chair: {
            availability: "decision_recorded",
            verdict: "approve",
            action: "request_review",
          },
        },
        freshness: { status: "fresh" },
      });

      await expect(hydrate(snapshot, { renamedSourceEntity: true })).resolves.toMatchObject({
        items: [{ freshness: { status: "stale" } }],
      });
      await expect(hydrate(snapshot, { changedReceipts: true })).resolves.toMatchObject({
        items: [{ freshness: { status: "stale" } }],
      });

      const mutatedSafety = JSON.parse(JSON.stringify(snapshot)) as OperationalLedgerData;
      const mutated = mutatedSafety.proposals[proposal.proposalId];
      if (mutated?.proposedValues?.scope !== "catalog") {
        throw new Error("expected mutable catalog proposal");
      }
      mutatedSafety.proposals[proposal.proposalId] = {
        ...mutated,
        proposedValues: {
          ...mutated.proposedValues,
          candidateRiskFlags: ["matching_rule"],
        },
      };
      await expect(hydrate(mutatedSafety)).resolves.toMatchObject({
        items: [{ freshness: { status: "stale" } }],
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("conforms across D3 ledger persistence, D5 projection, D7 commands, and D4 apply scheduling", async () => {
    const { tempDir, ledger } = await runD3CandidateIntoLedger();
    try {
      const initialSnapshot = await Effect.runPromise(ledger.getSnapshot());
      const proposal = Object.values(initialSnapshot.proposals).find(
        (record) => record.scope === "catalog" && record.proposedValues?.scope === "catalog",
      );
      if (!proposal || proposal.proposedValues?.scope !== "catalog") {
        throw new Error("expected D3 persisted catalog proposal");
      }
      const paperless = paperlessLayer();
      const serviceLayer = Layer.merge(
        Layer.succeed(OperationalLedgerService, ledger),
        paperless.layer,
      );
      const projected = await Effect.runPromise(
        listCatalogProposals(d3Epoch.epochId, { limit: 10 }).pipe(Effect.provide(serviceLayer)),
      );
      expect(projected.items[0]).toMatchObject({
        proposalId: proposal.proposalId,
        projectionVersion: "catalog_proposal_projection.v2",
        decision: { status: "undecided", outcome: null },
        apply: { status: "not_started", latestJournalId: null },
        evidence: { availability: "available" },
      });

      const { runtime, scheduled } = commandRuntime();
      const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);
      await Effect.runPromise(
        handlers
          .approveCatalogProposal(proposal.proposalId, {
            expectedProposalFingerprint: proposal.proposedValues.expectedProposalFingerprint,
            reason: "Human approved the D3 persisted proposal after D5 review.",
            idempotencyKey: "d3-d5-d7-approve-1",
          })
          .pipe(Effect.provide(Layer.succeed(OperationalLedgerService, ledger))),
      );
      const sourceProof = receiptFixture(10, "Vendor GmbH", [101, 202]);
      const targetProof = receiptFixture(20, "Vendor", [101, 202, 303]);
      const applyRequests: ApplyReviewedCatalogProposalRequest[] = [];
      const mutationLayer = Layer.succeed(CatalogApplyMutationPort, {
        readEntity: vi.fn((_kind, entityId: number) =>
          Effect.succeed({
            kind: "tag" as const,
            entityId,
            exists: true,
            name: entityId === 10 ? "Vendor GmbH" : "Vendor",
            dependencyHash: digest(`dependency-${entityId}`),
            blockedReasons: [],
          }),
        ),
        readAssignmentReceipt: vi.fn((_kind, entityId: number) =>
          Effect.succeed(entityId === 10 ? sourceProof.receipt : targetProof.receipt),
        ),
      } as unknown as typeof CatalogApplyMutationPort.Service);
      const applyLayer = Layer.succeed(CatalogApplyService, {
        applyReviewedProposal: vi.fn((request: ApplyReviewedCatalogProposalRequest) => {
          applyRequests.push(request);
          return Effect.succeed({
            status: "accepted",
            proposalId: request.proposal.proposalId,
            journal: {
              journalId: "journal_cross_service",
              proposalId: request.proposal.proposalId,
              epochId: request.proposal.ownerId,
              idempotencyKey: request.idempotencyKey,
              status: "accepted",
              preconditions: request.proposal.preconditions,
              steps: [],
              createdAt: now,
              updatedAt: now,
            },
            leaseId: null,
            sourceEntityId: request.chairDecision.sourceEntityId,
            targetEntityId: request.chairDecision.targetEntityId,
            migrationDocumentIds: [101, 202, 303],
            paperlessTasks: [],
            preApplyCatalogFingerprint: request.expectedCatalogFingerprint,
            postApplyCatalogFingerprint: null,
          });
        }),
        recoverInterruptedApplies: vi.fn(),
      } as unknown as CatalogApplyService);

      await Effect.runPromise(
        handlers
          .applyCatalogProposal(proposal.proposalId, {
            expectedProposalFingerprint: proposal.proposedValues.expectedProposalFingerprint,
            expectedEvidenceFingerprint: proposal.proposedValues.expectedEvidenceFingerprint,
            idempotencyKey: "d3-d5-d7-apply-1",
          })
          .pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(OperationalLedgerService, ledger),
                mutationLayer,
                applyLayer,
              ),
            ),
          ),
      );

      expect(scheduled).toHaveLength(1);
      const scheduledApply = scheduled[0];
      if (!scheduledApply) throw new Error("expected scheduled D4 apply");
      await Effect.runPromise(scheduledApply.effect);
      expect(applyRequests).toHaveLength(1);
      expect(applyRequests[0]).toMatchObject({
        proposal: { proposalId: proposal.proposalId },
        chairDecision: { proposalId: proposal.proposalId },
        expectedProposalFingerprint: proposal.proposedValues.expectedProposalFingerprint,
        expectedEvidenceFingerprint: proposal.proposedValues.expectedEvidenceFingerprint,
        idempotencyKey: "d3-d5-d7-apply-1",
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("fails closed when council citations are forged outside the live X/Y receipts", async () => {
    const data = catalogLedger();
    data.councilRecords.evidence_hunter = {
      ...data.councilRecords.evidence_hunter,
      evidenceDocumentIds: [999],
    };
    const ledger = ledgerLayer(data);
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: { status: "fresh" },
    });
  });

  it("fails closed when authentic reviewer evidence only covers a subset of the live union", async () => {
    const data = catalogLedger();
    data.councilRecords.evidence_hunter = {
      ...data.councilRecords.evidence_hunter,
      evidenceDocumentIds: [202],
    };
    const ledger = ledgerLayer(data);
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: { status: "fresh" },
    });
  });

  it("fails closed when chair counts do not exactly cover the live union", async () => {
    const data = catalogLedger();
    data.chairDecisions.prop_catalog_merge = {
      ...data.chairDecisions.prop_catalog_merge,
      coverageCount: 2,
      inspectedDocumentCount: 2,
      totalDocumentCount: 3,
    };
    const ledger = ledgerLayer(data);
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: { status: "fresh" },
    });
  });

  it("fails closed when the compact chair record is absent", async () => {
    const data = { ...catalogLedger(), chairDecisions: {} };
    const ledger = ledgerLayer(data);
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "chair_decision_missing",
      },
      freshness: { status: "fresh" },
    });
  });

  it("marks catalog proposals current_missing when a deleted source entity still returns an empty receipt", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer({ deletedSourceEntityWithEmptyReceipt: true });

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: {
        status: "current_missing",
        currentMissing: true,
        stale: false,
      },
    });
  });

  it("marks catalog proposals stale when a live entity was renamed", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer({ renamedSourceEntity: true });

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: {
        status: "stale",
        stale: true,
        currentMissing: false,
      },
    });
  });

  it("marks catalog proposals stale when live X/Y receipt hashes changed", async () => {
    const ledger = ledgerLayer(catalogLedger());
    const paperless = paperlessLayer({ changedReceipts: true });

    const page = await Effect.runPromise(
      listCatalogProposals("cat_epoch_main", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
      },
      freshness: {
        status: "stale",
        stale: true,
        currentMissing: false,
      },
    });
  });
});

describe("catalog current-hash (first-run precondition)", () => {
  const evidenceLayer = (observe: Effect.Effect<ReturnType<typeof canonicalSha256>, unknown>) =>
    Layer.succeed(CatalogEvidenceService, {
      observeCatalogFingerprint: () => observe,
    } as unknown as CatalogEvidenceService);

  it("returns the fresh current catalog hash for the scope, independent of any prior epoch", async () => {
    const hash = canonicalSha256({ catalog: "state-1" });
    const result = await Effect.runPromise(
      getCurrentCatalogHash(["tag"]).pipe(Effect.provide(evidenceLayer(Effect.succeed(hash)))),
    );
    expect(result).toEqual({ paperlessCatalogHash: hash, scope: ["tag"] });
  });

  it("reflects a changed-since-last-epoch catalog by returning the new hash", async () => {
    const before = canonicalSha256({ catalog: "state-1" });
    const after = canonicalSha256({ catalog: "state-2" });
    const first = await Effect.runPromise(
      getCurrentCatalogHash(["tag", "correspondent"]).pipe(
        Effect.provide(evidenceLayer(Effect.succeed(before))),
      ),
    );
    const second = await Effect.runPromise(
      getCurrentCatalogHash(["tag", "correspondent"]).pipe(
        Effect.provide(evidenceLayer(Effect.succeed(after))),
      ),
    );
    expect(first.paperlessCatalogHash).not.toEqual(second.paperlessCatalogHash);
    expect(second.paperlessCatalogHash).toEqual(after);
  });

  it("rejects an empty scope and custom_field with a validation error", async () => {
    const empty = await Effect.runPromise(
      Effect.flip(
        getCurrentCatalogHash([]).pipe(Effect.provide(evidenceLayer(Effect.succeed(canonicalSha256({}))))),
      ),
    );
    expect((empty as { _tag?: string })._tag).toBe("ValidationError");
    const custom = await Effect.runPromise(
      Effect.flip(
        getCurrentCatalogHash(["custom_field"]).pipe(
          Effect.provide(evidenceLayer(Effect.succeed(canonicalSha256({})))),
        ),
      ),
    );
    expect((custom as { _tag?: string })._tag).toBe("ValidationError");
  });

  it("surfaces a Paperless read failure as a typed 503 degradation, not an opaque 500", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        getCurrentCatalogHash(["tag"]).pipe(
          Effect.provide(evidenceLayer(Effect.fail(new Error("paperless unreachable")))),
        ),
      ),
    );
    expect(error).toBeInstanceOf(CatalogQueryError);
    expect(error).toMatchObject({ status: 503, code: "PAPERLESS_UNAVAILABLE" });
  });
});
