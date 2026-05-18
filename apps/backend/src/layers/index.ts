/**
 * Layer composition for the application.
 */
import { Layer } from "effect";
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
  ConcurrencyLimitServiceLive,
  DocumentAuthorizationServiceLive,
  DocumentCaseServiceLive,
  LockServiceLive,
  MistralServiceLive,
  OcrUsageServiceLive,
  OllamaServiceLive,
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
 * Full application layer with all services including jobs and agents.
 * AutoProcessingServiceLive depends on ProcessingPipelineService, so it must be
 * provided after PipelineLayer is resolved.
 */
const ServicesAppLayer = Layer.provideMerge(
  AutoProcessingServiceLive,
  Layer.provideMerge(
    Layer.mergeAll(JobsLayer, PipelineLayer, CaseCatalogLayer),
    Layer.provideMerge(CoreServicesLayer, Layer.mergeAll(ConfigLayer, ConcurrencyLayer)),
  ),
);

export const AppLayer = Layer.mergeAll(ServicesAppLayer, TracingLayer);

/**
 * Minimal layer for testing (Config + TinyBase only).
 */
export const TestLayer = DatabaseLayer;
