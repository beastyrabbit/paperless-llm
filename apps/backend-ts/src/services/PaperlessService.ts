/**
 * Paperless-ngx API client service.
 */
import { Effect, Context, Layer, pipe, Option } from 'effect';
import { ConfigService } from '../config/index.js';
import { TinyBaseService } from './TinyBaseService.js';
import { PaperlessError, NotFoundError } from '../errors/index.js';
import type {
  Document,
  DocumentUpdate,
  Correspondent,
  Tag,
  DocumentType,
  CustomField,
  QueueStats,
} from '../models/index.js';

// ===========================================================================
// Service Interface
// ===========================================================================

// Common error type for all Paperless operations
type PaperlessErrorType = PaperlessError | NotFoundError;

export interface PaperlessService {
  // Document operations
  readonly getDocument: (id: number) => Effect.Effect<Document, PaperlessErrorType>;
  readonly getDocuments: (params?: { page?: number; pageSize?: number }) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly getDocumentsByTag: (tagName: string, limit?: number) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly getDocumentsByTags: (tagNames: string[], limit?: number) => Effect.Effect<Document[], PaperlessErrorType>;
  readonly updateDocument: (id: number, updates: DocumentUpdate) => Effect.Effect<Document, PaperlessErrorType>;
  readonly downloadPdf: (id: number) => Effect.Effect<Uint8Array, PaperlessErrorType>;
  readonly getDocumentContent: (id: number) => Effect.Effect<string, PaperlessErrorType>;

