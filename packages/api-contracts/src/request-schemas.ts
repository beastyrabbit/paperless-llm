import { Schema } from "effect";
import {
  CorrespondentIdSchema,
  CustomFieldIdSchema,
  DocumentIdSchema,
  DocumentTypeIdSchema,
  MetadataEntityIdSchema,
  PositiveSafeIntFromStringSchema,
  TagIdSchema,
} from "./ids.js";

export const SHORT_TEXT_MAX_LENGTH = 512;
export const USER_TEXT_MAX_LENGTH = 4_000;
export const CHAT_MESSAGE_MAX_LENGTH = 16_000;
export const CHAT_MAX_MESSAGES = 50;
export const STRING_ARRAY_MAX_ITEMS = 200;

const maxLengthMessage = (max: number) => ({
  message: () => `must be ${max} characters or fewer`,
});

const ShortTextSchema = Schema.String.pipe(
  Schema.maxLength(SHORT_TEXT_MAX_LENGTH, maxLengthMessage(SHORT_TEXT_MAX_LENGTH)),
);
const UserTextSchema = Schema.String.pipe(
  Schema.maxLength(USER_TEXT_MAX_LENGTH, maxLengthMessage(USER_TEXT_MAX_LENGTH)),
);
const ChatMessageTextSchema = Schema.String.pipe(
  Schema.maxLength(CHAT_MESSAGE_MAX_LENGTH, maxLengthMessage(CHAT_MESSAGE_MAX_LENGTH)),
);

const OptionalBooleanSchema = Schema.Boolean.pipe(Schema.optional);
const OptionalShortTextSchema = ShortTextSchema.pipe(Schema.optional);
const OptionalUserTextSchema = UserTextSchema.pipe(Schema.optional);
const StringArraySchema = Schema.Array(ShortTextSchema).pipe(
  Schema.maxItems(STRING_ARRAY_MAX_ITEMS),
);
const NullableOptionalShortTextSchema = Schema.NullOr(ShortTextSchema).pipe(Schema.optional);
const NullableOptionalUserTextSchema = Schema.NullOr(UserTextSchema).pipe(Schema.optional);
const NullableOptionalDocumentIdSchema = Schema.NullOr(DocumentIdSchema).pipe(Schema.optional);
const NullableOptionalCorrespondentIdSchema = Schema.NullOr(CorrespondentIdSchema).pipe(
  Schema.optional,
);
const NullableOptionalDocumentTypeIdSchema = Schema.NullOr(DocumentTypeIdSchema).pipe(
  Schema.optional,
);
const NullableOptionalMetadataEntityIdSchema = Schema.NullOr(MetadataEntityIdSchema).pipe(
  Schema.optional,
);

const SettingsTextSchema = Schema.String.pipe(
  Schema.maxLength(USER_TEXT_MAX_LENGTH, maxLengthMessage(USER_TEXT_MAX_LENGTH)),
);

const SettingsValueSchema = Schema.Union(
  SettingsTextSchema,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(Schema.Unknown).pipe(Schema.maxItems(STRING_ARRAY_MAX_ITEMS)),
  Schema.Record({ key: ShortTextSchema, value: Schema.Unknown }),
);

export const PositiveIntFromStringSchema = PositiveSafeIntFromStringSchema;

export const LooseObjectSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });

