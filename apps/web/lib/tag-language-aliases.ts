export interface TagLanguageAliasRow {
  source: string;
  target: string;
}

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

export const normalizeAliasKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

export const normalizeTagLanguageAliasRows = (rows: readonly unknown[]): TagLanguageAliasRow[] => {
  const bySource = new Map<string, TagLanguageAliasRow>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    const source = typeof record.source === "string" ? record.source.trim().replace(/\s+/g, " ") : "";
    const target = typeof record.target === "string" ? record.target.trim().replace(/\s+/g, " ") : "";
    if (source && target) bySource.set(normalizeAliasKey(source), { source, target });
  }
  return [...bySource.values()];
};

export const parseTagLanguageAliasRows = (value: string): TagLanguageAliasRow[] => {
  if (!value.trim()) return DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE;
    const rows = normalizeTagLanguageAliasRows(parsed);
    return rows.length > 0 ? rows : DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE;
  } catch {
    return DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE;
  }
};

export const serializeTagLanguageAliasRows = (rows: readonly unknown[]): string =>
  JSON.stringify(normalizeTagLanguageAliasRows(rows));
