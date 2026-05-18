import type { PaperlessDocumentVersion } from "./types.js";

export const normalizeVersion = (
  version: PaperlessDocumentVersion,
  content?: string | null,
): PaperlessDocumentVersion => ({
  ...version,
  label: version.label ?? version.version_label ?? null,
  version_label: version.version_label ?? version.label ?? null,
  content: content ?? version.content ?? null,
  created: version.created ?? version.added,
});

export const versionSortKey = (version: PaperlessDocumentVersion): string =>
  version.created ?? version.added ?? "";
