import {
  analysisRunTransitions,
  canonicalSha256,
  type HashPrecondition,
  type PaperlessDocumentSnapshot,
  paperlessCapabilityDescriptor,
} from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type AnalysisCommandConfig,
  type AnalysisCommandError,
  type AnalysisCommandRuntime,
  analysisCommandEndpoints,
  analysisCommandListDescriptors,
  analysisRunStateHash,
  analysisStreamRegistrationDescriptor,
  makeAnalysisCommandHandlers,
} from "../../src/api/analysis/command-handlers.js";
import type { Document } from "../../src/models/index.js";
import {
  DocumentAnalysisOrchestrator,
  type DocumentAnalysisOrchestrator as DocumentAnalysisOrchestratorShape,
} from "../../src/services/document-analysis/orchestrator.js";
import {
  OperationalLedgerConflictError,
  OperationalLedgerService,
  type OperationalLedgerServiceApi,
} from "../../src/services/OperationalLedgerService.js";
import { emptyOperationalLedger } from "../../src/services/operational-ledger/persistence.js";
import type {
  AnalysisRunRecord,
  OperationalLedgerData,
  ProposalRecord,
  RandomCycleRecord,
} from "../../src/services/operational-ledger/types.js";
import {
  PaperlessService,
  type PaperlessService as PaperlessServiceApi,
} from "../../src/services/PaperlessService.js";

const now = "2026-07-22T10:00:00.000Z";
const digest = (value: string) => canonicalSha256({ test: value });
const proposalHash = digest("proposal");

const config: AnalysisCommandConfig = {
  configuredCustomFieldIds: [1001],
  systemTagIds: [9001],
  parentTagIds: [8001],
  workflowTagIds: [7001],
  aiAnalyseTagId: 6001,
  now: () => now,
  runIdFactory: ({ purpose, documentId, requestId, cycleKey }) =>
    `ana_run_${purpose}_${documentId}_${canonicalSha256({
      requestId: requestId ?? null,
      cycleKey: cycleKey ?? null,
    }).slice(0, 12)}`,
};

const precondition = (value: string): HashPrecondition => ({
  kind: "paperless_document_state",
  digest: digest(value),
});

const documentSnapshot = (
  documentId: number,
  stateHash = digest(`doc-${documentId}`),
  tagIds: readonly number[] = [],
): PaperlessDocumentSnapshot => ({
  documentId: documentId as PaperlessDocumentSnapshot["documentId"],
  stateHash,
  sourcePdfHash: digest(`source-${documentId}`),
  modified: now,
  tagIds: [...tagIds],
  correspondentId: null,
  documentTypeId: null,
  customFieldIds: [],
});

const documentFromSnapshot = (snapshot: PaperlessDocumentSnapshot): Document => ({
  id: snapshot.documentId,
  title: `Document ${snapshot.documentId}`,
  content: null,
  correspondent: snapshot.correspondentId,
  document_type: snapshot.documentTypeId,
  tags: [...snapshot.tagIds],
  created: "2026-07-22T08:00:00.000Z",
  modified: snapshot.modified,
  added: "2026-07-22T08:00:00.000Z",
  archive_serial_number: null,
  original_file_name: `document-${snapshot.documentId}.pdf`,
  archived_file_name: null,
  custom_fields: [],
});

const snapshotFromDocument = (document: Document): PaperlessDocumentSnapshot =>
  documentSnapshot(
    document.id,
    digest(`doc-${document.id}:${document.modified}:${[...document.tags].sort().join(",")}`),
    document.tags,
  );

const runRecord = (
  runId: string,
  state: AnalysisRunRecord["state"] = "awaiting_review",
  documentId = 42,
): AnalysisRunRecord => ({
  kind: "ids_hashes_state",
  runId,
  documentId,
  forceOcr: false,
  state,
  sourcePdfHash: digest(`source-${documentId}`),
  documentStateHash: digest(`doc-${documentId}`),
  proposalIds: state === "awaiting_review" ? ["prop_review"] : [],
  retryCount: 0,
  failure: null,
  createdAt: "2026-07-22T09:00:00.000Z",
  updatedAt: "2026-07-22T09:15:00.000Z",
  completedAt: null,
});

