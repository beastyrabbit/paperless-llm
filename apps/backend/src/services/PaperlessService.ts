/**
 * Paperless-ngx API facade.
 *
 * The public service keeps legacy callers stable while the implementation is
 * split into a decoded HTTP client, document-analysis adapter, and catalog
 * adapter.
 */
import type {
  HashPrecondition,
  PageRequest,
  PaperlessBulkOperationRequest,
  PaperlessCapability,
  PaperlessContentRef,
  PaperlessDocumentPage,
  PaperlessDocumentSnapshot,
  PaperlessMutationReread,
  PaperlessTask,
} from "@repo/api-contracts";
import { Context, Effect, Layer, type Option, pipe } from "effect";
import { ConfigService } from "../config/index.js";
import type {
  Correspondent,
  CustomField,
  Document,
  DocumentType,
  DocumentUpdate,
  QueueStats,
  Tag,
} from "../models/index.js";
import { createPaperlessCatalogAdapter } from "./paperless/catalog-adapter.js";
import { createPaperlessConfigProvider, createPaperlessHttpClient } from "./paperless/client.js";
import {
  createPaperlessDocumentAnalysisAdapter,
  type ExactDocumentUpdateOptions,
} from "./paperless/document-analysis-adapter.js";
import type {
  PaperlessApiVersionInfo,
  PaperlessAssignmentEnumeration,
  PaperlessAssignmentReceipt,
  PaperlessDocumentVersion,
  PaperlessErrorType,
  PaperlessTaskPollOptions,
  PaperlessVersionUploadResult,
} from "./paperless/types.js";

export interface PaperlessService {
  readonly capability: PaperlessCapability;

  // Document operations
  readonly getDocument: (id: number) => Effect.Effect<Document, PaperlessErrorType>;
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
  readonly updateDocument: (
    id: number,
    updates: DocumentUpdate,
  ) => Effect.Effect<Document, PaperlessErrorType>;
  readonly updateDocumentExact: (
    id: number,
    updates: DocumentUpdate,
    options?: ExactDocumentUpdateOptions,
  ) => Effect.Effect<Document, PaperlessErrorType>;
  readonly replaceDocumentMetadataExact: (
    id: number,
    updates: DocumentUpdate,
    options?: ExactDocumentUpdateOptions,
  ) => Effect.Effect<Document, PaperlessErrorType>;
  readonly downloadPdf: (
    id: number,
    versionId?: number,
  ) => Effect.Effect<Uint8Array, PaperlessErrorType>;
  readonly getDocumentContent: (id: number) => Effect.Effect<string, PaperlessErrorType>;
  readonly getDocumentSnapshot: (
    docId: number,
  ) => Effect.Effect<PaperlessDocumentSnapshot, PaperlessErrorType>;
  readonly getOriginalContent: (
    docId: number,
  ) => Effect.Effect<PaperlessContentRef, PaperlessErrorType>;
  readonly getVersionContent: (
    docId: number,
    versionId: string,
  ) => Effect.Effect<PaperlessContentRef, PaperlessErrorType>;
  readonly rereadAfterMutation: (
    docId: number,
    preconditions: readonly HashPrecondition[],
  ) => Effect.Effect<PaperlessMutationReread, PaperlessErrorType>;

  // Paperless v3/version-aware document operations
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

  // Queue/task operations
  readonly getQueueStats: () => Effect.Effect<QueueStats, PaperlessErrorType>;
  readonly getTotalDocumentCount: () => Effect.Effect<number, PaperlessErrorType>;
  readonly submitBulkOperation: (
    request: PaperlessBulkOperationRequest,
  ) => Effect.Effect<PaperlessTask, PaperlessErrorType>;
  readonly pollTask: (
    taskId: string,
    options?: PaperlessTaskPollOptions,
  ) => Effect.Effect<PaperlessTask, PaperlessErrorType>;

  // Connection test
  readonly testConnection: () => Effect.Effect<boolean, PaperlessErrorType>;
}

export const PaperlessService = Context.GenericTag<PaperlessService>("PaperlessService");

export { createPaperlessCatalogAdapter } from "./paperless/catalog-adapter.js";

export { createPaperlessConfigProvider, createPaperlessHttpClient } from "./paperless/client.js";
export {
  createPaperlessDocumentAnalysisAdapter,
  selectOriginalPdfVersionFromList,
} from "./paperless/document-analysis-adapter.js";
export type {
  PaperlessApiVersionInfo,
  PaperlessAssignmentEnumeration,
  PaperlessAssignmentReceipt,
  PaperlessDocumentVersion,
  PaperlessTaskPollOptions,
  PaperlessVersionUploadResult,
} from "./paperless/types.js";

