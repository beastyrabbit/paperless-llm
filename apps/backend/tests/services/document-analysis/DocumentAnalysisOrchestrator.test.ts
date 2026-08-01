import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type Sha256Digest, sha256Hex, sourcePdfHash } from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listAnalysisProposals } from "../../../src/api/analysis/query-handlers.js";
import type { Document, DocumentUpdate } from "../../../src/models/index.js";
import { CodexRuntimeService } from "../../../src/services/CodexRuntimeService.js";
import {
  clearAnalysisProposalEvidence,
  getAnalysisProposalEvidence,
} from "../../../src/services/document-analysis/evidence-store.js";
import {
  approvedOcrLabel,
  OCR_OPTIONS_VERSION,
  ocrContentHash,
} from "../../../src/services/document-analysis/ocr.js";
import { makeDocumentAnalysisOrchestrator } from "../../../src/services/document-analysis/orchestrator.js";
import { normalizeAnalysisProposalForPolicy } from "../../../src/services/document-analysis/proposals.js";
import { makeOcrMyPdfGenerator } from "../../../src/services/document-analysis/searchable-pdf.js";
import { MISTRAL_OCR_MODEL, MistralOcrService } from "../../../src/services/MistralOcrService.js";
import {
  makeOperationalLedgerService,
  OperationalLedgerService,
  type OperationalLedgerService as OperationalLedgerServiceShape,
} from "../../../src/services/OperationalLedgerService.js";
import {
  PaperlessService,
  type PaperlessService as PaperlessServiceShape,
} from "../../../src/services/PaperlessService.js";

const digest = (value: string): Sha256Digest => sha256Hex(value);
const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF", "latin1");
const sourceHash = sourcePdfHash(pdfBytes);
const ocrHash = digest("approved ocr");
const approvedOcrContent = "Approved OCR markdown with no persistent raw copy.";
const approvedOcrContentHash = ocrContentHash(approvedOcrContent);
const stateHash = digest("state");
const valueHash = digest("value");
const iso = "2026-07-22T10:00:00.000Z";
const ref = { pageNumber: 1, blockId: "p1-b1", quoteHash: digest("quote") };

const documentSnapshot = {
  documentId: 42,
  stateHash,
  sourcePdfHash,
  modified: iso,
  tagIds: [99, 100, 200],
  correspondentId: null,
  documentTypeId: null,
  customFieldIds: [10, 11],
};

const document: Document = {
  id: 42,
  title: "SKYWAY credit-card agreement",
  content: null,
  correspondent: null,
  correspondent_name: null,
  document_type: null,
  document_type_name: null,
  tags: [99, 100, 200],
  created: iso,
  modified: iso,
  added: iso,
  archive_serial_number: null,
  original_file_name: "SKYWAY_Kredit_TH.pdf",
  archived_file_name: null,
  custom_fields: [{ field: 99, value: "preserve me" }],
};

const proposal = {
  proposalId: "prop_document_42",
  runId: "ana_run_document_42",
  documentId: 42,
  proposalHash: digest("proposal"),
  proposed: {
    title: "Invoice 2026-07",
    correspondentId: null,
    documentTypeId: 7,
    ordinaryTagIds: [1, 2],
    newTagCandidates: [],
    customFields: [
      {
        customFieldId: 10,
        operation: "set",
        value: "INV-2026-07",
        valueHash,
        evidence: {
          field: "custom_field",
          customFieldId: 10,
          references: [ref],
          rationale: "Invoice number appears in the preview.",
          confidence: 0.94,
        },
      },
      {
        customFieldId: 11,
        operation: "remove",
        value: null,
        valueHash: null,
        evidence: {
          field: "custom_field",
          customFieldId: 11,
          references: [ref],
          rationale: "No due date appears in the preview.",
          confidence: 0.82,
        },
      },
      {
        customFieldId: 99,
        operation: "set",
        value: "preserve me",
        valueHash: digest("preserve me"),
        evidence: {
          field: "custom_field",
          customFieldId: 99,
          references: [ref],
          rationale: "The existing value remains supported by the document.",
          confidence: 0.9,
        },
      },
    ],
  },
  ocrPreview: {
    descriptor: "OCR preview covers 1 pages and 1 blocks.",
    previewHash: digest("preview"),
    pageCount: 1,
    blockCount: 1,
  },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [ref],
      rationale: "Title is present in the invoice header.",
      confidence: 0.91,
    },
    {
      field: "correspondent",
      customFieldId: null,
      references: [ref],
      rationale: "No correspondent is reliable enough to set.",
      confidence: 0.8,
    },
    {
      field: "document_type",
      customFieldId: null,
      references: [ref],
      rationale: "The document says invoice.",
      confidence: 0.9,
    },
    {
      field: "ordinary_tags",
      customFieldId: null,
      references: [ref],
      rationale: "The document belongs to two configured ordinary tags.",
      confidence: 0.88,
    },
  ],
  review: {
    required: false,
    reasons: [],
    rationale: "Evidence is strong and consistent.",
  },
  confidence: 0.86,
  rationale: "The bundle is backed by four strong evidence items.",
  preconditions: [{ kind: "paperless_document_state", digest: stateHash }],
  createdAt: iso,
};