export const SettingsUpdateBodySchema = Schema.Record({
  key: ShortTextSchema,
  value: SettingsValueSchema,
});
export const WorkflowTagsBodySchema = Schema.Struct({
  tag_names: StringArraySchema.pipe(Schema.optional),
});
export const MergePendingBodySchema = Schema.Struct({
  ids: StringArraySchema.pipe(Schema.optional),
  targetValue: OptionalShortTextSchema,
  item_ids: StringArraySchema.pipe(Schema.optional),
  final_name: OptionalShortTextSchema,
});
export const BulkPendingBodySchema = Schema.Struct({
  ids: StringArraySchema,
  action: Schema.Literal("approve", "reject"),
  targetValue: OptionalShortTextSchema,
  feedback: OptionalUserTextSchema,
  category: OptionalShortTextSchema,
  blockGlobally: OptionalBooleanSchema,
});
export const ApprovePendingBodySchema = Schema.extend(
  LooseObjectSchema,
  Schema.Struct({
    action: OptionalShortTextSchema,
    value: OptionalShortTextSchema,
    selected_value: OptionalShortTextSchema,
  }),
);
export const RejectPendingBodySchema = Schema.extend(
  LooseObjectSchema,
  Schema.Struct({
    feedback: OptionalUserTextSchema,
    category: OptionalShortTextSchema,
    blockGlobally: OptionalBooleanSchema,
  }),
);
export const RejectWithFeedbackBodySchema = Schema.extend(
  LooseObjectSchema,
  Schema.Struct({
    feedback: OptionalUserTextSchema,
    category: OptionalShortTextSchema,
    block_type: OptionalShortTextSchema,
    rejection_reason: OptionalUserTextSchema,
    rejection_category: OptionalUserTextSchema,
  }),
);
export const CleanupApproveBodySchema = Schema.Struct({ final_name: OptionalShortTextSchema });
export const PendingBlockedSuggestionBodySchema = Schema.Struct({
  name: ShortTextSchema,
  block_type: ShortTextSchema,
  rejection_reason: OptionalUserTextSchema,
  rejection_category: OptionalUserTextSchema,
});
export const BootstrapStartBodySchema = Schema.Struct({
  analysis_type: OptionalShortTextSchema,
});
export const BootstrapSkipBodySchema = Schema.Struct({
  count: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.optional),
});
export const BulkOcrStartBodySchema = Schema.Struct({
  docs_per_second: Schema.Number.pipe(Schema.positive(), Schema.optional),
  skip_existing: OptionalBooleanSchema,
});
export const BulkIngestBodySchema = Schema.Struct({
  docs_per_second: Schema.Number.pipe(Schema.positive(), Schema.optional),
  skip_existing_ocr: OptionalBooleanSchema,
  run_ocr: OptionalBooleanSchema,
  transition_tag: OptionalBooleanSchema,
  source_tag: OptionalShortTextSchema,
  target_tag: OptionalShortTextSchema,
});
export const ScheduleUpdateBodySchema = LooseObjectSchema;
export const SelectedTypeIdsBodySchema = Schema.Struct({
  selected_type_ids: Schema.Array(DocumentTypeIdSchema).pipe(Schema.optional),
});
export const SelectedFieldIdsBodySchema = Schema.Struct({
  selected_field_ids: Schema.Array(CustomFieldIdSchema).pipe(Schema.optional),
});
export const SelectedTagIdsBodySchema = Schema.Struct({
  selected_tag_ids: Schema.Array(TagIdSchema).pipe(Schema.optional),
});
export const CleanupTagsBodySchema = Schema.Struct({ keep_llm_tag: OptionalShortTextSchema });
export const ProcessingStepSchema = Schema.Literal("ocr", "metadata", "index");
export const ProcessingStartBodySchema = Schema.Struct({
  step: ProcessingStepSchema.pipe(Schema.optional),
  dryRun: OptionalBooleanSchema,
});
export const ProcessingCancelBodySchema = Schema.Struct({
  runId: OptionalShortTextSchema,
  reason: OptionalUserTextSchema,
}).annotations({ identifier: "ProcessingCancelBody" });
export const LockReleaseBodySchema = Schema.Struct({
  runId: OptionalShortTextSchema,
  force: OptionalBooleanSchema,
}).annotations({ identifier: "LockReleaseBody" });
export const CaseRunBodySchema = Schema.Struct({
  resume: OptionalBooleanSchema,
  rerun: OptionalBooleanSchema,
  dryRun: OptionalBooleanSchema,
});
export const CaseAnswerBodySchema = Schema.extend(
  LooseObjectSchema,
  Schema.Struct({
    answer: Schema.Literal("apply", "reject", "skip", "use_another", "edit_metadata"),
    guidance: NullableOptionalUserTextSchema,
    selectedEntityId: NullableOptionalMetadataEntityIdSchema,
    selectedEntityName: NullableOptionalShortTextSchema,
    metadataPatch: Schema.NullOr(
      Schema.Struct({
        title: OptionalShortTextSchema,
        correspondentId: NullableOptionalCorrespondentIdSchema,
        correspondentName: NullableOptionalShortTextSchema,
        documentTypeId: NullableOptionalDocumentTypeIdSchema,
        documentTypeName: NullableOptionalShortTextSchema,
        tagIds: Schema.Array(TagIdSchema).pipe(Schema.optional),
        tagNames: StringArraySchema.pipe(Schema.optional),
      }),
    ).pipe(Schema.optional),
  }),
);
export const CatalogRunBodySchema = Schema.Struct({
  runtime: Schema.Literal("pi_agent", "local", "openai_cli").pipe(Schema.optional),
});
export const CatalogDecisionBodySchema = Schema.Struct({
  decision: Schema.Literal("approved", "rejected"),
});
export const TagUpdateBodySchema = Schema.Struct({
  tag_name: OptionalShortTextSchema,
  description: OptionalUserTextSchema,
});
export const TagBulkUpdateBodySchema = Schema.Array(
  Schema.Struct({
    id: TagIdSchema,
    tag_name: OptionalShortTextSchema,
    description: OptionalUserTextSchema,
  }),
);
export const TagTranslationBodySchema = Schema.Struct({ text: UserTextSchema });
export const TagOptimizeBodySchema = Schema.Struct({
  description: UserTextSchema,
  tag_name: ShortTextSchema,
});
export const TagTranslateBodySchema = Schema.Struct({
  description: UserTextSchema,
  source_lang: ShortTextSchema,
});
export const CustomFieldUpdateBodySchema = Schema.Struct({
  name: OptionalShortTextSchema,
  extra_data: Schema.Unknown.pipe(Schema.optional),
});
export const CustomFieldBulkUpdateBodySchema = Schema.Array(
  Schema.Struct({
    id: CustomFieldIdSchema,
    name: OptionalShortTextSchema,
    extra_data: Schema.Unknown.pipe(Schema.optional),
  }),
);
export const BlockSuggestionBodySchema = Schema.Struct({
  name: OptionalShortTextSchema,
  suggestion_name: OptionalShortTextSchema,
  block_type: ShortTextSchema,
  reason: OptionalUserTextSchema,
  rejection_reason: NullableOptionalUserTextSchema,
  rejection_category: NullableOptionalUserTextSchema,
  doc_id: NullableOptionalDocumentIdSchema,
});
export const TranslateBodySchema = Schema.Struct({
  text: UserTextSchema,
  source_lang: OptionalShortTextSchema,
  target_lang: ShortTextSchema,
});
export const TranslationClearBodySchema = Schema.Struct({
  target_lang: OptionalShortTextSchema,
  content_type: OptionalShortTextSchema,
});
export const SearchQuerySchema = UserTextSchema;

