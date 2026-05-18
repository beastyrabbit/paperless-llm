import type { Document } from "../models/index.js";

export type ProcessingState = "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed";

export type WorkflowTagsConfig = Partial<
  Record<
    | "todo"
    | "ocr"
    | "metadata"
    | "review"
    | "index"
    | "done"
    | "failed"
    | "pending"
    | "ocrDone"
    | "summaryDone"
    | "schemaReview"
    | "titleDone"
    | "correspondentDone"
    | "documentTypeDone"
    | "tagsDone"
    | "processed"
    | "manualReview",
    string | undefined
  >
>;

export const normalizeWorkflowTagName = (name: string): string => name.trim().toLowerCase();

export const uniqueConfiguredTagNames = (...names: Array<string | null | undefined>): string[] => [
  ...new Set(names.filter((name): name is string => typeof name === "string" && name.trim().length > 0)),
];

export const getWorkflowTagNames = (tagConfig: Record<string, unknown>): Set<string> =>
  new Set(
    Object.values(tagConfig)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map(normalizeWorkflowTagName),
  );

export const isConfiguredWorkflowTagName = (
  name: string,
  workflowTagNames: ReadonlySet<string>,
): boolean => workflowTagNames.has(normalizeWorkflowTagName(name));

export const isWorkflowTagName = (
  name: string,
  workflowTagNames: ReadonlySet<string>,
): boolean => {
  const normalized = normalizeWorkflowTagName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};

export const getDocumentTagNames = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagNameById?: ReadonlyMap<number, string>,
): string[] => {
  if (doc.tag_names && doc.tag_names.length > 0) return [...doc.tag_names];
  if (!tagNameById) return [];
  return (doc.tags ?? [])
    .map((id) => tagNameById.get(id))
    .filter((name): name is string => name !== undefined);
};

const hasConfiguredTag = (tagNames: readonly string[], configuredName: string | undefined): boolean =>
  typeof configuredName === "string" && tagNames.includes(configuredName);

const hasAnyConfiguredTag = (
  tagNames: readonly string[],
  ...configuredNames: Array<string | undefined>
): boolean => configuredNames.some((name) => hasConfiguredTag(tagNames, name));

export const getProcessingStateFromTagNames = (
  tagNames: readonly string[],
  tagConfig: WorkflowTagsConfig,
): ProcessingState => {
  if (hasConfiguredTag(tagNames, tagConfig.failed)) return "failed";
  if (hasAnyConfiguredTag(tagNames, tagConfig.done, tagConfig.processed)) return "done";
  if (hasAnyConfiguredTag(tagNames, tagConfig.review, tagConfig.manualReview, tagConfig.schemaReview)) {
    return "review";
  }
  if (
    typeof tagConfig.ocr === "string" &&
    tagConfig.ocr === tagConfig.metadata &&
    tagConfig.metadata === tagConfig.index &&
    tagNames.includes(tagConfig.ocr)
  ) {
    return "metadata";
  }
  if (hasAnyConfiguredTag(tagNames, tagConfig.index, tagConfig.tagsDone)) return "index";
  if (
    hasAnyConfiguredTag(
      tagNames,
      tagConfig.metadata,
      tagConfig.summaryDone,
      tagConfig.titleDone,
      tagConfig.correspondentDone,
      tagConfig.documentTypeDone,
    )
  ) {
    return "metadata";
  }
  if (hasAnyConfiguredTag(tagNames, tagConfig.ocr, tagConfig.ocrDone)) return "ocr";
  if (hasAnyConfiguredTag(tagNames, tagConfig.todo, tagConfig.pending)) return "todo";
  return "todo";
};

export const getProcessingStateFromDocumentTags = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagConfig: WorkflowTagsConfig,
  tagNameById?: ReadonlyMap<number, string>,
): ProcessingState => getProcessingStateFromTagNames(getDocumentTagNames(doc, tagNameById), tagConfig);

export const getWorkflowTagForState = (
  state: ProcessingState,
  tagConfig: WorkflowTagsConfig,
): string | null => tagConfig[state] ?? null;
