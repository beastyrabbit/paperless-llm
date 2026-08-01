import {
  type HashPrecondition,
  type PaperlessContentRef,
  type PaperlessDocumentSnapshot,
  type PaperlessDocumentStateForHash,
  type PaperlessMutationReread,
  paperlessDocumentStateHash,
  sha256Hex,
  sourcePdfHash,
} from "@repo/api-contracts";
import { Effect, pipe } from "effect";
import { NotFoundError, PaperlessError } from "../../errors/index.js";
import type { Document, DocumentUpdate } from "../../models/index.js";
import { mapNotFoundToPaperless } from "./client.js";
import {
  decodeApiVersionInfo,
  decodeDocument,
  decodeDocumentWithVersions,
  decodeString,
  decodeVersion,
} from "./decoders.js";
import type {
  PaperlessApiVersionInfo,
  PaperlessDocumentVersion,
  PaperlessErrorType,
  PaperlessHttpClient,
  PaperlessVersionUploadResult,
} from "./types.js";
import { normalizeVersion, versionSortKey } from "./versions.js";

export interface ExactDocumentUpdateOptions {
  readonly preconditions?: readonly HashPrecondition[];
  readonly preserveTagIds?: ReadonlySet<number>;
  readonly managedCustomFieldIds?: ReadonlySet<number>;
}

export interface PaperlessDocumentAnalysisAdapter {
  readonly getDocument: (id: number) => Effect.Effect<Document, PaperlessErrorType>;
  readonly getDocumentContent: (id: number) => Effect.Effect<string, PaperlessErrorType>;
  readonly updateDocumentExact: (
    id: number,
    updates: DocumentUpdate,
    options?: ExactDocumentUpdateOptions,
  ) => Effect.Effect<Document, PaperlessErrorType>;
  readonly getApiVersion: () => Effect.Effect<PaperlessApiVersionInfo, PaperlessErrorType>;
  readonly getDocumentVersions: (
    docId: number,
  ) => Effect.Effect<PaperlessDocumentVersion[], PaperlessErrorType>;
  readonly getDocumentVersion: (
    docId: number,
    versionId: number,
  ) => Effect.Effect<PaperlessDocumentVersion, PaperlessErrorType>;
  readonly selectOriginalPdfVersion: (
    docId: number,
  ) => Effect.Effect<PaperlessDocumentVersion | null, PaperlessErrorType>;
  readonly downloadPdf: (
    id: number,
    versionId?: number,
  ) => Effect.Effect<Uint8Array, PaperlessErrorType>;
  readonly downloadVersionPdf: (
    docId: number,
    versionId: number,
  ) => Effect.Effect<Uint8Array, PaperlessErrorType>;
  readonly patchVersionContent: (
    docId: number,
    versionId: number,
    content: string,
  ) => Effect.Effect<PaperlessDocumentVersion, PaperlessErrorType>;
  readonly uploadOcrPdfVersion: (
    docId: number,
    pdfBytes: Uint8Array,
    label?: string,
  ) => Effect.Effect<PaperlessVersionUploadResult, PaperlessErrorType>;
  readonly updateVersionLabel: (
    docId: number,
    versionId: number,
    label: string,
  ) => Effect.Effect<PaperlessDocumentVersion, PaperlessErrorType>;
  readonly pollVersionCreation: (
    docId: number,
    options?: { knownVersionIds?: number[]; timeoutMs?: number; intervalMs?: number },
  ) => Effect.Effect<PaperlessDocumentVersion | null, PaperlessErrorType>;
  readonly getDocumentSnapshot: (
    docId: number,
  ) => Effect.Effect<PaperlessDocumentSnapshot, PaperlessErrorType>;
  readonly getOriginalContentRef: (
    docId: number,
  ) => Effect.Effect<PaperlessContentRef, PaperlessErrorType>;
  readonly getVersionContentRef: (
    docId: number,
    versionId: string,
  ) => Effect.Effect<PaperlessContentRef, PaperlessErrorType>;
  readonly rereadAfterMutation: (
    docId: number,
    preconditions: readonly HashPrecondition[],
  ) => Effect.Effect<PaperlessMutationReread, PaperlessErrorType>;
}

const toIsoDateTime = (value?: string | null): string => {
  const parsed = value ? new Date(value) : new Date();
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
};

const getCustomFieldId = (value: unknown): number | null => {
  if (!value || typeof value !== "object") return null;
  const field = (value as { field?: unknown }).field;
  return typeof field === "number" && Number.isInteger(field) ? field : null;
};