const documentOutput = {
  schemaVersion: "g0.structured-output.v1",
  role: "document",
  runId: "ana_run_document_42",
  documentId: 42,
  documentStateHash: stateHash,
  sourcePdfHash,
  proposal,
  emittedAt: iso,
};

const runSuccess = (output: unknown) =>
  Effect.succeed({
    output,
    rawOutput: JSON.stringify(output),
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    caps: { stdoutBytes: 0, stderrBytes: 0 },
    exitCode: 0,
    signal: null,
    redactedLog: {},
  });

const createPaperless = (overrides: Partial<PaperlessServiceShape> = {}) => {
  let currentDocument = { ...document };
  const service = {
    getDocument: vi.fn(() => Effect.succeed(currentDocument)),
    getDocumentSnapshot: vi.fn(() => Effect.succeed(documentSnapshot)),
    getTags: vi.fn(() =>
      Effect.succeed([
        { id: 1, name: "Invoices", slug: "invoices" },
        { id: 2, name: "Finance", slug: "finance" },
        { id: 99, name: "System", slug: "system" },
        { id: 100, name: "ai-analyse", slug: "ai-analyse" },
        { id: 200, name: "Parent", slug: "parent" },
      ]),
    ),
    getCorrespondents: vi.fn(() => Effect.succeed([{ id: 7, name: "Vendor", slug: "vendor" }])),
    getDocumentTypes: vi.fn(() => Effect.succeed([{ id: 7, name: "Invoice", slug: "invoice" }])),
    getCustomFields: vi.fn(() =>
      Effect.succeed([
        { id: 10, name: "Invoice Number", data_type: "string" },
        { id: 11, name: "Due Date", data_type: "date" },
        { id: 99, name: "Formerly allowlisted out", data_type: "string" },
      ]),
    ),
    selectOriginalPdfVersion: vi.fn(() => Effect.succeed({ id: 9, label: "Original" })),
    downloadVersionPdf: vi.fn(() => Effect.succeed(pdfBytes)),
    downloadPdf: vi.fn(() => Effect.succeed(pdfBytes)),
    getDocumentVersions: vi.fn(() =>
      Effect.succeed([
        {
          id: 12,
          label: approvedOcrLabel(sourceHash, ocrHash, approvedOcrContentHash),
          content: approvedOcrContent,
        },
      ]),
    ),
    uploadOcrPdfVersion: vi.fn(() => Effect.succeed({ id: 13, task_id: "task-13" })),
    patchVersionContent: vi.fn((_docId: number, versionId: number, content: string) =>
      Effect.succeed({ id: versionId, content }),
    ),
    updateDocumentExact: vi.fn((_id: number, update: DocumentUpdate) => {
      currentDocument = {
        ...currentDocument,
        ...update,
        correspondent:
          update.correspondent === undefined ? currentDocument.correspondent : update.correspondent,
        document_type:
          update.document_type === undefined ? currentDocument.document_type : update.document_type,
        tags: update.tags ?? currentDocument.tags,
        custom_fields: [
          ...(currentDocument.custom_fields ?? []).filter((field) => {
            if (!field || typeof field !== "object") return true;
            const id = (field as { field?: unknown }).field;
            return !update.custom_fields?.some((next) => next.field === id);
          }),
          ...(update.custom_fields ?? []),
        ],
        content: update.content ?? currentDocument.content,
      };
      return Effect.succeed(currentDocument);
    }),
    rereadAfterMutation: vi.fn(() =>
      Effect.succeed({
        documentId: 42,
        beforeHash: stateHash,
        afterHash: digest("after"),
        rereadAt: iso,
        preconditions: [{ kind: "paperless_document_state", digest: stateHash }],
      }),
    ),
    ...overrides,
  } as unknown as PaperlessServiceShape;
  return service;
};

const createMistralOcr = () => ({
  processPdf: vi.fn(() =>
    Effect.succeed({
      model: MISTRAL_OCR_MODEL,
      sourceHash,
      optionsHash: digest("options"),
      ocrHash: digest("fresh ocr"),
      pages: [
        {
          index: 0,
          markdown: "Fresh OCR body that must remain memory-only.",
          tables: [],
          images: [],
          hyperlinks: [],
          header: null,
          footer: null,
          dimensions: null,
          confidence: null,
          blocks: [],
        },
      ],
      markdown: "Fresh OCR body that must remain memory-only.",
      usage: { pagesProcessed: 1, docSizeBytes: pdfBytes.byteLength },
      source: { id: "document-42" },
    }),
  ),
});

const createLayer = async (
  tempDir: string,
  options: {
    readonly paperless?: PaperlessServiceShape;
    readonly mistral?: ReturnType<typeof createMistralOcr>;
    readonly runStructured?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const ledger = await Effect.runPromise(
    makeOperationalLedgerService({
      dataDir: tempDir,
      file: path.join(tempDir, "operational-ledger.json"),
    }),
  );
  const paperless = options.paperless ?? createPaperless();
  const mistral = options.mistral ?? createMistralOcr();
  const runStructured = options.runStructured ?? vi.fn(() => runSuccess(documentOutput));
  const generator = { generate: vi.fn(() => Effect.succeed(Buffer.from("searchable pdf"))) };
  const service = await Effect.runPromise(
    makeDocumentAnalysisOrchestrator({ searchablePdfGenerator: generator }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PaperlessService, paperless),
          Layer.succeed(MistralOcrService, mistral),
          Layer.succeed(OperationalLedgerService, ledger),
          Layer.succeed(CodexRuntimeService, { runStructured } as unknown as CodexRuntimeService),
        ),
      ),
    ),
  );
  return { service, ledger, paperless, mistral, runStructured, generator };
};

