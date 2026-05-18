import type { PaperlessError, NotFoundError } from "../../errors/index.js";
import type { Document } from "../../models/index.js";

// Common error type for all Paperless operations
export type PaperlessErrorType = PaperlessError | NotFoundError;

export interface PaperlessApiVersionInfo {
  api_version?: number;
  version?: string;
  paperless_version?: string;
  [key: string]: unknown;
}

export interface PaperlessDocumentVersion {
  id: number;
  document?: number;
  version?: number;
  label?: string | null;
  version_label?: string | null;
  content?: string | null;
  added?: string;
  created?: string;
  modified?: string;
  checksum?: string;
  is_root?: boolean;
  [key: string]: unknown;
}

export interface PaperlessVersionUploadResult {
  id?: number;
  version_id?: number;
  task_id?: string;
  document?: number;
  label?: string | null;
  version_label?: string | null;
  [key: string]: unknown;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type PaperlessDocumentWithVersions = Document & {
  versions?: PaperlessDocumentVersion[];
};
