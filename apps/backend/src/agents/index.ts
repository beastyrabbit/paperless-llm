/**
 * Agent exports.
 *
 * All agents except OCR now use LangGraph for structured output and tool support.
 */

// Base patterns
export {
  type Agent,
  type AgentAnalysis,
  type AgentProcessResult,
  type ConfirmationResult,
  type StreamEvent,
  runConfirmationLoop,
  createStreamEvent,
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitError,
  emitComplete,
} from './base.js';

// OCR Agent (uses Mistral directly, not LangGraph)
export {
  OCRAgentService,
  OCRAgentServiceLive,
  type OCRAgentService as OCRAgentServiceInterface,
  type OCRInput,
  type OCRResult,
} from './OCRAgent.js';

// Summary Agent (uses Ollama directly, not LangGraph confirmation loop)
export {
  SummaryAgentService,
  SummaryAgentServiceLive,
  type SummaryAgentService as SummaryAgentServiceInterface,
  type SummaryInput,
  type SummaryResult,
} from './SummaryAgentGraph.js';

// Processing Pipeline
export {
  ProcessingPipelineService,
  ProcessingPipelineServiceLive,
  type ProcessingPipelineService as ProcessingPipelineServiceInterface,
  type PipelineInput,
  type PipelineResult,
  type PipelineStepResult,
  type PipelineStreamEvent,
  type ProcessingState,
} from './ProcessingPipeline.js';

// ===========================================================================
// LangGraph-based Agents
// ===========================================================================

// Title Agent (LangGraph)
export {
  TitleAgentGraphService,
  TitleAgentGraphServiceLive,
  type TitleAgentGraphService as TitleAgentGraphServiceInterface,
  type TitleInput,
} from './TitleAgentGraph.js';

// For backwards compatibility
export { TitleAgentGraphService as TitleAgentService } from './TitleAgentGraph.js';
export { TitleAgentGraphServiceLive as TitleAgentServiceLive } from './TitleAgentGraph.js';

// Correspondent Agent (LangGraph)
export {
  CorrespondentAgentGraphService,
  CorrespondentAgentGraphServiceLive,
  type CorrespondentAgentGraphService as CorrespondentAgentGraphServiceInterface,
  type CorrespondentInput,
} from './CorrespondentAgentGraph.js';

// For backwards compatibility
export { CorrespondentAgentGraphService as CorrespondentAgentService } from './CorrespondentAgentGraph.js';
export { CorrespondentAgentGraphServiceLive as CorrespondentAgentServiceLive } from './CorrespondentAgentGraph.js';

// Document Type Agent (LangGraph)
export {
  DocumentTypeAgentGraphService,
  DocumentTypeAgentGraphServiceLive,
  type DocumentTypeAgentGraphService as DocumentTypeAgentGraphServiceInterface,
  type DocumentTypeInput,
} from './DocumentTypeAgentGraph.js';

// For backwards compatibility
export { DocumentTypeAgentGraphService as DocumentTypeAgentService } from './DocumentTypeAgentGraph.js';
export { DocumentTypeAgentGraphServiceLive as DocumentTypeAgentServiceLive } from './DocumentTypeAgentGraph.js';

// Tags Agent (LangGraph)
export {
  TagsAgentGraphService,
  TagsAgentGraphServiceLive,
  type TagsAgentGraphService as TagsAgentGraphServiceInterface,
  type TagsInput,
  type TagsResult,
} from './TagsAgentGraph.js';

// For backwards compatibility
export { TagsAgentGraphService as TagsAgentService } from './TagsAgentGraph.js';
export { TagsAgentGraphServiceLive as TagsAgentServiceLive } from './TagsAgentGraph.js';

// Schema Analysis Agent (LangGraph)
export {
  SchemaAnalysisAgentGraphService,
  SchemaAnalysisAgentGraphServiceLive,
  type SchemaAnalysisAgentGraphService as SchemaAnalysisAgentGraphServiceInterface,
  type SchemaAnalysisGraphInput,
  type SchemaAnalysisGraphResult,
} from './SchemaAnalysisAgentGraph.js';

// For backwards compatibility
export { SchemaAnalysisAgentGraphService as SchemaAnalysisAgentService } from './SchemaAnalysisAgentGraph.js';
export { SchemaAnalysisAgentGraphServiceLive as SchemaAnalysisAgentServiceLive } from './SchemaAnalysisAgentGraph.js';
export type { SchemaAnalysisGraphInput as SchemaAnalysisInput } from './SchemaAnalysisAgentGraph.js';
export type { SchemaAnalysisGraphResult as SchemaAnalysisResult } from './SchemaAnalysisAgentGraph.js';

