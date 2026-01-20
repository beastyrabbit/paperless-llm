/**
 * Configuration schema definitions using Effect Schema.
 */
import { Schema } from 'effect';

// Paperless configuration
export const PaperlessConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  token: Schema.String.pipe(Schema.optional),
});

// Ollama configuration
export const OllamaConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  modelLarge: Schema.String.pipe(Schema.optional),
  modelSmall: Schema.String.pipe(Schema.optional),
});

// Mistral configuration
export const MistralConfigSchema = Schema.Struct({
  apiKey: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
});

// Qdrant configuration
export const QdrantConfigSchema = Schema.Struct({
  url: Schema.String.pipe(Schema.optional),
  collectionName: Schema.String.pipe(Schema.optional),
  embeddingDimension: Schema.Number.pipe(Schema.optional),
});

// Auto processing configuration
export const AutoProcessingConfigSchema = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.optional),
  intervalMinutes: Schema.Number.pipe(Schema.optional),
  confirmationEnabled: Schema.Boolean.pipe(Schema.optional),
  confirmationMaxRetries: Schema.Number.pipe(Schema.optional),
});

// Tags configuration
export const TagsConfigSchema = Schema.Struct({
  pending: Schema.String.pipe(Schema.optional),
  ocrDone: Schema.String.pipe(Schema.optional),
  summaryDone: Schema.String.pipe(Schema.optional),
  schemaReview: Schema.String.pipe(Schema.optional),
  titleDone: Schema.String.pipe(Schema.optional),
  correspondentDone: Schema.String.pipe(Schema.optional),
  documentTypeDone: Schema.String.pipe(Schema.optional),
  tagsDone: Schema.String.pipe(Schema.optional),
  processed: Schema.String.pipe(Schema.optional),
  failed: Schema.String.pipe(Schema.optional),
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
});

// Full app configuration
export const AppConfigSchema = Schema.Struct({
  paperless: PaperlessConfigSchema.pipe(Schema.optional),
  ollama: OllamaConfigSchema.pipe(Schema.optional),
  mistral: MistralConfigSchema.pipe(Schema.optional),
  qdrant: QdrantConfigSchema.pipe(Schema.optional),
  autoProcessing: AutoProcessingConfigSchema.pipe(Schema.optional),
  tags: TagsConfigSchema.pipe(Schema.optional),
  pipeline: PipelineConfigSchema.pipe(Schema.optional),
  language: Schema.String.pipe(Schema.optional),
  debug: Schema.Boolean.pipe(Schema.optional),
});

// Infer types from schemas
export type PaperlessConfig = Schema.Schema.Type<typeof PaperlessConfigSchema>;
export type OllamaConfig = Schema.Schema.Type<typeof OllamaConfigSchema>;
export type MistralConfig = Schema.Schema.Type<typeof MistralConfigSchema>;
export type QdrantConfig = Schema.Schema.Type<typeof QdrantConfigSchema>;
export type AutoProcessingConfig = Schema.Schema.Type<typeof AutoProcessingConfigSchema>;
export type TagsConfig = Schema.Schema.Type<typeof TagsConfigSchema>;
export type PipelineConfig = Schema.Schema.Type<typeof PipelineConfigSchema>;
export type AppConfig = Schema.Schema.Type<typeof AppConfigSchema>;

// Resolved configuration with defaults applied
export interface ResolvedConfig {
  paperless: {
    url: string;
    token: string;
  };
  ollama: {
    url: string;
    modelLarge: string;
    modelSmall: string;
  };
  mistral: {
    apiKey: string;
    model: string;
  };
  qdrant: {
    url: string;
    collectionName: string;
    embeddingDimension: number;
  };
  autoProcessing: {
    enabled: boolean;
    intervalMinutes: number;
    confirmationEnabled: boolean;
    confirmationMaxRetries: number;
  };
  tags: {
    pending: string;
    ocrDone: string;
    summaryDone: string;
    schemaReview: string;
    titleDone: string;
    correspondentDone: string;
    documentTypeDone: string;
    tagsDone: string;
    processed: string;
    failed: string;
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
  };
  language: string;
  debug: boolean;
}
