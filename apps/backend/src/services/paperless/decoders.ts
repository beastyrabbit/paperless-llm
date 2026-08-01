import type { PaperlessTask, PaperlessTaskStatus } from "@repo/api-contracts";
import { Schema } from "effect";
import { PaperlessError } from "../../errors/index.js";
import type {
  Correspondent,
  CustomField,
  Document,
  DocumentType,
  Tag,
} from "../../models/index.js";
import {
  CorrespondentSchema,
  CustomFieldSchema,
  DocumentSchema,
  DocumentTypeSchema,
  TagSchema,
} from "../../models/index.js";
import type {
  PaginatedResponse,
  PaperlessApiVersionInfo,
  PaperlessDocumentVersion,
  PaperlessDocumentWithVersions,
} from "./types.js";
import { normalizeVersion } from "./versions.js";

export type Decoder<T> = (input: unknown) => T;

const decodeError = (label: string, cause?: unknown) =>
  new PaperlessError({ message: `Invalid Paperless ${label} response`, cause });

const decodeSchema =
  <S extends Schema.Schema.AnyNoContext>(
    schema: S,
    label: string,
  ): Decoder<Schema.Schema.Type<S>> =>
  (input) => {
    const result = Schema.decodeUnknownEither(schema)(input);
    if (result._tag === "Left") {
      throw decodeError(label, result.left);
    }
    return result.right;
  };

const isRecord = (input: unknown): input is Record<string, unknown> =>
  typeof input === "object" && input !== null && !Array.isArray(input);

const asNumber = (input: unknown, label: string): number => {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  throw decodeError(label);
};

const asOptionalNumber = (input: unknown, label: string): number | undefined => {
  if (input === undefined || input === null) return undefined;
  return asNumber(input, label);
};

const asString = (input: unknown, label: string): string => {
  if (typeof input === "string") return input;
  throw decodeError(label);
};

const asOptionalString = (input: unknown, label: string): string | undefined => {
  if (input === undefined || input === null) return undefined;
  return asString(input, label);
};

const asOptionalBoolean = (input: unknown, label: string): boolean | undefined => {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "boolean") return input;
  throw decodeError(label);
};

const asOptionalStringOrNull = (input: unknown, label: string): string | null | undefined => {
  if (input === undefined) return undefined;
  if (input === null) return null;
  return asString(input, label);
};

export const decodeDocument = decodeSchema(DocumentSchema, "document");
export const decodeTag = decodeSchema(TagSchema, "tag");
export const decodeCorrespondent = decodeSchema(CorrespondentSchema, "correspondent");
export const decodeDocumentType = decodeSchema(DocumentTypeSchema, "document type");
export const decodeCustomField = decodeSchema(CustomFieldSchema, "custom field");

export const decodeNoContent = (_input: unknown): void => undefined;

export const decodeApiVersionInfo = (input: unknown): PaperlessApiVersionInfo => {
  if (!isRecord(input)) throw decodeError("api version");
  const apiVersion = asOptionalNumber(input.api_version, "api version api_version");
  const version = asOptionalString(input.version, "api version version");
  const paperlessVersion = asOptionalString(
    input.paperless_version,
    "api version paperless_version",
  );
  return {
    ...input,
    ...(apiVersion !== undefined ? { api_version: apiVersion } : {}),
    ...(version !== undefined ? { version } : {}),
    ...(paperlessVersion !== undefined ? { paperless_version: paperlessVersion } : {}),
  };
};

export const decodeVersion = (input: unknown): PaperlessDocumentVersion => {
  if (!isRecord(input)) throw decodeError("document version");
  const version = normalizeVersion({
    ...input,
    id: asNumber(input.id, "document version id"),
    document: asOptionalNumber(input.document, "document version document"),
    version: asOptionalNumber(input.version, "document version version"),
    label: asOptionalStringOrNull(input.label, "document version label"),
    version_label: asOptionalStringOrNull(input.version_label, "document version label"),
    content: asOptionalStringOrNull(input.content, "document version content"),
    added: asOptionalString(input.added, "document version added"),
    created: asOptionalString(input.created, "document version created"),
    modified: asOptionalString(input.modified, "document version modified"),
    checksum: asOptionalString(input.checksum, "document version checksum"),
    is_root: asOptionalBoolean(input.is_root, "document version root flag"),
  });
  return version;
};

