import { describe, expect, it } from "vitest";
import {
  buildConsolidationAgentFewShotExamples,
  buildConsolidationAgentPrompt,
  type CatalogSnapshot,
} from "../../src/agents/PiConsolidationAgent.js";
import {
  UNTRUSTED_DOCUMENT_DATA_END,
  UNTRUSTED_DOCUMENT_DATA_START,
} from "../../src/utils/promptData.js";

describe("consolidation agent few-shot examples", () => {
  it("keeps review-only proposal examples compact", () => {
    const examples = buildConsolidationAgentFewShotExamples();
    const serialized = JSON.stringify(examples);

    expect(serialized.length).toBeLessThanOrEqual(1_500);
    expect(serialized).toContain("finish_consolidation_report");
    expect(serialized).toContain("merge");
    expect(serialized).toContain("rename");
    expect(serialized).toContain("needs_review");
    expect(serialized).toContain("Synthetic IDs");
    expect(serialized).not.toContain("llm-processing");
  });

  it("includes examples in JSON prompt before delimited untrusted catalog payload", () => {
    const snapshot: CatalogSnapshot = {
      tags: [{ id: 12, name: "Versicherung", document_count: 9 }],
      correspondents: [{ id: 31, name: "TK Krankenkasse", document_count: 14 }],
      documentTypes: [{ id: 7, name: "Bescheid", document_count: 4 }],
      customFields: [],
      candidateProposals: [],
    };

    const prompt = buildConsolidationAgentPrompt(snapshot);
    const parsed = JSON.parse(prompt);

    expect(parsed.few_shot_examples).toHaveLength(3);
    expect(parsed.required_final_tool).toBe("finish_consolidation_report");
    expect(parsed.instructions.join("\n")).toContain("Never apply catalog changes");
    expect(prompt.indexOf("few_shot_examples")).toBeLessThan(
      prompt.indexOf("untrusted_catalog_payload"),
    );
    expect(parsed.untrusted_catalog_payload).toContain(UNTRUSTED_DOCUMENT_DATA_START);
    expect(parsed.untrusted_catalog_payload).toContain(UNTRUSTED_DOCUMENT_DATA_END);
  });
});
