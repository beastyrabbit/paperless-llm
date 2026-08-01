import { Effect } from "effect";
import type { PaperlessAssignmentReceipt } from "../paperless/types.js";
import { digest, idsHash } from "./hash.js";
import type { CatalogEvidenceReadPort } from "./read-port.js";
import type {
  AssignmentFilterDescriptor,
  AssignmentSets,
  CatalogEvidenceEntity,
  CatalogEvidenceKind,
  CatalogEvidenceSnapshot,
  EntityAssignmentReceipt,
} from "./types.js";

export const hasAssignment = (
  snapshot: CatalogEvidenceSnapshot,
  kind: CatalogEvidenceKind,
  entityId: number,
): boolean => {
  if (kind === "tag") return snapshot.tagIds.includes(entityId);
  if (kind === "correspondent") return snapshot.correspondentId === entityId;
  return snapshot.documentTypeId === entityId;
};

export const assignmentSets = (
  xDocumentIds: readonly number[],
  yDocumentIds: readonly number[],
): AssignmentSets => {
  const x = new Set(xDocumentIds);
  const y = new Set(yDocumentIds);
  return {
    xOnlyDocumentIds: [...x].filter((id) => !y.has(id)).sort((left, right) => left - right),
    yOnlyDocumentIds: [...y].filter((id) => !x.has(id)).sort((left, right) => left - right),
    bothDocumentIds: [...x].filter((id) => y.has(id)).sort((left, right) => left - right),
    unionDocumentIds: [...new Set([...xDocumentIds, ...yDocumentIds])].sort(
      (left, right) => left - right,
    ),
  };
};

export const filterDescriptorFor = (
  kind: CatalogEvidenceKind,
  entityId: number,
): AssignmentFilterDescriptor => {
  if (kind === "tag") return { path: "/documents/", params: { tags__id: entityId } };
  if (kind === "correspondent") {
    return { path: "/documents/", params: { correspondent: entityId } };
  }
  return { path: "/documents/", params: { document_type: entityId } };
};

const descriptorEquals = (left: AssignmentFilterDescriptor, right: AssignmentFilterDescriptor) =>
  left.path === right.path && JSON.stringify(left.params) === JSON.stringify(right.params);

export const normalizePaperlessReceipt = ({
  receipt,
  entity,
}: {
  readonly receipt: PaperlessAssignmentReceipt;
  readonly entity: CatalogEvidenceEntity;
}): EntityAssignmentReceipt => {
  const expectedDescriptor = filterDescriptorFor(receipt.kind, entity.id);
  const consistencyErrors: string[] = [];
  const documentIds = [...new Set(receipt.documentIds)].sort((left, right) => left - right);
  const rawDocumentIds = receipt.documentIds;

  if (receipt.entityId !== entity.id) {
    consistencyErrors.push(
      `receipt entity ${receipt.entityId} does not match requested entity ${entity.id}`,
    );
  }
  if (!descriptorEquals(receipt.filterDescriptor, expectedDescriptor)) {
    consistencyErrors.push(
      `receipt used ${JSON.stringify(receipt.filterDescriptor)} instead of ${JSON.stringify(expectedDescriptor)}`,
    );
  }
  if (new Set(rawDocumentIds).size !== rawDocumentIds.length) {
    consistencyErrors.push("receipt returned duplicate document IDs");
  }
  if (receipt.expectedApiCount !== receipt.fetchedCount) {
    consistencyErrors.push(
      `expected ${receipt.expectedApiCount} ${receipt.kind} assignments but fetched ${receipt.fetchedCount}`,
    );
  }
  if (receipt.fetchedCount !== documentIds.length) {
    consistencyErrors.push(
      `fetched count ${receipt.fetchedCount} does not match ${documentIds.length} sorted IDs`,
    );
  }
  if (receipt.documents.length !== documentIds.length) {
    consistencyErrors.push("receipt document-state count does not match document IDs");
  }
  for (const document of receipt.documents) {
    if (document.verifiedMembership !== true) {
      consistencyErrors.push(
        `document ${document.documentId} has unverified assignment membership`,
      );
    }
  }
  if (receipt.complete !== true) {
    consistencyErrors.push("receipt is not complete");
  }

  if (consistencyErrors.length > 0) {
    throw new Error(`Invalid Paperless assignment receipt: ${consistencyErrors.join("; ")}`);
  }

  const documents = [...receipt.documents]
    .map((document) => ({
      documentId: document.documentId,
      modified: document.modified,
      stateHash: document.stateHash,
    }))
    .sort((left, right) => left.documentId - right.documentId);

  return {
    kind: receipt.kind,
    entityId: entity.id,
    name: entity.name,
    filterDescriptor: receipt.filterDescriptor,
    expectedApiCount: receipt.expectedApiCount,
    fetchedCount: receipt.fetchedCount,
    nameHash: digest("catalog_evidence_entity_name", {
      kind: receipt.kind,
      entityId: entity.id,
      name: entity.name,
    }),
    documentIds,
    receiptCount: documentIds.length,
    documentIdsHash: idsHash(documentIds),
    documents,
    assignmentHash: receipt.assignmentHash,
    stateHash: digest("catalog_evidence_entity_receipt", {
      kind: receipt.kind,
      entityId: entity.id,
      nameHash: digest("catalog_evidence_entity_name", {
        kind: receipt.kind,
        entityId: entity.id,
        name: entity.name,
      }),
      filterDescriptor: receipt.filterDescriptor,
      expectedApiCount: receipt.expectedApiCount,
      fetchedCount: receipt.fetchedCount,
      pageCount: receipt.pageCount,
      capturedAt: receipt.capturedAt,
      documentIds,
      documents,
      assignmentHash: receipt.assignmentHash,
    }),
    pageCount: receipt.pageCount,
    capturedAt: receipt.capturedAt,
    complete: true,
    consistencyErrors: [],
  };
};

export const readAssignmentReceipt = ({
  readPort,
  kind,
  entity,
}: {
  readonly readPort: CatalogEvidenceReadPort;
  readonly kind: CatalogEvidenceKind;
  readonly entity: CatalogEvidenceEntity;
}): Effect.Effect<EntityAssignmentReceipt, unknown> =>
  Effect.gen(function* () {
    const receipt = yield* readPort.readAssignmentReceipt(kind, entity.id);
    return normalizePaperlessReceipt({ receipt, entity });
  });