export const PaperlessServiceLive = Layer.effect(
  PaperlessService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const client = createPaperlessHttpClient({
      configProvider: createPaperlessConfigProvider(configService),
    });
    const analysis = createPaperlessDocumentAnalysisAdapter(client);
    const catalog = createPaperlessCatalogAdapter({
      client,
      analysis,
      tagConfig: configService.config.tags as Record<string, unknown>,
    });

    const updateDocumentExactPreservingSystemTags = (
      id: number,
      updates: DocumentUpdate,
      options: ExactDocumentUpdateOptions = {},
    ) =>
      Effect.gen(function* () {
        const preserveTagIds =
          options.preserveTagIds ?? (yield* catalog.getConfiguredSystemTagIds());
        const updated = yield* analysis.updateDocumentExact(id, updates, {
          ...options,
          preserveTagIds,
        });
        catalog.invalidateCatalogCache();
        return updated;
      });

    return {
      capability: catalog.capability,

      getDocument: analysis.getDocument,
      getDocuments: catalog.getDocuments,
      listDocumentsPage: catalog.listDocumentsPage,
      getSimilarDocuments: catalog.getSimilarDocuments,
      getDocumentsByTag: catalog.getDocumentsByTag,
      getDocumentsByTags: catalog.getDocumentsByTags,
      enumerateTagAssignments: catalog.enumerateTagAssignments,
      enumerateCorrespondentAssignments: catalog.enumerateCorrespondentAssignments,
      enumerateDocumentTypeAssignments: catalog.enumerateDocumentTypeAssignments,
      readTagAssignmentReceipt: catalog.readTagAssignmentReceipt,
      readCorrespondentAssignmentReceipt: catalog.readCorrespondentAssignmentReceipt,
      readDocumentTypeAssignmentReceipt: catalog.readDocumentTypeAssignmentReceipt,
      updateDocument: (id, updates) => updateDocumentExactPreservingSystemTags(id, updates),
      updateDocumentExact: updateDocumentExactPreservingSystemTags,
      replaceDocumentMetadataExact: updateDocumentExactPreservingSystemTags,
      downloadPdf: analysis.downloadPdf,
      getDocumentContent: analysis.getDocumentContent,
      getDocumentSnapshot: analysis.getDocumentSnapshot,
      getOriginalContent: analysis.getOriginalContentRef,
      getVersionContent: analysis.getVersionContentRef,
      rereadAfterMutation: analysis.rereadAfterMutation,

      getApiVersion: analysis.getApiVersion,
      getDocumentVersions: analysis.getDocumentVersions,
      getDocumentVersion: analysis.getDocumentVersion,
      selectOriginalPdfVersion: analysis.selectOriginalPdfVersion,
      downloadVersionPdf: analysis.downloadVersionPdf,
      patchVersionContent: analysis.patchVersionContent,
      uploadOcrPdfVersion: analysis.uploadOcrPdfVersion,
      updateVersionLabel: analysis.updateVersionLabel,
      pollVersionCreation: analysis.pollVersionCreation,

      getTags: catalog.getTags,
      getTag: catalog.getTag,
      getTagByName: catalog.getTagByName,
      getOrCreateTag: catalog.getOrCreateTag,
      addTagToDocument: catalog.addTagToDocument,
      removeTagFromDocument: catalog.removeTagFromDocument,
      transitionDocumentTag: catalog.transitionDocumentTag,
      deleteTag: catalog.deleteTag,
      renameTag: catalog.renameTag,
      updateTagColor: catalog.updateTagColor,
      mergeTags: catalog.mergeTags,

      getCorrespondents: catalog.getCorrespondents,
      getCorrespondent: catalog.getCorrespondent,
      getCorrespondentByName: catalog.getCorrespondentByName,
      getOrCreateCorrespondent: catalog.getOrCreateCorrespondent,
      deleteCorrespondent: catalog.deleteCorrespondent,
      renameCorrespondent: catalog.renameCorrespondent,
      mergeCorrespondents: catalog.mergeCorrespondents,

      getDocumentTypes: catalog.getDocumentTypes,
      getDocumentType: catalog.getDocumentType,
      getDocumentTypeByName: catalog.getDocumentTypeByName,
      getOrCreateDocumentType: catalog.getOrCreateDocumentType,
      deleteDocumentType: catalog.deleteDocumentType,
      renameDocumentType: catalog.renameDocumentType,
      mergeDocumentTypes: catalog.mergeDocumentTypes,

      getCustomFields: catalog.getCustomFields,
      getCustomField: catalog.getCustomField,

      addNote: catalog.addNote,
      getNotes: catalog.getNotes,

      getQueueStats: catalog.getQueueStats,
      getTotalDocumentCount: catalog.getTotalDocumentCount,
      submitBulkOperation: catalog.submitBulkOperation,
      pollTask: catalog.pollTask,

      testConnection: () =>
        pipe(
          catalog.getDocuments({ pageSize: 1 }),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
    } satisfies PaperlessService;
  }),
);
