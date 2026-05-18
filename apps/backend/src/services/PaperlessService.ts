/**
 * Paperless-ngx API client service.
 */
import { Context, Effect, Layer, Option, pipe } from "effect";
import { ConfigService } from "../config/index.js";
import { NotFoundError, PaperlessError } from "../errors/index.js";
import { normalizeConfiguredPaperlessUrl } from "./paperless/url.js";
import { normalizeVersion, versionSortKey } from "./paperless/versions.js";
import type {
  PaginatedResponse,
  PaperlessApiVersionInfo,
  PaperlessDocumentVersion,
  PaperlessDocumentWithVersions,
  PaperlessErrorType,
  PaperlessVersionUploadResult,
} from "./paperless/types.js";
import { withClientSpan } from "../observability/tracing.js";
import type {
  Correspondent,
  CustomField,
  Document,
  DocumentType,
  DocumentUpdate,
  QueueStats,
  Tag,
} from "../models/index.js";
import { fetchWithTimeout } from "../utils/http.js";
import { TinyBaseService } from "./TinyBaseService.js";

// ===========================================================================
// Service Interface
// ===========================================================================

export interface PaperlessService {
  // Document operations
  readonly getDocument: (id: number) => Effect.Effect<Document, PaperlessErrorType>;
  readonly getDocuments: (params?: {
    page?: number;
    pageSize?: number;
  }) => Effect.Effect<Document[], PaperlessErrorType>;
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
  readonly updateDocument: (
    id: number,
    updates: DocumentUpdate,
  ) => Effect.Effect<Document, PaperlessErrorType>;
  readonly downloadPdf: (
    id: number,
    versionId?: number,
  ) => Effect.Effect<Uint8Array, PaperlessErrorType>;
  readonly getDocumentContent: (id: number) => Effect.Effect<string, PaperlessErrorType>;

  // Paperless v3/version-aware document operations
  readonly getApiVersion: () => Effect.Effect<PaperlessApiVersionInfo, PaperlessErrorType>;
  readonly getDocumentVersions: (
    docId: number,
  ) => Effect.Effect<PaperlessDocumentVersion[], PaperlessErrorType>;
  readonly getDocumentVersion: (
    docId: number,
    versionId: number,
  ) => Effect.Effect<PaperlessDocumentVersion, PaperlessErrorType>;
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

  // Tag operations
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

  // Correspondent operations
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

  // Document Type operations
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

  // Custom Field operations
  readonly getCustomFields: () => Effect.Effect<CustomField[], PaperlessErrorType>;
  readonly getCustomField: (id: number) => Effect.Effect<CustomField, PaperlessErrorType>;

