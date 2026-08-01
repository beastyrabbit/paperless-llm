import type { PaperlessDocumentSnapshot, PaperlessTask, Sha256Digest } from "@repo/api-contracts";
import type { NotFoundError, PaperlessError } from "../../errors/index.js";
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

export interface PaperlessClientConfig {
  readonly url: string;
  readonly token: string;
  readonly requestTimeoutMs: number;
}

export type PaperlessConfigProvider = () => import("effect").Effect.Effect<
  PaperlessClientConfig,
  PaperlessError
>;

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export type PaperlessDocumentWithVersions = Document & {
  versions?: PaperlessDocumentVersion[];
};

export interface PaperlessHttpClient {
  readonly request: <T>(
    method: string,
    path: string,
    decode: (input: unknown) => T,
    body?: unknown,
    params?: Record<string, string | number | boolean>,
  ) => import("effect").Effect.Effect<T, PaperlessError | NotFoundError>;
  readonly binaryRequest: (
    method: string,
    path: string,
    params?: Record<string, string | number | boolean>,
  ) => import("effect").Effect.Effect<Uint8Array, PaperlessError | NotFoundError>;
  readonly multipartRequest: <T>(
    method: string,
    path: string,
    formData: FormData,
    decode: (input: unknown) => T,
  ) => import("effect").Effect.Effect<T, PaperlessError | NotFoundError>;
  readonly getAllPages: <T>(
    path: string,
    decodeItem: (input: unknown) => T,
    params?: Record<string, string | number | boolean>,
    options?: { pageSize?: number; maxPages?: number },
  ) => import("effect").Effect.Effect<Array<PaginatedResponse<T>>, PaperlessError | NotFoundError>;
  readonly getAllResults: <T>(
    path: string,
    decodeItem: (input: unknown) => T,
    params?: Record<string, string | number | boolean>,
    options?: { pageSize?: number; maxPages?: number },
  ) => import("effect").Effect.Effect<T[], PaperlessError | NotFoundError>;
}

export type PaperlessAssignmentKind = "tag" | "correspondent" | "document_type";

export interface PaperlessAssignmentFilterDescriptor {
  readonly path: "/documents/";
  readonly params: Readonly<
    Partial<Record<"tags__id" | "correspondent" | "document_type", number>>
  >;
}

export interface PaperlessAssignmentReceiptDocument {
  readonly documentId: number;
  readonly modified: string;
  readonly stateHash: Sha256Digest;
  readonly verifiedMembership: true;
}

export interface PaperlessAssignmentReceipt {
  readonly kind: PaperlessAssignmentKind;
  readonly entityId: number;
  readonly filterDescriptor: PaperlessAssignmentFilterDescriptor;
  readonly expectedApiCount: number;
  readonly fetchedCount: number;
  readonly pageCount: number;
  readonly documentIds: readonly number[];
  readonly documents: readonly PaperlessAssignmentReceiptDocument[];
  readonly capturedAt: string;
  readonly assignmentHash: Sha256Digest;
  readonly complete: true;
}

export interface PaperlessTaskPollOptions {
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly signal?: AbortSignal;
}

export interface PaperlessAssignmentEnumeration {
  readonly kind: PaperlessAssignmentKind;
  readonly xId: number;
  readonly yId: number;
  readonly xDocumentIds: readonly number[];
  readonly yDocumentIds: readonly number[];
  readonly xOnlyDocumentIds: readonly number[];
  readonly yOnlyDocumentIds: readonly number[];
  readonly bothDocumentIds: readonly number[];
  readonly xReceipt?: PaperlessAssignmentReceipt;
  readonly yReceipt?: PaperlessAssignmentReceipt;
  readonly xProof?: PaperlessAssignmentReceipt;
  readonly yProof?: PaperlessAssignmentReceipt;
}

export type PaperlessTaskEffect = import("effect").Effect.Effect<PaperlessTask, PaperlessErrorType>;

export type PaperlessSnapshotForReceipt = PaperlessDocumentSnapshot;