export const documentStateSnapshot = (doc: Document): PaperlessDocumentSnapshot => {
  const customFields = (doc.custom_fields ?? [])
    .map((fieldValue) => {
      const field = getCustomFieldId(fieldValue);
      if (field === null) return null;
      return {
        field,
        valueHash: sha256Hex(JSON.stringify((fieldValue as { value?: unknown }).value ?? null)),
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);

  const modified = toIsoDateTime(doc.modified);
  const stateHash = paperlessDocumentStateHash({
    documentId: doc.id,
    modified,
    added: toIsoDateTime(doc.added),
    titleHash: sha256Hex(doc.title),
    correspondentId: doc.correspondent,
    documentTypeId: doc.document_type,
    tagIds: [...doc.tags].sort((left, right) => left - right),
    customFields,
    archiveSerialNumber: doc.archive_serial_number,
    originalFileNameHash: doc.original_file_name ? sha256Hex(doc.original_file_name) : null,
  } as unknown as PaperlessDocumentStateForHash);

  return {
    documentId: doc.id,
    stateHash,
    sourcePdfHash: null,
    modified,
    tagIds: [...doc.tags].sort((left, right) => left - right),
    correspondentId: doc.correspondent,
    documentTypeId: doc.document_type,
    customFieldIds: customFields.map((field) => field.field).sort((left, right) => left - right),
  } as unknown as PaperlessDocumentSnapshot;
};

const assertPreconditions = (
  doc: Document,
  preconditions: readonly HashPrecondition[] = [],
): Effect.Effect<void, PaperlessError> => {
  const snapshot = documentStateSnapshot(doc);
  const stale = preconditions.find(
    (precondition) =>
      precondition.kind === "paperless_document_state" &&
      precondition.digest !== snapshot.stateHash,
  );
  if (!stale) return Effect.void;
  return Effect.fail(
    new PaperlessError({
      message: "Paperless precondition failed: paperless_document_state",
      statusCode: 409,
    }),
  );
};

const mergeCustomFields = (current: Document, updates: DocumentUpdate): DocumentUpdate => {
  if (!updates.custom_fields) {
    return { ...updates, custom_fields: current.custom_fields as DocumentUpdate["custom_fields"] };
  }

  const replacementFieldIds = new Set(
    updates.custom_fields
      .map((fieldValue) => fieldValue.field)
      .filter((field): field is number => typeof field === "number"),
  );
  const preserved = (current.custom_fields ?? []).filter((fieldValue) => {
    const field = getCustomFieldId(fieldValue);
    return field === null || !replacementFieldIds.has(field);
  });

  return {
    ...updates,
    custom_fields: [...preserved, ...updates.custom_fields] as DocumentUpdate["custom_fields"],
  };
};

const mergeTags = (
  current: Document,
  updates: DocumentUpdate,
  preserveTagIds?: ReadonlySet<number>,
): DocumentUpdate => {
  if (!updates.tags || !preserveTagIds || preserveTagIds.size === 0) return updates;
  const next = new Set(updates.tags);
  for (const tagId of current.tags) {
    if (preserveTagIds.has(tagId)) {
      next.add(tagId);
    }
  }
  return { ...updates, tags: [...next].sort((left, right) => left - right) };
};

const exactUpdatePayload = (
  current: Document,
  updates: DocumentUpdate,
  options: ExactDocumentUpdateOptions = {},
): DocumentUpdate => {
  const mergedCustom = mergeCustomFields(current, updates);
  const mergedTags = mergeTags(current, mergedCustom, options.preserveTagIds);
  return {
    title: updates.title ?? current.title,
    correspondent:
      updates.correspondent === undefined ? current.correspondent : updates.correspondent,
    document_type:
      updates.document_type === undefined ? current.document_type : updates.document_type,
    tags: mergedTags.tags ?? current.tags,
    custom_fields: mergedTags.custom_fields,
    ...(updates.archive_serial_number !== undefined
      ? { archive_serial_number: updates.archive_serial_number }
      : {}),
    ...(updates.content !== undefined ? { content: updates.content } : {}),
  };
};

const sortedNumbers = (values: readonly number[]) =>
  [...values].sort((left, right) => left - right);

const customFieldMap = (values: readonly unknown[] | undefined) => {
  const map = new Map<number, unknown>();
  for (const value of values ?? []) {
    if (!value || typeof value !== "object") continue;
    const field = getCustomFieldId(value);
    if (field !== null) {
      map.set(field, (value as { value?: unknown }).value ?? null);
    }
  }
  return map;
};

const managedValuesMatch = (
  actual: Document,
  payload: DocumentUpdate,
  managedCustomFieldIds?: ReadonlySet<number>,
): boolean => {
  if (payload.title !== undefined && actual.title !== payload.title) return false;
  if (payload.correspondent !== undefined && actual.correspondent !== payload.correspondent)
    return false;
  if (payload.document_type !== undefined && actual.document_type !== payload.document_type)
    return false;
  if (
    payload.tags !== undefined &&
    JSON.stringify(sortedNumbers(actual.tags)) !== JSON.stringify(sortedNumbers(payload.tags))
  ) {
    return false;
  }
  if (payload.custom_fields !== undefined) {
    const actualFields = customFieldMap(actual.custom_fields);
    const payloadFields = customFieldMap(payload.custom_fields);
    const fieldIds = managedCustomFieldIds ?? new Set(payloadFields.keys());
    for (const fieldId of fieldIds) {
      if (
        JSON.stringify(actualFields.get(fieldId) ?? null) !==
        JSON.stringify(payloadFields.get(fieldId) ?? null)
      ) {
        return false;
      }
    }
  }
  return true;
};

const applicationGeneratedLabel =
  /(?:paperless-local-llm|mistral|ocr searchable|application-generated|generated pdf)/i;

const isApplicationGeneratedVersion = (version: PaperlessDocumentVersion): boolean => {
  const label = String(version.label ?? version.version_label ?? "");
  return applicationGeneratedLabel.test(label);
};

const isPdfVersion = (version: PaperlessDocumentVersion): boolean => {
  const mimeType = (version as { mime_type?: unknown }).mime_type;
  if (typeof mimeType !== "string") return true;
  return mimeType === "application/pdf";
};

export const selectOriginalPdfVersionFromList = (
  versions: readonly PaperlessDocumentVersion[],
): PaperlessDocumentVersion | null => {
  const candidates = versions
    .filter(isPdfVersion)
    .filter((version) => !isApplicationGeneratedVersion(version))
    .map((version) => normalizeVersion(version));

  return (
    [...candidates].sort(
      (left, right) =>
        versionSortKey(right).localeCompare(versionSortKey(left)) || right.id - left.id,
    )[0] ?? null
  );
};

export const createPaperlessDocumentAnalysisAdapter = (
  client: PaperlessHttpClient,
): PaperlessDocumentAnalysisAdapter => {
  const getDocument = (id: number) => client.request("GET", `/documents/${id}/`, decodeDocument);

  const getDocumentVersions = (docId: number) =>
    pipe(
      client.request("GET", `/documents/${docId}/`, decodeDocumentWithVersions),
      Effect.map((doc) => (doc.versions ?? []).map((version) => normalizeVersion(version))),
    );

  const downloadVersionPdf = (docId: number, versionId: number) =>
    mapNotFoundToPaperless(
      client.binaryRequest("GET", `/documents/${docId}/download/`, { version: versionId }),
    );

  const downloadPdf = (id: number, versionId?: number) =>
    versionId
      ? downloadVersionPdf(id, versionId)
      : Effect.gen(function* () {
          const selectedVersion = yield* pipe(
            getDocumentVersions(id),
            Effect.map(selectOriginalPdfVersionFromList),
            Effect.catchAll(() => Effect.succeed(null)),
          );
          if (selectedVersion) {
            return yield* downloadVersionPdf(id, selectedVersion.id);
          }
          return yield* mapNotFoundToPaperless(
            client.binaryRequest("GET", `/documents/${id}/download/`),
          );
        });

  return {
    getDocument,

    getDocumentContent: (id) =>
      pipe(
        getDocument(id),
        Effect.map((doc) => doc.content ?? ""),
      ),

    updateDocumentExact: (id, updates, options) =>
      Effect.gen(function* () {
        const before = yield* getDocument(id);
        yield* assertPreconditions(before, options?.preconditions);
        const payload = exactUpdatePayload(before, updates, options);
        const postread = yield* pipe(
          client.request("PATCH", `/documents/${id}/`, decodeDocument, payload),
          Effect.flatMap(() => getDocument(id)),
          Effect.catchAll((error) => {
            if (error instanceof NotFoundError) return Effect.fail(error);
            return pipe(
              getDocument(id),
              Effect.flatMap((after) =>
                managedValuesMatch(after, payload, options?.managedCustomFieldIds)
                  ? Effect.succeed(after)
                  : Effect.fail(error),
              ),
            );
          }),
        );
        if (!managedValuesMatch(postread, payload, options?.managedCustomFieldIds)) {
          return yield* Effect.fail(
            new PaperlessError({
              message: "Paperless exact metadata update verification failed",
              statusCode: 409,
            }),
          );
        }
        return postread;
      }),

    getApiVersion: () => client.request("GET", "/", decodeApiVersionInfo),

    getDocumentVersions,

    getDocumentVersion: (docId, versionId) =>
      pipe(
        client.request("GET", `/documents/${docId}/`, decodeDocumentWithVersions, undefined, {
          version: versionId,
        }),
        Effect.map((doc) => {
          const version = doc.versions?.find((candidate) => candidate.id === versionId) ?? {
            id: versionId,
          };
          return normalizeVersion(version, doc.content);
        }),
      ),

    selectOriginalPdfVersion: (docId) =>
      pipe(getDocumentVersions(docId), Effect.map(selectOriginalPdfVersionFromList)),

    downloadPdf,

    downloadVersionPdf,

    patchVersionContent: (docId, versionId, content) =>
      pipe(
        client.request(
          "PATCH",
          `/documents/${docId}/`,
          decodeDocumentWithVersions,
          { content },
          { version: versionId },
        ),
        Effect.map((doc) => {
          const version = doc.versions?.find((candidate) => candidate.id === versionId) ?? {
            id: versionId,
          };
          return normalizeVersion(version, doc.content);
        }),
      ),

    uploadOcrPdfVersion: (docId, pdfBytes, label = "Mistral OCR searchable PDF") => {
      const formData = new FormData();
      const pdfBuffer = Buffer.from(pdfBytes);
      const pdfArrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength,
      ) as ArrayBuffer;
      formData.set(
        "document",
        new Blob([pdfArrayBuffer], { type: "application/pdf" }),
        `document-${docId}-ocr.pdf`,
      );
      formData.set("version_label", label);
      return pipe(
        client.multipartRequest(
          "POST",
          `/documents/${docId}/update_version/`,
          formData,
          decodeString,
        ),
        Effect.map((taskId) => ({ task_id: taskId })),
      );
    },

    updateVersionLabel: (docId, versionId, label) =>
      pipe(
        client.request("PATCH", `/documents/${docId}/versions/${versionId}/`, decodeVersion, {
          version_label: label,
        }),
        Effect.map((version) => normalizeVersion(version)),
      ),

    pollVersionCreation: (docId, options) =>
      Effect.gen(function* () {
        const timeoutMs = options?.timeoutMs ?? 60_000;
        const intervalMs = options?.intervalMs ?? 2_000;
        const knownIds = new Set(options?.knownVersionIds ?? []);
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
          const versions = yield* getDocumentVersions(docId);
          const created = versions
            .filter((version) => !knownIds.has(version.id))
            .sort((left, right) => versionSortKey(right).localeCompare(versionSortKey(left)))[0];
          if (created) return created;
          yield* Effect.sleep(`${intervalMs} millis`);
        }

        return null;
      }),

    getDocumentSnapshot: (docId) => pipe(getDocument(docId), Effect.map(documentStateSnapshot)),

    getOriginalContentRef: (docId) =>
      Effect.gen(function* () {
        const selectedVersion = yield* pipe(
          getDocumentVersions(docId),
          Effect.map(selectOriginalPdfVersionFromList),
          Effect.catchAll(() => Effect.succeed(null)),
        );
        const bytes = selectedVersion
          ? yield* downloadVersionPdf(docId, selectedVersion.id)
          : yield* mapNotFoundToPaperless(
              client.binaryRequest("GET", `/documents/${docId}/download/`),
            );
        return {
          documentId: docId,
          role: "original" as const,
          versionId: selectedVersion ? String(selectedVersion.id) : null,
          contentType: "application/pdf",
          byteLength: bytes.byteLength,
          sha256: sourcePdfHash(bytes),
          fetchedAt: new Date().toISOString(),
        } as PaperlessContentRef;
      }),

    getVersionContentRef: (docId, versionId) =>
      Effect.gen(function* () {
        const numericVersionId = Number(versionId);
        if (!Number.isInteger(numericVersionId) || numericVersionId <= 0) {
          return yield* Effect.fail(
            new PaperlessError({
              message: "Invalid Paperless version id",
              statusCode: 400,
            }),
          );
        }
        const bytes = yield* downloadVersionPdf(docId, numericVersionId);
        return {
          documentId: docId,
          role: "version" as const,
          versionId,
          contentType: "application/pdf",
          byteLength: bytes.byteLength,
          sha256: sourcePdfHash(bytes),
          fetchedAt: new Date().toISOString(),
        } as PaperlessContentRef;
      }),

    rereadAfterMutation: (docId, preconditions) =>
      Effect.gen(function* () {
        const before = yield* getDocument(docId);
        const beforeHash = documentStateSnapshot(before).stateHash;
        yield* assertPreconditions(before, preconditions);
        const after = yield* getDocument(docId);
        return {
          documentId: docId,
          beforeHash,
          afterHash: documentStateSnapshot(after).stateHash,
          rereadAt: new Date().toISOString(),
          preconditions: [...preconditions],
        } as unknown as PaperlessMutationReread;
      }),
  };
};
