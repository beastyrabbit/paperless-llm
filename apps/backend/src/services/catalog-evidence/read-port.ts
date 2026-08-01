import type { PageInfo } from "@repo/api-contracts";
import type { Effect } from "effect";
import type { Correspondent, Document, DocumentType, Tag } from "../../models/index.js";
import type { PaperlessAssignmentReceipt } from "../paperless/types.js";
import type {
  CatalogEvidenceKind,
  CatalogEvidencePolicy,
  CatalogEvidenceSnapshot,
  CatalogObservation,
} from "./types.js";

export type CatalogEvidenceDocumentCitationSource = Pick<
  Document,
  "id" | "title" | "content" | "created" | "modified" | "correspondent" | "document_type" | "tags"
>;

export interface CatalogEvidenceReadPort {
  readonly observeCatalog: (
    scope: readonly CatalogEvidenceKind[],
  ) => Effect.Effect<CatalogObservation, unknown>;
  readonly getPolicy: () => Effect.Effect<CatalogEvidencePolicy, unknown>;
  readonly listEntities: (
    kind: CatalogEvidenceKind,
  ) => Effect.Effect<readonly (Tag | Correspondent | DocumentType)[], unknown>;
  readonly listDocumentSnapshotsPage: (request: {
    readonly cursor?: string;
    readonly limit?: number;
  }) => Effect.Effect<
    {
      readonly items: readonly CatalogEvidenceSnapshot[];
      readonly page: PageInfo;
    },
    unknown
  >;
  readonly readAssignmentReceipt: (
    kind: CatalogEvidenceKind,
    entityId: number,
  ) => Effect.Effect<PaperlessAssignmentReceipt, unknown>;
  readonly getDocumentCitationSource: (
    documentId: number,
  ) => Effect.Effect<CatalogEvidenceDocumentCitationSource, unknown>;
}
