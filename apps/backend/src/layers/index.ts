/**
 * Layer composition for the application.
 */
import { canonicalSha256 } from "@repo/api-contracts";
import { Effect, Layer, Option } from "effect";
import {
  OCRAgentServiceLive,
  PiConsolidationAgentServiceLive,
  PiDocumentAgentServiceLive,
  PiTagExplorerAgentServiceLive,
  ProcessingPipelineServiceLive,
} from "../agents/index.js";
import { ConfigServiceLive } from "../config/index.js";
import {
  BootstrapJobServiceLive,
  BulkIngestJobServiceLive,
  BulkOcrJobServiceLive,
  SchemaCleanupJobServiceLive,
} from "../jobs/index.js";
import { TracingLayer } from "../observability/tracing.js";
import {
  AutoProcessingServiceLive,
  CatalogAgentServiceLive,
  CatalogApplyLedgerPort,
  CatalogApplyMutationPort,
  type CatalogApplySupportedKind,
  CatalogApplyServiceLive,
  CatalogCouncilServiceLive,
  CatalogEvidenceServiceLive,
  ConcurrencyLimitServiceLive,
  CodexRuntimeServiceLive,
  DocumentAuthorizationServiceLive,
  DocumentAnalysisOrchestratorLive,
  DocumentCaseServiceLive,
  LockServiceLive,
  makeCatalogEvidenceReadPortFromPaperlessLive,
  MistralServiceLive,
  MistralOcrServiceLive,
  OcrUsageServiceLive,
  OllamaServiceLive,
  OperationalLedgerService,
  OperationalLedgerServiceLive,
  PaperlessService,
  PaperlessServiceLive,
  QdrantServiceLive,
  TagCacheServiceLive,
  TinyBaseServiceLive,
} from "../services/index.js";

/**
 * Configuration layer - foundation for all other layers.
 */
export const ConfigLayer = ConfigServiceLive();

/**
 * Database layer - requires Config.
 */
export const DatabaseLayer = Layer.provideMerge(TinyBaseServiceLive, ConfigLayer);

/**
 * External services layer - requires Config.
 * Note: PaperlessService is NOT included here as it depends on TinyBaseService.
 * Use CoreServicesLayer or AppLayer for full service access.
 */
export const ConcurrencyLayer = Layer.provideMerge(ConcurrencyLimitServiceLive, ConfigLayer);

export const ExternalServicesLayer = Layer.provideMerge(
  Layer.mergeAll(OllamaServiceLive, MistralServiceLive),
  Layer.mergeAll(ConfigLayer, ConcurrencyLayer),
);

/**
 * Base services layer - services with minimal dependencies.
 */
const BaseServicesLayer = Layer.mergeAll(OllamaServiceLive, MistralServiceLive);

/**
 * Core services layer - all fundamental services.
 * QdrantService depends on TinyBaseService + OllamaService, so we build the layers in order:
 * 1. TinyBase + Base services (Ollama, Mistral)
 * 2. Then Paperless + Qdrant on top
 */
const CoreServicesBaseLayer = Layer.provideMerge(
  Layer.mergeAll(PaperlessServiceLive, QdrantServiceLive),
  Layer.provideMerge(BaseServicesLayer, TinyBaseServiceLive),
);

const CoreServicesWithUsageLayer = Layer.provideMerge(
  OcrUsageServiceLive,
  Layer.mergeAll(ConfigLayer, DatabaseLayer),
);
const CoreServicesWithAuthorizationLayer = Layer.provideMerge(
  DocumentAuthorizationServiceLive,
  CoreServicesBaseLayer,
);
const CoreServicesLayer = Layer.provideMerge(
  TagCacheServiceLive(),
  Layer.mergeAll(CoreServicesWithAuthorizationLayer, CoreServicesWithUsageLayer),
);

const notFoundish = (error: unknown): boolean =>
  (error as { _tag?: string })?._tag === "NotFoundError" ||
  (error instanceof Error && error.name === "NotFoundError");

