/**
 * Layer composition for the application.
 */
import { Layer } from "effect";
import {
  OCRAgentServiceLive,
  PiConsolidationAgentServiceLive,
  PiDocumentAgentServiceLive,
  ProcessingPipelineServiceLive,
} from "../agents/index.js";
import { ConfigServiceLive } from "../config/index.js";
import {
  BootstrapJobServiceLive,
  BulkIngestJobServiceLive,
  BulkOcrJobServiceLive,
  SchemaCleanupJobServiceLive,
} from "../jobs/index.js";
import {
  AutoProcessingServiceLive,
  MistralServiceLive,
  OllamaServiceLive,
  PaperlessServiceLive,
  QdrantServiceLive,
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
export const ExternalServicesLayer = Layer.provideMerge(
  Layer.mergeAll(OllamaServiceLive, MistralServiceLive),
  ConfigLayer,
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
const CoreServicesLayer = Layer.provideMerge(
  Layer.mergeAll(PaperlessServiceLive, QdrantServiceLive),
  Layer.provideMerge(BaseServicesLayer, TinyBaseServiceLive),
);

/**
 * Agents layer - all document processing agents.
 */
const AgentsLayer = Layer.mergeAll(
  OCRAgentServiceLive,
  PiDocumentAgentServiceLive,
  PiConsolidationAgentServiceLive,
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
 * Requires all agents to be provided first.
 */
const PipelineLayer = Layer.provideMerge(ProcessingPipelineServiceLive, AgentsLayer);

/**
 * Full application layer with all services including jobs and agents.
 * AutoProcessingServiceLive depends on ProcessingPipelineService, so it must be
 * provided after PipelineLayer is resolved.
 */
export const AppLayer = Layer.provideMerge(
  AutoProcessingServiceLive,
  Layer.provideMerge(
    Layer.mergeAll(JobsLayer, PipelineLayer),
    Layer.provideMerge(CoreServicesLayer, ConfigLayer),
  ),
);

/**
 * Minimal layer for testing (Config + TinyBase only).
 */
export const TestLayer = DatabaseLayer;
