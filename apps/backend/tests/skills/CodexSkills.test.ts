import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CodexRuntimeError, CodexRuntimeService } from "../../src/services/CodexRuntimeService.js";
import { CatalogOptimizationSkill } from "../../src/skills/CatalogOptimizationSkill.js";
import {
  buildDocumentAnalysisPrompt,
  type DocumentAnalysisInput,
  DocumentAnalysisSkill,
} from "../../src/skills/DocumentAnalysisSkill.js";

const digest = "0".repeat(64);
const iso = "2026-07-22T10:00:00.000Z";
const ref = { pageNumber: 1, blockId: "p1-b1", quoteHash: digest };
const precondition = { kind: "paperless_document_state", digest };

const validAnalysisProposal = {
  proposalId: "prop_analysis_bundle",
  runId: "ana_run_document_42",
  documentId: 42,
  proposalHash: digest,
  proposed: {
    title: "Invoice 2026-07",
    correspondentId: 7,
    documentTypeId: null,
    ordinaryTagIds: [1, 2, 3],
    newTagCandidates: [],
    customFields: [
      {
        customFieldId: 10,
        operation: "set",
        value: "INV-2026-07",
        valueHash: digest,
        evidence: {
          field: "custom_field",
          customFieldId: 10,
          references: [ref],
          rationale: "Invoice number appears near the header.",
          confidence: 0.91,
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
          rationale: "No due date appears in inspected blocks.",
          confidence: 0.67,
        },
      },
    ],
  },
  ocrPreview: {
    descriptor: "OCR preview covers 2 pages and 14 blocks.",
    previewHash: digest,
    pageCount: 2,
    blockCount: 14,
  },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [ref],
      rationale: "The invoice title appears in the first block.",
      confidence: 0.89,
    },
  ],
  review: {
    required: false,
    reasons: [],
    rationale: "Evidence is consistent.",
  },
  confidence: 0.84,
  rationale: "The bundle is consistent across the inspected document evidence.",
  preconditions: [precondition],
  createdAt: iso,
};

const validDocumentOutput = {
  schemaVersion: "g0.structured-output.v1",
  role: "document",
  runId: "ana_run_document_42",
  documentId: 42,
  documentStateHash: digest,
  sourcePdfHash: null,
  proposal: validAnalysisProposal,
  emittedAt: iso,
};

const invalidSemanticDocumentOutput = {
  ...validDocumentOutput,
  proposal: {
    ...validAnalysisProposal,
    proposed: {
      ...validAnalysisProposal.proposed,
      ordinaryTagIds: [1, 1],
    },
  },
};

const runSuccess = (output: unknown) =>
  Effect.succeed({
    output,
    rawOutput: JSON.stringify(output),
    usage: {},
    caps: { stdoutBytes: 0, stderrBytes: 0 },
    exitCode: 0,
    signal: null,
    redactedLog: {},
  });

const documentInput: DocumentAnalysisInput = {
  runId: "ana_run_document_42",
  documentId: 42,
  documentState: { title: "Invoice\u0000 2026", hash: "abc" },
  ocrPreview: { pages: [{ pageNumber: 1, text: "Invoice total EUR 42" }] },
  catalogSnapshot: { tags: [{ id: 1, name: "Invoices" }] },
  configuredCustomFieldIds: [10, 11],
  guidance: "Prefer existing tags.",
};

