/**
 * Layer composition for the application.
 */
import { Layer } from 'effect';
import { ConfigServiceLive } from '../config/index.js';
import {
  PaperlessServiceLive,
  TinyBaseServiceLive,
  OllamaServiceLive,
  MistralServiceLive,
  PromptServiceLive,
  QdrantServiceLive,
} from '../services/index.js';
import {
  BootstrapJobServiceLive,
  SchemaCleanupJobServiceLive,
  BulkOcrJobServiceLive,
} from '../jobs/index.js';

/**
 * Configuration layer - foundation for all other layers.
 */
export const ConfigLayer = ConfigServiceLive();

/**
 * Database layer - requires Config.
 */
export const DatabaseLayer = Layer.provideMerge(
  TinyBaseServiceLive,
  ConfigLayer
);

/**
 * External services layer - requires Config.
 * Note: PaperlessService is NOT included here as it depends on TinyBaseService.
 * Use CoreServicesLayer or AppLayer for full service access.
 */
export const ExternalServicesLayer = Layer.provideMerge(
  Layer.mergeAll(
    OllamaServiceLive,
    MistralServiceLive,
    PromptServiceLive
  ),
  ConfigLayer
);

/**
 * Base services layer - services with minimal dependencies.
 */
const BaseServicesLayer = Layer.mergeAll(
  OllamaServiceLive,
  MistralServiceLive,
  PromptServiceLive
);

/**
 * Core services layer - all fundamental services.
 * QdrantService depends on TinyBaseService + OllamaService, so we build the layers in order:
 * 1. TinyBase + Base services (Ollama, Mistral, Prompt)
 * 2. Then Paperless + Qdrant on top
 */
const CoreServicesLayer = Layer.provideMerge(
  Layer.mergeAll(
    PaperlessServiceLive,
    QdrantServiceLive
  ),
  Layer.provideMerge(
    BaseServicesLayer,
    TinyBaseServiceLive
  )
);

/**
 * Jobs layer - requires core services.
 */
const JobsLayer = Layer.mergeAll(
  BootstrapJobServiceLive,
  SchemaCleanupJobServiceLive,
  BulkOcrJobServiceLive
);

/**
 * Full application layer with all services including jobs.
 */
export const AppLayer = Layer.provideMerge(
  JobsLayer,
  Layer.provideMerge(CoreServicesLayer, ConfigLayer)
);

/**
 * Minimal layer for testing (Config + TinyBase only).
 */
export const TestLayer = DatabaseLayer;