  // Tag operations
  readonly getTags: () => Effect.Effect<Tag[], PaperlessErrorType>;
  readonly getTag: (id: number) => Effect.Effect<Tag, PaperlessErrorType>;
  readonly getTagByName: (name: string) => Effect.Effect<Option.Option<Tag>, PaperlessErrorType>;
  readonly getOrCreateTag: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly addTagToDocument: (docId: number, tagName: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly removeTagFromDocument: (docId: number, tagName: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly transitionDocumentTag: (docId: number, fromTagName: string, toTagName: string) => Effect.Effect<void, PaperlessErrorType>;
  readonly deleteTag: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly mergeTags: (sourceId: number, targetId: number) => Effect.Effect<void, PaperlessErrorType>;

  // Correspondent operations
  readonly getCorrespondents: () => Effect.Effect<Correspondent[], PaperlessErrorType>;
  readonly getCorrespondent: (id: number) => Effect.Effect<Correspondent, PaperlessErrorType>;
  readonly getCorrespondentByName: (name: string) => Effect.Effect<Option.Option<Correspondent>, PaperlessErrorType>;
  readonly getOrCreateCorrespondent: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly deleteCorrespondent: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly mergeCorrespondents: (sourceId: number, targetId: number) => Effect.Effect<void, PaperlessErrorType>;

  // Document Type operations
  readonly getDocumentTypes: () => Effect.Effect<DocumentType[], PaperlessErrorType>;
  readonly getDocumentType: (id: number) => Effect.Effect<DocumentType, PaperlessErrorType>;
  readonly getDocumentTypeByName: (name: string) => Effect.Effect<Option.Option<DocumentType>, PaperlessErrorType>;
  readonly getOrCreateDocumentType: (name: string) => Effect.Effect<number, PaperlessErrorType>;
  readonly deleteDocumentType: (id: number) => Effect.Effect<void, PaperlessErrorType>;
  readonly mergeDocumentTypes: (sourceId: number, targetId: number) => Effect.Effect<void, PaperlessErrorType>;

  // Custom Field operations
  readonly getCustomFields: () => Effect.Effect<CustomField[], PaperlessErrorType>;
  readonly getCustomField: (id: number) => Effect.Effect<CustomField, PaperlessErrorType>;

  // Queue operations
  readonly getQueueStats: () => Effect.Effect<QueueStats, PaperlessErrorType>;

  // Connection test
  readonly testConnection: () => Effect.Effect<boolean, PaperlessErrorType>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const PaperlessService = Context.GenericTag<PaperlessService>('PaperlessService');

// ===========================================================================
// Paginated Response Type
// ===========================================================================

interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ===========================================================================
// Live Implementation
// ===========================================================================

export const PaperlessServiceLive = Layer.effect(
  PaperlessService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const { paperless: configPaperless, tags: tagConfig } = configService.config;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<{ url: string; token: string }, never> =>
      pipe(
        tinybaseService.getAllSettings(),
        Effect.map((dbSettings) => ({
          url: dbSettings['paperless.url'] ?? configPaperless.url,
          token: dbSettings['paperless.token'] ?? configPaperless.token,
        })),
        Effect.catchAll(() => Effect.succeed({
          url: configPaperless.url,
          token: configPaperless.token,
        }))
      );

    // Helper for making authenticated requests - reads config dynamically
    const request = <T>(
      method: string,
      path: string,
      body?: unknown,
      params?: Record<string, string | number>
    ): Effect.Effect<T, PaperlessError | NotFoundError> =>
      Effect.gen(function* () {
        const { url: baseUrl, token } = yield* getConfig();

        if (!baseUrl || !token) {
          return yield* Effect.fail(new PaperlessError({
            message: 'Paperless-ngx not configured',
          }));
        }

        return yield* Effect.tryPromise({
          try: async () => {
            const url = new URL(`${baseUrl}/api${path}`);
            if (params) {
              for (const [key, value] of Object.entries(params)) {
                url.searchParams.set(key, String(value));
              }
            }

            const response = await fetch(url.toString(), {
              method,
              headers: {
                Authorization: `Token ${token}`,
                'Content-Type': 'application/json',
              },
              body: body ? JSON.stringify(body) : undefined,
            });

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
      });

    // Helper to convert NotFoundError to PaperlessError for list endpoints
    const mapNotFound = <T>(effect: Effect.Effect<T, PaperlessError | NotFoundError>): Effect.Effect<T, PaperlessError> =>
      pipe(
        effect,
        Effect.mapError((e) =>
          e instanceof NotFoundError
            ? new PaperlessError({ message: e.message, cause: e })
            : e
        )
      );

    // Get tag ID by name
    const getTagId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(request<PaginatedResponse<Tag>>('GET', '/tags/', undefined, { name__iexact: name })),
        Effect.map((response) => response.results[0]?.id ?? null)
      );

    // Get correspondent ID by name
    const getCorrespondentId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(request<PaginatedResponse<Correspondent>>('GET', '/correspondents/', undefined, { name__iexact: name })),
        Effect.map((response) => response.results[0]?.id ?? null)
      );

    // Get document type ID by name
    const getDocumentTypeId = (name: string): Effect.Effect<number | null, PaperlessError> =>
      pipe(
        mapNotFound(request<PaginatedResponse<DocumentType>>('GET', '/document_types/', undefined, { name__iexact: name })),
        Effect.map((response) => response.results[0]?.id ?? null)
      );

    // Fetch all documents matching query params, handling pagination
    const fetchAllDocuments = (params: Record<string, unknown>): Effect.Effect<Document[], PaperlessError> =>
      Effect.gen(function* () {
        const allDocs: Document[] = [];
        let page = 1;
        const pageSize = 100; // Use smaller batches for memory efficiency

        while (true) {
          const response = yield* mapNotFound(
            request<PaginatedResponse<Document>>(
              'GET',
              '/documents/',
              undefined,
              { ...params, page_size: pageSize, page }
            )
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
        request<Document>('GET', `/documents/${id}/`) as Effect.Effect<Document, PaperlessError | NotFoundError>,

      getDocuments: (params) =>
        pipe(
          request<PaginatedResponse<Document>>('GET', '/documents/', undefined, {
            page: params?.page ?? 1,
            page_size: params?.pageSize ?? 50,
          }),
          Effect.map((response) => response.results)
        ),

      getDocumentsByTag: (tagName, limit = 50) =>
        Effect.gen(function* () {
          const tagId = yield* getTagId(tagName);
          if (tagId === null) {
            return [];
          }
          const response = yield* request<PaginatedResponse<Document>>(
            'GET',
            '/documents/',
            undefined,
            { tags__id: tagId, page_size: limit }
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

          const response = yield* request<PaginatedResponse<Document>>(
            'GET',
            '/documents/',
            undefined,
            { tags__id__in: tagIds.join(','), page_size: limit }
          );
          return response.results;
        }),

      updateDocument: (id, updates) =>
        request<Document>('PATCH', `/documents/${id}/`, updates),

      downloadPdf: (id) =>
        Effect.gen(function* () {
          const { url: baseUrl, token } = yield* getConfig();

          if (!baseUrl || !token) {
            return yield* Effect.fail(new PaperlessError({
              message: 'Paperless-ngx not configured',
            }));
          }

          return yield* Effect.tryPromise({
            try: async () => {
              const url = `${baseUrl}/api/documents/${id}/download/`;
              const response = await fetch(url, {
                headers: { Authorization: `Token ${token}` },
              });
              if (!response.ok) {
                throw new Error(`Failed to download: ${response.status}`);
              }
              return new Uint8Array(await response.arrayBuffer());
            },
            catch: (error) =>
              new PaperlessError({
                message: `Failed to download PDF: ${String(error)}`,
                cause: error,
              }),
          });
        }),

      getDocumentContent: (id) =>
        pipe(
          request<Document>('GET', `/documents/${id}/`),
          Effect.map((doc) => doc.content ?? '')
        ),

      // =====================================================================
      // Tag operations
      // =====================================================================

      getTags: () =>
        pipe(
          request<PaginatedResponse<Tag>>('GET', '/tags/', undefined, { page_size: 1000 }),
          Effect.map((response) => response.results)
        ),

      getTag: (id) =>
        request<Tag>('GET', `/tags/${id}/`) as Effect.Effect<Tag, PaperlessError | NotFoundError>,

      getTagByName: (name) =>
        pipe(
          request<PaginatedResponse<Tag>>('GET', '/tags/', undefined, { name__iexact: name }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none()
          )
        ),

      getOrCreateTag: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getTagId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newTag = yield* request<Tag>('POST', '/tags/', { name });
          return newTag.id;
        }),

      addTagToDocument: (docId, tagName) =>
        Effect.gen(function* () {
          const tagId = yield* Effect.flatMap(
            getTagId(tagName),
            (id) => id !== null ? Effect.succeed(id) : request<Tag>('POST', '/tags/', { name: tagName }).pipe(Effect.map((t) => t.id))
          );
          const doc = yield* request<Document>('GET', `/documents/${docId}/`);
          if (!doc.tags.includes(tagId)) {
            yield* request<Document>('PATCH', `/documents/${docId}/`, {
              tags: [...doc.tags, tagId],
            });
          }
        }),

      removeTagFromDocument: (docId, tagName) =>
        Effect.gen(function* () {
          const tagId = yield* getTagId(tagName);
          if (tagId === null) return;

          const doc = yield* request<Document>('GET', `/documents/${docId}/`);
          const newTags = doc.tags.filter((id) => id !== tagId);
          if (newTags.length !== doc.tags.length) {
            yield* request<Document>('PATCH', `/documents/${docId}/`, { tags: newTags });
          }
        }),

      transitionDocumentTag: (docId, fromTagName, toTagName) =>
        Effect.gen(function* () {
          // Get both tag IDs first
          const fromTagId = yield* getTagId(fromTagName);
          const toTagId = yield* Effect.flatMap(
            getTagId(toTagName),
            (id) => id !== null ? Effect.succeed(id) : request<Tag>('POST', '/tags/', { name: toTagName }).pipe(Effect.map((t) => t.id))
          );

          // Fetch document once, modify tags atomically, save once
          const doc = yield* request<Document>('GET', `/documents/${docId}/`);
          let newTags = doc.tags;

          // Remove from tag if present
          if (fromTagId !== null) {
            newTags = newTags.filter((id) => id !== fromTagId);
          }

          // Add to tag if not present
          if (!newTags.includes(toTagId)) {
            newTags = [...newTags, toTagId];
          }

          // Only update if tags changed
          if (newTags.length !== doc.tags.length || !newTags.every((id) => doc.tags.includes(id))) {
            yield* request<Document>('PATCH', `/documents/${docId}/`, { tags: newTags });
          }
        }),

      deleteTag: (id) => request<void>('DELETE', `/tags/${id}/`),

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
            yield* request<Document>('PATCH', `/documents/${doc.id}/`, { tags: newTags });
          }

          // Delete source tag
          yield* request<void>('DELETE', `/tags/${sourceId}/`);
        }),

      // =====================================================================
      // Correspondent operations
      // =====================================================================

      getCorrespondents: () =>
        pipe(
          request<PaginatedResponse<Correspondent>>('GET', '/correspondents/', undefined, { page_size: 1000 }),
          Effect.map((response) => response.results)
        ),

      getCorrespondent: (id) =>
        request<Correspondent>('GET', `/correspondents/${id}/`) as Effect.Effect<Correspondent, PaperlessError | NotFoundError>,

      getCorrespondentByName: (name) =>
        pipe(
          request<PaginatedResponse<Correspondent>>('GET', '/correspondents/', undefined, { name__iexact: name }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none()
          )
        ),

      getOrCreateCorrespondent: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getCorrespondentId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newCorr = yield* request<Correspondent>('POST', '/correspondents/', { name });
          return newCorr.id;
        }),

      deleteCorrespondent: (id) => request<void>('DELETE', `/correspondents/${id}/`),

      mergeCorrespondents: (sourceId, targetId) =>
        Effect.gen(function* () {
          // Get ALL documents with source correspondent (handles pagination)
          const docs = yield* fetchAllDocuments({ correspondent: sourceId });

          for (const doc of docs) {
            yield* request<Document>('PATCH', `/documents/${doc.id}/`, { correspondent: targetId });
          }

          yield* request<void>('DELETE', `/correspondents/${sourceId}/`);
        }),

      // =====================================================================
      // Document Type operations
      // =====================================================================

      getDocumentTypes: () =>
        pipe(
          request<PaginatedResponse<DocumentType>>('GET', '/document_types/', undefined, { page_size: 1000 }),
          Effect.map((response) => response.results)
        ),

      getDocumentType: (id) =>
        request<DocumentType>('GET', `/document_types/${id}/`) as Effect.Effect<DocumentType, PaperlessError | NotFoundError>,

      getDocumentTypeByName: (name) =>
        pipe(
          request<PaginatedResponse<DocumentType>>('GET', '/document_types/', undefined, { name__iexact: name }),
          Effect.map((response) =>
            response.results[0] ? Option.some(response.results[0]) : Option.none()
          )
        ),

      getOrCreateDocumentType: (name) =>
        Effect.gen(function* () {
          const existingId = yield* getDocumentTypeId(name);
          if (existingId !== null) {
            return existingId;
          }
          const newType = yield* request<DocumentType>('POST', '/document_types/', { name });
          return newType.id;
        }),

      deleteDocumentType: (id) => request<void>('DELETE', `/document_types/${id}/`),

      mergeDocumentTypes: (sourceId, targetId) =>
        Effect.gen(function* () {
          // Get ALL documents with source document type (handles pagination)
          const docs = yield* fetchAllDocuments({ document_type: sourceId });

          for (const doc of docs) {
            yield* request<Document>('PATCH', `/documents/${doc.id}/`, { document_type: targetId });
          }

          yield* request<void>('DELETE', `/document_types/${sourceId}/`);
        }),

      // =====================================================================
      // Custom Field operations
      // =====================================================================

      getCustomFields: () =>
        pipe(
          request<PaginatedResponse<CustomField>>('GET', '/custom_fields/', undefined, { page_size: 1000 }),
          Effect.map((response) => response.results)
        ),

      getCustomField: (id) =>
        request<CustomField>('GET', `/custom_fields/${id}/`) as Effect.Effect<CustomField, PaperlessError | NotFoundError>,

      // =====================================================================
      // Queue operations
      // =====================================================================

      getQueueStats: () =>
        Effect.gen(function* () {
          // Helper to count documents by tag name
          const countByTag = (tagName: string): Effect.Effect<number, PaperlessError> =>
            pipe(
              getTagId(tagName),
              Effect.flatMap((tagId) => {
                if (tagId === null) return Effect.succeed(0);
                return pipe(
                  request<PaginatedResponse<Document>>('GET', '/documents/', undefined, {
                    tags__id: tagId,
                    page_size: 1,
                  }),
                  Effect.map((response) => response.count),
                  Effect.mapError((e) => e instanceof PaperlessError ? e : new PaperlessError({ message: String(e) }))
                );
              })
            );

          // Run all tag counts in parallel
          const [
            pending,
            ocrDone,
            titleDone,
            correspondentDone,
            documentTypeDone,
            tagsDone,
            processed,
            failed,
            manualReview,
          ] = yield* Effect.all([
            countByTag(tagConfig.pending),
            countByTag(tagConfig.ocrDone),
            countByTag(tagConfig.titleDone),
            countByTag(tagConfig.correspondentDone),
            countByTag(tagConfig.documentTypeDone),
            countByTag(tagConfig.tagsDone),
            countByTag(tagConfig.processed),
            countByTag(tagConfig.failed),
            countByTag(tagConfig.manualReview),
          ], { concurrency: 'unbounded' });

          return {
            pending,
            ocrDone,
            titleDone,
            correspondentDone,
            documentTypeDone,
            tagsDone,
            processed,
            failed,
            manualReview,
            total:
              pending +
              ocrDone +
              titleDone +
              correspondentDone +
              documentTypeDone +
              tagsDone +
              processed +
              failed +
              manualReview,
          };
        }),

      // =====================================================================
      // Connection test
      // =====================================================================

      testConnection: () =>
        pipe(
          request<PaginatedResponse<Document>>('GET', '/documents/', undefined, { page_size: 1 }),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        ),
    };
  })
);
