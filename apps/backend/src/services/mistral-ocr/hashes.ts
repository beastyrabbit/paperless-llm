import { createHash } from "node:crypto";

export const sha256Hex = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Uint8Array) {
    return {
      byteLength: value.byteLength,
      sha256: sha256Hex(value),
    };
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const hashCanonical = (value: unknown): string => sha256Hex(canonicalJson(value));