describe("Codex typed skills", () => {
  it("builds sanitized document prompts with structured placeholders resolved", () => {
    const prompt = buildDocumentAnalysisPrompt(documentInput);

    expect(prompt).toContain("Return exactly one JSON object");
    expect(prompt).toContain("ENGINE IDENTITY");
    expect(prompt).toContain('"runId": "ana_run_document_42"');
    expect(prompt).toContain('"documentId": 42');
    expect(prompt).toContain("OUTPUT JSON SCHEMA");
    expect(prompt).toContain("Invoice 2026");
    expect(prompt).toContain("every existing tag name");
    expect(prompt).toContain("SKYWAY");
    expect(prompt).toContain("identity tag outranks broad topical tags");
    expect(prompt).toContain("every custom field supplied");
    expect(prompt).toContain("Echter Korrespondent");
    expect(prompt).not.toContain("\u0000");
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("defaults document analysis to medium reasoning", async () => {
    const runStructured = vi.fn(() => runSuccess(validDocumentOutput));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer)),
    );

    expect(result.repaired).toBe(false);
    expect(result.strictProposalErrors).toEqual([]);
    expect(runStructured).toHaveBeenCalledTimes(1);
    expect(runStructured.mock.calls[0]?.[0].reasoningEffort).toBe("medium");
  });

  it("replaces model-authored document and run identities with backend-owned values", async () => {
    const mismatchedOutput = {
      ...validDocumentOutput,
      runId: "ana_run_model_invented",
      documentId: 999,
      proposal: {
        ...validAnalysisProposal,
        runId: "ana_run_model_invented",
        documentId: 999,
      },
    };
    const runStructured = vi.fn(() => runSuccess(mismatchedOutput));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer)),
    );

    expect(result.output).toMatchObject({
      runId: documentInput.runId,
      documentId: documentInput.documentId,
      proposal: {
        runId: documentInput.runId,
        documentId: documentInput.documentId,
      },
    });
    expect(result.run.output).toEqual(result.output);
    expect(runStructured).toHaveBeenCalledTimes(1);
  });

  it("runs one targeted repair for semantic strict-proposal failures", async () => {
    const runStructured = vi
      .fn()
      .mockReturnValueOnce(runSuccess(invalidSemanticDocumentOutput))
      .mockReturnValueOnce(runSuccess(validDocumentOutput));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer)),
    );

    expect(result.repaired).toBe(true);
    expect(result.strictProposalErrors).toEqual([]);
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(runStructured.mock.calls[1]?.[0].prompt).toContain(
      "Repair this invalid document structured output",
    );
    expect(runStructured.mock.calls[1]?.[0].prompt).toContain("DUPLICATE_IDS");
  });

  it("fails closed when semantic repair still returns invalid proposal output", async () => {
    const runStructured = vi
      .fn()
      .mockReturnValueOnce(runSuccess(invalidSemanticDocumentOutput))
      .mockReturnValueOnce(runSuccess(invalidSemanticDocumentOutput));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      Effect.either(DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer))),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("CODEX_STRUCTURED_OUTPUT_INVALID");
    expect(runStructured).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-structured document runtime failures", async () => {
    const timeout = new CodexRuntimeError({
      code: "CODEX_TIMEOUT",
      message: "timed out",
    });
    const runStructured = vi.fn(() => Effect.fail(timeout));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      Effect.either(DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer))),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("CODEX_TIMEOUT");
    expect(runStructured).toHaveBeenCalledTimes(1);
  });

  it("runs targeted repair only for invalid document structured output", async () => {
    const invalid = new CodexRuntimeError({
      code: "CODEX_STRUCTURED_OUTPUT_INVALID",
      message: "bad shape",
    });
    const runStructured = vi
      .fn()
      .mockReturnValueOnce(Effect.fail(invalid))
      .mockReturnValueOnce(runSuccess(validDocumentOutput));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      DocumentAnalysisSkill.run(documentInput).pipe(Effect.provide(layer)),
    );

    expect(result.repaired).toBe(true);
    expect(runStructured).toHaveBeenCalledTimes(2);
    expect(runStructured.mock.calls[1]?.[0].prompt).toContain(
      "Repair this invalid document structured output",
    );
  });

  it("keeps catalog optimization personas typed and does not add repair retries", async () => {
    const input = {
      epochId: "cat_epoch_test",
      candidate: { candidateId: "cand_test", intendedAction: "merge" },
      catalogSnapshot: { tags: [] },
      documentEvidence: [{ documentId: 1, text: "evidence" }],
      policy: "Prefer merges over deletes.",
    };
    const invalid = new CodexRuntimeError({
      code: "CODEX_STRUCTURED_OUTPUT_INVALID",
      message: "bad reviewer shape",
    });
    const runStructured = vi.fn(() => Effect.fail(invalid));
    const layer = Layer.succeed(CodexRuntimeService, {
      runStructured,
    } as unknown as CodexRuntimeService);

    const result = await Effect.runPromise(
      Effect.either(
        CatalogOptimizationSkill.runReviewer(input, "counterexample_hunter").pipe(
          Effect.provide(layer),
        ),
      ),
    );

    expect(result._tag).toBe("Left");
    expect(runStructured).toHaveBeenCalledTimes(1);
    expect(runStructured.mock.calls[0]?.[0].prompt).toContain("counterexample_hunter");
    expect(CatalogOptimizationSkill.personas.high_reasoning_chair.reasoningEffort).toBe("xhigh");
  });
});