const recoveryPolicy = {
  configuredCustomFieldIds: [10, 11],
  systemTagIds: [99, 100],
  parentTagIds: [200],
  workflowTagIds: [200],
  aiAnalyseTagId: 100,
} as const;

describe("DocumentAnalysisOrchestrator", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    clearAnalysisProposalEvidence();
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  const withTemp = () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "document-analysis-orchestrator-"));
    return tempDir;
  };

  const approveProposalForApply = async (
    ledger: Pick<
      OperationalLedgerServiceShape,
      "recordProposalDecision" | "transitionAnalysisRunState"
    >,
  ) => {
    await Effect.runPromise(
      ledger.recordProposalDecision("prop_document_42", {
        expectedDecision: "undecided",
        decision: "approved",
        outcome: "approved",
      }),
    );
    await Effect.runPromise(
      ledger.transitionAnalysisRunState("ana_run_document_42", "awaiting_review", "approved"),
    );
  };

  it("reuses a matching approved OCR version and keeps OCR preview text out of the ledger", async () => {
    const dir = withTemp();
    const mistral = createMistralOcr();
    const { service, runStructured, ledger, paperless } = await createLayer(dir, { mistral });

    const outcome = await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );

    expect(outcome.reusedOcrVersionId).toBe(12);
    const prompt = runStructured.mock.calls[0]?.[0].prompt as string;
    expect(prompt).toContain("SKYWAY credit-card agreement");
    expect(prompt).toContain("SKYWAY_Kredit_TH.pdf");
    expect(prompt).toContain('"customFields"');
    expect(outcome.autoApply).toBe(false);
    expect(mistral.processPdf).not.toHaveBeenCalled();
    expect(runStructured).toHaveBeenCalledTimes(1);
    expect(runStructured.mock.calls[0]?.[0]).toMatchObject({
      structuredOutputKind: "document",
      reasoningEffort: "medium",
    });
    expect(
      getAnalysisProposalEvidence("prop_document_42", {
        runId: "ana_run_document_42",
        documentId: 42,
        proposalHash: proposal.proposalHash,
      }),
    ).toMatchObject({
      proposalId: "prop_document_42",
      fieldEvidence: proposal.fieldEvidence,
    });
    const proposalPage = await Effect.runPromise(
      listAnalysisProposals("ana_run_document_42", { limit: 1 }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(OperationalLedgerService, ledger),
            Layer.succeed(PaperlessService, paperless),
          ),
        ),
      ),
    );
    expect(proposalPage.items[0]).toMatchObject({
      proposalId: "prop_document_42",
      evidenceAvailability: "available",
      ocrPreview: proposal.ocrPreview,
      fieldEvidence: proposal.fieldEvidence,
      confidence: proposal.confidence,
      freshness: {
        status: "fresh",
        stale: false,
        currentMissing: false,
      },
    });

    const ledgerJson = readFileSync(path.join(dir, "operational-ledger.json"), "utf8");
    expect(ledgerJson).toContain("prop_document_42");
    expect(ledgerJson).toContain("Invoice 2026-07");
    expect(ledgerJson).not.toContain("Approved OCR markdown");
    expect(ledgerJson).not.toContain("DOCUMENT STATE");
    expect(ledgerJson).not.toContain("rawOutput");
  });

  it("runs Mistral OCR when forced even if an approved OCR version matches", async () => {
    const dir = withTemp();
    const mistral = createMistralOcr();
    const { service } = await createLayer(dir, { mistral });

    const outcome = await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        forceOcr: true,
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99],
        workflowTagIds: [200],
        mode: "review",
      }),
    );

    expect(outcome.reusedOcrVersionId).toBeNull();
    expect(mistral.processPdf).toHaveBeenCalledTimes(1);
  });

  it("checks live ai-analyse before provider work and again after OCR before Codex", async () => {
    const dir = withTemp();
    const noTrigger = createPaperless({
      getDocument: vi.fn(() => Effect.succeed({ ...document, tags: [99, 200] })),
    });
    const mistral = createMistralOcr();
    const runStructured = vi.fn(() => runSuccess(documentOutput));
    const noTriggerLayer = await createLayer(dir, {
      paperless: noTrigger,
      mistral,
      runStructured,
    });

    const missingBeforeProvider = await Effect.runPromise(
      Effect.either(
        noTriggerLayer.service.run({
          documentId: 42,
          runId: "ana_run_document_42",
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          workflowTagIds: [200],
          aiAnalyseTagId: 100,
          mode: "review",
        }),
      ),
    );

    expect(missingBeforeProvider._tag).toBe("Left");
    expect(mistral.processPdf).not.toHaveBeenCalled();
    expect(runStructured).not.toHaveBeenCalled();

    const dir2 = withTemp();
    const sequence: string[] = [];
    const withdrawnAfterOcr = createPaperless({
      getDocument: vi
        .fn()
        .mockImplementationOnce(() => {
          sequence.push("getDocument:before-provider");
          return Effect.succeed(document);
        })
        .mockImplementationOnce(() => {
          sequence.push("getDocument:before-codex");
          return Effect.succeed({ ...document, tags: [99, 200] });
        }),
    });
    const mistralAfter = {
      processPdf: vi.fn(
        (input: Parameters<ReturnType<typeof createMistralOcr>["processPdf"]>[0]) => {
          sequence.push("mistral");
          return createMistralOcr().processPdf(input);
        },
      ),
    };
    const runStructuredAfter = vi.fn(() => {
      sequence.push("codex");
      return runSuccess(documentOutput);
    });
    const withdrawnLayer = await createLayer(dir2, {
      paperless: withdrawnAfterOcr,
      mistral: mistralAfter,
      runStructured: runStructuredAfter,
    });

    const withdrawn = await Effect.runPromise(
      Effect.either(
        withdrawnLayer.service.run({
          documentId: 42,
          runId: "ana_run_document_42b",
          forceOcr: true,
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          workflowTagIds: [200],
          aiAnalyseTagId: 100,
          mode: "review",
        }),
      ),
    );

    expect(withdrawn._tag).toBe("Left");
    expect(sequence).toEqual([
      "getDocument:before-provider",
      "mistral",
      "getDocument:before-codex",
    ]);
    expect(runStructuredAfter).not.toHaveBeenCalled();
  });

  it("marks proposals with more than five ordinary tags for review", () => {
    const normalized = normalizeAnalysisProposalForPolicy(
      {
        ...proposal,
        proposed: {
          ...proposal.proposed,
          ordinaryTagIds: [1, 2, 3, 4, 5, 6],
        },
      },
      {
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [],
        workflowTagIds: [],
      },
    );

    expect(normalized.shouldApplyAutomatically).toBe(false);
    expect(normalized.reviewReasons).toContain("more_than_5_tags");
  });

  it("allows four to five ordinary tags only with strong tag-specific evidence", () => {
    const fourTagProposal = {
      ...proposal,
      proposed: { ...proposal.proposed, ordinaryTagIds: [1, 2, 3, 4] },
      fieldEvidence: [
        ...proposal.fieldEvidence.filter((evidence) => evidence.field !== "ordinary_tags"),
        {
          field: "ordinary_tags",
          customFieldId: null,
          references: [
            ref,
            { ...ref, blockId: "p1-b2" },
            { ...ref, blockId: "p1-b3" },
            { ...ref, blockId: "p1-b4" },
          ],
          rationale: "Each proposed ordinary tag is supported by a direct preview reference.",
          confidence: 0.9,
        },
      ],
    };

    expect(
      normalizeAnalysisProposalForPolicy(fourTagProposal, {
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [],
        workflowTagIds: [],
      }).shouldApplyAutomatically,
    ).toBe(true);
    expect(
      normalizeAnalysisProposalForPolicy(
        {
          ...fourTagProposal,
          fieldEvidence: fourTagProposal.fieldEvidence.map((evidence) =>
            evidence.field === "ordinary_tags" ? { ...evidence, confidence: 0.5 } : evidence,
          ),
        },
        {
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [],
          workflowTagIds: [],
        },
      ).reviewReasons,
    ).toContain("strong_tag_evidence_required");
  });

  it("does not reuse approved OCR when model/options mismatch or content hash is forged", async () => {
    const dir = withTemp();
    const forged = createPaperless({
      getDocumentVersions: vi.fn(() =>
        Effect.succeed([
          {
            id: 12,
            label: approvedOcrLabel(
              sourceHash,
              ocrHash,
              digest("forged content hash"),
              MISTRAL_OCR_MODEL,
              OCR_OPTIONS_VERSION,
            ),
            content: approvedOcrContent,
          },
          {
            id: 13,
            label: approvedOcrLabel(
              sourceHash,
              ocrHash,
              approvedOcrContentHash,
              "mistral-ocr-older",
              OCR_OPTIONS_VERSION,
            ),
            content: approvedOcrContent,
          },
          {
            id: 14,
            label: approvedOcrLabel(
              sourceHash,
              ocrHash,
              approvedOcrContentHash,
              MISTRAL_OCR_MODEL,
              "mistral-ocr-options.old",
            ),
            content: approvedOcrContent,
          },
        ]),
      ),
    });
    const mistral = createMistralOcr();
    const { service } = await createLayer(dir, { paperless: forged, mistral });

    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        forceOcr: true,
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99],
        workflowTagIds: [200],
        mode: "review",
      }),
    );

    expect(mistral.processPdf).toHaveBeenCalledTimes(1);
  });

  it("rejects proposed IDs missing from the live D1 catalog snapshot", async () => {
    const dir = withTemp();
    const badProposalOutput = {
      ...documentOutput,
      proposal: {
        ...proposal,
        proposed: {
          ...proposal.proposed,
          ordinaryTagIds: [1, 999],
        },
      },
    };
    const { service, ledger } = await createLayer(dir, {
      runStructured: vi.fn(() => runSuccess(badProposalOutput)),
    });

    const result = await Effect.runPromise(
      Effect.either(
        service.run({
          documentId: 42,
          runId: "ana_run_document_42",
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          workflowTagIds: [200],
          aiAnalyseTagId: 100,
          mode: "review",
        }),
      ),
    );
    const snapshot = await Effect.runPromise(ledger.getSnapshot());

    expect(result._tag).toBe("Left");
    expect(snapshot.proposals.prop_document_42).toBeUndefined();
  });

  it("applies the whole approved bundle with preread, OCRmyPDF upload, Mistral content patch, exact metadata update, and postread", async () => {
    const dir = withTemp();
    const freshOcrPaperless = createPaperless({
      getDocumentVersions: vi
        .fn()
        .mockImplementationOnce(() =>
          Effect.succeed([
            {
              id: 12,
              label: approvedOcrLabel(sourceHash, ocrHash, approvedOcrContentHash),
              content: approvedOcrContent,
            },
          ]),
        )
        .mockImplementation(() => Effect.succeed([])),
    });
    const { service, ledger, paperless, generator } = await createLayer(dir, {
      paperless: freshOcrPaperless,
    });
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        forceOcr: true,
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(ledger);

    const outcome = await Effect.runPromise(
      service.applyApprovedProposal({
        proposalId: "prop_document_42",
        expectedProposalHash: digest("proposal"),
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        aiAnalyseTagId: 100,
      }),
    );

    expect(outcome.afterHash).toBe(digest("after"));
    expect(generator.generate).toHaveBeenCalledWith(pdfBytes);
    expect(paperless.uploadOcrPdfVersion).toHaveBeenCalledWith(
      42,
      Buffer.from("searchable pdf"),
      approvedOcrLabel(
        sourceHash,
        digest("fresh ocr"),
        ocrContentHash("Fresh OCR body that must remain memory-only."),
      ),
    );
    expect(paperless.patchVersionContent).toHaveBeenCalledWith(
      42,
      13,
      "Fresh OCR body that must remain memory-only.",
    );
    expect(paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
    const [, update, options] = (
      paperless.updateDocumentExact as unknown as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect(update).toMatchObject({
      title: "Invoice 2026-07",
      correspondent: null,
      document_type: 7,
      tags: [1, 2],
      content: "Fresh OCR body that must remain memory-only.",
    });
    expect(update.tags).not.toContain(100);
    expect(update.custom_fields).toEqual([
      { field: 10, value: "INV-2026-07" },
      { field: 11, value: null },
      { field: 99, value: "preserve me" },
    ]);
    expect(options.preserveTagIds.size).toBe(0);
    expect(options.preserveTagIds.has(100)).toBe(false);
    expect(options.managedCustomFieldIds.has(10)).toBe(true);
    expect(options.managedCustomFieldIds.has(99)).toBe(true);
    expect(paperless.rereadAfterMutation).toHaveBeenCalledTimes(1);

    const ledgerJson = readFileSync(path.join(dir, "operational-ledger.json"), "utf8");
    expect(ledgerJson).toContain("journal_prop_document_42");
    expect(ledgerJson).not.toContain("Fresh OCR body");
  });

  it("treats a reused approved OCR version as satisfying searchable upload idempotently", async () => {
    const dir = withTemp();
    const { service, ledger, paperless, generator } = await createLayer(dir);
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(ledger);

    await Effect.runPromise(
      service.applyApprovedProposal({
        proposalId: "prop_document_42",
        expectedProposalHash: digest("proposal"),
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        aiAnalyseTagId: 100,
      }),
    );

    expect(generator.generate).not.toHaveBeenCalled();
    expect(paperless.uploadOcrPdfVersion).not.toHaveBeenCalled();
    expect(paperless.patchVersionContent).not.toHaveBeenCalled();
    expect(paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
  });

  it("automatically applies safe automatic-mode proposals and prevents replay after applied", async () => {
    const dir = withTemp();
    const { service, paperless } = await createLayer(dir);

    const outcome = await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
      }),
    );
    const replay = await Effect.runPromise(
      Effect.either(
        service.applyApprovedProposal({
          proposalId: "prop_document_42",
          expectedProposalHash: digest("proposal"),
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          aiAnalyseTagId: 100,
        }),
      ),
    );

    expect(outcome.autoApply).toBe(true);
    expect(outcome.run.state).toBe("succeeded");
    expect(paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(replay._tag).toBe("Left");
    if (replay._tag === "Left") {
      expect(replay.left.code).toBe("REJECTED");
    }
  });

  it("applies without legacy system or parent tag allowlists", async () => {
    const dir = withTemp();
    const { service, ledger, paperless } = await createLayer(dir);
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(ledger);

    const result = await Effect.runPromise(
      Effect.either(
        service.applyApprovedProposal({
          proposalId: "prop_document_42",
          expectedProposalHash: digest("proposal"),
          configuredCustomFieldIds: [10, 11],
          parentTagIds: [200],
          aiAnalyseTagId: 100,
        }),
      ),
    );

    expect(result._tag).toBe("Right");
    expect(paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
  });

  it("persists an applying journal before upload and retains ai-analyse when pre-upload generation fails", async () => {
    const dir = withTemp();
    const generator = {
      generate: vi.fn(() => Effect.fail(new Error("OCRmyPDF failed before Paperless mutation"))),
    };
    const ledger = await Effect.runPromise(
      makeOperationalLedgerService({
        dataDir: dir,
        file: path.join(dir, "operational-ledger.json"),
      }),
    );
    const paperless = createPaperless({
      getDocumentVersions: vi.fn(() => Effect.succeed([])),
    });
    const mistral = createMistralOcr();
    const service = await Effect.runPromise(
      makeDocumentAnalysisOrchestrator({ searchablePdfGenerator: generator }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(PaperlessService, paperless),
            Layer.succeed(MistralOcrService, mistral),
            Layer.succeed(OperationalLedgerService, ledger),
            Layer.succeed(CodexRuntimeService, {
              runStructured: vi.fn(() => runSuccess(documentOutput)),
            } as unknown as CodexRuntimeService),
          ),
        ),
      ),
    );
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        forceOcr: true,
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(ledger);

    const result = await Effect.runPromise(
      Effect.either(
        service.applyApprovedProposal({
          proposalId: "prop_document_42",
          expectedProposalHash: digest("proposal"),
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          aiAnalyseTagId: 100,
        }),
      ),
    );
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    const live = await Effect.runPromise(paperless.getDocument(42));

    expect(result._tag).toBe("Left");
    expect(snapshot.applyJournals.journal_prop_document_42?.status).toBe("applying");
    expect(paperless.uploadOcrPdfVersion).not.toHaveBeenCalled();
    expect(paperless.updateDocumentExact).not.toHaveBeenCalled();
    expect(live.tags).toContain(100);
  });

  it("fails apply as stale when the reusable OCR hash drifts from the approved proposal", async () => {
    const dir = withTemp();
    const paperless = createPaperless({
      getDocumentVersions: vi.fn(() =>
        Effect.succeed([
          {
            id: 12,
            label: approvedOcrLabel(
              sourceHash,
              digest("different ocr"),
              ocrContentHash("Different OCR markdown."),
            ),
            content: "Different OCR markdown.",
          },
        ]),
      ),
    });
    const { service } = await createLayer(dir);
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    const { ledger } = await createLayer(dir);
    await approveProposalForApply(ledger);
    const stale = await createLayer(dir, { paperless });

    const result = await Effect.runPromise(
      Effect.either(
        stale.service.applyApprovedProposal({
          proposalId: "prop_document_42",
          expectedProposalHash: digest("proposal"),
          configuredCustomFieldIds: [10, 11],
          systemTagIds: [99, 100],
          parentTagIds: [200],
          aiAnalyseTagId: 100,
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.code).toBe("STALE_PRECONDITION");
    }
    expect(stale.generator.generate).not.toHaveBeenCalled();
  });

  it("recovers crash after applying journal before upload by generating once and applying metadata", async () => {
    const dir = withTemp();
    const noApprovedVersion = createPaperless({
      getDocumentVersions: vi.fn(() => Effect.succeed([])),
    });
    const recoveredLayer = await createLayer(dir, { paperless: noApprovedVersion });
    await Effect.runPromise(
      recoveredLayer.service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        forceOcr: true,
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(recoveredLayer.ledger);
    await Effect.runPromise(
      recoveredLayer.ledger.transitionAnalysisRunState(
        "ana_run_document_42",
        "approved",
        "applying",
      ),
    );
    const beforeRecovery = await Effect.runPromise(recoveredLayer.ledger.getSnapshot());
    const recorded = beforeRecovery.proposals.prop_document_42;
    expect(recorded).toBeDefined();
    await Effect.runPromise(
      recoveredLayer.ledger.recordApplyJournal({
        journalId: "journal_prop_document_42",
        proposalId: "prop_document_42",
        epochId: "cat_epoch_ana_run_document_42",
        idempotencyKey: "journal_prop_document_42",
        status: "applying",
        preconditions: recorded?.preconditions ?? [],
        steps: [
          {
            stepId: "preread",
            operation: "describe",
            paperlessTaskId: null,
            beforeHash: stateHash,
            afterHash: null,
            status: "succeeded",
            recordedAt: iso,
          },
        ],
        createdAt: iso,
        updatedAt: iso,
      }),
    );

    const recovered = await Effect.runPromise(
      recoveredLayer.service.recoverInterruptedApplies(recoveryPolicy),
    );
    const afterRecovery = await Effect.runPromise(recoveredLayer.ledger.getSnapshot());

    expect(recovered).toEqual([
      {
        journalId: "journal_prop_document_42",
        proposalId: "prop_document_42",
        status: "resumed_applied",
      },
    ]);
    expect(recoveredLayer.generator.generate).toHaveBeenCalledTimes(1);
    expect(recoveredLayer.paperless.uploadOcrPdfVersion).toHaveBeenCalledTimes(1);
    expect(recoveredLayer.paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(afterRecovery.leases["mutation:42"]).toBeUndefined();
    expect(afterRecovery.analysisRuns.ana_run_document_42?.state).toBe("succeeded");
  });

  it("recovers crash after approved version upload by skipping duplicate generation and upload", async () => {
    const dir = withTemp();
    const recoveredLayer = await createLayer(dir);
    await Effect.runPromise(
      recoveredLayer.service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(recoveredLayer.ledger);
    await Effect.runPromise(
      recoveredLayer.ledger.transitionAnalysisRunState(
        "ana_run_document_42",
        "approved",
        "applying",
      ),
    );
    const beforeRecovery = await Effect.runPromise(recoveredLayer.ledger.getSnapshot());
    await Effect.runPromise(
      recoveredLayer.ledger.recordApplyJournal({
        journalId: "journal_prop_document_42",
        proposalId: "prop_document_42",
        epochId: "cat_epoch_ana_run_document_42",
        idempotencyKey: "journal_prop_document_42",
        status: "applying",
        preconditions: beforeRecovery.proposals.prop_document_42?.preconditions ?? [],
        steps: [
          {
            stepId: "preread",
            operation: "describe",
            paperlessTaskId: null,
            beforeHash: stateHash,
            afterHash: null,
            status: "succeeded",
            recordedAt: iso,
          },
          {
            stepId: "upload-searchable-pdf",
            operation: "create",
            paperlessTaskId: "task-previous",
            beforeHash: sourceHash,
            afterHash: ocrHash,
            status: "succeeded",
            recordedAt: iso,
          },
        ],
        createdAt: iso,
        updatedAt: iso,
      }),
    );

    const recovered = await Effect.runPromise(
      recoveredLayer.service.recoverInterruptedApplies(recoveryPolicy),
    );

    expect(recovered[0]).toMatchObject({
      proposalId: "prop_document_42",
      status: "resumed_applied",
    });
    expect(recoveredLayer.generator.generate).not.toHaveBeenCalled();
    expect(recoveredLayer.paperless.uploadOcrPdfVersion).not.toHaveBeenCalled();
    expect(recoveredLayer.paperless.patchVersionContent).not.toHaveBeenCalled();
    expect(recoveredLayer.paperless.updateDocumentExact).toHaveBeenCalledTimes(1);
  });

  it("resolves an ambiguous recovery metadata timeout by rereading final state", async () => {
    const dir = withTemp();
    const initialLayer = await createLayer(dir);
    await Effect.runPromise(
      initialLayer.service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        parentTagIds: [200],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(initialLayer.ledger);
    await Effect.runPromise(
      initialLayer.ledger.transitionAnalysisRunState("ana_run_document_42", "approved", "applying"),
    );
    const beforeRecovery = await Effect.runPromise(initialLayer.ledger.getSnapshot());
    await Effect.runPromise(
      initialLayer.ledger.recordApplyJournal({
        journalId: "journal_prop_document_42",
        proposalId: "prop_document_42",
        epochId: "cat_epoch_ana_run_document_42",
        idempotencyKey: "journal_prop_document_42",
        status: "applying",
        preconditions: beforeRecovery.proposals.prop_document_42?.preconditions ?? [],
        steps: [
          {
            stepId: "preread",
            operation: "describe",
            paperlessTaskId: null,
            beforeHash: stateHash,
            afterHash: null,
            status: "succeeded",
            recordedAt: iso,
          },
          {
            stepId: "upload-searchable-pdf",
            operation: "create",
            paperlessTaskId: "task-previous",
            beforeHash: sourceHash,
            afterHash: ocrHash,
            status: "succeeded",
            recordedAt: iso,
          },
        ],
        createdAt: iso,
        updatedAt: iso,
      }),
    );

    const finalDocument: Document = {
      ...document,
      title: "Invoice 2026-07",
      correspondent: null,
      document_type: 7,
      tags: [1, 2],
      content: approvedOcrContent,
      custom_fields: [
        { field: 99, value: "preserve me" },
        { field: 10, value: "INV-2026-07" },
        { field: 11, value: null },
      ],
    };
    let readCount = 0;
    const ambiguousPaperless = createPaperless({
      getDocument: vi.fn(() => Effect.succeed(readCount++ === 0 ? document : finalDocument)),
      updateDocumentExact: vi.fn(() =>
        Effect.fail(new Error("Paperless network timeout after metadata write")),
      ),
    });
    const recoveredLayer = await createLayer(dir, { paperless: ambiguousPaperless });

    const recovered = await Effect.runPromise(
      recoveredLayer.service.recoverInterruptedApplies(recoveryPolicy),
    );
    const snapshot = await Effect.runPromise(recoveredLayer.ledger.getSnapshot());

    expect(recovered).toEqual([
      {
        journalId: "journal_prop_document_42",
        proposalId: "prop_document_42",
        status: "resumed_applied",
      },
    ]);
    expect(ambiguousPaperless.getDocument).toHaveBeenCalledTimes(2);
    expect(ambiguousPaperless.updateDocumentExact).toHaveBeenCalledTimes(1);
    expect(recoveredLayer.generator.generate).not.toHaveBeenCalled();
    expect(ambiguousPaperless.uploadOcrPdfVersion).not.toHaveBeenCalled();
    expect(ambiguousPaperless.patchVersionContent).not.toHaveBeenCalled();
    expect(snapshot.leases["mutation:42"]).toBeUndefined();
    expect(snapshot.proposals.prop_document_42?.decision).toBe("applied");
    expect(snapshot.analysisRuns.ana_run_document_42?.state).toBe("succeeded");
  });

  it("recovers an interrupted apply by rereading final Paperless state and marking it applied", async () => {
    const dir = withTemp();
    const finalDocument: Document = {
      ...document,
      title: "Invoice 2026-07",
      correspondent: null,
      document_type: 7,
      tags: [1, 2],
      content: approvedOcrContent,
      custom_fields: [
        { field: 99, value: "preserve me" },
        { field: 10, value: "INV-2026-07" },
        { field: 11, value: null },
      ],
    };
    const { service, ledger } = await createLayer(dir);
    await Effect.runPromise(
      service.run({
        documentId: 42,
        runId: "ana_run_document_42",
        configuredCustomFieldIds: [10, 11],
        systemTagIds: [99, 100],
        workflowTagIds: [200],
        aiAnalyseTagId: 100,
        mode: "review",
      }),
    );
    await approveProposalForApply(ledger);
    await Effect.runPromise(
      ledger.transitionAnalysisRunState("ana_run_document_42", "approved", "applying"),
    );
    await Effect.runPromise(
      ledger.recordApplyJournal({
        journalId: "journal_prop_interrupted",
        proposalId: "prop_document_42",
        epochId: "cat_epoch_ana_run_document_42",
        idempotencyKey: "journal_prop_interrupted",
        status: "applying",
        preconditions: [
          { kind: "paperless_document_state", digest: stateHash },
          {
            kind: "source_pdf",
            digest: sha256Hex(
              JSON.stringify({
                contentHash: approvedOcrContentHash,
                model: MISTRAL_OCR_MODEL,
                ocrHash,
                optionsVersion: OCR_OPTIONS_VERSION,
                sourceHash,
              }),
            ),
          },
        ],
        steps: [
          {
            stepId: "preread",
            operation: "describe",
            paperlessTaskId: null,
            beforeHash: stateHash,
            afterHash: null,
            status: "running",
            recordedAt: iso,
          },
        ],
        createdAt: iso,
        updatedAt: iso,
      }),
    );

    const finalPaperless = createPaperless({
      getDocument: vi.fn(() => Effect.succeed(finalDocument)),
    });
    const recoveredLayer = await createLayer(dir, { paperless: finalPaperless });
    const recovered = await Effect.runPromise(
      recoveredLayer.service.recoverInterruptedApplies(recoveryPolicy),
    );
    const snapshot = await Effect.runPromise(recoveredLayer.ledger.getSnapshot());

    expect(recovered).toEqual([
      {
        journalId: "journal_prop_interrupted",
        proposalId: "prop_document_42",
        status: "verified_applied",
      },
    ]);
    expect(snapshot.proposals.prop_document_42?.decision).toBe("applied");
    expect(snapshot.analysisRuns.ana_run_document_42?.state).toBe("succeeded");
    expect(recoveredLayer.mistral.processPdf).not.toHaveBeenCalled();
    expect(finalPaperless.getDocumentVersions).toHaveBeenCalled();
    expect(finalPaperless.uploadOcrPdfVersion).not.toHaveBeenCalled();
    expect(finalPaperless.patchVersionContent).not.toHaveBeenCalled();
  });

  it("invokes OCRmyPDF with fixed safe argv and terminates timed-out children", async () => {
    const dir = withTemp();
    const output = Buffer.from("searchable");
    const spawnCalls: Array<{
      command: string;
      args: readonly string[];
      options: Record<string, unknown>;
    }> = [];
    const spawnProcess = vi.fn(
      (command: string, args: readonly string[], options: Record<string, unknown>) => {
        spawnCalls.push({ command, args, options });
        const child = new EventEmitter() as EventEmitter & {
          stderr: EventEmitter;
          kill: ReturnType<typeof vi.fn>;
        };
        child.stderr = new EventEmitter();
        child.kill = vi.fn();
        void writeFile(args.at(-1) ?? path.join(dir, "missing-output.pdf"), output).then(() =>
          child.emit("close", 0),
        );
        return child;
      },
    );
    const generator = makeOcrMyPdfGenerator({
      command: "ocrmypdf-test",
      spawnProcess: spawnProcess as never,
    });

    const result = await Effect.runPromise(generator.generate(pdfBytes));

    expect(Buffer.from(result)).toEqual(output);
    expect(spawnCalls[0]).toMatchObject({
      command: "ocrmypdf-test",
      args: [
        "--skip-text",
        "--deskew",
        "--rotate-pages",
        "--output-type",
        "pdf",
        expect.stringContaining("input.pdf"),
        expect.stringContaining("output.pdf"),
      ],
      options: { shell: false },
    });

    vi.useFakeTimers();
    const hangingChildren: Array<{ kill: ReturnType<typeof vi.fn> }> = [];
    const hangingSpawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stderr: EventEmitter;
        kill: ReturnType<typeof vi.fn>;
      };
      child.stderr = new EventEmitter();
      child.kill = vi.fn();
      hangingChildren.push(child);
      return child;
    });
    const hangingGenerator = makeOcrMyPdfGenerator({
      command: "ocrmypdf-test",
      timeoutMs: 10,
      termGraceMs: 10,
      spawnProcess: hangingSpawn as never,
    });
    const timedOut = Effect.runPromise(Effect.either(hangingGenerator.generate(pdfBytes)));
    await vi.waitFor(() => expect(hangingChildren.length).toBe(1));
    await vi.advanceTimersByTimeAsync(10);
    expect(hangingChildren[0]?.kill).toHaveBeenCalledWith("SIGTERM");
    await vi.advanceTimersByTimeAsync(10);
    expect(hangingChildren[0]?.kill).toHaveBeenCalledWith("SIGKILL");
    expect((await timedOut)._tag).toBe("Left");
    vi.useRealTimers();
  });
});
