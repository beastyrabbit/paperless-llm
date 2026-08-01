import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type PaperlessDocumentSnapshot, type Sha256Digest, sha256Hex } from "@repo/api-contracts";
import { Duration, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Document } from "../../../src/models/index.js";
import {
  type AiAnalyseAutomationScannerOptions,
  makeAiAnalyseAutomationScanner,
} from "../../../src/services/document-analysis/ai-analyse-automation-scanner.js";
import {
  DocumentAnalysisOrchestrator,
  type DocumentAnalysisOrchestrator as DocumentAnalysisOrchestratorShape,
  type DocumentAnalysisRunRequest,
} from "../../../src/services/document-analysis/orchestrator.js";
import {
  makeOperationalLedgerService,
  OperationalLedgerService,
} from "../../../src/services/OperationalLedgerService.js";
import {
  PaperlessService,
  type PaperlessService as PaperlessServiceShape,
} from "../../../src/services/PaperlessService.js";

const digest = (value: string): Sha256Digest => sha256Hex(value);
const iso = "2026-07-22T10:00:00.000Z";
const aiAnalyseTagId = 100;
const workflowTagId = 200;
const ordinaryTagId = 7;

const scannerOptions = (
  _dir: string,
  overrides: Partial<AiAnalyseAutomationScannerOptions> = {},
): AiAnalyseAutomationScannerOptions => ({
  enabled: true,
  aiAnalyseTagId,
  configuredCustomFieldIds: [10, 11],
  systemTagIds: [99],
  parentTagIds: [300],
  workflowTagIds: [workflowTagId],
  transientTagIds: [workflowTagId],
  leaseTtlMs: 60_000,
  ...overrides,
});

const snapshot = (
  documentId: number,
  tags: readonly number[] = [aiAnalyseTagId],
  stateHash: Sha256Digest = digest(`state-${documentId}`),
  modified = iso,
): PaperlessDocumentSnapshot => ({
  documentId,
  stateHash,
  sourcePdfHash: null,
  modified,
  tagIds: [...tags],
  correspondentId: null,
  documentTypeId: null,
  customFieldIds: [],
});

const document = (id: number, tags: readonly number[] = [aiAnalyseTagId]): Document => ({
  id,
  title: `Document ${id}`,
  content: null,
  correspondent: null,
  correspondent_name: null,
  document_type: null,
  document_type_name: null,
  tags: [...tags],
  created: iso,
  modified: iso,
  added: iso,
  archive_serial_number: null,
  original_file_name: `${id}.pdf`,
  archived_file_name: null,
  custom_fields: [],
});

const runOutcome = (request: DocumentAnalysisRunRequest, state: "succeeded" | "awaiting_review") =>
  ({
    run: {
      kind: "ids_hashes_state",
      runId: request.runId ?? `run-${request.documentId}`,
      documentId: request.documentId,
      forceOcr: false,
      state,
      sourcePdfHash: digest(`source-${request.documentId}`),
      documentStateHash: digest(`state-${request.documentId}`),
      proposalIds: [],
      retryCount: 0,
      failure: null,
      createdAt: iso,
      updatedAt: iso,
      completedAt: state === "succeeded" ? iso : null,
    },
    proposal: {
      proposalId: `proposal-${request.documentId}`,
      ownerId: request.runId ?? `run-${request.documentId}`,
      scope: "analysis",
      decision: "applied",
    },
    autoApply: state === "succeeded",
    ocrHash: digest(`ocr-${request.documentId}`),
    reusedOcrVersionId: null,
  }) as never;