const proposalRecord = (runId: string): ProposalRecord => ({
  kind: "undecided_analysis_proposal_values",
  scope: "analysis",
  proposalId: "prop_review",
  ownerId: runId,
  proposalHash,
  valueHash: digest("values"),
  proposedValues: {
    scope: "analysis",
    title: "Reviewed invoice",
    correspondentId: null,
    documentTypeId: null,
    ordinaryTagIds: [7],
    newTagCandidates: [],
    customFields: [],
  },
  evidenceIds: ["evidence_analysis_1"],
  coverage: 0.8,
  rationale: "Review proposal.",
  preconditions: [precondition("doc-42")],
  decision: "undecided",
  outcome: null,
  createdAt: "2026-07-22T09:16:00.000Z",
  decidedAt: null,
  compactedAt: null,
});

const analysisLedger = (run = runRecord("ana_run_review")): OperationalLedgerData => {
  const ledger = emptyOperationalLedger(now);
  return {
    ...ledger,
    analysisRuns: { [run.runId]: run },
    proposals: run.proposalIds.includes("prop_review")
      ? { prop_review: proposalRecord(run.runId) }
      : {},
  };
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ledgerLayer = (initial: OperationalLedgerData) => {
  let data = clone(initial);
  const order: string[] = [];
  const activeLeases = new Map<string, string>();
  const transitionAnalysisRunState = vi.fn((runId, expected, next) =>
    Effect.sync(() => {
      const run = data.analysisRuns[runId];
      if (!run || run.state !== expected || !analysisRunTransitions[run.state].includes(next)) {
        throw new OperationalLedgerConflictError(
          `expected ${expected}, found ${run?.state ?? "missing"}`,
          run?.state ?? "missing",
          expected,
          next,
        );
      }
      const updated = { ...run, state: next, updatedAt: now };
      data = { ...data, analysisRuns: { ...data.analysisRuns, [runId]: updated } };
      order.push(`transition:${expected}->${next}`);
      return updated;
    }),
  );
  const recordProposalDecision = vi.fn((proposalId, input) =>
    Effect.sync(() => {
      const proposal = data.proposals[proposalId];
      if (!proposal) throw new Error("proposal missing");
      if (proposal.decision !== input.expectedDecision) {
        throw new OperationalLedgerConflictError(
          `expected ${input.expectedDecision}, found ${proposal.decision}`,
          proposal.decision,
          input.expectedDecision,
          input.decision,
        );
      }
      const updated = {
        ...proposal,
        decision: input.decision,
        outcome: input.outcome ?? input.decision,
        decidedAt: input.decidedAt ?? now,
      };
      data = { ...data, proposals: { ...data.proposals, [proposalId]: updated } };
      order.push(`decision:${input.decision}`);
      return updated;
    }),
  );
  const recordRandomCycle = vi.fn((input) =>
    Effect.sync(() => {
      const previous = data.randomCycles[input.cycleKey];
      const record: RandomCycleRecord = {
        kind: "random_cycle_state",
        cycleKey: input.cycleKey,
        documentIdHashes: input.documentIds.map((documentId: number) =>
          digest(`cycle-${documentId}`),
        ),
        cursor: input.cursor,
        selectedRunIds: input.reset
          ? []
          : [
              ...(previous?.selectedRunIds ?? []),
              ...(input.selectedRunId ? [input.selectedRunId] : []),
            ],
        resetCount: (previous?.resetCount ?? 0) + (input.reset ? 1 : 0),
        updatedAt: input.updatedAt ?? now,
      };
      data = { ...data, randomCycles: { ...data.randomCycles, [input.cycleKey]: record } };
      order.push(input.reset ? "cycle:reset" : "cycle:select");
      return record;
    }),
  );
  const appendLedgerEntry = vi.fn((entry) =>
    Effect.sync(() => {
      data = { ...data, ledgerEntries: [...data.ledgerEntries, entry] };
      order.push(`append:${entry.state ?? entry.kind}`);
      return entry;
    }),
  );
  const acquireLease = vi.fn((input) =>
    Effect.sync(() => {
      const leaseId = `${input.scope}:${String(input.resourceId)}`;
      const existing = activeLeases.get(leaseId);
      const runId = input.runId ?? `lease_${input.scope}_${String(input.resourceId)}`;
      if (existing && existing !== runId) {
        return {
          acquired: false,
          staleRecovered: false,
          lease: {
            kind: "lease_record",
            leaseId,
            scope: input.scope,
            resourceId: String(input.resourceId),
            owner: input.owner,
            runId: existing,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt: now,
          },
        };
      }
      activeLeases.set(leaseId, runId);
      order.push(`lease:${leaseId}`);
      return {
        acquired: true,
        staleRecovered: false,
        lease: {
          kind: "lease_record",
          leaseId,
          scope: input.scope,
          resourceId: String(input.resourceId),
          owner: input.owner,
          runId,
          acquiredAt: now,
          heartbeatAt: now,
          expiresAt: now,
        },
      };
    }),
  );
  const releaseLease = vi.fn((leaseId, runId) =>
    Effect.sync(() => {
      if (activeLeases.get(leaseId) === runId) {
        activeLeases.delete(leaseId);
        order.push(`release:${leaseId}`);
        return true;
      }
      return false;
    }),
  );
  const service = {
    paths: { dataDir: "/tmp", file: "/tmp/operational-ledger.json" },
    getSnapshot: vi.fn(() => Effect.succeed(clone(data))),
    getSnapshotJson: vi.fn(() => Effect.succeed(JSON.stringify(data))),
    setSetting: vi.fn(() => Effect.die("unused")),
    appendLedgerEntry,
    createAnalysisRun: vi.fn(() => Effect.die("unused")),
    transitionAnalysisRunState,
    recordAnalysisFailure: vi.fn(() => Effect.die("unused")),
    createCatalogEpoch: vi.fn(() => Effect.die("unused")),
    transitionCatalogEpochState: vi.fn(() => Effect.die("unused")),
    recordProposal: vi.fn(() => Effect.die("unused")),
    recordProposalDecision,
    recordCouncilVote: vi.fn(() => Effect.die("unused")),
    recordChairDecision: vi.fn(() => Effect.die("unused")),
    recordApplyJournal: vi.fn(() => Effect.die("unused")),
    acquireLease,
    heartbeatLease: vi.fn(() => Effect.die("unused")),
    releaseLease,
    recordProviderUsage: vi.fn(() => Effect.die("unused")),
    recordRandomCycle,
    compact: vi.fn(() => Effect.die("unused")),
  } as unknown as OperationalLedgerServiceApi;
  return {
    layer: Layer.succeed(OperationalLedgerService, service),
    service,
    order,
    data: () => data,
  };
};

const paperlessLayer = (
  documents: readonly PaperlessDocumentSnapshot[] = [documentSnapshot(42)],
  capability = paperlessCapabilityDescriptor,
  options: { readonly updateFailure?: "stale" | "ambiguous" } = {},
) => {
  const documentMap = new Map<number, Document>(
    documents.map((snapshot) => [snapshot.documentId, documentFromSnapshot(snapshot)]),
  );
  const service = {
    capability: {
      descriptor: capability,
      listDocumentsPage: vi.fn(),
      getDocumentSnapshot: vi.fn(),
      getOriginalContent: vi.fn(),
      getVersionContent: vi.fn(),
      submitBulkOperation: vi.fn(),
      pollTask: vi.fn(),
      addNote: vi.fn(),
      rereadAfterMutation: vi.fn(),
    },
    getDocument: vi.fn((documentId: number) =>
      Effect.sync(() => {
        const document = documentMap.get(documentId);
        if (!document) throw new Error(`Paperless document ${documentId} not found`);
        return clone(document);
      }),
    ),
    getDocumentSnapshot: vi.fn((documentId: number) =>
      Effect.sync(() => {
        const document = documentMap.get(documentId);
        if (!document) throw new Error(`Paperless document ${documentId} not found`);
        return snapshotFromDocument(document);
      }),
    ),
    updateDocumentExact: vi.fn((documentId: number, updates, updateOptions) =>
      Effect.gen(function* () {
        const document = documentMap.get(documentId);
        if (!document) throw new Error(`Paperless document ${documentId} not found`);
        const currentSnapshot = snapshotFromDocument(document);
        const expected = updateOptions?.preconditions?.find(
          (precondition) => precondition.kind === "paperless_document_state",
        );
        if (
          options.updateFailure === "stale" ||
          (expected && expected.digest !== currentSnapshot.stateHash)
        ) {
          return yield* Effect.fail(
            new Error("Paperless precondition failed: paperless_document_state"),
          );
        }
        const updated = {
          ...document,
          tags: updates.tags ? [...updates.tags] : document.tags,
          modified: "2026-07-22T10:01:00.000Z",
        };
        documentMap.set(documentId, updated);
        if (options.updateFailure === "ambiguous") {
          return yield* Effect.fail(new Error("Paperless ambiguous write timeout"));
        }
        return clone(updated);
      }),
    ),
    listDocumentsPage: vi.fn((request) => {
      const cursor = request.cursor ? Number(request.cursor.slice("page-".length)) : 0;
      const limit = request.limit ?? 50;
      const selected = documents.slice(cursor, cursor + limit);
      const next = cursor + selected.length;
      return Effect.succeed({
        items: selected,
        page: {
          nextCursor: next < documents.length ? `page-${next}` : null,
          hasNextPage: next < documents.length,
          limit,
        },
      });
    }),
  } as unknown as PaperlessServiceApi;
  return { layer: Layer.succeed(PaperlessService, service), service, documents: documentMap };
};

const analysisLayer = () => {
  const service = {
    run: vi.fn(() =>
      Effect.succeed({
        run: runRecord("ana_run_mock"),
        proposal: proposalRecord("ana_run_mock"),
        autoApply: false,
        ocrHash: digest("ocr"),
        reusedOcrVersionId: null,
      }),
    ),
    applyApprovedProposal: vi.fn(() =>
      Effect.succeed({
        proposalId: "prop_review",
        journalId: "journal_prop_review",
        documentId: 42,
        afterHash: digest("after"),
      }),
    ),
    recoverInterruptedApplies: vi.fn(() => Effect.succeed([])),
  } as unknown as DocumentAnalysisOrchestratorShape;
  return { layer: Layer.succeed(DocumentAnalysisOrchestrator, service), service };
};

const runtime = () => {
  const order: string[] = [];
  const service: AnalysisCommandRuntime = {
    schedule: vi.fn((taskId: string) =>
      Effect.sync(() => {
        order.push(`schedule:${taskId}`);
      }),
    ),
    cancel: vi.fn((taskId: string) =>
      Effect.sync(() => {
        order.push(`cancel:${taskId}`);
        return true;
      }),
    ),
  };
  return { service, order };
};

const provide = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    OperationalLedgerServiceApi | PaperlessServiceApi | DocumentAnalysisOrchestratorShape
  >,
  layers: {
    readonly ledger?: ReturnType<typeof ledgerLayer>;
    readonly paperless?: ReturnType<typeof paperlessLayer>;
    readonly analysis?: ReturnType<typeof analysisLayer>;
  },
) => {
  const layer = Layer.mergeAll(
    layers.ledger?.layer ?? ledgerLayer(analysisLedger()).layer,
    layers.paperless?.layer ?? paperlessLayer().layer,
    layers.analysis?.layer ?? analysisLayer().layer,
  );
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
};