export const decodeDocumentWithVersions = (input: unknown): PaperlessDocumentWithVersions => {
  const document = decodeDocument(input);
  if (!isRecord(input)) throw decodeError("document with versions");
  const rawVersions = input.versions;
  const versions =
    rawVersions === undefined
      ? undefined
      : Array.isArray(rawVersions)
        ? rawVersions.map(decodeVersion)
        : (() => {
            throw decodeError("document versions");
          })();
  return { ...document, versions };
};

export const decodePaginated =
  <T>(decodeItem: Decoder<T>, label: string): Decoder<PaginatedResponse<T>> =>
  (input) => {
    if (!isRecord(input)) throw decodeError(`${label} page`);
    if (!Array.isArray(input.results)) throw decodeError(`${label} page results`);
    return {
      count: asNumber(input.count, `${label} page count`),
      next: input.next === null ? null : asString(input.next, `${label} page next`),
      previous: input.previous === null ? null : asString(input.previous, `${label} page previous`),
      results: input.results.map(decodeItem),
    };
  };

export const decodeDocumentPage = decodePaginated<Document>(decodeDocument, "document");
export const decodeTagPage = decodePaginated<Tag>(decodeTag, "tag");
export const decodeCorrespondentPage = decodePaginated<Correspondent>(
  decodeCorrespondent,
  "correspondent",
);
export const decodeDocumentTypePage = decodePaginated<DocumentType>(
  decodeDocumentType,
  "document type",
);
export const decodeCustomFieldPage = decodePaginated<CustomField>(
  decodeCustomField,
  "custom field",
);

export const decodeBulkEditResult = (input: unknown): { result: string } => {
  if (!isRecord(input)) throw decodeError("bulk edit result");
  return { result: asString(input.result, "bulk edit result") };
};

export interface PaperlessNote {
  readonly id: number;
  readonly note: string;
  readonly created: string;
  readonly modified?: string;
}

export const decodeNote = (input: unknown): PaperlessNote => {
  if (!isRecord(input)) throw decodeError("note");
  return {
    id: asNumber(input.id, "note id"),
    note: asString(input.note, "note body"),
    created: asOptionalString(input.created, "note created") ?? new Date().toISOString(),
    modified: asOptionalString(input.modified, "note modified"),
  };
};

export const decodeNotes = (input: unknown): PaperlessNote[] => {
  if (!Array.isArray(input)) throw decodeError("notes");
  return input.map(decodeNote);
};

const mapPaperlessStatus = (status: string): PaperlessTaskStatus => {
  switch (status.toUpperCase()) {
    case "PENDING":
      return "queued";
    case "STARTED":
      return "running";
    case "SUCCESS":
      return "succeeded";
    case "FAILURE":
      return "failed";
    case "REVOKED":
      return "canceled";
    default:
      throw decodeError("task status");
  }
};

export const decodeRawTask = (input: unknown): PaperlessTask => {
  if (!isRecord(input)) throw decodeError("task");
  const taskId = asString(input.task_id, "task id");
  const status = mapPaperlessStatus(asString(input.status, "task status"));
  const submittedAt =
    asOptionalString(input.date_created, "task date_created") ?? new Date().toISOString();
  const updatedAt =
    asOptionalString(input.date_done, "task date_done") ??
    asOptionalString(input.date_started, "task date_started") ??
    submittedAt;
  const resultData = isRecord(input.result_data) ? input.result_data : null;
  const errorCode =
    status === "failed"
      ? (asOptionalString(resultData?.error, "task error") ?? "PAPERLESS_TASK_FAILED")
      : undefined;
  return {
    taskId,
    status,
    submittedAt: new Date(submittedAt).toISOString(),
    updatedAt: new Date(updatedAt).toISOString(),
    errorCode,
    resultHash: null,
  } satisfies PaperlessTask;
};

export const decodeTaskPage = decodePaginated<PaperlessTask>(decodeRawTask, "task");

export const decodeString = (input: unknown): string => asString(input, "string");