const createPaperless = (
  pages: readonly PaperlessDocumentSnapshot[][],
  options: {
    readonly documents?: Record<number, Document>;
    readonly pdfs?: Record<number, Uint8Array>;
    readonly snapshots?: Record<number, PaperlessDocumentSnapshot>;
  } = {},
) => {
  const documents = new Map<number, Document>();
  const snapshots = new Map<number, PaperlessDocumentSnapshot>();
  for (const page of pages) {
    for (const item of page) {
      documents.set(
        item.documentId,
        options.documents?.[item.documentId] ?? document(item.documentId, item.tagIds),
      );
      snapshots.set(item.documentId, options.snapshots?.[item.documentId] ?? item);
    }
  }
  const service = {
    listDocumentsPage: vi.fn(() => Effect.fail(new Error("global document scan is forbidden"))),
    readTagAssignmentReceipt: vi.fn((tagId: number) => {
      const docs = pages.flat().filter((item) => item.tagIds.includes(tagId));
      return Effect.succeed({
        kind: "tag" as const,
        entityId: tagId,
        filterDescriptor: { path: "/documents/" as const, params: { tags__id: tagId } },
        expectedApiCount: docs.length,
        fetchedCount: docs.length,
        pageCount: pages.length,
        documentIds: docs.map((item) => item.documentId),
        documents: docs.map((item) => ({
          documentId: item.documentId,
          modified: item.modified,
          stateHash: item.stateHash,
          verifiedMembership: true as const,
        })),
        capturedAt: iso,
        assignmentHash: digest(`assignment-${tagId}-${docs.length}-${pages.length}`),
        complete: true as const,
      });
    }),
    getDocument: vi.fn((id: number) => Effect.succeed(documents.get(id) ?? document(id, []))),
    getDocumentSnapshot: vi.fn((id: number) =>
      Effect.succeed(snapshots.get(id) ?? snapshot(id, documents.get(id)?.tags ?? [])),
    ),
    selectOriginalPdfVersion: vi.fn(() => Effect.succeed(null)),
    downloadVersionPdf: vi.fn((id: number) =>
      Effect.succeed(options.pdfs?.[id] ?? Buffer.from(`pdf-${id}`)),
    ),
    downloadPdf: vi.fn((id: number) =>
      Effect.succeed(options.pdfs?.[id] ?? Buffer.from(`pdf-${id}`)),
    ),
    setDocumentTags: (id: number, tags: readonly number[]) => {
      const current = documents.get(id) ?? document(id, []);
      documents.set(id, { ...current, tags: [...tags] });
      const currentSnapshot = snapshots.get(id) ?? snapshot(id, []);
      snapshots.set(id, {
        ...currentSnapshot,
        stateHash: digest(`state-${id}-${tags.join("-")}`),
        tagIds: [...tags],
      });
    },
    setSnapshot: (id: number, next: PaperlessDocumentSnapshot) => {
      snapshots.set(id, next);
    },
  };
  return service as unknown as PaperlessServiceShape & {
    setDocumentTags: (id: number, tags: readonly number[]) => void;
    setSnapshot: (id: number, next: PaperlessDocumentSnapshot) => void;
  };
};

const createDocumentAnalysis = (
  implementation: (request: DocumentAnalysisRunRequest) => Effect.Effect<unknown, unknown>,
) =>
  ({
    run: vi.fn(implementation),
    applyApprovedProposal: vi.fn(),
    recoverInterruptedApplies: vi.fn(() => Effect.succeed([])),
  }) as unknown as DocumentAnalysisOrchestratorShape & {
    run: ReturnType<typeof vi.fn>;
    recoverInterruptedApplies: ReturnType<typeof vi.fn>;
  };

const createScanner = async (
  dir: string,
  paperless: PaperlessServiceShape,
  documentAnalysis: DocumentAnalysisOrchestratorShape,
  options: Partial<AiAnalyseAutomationScannerOptions> = {},
) => {
  const ledger = await Effect.runPromise(
    makeOperationalLedgerService({ dataDir: dir, file: path.join(dir, "operational-ledger.json") }),
  );
  const scanner = await Effect.runPromise(
    makeAiAnalyseAutomationScanner(scannerOptions(dir, options)).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PaperlessService, paperless),
          Layer.succeed(OperationalLedgerService, ledger),
          Layer.succeed(DocumentAnalysisOrchestrator, documentAnalysis),
        ),
      ),
    ),
  );
  return { scanner, ledger };
};