const entityToCatalogState = (
  kind: CatalogApplySupportedKind,
  entity: { readonly id: number; readonly name: string; readonly document_count?: number },
) => ({
  kind,
  entityId: entity.id,
  exists: true,
  name: entity.name,
  dependencyHash: canonicalSha256({
    kind: "catalog_apply_entity_state",
    entityKind: kind,
    entityId: entity.id,
    name: entity.name,
    documentCount: entity.document_count ?? null,
  }),
  blockedReasons: [],
});

const CatalogApplyMutationPortFromPaperlessLive = Layer.effect(
  CatalogApplyMutationPort,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const readEntity = (kind: CatalogApplySupportedKind, entityId: number) =>
      Effect.gen(function* () {
        const entity = yield* Effect.either(
          kind === "tag"
            ? paperless.getTag(entityId)
            : kind === "correspondent"
              ? paperless.getCorrespondent(entityId)
              : paperless.getDocumentType(entityId),
        );
        if (entity._tag === "Left") {
          if (notFoundish(entity.left)) return null;
          return yield* Effect.fail(entity.left);
        }
        return entityToCatalogState(kind, entity.right);
      });

    const findEntityByName = (kind: CatalogApplySupportedKind, name: string) =>
      Effect.gen(function* () {
        const entity =
          kind === "tag"
            ? yield* paperless.getTagByName(name)
            : kind === "correspondent"
              ? yield* paperless.getCorrespondentByName(name)
              : yield* paperless.getDocumentTypeByName(name);
        return Option.match(entity, {
          onNone: () => null,
          onSome: (value) => entityToCatalogState(kind, value),
        });
      });

    const readAssignmentReceipt = (kind: CatalogApplySupportedKind, entityId: number) => {
      if (kind === "tag") return paperless.readTagAssignmentReceipt(entityId);
      if (kind === "correspondent") {
        return paperless.readCorrespondentAssignmentReceipt(entityId);
      }
      return paperless.readDocumentTypeAssignmentReceipt(entityId);
    };

    return {
      readEntity,
      findEntityByName,
      readAssignmentReceipt,
      readDocumentMutationState: (kind, documentId, sourceEntityId, targetEntityId) =>
        Effect.gen(function* () {
          const document = yield* paperless.getDocument(documentId);
          const tagIds = new Set(document.tags);
          const hasSourceAssignment =
            kind === "tag"
              ? tagIds.has(sourceEntityId)
              : kind === "correspondent"
                ? document.correspondent === sourceEntityId
                : document.document_type === sourceEntityId;
          const hasTargetAssignment =
            targetEntityId !== null &&
            (kind === "tag"
              ? tagIds.has(targetEntityId)
              : kind === "correspondent"
                ? document.correspondent === targetEntityId
                : document.document_type === targetEntityId);
          return {
            documentId,
            hasSourceAssignment,
            hasTargetAssignment,
            assignmentHash: canonicalSha256({
              kind: "catalog_apply_document_mutation_state",
              entityKind: kind,
              documentId,
              modified: document.modified,
              sourceEntityId,
              targetEntityId,
              correspondent: document.correspondent,
              documentType: document.document_type,
              tags: [...document.tags].sort((left, right) => left - right),
            }),
          };
        }),
      submitAssignmentBatch: (request) =>
        paperless.submitBulkOperation(request as Parameters<typeof paperless.submitBulkOperation>[0]),
      pollTask: (taskId, options) => paperless.pollTask(taskId, options),
      deleteEntity: (kind, entityId) => {
        if (kind === "tag") return paperless.deleteTag(entityId);
        if (kind === "correspondent") return paperless.deleteCorrespondent(entityId);
        return paperless.deleteDocumentType(entityId);
      },
      renameEntity: (kind, entityId, name) => {
        if (kind === "tag") return paperless.renameTag(entityId, name);
        if (kind === "correspondent") return paperless.renameCorrespondent(entityId, name);
        return paperless.renameDocumentType(entityId, name);
      },
      invalidateCatalogCache: () => Effect.void,
    };
  }),
);

