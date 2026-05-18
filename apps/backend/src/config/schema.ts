/**
 * Configuration schema definitions using Effect Schema.
 */
import { Schema } from "effect";

// Paperless configuration
export const PaperlessConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  token: Schema.String.pipe(Schema.optional),
});

// Ollama configuration
export const OllamaConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  embeddingModel: Schema.String.pipe(Schema.optional),
});

// Mistral configuration
export const MistralConfigSchema = Schema.Struct({
  apiKey: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  apiBaseUrl: Schema.String.pipe(Schema.optional),
});

// Qdrant configuration
export const QdrantConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  collectionName: Schema.String.pipe(Schema.optional),
  embeddingDimension: Schema.Number.pipe(Schema.optional),
});

// OCR budget configuration. null/omitted means unlimited; configured limits must be positive integers.
const OcrBudgetLimitSchema = Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive()));
export const OcrBudgetConfigSchema = Schema.Struct({
  dailyPageLimit: OcrBudgetLimitSchema.pipe(Schema.optional),
  runPageLimit: OcrBudgetLimitSchema.pipe(Schema.optional),
  dailyTokenLimit: OcrBudgetLimitSchema.pipe(Schema.optional),
  runTokenLimit: OcrBudgetLimitSchema.pipe(Schema.optional),
});

// Auto processing configuration
export const AutoProcessingConfigSchema = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.optional),
  intervalMinutes: Schema.Number.pipe(Schema.optional),
  includeUntagged: Schema.Boolean.pipe(Schema.optional),
  confirmationEnabled: Schema.Boolean.pipe(Schema.optional),
  confirmationMaxRetries: Schema.Number.pipe(Schema.optional),
  confirmationMinConfidence: Schema.Number.pipe(Schema.optional),
});

// Tags configuration
export const TagsConfigSchema = Schema.Struct({
  todo: Schema.String.pipe(Schema.optional),
  ocr: Schema.String.pipe(Schema.optional),
  metadata: Schema.String.pipe(Schema.optional),
  review: Schema.String.pipe(Schema.optional),
  index: Schema.String.pipe(Schema.optional),
  done: Schema.String.pipe(Schema.optional),
  failed: Schema.String.pipe(Schema.optional),
  // Compatibility aliases for settings created by the pre-Pi workflow.
  pending: Schema.String.pipe(Schema.optional),
  ocrDone: Schema.String.pipe(Schema.optional),
  summaryDone: Schema.String.pipe(Schema.optional),
  schemaReview: Schema.String.pipe(Schema.optional),
  titleDone: Schema.String.pipe(Schema.optional),
  correspondentDone: Schema.String.pipe(Schema.optional),
  documentTypeDone: Schema.String.pipe(Schema.optional),
  tagsDone: Schema.String.pipe(Schema.optional),
  processed: Schema.String.pipe(Schema.optional),
  manualReview: Schema.String.pipe(Schema.optional),
});

// Pipeline configuration
export const PipelineConfigSchema = Schema.Struct({
  enableOcr: Schema.Boolean.pipe(Schema.optional),
  enableSummary: Schema.Boolean.pipe(Schema.optional),
  enableTitle: Schema.Boolean.pipe(Schema.optional),
  enableCorrespondent: Schema.Boolean.pipe(Schema.optional),
  enableDocumentType: Schema.Boolean.pipe(Schema.optional),
  enableTags: Schema.Boolean.pipe(Schema.optional),
  enableCustomFields: Schema.Boolean.pipe(Schema.optional),
  enableDocumentLinks: Schema.Boolean.pipe(Schema.optional),
  maxSteps: Schema.Number.pipe(Schema.optional),
});

// Shared concurrency cap configuration
export const ConcurrencyConfigSchema = Schema.Struct({
  ollamaMaxConcurrent: Schema.Number.pipe(Schema.optional),
  mistralMaxConcurrent: Schema.Number.pipe(Schema.optional),
  ocrMaxConcurrent: Schema.Number.pipe(Schema.optional),
});

// HTTP/runtime safety configuration
export const HttpConfigSchema = Schema.Struct({
  requestTimeoutMs: Schema.Number.pipe(Schema.optional),
  agentPromptTimeoutMs: Schema.Number.pipe(Schema.optional),
  mistralRetryAttempts: Schema.Number.pipe(Schema.optional),
  mistralRetryBaseDelayMs: Schema.Number.pipe(Schema.optional),
  rateLimitEnabled: Schema.Boolean.pipe(Schema.optional),
  rateLimitWindowMs: Schema.Number.pipe(Schema.optional),
  rateLimitMaxRequests: Schema.Number.pipe(Schema.optional),
  rateLimitTrustProxy: Schema.Boolean.pipe(Schema.optional),
});

