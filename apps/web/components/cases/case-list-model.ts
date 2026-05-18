import type { DocumentCase } from "@/lib/api";

export type CasesStatusFilter = "queued" | "needs_input" | "running" | "failed" | "done" | "open";

export interface CaseListMetrics {
  needsInputCount: number;
  queuedCount: number;
  firstNeedsInputCase: DocumentCase | undefined;
}

export interface CaseListItemModel {
  caseRecord: DocumentCase;
  openQuestions: number;
  href: string;
}

export const parseCasesStatusFilter = (statusParam: string | null): CasesStatusFilter => {
  if (
    statusParam === "queued" ||
    statusParam === "needs_input" ||
    statusParam === "running" ||
    statusParam === "failed" ||
    statusParam === "done" ||
    statusParam === "open"
  ) {
    return statusParam;
  }

  return "open";
};

export const getCaseListMetrics = (cases: DocumentCase[]): CaseListMetrics => ({
  needsInputCount: cases.filter((item) => item.automationStatus === "needs_input").length,
  queuedCount: cases.filter((item) => item.automationStatus === "queued").length,
  firstNeedsInputCase: cases.find((item) =>
    item.questions.some((question) => question.status === "open"),
  ),
});

export const getCaseListItemModel = (caseRecord: DocumentCase): CaseListItemModel => {
  const openQuestions = caseRecord.questions.filter((question) => question.status === "open").length;

  return {
    caseRecord,
    openQuestions,
    href:
      openQuestions > 0
        ? `/documents/${caseRecord.docId}?review=1#case`
        : `/documents/${caseRecord.docId}`,
  };
};
