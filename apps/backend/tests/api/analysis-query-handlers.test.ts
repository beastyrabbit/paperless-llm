import {
  type AnalysisAvailableProposal,
  canonicalSha256,
  type HashPrecondition,
  type PaperlessDocumentSnapshot,
} from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAnalysisRun,
  getRandomCycleWorkbench,
  listAnalysisFailures,
  listAnalysisProposals,
  listAnalysisReviewQueue,
  listAnalysisRuns,
  randomCycleCommandEndpoints,
  randomCycleGetEndpoints,
} from "../../src/api/analysis/query-handlers.js";
import {
  clearAnalysisProposalEvidence,
  rememberAnalysisProposalEvidence,
} from "../../src/services/document-analysis/evidence-store.js";
import {
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
  kind: "paperless_document_state",
  digest: digest(value),
});

const documentSnapshot = (
  documentId: number,
  stateHash = digest(`live-${documentId}`),
): PaperlessDocumentSnapshot => ({
  documentId: documentId as PaperlessDocumentSnapshot["documentId"],
  stateHash,
  sourcePdfHash: digest(`source-${documentId}`),
  modified: now,
  tagIds: [],
  correspondentId: null,
  documentTypeId: null,
  customFieldIds: [],
});

const analysisLedger = (): OperationalLedgerData => {
  const ledger = emptyOperationalLedger(now);
  return {
    ...ledger,
    analysisRuns: {
      ana_run_review: {
        kind: "ids_hashes_state",
        runId: "ana_run_review",
        documentId: 42,
        forceOcr: false,
        state: "awaiting_review",
        sourcePdfHash: digest("stale-source"),
        documentStateHash: digest("stale-doc-42"),
        proposalIds: ["prop_review"],
        retryCount: 0,
        failure: null,
        createdAt: "2026-07-22T09:00:00.000Z",
        updatedAt: "2026-07-22T09:10:00.000Z",
        completedAt: null,
      },
      ana_run_failed: {
        kind: "ids_hashes_state",
        runId: "ana_run_failed",
        documentId: 99,
        forceOcr: true,
        state: "failed",
        sourcePdfHash: null,
        documentStateHash: digest("doc-99"),
        proposalIds: [],
        retryCount: 2,
        failure: null,
        createdAt: "2026-07-22T08:00:00.000Z",
        updatedAt: "2026-07-22T08:10:00.000Z",
        completedAt: "2026-07-22T08:10:00.000Z",
      },
    },
    proposals: {
      prop_review: {
        kind: "undecided_analysis_proposal_values",
        scope: "analysis",
        proposalId: "prop_review",
        ownerId: "ana_run_review",
        proposalHash: digest("proposal"),
        valueHash: digest("values"),
        proposedValues: {
          scope: "analysis",
          title: "Live hydrated invoice",
          correspondentId: null,
          documentTypeId: null,
          ordinaryTagIds: [7],
          newTagCandidates: [],
          customFields: [],
        },
        evidenceIds: ["evidence_analysis_1"],
        coverage: 0.75,
        rationale: "Review compact proposed values.",
        preconditions: [precondition("stale-doc-42")],
        decision: "undecided",
        outcome: null,
        createdAt: "2026-07-22T09:12:00.000Z",
        decidedAt: null,
        compactedAt: null,
      },
    },
    randomCycles: {
      workbench: {
        kind: "random_cycle_state",
        cycleKey: "workbench",
        documentIdHashes: [digest("doc-42")],
        cursor: 1,
        selectedRunIds: ["ana_run_review"],
        resetCount: 0,
        updatedAt: "2026-07-22T09:15:00.000Z",
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

const paperlessLayer = () => {
  const writes = {
    updateDocument: vi.fn(() => Effect.die("paperless write")),
    updateDocumentExact: vi.fn(() => Effect.die("paperless write")),
    replaceDocumentMetadataExact: vi.fn(() => Effect.die("paperless write")),
    submitBulkOperation: vi.fn(() => Effect.die("paperless write")),
    addNote: vi.fn(() => Effect.die("paperless write")),
    rereadAfterMutation: vi.fn(() => Effect.die("paperless write")),
  };
  const service = {
    getDocumentSnapshot: vi.fn((documentId: number) =>
      Effect.succeed(documentSnapshot(documentId)),
    ),
    listDocumentsPage: vi.fn((request) =>
      Effect.succeed({
        items: [documentSnapshot(42)],
        page: { nextCursor: null, hasNextPage: false, limit: request.limit ?? 50 },
      }),
    ),
    getTags: vi.fn(() => Effect.succeed([{ id: 7, name: "Steuer" }])),
    getCorrespondents: vi.fn(() => Effect.succeed([])),
    getDocumentTypes: vi.fn(() => Effect.succeed([])),
    ...writes,
  } as unknown as PaperlessServiceApi;
  return { layer: Layer.succeed(PaperlessService, service), writes };
};

describe("analysis query handlers", () => {
  afterEach(() => clearAnalysisProposalEvidence());

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

  it("hydrates analysis run hashes from live Paperless snapshots with strict pagination", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const layer = Layer.merge(ledger.layer, paperless.layer);

    const page = await Effect.runPromise(
      listAnalysisRuns({ limit: 1 }).pipe(Effect.provide(layer)),
    );

    expect(page.items).toHaveLength(1);
    expect(page.page).toMatchObject({ hasNextPage: true, limit: 1 });
    expect(page.items[0]?.documentStateHash).toBe(digest("live-42"));
    expect(page.items[0]?.sourcePdfHash).toBe(digest("source-42"));
    expectNoMutations(ledger, paperless);
  });

  it("rejects invalid or unknown analysis GET query parameters before widening reads", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const layer = Layer.merge(ledger.layer, paperless.layer);

    await expect(
      Effect.runPromise(
        Effect.either(listAnalysisRuns({ state: "bogus" })).pipe(Effect.provide(layer)),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    await expect(
      Effect.runPromise(
        Effect.either(listAnalysisRuns({ documentId: null as unknown as number })).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    await expect(
      Effect.runPromise(
        Effect.either(listAnalysisProposals("ana_run_review", { forged: true } as never)).pipe(
          Effect.provide(layer),
        ),
      ),
    ).resolves.toMatchObject({ _tag: "Left" });
    expectNoMutations(ledger, paperless);
  });

  it("keeps every analysis GET projection side-effect-free", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const layer = Layer.merge(ledger.layer, paperless.layer);

    await Effect.runPromise(listAnalysisRuns({ limit: 10 }).pipe(Effect.provide(layer)));
    await Effect.runPromise(getAnalysisRun("ana_run_review").pipe(Effect.provide(layer)));
    await Effect.runPromise(
      listAnalysisProposals("ana_run_review", { limit: 10 }).pipe(Effect.provide(layer)),
    );
    await Effect.runPromise(listAnalysisReviewQueue({ limit: 10 }).pipe(Effect.provide(layer)));
    await Effect.runPromise(listAnalysisFailures({ limit: 10 }).pipe(Effect.provide(layer)));
    await Effect.runPromise(
      getRandomCycleWorkbench("workbench", { limit: 5 }).pipe(Effect.provide(layer)),
    );

    expectNoMutations(ledger, paperless);
  });

  it("returns expired analysis evidence after restart without provider-only projections", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listAnalysisProposals("ana_run_review", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      proposalId: "prop_review",
      evidenceAvailability: "evidence_expired",
      evidence: {
        availability: "evidence_expired",
        reason: "process_restarted",
        refreshAction: "retry",
      },
      freshness: {
        status: "stale",
        stale: true,
        currentMissing: false,
        expectedPreconditions: [precondition("stale-doc-42")],
        currentPreconditions: [{ kind: "paperless_document_state", digest: digest("live-42") }],
      },
      entityLabels: {
        tags: [{ id: 7, name: "Steuer" }],
        correspondents: [],
        documentTypes: [],
      },
      review: {
        required: true,
        reasons: ["evidence_expired"],
      },
    });
    expect(page.items[0]).not.toHaveProperty("ocrPreview");
    expect(page.items[0]).not.toHaveProperty("fieldEvidence");
    expect(page.items[0]).not.toHaveProperty("confidence");
    expectNoMutations(ledger, paperless);
  });

  it("returns available evidence produced by the current backend process", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const stored = analysisLedger().proposals.prop_review;
    const evidence: AnalysisAvailableProposal = {
      proposalId: "prop_review",
      runId: "ana_run_review",
      documentId: 42,
      proposalHash: stored.proposalHash,
      proposed: {
        title: "Live hydrated invoice",
        correspondentId: null,
        documentTypeId: null,
        ordinaryTagIds: [7],
        newTagCandidates: [],
        customFields: [],
      },
      ocrPreview: {
        descriptor: "One-page OCR preview",
        previewHash: digest("preview"),
        pageCount: 1,
        blockCount: 1,
      },
      fieldEvidence: [
        {
          field: "title",
          customFieldId: null,
          references: [
            {
              pageNumber: 1,
              blockId: "page-1-title",
              quoteHash: digest("title-quote"),
            },
          ],
          rationale: "The title is visible in the document heading.",
          confidence: 0.93,
        },
      ],
      confidence: 0.9,
      review: {
        required: true,
        reasons: ["unusual_metadata"],
        rationale: "Confirm the proposed title.",
      },
      rationale: "Current-process evidence remains available for review.",
      preconditions: stored.preconditions,
      createdAt: stored.createdAt,
    };
    rememberAnalysisProposalEvidence(evidence);

    const page = await Effect.runPromise(
      listAnalysisProposals("ana_run_review", { limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items[0]).toMatchObject({
      proposalId: "prop_review",
      evidenceAvailability: "available",
      ocrPreview: evidence.ocrPreview,
      fieldEvidence: evidence.fieldEvidence,
      confidence: 0.9,
      freshness: { status: "stale", stale: true },
      entityLabels: {
        tags: [{ id: 7, name: "Steuer" }],
        correspondents: [],
        documentTypes: [],
      },
    });
    expect(page.items[0]).not.toHaveProperty("evidence");
    expectNoMutations(ledger, paperless);
  });

  it("lists stale review queue items without synthesizing stale review reasons", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();

    const page = await Effect.runPromise(
      listAnalysisReviewQueue({ limit: 10 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(page.items).toEqual([
      expect.objectContaining({
        runId: "ana_run_review",
        proposalId: "prop_review",
        documentId: 42,
        reasons: ["evidence_expired"],
      }),
    ]);
    expectNoMutations(ledger, paperless);
  });

  it("keeps random cycle select/reset as POST commands and reads workbench state side-effect-free", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();

    const result = await Effect.runPromise(
      getRandomCycleWorkbench("workbench", { limit: 5 }).pipe(
        Effect.provide(Layer.merge(ledger.layer, paperless.layer)),
      ),
    );

    expect(randomCycleGetEndpoints).toEqual([]);
    expect(randomCycleCommandEndpoints.map((endpoint) => endpoint.method)).toEqual([
      "POST",
      "POST",
    ]);
    expect(result).toMatchObject({
      cycleKey: "workbench",
      cursor: 1,
      selectedRunIds: ["ana_run_review"],
      currentDocuments: { items: [expect.objectContaining({ documentId: 42 })] },
    });
    expect(ledger.mutations.recordRandomCycle).not.toHaveBeenCalled();
    expectNoMutations(ledger, paperless);
  });
});
