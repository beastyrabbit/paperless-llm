import {
  type PageRequest,
  type PaperlessBulkOperationRequest,
  type PaperlessCapability,
  type PaperlessDocumentPage,
  type PaperlessNoteRef,
  type PaperlessTask,
  paperlessCapabilityDescriptor,
  sha256Hex,
} from "@repo/api-contracts";
import { Effect, Option, pipe } from "effect";
import { PaperlessError } from "../../errors/index.js";
import type {
  Correspondent,
  CustomField,
  Document,
  DocumentType,
  DocumentUpdate,
  QueueStats,
  Tag,
} from "../../models/index.js";
import { mapNotFoundToPaperless } from "./client.js";
import {
  type Decoder,
  decodeBulkEditResult,
  decodeCorrespondent,
  decodeCustomField,
  decodeDocument,
  decodeDocumentPage,
  decodeDocumentType,
  decodeNoContent,
  decodeNotes,
  decodeTag,
  decodeTaskPage,
} from "./decoders.js";
import {
  documentStateSnapshot,
  type PaperlessDocumentAnalysisAdapter,
} from "./document-analysis-adapter.js";
import type {
  PaperlessAssignmentEnumeration,
  PaperlessAssignmentFilterDescriptor,
  PaperlessAssignmentKind,
  PaperlessAssignmentReceipt,
  PaperlessErrorType,
  PaperlessHttpClient,
  PaperlessTaskPollOptions,
} from "./types.js";

type TagConfig = Record<string, unknown>;

