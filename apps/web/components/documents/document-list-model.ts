import { parsePositiveSafeIntString } from "@repo/api-contracts";
import type { DocumentDetail, DocumentSummary, Settings } from "@/lib/api";

export type DocumentTagMap = Record<string, string>;

export const getNumericSearchId = (search: string): number | null => parsePositiveSafeIntString(search);

export const createDocumentTagMap = (settings: Settings): DocumentTagMap => ({
  queued: settings.tags.todo,
  processing: settings.tags.ocr,
  todo: settings.tags.todo,
  ocr: settings.tags.ocr,
  metadata: settings.tags.metadata,
  review: settings.tags.review,
  index: settings.tags.index,
  done: settings.tags.done,
  pending: settings.tags.pending,
  ocr_done: settings.tags.ocr_done,
  summary_done: settings.tags.summary_done,
  schema_review: settings.tags.schema_review,
  correspondent_done: settings.tags.correspondent_done,
  document_type_done: settings.tags.document_type_done,
  title_done: settings.tags.title_done,
  tags_done: settings.tags.tags_done,
  processed: settings.tags.processed,
  failed: settings.tags.failed,
  manual_review: settings.tags.manual_review,
});

export const documentDetailToSummary = (document: DocumentDetail): DocumentSummary => ({
  id: document.id,
  title: document.title,
  correspondent: document.correspondent,
  created: document.created,
  tags: document.tags.map((tag) => tag.name),
  processing_status: document.processing_status,
});

export const documentMatchesStatus = (
  document: DocumentSummary,
  statusFilter: string,
  tagMap: DocumentTagMap,
): boolean => {
  if (statusFilter === "all") return true;
  const workflowTag = tagMap[statusFilter];
  return (
    document.processing_status === statusFilter ||
    Boolean(workflowTag && document.tags.includes(workflowTag))
  );
};

export const filterDocuments = (
  documents: DocumentSummary[],
  options: {
    statusFilter: string;
    search: string;
    tagMap: DocumentTagMap;
    directDocument: DocumentSummary | null;
  },
): DocumentSummary[] => {
  const searchLower = options.search.toLowerCase().trim();

  if (searchLower) {
    const matches = documents.filter(
      (document) =>
        document.title.toLowerCase().includes(searchLower) ||
        document.correspondent?.toLowerCase().includes(searchLower) ||
        String(document.id).includes(searchLower),
    );
    if (
      options.directDocument &&
      !matches.some((document) => document.id === options.directDocument?.id)
    ) {
      return [options.directDocument, ...matches];
    }
    return matches;
  }

  return documents.filter((document) =>
    documentMatchesStatus(document, options.statusFilter, options.tagMap),
  );
};
