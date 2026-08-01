import type { Effect } from "effect";
import { Schema } from "effect";
import { HashPreconditionSchema, IsoDateTimeSchema, Sha256DigestSchema } from "./hash-contracts.js";
import {
  CorrespondentIdSchema,
  CustomFieldIdSchema,
  DocumentIdSchema,
  DocumentTypeIdSchema,
  TagIdSchema,
} from "./ids.js";
import { type PageRequest, PaginatedResponseSchema } from "./pagination-contracts.js";
import {
  duplicateIdErrors,
  type StrictDecodeResult,
  strictDecode,
  unknownKeyErrors,
} from "./strict-contracts.js";

export const PaperlessContentRoleSchema = Schema.Literal(
  "original",
  "archive",
  "version",
).annotations({
  identifier: "PaperlessContentRole",
});

export const PaperlessContentRefSchema = Schema.Struct({
  documentId: DocumentIdSchema,
  role: PaperlessContentRoleSchema,
  versionId: Schema.NullOr(Schema.String),
  contentType: Schema.String,
  byteLength: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  sha256: Sha256DigestSchema,
  fetchedAt: IsoDateTimeSchema,
}).annotations({ identifier: "PaperlessContentRef" });
export type PaperlessContentRef = Schema.Schema.Type<typeof PaperlessContentRefSchema>;

export const PaperlessDocumentSnapshotSchema = Schema.Struct({
  documentId: DocumentIdSchema,
  stateHash: Sha256DigestSchema,
  sourcePdfHash: Schema.NullOr(Sha256DigestSchema),
  modified: IsoDateTimeSchema,
  tagIds: Schema.Array(TagIdSchema),
  correspondentId: Schema.NullOr(CorrespondentIdSchema),
  documentTypeId: Schema.NullOr(DocumentTypeIdSchema),
  customFieldIds: Schema.Array(CustomFieldIdSchema),
}).annotations({ identifier: "PaperlessDocumentSnapshot" });
export type PaperlessDocumentSnapshot = Schema.Schema.Type<typeof PaperlessDocumentSnapshotSchema>;

export const PaperlessDocumentPageSchema = PaginatedResponseSchema(
  PaperlessDocumentSnapshotSchema,
).annotations({ identifier: "PaperlessDocumentPage" });
export type PaperlessDocumentPage = Schema.Schema.Type<typeof PaperlessDocumentPageSchema>;

export const PaperlessBulkOperationSchema = Schema.Literal(
  "modify_tags",
  "set_correspondent",
  "set_document_type",
).annotations({ identifier: "PaperlessBulkOperation" });
export type PaperlessBulkOperation = Schema.Schema.Type<typeof PaperlessBulkOperationSchema>;

const PaperlessBulkOperationBaseSchema = Schema.Struct({
  documentIds: Schema.Array(DocumentIdSchema).pipe(Schema.minItems(1), Schema.maxItems(1_000)),
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  payloadHash: Sha256DigestSchema,
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
});

export const PaperlessModifyTagsBulkOperationRequestSchema = Schema.extend(
  PaperlessBulkOperationBaseSchema,
  Schema.Struct({
    operation: Schema.Literal("modify_tags"),
    parameters: Schema.Struct({
      addTagIds: Schema.Array(TagIdSchema).pipe(Schema.maxItems(1_000)),
      removeTagIds: Schema.Array(TagIdSchema).pipe(Schema.maxItems(1_000)),
    }),
  }),
).annotations({ identifier: "PaperlessModifyTagsBulkOperationRequest" });

export const PaperlessSetCorrespondentBulkOperationRequestSchema = Schema.extend(
  PaperlessBulkOperationBaseSchema,
  Schema.Struct({
    operation: Schema.Literal("set_correspondent"),
    parameters: Schema.Struct({
      correspondentId: CorrespondentIdSchema,
    }),
  }),
).annotations({ identifier: "PaperlessSetCorrespondentBulkOperationRequest" });

export const PaperlessSetDocumentTypeBulkOperationRequestSchema = Schema.extend(
  PaperlessBulkOperationBaseSchema,
  Schema.Struct({
    operation: Schema.Literal("set_document_type"),
    parameters: Schema.Struct({
      documentTypeId: DocumentTypeIdSchema,
    }),
  }),
).annotations({ identifier: "PaperlessSetDocumentTypeBulkOperationRequest" });

export const PaperlessBulkOperationRequestSchema = Schema.Union(
  PaperlessModifyTagsBulkOperationRequestSchema,
  PaperlessSetCorrespondentBulkOperationRequestSchema,
  PaperlessSetDocumentTypeBulkOperationRequestSchema,
).annotations({ identifier: "PaperlessBulkOperationRequest" });
export type PaperlessBulkOperationRequest = Schema.Schema.Type<
  typeof PaperlessBulkOperationRequestSchema
>;

const bulkOperationAllowedKeys = [
  "operation",
  "documentIds",
  "preconditions",
  "payloadHash",
  "idempotencyKey",
  "parameters",
] as const;
const modifyTagsParameterAllowedKeys = ["addTagIds", "removeTagIds"] as const;
const setCorrespondentParameterAllowedKeys = ["correspondentId"] as const;
const setDocumentTypeParameterAllowedKeys = ["documentTypeId"] as const;

const rawRecord = (input: unknown): Record<string, unknown> | undefined =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;

