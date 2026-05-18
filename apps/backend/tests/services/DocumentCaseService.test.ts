/**
 * Document case service tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DocumentCaseService,
  DocumentCaseServiceLive,
  PaperlessService,
  TinyBaseService,
  TinyBaseServiceLive,
} from "../../src/services/index.js";

const createDocument = (docId: number) => ({
  id: docId,
  title: `Document ${docId}`,
  content: "Document content",
  correspondent: null,
  document_type: null,
  tags: [] as number[],
  tag_names: [] as string[],
  created: "2026-05-13T10:00:00Z",
  modified: "2026-05-13T10:00:00Z",
  added: "2026-05-13T10:00:00Z",
  archive_serial_number: null,
  original_file_name: `${docId}.pdf`,
  archived_file_name: `${docId}.pdf`,
});

const createPaperlessLayer = () => {
  const docs = new Map<number, ReturnType<typeof createDocument>>();
  const tags = [
    { id: 7, name: "Finance", slug: "finance", document_count: 2 },
    { id: 8, name: "Insurance", slug: "insurance", document_count: 4 },
  ];
  const correspondents = [{ id: 11, name: "Techniker Krankenkasse", slug: "tk" }];
  const documentTypes = [{ id: 21, name: "Brief", slug: "brief" }];
  const getDoc = (docId: number) => {
    const existing = docs.get(docId);
    if (existing) return existing;
    const created = createDocument(docId);
    docs.set(docId, created);
    return created;
  };

  return Layer.succeed(PaperlessService, {
    getDocument: vi.fn((docId: number) => Effect.succeed(getDoc(docId))),
    updateDocument: vi.fn((docId: number, updates: Record<string, unknown>) => {
      const doc = getDoc(docId);
      Object.assign(doc, updates);
      return Effect.succeed(doc);
    }),
    getTags: vi.fn(() => Effect.succeed(tags)),
    getOrCreateTag: vi.fn((name: string) => {
      const existing = tags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
      if (existing) return Effect.succeed(existing.id);
      const created = {
        id: 100 + tags.length,
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
      };
      tags.push(created);
      return Effect.succeed(created.id);
    }),
    getCorrespondents: vi.fn(() => Effect.succeed(correspondents)),
    getOrCreateCorrespondent: vi.fn((name: string) => {
      const existing = correspondents.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return Effect.succeed(existing.id);
      const created = { id: 100 + correspondents.length, name, slug: name.toLowerCase() };
      correspondents.push(created);
      return Effect.succeed(created.id);
    }),
    getDocumentTypes: vi.fn(() => Effect.succeed(documentTypes)),
    getOrCreateDocumentType: vi.fn((name: string) => {
      const existing = documentTypes.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) return Effect.succeed(existing.id);
      const created = { id: 100 + documentTypes.length, name, slug: name.toLowerCase() };
      documentTypes.push(created);
      return Effect.succeed(created.id);
    }),
  } as unknown as PaperlessService);
};

describe("DocumentCaseService", () => {
  const TestLayer = Layer.provideMerge(
    DocumentCaseServiceLive,
    Layer.mergeAll(TinyBaseServiceLive, createPaperlessLayer()),
  );
  let testDataDir: string | null = null;

  const runEffect = <A, E>(
    effect: Effect.Effect<A, E, DocumentCaseService | TinyBaseService | PaperlessService>,
  ) => Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "document-case-service-test-"));
    process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"] = testDataDir;
    process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"] = "true";
  });

  afterEach(() => {
    delete process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"];
    delete process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"];
    if (testDataDir) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
      testDataDir = null;
    }
  });

  it("removes legacy pending-backed questions instead of migrating them", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const tinybase = yield* TinyBaseService;
        const cases = yield* DocumentCaseService;
        const pendingId = yield* tinybase.addPendingReview({
          docId: 123,
          docTitle: "Document 123",
          type: "tag",
          suggestion: "Finance",
          reasoning: "Suggested from document text",
          alternatives: ["Invoices"],
          attempts: 1,
          lastFeedback: null,
          nextTag: "ai-needs-input",
          metadata: JSON.stringify({ source: "test" }),
        });
        const caseRecord = yield* cases.getOrCreateCaseForDocument(123);
        return { pendingId, caseRecord };
      }),
    );

    expect(result.caseRecord.id).toBe("doc-123");
    expect(result.pendingId).toBeTruthy();
    expect(result.caseRecord.automationStatus).toBe("idle");
    expect(result.caseRecord.questions).toHaveLength(0);
  });

  it("does not list document pending reviews as case questions", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const tinybase = yield* TinyBaseService;
        const cases = yield* DocumentCaseService;
        yield* tinybase.addPendingReview({
          docId: 222,
          docTitle: "Migrated From Pending",
          type: "document_type",
          suggestion: "Invoice",
          reasoning: "Needs type review",
          alternatives: [],
          attempts: 1,
          lastFeedback: null,
          nextTag: "ai-needs-input",
          metadata: null,
        });
        const listed = yield* cases.listCases({ status: "needs_input" });
        return { listed };
      }),
    );

    expect(result.listed.some((caseRecord) => caseRecord.docId === 222)).toBe(false);
  });

  it("creates structured metadata proposal questions", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const question = yield* cases.addQuestion({
          docId: 741,
          entityKind: "tag",
          candidate: { id: null, name: "Freischaltcode", exists: false },
          alternatives: [{ id: 8, name: "Insurance", exists: true }],
          requestedAction: "create",
          evidence: "Document contains an activation-code letter from TK.",
          source: "document_agent",
        });
        const caseRecord = yield* cases.getOrCreateCaseForDocument(741);
        return { question, caseRecord };
      }),
    );

    expect(result.question).toMatchObject({
      kind: "metadata_proposal",
      entityKind: "tag",
      candidate: { name: "Freischaltcode", exists: false },
      requestedAction: "create",
    });
    expect(result.caseRecord.automationStatus).toBe("needs_input");
    expect(result.caseRecord.questions[0]).toMatchObject({
      entityKind: "tag",
      candidate: { name: "Freischaltcode" },
    });
  });

  it("persists structured last failure details on cases", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const caseRecord = yield* cases.getOrCreateCaseForDocument(740);
        const failed = yield* cases.updateCase(caseRecord.id, {
          phase: "failed",
          automationStatus: "failed",
          lastFailure: {
            message: "Request to http://ollama.test/api/chat timed out after 1000ms",
            kind: "timeout",
            step: "metadata",
            retryable: true,
            runId: "run-timeout",
            failedAt: "2026-05-14T10:00:00.000Z",
          },
        });
        const reloaded = yield* cases.getCase(caseRecord.id);
        return { failed, reloaded };
      }),
    );

    expect(result.failed.lastFailure).toMatchObject({
      kind: "timeout",
      step: "metadata",
      retryable: true,
      runId: "run-timeout",
    });
    expect(result.reloaded?.lastFailure).toMatchObject({
      message: expect.stringContaining("timed out"),
      kind: "timeout",
    });
  });

  it("answers a proposal, applies the candidate, and stores guidance", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const tinybase = yield* TinyBaseService;
        const cases = yield* DocumentCaseService;
        const question = yield* cases.addQuestion({
          docId: 124,
          entityKind: "tag",
          candidate: { id: 7, name: "Finance", exists: true },
          requestedAction: "map",
          evidence: "Agent found an existing broad tag.",
        });
        const answeredCase = yield* cases.answerQuestion(question.id, {
          answer: "apply",
          guidance: "Prefer broader tags for vendor documents.",
        });
        const memory = yield* tinybase.getDocumentMemory(124);
        const paperless = yield* PaperlessService;
        const doc = yield* paperless.getDocument(124);
        return { answeredCase, memory, doc };
      }),
    );

    expect(result.doc.tags).toContain(7);
    expect(result.answeredCase.automationStatus).toBe("ready");
    expect(result.answeredCase.questions[0]).toMatchObject({ status: "answered" });
    expect(result.answeredCase.transcript).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "apply: Prefer broader tags for vendor documents.",
        }),
      ]),
    );
    expect(result.answeredCase.memory.guidance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          answer: "apply",
          guidance: "Prefer broader tags for vendor documents.",
        }),
      ]),
    );
    expect(result.memory?.humanDecisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          answer: "map",
          feedback: "Prefer broader tags for vendor documents.",
        }),
      ]),
    );
    expect(result.memory?.reviewFeedback).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          feedback: "Prefer broader tags for vendor documents.",
        }),
      ]),
    );
  });

  it("applies the existing alternative for map questions instead of creating the proposed alias", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const paperless = yield* PaperlessService;
        const question = yield* cases.addQuestion({
          docId: 128,
          entityKind: "correspondent",
          candidate: { id: null, name: "TK", exists: false },
          alternatives: [{ id: 11, name: "Techniker Krankenkasse", exists: true }],
          requestedAction: "map",
          evidence: "Map correspondent alias to existing catalog entity.",
        });
        const answeredCase = yield* cases.answerQuestion(question.id, { answer: "apply" });
        const doc = yield* paperless.getDocument(128);
        return { answeredCase, doc };
      }),
    );

    expect(result.doc.correspondent).toBe(11);
    expect(result.answeredCase.answers[0]?.selectedCandidate).toEqual({
      id: 11,
      name: "Techniker Krankenkasse",
      exists: true,
    });
  });

  it("rejects malformed metadata bundles stored as tag proposals before calling Paperless", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const question = yield* cases.addQuestion({
          docId: 127,
          entityKind: "tag",
          candidate: {
            id: null,
            name: "Bitte prüfen und bestätigen Sie die Metadaten: Korrespondent: PayPal, Dokumenttyp: Rechnung, Titel: Test, Tags: Amazon.",
            exists: false,
          },
          requestedAction: "create",
          evidence: "Malformed model output.",
        });
        return yield* Effect.either(cases.answerQuestion(question.id, { answer: "apply" }));
      }),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      expect((result.left as { message?: string }).message).toContain("malformed metadata review");
    }
  });

  it("does not duplicate questions or answers for repeated requests", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const firstQuestion = yield* cases.addQuestion({
          docId: 125,
          entityKind: "tag",
          candidate: { id: null, name: "Detailed Vendor Tag", exists: false },
          source: "document_agent",
        });
        const secondQuestion = yield* cases.addQuestion({
          docId: 125,
          entityKind: "tag",
          candidate: { id: null, name: "Detailed Vendor Tag", exists: false },
          source: "document_agent",
        });
        const answered = yield* cases.answerQuestion(firstQuestion.id, {
          answer: "reject",
          guidance: "Too specific.",
        });
        const answeredAgain = yield* cases.answerQuestion(firstQuestion.id, {
          answer: "apply",
          guidance: "This should not be recorded.",
        });
        return { firstQuestion, secondQuestion, answered, answeredAgain };
      }),
    );

    expect(result.secondQuestion.id).toBe(result.firstQuestion.id);
    expect(result.answered.answers).toHaveLength(1);
    expect(result.answeredAgain.answers).toHaveLength(1);
    expect(result.answeredAgain.answers[0]).toMatchObject({
      answer: "reject",
      guidance: "Too specific.",
    });
  });

  it("creates a follow-up proposal when use_another names a missing tag", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const cases = yield* DocumentCaseService;
        const question = yield* cases.addQuestion({
          docId: 126,
          entityKind: "tag",
          candidate: { id: 7, name: "Finance", exists: true },
          source: "document_agent",
        });
        const answeredCase = yield* cases.answerQuestion(question.id, {
          answer: "use_another",
          selectedEntityName: "Freischaltcode",
          guidance: "Use the more specific review tag.",
        });
        return answeredCase;
      }),
    );

    expect(result.automationStatus).toBe("needs_input");
    expect(result.questions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "open",
          source: "user_guidance",
          candidate: expect.objectContaining({ name: "Freischaltcode", exists: false }),
        }),
      ]),
    );
  });
});
