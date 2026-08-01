import type { CatalogEvidenceSignal } from "./types.js";

const LEGAL_SUFFIXES = new Set([
  "ag",
  "eg",
  "ev",
  "e.v",
  "gbr",
  "gmbh",
  "inc",
  "kg",
  "llc",
  "ltd",
  "mbh",
  "plc",
  "sarl",
]);

const CONCEPTS = new Map<string, string>([
  ["bill", "invoice"],
  ["beleg", "receipt"],
  ["facture", "invoice"],
  ["invoice", "invoice"],
  ["quittung", "receipt"],
  ["receipt", "receipt"],
  ["rechnung", "invoice"],
  ["contract", "contract"],
  ["vertrag", "contract"],
  ["policy", "contract"],
  ["versicherung", "insurance"],
  ["insurance", "insurance"],
  ["payment", "payment"],
  ["zahlung", "payment"],
  ["mahnung", "reminder"],
  ["reminder", "reminder"],
  ["statement", "statement"],
  ["kontoauszug", "statement"],
]);

const normalizeSeparators = (value: string) =>
  value
    .replaceAll("&", " and ")
    .replaceAll("+", " and ")
    .replaceAll("@", " at ")
    .replace(/[/_.-]+/g, " ");

export const normalizeCatalogName = (value: string): string =>
  normalizeSeparators(value)
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const nameTokens = (value: string): readonly string[] =>
  normalizeCatalogName(value)
    .split(" ")
    .filter((token) => token.length > 0 && !LEGAL_SUFFIXES.has(token));

export const conceptTokens = (value: string): readonly string[] =>
  nameTokens(value).map((token) => CONCEPTS.get(token) ?? token);

export const acronym = (value: string): string =>
  nameTokens(value)
    .filter((token) => token.length > 1)
    .map((token) => token[0])
    .join("");

export const tokenJaccard = (
  leftTokens: readonly string[],
  rightTokens: readonly string[],
): number => {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
};

export const levenshtein = (left: string, right: string): number => {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
};

export const nameSignals = (
  leftName: string,
  rightName: string,
): readonly CatalogEvidenceSignal[] => {
  const signals: CatalogEvidenceSignal[] = [];
  const left = normalizeCatalogName(leftName);
  const right = normalizeCatalogName(rightName);
  if (left.length > 0 && left === right) signals.push("normalized_name");

  const distance = levenshtein(left, right);
  const maxLength = Math.max(left.length, right.length);
  if (maxLength >= 5 && distance <= Math.max(2, Math.floor(maxLength * 0.18))) {
    signals.push("spelling_variant");
  }

  if (tokenJaccard(conceptTokens(leftName), conceptTokens(rightName)) >= 0.5) {
    signals.push("language_variant");
  }

  const leftAcronym = acronym(leftName);
  const rightAcronym = acronym(rightName);
  const compactLeft = left.replaceAll(" ", "");
  const compactRight = right.replaceAll(" ", "");
  if (
    leftAcronym.length >= 2 &&
    (leftAcronym === compactRight || rightAcronym === compactLeft || leftAcronym === rightAcronym)
  ) {
    signals.push("acronym");
  }

  return [...new Set(signals)];
};
