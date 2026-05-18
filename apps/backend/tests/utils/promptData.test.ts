import { describe, expect, it } from "vitest";
import {
  computeContentExcerptCharBudget,
  formatBudgetedUntrustedDocumentText,
  UNTRUSTED_DOCUMENT_DATA_END,
  UNTRUSTED_DOCUMENT_DATA_START,
} from "../../src/utils/promptData.js";

describe("prompt content budgeting", () => {
  it("shrinks the excerpt budget as static prompt content grows", () => {
    const smallStaticBudget = computeContentExcerptCharBudget({
      contextWindowTokens: 2_000,
      reservedOutputTokens: 200,
      safetyMarginTokens: 100,
      staticPromptText: "short prompt",
      maxExcerptChars: 4_000,
    });
    const largeStaticBudget = computeContentExcerptCharBudget({
      contextWindowTokens: 2_000,
      reservedOutputTokens: 200,
      safetyMarginTokens: 100,
      staticPromptText: "large prompt ".repeat(1_000),
      maxExcerptChars: 4_000,
    });

    expect(largeStaticBudget).toBeLessThan(smallStaticBudget);
  });

  it("clamps to the maximum when context has room", () => {
    expect(
      computeContentExcerptCharBudget({
        contextWindowTokens: 32_000,
        reservedOutputTokens: 700,
        staticPromptText: "short prompt",
        maxExcerptChars: 4_000,
      }),
    ).toBe(4_000);
  });

  it("does not return a negative budget when static prompt exceeds context", () => {
    expect(
      computeContentExcerptCharBudget({
        contextWindowTokens: 100,
        reservedOutputTokens: 100,
        staticPromptText: "oversized prompt".repeat(1_000),
        maxExcerptChars: 4_000,
      }),
    ).toBe(0);
  });

  it("preserves untrusted-data delimiters when formatting budgeted text", () => {
    const wrapped = formatBudgetedUntrustedDocumentText("abcdef", {
      contextWindowTokens: 100,
      reservedOutputTokens: 100,
      staticPromptText: "oversized prompt".repeat(1_000),
      maxExcerptChars: 4_000,
    });

    expect(wrapped).toContain(UNTRUSTED_DOCUMENT_DATA_START);
    expect(wrapped).not.toContain("abcdef");
    expect(wrapped).toContain(UNTRUSTED_DOCUMENT_DATA_END);
  });
});
