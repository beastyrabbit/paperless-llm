import type { DB } from "../db/db.js";
import type { Alias, EntityKind } from "../db/store.js";
import type { Entity } from "../paperless/client.js";

export const NONE = "__NONE_APPLIES__";
export const UNRESOLVED = "__UNRESOLVED__";
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\b(gmbh|ag|ug|e\.?\s?v\.?|kg|mbh|co)\b/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}
export function trigrams(value: string): Set<string> {
  const text = `  ${normalize(value)}  `;
  return new Set(
    Array.from({ length: Math.max(0, text.length - 2) }, (_, i) => text.slice(i, i + 3)),
  );
}
export function similarity(a: string, b: string) {
  const x = trigrams(a),
    y = trigrams(b);
  const intersection = [...x].filter((value) => y.has(value)).length;
  return (2 * intersection) / Math.max(1, x.size + y.size);
}
const ibanLengths: Record<string, number> = {
  DE: 22,
  AT: 20,
  CH: 21,
  FR: 27,
  NL: 18,
  GB: 22,
  BE: 16,
  ES: 24,
  IT: 27,
  PT: 25,
  LU: 20,
  IE: 22,
  DK: 18,
  FI: 18,
  SE: 24,
  NO: 15,
  PL: 28,
  CZ: 24,
  SK: 24,
  HU: 28,
  RO: 24,
  BG: 22,
  HR: 21,
  SI: 19,
  EE: 20,
  LV: 21,
  LT: 20,
  GR: 27,
  CY: 28,
  MT: 31,
  IS: 26,
  LI: 21,
  TR: 26,
  UA: 29,
  AE: 23,
  SA: 24,
};
function validIban(value: string): boolean {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(value)) return false;
  let remainder = 0;
  for (const char of value.slice(4) + value.slice(0, 4)) {
    for (const digit of /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char)
      remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
function ibans(text: string): string[] {
  const found = new Set<string>();
  const upper = text.toUpperCase();
  for (const match of upper.matchAll(/\b[A-Z]{2}\s?\d{2}/g)) {
    const tail = upper.slice(match.index);
    const length = ibanLengths[tail.slice(0, 2)];
    let candidate = "";
    for (let index = 0; index < tail.length && candidate.length < (length ?? 34); index++) {
      const char = tail[index] ?? "";
      if (/\s/.test(char)) {
        if (/^\s+BIC\b/.test(tail.slice(index))) break;
        if (!length && candidate.length >= 15 && validIban(candidate)) break;
        continue;
      }
      if (!/[A-Z0-9]/.test(char)) break;
      candidate += char;
      if (candidate.length === length && /[A-Z0-9]/.test(tail[index + 1] ?? "")) {
        candidate = "";
        break;
      }
    }
    if ((!length || candidate.length === length) && validIban(candidate))
      found.add(candidate.toLowerCase());
  }
  return [...found];
}
const containsWords = (text: string, alias: string) =>
  Boolean(alias) && ` ${text} `.includes(` ${alias} `);
export function exactKeys(text: string) {
  return {
    iban: ibans(text),
    vat: (text.match(/\b[A-Z]{2}\s?\d{8,12}\b/g) ?? []).map((key) =>
      key.replace(/\s/g, "").toLowerCase(),
    ),
    domain: [...text.matchAll(/[\w.+-]+@([\w.-]+\.[a-z]{2,})/gi)].map((match) =>
      (match[1] ?? "").toLowerCase(),
    ),
  };
}
export function shortlist(db: DB, text: string, entities: Entity[], kind: EntityKind, limit = 50) {
  if (limit < 1 || limit > 253) throw new Error("Shortlist limit must be 1..253");
  const aliases = db.prepare("SELECT * FROM aliases WHERE entity_kind=?").all(kind) as Alias[];
  const keys = exactKeys(text);
  const normalized = normalize(text);
  const tokens = new Set(normalized.split(" "));
  const windows = text.split(/[\n.!?]/).filter(Boolean);
  const ranked = entities
    .map((entity) => {
      const names = [
        entity.name,
        ...aliases
          .filter((alias) => alias.canonical_id === entity.id && alias.key_kind === "name")
          .map((alias) => alias.alias_text),
      ];
      const exact = aliases.some(
        (alias) =>
          alias.canonical_id === entity.id &&
          (alias.key_kind === "name"
            ? containsWords(normalized, alias.normalized_alias)
            : alias.key_kind === "iban" || alias.key_kind === "vat" || alias.key_kind === "domain"
              ? keys[alias.key_kind].includes(
                  alias.normalized_alias.toLowerCase().replace(/\s/g, ""),
                )
              : false),
      );
      const lexical = Math.max(
        ...names.map((name) => {
          const words = normalize(name).split(" ");
          const overlap =
            words.filter((word) => tokens.has(word)).length / Math.max(words.length, 1);
          return (
            (containsWords(normalized, normalize(name)) ? 2 : overlap) +
            Math.max(0, ...windows.map((window) => similarity(name, window)))
          );
        }),
      );
      return { entity, score: (exact ? 100 : 0) + lexical };
    })
    .sort((a, b) => b.score - a.score || a.entity.id - b.entity.id)
    .slice(0, limit);
  return {
    entities: ranked.map(({ entity }) => entity),
    criteria: Object.fromEntries([
      ...ranked.map(({ entity }) => [String(entity.id), entity.name]),
      [NONE, "None of the listed entities applies"],
      [UNRESOLVED, "Insufficient evidence or ambiguous"],
    ]) as Record<string, string>,
  };
}