export const ChatBodySchema = Schema.Struct({
  messages: Schema.Array(
    Schema.Struct({ role: Schema.Literal("user", "assistant"), content: ChatMessageTextSchema }),
  ).pipe(Schema.maxItems(CHAT_MAX_MESSAGES), Schema.optional),
});

export type SettingsUpdateBody = Schema.Schema.Type<typeof SettingsUpdateBodySchema>;
export type WorkflowTagsBody = Schema.Schema.Type<typeof WorkflowTagsBodySchema>;
export type MergePendingBody = Schema.Schema.Type<typeof MergePendingBodySchema>;
export type BulkPendingBody = Schema.Schema.Type<typeof BulkPendingBodySchema>;
export type ApprovePendingBody = Schema.Schema.Type<typeof ApprovePendingBodySchema>;
export type RejectPendingBody = Schema.Schema.Type<typeof RejectPendingBodySchema>;
export type RejectWithFeedbackBody = Schema.Schema.Type<typeof RejectWithFeedbackBodySchema>;
export type BootstrapStartBody = Schema.Schema.Type<typeof BootstrapStartBodySchema>;
export type BootstrapSkipBody = Schema.Schema.Type<typeof BootstrapSkipBodySchema>;
export type BulkOcrStartBody = Schema.Schema.Type<typeof BulkOcrStartBodySchema>;
export type BulkIngestBody = Schema.Schema.Type<typeof BulkIngestBodySchema>;
export type ProcessingStartBody = Schema.Schema.Type<typeof ProcessingStartBodySchema>;
export type ProcessingCancelBody = Schema.Schema.Type<typeof ProcessingCancelBodySchema>;
export type LockReleaseBody = Schema.Schema.Type<typeof LockReleaseBodySchema>;
export type CaseRunBody = Schema.Schema.Type<typeof CaseRunBodySchema>;
export type CaseAnswerBody = Schema.Schema.Type<typeof CaseAnswerBodySchema>;
export type CatalogRunBody = Schema.Schema.Type<typeof CatalogRunBodySchema>;
export type CatalogDecisionBody = Schema.Schema.Type<typeof CatalogDecisionBodySchema>;
export type TagOptimizeBody = Schema.Schema.Type<typeof TagOptimizeBodySchema>;
export type TagTranslateBody = Schema.Schema.Type<typeof TagTranslateBodySchema>;
export type TranslateBody = Schema.Schema.Type<typeof TranslateBodySchema>;
export type SearchQuery = Schema.Schema.Type<typeof SearchQuerySchema>;
export type ChatBody = Schema.Schema.Type<typeof ChatBodySchema>;