export interface PaperlessCatalogAdapter {
  readonly capability: PaperlessCapability;
  readonly invalidateCatalogCache: () => void;
  readonly getConfiguredSystemTagIds: () => Effect.Effect<ReadonlySet<number>, PaperlessErrorType>;
  readonly getDocuments: (params?: {
    page?: number;
    pageSize?: number;
  }) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly listDocumentsPage: (
    request: PageRequest,
  ) => Effect.Effect<PaperlessDocumentPage, PaperlessErrorType>;
  readonly getSimilarDocuments: (
    docId: number,
    limit?: number,
  ) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly getDocumentsByTag: (
    tagName: string,
    limit?: number,
  ) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly getDocumentsByTags: (
    tagNames: string[],
    limit?: number,
  ) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly enumerateTagAssignments: (
    xTagId: number,
    yTagId: number,
  ) => Effect.Effect<PaperlessAssignmentEnumeration, PaperlessErrorType>;
  readonly enumerateCorrespondentAssignments: (
    xCorrespondentId: number,
    yCorrespondentId: number,
  ) => Effect.Effect<PaperlessAssignmentEnumeration, PaperlessErrorType>;
  readonly enumerateDocumentTypeAssignments: (
    xDocumentTypeId: number,
    yDocumentTypeId: number,
  ) => Effect.Effect<PaperlessAssignmentEnumeration, PaperlessErrorType>;
  readonly readTagAssignmentReceipt: (
    tagId: number,
  ) => Effect.Effect<PaperlessAssignmentReceipt, PaperlessErrorType>;
  readonly readCorrespondentAssignmentReceipt: (
    correspondentId: number,
  ) => Effect.Effect<PaperlessAssignmentReceipt, PaperlessErrorType>;
  readonly readDocumentTypeAssignmentReceipt: (
    documentTypeId: number,
  ) => Effect.Effect<PaperlessAssignmentReceipt, PaperlessErrorType>;
  readonly getTags: () => Effect.Effect<Tag[], PaperlessErrorType>;
  readonly getTag: (id: number) => Effect.Effect<Tag, PaperlessErrorType>;
  readonly getTagByName: (name: string) => Effect.Effect<Option.Option<Tag>, PaperlessErrorType>;
  readonly getOrCreateTag: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly addTagToDocument: (
    docId: number,
    tagName: string,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly removeTagFromDocument: (
    docId: number,
    tagName: string,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly transitionDocumentTag: (
    docId: number,
    fromTagName: string,
    toTagName: string,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly deleteTag: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly renameTag: (id: number, name: string) => Effect.Effect<Tag, PaperlessErrorType>;
  readonly updateTagColor: (id: number, color: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly mergeTags: (
    sourceId: number,
    targetId: number,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly getCorrespondents: () => Effect.Effect<Correspondent[], PaperlessErrorType>;
  readonly getCorrespondent: (id: number) => Effect.Effect<Correspondent, PaperlessErrorType>;
  readonly getCorrespondentByName: (
    name: string,
  ) => Effect.Effect<Option.Option<Correspondent>, PaperlessErrorType>;
  readonly getOrCreateCorrespondent: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly deleteCorrespondent: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly renameCorrespondent: (
    id: number,
    name: string,
  ) => Effect.Effect<Correspondent, PaperlessErrorType>;
  readonly mergeCorrespondents: (
    sourceId: number,
    targetId: number,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly getDocumentTypes: () => Effect.Effect<DocumentType[], PaperlessErrorType>;
  readonly getDocumentType: (id: number) => Effect.Effect<DocumentType, PaperlessErrorType>;
  readonly getDocumentTypeByName: (
    name: string,
  ) => Effect.Effect<Option.Option<DocumentType>, PaperlessErrorType>;
  readonly getOrCreateDocumentType: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly deleteDocumentType: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly renameDocumentType: (
    id: number,
    name: string,
  ) => Effect.Effect<DocumentType, PaperlessErrorType>;
  readonly mergeDocumentTypes: (
    sourceId: number,
    targetId: number,
  ) => Effect.Effect<void, PaperlessErrorType>;
  readonly getCustomFields: () => Effect.Effect<CustomField[], PaperlessErrorType>;
  readonly getCustomField: (id: number) => Effect.Effect<CustomField, PaperlessErrorType>;
  readonly addNote: (docId: number, note: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly getNotes: (
    docId: number,
  ) => Effect.Effect<Array<{ id: number; note: string; created: string }>, PaperlessErrorType>;
  readonly getQueueStats: () => Effect.Effect<QueueStats, PaperlessErrorType>;
  readonly getTotalDocumentCount: () => Effect.Effect<number, PaperlessErrorType>;
  readonly submitBulkOperation: (
    request: PaperlessBulkOperationRequest,
  ) => Effect.Effect<PaperlessTask, PaperlessErrorType>;
  readonly pollTask: (
    taskId: string,
    options?: PaperlessTaskPollOptions,
  ) => Effect.Effect<PaperlessTask, PaperlessErrorType>;
}

const nowIso = () => new Date().toISOString();

const sortedUnique = (values: readonly number[]) =>
  [...new Set(values)].sort((left, right) => left - right);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const entityNameEquals = (left: string, right: string) =>
  left.localeCompare(right, undefined, { sensitivity: "accent" }) === 0;

const toCursorPage = (cursor: string | undefined): Effect.Effect<number, PaperlessError> => {
  if (!cursor) return Effect.succeed(1);
  const page = Number(cursor);
  if (Number.isInteger(page) && page > 0) return Effect.succeed(page);
  return Effect.fail(
    new PaperlessError({ message: "Invalid Paperless page cursor", statusCode: 400 }),
  );
};

const resolveBulkEditPayload = (
  request: PaperlessBulkOperationRequest,
): {
  method: "modify_tags" | "set_correspondent" | "set_document_type";
  parameters: Record<string, unknown>;
} => {
  switch (request.operation) {
    case "modify_tags":
      return {
        method: "modify_tags",
        parameters: {
          add_tags: [...request.parameters.addTagIds],
          remove_tags: [...request.parameters.removeTagIds],
        },
      };
    case "set_correspondent":
      return {
        method: "set_correspondent",
        parameters: { correspondent: request.parameters.correspondentId },
      };
    case "set_document_type":
      return {
        method: "set_document_type",
        parameters: { document_type: request.parameters.documentTypeId },
      };
  }
};

export const createPaperlessCatalogAdapter = ({
  client,
  analysis,
  tagConfig,
}: {
  readonly client: PaperlessHttpClient;
  readonly analysis: PaperlessDocumentAnalysisAdapter;
  readonly tagConfig: TagConfig;
}): PaperlessCatalogAdapter => {
  const cache = new Map<string, unknown>();

  const cachedAll = <T>(
    key: string,
    path: string,
    decodeItem: Decoder<T>,
  ): Effect.Effect<T[], PaperlessErrorType> => {
    const existing = cache.get(key);
    if (existing) return Effect.succeed(existing as T[]);
    return pipe(
      mapNotFoundToPaperless(client.getAllResults(path, decodeItem, undefined, { pageSize: 250 })),
      Effect.tap((items) => Effect.sync(() => cache.set(key, items))),
    );
  };

  const invalidateCatalogCache = () => {
    cache.clear();
  };

  const getTags = () => cachedAll("tags", "/tags/", decodeTag);
  const getCorrespondents = () =>
    cachedAll("correspondents", "/correspondents/", decodeCorrespondent);
  const getDocumentTypes = () =>
    cachedAll("document_types", "/document_types/", decodeDocumentType);
  const getCustomFields = () => cachedAll("custom_fields", "/custom_fields/", decodeCustomField);

  const findTagByName = (name: string) =>
    pipe(
      getTags(),
      Effect.map((tags) => tags.find((tag) => entityNameEquals(tag.name, name)) ?? null),
    );

  const findCorrespondentByName = (name: string) =>
    pipe(
      getCorrespondents(),
      Effect.map(
        (correspondents) =>
          correspondents.find((correspondent) => entityNameEquals(correspondent.name, name)) ??
          null,
      ),
    );

  const findDocumentTypeByName = (name: string) =>
    pipe(
      getDocumentTypes(),
      Effect.map(
        (documentTypes) =>
          documentTypes.find((documentType) => entityNameEquals(documentType.name, name)) ?? null,
      ),
    );

  const getConfiguredSystemTagIds = () =>
    pipe(
      getTags(),
      Effect.map((tags) => {
        const configuredNames = new Set(
          Object.values(tagConfig)
            .filter(
              (value): value is string => typeof value === "string" && value.trim().length > 0,
            )
            .map((value) => value.toLocaleLowerCase()),
        );
        return new Set(
          tags
            .filter((tag) => configuredNames.has(tag.name.toLocaleLowerCase()))
            .map((tag) => tag.id),
        );
      }),
    );

  const updateDocumentPreservingSystemTags = (docId: number, updates: DocumentUpdate) =>
    Effect.gen(function* () {
      const preserveTagIds = yield* getConfiguredSystemTagIds();
      return yield* analysis.updateDocumentExact(docId, updates, { preserveTagIds });
    });

  const getTagId = (name: string) =>
    pipe(
      findTagByName(name),
      Effect.map((tag) => tag?.id ?? null),
    );

  const countByTags = (tagNames: string[]): Effect.Effect<number, PaperlessErrorType> =>
    Effect.gen(function* () {
      const names = [...new Set(tagNames.filter(Boolean))];
      const tagIds: number[] = [];
      for (const tagName of names) {
        const tagId = yield* getTagId(tagName);
        if (tagId !== null) tagIds.push(tagId);
      }
      if (tagIds.length === 0) return 0;

      return yield* pipe(
        mapNotFoundToPaperless(
          client.request("GET", "/documents/", decodeDocumentPage, undefined, {
            tags__id__in: tagIds.join(","),
            page_size: 1,
          }),
        ),
        Effect.map((response) => response.count),
      );
    });

  const submitBulkOperation = (
    request: PaperlessBulkOperationRequest,
  ): Effect.Effect<PaperlessTask, PaperlessErrorType> =>
    Effect.gen(function* () {
      if (request.documentIds.length > 1_000) {
        return yield* Effect.fail(
          new PaperlessError({
            message: "Paperless bulk operation exceeds 1000 documents",
            statusCode: 413,
          }),
        );
      }

      const { method, parameters } = resolveBulkEditPayload(request);
      for (const documentId of request.documentIds) {
        yield* analysis.rereadAfterMutation(documentId, request.preconditions);
      }

      const response = yield* client.request(
        "POST",
        "/documents/bulk_edit/",
        decodeBulkEditResult,
        {
          documents: [...request.documentIds],
          method,
          parameters,
        },
      );
      const submittedAt = nowIso();
      return {
        taskId: response.result,
        status: "queued" as const,
        submittedAt,
        updatedAt: submittedAt,
        resultHash: null,
      } satisfies PaperlessTask;
    });

  const pollTask = (
    taskId: string,
    options: PaperlessTaskPollOptions = {},
  ): Effect.Effect<PaperlessTask, PaperlessErrorType> =>
    Effect.gen(function* () {
      const timeoutMs = options.timeoutMs ?? 60_000;
      const intervalMs = options.intervalMs ?? 2_000;
      const deadline = Date.now() + timeoutMs;

      while (Date.now() <= deadline) {
        if (options.signal?.aborted) {
          return yield* Effect.fail(
            new PaperlessError({ message: "Paperless task polling canceled", statusCode: 499 }),
          );
        }
        const page = yield* mapNotFoundToPaperless(
          client.request("GET", "/tasks/", decodeTaskPage, undefined, {
            task_id: taskId,
            page_size: 1,
          }),
        );
        const task = page.results[0];
        if (task) {
          if (task.status === "queued" || task.status === "running") {
            if (Date.now() + intervalMs > deadline) break;
            yield* Effect.sleep(`${intervalMs} millis`);
            continue;
          }
          return task;
        }
        if (Date.now() + intervalMs > deadline) break;
        yield* Effect.sleep(`${intervalMs} millis`);
      }

      return yield* Effect.fail(
        new PaperlessError({ message: "Paperless task polling timed out", statusCode: 408 }),
      );
    });

  const capability: PaperlessCapability = {
    descriptor: paperlessCapabilityDescriptor,
    listDocumentsPage: (request) =>
      Effect.gen(function* () {
        const page = yield* toCursorPage(request.cursor);
        const limit = request.limit ?? 50;
        const response = yield* mapNotFoundToPaperless(
          client.request("GET", "/documents/", decodeDocumentPage, undefined, {
            page,
            page_size: limit,
          }),
        );
        return {
          items: response.results.map(documentStateSnapshot),
          page: {
            nextCursor: response.next ? String(page + 1) : null,
            hasNextPage: Boolean(response.next),
            limit,
          },
        } satisfies PaperlessDocumentPage;
      }),
    getDocumentSnapshot: analysis.getDocumentSnapshot,
    getOriginalContent: analysis.getOriginalContentRef,
    getVersionContent: analysis.getVersionContentRef,
    submitBulkOperation,
    pollTask,
    addNote: (documentId, bodyHash, preconditions) =>
      Effect.gen(function* () {
        yield* analysis.rereadAfterMutation(documentId, preconditions);
        const notes = yield* client.request(
          "POST",
          `/documents/${documentId}/notes/`,
          decodeNotes,
          { note: `body_sha256:${bodyHash}` },
        );
        const note = notes[notes.length - 1];
        if (!note) {
          return yield* Effect.fail(
            new PaperlessError({ message: "Paperless note creation returned no notes" }),
          );
        }
        const createdAt = nowIso();
        return {
          noteId: String(note.id),
          documentId,
          bodyHash,
          createdAt: note.created ? new Date(note.created).toISOString() : createdAt,
          updatedAt: note.modified ? new Date(note.modified).toISOString() : createdAt,
        } as PaperlessNoteRef;
      }),
    rereadAfterMutation: analysis.rereadAfterMutation,
  };

  const getDocumentsByTagIds = (tagIds: readonly number[], limit: number) =>
    tagIds.length === 0
      ? Effect.succeed([])
      : pipe(
          mapNotFoundToPaperless(
            client.request("GET", "/documents/", decodeDocumentPage, undefined, {
              tags__id__in: tagIds.join(","),
              page_size: limit,
            }),
          ),
          Effect.map((response) => response.results),
        );

  const filterDescriptorFor = (
    kind: PaperlessAssignmentKind,
    entityId: number,
  ): PaperlessAssignmentFilterDescriptor => {
    if (kind === "tag") return { path: "/documents/", params: { tags__id: entityId } };
    if (kind === "correspondent") {
      return { path: "/documents/", params: { correspondent: entityId } };
    }
    return { path: "/documents/", params: { document_type: entityId } };
  };

  const hasAssignment = (doc: Document, kind: PaperlessAssignmentKind, entityId: number) => {
    if (kind === "tag") return doc.tags.includes(entityId);
    if (kind === "correspondent") return doc.correspondent === entityId;
    return doc.document_type === entityId;
  };

  const readAssignmentReceipt = (
    kind: PaperlessAssignmentKind,
    entityId: number,
  ): Effect.Effect<PaperlessAssignmentReceipt, PaperlessErrorType> =>
    Effect.gen(function* () {
      const filterDescriptor = filterDescriptorFor(kind, entityId);
      const capturedAt = nowIso();
      const pages = yield* mapNotFoundToPaperless(
        client.getAllPages("/documents/", decodeDocument, filterDescriptor.params, {
          pageSize: 100,
        }),
      );
      const docs = pages.flatMap((page) => page.results).sort((left, right) => left.id - right.id);
      const expectedApiCount = pages[0]?.count ?? 0;

      const documents = [];
      for (const doc of docs) {
        if (!hasAssignment(doc, kind, entityId)) {
          return yield* Effect.fail(
            new PaperlessError({
              message: `Paperless ${kind} assignment receipt membership verification failed for document ${doc.id}`,
              statusCode: 502,
            }),
          );
        }
        const snapshot = documentStateSnapshot(doc);
        documents.push({
          documentId: doc.id,
          modified: snapshot.modified,
          stateHash: snapshot.stateHash,
          verifiedMembership: true as const,
        });
      }

      const documentIds = sortedUnique(docs.map((doc) => doc.id));
      if (documentIds.length !== docs.length) {
        return yield* Effect.fail(
          new PaperlessError({
            message: `Paperless ${kind} assignment receipt returned duplicate document IDs`,
            statusCode: 502,
          }),
        );
      }
      if (expectedApiCount !== docs.length) {
        return yield* Effect.fail(
          new PaperlessError({
            message: `Paperless ${kind} assignment receipt expected ${expectedApiCount} documents but fetched ${docs.length}`,
            statusCode: 502,
          }),
        );
      }

      const assignmentHash = sha256Hex(
        stableJson({
          kind,
          entityId,
          filterDescriptor,
          documentIds,
          documents,
        }),
      );

      return {
        kind,
        entityId,
        filterDescriptor,
        expectedApiCount,
        fetchedCount: docs.length,
        pageCount: pages.length,
        documentIds,
        documents,
        capturedAt,
        assignmentHash,
        complete: true as const,
      };
    });

  const enumerateAssignments = (
    kind: PaperlessAssignmentKind,
    xId: number,
    yId: number,
  ): Effect.Effect<PaperlessAssignmentEnumeration, PaperlessErrorType> =>
    Effect.gen(function* () {
      const [xReceipt, yReceipt] = yield* Effect.all(
        [readAssignmentReceipt(kind, xId), readAssignmentReceipt(kind, yId)],
        { concurrency: "unbounded" },
      );

      const xDocumentIds = xReceipt.documentIds;
      const yDocumentIds = yReceipt.documentIds;
      const xSet = new Set(xDocumentIds);
      const ySet = new Set(yDocumentIds);
      const bothDocumentIds = xDocumentIds.filter((id) => ySet.has(id));

      return {
        kind,
        xId,
        yId,
        xDocumentIds,
        yDocumentIds,
        xOnlyDocumentIds: xDocumentIds.filter((id) => !ySet.has(id)),
        yOnlyDocumentIds: yDocumentIds.filter((id) => !xSet.has(id)),
        bothDocumentIds,
        xReceipt,
        yReceipt,
        xProof: xReceipt,
        yProof: yReceipt,
      };
    });

  return {
    capability,
    invalidateCatalogCache,
    getConfiguredSystemTagIds,

    getDocuments: (params) =>
      pipe(
        client.request("GET", "/documents/", decodeDocumentPage, undefined, {
          page: params?.page ?? 1,
          page_size: params?.pageSize ?? 50,
        }),
        Effect.map((response) => response.results),
      ),

    listDocumentsPage: capability.listDocumentsPage as PaperlessCatalogAdapter["listDocumentsPage"],

    getSimilarDocuments: (docId, limit = 10) =>
      pipe(
        client.request("GET", "/documents/", decodeDocumentPage, undefined, {
          more_like_id: docId,
          page_size: limit,
        }),
        Effect.map((response) => response.results),
      ),

    getDocumentsByTag: (tagName, limit = 50) =>
      Effect.gen(function* () {
        const tagId = yield* getTagId(tagName);
        return yield* getDocumentsByTagIds(tagId === null ? [] : [tagId], limit);
      }),

    getDocumentsByTags: (tagNames, limit = 50) =>
      Effect.gen(function* () {
        const tagIds: number[] = [];
        for (const name of tagNames) {
          const tagId = yield* getTagId(name);
          if (tagId !== null) tagIds.push(tagId);
        }
        return yield* getDocumentsByTagIds(tagIds, limit);
      }),

    enumerateTagAssignments: (xTagId, yTagId) => enumerateAssignments("tag", xTagId, yTagId),

    enumerateCorrespondentAssignments: (xCorrespondentId, yCorrespondentId) =>
      enumerateAssignments("correspondent", xCorrespondentId, yCorrespondentId),

    enumerateDocumentTypeAssignments: (xDocumentTypeId, yDocumentTypeId) =>
      enumerateAssignments("document_type", xDocumentTypeId, yDocumentTypeId),

    readTagAssignmentReceipt: (tagId) => readAssignmentReceipt("tag", tagId),

    readCorrespondentAssignmentReceipt: (correspondentId) =>
      readAssignmentReceipt("correspondent", correspondentId),

    readDocumentTypeAssignmentReceipt: (documentTypeId) =>
      readAssignmentReceipt("document_type", documentTypeId),

    getTags,

    getTag: (id) => client.request("GET", `/tags/${id}/`, decodeTag),

    getTagByName: (name) =>
      pipe(
        findTagByName(name),
        Effect.map((tag) => (tag ? Option.some(tag) : Option.none())),
      ),

    getOrCreateTag: (name) =>
      Effect.gen(function* () {
        const existing = yield* findTagByName(name);
        if (existing) return existing.id;
        const tag = yield* client.request("POST", "/tags/", decodeTag, { name });
        invalidateCatalogCache();
        return tag.id;
      }),

    addTagToDocument: (docId, tagName) =>
      Effect.gen(function* () {
        const tagId =
          (yield* getTagId(tagName)) ??
          (yield* client.request("POST", "/tags/", decodeTag, { name: tagName }).pipe(
            Effect.tap(() => Effect.sync(invalidateCatalogCache)),
            Effect.map((tag) => tag.id),
          ));
        const doc = yield* analysis.getDocument(docId);
        if (!doc.tags.includes(tagId)) {
          yield* updateDocumentPreservingSystemTags(docId, { tags: [...doc.tags, tagId] });
        }
      }),

    removeTagFromDocument: (docId, tagName) =>
      Effect.gen(function* () {
        const tagId = yield* getTagId(tagName);
        if (tagId === null) return;
        const doc = yield* analysis.getDocument(docId);
        const tags = doc.tags.filter((id) => id !== tagId);
        if (tags.length !== doc.tags.length) {
          yield* updateDocumentPreservingSystemTags(docId, { tags });
        }
      }),

    transitionDocumentTag: (docId, _fromTagName, toTagName) =>
      Effect.gen(function* () {
        const allTags = yield* getTags();
        const tagNameById = new Map(allTags.map((tag) => [tag.id, tag.name]));
        const toTagId =
          (yield* getTagId(toTagName)) ??
          (yield* client.request("POST", "/tags/", decodeTag, { name: toTagName }).pipe(
            Effect.tap(() => Effect.sync(invalidateCatalogCache)),
            Effect.map((tag) => tag.id),
          ));
        const doc = yield* analysis.getDocument(docId);
        const tags = new Set(
          doc.tags.filter((id) => {
            const name = tagNameById.get(id);
            return !name?.startsWith("llm-") || id === toTagId;
          }),
        );
        tags.add(toTagId);
        const nextTags = [...tags].sort((left, right) => left - right);
        if (nextTags.length !== doc.tags.length || nextTags.some((id) => !doc.tags.includes(id))) {
          yield* analysis.updateDocumentExact(docId, { tags: nextTags });
        }
      }),

    deleteTag: (id) =>
      pipe(
        client.request("DELETE", `/tags/${id}/`, decodeNoContent),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    renameTag: (id, name) =>
      pipe(
        client.request("PATCH", `/tags/${id}/`, decodeTag, { name }),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    updateTagColor: (id, color) =>
      pipe(
        client.request("PATCH", `/tags/${id}/`, decodeNoContent, { color }),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    mergeTags: (sourceId, targetId) =>
      Effect.gen(function* () {
        const docs = yield* mapNotFoundToPaperless(
          client.getAllResults(
            "/documents/",
            decodeDocument,
            { tags__id: sourceId },
            { pageSize: 250 },
          ),
        );
        for (const doc of docs) {
          const tags = new Set(doc.tags.filter((id) => id !== sourceId));
          tags.add(targetId);
          yield* analysis.updateDocumentExact(doc.id, { tags: [...tags] });
        }
        yield* client.request("DELETE", `/tags/${sourceId}/`, decodeNoContent);
        invalidateCatalogCache();
      }),

    getCorrespondents,

    getCorrespondent: (id) => client.request("GET", `/correspondents/${id}/`, decodeCorrespondent),

    getCorrespondentByName: (name) =>
      pipe(
        findCorrespondentByName(name),
        Effect.map((correspondent) => (correspondent ? Option.some(correspondent) : Option.none())),
      ),

    getOrCreateCorrespondent: (name) =>
      Effect.gen(function* () {
        const existing = yield* findCorrespondentByName(name);
        if (existing) return existing.id;
        const correspondent = yield* client.request(
          "POST",
          "/correspondents/",
          decodeCorrespondent,
          {
            name,
          },
        );
        invalidateCatalogCache();
        return correspondent.id;
      }),

    deleteCorrespondent: (id) =>
      pipe(
        client.request("DELETE", `/correspondents/${id}/`, decodeNoContent),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    renameCorrespondent: (id, name) =>
      pipe(
        client.request("PATCH", `/correspondents/${id}/`, decodeCorrespondent, { name }),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    mergeCorrespondents: (sourceId, targetId) =>
      Effect.gen(function* () {
        const docs = yield* mapNotFoundToPaperless(
          client.getAllResults(
            "/documents/",
            decodeDocument,
            { correspondent: sourceId },
            { pageSize: 250 },
          ),
        );
        for (const doc of docs) {
          yield* analysis.updateDocumentExact(doc.id, { correspondent: targetId });
        }
        yield* client.request("DELETE", `/correspondents/${sourceId}/`, decodeNoContent);
        invalidateCatalogCache();
      }),

    getDocumentTypes,

    getDocumentType: (id) => client.request("GET", `/document_types/${id}/`, decodeDocumentType),

    getDocumentTypeByName: (name) =>
      pipe(
        findDocumentTypeByName(name),
        Effect.map((documentType) => (documentType ? Option.some(documentType) : Option.none())),
      ),

    getOrCreateDocumentType: (name) =>
      Effect.gen(function* () {
        const existing = yield* findDocumentTypeByName(name);
        if (existing) return existing.id;
        const documentType = yield* client.request("POST", "/document_types/", decodeDocumentType, {
          name,
        });
        invalidateCatalogCache();
        return documentType.id;
      }),

    deleteDocumentType: (id) =>
      pipe(
        client.request("DELETE", `/document_types/${id}/`, decodeNoContent),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    renameDocumentType: (id, name) =>
      pipe(
        client.request("PATCH", `/document_types/${id}/`, decodeDocumentType, { name }),
        Effect.tap(() => Effect.sync(invalidateCatalogCache)),
      ),

    mergeDocumentTypes: (sourceId, targetId) =>
      Effect.gen(function* () {
        const docs = yield* mapNotFoundToPaperless(
          client.getAllResults(
            "/documents/",
            decodeDocument,
            { document_type: sourceId },
            { pageSize: 250 },
          ),
        );
        for (const doc of docs) {
          yield* analysis.updateDocumentExact(doc.id, { document_type: targetId });
        }
        yield* client.request("DELETE", `/document_types/${sourceId}/`, decodeNoContent);
        invalidateCatalogCache();
      }),

    getCustomFields,

    getCustomField: (id) => client.request("GET", `/custom_fields/${id}/`, decodeCustomField),

    addNote: (docId, note) =>
      Effect.gen(function* () {
        yield* client.request("POST", `/documents/${docId}/notes/`, decodeNotes, { note });
      }),

    getNotes: (docId) => client.request("GET", `/documents/${docId}/notes/`, decodeNotes),

    getQueueStats: () =>
      Effect.gen(function* () {
        const countByTag = (tagName: string): Effect.Effect<number, PaperlessErrorType> =>
          countByTags([tagName]);

        const processingStageTags = [
          tagConfig.todo,
          tagConfig.pending,
          tagConfig.ocr,
          tagConfig.ocrDone,
          tagConfig.metadata,
          tagConfig.summaryDone,
          tagConfig.titleDone,
          tagConfig.correspondentDone,
          tagConfig.documentTypeDone,
          tagConfig.index,
          tagConfig.tagsDone,
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        const primaryProcessingTags = [
          tagConfig.ocr,
          tagConfig.metadata,
          tagConfig.summaryDone,
          tagConfig.index,
        ].filter((value): value is string => typeof value === "string" && value.length > 0);
        const todoTag = typeof tagConfig.todo === "string" ? tagConfig.todo : "";
        const usesCoarseProcessingTag =
          new Set([todoTag, ...primaryProcessingTags].filter(Boolean)).size === 1;
        const usesQueuedAndActiveTags =
          new Set(primaryProcessingTags).size === 1 && todoTag !== primaryProcessingTags[0];

        if (usesQueuedAndActiveTags) {
          const [queued, processing, review, done, processed, failed, manualReview] =
            yield* Effect.all(
              [
                countByTags([String(tagConfig.todo ?? ""), String(tagConfig.pending ?? "")]),
                countByTags(primaryProcessingTags),
                countByTags([
                  String(tagConfig.review ?? ""),
                  String(tagConfig.manualReview ?? ""),
                  String(tagConfig.schemaReview ?? ""),
                ]),
                countByTags([String(tagConfig.done ?? ""), String(tagConfig.processed ?? "")]),
                countByTag(String(tagConfig.processed ?? "")),
                countByTag(String(tagConfig.failed ?? "")),
                countByTag(String(tagConfig.manualReview ?? "")),
              ],
              { concurrency: "unbounded" },
            );

          return {
            todo: queued,
            ocr: 0,
            metadata: processing,
            review,
            index: 0,
            done,
            pending: queued,
            ocrDone: 0,
            titleDone: 0,
            correspondentDone: 0,
            documentTypeDone: 0,
            tagsDone: 0,
            processed,
            failed,
            manualReview,
            total: queued + processing + review + done + failed,
          };
        }

        if (usesCoarseProcessingTag) {
          const [processing, review, done, processed, failed, manualReview] = yield* Effect.all(
            [
              countByTags(processingStageTags),
              countByTags([
                String(tagConfig.review ?? ""),
                String(tagConfig.manualReview ?? ""),
                String(tagConfig.schemaReview ?? ""),
              ]),
              countByTags([String(tagConfig.done ?? ""), String(tagConfig.processed ?? "")]),
              countByTag(String(tagConfig.processed ?? "")),
              countByTag(String(tagConfig.failed ?? "")),
              countByTag(String(tagConfig.manualReview ?? "")),
            ],
            { concurrency: "unbounded" },
          );

          return {
            todo: processing,
            ocr: 0,
            metadata: 0,
            review,
            index: 0,
            done,
            pending: processing,
            ocrDone: 0,
            titleDone: 0,
            correspondentDone: 0,
            documentTypeDone: 0,
            tagsDone: 0,
            processed,
            failed,
            manualReview,
            total: processing + review + done + failed,
          };
        }

        const [
          todo,
          ocr,
          metadata,
          review,
          index,
          done,
          pending,
          ocrDone,
          titleDone,
          correspondentDone,
          documentTypeDone,
          tagsDone,
          processed,
          failed,
          manualReview,
        ] = yield* Effect.all(
          [
            countByTags([String(tagConfig.todo ?? ""), String(tagConfig.pending ?? "")]),
            countByTags([String(tagConfig.ocr ?? ""), String(tagConfig.ocrDone ?? "")]),
            countByTags([
              String(tagConfig.metadata ?? ""),
              String(tagConfig.summaryDone ?? ""),
              String(tagConfig.titleDone ?? ""),
              String(tagConfig.correspondentDone ?? ""),
              String(tagConfig.documentTypeDone ?? ""),
            ]),
            countByTags([
              String(tagConfig.review ?? ""),
              String(tagConfig.manualReview ?? ""),
              String(tagConfig.schemaReview ?? ""),
            ]),
            countByTags([String(tagConfig.index ?? ""), String(tagConfig.tagsDone ?? "")]),
            countByTags([String(tagConfig.done ?? ""), String(tagConfig.processed ?? "")]),
            countByTag(String(tagConfig.pending ?? "")),
            countByTag(String(tagConfig.ocrDone ?? "")),
            countByTag(String(tagConfig.titleDone ?? "")),
            countByTag(String(tagConfig.correspondentDone ?? "")),
            countByTag(String(tagConfig.documentTypeDone ?? "")),
            countByTag(String(tagConfig.tagsDone ?? "")),
            countByTag(String(tagConfig.processed ?? "")),
            countByTag(String(tagConfig.failed ?? "")),
            countByTag(String(tagConfig.manualReview ?? "")),
          ],
          { concurrency: "unbounded" },
        );

        return {
          todo,
          ocr,
          metadata,
          review,
          index,
          done,
          pending,
          ocrDone,
          titleDone,
          correspondentDone,
          documentTypeDone,
          tagsDone,
          processed,
          failed,
          manualReview,
          total: todo + ocr + metadata + review + index + done + failed,
        };
      }),

    getTotalDocumentCount: () =>
      pipe(
        client.request("GET", "/documents/", decodeDocumentPage, undefined, {
          page_size: 1,
        }),
        Effect.map((response) => response.count),
      ),

    submitBulkOperation,
    pollTask,
  };
};
