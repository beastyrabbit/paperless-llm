import type { OpenField } from "../config/index.js";
import type { Alias } from "../db/store.js";
import type { Catalog } from "../paperless/client.js";
import { equal } from "../util.js";
import { type Candidate, type Context, entitiesOf } from "./context.js";
import type { ExtractedField } from "./layer3Extract.js";
import { normalize } from "./shortlist.js";

export const whitespace = (text: string) => text.replace(/\s+/g, " ").trim();
export function groundedRange(text: string, quote: string): { start: number; end: number } | null {
  const source = whitespace(text),
    needle = whitespace(quote);
  if (!needle) return null;
  const index = source.indexOf(needle);
  if (index === -1) return null;
  const positions: number[] = [];
  for (const token of text.matchAll(/\S+/g)) {
    if (positions.length) positions.push(token.index);
    for (let i = 0; i < token[0].length; i++) positions.push(token.index + i);
  }
  const start = positions[index] ?? 0;
  const end = positions[index + needle.length - 1] ?? start;
  return { start, end: end + 1 };
}
export function groundedWindow(text: string, quote: string): string | null {
  const range = groundedRange(text, quote);
  return range
    ? text.slice(Math.max(0, range.start - 250), Math.min(text.length, range.end + 250))
    : null;
}
export function parseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  const iso = de ? `${de[3]}-${de[2]?.padStart(2, "0")}-${de[1]?.padStart(2, "0")}` : value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
export function parseMoney(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  let text = String(value)
    .trim()
    .replace(/(?:EUR|USD|GBP|€|\$|£)/gi, "")
    .trim()
    .replace(/\s/g, "");
  if (/^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,2}$/.test(text))
    text = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{1,2}$/.test(text)) text = text.replace(/,/g, "");
  else if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const amount = Number(text);
  return Number.isFinite(amount) && Math.abs(amount) < 10_000_000_000 ? amount.toFixed(2) : null;
}
function validateValue(
  value: unknown,
  definition: OpenField,
  catalog: Catalog,
): { value: unknown; valid: boolean } {
  if (value === null || value === "not_applicable")
    return { value: null, valid: !definition.required };
  switch (definition.kind) {
    case "date": {
      const date = parseDate(value);
      return { value: date, valid: date !== null };
    }
    case "monetary": {
      const amount = parseMoney(value);
      return { value: amount, valid: amount !== null };
    }
    case "boolean":
      return { value, valid: typeof value === "boolean" };
    case "integer":
      return {
        value,
        valid:
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= -2147483648 &&
          value <= 2147483647,
      };
    case "float":
      return { value, valid: typeof value === "number" && Number.isFinite(value) };
    case "string":
      return {
        value,
        valid:
          typeof value === "string" && value.length <= Math.min(definition.maxLength ?? 128, 128),
      };
    case "select": {
      const options =
        catalog.custom_fields.find((field) => field.name === definition.name)?.extra_data
          ?.select_options ?? [];
      const option = options.find(
        (entry) =>
          entry.id === value || entry.label === value || String(entry.id) === String(value),
      );
      return { value: option?.id ?? null, valid: Boolean(option) };
    }
  }
}
function valueInQuote(value: unknown, kind: OpenField["kind"], quote: string): boolean {
  if (kind === "string")
    return (
      typeof value === "string" &&
      whitespace(quote).toLowerCase().includes(whitespace(value).toLowerCase())
    );
  if (kind === "date")
    return [...quote.matchAll(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\.\d{1,2}\.\d{4})\b/g)].some(
      (match) => parseDate(match[0]) === value,
    );
  const number = Number(value);
  if (value === null || !Number.isFinite(number)) return false;
  const forms = new Set([String(number)]);
  for (const locale of ["de-DE", "en-US"]) {
    for (const useGrouping of [true, false]) {
      forms.add(
        new Intl.NumberFormat(locale, {
          useGrouping,
          minimumFractionDigits: kind === "monetary" ? 2 : 0,
          maximumFractionDigits: kind === "monetary" ? 2 : 20,
        }).format(number),
      );
      if (Number.isInteger(number))
        forms.add(new Intl.NumberFormat(locale, { useGrouping }).format(number));
    }
  }
  return [...quote.matchAll(/[-+]?\d+(?:[.,]\d+)*/g)].some((match) => forms.has(match[0]));
}
export async function gate(
  ctx: Context,
  ocr: string,
  extracted: ExtractedField[],
  layer2: Candidate[],
  catalog: Catalog,
  definitions: OpenField[],
): Promise<Candidate[]> {
  const output: Candidate[] = [];
  for (const field of extracted) {
    const checks: Record<string, unknown> = {};
    const window = field.evidenceQuote ? groundedWindow(ocr, field.evidenceQuote) : null;
    const definition = definitions.find((entry) => `custom:${entry.name}` === field.field);
    const missing = field.value === null || field.value === "not_applicable";
    let passed = missing ? !(definition?.required ?? false) : window !== null;
    checks.grounded = missing || window !== null;
    let value: unknown = missing ? null : field.value;
    if (definition) {
      const checked = validateValue(value, definition, catalog);
      value = checked.value;
      passed &&= checked.valid;
      checks.typeValid = checked.valid;
      const custom = catalog.custom_fields.find((entry) => entry.name === definition.name);
      checks.customFieldId = custom?.id;
      passed &&= custom !== undefined;
      if (
        !missing &&
        ["date", "monetary", "string", "integer", "float"].includes(definition.kind)
      ) {
        checks.valueInQuote =
          checked.valid && valueInQuote(value, definition.kind, field.evidenceQuote ?? "");
        passed &&= checks.valueInQuote === true;
      }
    } else if (field.field.startsWith("custom:")) {
      passed = false;
      checks.reason = "Field is outside applicable document type schema";
    }
    let newEntity = field.newEntity;
    const entityKind =
      field.field === "document_type" || field.field === "correspondent"
        ? field.field
        : field.field.startsWith("tag:")
          ? "tag"
          : undefined;
    if (entityKind && missing) {
      passed = false;
      checks.typeValid = false;
      if (entityKind === "tag")
        checks.tagId = catalog.tags.find((tag) => tag.name === field.field.slice(4))?.id;
    }
    if (newEntity && (!entityKind || newEntity.kind !== entityKind)) {
      passed = false;
      checks.typeValid = false;
      newEntity = undefined;
    }
    if (newEntity && entityKind) {
      const normalized = normalize(newEntity.name);
      const aliases = ctx.db
        .prepare(
          "SELECT * FROM aliases WHERE entity_kind=? AND normalized_alias=? AND key_kind='name'",
        )
        .all(entityKind, normalized) as Alias[];
      const existing = entitiesOf(catalog, entityKind).find(
        (entry) =>
          normalize(entry.name) === normalized ||
          aliases.some((alias) => alias.canonical_id === entry.id),
      );
      if (existing) {
        value = entityKind === "tag" ? true : existing.id;
        if (entityKind === "tag") checks.tagId = existing.id;
        newEntity = undefined;
        checks.deduplicated = true;
      }
    }
    if (entityKind && !newEntity && !missing) {
      if (entityKind === "tag") {
        const entity = catalog.tags.find((tag) => tag.name === field.field.slice(4));
        checks.tagId ??= entity?.id;
        passed &&= typeof value === "boolean" && Boolean(checks.tagId);
      } else {
        const entity = entitiesOf(catalog, entityKind).find(
          (entry) => entry.id === value || entry.name === value,
        );
        passed &&= Boolean(entity);
        value = entity?.id ?? value;
        checks.displayValue = entity?.name;
      }
    }
    const previous = layer2.find((entry) => entry.field === field.field);
    const closed =
      entityKind !== undefined || definition?.kind === "select" || definition?.kind === "boolean";
    const needsSemantic =
      !missing &&
      (definition?.semanticCheck ||
        (closed && (!previous?.passed || !equal(previous.value, value))));
    if (passed && needsSemantic && window) {
      // State is only an OCR window. Do not pass the L3 response or rationale as Jev evidence.
      const decision = await ctx.jev.noul(
        window,
        "Does the source text support " +
          field.field +
          " = " +
          JSON.stringify(newEntity?.name ?? checks.displayValue ?? value) +
          "?",
      );
      checks.semantic = { value: decision.value, confidence: decision.confidence };
      passed &&= decision.value && decision.confidence >= ctx.config.jev.thresholds.semanticCheck;
    }
    if (newEntity) {
      checks.newEntity = true;
      passed = false;
    }
    output.push({
      field: field.field,
      value,
      confidence: field.confidence,
      passed,
      evidenceQuote: field.evidenceQuote,
      checks,
      ...(newEntity ? { newEntity } : {}),
    });
  }
  return output;
}
