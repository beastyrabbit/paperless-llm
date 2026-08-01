import { type PageInfo, type PageRequest, PageRequestSchema } from "@repo/api-contracts";
import { Effect, Either, Schema } from "effect";
import { ValidationError } from "../errors/index.js";

const DEFAULT_PAGE_LIMIT = 50;
const CURSOR_PREFIX = "p.";
const PAGE_REQUEST_KEYS = ["cursor", "limit"] as const;

const assertAllowedRequestKeys = (input: unknown, allowedKeys: readonly string[]) => {
  if (input === undefined) return {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ValidationError({
      message: "Invalid request parameters",
      field: "query",
    });
  }
  const unknownKeys = Object.keys(input).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new ValidationError({
      message: `Unknown request parameter: ${unknownKeys.join(", ")}`,
      field: "query",
    });
  }
  return input;
};

export const decodeRequest = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  input: unknown = {},
  allowedKeys: readonly string[],
): Schema.Schema.Type<S> => {
  const checked = assertAllowedRequestKeys(input, allowedKeys);
  const decoded = Schema.decodeUnknownEither(schema)(checked);
  if (Either.isLeft(decoded)) {
    throw new ValidationError({
      message: "Invalid request parameters",
      field: "query",
    });
  }
  return decoded.right;
};

export const decodePageRequest = (input: unknown = {}): PageRequest =>
  decodeRequest(PageRequestSchema, input, PAGE_REQUEST_KEYS);

export const requestEffect = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  input: unknown = {},
  allowedKeys: readonly string[],
): Effect.Effect<Schema.Schema.Type<S>, ValidationError> =>
  Effect.try({
    try: () => decodeRequest(schema, input, allowedKeys),
    catch: (error) =>
      error instanceof ValidationError
        ? error
        : new ValidationError({ message: "Invalid request parameters", field: "query" }),
  });

export const pageRequestEffect = (
  input: unknown = {},
): Effect.Effect<PageRequest, ValidationError> =>
  requestEffect(PageRequestSchema, input, PAGE_REQUEST_KEYS);

export const cursorFromOffset = (offset: number): string =>
  `${CURSOR_PREFIX}${offset.toString(36)}`;

export const offsetFromCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  if (!cursor.startsWith(CURSOR_PREFIX)) {
    throw new ValidationError({
      message: "Invalid page cursor",
      field: "cursor",
      value: cursor,
    });
  }
  const parsed = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 36);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ValidationError({
      message: "Invalid page cursor",
      field: "cursor",
      value: cursor,
    });
  }
  return parsed;
};

export const paginate = <T>(
  items: readonly T[],
  request: PageRequest = {},
): { readonly items: readonly T[]; readonly page: PageInfo } => {
  const pageRequest = decodePageRequest(request);
  const limit = pageRequest.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = offsetFromCursor(pageRequest.cursor);
  const selected = items.slice(offset, offset + limit);
  const nextOffset = offset + selected.length;
  const hasNextPage = nextOffset < items.length;
  return {
    items: selected,
    page: {
      nextCursor: hasNextPage ? cursorFromOffset(nextOffset) : null,
      hasNextPage,
      limit,
    },
  };
};

export const decodeResponse = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Schema.Schema.Type<S> => {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  if (Either.isLeft(decoded)) {
    throw new ValidationError({
      message: "Response does not match frozen schema",
      field: "response",
    });
  }
  return decoded.right;
};

export const responseEffect = <S extends Schema.Schema.AnyNoContext>(
  schema: S,
  value: unknown,
): Effect.Effect<Schema.Schema.Type<S>, ValidationError> =>
  Effect.try({
    try: () => decodeResponse(schema, value),
    catch: (error) =>
      error instanceof ValidationError
        ? error
        : new ValidationError({
            message: "Response does not match frozen schema",
            field: "response",
          }),
  });
