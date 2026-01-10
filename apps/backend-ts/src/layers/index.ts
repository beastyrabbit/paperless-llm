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
 */
export const ExternalServicesLayer = Layer.provideMerge(
  Layer.mergeAll(
    PaperlessServiceLive,
    OllamaServiceLive,
    MistralServiceLive,
    PromptServiceLive
  ),
  ConfigLayer
);

/**
 * Core services layer - all fundamental services.
 * PaperlessService depends on TinyBaseService, so we provide TinyBase first.
 */
const CoreServicesLayer = Layer.provideMerge(
  Layer.mergeAll(
    PaperlessServiceLive,
    OllamaServiceLive,
    MistralServiceLive,
    PromptServiceLive
  ),
  TinyBaseServiceLive
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
