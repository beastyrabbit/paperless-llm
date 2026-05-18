import { describe, expect, it } from "vitest";
import {
  getDocumentTagNames,
  getProcessingStateFromTagNames,
  getWorkflowTagForState,
  getWorkflowTagNames,
  isConfiguredWorkflowTagName,
  isWorkflowTagName,
  normalizeWorkflowTagName,
  type WorkflowTagsConfig,
} from "../../src/utils/tagState.js";

const tagConfig: WorkflowTagsConfig = {
  todo: "llm-todo",
  pending: "llm-pending",
  ocr: "llm-ocr",
  ocrDone: "llm-ocr-done",
  metadata: "llm-metadata",
  summaryDone: "llm-summary-done",
  titleDone: "llm-title-done",
  correspondentDone: "llm-correspondent-done",
  documentTypeDone: "llm-document-type-done",
  review: "llm-review",
  manualReview: "llm-manual-review",
  schemaReview: "llm-schema-review",
  index: "llm-index",
  tagsDone: "llm-tags-done",
  done: "llm-done",
  processed: "llm-processed",
  failed: "llm-failed",
};

describe("tagState", () => {
  it("preserves processing state priority", () => {
    expect(getProcessingStateFromTagNames(["llm-done", "llm-review", "llm-failed"], tagConfig)).toBe(
      "failed",
    );
    expect(getProcessingStateFromTagNames(["llm-processed", "llm-review"], tagConfig)).toBe("done");
    expect(getProcessingStateFromTagNames(["llm-schema-review", "llm-index"], tagConfig)).toBe(
      "review",
    );
    expect(getProcessingStateFromTagNames(["llm-tags-done", "llm-metadata"], tagConfig)).toBe(
      "index",
    );
    expect(getProcessingStateFromTagNames(["llm-title-done", "llm-ocr"], tagConfig)).toBe(
      "metadata",
    );
    expect(getProcessingStateFromTagNames(["llm-ocr-done", "llm-todo"], tagConfig)).toBe("ocr");
    expect(getProcessingStateFromTagNames(["llm-pending"], tagConfig)).toBe("todo");
    expect(getProcessingStateFromTagNames(["unknown"], tagConfig)).toBe("todo");
  });

  it("maps coarse ocr/metadata/index configuration to metadata", () => {
    const coarseConfig = { ...tagConfig, ocr: "llm-active", metadata: "llm-active", index: "llm-active" };

    expect(getProcessingStateFromTagNames(["llm-active"], coarseConfig)).toBe("metadata");
  });

  it("prefers document tag_names and otherwise resolves IDs through a tag map", () => {
    const tagMap = new Map([
      [1, "from-id"],
      [2, "other"],
    ]);

    expect(getDocumentTagNames({ tags: [1], tag_names: ["from-name"] }, tagMap)).toEqual([
      "from-name",
    ]);
    expect(getDocumentTagNames({ tags: [1, 3, 2] }, tagMap)).toEqual(["from-id", "other"]);
  });

  it("normalizes workflow tag helpers and treats llm-prefixed tags as workflow tags", () => {
    const workflowTagNames = getWorkflowTagNames({ todo: " LLM-Todo ", empty: "  ", other: 5 });

    expect(normalizeWorkflowTagName(" LLM-Todo ")).toBe("llm-todo");
    expect(workflowTagNames).toEqual(new Set(["llm-todo"]));
    expect(isWorkflowTagName(" llm-generated ", workflowTagNames)).toBe(true);
    expect(isWorkflowTagName("LLM-TODO", workflowTagNames)).toBe(true);
    expect(isWorkflowTagName("other", workflowTagNames)).toBe(false);
    expect(isConfiguredWorkflowTagName(" llm-generated ", workflowTagNames)).toBe(false);
    expect(isConfiguredWorkflowTagName("LLM-TODO", workflowTagNames)).toBe(true);
  });

  it("returns configured workflow tag for a processing state", () => {
    expect(getWorkflowTagForState("metadata", tagConfig)).toBe("llm-metadata");
    expect(getWorkflowTagForState("done", {})).toBeNull();
  });
});