describe("AiAnalyseAutomationScanner", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  const withTemp = () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "ai-analyse-scanner-"));
    return tempDir;
  };

  it("does nothing when scanner automation is disabled", async () => {
    const dir = withTemp();
    const paperless = createPaperless([[snapshot(1)]]);
    const documentAnalysis = createDocumentAnalysis((request) =>
      Effect.succeed(runOutcome(request, "succeeded")),
    );
    const { scanner } = await createScanner(dir, paperless, documentAnalysis, { enabled: false });

    const result = await Effect.runPromise(scanner.scanOnce());

    expect(result.status).toBe("disabled");
    expect(paperless.listDocumentsPage).not.toHaveBeenCalled();
    expect(documentAnalysis.run).not.toHaveBeenCalled();
  });

  it("reads the paginated ai-analyse tag receipt, filters sole transient documents, and processes sequentially", async () => {
    const dir = withTemp();
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      index === 0
        ? snapshot(1, [aiAnalyseTagId])
        : snapshot(index + 1, [aiAnalyseTagId, workflowTagId]),
    );
    const secondPage = [
      snapshot(101, [ordinaryTagId, aiAnalyseTagId]),
      ...Array.from({ length: 24 }, (_, index) =>
        snapshot(102 + index, [aiAnalyseTagId, workflowTagId]),
      ),
    ];
    const paperless = createPaperless([firstPage, secondPage]);
    const order: number[] = [];
    let active = 0;
    let maxActive = 0;
    const documentAnalysis = createDocumentAnalysis((request) =>
      Effect.gen(function* () {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(request.documentId);
        yield* Effect.sleep(Duration.millis(5));
        paperless.setDocumentTags(
          request.documentId,
          request.documentId === 101 ? [ordinaryTagId] : [],
        );
        active -= 1;
        return runOutcome(request, "succeeded");
      }),
    );
    const { scanner } = await createScanner(dir, paperless, documentAnalysis);

    const result = await Effect.runPromise(scanner.scanOnce());

    expect(result.status).toBe("completed");
    expect(result.scannedPages).toBe(2);
    expect(result.candidateCount).toBe(2);
    expect(order).toEqual([1, 101]);
    expect(maxActive).toBe(1);
    expect(documentAnalysis.run).toHaveBeenCalledTimes(2);
    expect(paperless.readTagAssignmentReceipt).toHaveBeenCalledWith(aiAnalyseTagId);
    expect(paperless.listDocumentsPage).not.toHaveBeenCalled();
  });

  it("canary scope processes only explicit positive document ID allowlist entries", async () => {
    const dir = withTemp();
    const paperless = createPaperless([[snapshot(1), snapshot(2), snapshot(3)]]);
    const processed: number[] = [];
    const documentAnalysis = createDocumentAnalysis((request) => {
      processed.push(request.documentId);
      paperless.setDocumentTags(request.documentId, []);
      return Effect.succeed(runOutcome(request, "succeeded"));
    });
    const { scanner } = await createScanner(dir, paperless, documentAnalysis, {
      scope: "canary",
      canaryDocumentIds: [2],
    });

    const result = await Effect.runPromise(scanner.scanOnce());

    expect(result.status).toBe("completed");
    expect(result.candidateCount).toBe(1);
    expect(processed).toEqual([2]);
    expect(documentAnalysis.run).toHaveBeenCalledTimes(1);
  });

  it("dedupes the same trigger revision and source/config hash while a proposal awaits review", async () => {
    const dir = withTemp();
    const paperless = createPaperless([[snapshot(1)]]);
    const documentAnalysis = createDocumentAnalysis((request) =>
      Effect.succeed(runOutcome(request, "awaiting_review")),
    );
    const { scanner } = await createScanner(dir, paperless, documentAnalysis);

    const first = await Effect.runPromise(scanner.scanOnce());
    const second = await Effect.runPromise(scanner.scanOnce());

    expect(first.results[0]?.status).toBe("awaiting_review");
    expect(second.results[0]).toMatchObject({ status: "deduped", reason: "awaiting_review" });
    expect(documentAnalysis.run).toHaveBeenCalledTimes(1);
  });

  it("pauses failures with the trigger retained and resumes only after human retry", async () => {
    const dir = withTemp();
    const paperless = createPaperless([[snapshot(1)]]);
    const documentAnalysis = createDocumentAnalysis(
      vi
        .fn()
        .mockImplementationOnce(() => Effect.fail(new Error("provider unavailable")))
        .mockImplementation((request: DocumentAnalysisRunRequest) => {
          paperless.setDocumentTags(request.documentId, []);
          return Effect.succeed(runOutcome(request, "succeeded"));
        }),
    );
    const { scanner } = await createScanner(dir, paperless, documentAnalysis);

    const failed = await Effect.runPromise(scanner.scanOnce());
    const deduped = await Effect.runPromise(scanner.scanOnce());
    const liveAfterFailure = await Effect.runPromise(paperless.getDocument(1));
    const filesAfterFailure = readdirSync(dir).sort();
    const ledgerJson = readFileSync(path.join(dir, "operational-ledger.json"), "utf8");
    await Effect.runPromise(scanner.requestHumanRetry(1));
    const retried = await Effect.runPromise(scanner.scanOnce());

    expect(failed.results[0]?.status).toBe("paused_failure");
    expect(liveAfterFailure.tags).toContain(aiAnalyseTagId);
    expect(deduped.results[0]).toMatchObject({ status: "deduped", reason: "paused_failure" });
    expect(retried.results[0]?.status).toBe("applied");
    expect(documentAnalysis.run).toHaveBeenCalledTimes(2);
    expect(filesAfterFailure).toEqual(["operational-ledger.json"]);
    expect(ledgerJson).toContain("ai_analyse_scanner:paused_failure");
    expect(ledgerJson).toContain("d2.ai-analyse.document:1");
    expect(ledgerJson).not.toContain("ai-analyse-automation-scanner.json");
    expect(ledgerJson).not.toContain("ai-analyse-scanner.json");
    expect(ledgerJson).not.toContain("Document 1");
    expect(ledgerJson).not.toContain("pdf-1");
    expect(ledgerJson).not.toContain("prompt");
    expect(ledgerJson).not.toContain("responseBody");
  });

  it("resumes a paused failure when the trigger revision changes", async () => {
    const dir = withTemp();
    const initial = snapshot(1);
    const paperless = createPaperless([[initial]]);
    const documentAnalysis = createDocumentAnalysis(
      vi
        .fn()
        .mockImplementationOnce(() => Effect.fail(new Error("first failure")))
        .mockImplementation((request: DocumentAnalysisRunRequest) => {
          paperless.setDocumentTags(request.documentId, []);
          return Effect.succeed(runOutcome(request, "succeeded"));
        }),
    );
    const { scanner } = await createScanner(dir, paperless, documentAnalysis);

    await Effect.runPromise(scanner.scanOnce());
    paperless.setSnapshot(
      1,
      snapshot(1, [aiAnalyseTagId], digest("state-1-revised"), "2026-07-22T11:00:00.000Z"),
    );
    const resumed = await Effect.runPromise(scanner.scanOnce());

    expect(resumed.results[0]?.status).toBe("applied");
    expect(documentAnalysis.run).toHaveBeenCalledTimes(2);
  });

  it("runs interrupted apply recovery before scanning new trigger work", async () => {
    const dir = withTemp();
    const paperless = createPaperless([[snapshot(1)]]);
    const documentAnalysis = createDocumentAnalysis((request) => {
      paperless.setDocumentTags(request.documentId, []);
      return Effect.succeed(runOutcome(request, "succeeded"));
    });
    const { scanner } = await createScanner(dir, paperless, documentAnalysis);

    await Effect.runPromise(scanner.scanOnce());

    expect(documentAnalysis.recoverInterruptedApplies).toHaveBeenCalledTimes(1);
    expect(documentAnalysis.run).toHaveBeenCalledTimes(1);
  });
});
