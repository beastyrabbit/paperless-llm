export interface TagLanguageAliasRow {
  source: string;
  target: string;
}

export const normalizeAliasKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const normalizeAliasValue = (value: unknown): string =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export const DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE: TagLanguageAliasRow[] = [
  { source: "agriculture", target: "Landwirtschaft" },
  { source: "animal", target: "Tier" },
  { source: "animals", target: "Tier" },
  { source: "banking", target: "Bank" },
  { source: "code review", target: "Codeprüfung" },
  { source: "confirmation", target: "Bestätigung" },
  { source: "contract", target: "Vertrag" },
  { source: "developer", target: "Entwicklung" },
  { source: "development", target: "Entwicklung" },
  { source: "e commerce", target: "Onlinehandel" },
  { source: "e-commerce", target: "Onlinehandel" },
  { source: "finance", target: "Finanzen" },
  { source: "health", target: "Gesundheit" },
  { source: "insurance", target: "Versicherung" },
  { source: "invoice", target: "Rechnung" },
  { source: "invoices", target: "Rechnungen" },
  { source: "lease", target: "Pacht" },
  { source: "logistics", target: "Logistik" },
  { source: "order", target: "Bestellung" },
  { source: "order confirmation", target: "Bestellbestätigung" },
  { source: "payment", target: "Zahlung" },
  { source: "payments", target: "Zahlungen" },
  { source: "pet", target: "Haustier" },
  { source: "pets", target: "Haustier" },
  { source: "pet supplies", target: "Tierbedarf" },
  { source: "receipt", target: "Beleg" },
  { source: "receipts", target: "Belege" },
  { source: "rent", target: "Miete" },
  { source: "rental", target: "Miete" },
  { source: "return", target: "Retoure" },
  { source: "returns", target: "Retouren" },
  { source: "shipping", target: "Versand" },
  { source: "shipment", target: "Versand" },
  { source: "shopping", target: "Einkauf" },
  { source: "subscription", target: "Abonnement" },
  { source: "tax", target: "Steuer" },
  { source: "travel", target: "Reise" },
  { source: "utilities", target: "Versorger" },
  { source: "viticulture", target: "Weinbau" },
];

export const normalizeTagLanguageAliasRows = (
  rows: readonly unknown[],
): TagLanguageAliasRow[] => {
  const bySource = new Map<string, TagLanguageAliasRow>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const source = normalizeAliasValue(record.source);
    const target = normalizeAliasValue(record.target);
    if (!source || !target) continue;
    bySource.set(normalizeAliasKey(source), { source, target });
  }
  return [...bySource.values()];
};

export const parseTagLanguageAliasRows = (
  value: unknown,
  fallbackRows: readonly TagLanguageAliasRow[] = DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
): TagLanguageAliasRow[] => {
  const fallback = normalizeTagLanguageAliasRows(fallbackRows);
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" ? safeParseJson(value) : value;
  if (!Array.isArray(parsed)) return fallback;
  const normalized = normalizeTagLanguageAliasRows(parsed);
  return normalized.length > 0 ? normalized : fallback;
};

const safeParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export const serializeTagLanguageAliasRows = (rows: readonly unknown[]): string =>
  JSON.stringify(normalizeTagLanguageAliasRows(rows));

export const getDefaultTagLanguageAliasesDeJson = (): string =>
  serializeTagLanguageAliasRows(DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE);

export const buildTagLanguageAliasMap = (
  rows: readonly TagLanguageAliasRow[] = DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
): Map<string, string> =>
  new Map(normalizeTagLanguageAliasRows(rows).map((row) => [normalizeAliasKey(row.source), row.target]));

export const normalizePromptLanguage = (value: unknown, fallback = "en"): string => {
  const raw =
    typeof value === "string" && value.trim().length > 0
      ? value.trim().toLowerCase()
      : fallback.trim().toLowerCase();
  if (raw.startsWith("de")) return "de";
  if (raw.startsWith("en")) return "en";
  return raw || "en";
};

export const isGermanPromptLanguage = (value: unknown): boolean =>
  normalizePromptLanguage(value).startsWith("de");

export const localizeGeneratedTagName = (
  name: string,
  promptLanguage: unknown,
  aliasRows: readonly TagLanguageAliasRow[] = DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
): string => {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || !isGermanPromptLanguage(promptLanguage)) return trimmed;
  return buildTagLanguageAliasMap(aliasRows).get(normalizeAliasKey(trimmed)) ?? trimmed;
};

export const localizeGeneratedTagNames = (
  names: string[],
  promptLanguage: unknown,
  aliasRows: readonly TagLanguageAliasRow[] = DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
): string[] => {
  const localized = names.map((name) => localizeGeneratedTagName(name, promptLanguage, aliasRows));
  return [...new Set(localized.filter((name) => name.length > 0))];
};

export const localizeGeneratedTagQuestion = (
  question: string,
  originalSuggestion: string,
  localizedSuggestion: string,
  promptLanguage: unknown,
): string => {
  if (!isGermanPromptLanguage(promptLanguage) || originalSuggestion === localizedSuggestion) {
    return question;
  }
  if (originalSuggestion && question.includes(originalSuggestion)) {
    return question.replaceAll(originalSuggestion, localizedSuggestion);
  }
  return `Tag "${localizedSuggestion}" erstellen oder einem bestehenden Tag zuordnen?`;
};

export const buildPromptLanguageInstruction = (
  promptLanguage: unknown,
  aliasRows: readonly TagLanguageAliasRow[] = DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
): string => {
  if (isGermanPromptLanguage(promptLanguage)) {
    const rows = normalizeTagLanguageAliasRows(aliasRows);
    const aliasExamples = rows
      .slice(0, 24)
      .map((row) => `${row.source} -> ${row.target}`)
      .join("; ");
    const avoidList = rows
      .map((row) => row.source)
      .filter((source) => /^[a-z0-9][a-z0-9 -]*$/i.test(source))
      .slice(0, 24)
      .join(", ");
    return [
      "Use German for generated titles, summaries, questions, reasoning, and newly proposed catalog names.",
      "For tags, propose German nouns or established proper names already used by the archive.",
      "Keep brands, vendors, product names, and official program names unchanged.",
      aliasExamples
        ? `Use these editable tag-language aliases when a generated generic English tag appears: ${aliasExamples}.`
        : "Translate generic English tag ideas into suitable German tags.",
      avoidList
        ? `Do not propose generic English tags such as ${avoidList}.`
        : "Do not propose generic English tags when a German equivalent is available.",
      "If an equivalent German tag already exists, prefer that existing German tag over a new English tag.",
    ].join("\n");
  }
  return "Use English for generated titles, summaries, questions, reasoning, and newly proposed catalog names unless the document itself requires an official name in another language.";
};
