import { Schema } from "effect";

export interface StrictDecodeError {
  code: "UNKNOWN_KEYS" | "DUPLICATE_IDS" | "MISSING_CONFIGURED_IDS" | "FORBIDDEN_FIELDS";
  message: string;
  path?: readonly string[];
}

export type StrictDecodeResult<A> =
  | { ok: true; value: A }
  | { ok: false; errors: readonly StrictDecodeError[] };

export const unknownKeyErrors = (
  input: unknown,
  allowedKeys: readonly string[],
  path: readonly string[] = [],
): StrictDecodeError[] => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return [];
  const allowed = new Set(allowedKeys);
  return Object.keys(input as Record<string, unknown>)
    .filter((key) => !allowed.has(key))
    .map((key) => ({
      code: "UNKNOWN_KEYS" as const,
      message: `Unknown key: ${key}`,
      path: [...path, key],
    }));
};

export const duplicateIdErrors = (
  ids: readonly number[],
  label: string,
  path: readonly string[] = [],
): StrictDecodeError[] => {
  const seen = new Set<number>();
  const duplicateIds = new Set<number>();
  for (const id of ids) {
    if (seen.has(id)) duplicateIds.add(id);
    seen.add(id);
  }
  return [...duplicateIds].map((id) => ({
    code: "DUPLICATE_IDS" as const,
    message: `Duplicate ${label}: ${id}`,
    path,
  }));
};

export const missingConfiguredIdErrors = (
  expectedIds: readonly number[],
  actualIds: readonly number[],
  label: string,
  path: readonly string[] = [],
): StrictDecodeError[] => {
  const actual = new Set(actualIds);
  return expectedIds
    .filter((id) => !actual.has(id))
    .map((id) => ({
      code: "MISSING_CONFIGURED_IDS" as const,
      message: `Missing configured ${label}: ${id}`,
      path,
    }));
};

export const strictDecode = <T, I>(
  schema: Schema.Schema<T, I, never>,
  input: unknown,
  validate: (value: T, input: unknown) => readonly StrictDecodeError[] = () => [],
): StrictDecodeResult<T> => {
  const decoded = Schema.decodeUnknownEither(schema)(input);
  if (decoded._tag === "Left") {
    return {
      ok: false,
      errors: [{ code: "UNKNOWN_KEYS", message: String(decoded.left) }],
    };
  }
  const errors = validate(decoded.right, input);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: decoded.right };
};
