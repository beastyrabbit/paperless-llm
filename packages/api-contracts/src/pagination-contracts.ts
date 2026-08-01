import { Schema } from "effect";

export const CursorSchema = Schema.String.pipe(
  Schema.pattern(/^[A-Za-z0-9._~-]{1,256}$/),
).annotations({ identifier: "Cursor" });
export type Cursor = Schema.Schema.Type<typeof CursorSchema>;

export const PageLimitSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(250),
).annotations({ identifier: "PageLimit" });

export const PageRequestSchema = Schema.Struct({
  cursor: CursorSchema.pipe(Schema.optional),
  limit: PageLimitSchema.pipe(Schema.optional),
}).annotations({ identifier: "PageRequest" });
export type PageRequest = Schema.Schema.Type<typeof PageRequestSchema>;

export const PageInfoSchema = Schema.Struct({
  nextCursor: Schema.NullOr(CursorSchema),
  hasNextPage: Schema.Boolean,
  limit: PageLimitSchema,
}).annotations({ identifier: "PageInfo" });
export type PageInfo = Schema.Schema.Type<typeof PageInfoSchema>;

export const PaginatedResponseSchema = <Item extends Schema.Schema.Any>(item: Item) =>
  Schema.Struct({
    items: Schema.Array(item),
    page: PageInfoSchema,
  });

export const EmptyAcceptedResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  status: Schema.Literal(202),
}).annotations({ identifier: "EmptyAcceptedResponse" });
export type EmptyAcceptedResponse = Schema.Schema.Type<typeof EmptyAcceptedResponseSchema>;