// Full app configuration
export const AppConfigSchema = Schema.Struct({
  paperless: PaperlessConfigSchema.pipe(Schema.optional),
  ollama: OllamaConfigSchema.pipe(Schema.optional),
  mistral: MistralConfigSchema.pipe(Schema.optional),
  qdrant: QdrantConfigSchema.pipe(Schema.optional),
  ocrBudget: OcrBudgetConfigSchema.pipe(Schema.optional),
  autoProcessing: AutoProcessingConfigSchema.pipe(Schema.optional),
  tags: TagsConfigSchema.pipe(Schema.optional),
  pipeline: PipelineConfigSchema.pipe(Schema.optional),
  http: HttpConfigSchema.pipe(Schema.optional),
  concurrency: ConcurrencyConfigSchema.pipe(Schema.optional),
  language: Schema.String.pipe(Schema.optional),
  debug: Schema.Boolean.pipe(Schema.optional),
});

// Infer types from schemas
export type PaperlessConfig = Schema.Schema.Type<typeof PaperlessConfigSchema>;
export type OllamaConfig = Schema.Schema.Type<typeof OllamaConfigSchema>;
export type MistralConfig = Schema.Schema.Type<typeof MistralConfigSchema>;
export type QdrantConfig = Schema.Schema.Type<typeof QdrantConfigSchema>;
export type OcrBudgetConfig = Schema.Schema.Type<typeof OcrBudgetConfigSchema>;
export type AutoProcessingConfig = Schema.Schema.Type<typeof AutoProcessingConfigSchema>;
export type TagsConfig = Schema.Schema.Type<typeof TagsConfigSchema>;
export type PipelineConfig = Schema.Schema.Type<typeof PipelineConfigSchema>;
export type HttpConfig = Schema.Schema.Type<typeof HttpConfigSchema>;
export type ConcurrencyConfig = Schema.Schema.Type<typeof ConcurrencyConfigSchema>;
export type AppConfig = Schema.Schema.Type<typeof AppConfigSchema>;

// Resolved configuration with defaults applied
export interface ResolvedConfig {
  paperless: {
    url: string;
    token: string;
  };
  ollama: {
    url: string;
    model: string;
    embeddingModel: string;
  };
  mistral: {
    apiKey: string;
    model: string;
    apiBaseUrl: string;
  };
  qdrant: {
    url: string;
    collectionName: string;
    embeddingDimension: number;
  };
  ocrBudget: {
    dailyPageLimit: number | null;
    runPageLimit: number | null;
    dailyTokenLimit: number | null;
    runTokenLimit: number | null;
  };
  autoProcessing: {
    enabled: boolean;
    intervalMinutes: number;
    includeUntagged: boolean;
    confirmationEnabled: boolean;
    confirmationMaxRetries: number;
    confirmationMinConfidence: number;
  };
  tags: {
    todo: string;
    ocr: string;
    metadata: string;
    review: string;
    index: string;
    done: string;
    failed: string;
    // Compatibility aliases for older code paths and persisted settings.
    pending: string;
    ocrDone: string;
    summaryDone: string;
    schemaReview: string;
    titleDone: string;
    correspondentDone: string;
    documentTypeDone: string;
    tagsDone: string;
    processed: string;
    manualReview: string;
  };
  pipeline: {
    enableOcr: boolean;
    enableSummary: boolean;
    enableTitle: boolean;
    enableCorrespondent: boolean;
    enableDocumentType: boolean;
    enableTags: boolean;
    enableCustomFields: boolean;
    enableDocumentLinks: boolean;
    maxSteps: number;
  };
  http: {
    requestTimeoutMs: number;
    agentPromptTimeoutMs: number;
    mistralRetryAttempts: number;
    mistralRetryBaseDelayMs: number;
    rateLimitEnabled: boolean;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
    rateLimitTrustProxy: boolean;
  };
  concurrency: {
    ollamaMaxConcurrent: number;
    mistralMaxConcurrent: number;
    ocrMaxConcurrent: number;
  };
  language: string;
  debug: boolean;
}