  // Note operations
  readonly addNote: (docId: number, note: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly getNotes: (
    docId: number,
  ) => Effect.Effect<Array<{ id: number; note: string; created: string }>, PaperlessErrorType>;

  // Queue operations
  readonly getQueueStats: () => Effect.Effect<QueueStats, PaperlessErrorType>;
  readonly getTotalDocumentCount: () => Effect.Effect<number, PaperlessErrorType>;

  // Connection test
  readonly testConnection: () => Effect.Effect<boolean, PaperlessErrorType>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const PaperlessService = Context.GenericTag<PaperlessService>("PaperlessService");

export type {
  PaperlessApiVersionInfo,
  PaperlessDocumentVersion,
  PaperlessVersionUploadResult,
} from "./paperless/types.js";

// ===========================================================================
// Live Implementation
// ===========================================================================

export const PaperlessServiceLive = Layer.effect(
  PaperlessService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const { paperless: configPaperless, tags: tagConfig } = configService.config;
    const requestTimeoutMs = configService.config.http?.requestTimeoutMs ?? 120_000;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<{ url: string; token: string }, PaperlessError> =>
      pipe(
        tinybaseService.getAllSettings(),
        Effect.catchAll(() => Effect.succeed({} as Record<string, string>)),
        Effect.flatMap((dbSettings) =>
          Effect.try({
            try: () => {
              const configuredUrl = dbSettings["paperless.url"] ?? configPaperless.url;
              return {
                url: normalizeConfiguredPaperlessUrl(configuredUrl),
                token: dbSettings["paperless.token"] ?? configPaperless.token,
              };
            },
            catch: (error) =>
              new PaperlessError({
                message: `Invalid Paperless URL: ${
                  error instanceof Error ? error.message : String(error)
                }`,
                cause: error,
              }),
          }),
        ),
      );

    // Helper for making authenticated requests - reads config dynamically.
    // Paperless v3 exposes API version 10 through content negotiation; these
    // headers are harmless for older endpoints and required for version APIs.
    const request = <T>(
      method: string,
      path: string,
      body?: unknown,
      params?: Record<string, string | number>,
    ): Effect.Effect<T, PaperlessError | NotFoundError> =>
      pipe(
        Effect.gen(function* () {
          const { url: baseUrl, token } = yield* getConfig();

          if (!baseUrl || !token) {
            return yield* Effect.fail(
              new PaperlessError({
                message: "Paperless-ngx not configured",
              }),
            );
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const url = new URL(`${baseUrl}/api${path}`);
              if (params) {
                for (const [key, value] of Object.entries(params)) {
                  url.searchParams.set(key, String(value));
                }
              }

              const response = await fetchWithTimeout(
                url,
                {
                  method,
                  headers: {
                    Authorization: `Token ${token}`,
                    Accept: "application/json; version=10",
                    "Content-Type": "application/json",
                  },
                  body: body === undefined ? undefined : JSON.stringify(body),
                },
                requestTimeoutMs,
              );

              if (!response.ok) {
                if (response.status === 404) {
                  throw new NotFoundError({
                    message: `Resource not found at ${path}`,
                  });
                }
                throw new PaperlessError({
                  message: `Paperless API error: ${response.status} ${response.statusText}`,
                  statusCode: response.status,
                });
              }

              // Handle 204 No Content
              if (response.status === 204) {
                return undefined as T;
              }

              return (await response.json()) as T;
            },
            catch: (error) => {
              if (error instanceof PaperlessError || error instanceof NotFoundError) {
                return error;
              }
              return new PaperlessError({
                message: `Request failed: ${String(error)}`,
                cause: error,
              });
            },
          });
        }),
        withClientSpan("paperless.request", {
          "peer.service": "paperless",
          "http.request.method": method,
          "url.path": path,
          "paperless.api.version": 10,
        }),
      );