// Custom Fields Agent (LangGraph)
export {
  CustomFieldsAgentGraphService,
  CustomFieldsAgentGraphServiceLive,
  type CustomFieldsAgentGraphService as CustomFieldsAgentGraphServiceInterface,
  type CustomFieldsGraphInput,
  type CustomFieldsGraphResult,
  type FieldValueResult,
} from './CustomFieldsAgentGraph.js';

// For backwards compatibility
export { CustomFieldsAgentGraphService as CustomFieldsAgentService } from './CustomFieldsAgentGraph.js';
export { CustomFieldsAgentGraphServiceLive as CustomFieldsAgentServiceLive } from './CustomFieldsAgentGraph.js';
export type { CustomFieldsGraphInput as CustomFieldsInput } from './CustomFieldsAgentGraph.js';
export type { CustomFieldsGraphResult as CustomFieldsResult } from './CustomFieldsAgentGraph.js';
export type { FieldValueResult as FieldValue } from './CustomFieldsAgentGraph.js';

// Document Links Agent (LangGraph)
export {
  DocumentLinksAgentGraphService,
  DocumentLinksAgentGraphServiceLive,
  type DocumentLinksAgentGraphService as DocumentLinksAgentGraphServiceInterface,
  type DocumentLinksGraphInput,
  type DocumentLinksGraphResult,
  type DocumentLinkResult,
} from './DocumentLinksAgentGraph.js';

// For backwards compatibility
export { DocumentLinksAgentGraphService as DocumentLinksAgentService } from './DocumentLinksAgentGraph.js';
export { DocumentLinksAgentGraphServiceLive as DocumentLinksAgentServiceLive } from './DocumentLinksAgentGraph.js';
export type { DocumentLinksGraphInput as DocumentLinksInput } from './DocumentLinksAgentGraph.js';
export type { DocumentLinksGraphResult as DocumentLinksResult } from './DocumentLinksAgentGraph.js';

// ===========================================================================
// Graph components for building agents
// ===========================================================================

export {
  // Types and schemas
  type BaseAgentState,
  type AgentType,
  TitleAnalysisSchema,
  TagsAnalysisSchema,
  TagSuggestionSchema,
  TagRemovalSchema,
  CorrespondentAnalysisSchema,
  DocumentTypeAnalysisSchema,
  ConfirmationResultSchema,
  type TitleAnalysis,
  type TagsAnalysis,
  type CorrespondentAnalysis,
  type DocumentTypeAnalysis,
  type ConfirmationResult as GraphConfirmationResult,

  // Schema Analysis types
  EntityTypeSchema,
  type EntityType,
  SchemaSuggestionSchema,
  type SchemaSuggestion,
  PendingMatchSchema,
  type PendingMatch,
  SchemaAnalysisResultSchema,
  type SchemaAnalysisOutput,

  // Custom Fields types
  FieldValueSchema,
  type FieldValueOutput,
  CustomFieldsAnalysisSchema,
  type CustomFieldsAnalysisOutput,

  // Document Links types
  ReferenceTypeSchema,
  type ReferenceType,
  DocumentLinkSuggestionSchema,
  type DocumentLinkSuggestionOutput,
  DocumentLinksAnalysisSchema,
  type DocumentLinksAnalysisOutput,

  // Tools
  type ToolDependencies,
  createSearchSimilarDocumentsTool,
  createGetDocumentTool,
  createGetDocumentsByTagTool,
  createGetDocumentsByCorrespondentTool,
  createGetDocumentsByTypeTool,
  createGetDocumentsByCustomFieldTool,
  createListCustomFieldsTool,
  createAgentTools,
  // Document Link tools
  createSearchDocumentByReferenceTool,
  createFindRelatedDocumentsTool,
  createValidateDocumentIdTool,
  createDocumentLinkTools,

  // Confirmation Loop
  ConfirmationLoopState,
  type ConfirmationLoopStateType,
  type ConfirmationLoopConfig,
  type ConfirmationLoopInput,
  type ConfirmationLoopResult,
  createConfirmationLoopGraph,
  runConfirmationLoop as runGraphConfirmationLoop,
  streamConfirmationLoop,
} from './graph/index.js';
