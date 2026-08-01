import { describe, expect, it } from "vitest";
import {
  ANALYSIS_TIMELINE_STEPS,
  confidenceBand,
  confidenceTone,
  countChangedRows,
  getMetadataDiffRows,
  getRunTimeline,
  isTerminalRun,
  runOutcome,
} from "../components/workbench/analysis-model";
import {
  analysisProposal,
  documentBaseline,
  entityLabels,
} from "../components/workbench/fixtures";

const stepStatus = (steps: ReturnType<typeof getRunTimeline>, key: string) =>
  steps.find((step) => step.key === key)?.status;

describe("getRunTimeline", () => {
  it("marks earlier steps done and the current state as current (awaiting_review)", () => {
    const steps = getRunTimeline({ state: "awaiting_review", forceOcr: false });
    expect(stepStatus(steps, "queued")).toBe("done");
    expect(stepStatus(steps, "analyzing")).toBe("done");
    expect(stepStatus(steps, "awaiting_review")).toBe("current");
    expect(stepStatus(steps, "applying")).toBe("pending");
  });

  it("skips ocr_requested when OCR was not forced", () => {
    const steps = getRunTimeline({ state: "analyzing", forceOcr: false });
    expect(stepStatus(steps, "ocr_requested")).toBe("skipped");
  });

  it("keeps ocr_requested on the path when OCR is forced", () => {
    const steps = getRunTimeline({ state: "analyzing", forceOcr: true });
    expect(stepStatus(steps, "ocr_requested")).toBe("done");
  });

  it("marks every step done for a succeeded run", () => {
    const steps = getRunTimeline({ state: "succeeded", forceOcr: false });
    expect(steps.every((step) => step.status === "done" || step.status === "skipped")).toBe(true);
    expect(stepStatus(steps, "succeeded")).toBe("done");
  });

  it("anchors a failed run at the analyzing step and skips the rest", () => {
    const steps = getRunTimeline({ state: "failed", forceOcr: false });
    expect(stepStatus(steps, "analyzing")).toBe("failed");
    expect(stepStatus(steps, "awaiting_review")).toBe("skipped");
    expect(stepStatus(steps, "reading_paperless")).toBe("done");
  });

  it("returns one entry per canonical step", () => {
    const steps = getRunTimeline({ state: "queued", forceOcr: true });
    expect(steps).toHaveLength(ANALYSIS_TIMELINE_STEPS.length);
  });
});

describe("run outcome + terminal", () => {
  it("groups states into outcomes", () => {
    expect(runOutcome({ state: "analyzing" })).toBe("active");
    expect(runOutcome({ state: "awaiting_review" })).toBe("needs_review");
    expect(runOutcome({ state: "succeeded" })).toBe("succeeded");
    expect(runOutcome({ state: "failed" })).toBe("failed");
    expect(runOutcome({ state: "rejected" })).toBe("rejected");
  });

  it("detects terminal states", () => {
    expect(isTerminalRun("succeeded")).toBe(true);
    expect(isTerminalRun("failed")).toBe(true);
    expect(isTerminalRun("analyzing")).toBe(false);
  });
});

describe("confidence banding", () => {
  it("bands by threshold", () => {
    expect(confidenceBand(0.9)).toBe("high");
    expect(confidenceBand(0.7)).toBe("medium");
    expect(confidenceBand(0.4)).toBe("low");
  });

  it("maps bands to tones", () => {
    expect(confidenceTone(0.9)).toBe("success");
    expect(confidenceTone(0.7)).toBe("warn");
    expect(confidenceTone(0.4)).toBe("danger");
  });
});

describe("getMetadataDiffRows", () => {
  const rows = getMetadataDiffRows(documentBaseline, analysisProposal, entityLabels);
  const row = (key: string) => rows.find((r) => r.key === key);

  it("marks the title changed", () => {
    expect(row("title")?.kind).toBe("changed");
  });

  it("marks a newly assigned correspondent as added", () => {
    const correspondent = row("correspondent");
    expect(correspondent?.kind).toBe("added");
    expect(correspondent?.before).toHaveLength(0);
    expect(correspondent?.after[0]?.display).toBe("Stadtwerke München");
  });

  it("flags newly added tags with isNew while keeping retained tags", () => {
    const tags = row("ordinary_tags");
    expect(tags?.kind).toBe("changed");
    const newTag = tags?.after.find((value) => value.id === 11);
    const keptTag = tags?.after.find((value) => value.id === 12);
    expect(newTag?.isNew).toBe(true);
    expect(keptTag?.isNew).toBe(false);
  });

  it("diffs custom field values with per-decision confidence", () => {
    const custom = row("custom_field_7");
    expect(custom?.kind).toBe("changed");
    expect(custom?.after[0]?.display).toBe("184.20 EUR");
    expect(custom?.confidence).toBeGreaterThan(0);
  });

  it("counts every changed row", () => {
    expect(countChangedRows(rows)).toBe(5);
  });

  it("resolves unknown ids to a #id fallback", () => {
    const rowsNoLabels = getMetadataDiffRows(documentBaseline, analysisProposal, {
      tags: {},
      correspondents: {},
      documentTypes: {},
      customFields: {},
    });
    const tags = rowsNoLabels.find((r) => r.key === "ordinary_tags");
    expect(tags?.after.some((value) => value.display === "Tag #11")).toBe(true);
  });
});
