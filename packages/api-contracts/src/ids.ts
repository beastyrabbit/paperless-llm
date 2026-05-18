import { Schema } from "effect";

export const PositiveSafeIntSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const PositiveSafeIntFromStringSchema = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const DocumentIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("DocumentId"));
export const DocumentIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(Schema.brand("DocumentId"));
export type DocumentId = Schema.Schema.Type<typeof DocumentIdSchema>;

export const TagIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("TagId"));
export const TagIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(Schema.brand("TagId"));
export type TagId = Schema.Schema.Type<typeof TagIdSchema>;

export const CustomFieldIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("CustomFieldId"));
export const CustomFieldIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(
  Schema.brand("CustomFieldId"),
);
export type CustomFieldId = Schema.Schema.Type<typeof CustomFieldIdSchema>;

export const DocumentTypeIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("DocumentTypeId"));
export type DocumentTypeId = Schema.Schema.Type<typeof DocumentTypeIdSchema>;

export const CorrespondentIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("CorrespondentId"));
export type CorrespondentId = Schema.Schema.Type<typeof CorrespondentIdSchema>;

export const BlockedSuggestionIdSchema = PositiveSafeIntSchema.pipe(
  Schema.brand("BlockedSuggestionId"),
);
export const BlockedSuggestionIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(
  Schema.brand("BlockedSuggestionId"),
);
export type BlockedSuggestionId = Schema.Schema.Type<typeof BlockedSuggestionIdSchema>;

export const MetadataEntityIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("MetadataEntityId"));
export type MetadataEntityId = Schema.Schema.Type<typeof MetadataEntityIdSchema>;

export const parsePositiveSafeIntString = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

export const parseDocumentIdString = (value: string): DocumentId | null => {
  const id = parsePositiveSafeIntString(value);
  return id === null ? null : (id as DocumentId);
};