const expectCommandError = async (
  effect: Effect.Effect<
    unknown,
    AnalysisCommandError,
    OperationalLedgerServiceApi | PaperlessServiceApi | DocumentAnalysisOrchestratorShape
  >,
  layers: Parameters<typeof provide>[1],
  expected: Pick<AnalysisCommandError, "status" | "code">,
) => {
  const result = await provide(Effect.either(effect), layers);
  expect(result._tag).toBe("Left");
  if (result._tag === "Left") {
    expect(result.left).toMatchObject(expected);
  }
};

describe("analysis command handlers", () => {
  it("exports frozen command and stream descriptors without route registration", () => {
    expect(analysisCommandEndpoints.map((endpoint) => endpoint.path)).toEqual([
      "/api/analysis/runs",
      "/api/analysis/runs/{runId}/apply",
      "/api/analysis/runs/{runId}/reject",
      "/api/analysis/runs/{runId}/retry",
      "/api/analysis/runs/{runId}/cancel",
      "/api/analysis/runs/{runId}/force-ocr",
      "/api/analysis/random-cycle/select",
      "/api/analysis/random-cycle/reset",
    ]);
    expect(analysisCommandListDescriptors.map((endpoint) => endpoint.path)).toEqual([
      "/api/analysis/review",
      "/api/analysis/failed",
    ]);
    expect(analysisStreamRegistrationDescriptor).toMatchObject({
      method: "GET",
      path: "/api/analysis/runs/{runId}/progress",
      responseContentType: "text/event-stream",
      events: [
        "analysis.run.state",
        "analysis.proposal.bundle",
        "analysis.failure",
        "analysis.heartbeat",
      ],
    });
  });

  it("starts analysis asynchronously with strict 202 shape and request idempotency", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    const first = await provide(
      handlers.startAnalysis({ documentId: 42, requestId: "manual-1", forceOcr: true }),
      { ledger, paperless, analysis },
    );
    const second = await provide(
      handlers.startAnalysis({ documentId: 42, requestId: "manual-1", forceOcr: true }),
      { ledger, paperless, analysis },
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 202,
      state: "queued",
      progressUrl: `/api/analysis/runs/${first.runId}/progress`,
      statusUrl: `/api/analysis/runs/${first.runId}`,
    });
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledWith(
      42,
      { tags: [6001] },
      expect.objectContaining({
        preconditions: [expect.objectContaining({ kind: "paperless_document_state" })],
      }),
    );
    const updateOptions = paperless.service.updateDocumentExact.mock.calls[0]?.[2] as
      | { readonly preserveTagIds?: ReadonlySet<number> }
      | undefined;
    expect([...(updateOptions?.preserveTagIds ?? [])].sort((left, right) => left - right)).toEqual([
      6001, 7001, 8001, 9001,
    ]);
    expect(paperless.service.getDocument).toHaveBeenCalledTimes(2);
    expect(ledger.order).toEqual([
      "lease:document:42",
      "release:document:42",
      "append:accepted:start",
    ]);
    expect(analysis.service.run).toHaveBeenCalledTimes(1);
    expect(analysis.service.run).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 42,
        forceOcr: true,
        configuredCustomFieldIds: [1001],
        systemTagIds: [9001],
        workflowTagIds: [7001],
        aiAnalyseTagId: 6001,
        parentTagIds: [8001],
        mode: "review",
      }),
    );
    expect(commandRuntime.service.schedule).toHaveBeenCalledTimes(1);
    expect(commandRuntime.order[0]).toBe(`schedule:analysis:start:${first.runId}`);

    await expectCommandError(
      handlers.startAnalysis({ documentId: 42, requestId: "manual-2", extra: true }),
      {
        ledger,
        paperless,
        analysis,
      },
      { status: 502, code: "PROVIDER_MALFORMED" },
    );
  });

  it("rejects missing, null, empty, and duplicate command body semantics before side effects", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer();
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    for (const body of [
      {},
      { documentId: null, requestId: "null-doc" },
      { documentId: 42, forceOcr: null, requestId: "null-force" },
    ]) {
      await expectCommandError(
        handlers.startAnalysis(body),
        { ledger, paperless, analysis },
        {
          status: 502,
          code: "PROVIDER_MALFORMED",
        },
      );
    }
    await expectCommandError(
      handlers.selectRandomCycle({ cycleKey: "", forceOcr: false }),
      { ledger, paperless, analysis },
      { status: 502, code: "PROVIDER_MALFORMED" },
    );
    await expectCommandError(
      handlers.selectRandomCycle({ cycleKey: "workbench", excludeDocumentIds: [42, 42] }),
      { ledger, paperless, analysis },
      { status: 502, code: "PROVIDER_MALFORMED" },
    );
    await expectCommandError(
      handlers.resetRandomCycle({ cycleKey: "workbench", idempotencyKey: "short" }),
      { ledger, paperless, analysis },
      { status: 502, code: "PROVIDER_MALFORMED" },
    );

    expect(paperless.service.updateDocumentExact).not.toHaveBeenCalled();
    expect(ledger.service.recordRandomCycle).not.toHaveBeenCalled();
    expect(commandRuntime.service.schedule).not.toHaveBeenCalled();
  });

  it("applies a whole-bundle proposal through CAS before scheduling background apply", async () => {
    const ledger = ledgerLayer(analysisLedger(runRecord("ana_run_review")));
    const paperless = paperlessLayer();
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    const response = await provide(
      handlers.applyAnalysisRun("ana_run_review", {
        expectedProposalHash: proposalHash,
        idempotencyKey: "apply-key-1",
      }),
      { ledger, paperless, analysis },
    );

    expect(response).toMatchObject({
      status: 202,
      runId: "ana_run_review",
      proposalId: "prop_review",
      action: "apply",
    });
    expect(ledger.order).toEqual([
      "decision:approved",
      "transition:awaiting_review->approved",
      "append:accepted:apply",
    ]);
    expect(commandRuntime.order[0]).toBe("schedule:analysis:apply:prop_review");
    expect(analysis.service.applyApprovedProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "prop_review",
        expectedProposalHash: proposalHash,
        configuredCustomFieldIds: [1001],
        systemTagIds: [9001],
        parentTagIds: [8001],
        aiAnalyseTagId: 6001,
      }),
    );

    const staleLedger = ledgerLayer(analysisLedger(runRecord("ana_run_review")));
    const staleHandlers = makeAnalysisCommandHandlers(config, runtime().service);
    await expectCommandError(
      staleHandlers.applyAnalysisRun("ana_run_review", {
        expectedProposalHash: digest("wrong-proposal"),
        idempotencyKey: "apply-key-2",
      }),
      { ledger: staleLedger, paperless, analysis },
      { status: 409, code: "STALE_PRECONDITION" },
    );
    expect(staleLedger.service.transitionAnalysisRunState).not.toHaveBeenCalled();
  });

  it("rejects proposals synchronously with the frozen accepted action response", async () => {
    const ledger = ledgerLayer(analysisLedger(runRecord("ana_run_review")));
    const handlers = makeAnalysisCommandHandlers(config, runtime().service);

    const response = await provide(
      handlers.rejectAnalysisRun("ana_run_review", {
        expectedProposalHash: proposalHash,
        reason: "not a real bundle",
        idempotencyKey: "reject-key-1",
      }),
      { ledger },
    );

    expect(response).toMatchObject({
      status: 202,
      runId: "ana_run_review",
      proposalId: "prop_review",
      action: "reject",
    });
    expect(ledger.order).toEqual([
      "decision:rejected",
      "transition:awaiting_review->rejected",
      "append:accepted:reject",
    ]);
    expect(ledger.data().proposals.prop_review?.decision).toBe("rejected");
  });

  it("rejects illegal analysis state transitions without proposal decisions or schedules", async () => {
    const analyzingRun = runRecord("ana_run_analyzing", "analyzing");
    const ledger = ledgerLayer(analysisLedger(analyzingRun));
    const paperless = paperlessLayer();
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    await expectCommandError(
      handlers.applyAnalysisRun("ana_run_analyzing", {
        expectedProposalHash: proposalHash,
        idempotencyKey: "apply-illegal-1",
      }),
      { ledger, paperless, analysis },
      { status: 409, code: "STATE_TRANSITION_CONFLICT" },
    );
    await expectCommandError(
      handlers.forceOcrAnalysisRun("ana_run_analyzing", {
        expectedRunStateHash: analysisRunStateHash(analyzingRun),
        idempotencyKey: "force-illegal-1",
      }),
      { ledger, paperless, analysis },
      { status: 409, code: "STATE_TRANSITION_CONFLICT" },
    );

    expect(ledger.service.recordProposalDecision).not.toHaveBeenCalled();
    expect(paperless.service.updateDocumentExact).not.toHaveBeenCalled();
    expect(commandRuntime.service.schedule).not.toHaveBeenCalled();
    expect(analysis.service.run).not.toHaveBeenCalled();
  });

  it("enforces run-state hashes for retry, force OCR, and cancel commands", async () => {
    const retryRun = runRecord("ana_run_review");
    const retryLedger = ledgerLayer(analysisLedger(retryRun));
    const retryAnalysis = analysisLayer();
    const retryRuntime = runtime();
    const retryHandlers = makeAnalysisCommandHandlers(config, retryRuntime.service);

    const retryResponse = await provide(
      retryHandlers.retryAnalysisRun("ana_run_review", {
        expectedRunStateHash: analysisRunStateHash(retryRun),
        idempotencyKey: "retry-key-1",
      }),
      { ledger: retryLedger, analysis: retryAnalysis },
    );

    expect(retryResponse).toMatchObject({ status: 202, action: "retry" });
    expect(retryLedger.order).toEqual([
      "lease:document:42",
      "release:document:42",
      "transition:awaiting_review->retrying",
      "append:accepted:retry",
    ]);
    expect(retryAnalysis.service.run).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "ana_run_review", documentId: 42, forceOcr: false }),
    );

    const forceRun = runRecord("ana_run_review");
    const forceLedger = ledgerLayer(analysisLedger(forceRun));
    const forceAnalysis = analysisLayer();
    const forceHandlers = makeAnalysisCommandHandlers(config, runtime().service);
    const forceResponse = await provide(
      forceHandlers.forceOcrAnalysisRun("ana_run_review", {
        expectedRunStateHash: analysisRunStateHash(forceRun),
        idempotencyKey: "force-key-1",
      }),
      { ledger: forceLedger, analysis: forceAnalysis },
    );

    expect(forceResponse).toMatchObject({ status: 202, action: "force_ocr" });
    expect(forceLedger.order).toEqual([
      "lease:document:42",
      "release:document:42",
      "transition:awaiting_review->retrying",
      "append:accepted:force_ocr",
    ]);
    expect(forceAnalysis.service.run).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "ana_run_review", documentId: 42, forceOcr: true }),
    );

    const cancelRun = runRecord("ana_run_cancel", "analyzing");
    const cancelLedger = ledgerLayer(analysisLedger(cancelRun));
    const cancelRuntime = runtime();
    const cancelHandlers = makeAnalysisCommandHandlers(config, cancelRuntime.service);
    const cancelResponse = await provide(
      cancelHandlers.cancelAnalysisRun("ana_run_cancel", {
        expectedRunStateHash: analysisRunStateHash(cancelRun),
        idempotencyKey: "cancel-key-1",
      }),
      { ledger: cancelLedger },
    );

    expect(cancelResponse).toMatchObject({ status: 202, action: "cancel" });
    expect(cancelLedger.order).toEqual([
      "transition:analyzing->canceled",
      "append:accepted:cancel",
    ]);
    expect(cancelRuntime.order).toEqual(["cancel:analysis:run:ana_run_cancel"]);

    await expectCommandError(
      cancelHandlers.cancelAnalysisRun("ana_run_cancel", {
        expectedRunStateHash: digest("wrong-run-state"),
        idempotencyKey: "cancel-key-2",
      }),
      { ledger: cancelLedger },
      { status: 409, code: "STALE_PRECONDITION" },
    );
  });

  it("fully paginates random-cycle selection and resets without scheduling a run", async () => {
    const documents = Array.from({ length: 260 }, (_, index) => documentSnapshot(index + 1));
    const ledger = ledgerLayer(emptyOperationalLedger(now));
    const paperless = paperlessLayer(documents);
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    const selected = await provide(
      handlers.selectRandomCycle({
        cycleKey: "workbench",
        excludeDocumentIds: [1],
        forceOcr: true,
      }),
      { ledger, paperless, analysis },
    );

    expect(selected).toMatchObject({
      status: 202,
      cycleKey: "workbench",
      documentId: 2,
    });
    expect(paperless.service.listDocumentsPage).toHaveBeenCalledTimes(2);
    expect(paperless.service.listDocumentsPage).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 250,
    });
    expect(ledger.service.recordRandomCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleKey: "workbench",
        cursor: 1,
        documentIds: expect.arrayContaining([2, 260]),
      }),
    );
    expect(analysis.service.run).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 2, forceOcr: true, mode: "review" }),
    );
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledWith(
      2,
      { tags: [6001] },
      expect.anything(),
    );

    const selectedAgain = await provide(
      handlers.selectRandomCycle({
        cycleKey: "workbench",
        excludeDocumentIds: [1],
        forceOcr: true,
      }),
      { ledger, paperless, analysis },
    );

    expect(selectedAgain).toMatchObject({
      status: 202,
      cycleKey: "workbench",
      documentId: 3,
    });
    expect(selectedAgain.runId).not.toBe(selected.runId);
    expect(analysis.service.run).toHaveBeenCalledTimes(2);

    const beforeResetSchedules = commandRuntime.order.length;
    const reset = await provide(
      handlers.resetRandomCycle({ cycleKey: "workbench", idempotencyKey: "reset-key-1" }),
      { ledger, paperless, analysis },
    );

    expect(reset).toMatchObject({ status: 202, action: "cancel" });
    expect(ledger.service.recordRandomCycle).toHaveBeenLastCalledWith(
      expect.objectContaining({ cycleKey: "workbench", cursor: 0, reset: true }),
    );
    expect(commandRuntime.order).toHaveLength(beforeResetSchedules);
  });

  it("does not rewrite Paperless when the live document is already tagged", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer([documentSnapshot(42, digest("already-tagged"), [6001, 77])]);
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    await provide(handlers.startAnalysis({ documentId: 42, requestId: "already-tagged" }), {
      ledger,
      paperless,
      analysis,
    });

    expect(paperless.service.updateDocumentExact).not.toHaveBeenCalled();
    expect(commandRuntime.service.schedule).toHaveBeenCalledTimes(1);
    expect(analysis.service.run).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and does not schedule when the trigger tag add precondition is stale", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer([documentSnapshot(42)], paperlessCapabilityDescriptor, {
      updateFailure: "stale",
    });
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    await expectCommandError(
      handlers.startAnalysis({ documentId: 42, requestId: "stale-add" }),
      { ledger, paperless, analysis },
      { status: 409, code: "STALE_PRECONDITION" },
    );

    expect(paperless.service.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(commandRuntime.service.schedule).not.toHaveBeenCalled();
    expect(analysis.service.run).not.toHaveBeenCalled();
  });

  it("accepts an ambiguous tag add only after reread verifies ai-analyse", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer([documentSnapshot(42)], paperlessCapabilityDescriptor, {
      updateFailure: "ambiguous",
    });
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    const response = await provide(
      handlers.startAnalysis({ documentId: 42, requestId: "ambiguous-add" }),
      { ledger, paperless, analysis },
    );

    expect(response).toMatchObject({ status: 202 });
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(commandRuntime.service.schedule).toHaveBeenCalledTimes(1);
    expect(analysis.service.run).toHaveBeenCalledTimes(1);
  });

  it("uses ledger command markers for restart idempotency instead of process memory", async () => {
    const ledger = ledgerLayer(analysisLedger());
    const paperless = paperlessLayer([documentSnapshot(42)]);
    const firstAnalysis = analysisLayer();
    const firstRuntime = runtime();
    const firstHandlers = makeAnalysisCommandHandlers(config, firstRuntime.service);

    const first = await provide(
      firstHandlers.startAnalysis({ documentId: 42, requestId: "restart-idempotent" }),
      { ledger, paperless, analysis: firstAnalysis },
    );
    const secondAnalysis = analysisLayer();
    const secondRuntime = runtime();
    const secondHandlers = makeAnalysisCommandHandlers(config, secondRuntime.service);
    const second = await provide(
      secondHandlers.startAnalysis({ documentId: 42, requestId: "restart-idempotent" }),
      { ledger, paperless, analysis: secondAnalysis },
    );

    expect(second).toEqual(first);
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(firstRuntime.service.schedule).toHaveBeenCalledTimes(1);
    expect(secondRuntime.service.schedule).not.toHaveBeenCalled();
    expect(secondAnalysis.service.run).not.toHaveBeenCalled();
  });

  it("retries failed runs by creating a deterministic new triggered run", async () => {
    const failedRun: AnalysisRunRecord = {
      ...runRecord("ana_run_failed", "failed"),
      proposalIds: [],
      failure: {
        kind: "sanitized_failure",
        code: "PROVIDER_FAILURE",
        message: "provider failed",
        failedAt: now,
        retryable: true,
      },
      completedAt: now,
    };
    const ledger = ledgerLayer(analysisLedger(failedRun));
    const paperless = paperlessLayer([documentSnapshot(42)]);
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    const response = await provide(
      handlers.retryAnalysisRun("ana_run_failed", {
        expectedRunStateHash: analysisRunStateHash(failedRun),
        idempotencyKey: "failed-retry-1",
      }),
      { ledger, paperless, analysis },
    );

    expect(response).toMatchObject({ status: 202, action: "retry" });
    expect(response.runId).not.toBe("ana_run_failed");
    expect(ledger.service.transitionAnalysisRunState).not.toHaveBeenCalled();
    expect(paperless.service.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(analysis.service.run).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: response.runId,
        documentId: 42,
        forceOcr: false,
      }),
    );
    expect(commandRuntime.order).toEqual([`schedule:analysis:retry:${response.runId}`]);
  });

  it("cancels the recorded apply task key instead of the run id", async () => {
    const ledger = ledgerLayer(analysisLedger(runRecord("ana_run_review")));
    const analysis = analysisLayer();
    const commandRuntime = runtime();
    const handlers = makeAnalysisCommandHandlers(config, commandRuntime.service);

    await provide(
      handlers.applyAnalysisRun("ana_run_review", {
        expectedProposalHash: proposalHash,
        idempotencyKey: "apply-cancel-1",
      }),
      { ledger, analysis },
    );
    const approvedRun = ledger.data().analysisRuns.ana_run_review as AnalysisRunRecord;
    await provide(
      handlers.cancelAnalysisRun("ana_run_review", {
        expectedRunStateHash: analysisRunStateHash(approvedRun),
        idempotencyKey: "cancel-apply-1",
      }),
      { ledger, analysis },
    );

    expect(commandRuntime.order).toEqual([
      "schedule:analysis:apply:prop_review",
      "cancel:analysis:apply:prop_review",
    ]);
  });

  it("maps unavailable Paperless command capabilities to 503 before provider work", async () => {
    const badCapability = {
      ...paperlessCapabilityDescriptor,
      supportsFullPagination: false,
    } as typeof paperlessCapabilityDescriptor;
    const paperless = paperlessLayer([documentSnapshot(42)], badCapability);
    const analysis = analysisLayer();
    const handlers = makeAnalysisCommandHandlers(config, runtime().service);

    await expectCommandError(
      handlers.startAnalysis({ documentId: 42, requestId: "manual-capability" }),
      {
        paperless,
        analysis,
      },
      { status: 503, code: "CAPABILITY_UNAVAILABLE" },
    );
    expect(analysis.service.run).not.toHaveBeenCalled();
  });
});
