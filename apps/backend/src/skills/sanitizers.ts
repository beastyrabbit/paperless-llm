import { createHash } from "node:crypto";

const whitespace = /\s+/g;

const replaceControlCharacters = (value: string): string =>
  [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  }).join("");

export const sanitizeText = (value: string, maxLength = 20_000): string =>
  replaceControlCharacters(value).replace(whitespace, " ").trim().slice(0, maxLength);

const sanitizeUnknown = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "string") return sanitizeText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      sanitizeText(key, 512),
      sanitizeUnknown(entry, seen),
    ]),
  );
};

export const sanitizeJsonValue = (value: unknown, maxLength = 60_000): string =>
  sanitizeText(JSON.stringify(sanitizeUnknown(value), null, 2), maxLength);

export const stableHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const renderStructuredPlaceholders = (
  template: string,
  placeholders: Readonly<Record<string, string>>,
): string => {
  let prompt = template;
  for (const [key, value] of Object.entries(placeholders)) {
    prompt = prompt.replaceAll(`{{${key}}}`, value);
  }
  return prompt;
};
