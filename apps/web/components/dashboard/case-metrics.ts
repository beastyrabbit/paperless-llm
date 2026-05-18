import type { AutoProcessingStatus, DocumentCase } from "@/lib/api";
import type { CaseMetrics, CasePhaseCounts } from "./types";

const createEmptyPhaseCounts = (): CasePhaseCounts => ({
  new: 0,
  ocr: 0,
  metadata: 0,
  index: 0,
  done: 0,
  failed: 0,
});

export const getCaseMetrics = (
  caseRecords: DocumentCase[],
  autoStatus: AutoProcessingStatus | null,
): CaseMetrics => {
  const hasOpenQuestion = (caseRecord: DocumentCase) =>
    caseRecord.questions.some((question) => question.status === "open");

  const runningCaseCount = caseRecords.filter(
    (caseRecord) => caseRecord.automationStatus === "running",
  ).length;
  const activeRuns = Math.max(
    runningCaseCount,
    autoStatus?.currently_processing_doc_id != null ? 1 : 0,
  );
  const needsInput = caseRecords.filter(
    (caseRecord) => caseRecord.automationStatus === "needs_input" || hasOpenQuestion(caseRecord),
  ).length;
  const done = caseRecords.filter(
    (caseRecord) => caseRecord.automationStatus === "done" || caseRecord.phase === "done",
  ).length;
  const failed = caseRecords.filter(
    (caseRecord) => caseRecord.automationStatus === "failed" || caseRecord.phase === "failed",
  ).length;
  const open = caseRecords.filter((caseRecord) => caseRecord.automationStatus !== "done").length;
  const ready = caseRecords.filter(
    (caseRecord) =>
      caseRecord.automationStatus === "idle" || caseRecord.automationStatus === "ready",
  ).length;
  const phaseCounts = createEmptyPhaseCounts();

  for (const caseRecord of caseRecords) {
    phaseCounts[caseRecord.phase] += 1;
  }

  return { activeRuns, needsInput, done, failed, open, ready, phaseCounts };
};
