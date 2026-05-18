import { describe, expect, it } from "vitest";
import type { DocumentCase } from "@/lib/api";
import {
  getCaseListItemModel,
  getCaseListMetrics,
  parseCasesStatusFilter,
} from "@/components/cases/case-list-model";

describe("case-list-model", () => {
  const createCase = (
    overrides: Partial<DocumentCase> & Pick<DocumentCase, "id" | "docId">,
  ): DocumentCase => ({
    id: overrides.id,
    docId: overrides.docId,
    docTitle: overrides.docTitle ?? `Document ${overrides.docId}`,
    phase: overrides.phase ?? "metadata",
    automationStatus: overrides.automationStatus ?? "idle",
    activeRunId: null,
    lastRunId: null,
    lastFailure: null,
    questions: overrides.questions ?? [],
    answers: overrides.answers ?? [],
    finalDecisions: {},
    runSummaries: [],
    memory: {},
    transcript: overrides.transcript ?? [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  });

  it("parses supported case status filters and defaults unknown values to open", () => {
    expect(parseCasesStatusFilter("needs_input")).toBe("needs_input");
    expect(parseCasesStatusFilter("queued")).toBe("queued");
    expect(parseCasesStatusFilter("invalid")).toBe("open");
    expect(parseCasesStatusFilter(null)).toBe("open");
  });

  it("builds untranslated case list metrics from raw cases", () => {
    const cases = [
      createCase({ id: "queued", docId: 1, automationStatus: "queued" }),
      createCase({
        id: "needs-input",
        docId: 2,
        automationStatus: "needs_input",
        questions: [{ status: "open" } as DocumentCase["questions"][number]],
      }),
    ];

    expect(getCaseListMetrics(cases)).toMatchObject({
      needsInputCount: 1,
      queuedCount: 1,
      firstNeedsInputCase: cases[1],
    });
  });

  it("builds per-row navigation state without localized labels", () => {
    const caseRecord = createCase({
      id: "case",
      docId: 42,
      questions: [
        { status: "open" } as DocumentCase["questions"][number],
        { status: "answered" } as DocumentCase["questions"][number],
      ],
    });

    expect(getCaseListItemModel(caseRecord)).toMatchObject({
      caseRecord,
      openQuestions: 1,
      href: "/documents/42?review=1#case",
    });
  });
});
