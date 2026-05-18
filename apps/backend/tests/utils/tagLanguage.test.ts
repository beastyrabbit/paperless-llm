import { describe, expect, it } from "vitest";
import {
  buildPromptLanguageInstruction,
  localizeGeneratedTagName,
  normalizeAliasKey,
  parseTagLanguageAliasRows,
  serializeTagLanguageAliasRows,
} from "../../src/utils/tagLanguage.js";

describe("tagLanguage", () => {
  it("preserves default German alias behavior", () => {
    expect(localizeGeneratedTagName("invoice", "de")).toBe("Rechnung");
    expect(localizeGeneratedTagName("invoice", "en")).toBe("invoice");
  });

  it("uses custom alias rows", () => {
    const rows = [{ source: "invoice", target: "Faktura" }, { source: "school", target: "Schule" }];
    expect(localizeGeneratedTagName("invoice", "de", rows)).toBe("Faktura");
    expect(localizeGeneratedTagName("school", "de", rows)).toBe("Schule");
  });

  it("normalizes aliases consistently", () => {
    expect(normalizeAliasKey("  É-Commerce__Invoice  ")).toBe("e commerce invoice");
    const rows = parseTagLanguageAliasRows(JSON.stringify([{ source: " Pet-Supplies ", target: " Tierbedarf " }]));
    expect(localizeGeneratedTagName("pet supplies", "de", rows)).toBe("Tierbedarf");
  });

  it("ignores invalid rows and falls back on malformed JSON", () => {
    expect(parseTagLanguageAliasRows("not json").some((row) => row.source === "invoice")).toBe(true);
    expect(serializeTagLanguageAliasRows([{ source: "", target: "x" }, { source: "a", target: "b" }])).toBe(
      JSON.stringify([{ source: "a", target: "b" }]),
    );
  });

  it("includes editable aliases in German prompt guidance", () => {
    const instruction = buildPromptLanguageInstruction("de", [{ source: "invoice", target: "Faktura" }]);
    expect(instruction).toContain("invoice -> Faktura");
  });
});