const CatalogApplyLedgerPortFromOperationalLedgerLive = Layer.effect(
  CatalogApplyLedgerPort,
  Effect.gen(function* () {
    const ledger = yield* OperationalLedgerService;
    return {
      getSnapshot: ledger.getSnapshot,
      recordApplyJournal: ledger.recordApplyJournal,
      acquireLease: ledger.acquireLease,
      heartbeatLease: ledger.heartbeatLease,
      releaseLease: ledger.releaseLease,
      recordProposalDecision: ledger.recordProposalDecision,
    };
  }),
);

/**
 * Agents layer - all document processing agents.
 */
const AgentsLayer = Layer.provideMerge(
  Layer.mergeAll(OCRAgentServiceLive, PiDocumentAgentServiceLive, PiConsolidationAgentServiceLive),
  Layer.mergeAll(DocumentCaseServiceLive, PiTagExplorerAgentServiceLive),
);

/**
 * Jobs layer - requires core services and the manual consolidation agent.
 */
const JobsLayer = Layer.provideMerge(
  Layer.mergeAll(
    BootstrapJobServiceLive,
    SchemaCleanupJobServiceLive,
    BulkOcrJobServiceLive,
    BulkIngestJobServiceLive,
  ),
  AgentsLayer,
);

/**
 * Processing Pipeline layer - orchestrates all agents.
 * Requires all agents and the durable lock service to be provided first.
 */
const PipelineLayer = Layer.provideMerge(
  ProcessingPipelineServiceLive,
  Layer.mergeAll(AgentsLayer, LockServiceLive),
);

/**
 * Case/catalog services - durable document case and taxonomy proposal APIs.
 */
const CaseCatalogLayer = Layer.provideMerge(
  Layer.mergeAll(DocumentCaseServiceLive, CatalogAgentServiceLive),
  Layer.mergeAll(LockServiceLive, PiConsolidationAgentServiceLive),
);

/**
 * Paperless-first analysis/catalog services. Command handlers schedule work
 * but these layers keep mutation ports backed by real Paperless and the durable
 * operational ledger.
 */
const MistralOcrLayer = Layer.provideMerge(
  MistralOcrServiceLive,
  Layer.mergeAll(ConfigLayer, ConcurrencyLayer),
);
const CatalogEvidenceLayer = Layer.provideMerge(
  CatalogEvidenceServiceLive,
  makeCatalogEvidenceReadPortFromPaperlessLive({}),
);
const CatalogApplyLedgerPortLayer = Layer.provideMerge(
  CatalogApplyLedgerPortFromOperationalLedgerLive,
  OperationalLedgerServiceLive,
);
const PaperlessFirstBaseLayer = Layer.mergeAll(
  OperationalLedgerServiceLive,
  MistralOcrLayer,
  CodexRuntimeServiceLive(),
  CatalogEvidenceLayer,
  CatalogApplyMutationPortFromPaperlessLive,
  CatalogApplyLedgerPortLayer,
);
const PaperlessFirstServicesLayer = Layer.provideMerge(
  Layer.mergeAll(
    CatalogCouncilServiceLive,
    CatalogApplyServiceLive,
    DocumentAnalysisOrchestratorLive(),
  ),
  PaperlessFirstBaseLayer,
);

/**
 * Full application layer with all services including jobs and agents.
 * AutoProcessingServiceLive depends on ProcessingPipelineService, so it must be
 * provided after PipelineLayer is resolved.
 */
const ServicesAppLayer = Layer.provideMerge(
  AutoProcessingServiceLive,
  Layer.provideMerge(
    Layer.mergeAll(JobsLayer, PipelineLayer, CaseCatalogLayer, PaperlessFirstServicesLayer),
    Layer.provideMerge(CoreServicesLayer, Layer.mergeAll(ConfigLayer, ConcurrencyLayer)),
  ),
);

export const AppLayer = Layer.mergeAll(ServicesAppLayer, TracingLayer);

/**
 * Minimal layer for testing (Config + TinyBase only).
 */
export const TestLayer = DatabaseLayer;