    const binaryRequest = (
      method: string,
      path: string,
      params?: Record<string, string | number>,
    ): Effect.Effect<Uint8Array, PaperlessError | NotFoundError> =>
      pipe(
        Effect.gen(function* () {
          const { url: baseUrl, token } = yield* getConfig();

          if (!baseUrl || !token) {
            return yield* Effect.fail(
              new PaperlessError({
                message: "Paperless-ngx not configured",
              }),
            );
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const url = new URL(`${baseUrl}/api${path}`);
              if (params) {
                for (const [key, value] of Object.entries(params)) {
                  url.searchParams.set(key, String(value));
                }
              }

              const response = await fetchWithTimeout(
                url,
                {
                  method,
                  headers: {
                    Authorization: `Token ${token}`,
                    Accept: "*/*",
                  },
                },
                requestTimeoutMs,
              );

              if (!response.ok) {
                if (response.status === 404) {
                  throw new NotFoundError({
                    message: `Resource not found at ${path}`,
                  });
                }
                throw new PaperlessError({
                  message: `Paperless API error: ${response.status} ${response.statusText}`,
                  statusCode: response.status,
                });
              }

              return new Uint8Array(await response.arrayBuffer());
            },
            catch: (error) => {
              if (error instanceof PaperlessError || error instanceof NotFoundError) {
                return error;
              }
              return new PaperlessError({
                message: `Binary request failed: ${String(error)}`,
                cause: error,
              });
            },
          });
        }),
        withClientSpan("paperless.binary_request", {
          "peer.service": "paperless",
          "http.request.method": method,
          "url.path": path,
        }),
      );

    const multipartRequest = <T>(
      method: string,
      path: string,
      formData: FormData,
    ): Effect.Effect<T, PaperlessError | NotFoundError> =>
      pipe(
        Effect.gen(function* () {
          const { url: baseUrl, token } = yield* getConfig();

          if (!baseUrl || !token) {
            return yield* Effect.fail(
              new PaperlessError({
                message: "Paperless-ngx not configured",
              }),
            );
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const url = new URL(`${baseUrl}/api${path}`);
              const response = await fetchWithTimeout(
                url,
                {
                  method,
                  headers: {
                    Authorization: `Token ${token}`,
                    Accept: "application/json; version=10",
                  },
                  body: formData,
                },
                requestTimeoutMs,
              );

              if (!response.ok) {
                if (response.status === 404) {
                  throw new NotFoundError({
                    message: `Resource not found at ${path}`,
                  });
                }
                throw new PaperlessError({
                  message: `Paperless API error: ${response.status} ${response.statusText}`,
                  statusCode: response.status,
                });
              }

              if (response.status === 204) {
                return undefined as T;
              }

              return (await response.json()) as T;
            },
            catch: (error) => {
              if (error instanceof PaperlessError || error instanceof NotFoundError) {
                return error;
              }
              return new PaperlessError({
                message: `Multipart request failed: ${String(error)}`,
                cause: error,
              });
            },
          });
        }),
        withClientSpan("paperless.multipart_request", {
          "peer.service": "paperless",
          "http.request.method": method,
          "url.path": path,
          "paperless.api.version": 10,
        }),
      );

    // Helper to convert NotFoundError to PaperlessError for list endpoints
    const mapNotFound = <T>(
      effect: Effect.Effect<T, PaperlessError | NotFoundError>,
    ): Effect.Effect<T, PaperlessError> =>
      pipe(
        effect,
        Effect.mapError((e) =>
          e instanceof NotFoundError ? new PaperlessError({ message: e.message, cause: e }) : e,
        ),
      );

    // Get tag ID by name
    const getTagId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(
          request<PaginatedResponse<Tag>>("GET", "/tags/", undefined, { name__iexact: name }),
        ),
        Effect.map((response) => response.results[0]?.id ?? null),
      );

    // Get correspondent ID by name
    const getCorrespondentId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(
          request<PaginatedResponse<Correspondent>>("GET", "/correspondents/", undefined, {
            name__iexact: name,
          }),
        ),
        Effect.map((response) => response.results[0]?.id ?? null),
      );

    // Get document type ID by name
    const getDocumentTypeId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(
          request<PaginatedResponse<DocumentType>>("GET", "/document_types/", undefined, {
            name__iexact: name,
          }),
        ),
        Effect.map((response) => response.results[0]?.id ?? null),
      );

    // Fetch all documents matching query params, handling pagination
    const fetchAllDocuments = (
      params: Record<string, unknown>,
    ): Effect.Effect<Document[], PaperlessError> =>
      Effect.gen(function* () {
        const allDocs: Document[] = [];
        let page = 1;
        const pageSize = 100; // Use smaller batches for memory efficiency

        while (true) {
          const response = yield* mapNotFound(
            request<PaginatedResponse<Document>>("GET", "/documents/", undefined, {
              ...params,
              page_size: pageSize,
              page,
            }),
          );

          allDocs.push(...response.results);

          // Check if we have all documents
          if (!response.next || allDocs.length >= response.count) {
            break;
          }
          page++;
        }

        return allDocs;
      });

    return {
      // =====================================================================
      // Document operations
      // =====================================================================

      getDocument: (id) =>
        request<Document>("GET", `/documents/${id}/`) as Effect.Effect<
          Document,
          PaperlessError | NotFoundError
        >,

      getDocuments: (params) =>
        pipe(
          request<PaginatedResponse<Document>>("GET", "/documents/", undefined, {
            page: params?.page ?? 1,
            page_size: params?.pageSize ?? 50,
          }),
          Effect.map((response) => response.results),
        ),

      getSimilarDocuments: (docId, limit = 10) =>
        pipe(
          request<PaginatedResponse<Document>>("GET", "/documents/", undefined, {
            more_like_id: docId,
            page_size: limit,
          }),
          Effect.map((response) => response.results),
        ),

      getDocumentsByTag: (tagName, limit = 50) =>
        Effect.gen(function* () {
          const tagId = yield* getTagId(tagName);
          if (tagId === null) {
            return [];
          }
          const response = yield* request<PaginatedResponse<Document>>(
            "GET",
            "/documents/",
            undefined,
            { tags__id: tagId, page_size: limit },
          );
          return response.results;
        }),

      getDocumentsByTags: (tagNames, limit = 50) =>
        Effect.gen(function* () {
          if (tagNames.length === 0) return [];

          const tagIds: number[] = [];
          for (const name of tagNames) {
            const id = yield* getTagId(name);
            if (id !== null) tagIds.push(id);
          }

          if (tagIds.length === 0) return [];

          // Use tags__id__in for OR query (documents with ANY of the tags)
          const response = yield* request<PaginatedResponse<Document>>(
            "GET",
            "/documents/",
            undefined,
            { tags__id__in: tagIds.join(","), page_size: limit },
          );
          return response.results;
        }),

      updateDocument: (id, updates) => request<Document>("PATCH", `/documents/${id}/`, updates),

      downloadPdf: (id, versionId) =>
        versionId
          ? binaryRequest("GET", `/documents/${id}/download/`, { version: versionId })
          : binaryRequest("GET", `/documents/${id}/download/`),

      getDocumentContent: (id) =>
        pipe(
          request<Document>("GET", `/documents/${id}/`),
          Effect.map((doc) => doc.content ?? ""),
        ),

      getApiVersion: () => request<PaperlessApiVersionInfo>("GET", "/"),

      getDocumentVersions: (docId) =>
        pipe(
          request<PaperlessDocumentWithVersions>("GET", `/documents/${docId}/`),
          Effect.map((doc) => (doc.versions ?? []).map((version) => normalizeVersion(version))),
        ),

      getDocumentVersion: (docId, versionId) =>
        pipe(
          request<PaperlessDocumentWithVersions>("GET", `/documents/${docId}/`, undefined, {
            version: versionId,
          }),
          Effect.map((doc) => {
            const version = doc.versions?.find((candidate) => candidate.id === versionId) ?? {
              id: versionId,
            };
            return normalizeVersion(version, doc.content);
          }),
        ),

      downloadVersionPdf: (docId, versionId) =>
        binaryRequest("GET", `/documents/${docId}/download/`, { version: versionId }),

      patchVersionContent: (docId, versionId, content) =>
        pipe(
          request<PaperlessDocumentWithVersions>(
            "PATCH",
            `/documents/${docId}/`,
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
          multipartRequest<string | PaperlessVersionUploadResult>(
            "POST",
            `/documents/${docId}/update_version/`,
            formData,
          ),
          Effect.map((response) =>
            typeof response === "string" ? { task_id: response } : response,
          ),
        );
      },

      updateVersionLabel: (docId, versionId, label) =>
        pipe(
          request<PaperlessDocumentVersion>("PATCH", `/documents/${docId}/versions/${versionId}/`, {
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
            const versions = yield* pipe(
              request<PaperlessDocumentWithVersions>("GET", `/documents/${docId}/`),
              Effect.map((doc) => (doc.versions ?? []).map((version) => normalizeVersion(version))),
            );
            const created = versions
              .filter((version) => !knownIds.has(version.id))
              .sort((a, b) => versionSortKey(b).localeCompare(versionSortKey(a)))[0];
            if (created) {
              return created;
            }
            yield* Effect.sleep(`${intervalMs} millis`);
          }

          return null;
        }),

      // =====================================================================
      // Tag operations
      // =====================================================================

      getTags: () =>
        pipe(
          request<PaginatedResponse<Tag>>("GET", "/tags/", undefined, { page_size: 1000 }),
          Effect.map((response) => response.results),
        ),

      getTag: (id) =>
        request<Tag>("GET", `/tags/${id}/`) as Effect.Effect<Tag, PaperlessError | NotFoundError>,

      getTagByName: (name) =>
        pipe(
          request<PaginatedResponse<Tag>>("GET", "/tags/", undefined, { name__iexact: name }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none(),
          ),
        ),

      getOrCreateTag: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getTagId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newTag = yield* request<Tag>("POST", "/tags/", { name });
          return newTag.id;
        }),

      addTagToDocument: (docId, tagName) =>
        Effect.gen(function* () {
          const tagId = yield* Effect.flatMap(getTagId(tagName), (id) =>
            id !== null
              ? Effect.succeed(id)
              : request<Tag>("POST", "/tags/", { name: tagName }).pipe(Effect.map((t) => t.id)),
          );
          const doc = yield* request<Document>("GET", `/documents/${docId}/`);
          if (!doc.tags.includes(tagId)) {
            yield* request<Document>("PATCH", `/documents/${docId}/`, {
              tags: [...doc.tags, tagId],
            });
          }
        }),

      removeTagFromDocument: (docId, tagName) =>
        Effect.gen(function* () {
          const tagId = yield* getTagId(tagName);
          if (tagId === null) return;

          const doc = yield* request<Document>("GET", `/documents/${docId}/`);
          const newTags = doc.tags.filter((id) => id !== tagId);
          if (newTags.length !== doc.tags.length) {
            yield* request<Document>("PATCH", `/documents/${docId}/`, { tags: newTags });
          }
        }),

      transitionDocumentTag: (docId, _fromTagName, toTagName) =>
        Effect.gen(function* () {
          // Get ALL tags to build a map of llm- tags
          const allTags = yield* request<{ results: Tag[] }>("GET", "/tags/?page_size=1000").pipe(
            Effect.map((r) => r.results),
          );
          const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));

          // Get the target tag ID (create if needed)
          const toTagId = yield* Effect.flatMap(getTagId(toTagName), (id) =>
            id !== null
              ? Effect.succeed(id)
              : request<Tag>("POST", "/tags/", { name: toTagName }).pipe(Effect.map((t) => t.id)),
          );

          // Fetch document once
          const doc = yield* request<Document>("GET", `/documents/${docId}/`);

          // Remove ALL llm- prefixed tags (except the target tag) to ensure clean state
          // This prevents accumulation of multiple intermediate tags
          let newTags = doc.tags.filter((id) => {
            const name = tagNameById.get(id);
            // Keep non-llm tags and keep the target tag
            return !name?.startsWith("llm-") || id === toTagId;
          });

          // Add target tag if not present
          if (!newTags.includes(toTagId)) {
            newTags = [...newTags, toTagId];
          }

          // Only update if tags changed
          if (newTags.length !== doc.tags.length || !newTags.every((id) => doc.tags.includes(id))) {
            yield* request<Document>("PATCH", `/documents/${docId}/`, { tags: newTags });
          }
        }),

      deleteTag: (id) => request<void>("DELETE", `/tags/${id}/`),

      renameTag: (id, name) => request<Tag>("PATCH", `/tags/${id}/`, { name }),

      updateTagColor: (id, color) => request<void>("PATCH", `/tags/${id}/`, { color }),

      mergeTags: (sourceId, targetId) =>
        Effect.gen(function* () {
          // Get ALL documents with source tag (handles pagination)
          const docs = yield* fetchAllDocuments({ tags__id: sourceId });

          // Add target tag and remove source tag from each document
          for (const doc of docs) {
            const newTags = doc.tags.filter((id) => id !== sourceId);
            if (!newTags.includes(targetId)) {
              newTags.push(targetId);
            }
            yield* request<Document>("PATCH", `/documents/${doc.id}/`, { tags: newTags });
          }

          // Delete source tag
          yield* request<void>("DELETE", `/tags/${sourceId}/`);
        }),

      // =====================================================================
      // Correspondent operations
      // =====================================================================

      getCorrespondents: () =>
        pipe(
          request<PaginatedResponse<Correspondent>>("GET", "/correspondents/", undefined, {
            page_size: 1000,
          }),
          Effect.map((response) => response.results),
        ),

      getCorrespondent: (id) =>
        request<Correspondent>("GET", `/correspondents/${id}/`) as Effect.Effect<
          Correspondent,
          PaperlessError | NotFoundError
        >,

      getCorrespondentByName: (name) =>
        pipe(
          request<PaginatedResponse<Correspondent>>("GET", "/correspondents/", undefined, {
            name__iexact: name,
          }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none(),
          ),
        ),

      getOrCreateCorrespondent: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getCorrespondentId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newCorr = yield* request<Correspondent>("POST", "/correspondents/", { name });
          return newCorr.id;
        }),

      deleteCorrespondent: (id) => request<void>("DELETE", `/correspondents/${id}/`),

      renameCorrespondent: (id, name) =>
        request<Correspondent>("PATCH", `/correspondents/${id}/`, { name }),

      mergeCorrespondents: (sourceId, targetId) =>
        Effect.gen(function* () {
          // Get ALL documents with source correspondent (handles pagination)
          const docs = yield* fetchAllDocuments({ correspondent: sourceId });

          for (const doc of docs) {
            yield* request<Document>("PATCH", `/documents/${doc.id}/`, { correspondent: targetId });
          }

          yield* request<void>("DELETE", `/correspondents/${sourceId}/`);
        }),

      // =====================================================================
      // Document Type operations
      // =====================================================================

      getDocumentTypes: () =>
        pipe(
          request<PaginatedResponse<DocumentType>>("GET", "/document_types/", undefined, {
            page_size: 1000,
          }),
          Effect.map((response) => response.results),
        ),

      getDocumentType: (id) =>
        request<DocumentType>("GET", `/document_types/${id}/`) as Effect.Effect<
          DocumentType,
          PaperlessError | NotFoundError
        >,

      getDocumentTypeByName: (name) =>
        pipe(
          request<PaginatedResponse<DocumentType>>("GET", "/document_types/", undefined, {
            name__iexact: name,
          }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none(),
          ),
        ),

      getOrCreateDocumentType: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getDocumentTypeId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newType = yield* request<DocumentType>("POST", "/document_types/", { name });
          return newType.id;
        }),

      deleteDocumentType: (id) => request<void>("DELETE", `/document_types/${id}/`),

      renameDocumentType: (id, name) =>
        request<DocumentType>("PATCH", `/document_types/${id}/`, { name }),

      mergeDocumentTypes: (sourceId, targetId) =>
        Effect.gen(function* () {
          // Get ALL documents with source document type (handles pagination)
          const docs = yield* fetchAllDocuments({ document_type: sourceId });

          for (const doc of docs) {
            yield* request<Document>("PATCH", `/documents/${doc.id}/`, { document_type: targetId });
          }

          yield* request<void>("DELETE", `/document_types/${sourceId}/`);
        }),

      // =====================================================================
      // Custom Field operations
      // =====================================================================

      getCustomFields: () =>
        pipe(
          request<PaginatedResponse<CustomField>>("GET", "/custom_fields/", undefined, {
            page_size: 1000,
          }),
          Effect.map((response) => response.results),
        ),

      getCustomField: (id) =>
        request<CustomField>("GET", `/custom_fields/${id}/`) as Effect.Effect<
          CustomField,
          PaperlessError | NotFoundError
        >,

      // =====================================================================
      // Note operations
      // =====================================================================

      addNote: (docId, note) =>
        Effect.gen(function* () {
          yield* request<{ id: number; note: string }>("POST", `/documents/${docId}/notes/`, {
            note,
          });
        }),

      getNotes: (docId) =>
        request<Array<{ id: number; note: string; created: string }>>(
          "GET",
          `/documents/${docId}/notes/`,
        ),

      // =====================================================================
      // Queue operations
      // =====================================================================

      getQueueStats: () =>
        Effect.gen(function* () {
          // Helper to count documents by one or more tag names. Paperless applies
          // tags__id__in as an OR filter, so aliases are counted without
          // double-counting documents that still have both old and new workflow tags.
          const countByTags = (tagNames: string[]): Effect.Effect<number, PaperlessError> =>
            Effect.gen(function* () {
              const names = [...new Set(tagNames.filter(Boolean))];
              const tagIds: number[] = [];
              for (const tagName of names) {
                const tagId = yield* getTagId(tagName);
                if (tagId !== null) tagIds.push(tagId);
              }

              if (tagIds.length === 0) return 0;

              return yield* pipe(
                request<PaginatedResponse<Document>>("GET", "/documents/", undefined, {
                  tags__id__in: tagIds.join(","),
                  page_size: 1,
                }),
                Effect.map((response) => response.count),
                Effect.mapError((e) =>
                  e instanceof PaperlessError ? e : new PaperlessError({ message: String(e) }),
                ),
              );
            });

          const countByTag = (tagName: string): Effect.Effect<number, PaperlessError> =>
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
          ].filter(Boolean);
          const primaryProcessingTags = [
            tagConfig.ocr,
            tagConfig.metadata,
            tagConfig.summaryDone,
            tagConfig.index,
          ].filter(Boolean);
          const usesCoarseProcessingTag =
            new Set([tagConfig.todo, ...primaryProcessingTags]).size === 1;
          const usesQueuedAndActiveTags =
            new Set(primaryProcessingTags).size === 1 && tagConfig.todo !== tagConfig.ocr;

          if (usesQueuedAndActiveTags) {
            const [queued, processing, review, done, processed, failed, manualReview] =
              yield* Effect.all(
                [
                  countByTags([tagConfig.todo, tagConfig.pending]),
                  countByTags(primaryProcessingTags),
                  countByTags([tagConfig.review, tagConfig.manualReview, tagConfig.schemaReview]),
                  countByTags([tagConfig.done, tagConfig.processed]),
                  countByTag(tagConfig.processed),
                  countByTag(tagConfig.failed),
                  countByTag(tagConfig.manualReview),
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
                countByTags([tagConfig.review, tagConfig.manualReview, tagConfig.schemaReview]),
                countByTags([tagConfig.done, tagConfig.processed]),
                countByTag(tagConfig.processed),
                countByTag(tagConfig.failed),
                countByTag(tagConfig.manualReview),
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

          // Run all tag counts in parallel
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
              countByTags([tagConfig.todo, tagConfig.pending]),
              countByTags([tagConfig.ocr, tagConfig.ocrDone]),
              countByTags([
                tagConfig.metadata,
                tagConfig.summaryDone,
                tagConfig.titleDone,
                tagConfig.correspondentDone,
                tagConfig.documentTypeDone,
              ]),
              countByTags([tagConfig.review, tagConfig.manualReview, tagConfig.schemaReview]),
              countByTags([tagConfig.index, tagConfig.tagsDone]),
              countByTags([tagConfig.done, tagConfig.processed]),
              countByTag(tagConfig.pending),
              countByTag(tagConfig.ocrDone),
              countByTag(tagConfig.titleDone),
              countByTag(tagConfig.correspondentDone),
              countByTag(tagConfig.documentTypeDone),
              countByTag(tagConfig.tagsDone),
              countByTag(tagConfig.processed),
              countByTag(tagConfig.failed),
              countByTag(tagConfig.manualReview),
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
          request<PaginatedResponse<Document>>("GET", "/documents/", undefined, { page_size: 1 }),
          Effect.map((response) => response.count),
        ),

      // =====================================================================
      // Connection test
      // =====================================================================

      testConnection: () =>
        pipe(
          request<PaginatedResponse<Document>>("GET", "/documents/", undefined, { page_size: 1 }),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
    };
  }),
);