export const strictDecodePaperlessBulkOperationRequest = (
  input: unknown,
): StrictDecodeResult<PaperlessBulkOperationRequest> =>
  strictDecode(PaperlessBulkOperationRequestSchema, input, (value, raw) => {
    const parameterAllowedKeys =
      value.operation === "modify_tags"
        ? modifyTagsParameterAllowedKeys
        : value.operation === "set_correspondent"
          ? setCorrespondentParameterAllowedKeys
          : setDocumentTypeParameterAllowedKeys;
    const modifyTagsEmpty =
      value.operation === "modify_tags" &&
      value.parameters.addTagIds.length === 0 &&
      value.parameters.removeTagIds.length === 0
        ? [
            {
              code: "FORBIDDEN_FIELDS" as const,
              message: "modify_tags requires at least one addTagIds or removeTagIds entry",
              path: ["parameters"],
            },
          ]
        : [];
    return [
      ...unknownKeyErrors(raw, bulkOperationAllowedKeys),
      ...unknownKeyErrors(rawRecord(raw)?.parameters, parameterAllowedKeys, ["parameters"]),
      ...duplicateIdErrors(value.documentIds, "documentId", ["documentIds"]),
      ...(value.operation === "modify_tags"
        ? [
            ...duplicateIdErrors(value.parameters.addTagIds, "addTagId", [
              "parameters",
              "addTagIds",
            ]),
            ...duplicateIdErrors(value.parameters.removeTagIds, "removeTagId", [
              "parameters",
              "removeTagIds",
            ]),
            ...modifyTagsEmpty,
          ]
        : []),
    ];
  });

export const PaperlessTaskStatusSchema = Schema.Literal(
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
).annotations({ identifier: "PaperlessTaskStatus" });
export type PaperlessTaskStatus = Schema.Schema.Type<typeof PaperlessTaskStatusSchema>;

export const PaperlessTaskSchema = Schema.Struct({
  taskId: Schema.String,
  status: PaperlessTaskStatusSchema,
  submittedAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  errorCode: Schema.String.pipe(Schema.optional),
  resultHash: Schema.NullOr(Sha256DigestSchema),
}).annotations({ identifier: "PaperlessTask" });
export type PaperlessTask = Schema.Schema.Type<typeof PaperlessTaskSchema>;

export const PaperlessNoteRefSchema = Schema.Struct({
  noteId: Schema.String,
  documentId: DocumentIdSchema,
  bodyHash: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).annotations({ identifier: "PaperlessNoteRef" });
export type PaperlessNoteRef = Schema.Schema.Type<typeof PaperlessNoteRefSchema>;

export const PaperlessMutationRereadSchema = Schema.Struct({
  documentId: DocumentIdSchema,
  beforeHash: Sha256DigestSchema,
  afterHash: Sha256DigestSchema,
  rereadAt: IsoDateTimeSchema,
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
}).annotations({ identifier: "PaperlessMutationReread" });
export type PaperlessMutationReread = Schema.Schema.Type<typeof PaperlessMutationRereadSchema>;

export const PaperlessCapabilityDescriptorSchema = Schema.Struct({
  supportsOriginalContent: Schema.Literal(true),
  supportsVersionContent: Schema.Literal(true),
  supportsFullPagination: Schema.Literal(true),
  supportsBulkOperations: Schema.Literal(true),
  supportsTaskPolling: Schema.Literal(true),
  supportsNotes: Schema.Literal(true),
  supportsMutationRereads: Schema.Literal(true),
  supportsConditionalPreconditions: Schema.Literal(true),
}).annotations({ identifier: "PaperlessCapabilityDescriptor" });
export type PaperlessCapabilityDescriptor = Schema.Schema.Type<
  typeof PaperlessCapabilityDescriptorSchema
>;

export interface PaperlessCapability {
  readonly descriptor: PaperlessCapabilityDescriptor;
  readonly listDocumentsPage: (
    request: PageRequest,
  ) => Effect.Effect<PaperlessDocumentPage, unknown>;
  readonly getDocumentSnapshot: (
    documentId: Schema.Schema.Type<typeof DocumentIdSchema>,
  ) => Effect.Effect<PaperlessDocumentSnapshot, unknown>;
  readonly getOriginalContent: (
    documentId: Schema.Schema.Type<typeof DocumentIdSchema>,
  ) => Effect.Effect<PaperlessContentRef, unknown>;
  readonly getVersionContent: (
    documentId: Schema.Schema.Type<typeof DocumentIdSchema>,
    versionId: string,
  ) => Effect.Effect<PaperlessContentRef, unknown>;
  readonly submitBulkOperation: (
    request: PaperlessBulkOperationRequest,
  ) => Effect.Effect<PaperlessTask, unknown>;
  readonly pollTask: (taskId: string) => Effect.Effect<PaperlessTask, unknown>;
  readonly addNote: (
    documentId: Schema.Schema.Type<typeof DocumentIdSchema>,
    bodyHash: Schema.Schema.Type<typeof Sha256DigestSchema>,
    preconditions: readonly Schema.Schema.Type<typeof HashPreconditionSchema>[],
  ) => Effect.Effect<PaperlessNoteRef, unknown>;
  readonly rereadAfterMutation: (
    documentId: Schema.Schema.Type<typeof DocumentIdSchema>,
    preconditions: readonly Schema.Schema.Type<typeof HashPreconditionSchema>[],
  ) => Effect.Effect<PaperlessMutationReread, unknown>;
}

export const paperlessCapabilityDescriptor = {
  supportsOriginalContent: true,
  supportsVersionContent: true,
  supportsFullPagination: true,
  supportsBulkOperations: true,
  supportsTaskPolling: true,
  supportsNotes: true,
  supportsMutationRereads: true,
  supportsConditionalPreconditions: true,
} as const satisfies PaperlessCapabilityDescriptor;
