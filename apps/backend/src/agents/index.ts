/**
 * Agent exports.
 */

export {
  type Agent,
  type AgentAnalysis,
  type AgentProcessResult,
  type ConfirmationResult,
  createStreamEvent,
  emitAnalyzing,
  emitComplete,
  emitConfirming,
  emitError,
  emitResult,
  emitStart,
  emitThinking,
  runConfirmationLoop,
  type StreamEvent,
} from "./base.js";
// Compatibility exports retained for old callers. These agents intentionally
// return skipped/no-op results; active extraction runs through PiDocumentAgent.
export type {
  CustomFieldsGraphInput as CustomFieldsInput,
  CustomFieldsGraphResult as CustomFieldsResult,
  FieldValueResult as FieldValue,
} from "./CustomFieldsAgentGraph.js";
export {
  CustomFieldsAgentGraphService,
  type CustomFieldsAgentGraphService as CustomFieldsAgentGraphServiceInterface,
  CustomFieldsAgentGraphService as CustomFieldsAgentService,
  CustomFieldsAgentGraphServiceLive,
  CustomFieldsAgentGraphServiceLive as CustomFieldsAgentServiceLive,
  type CustomFieldsGraphInput,
  type CustomFieldsGraphResult,
  type FieldValueResult,
} from "./CustomFieldsAgentGraph.js";
export type {
  DocumentLinksGraphInput as DocumentLinksInput,
  DocumentLinksGraphResult as DocumentLinksResult,
} from "./DocumentLinksAgentGraph.js";
export {
  type DocumentLinkResult,
  type DocumentLinkSuggestionOutput,
  DocumentLinksAgentGraphService,
  type DocumentLinksAgentGraphService as DocumentLinksAgentGraphServiceInterface,
  DocumentLinksAgentGraphService as DocumentLinksAgentService,
  DocumentLinksAgentGraphServiceLive,
  DocumentLinksAgentGraphServiceLive as DocumentLinksAgentServiceLive,
  type DocumentLinksGraphInput,
  type DocumentLinksGraphResult,
} from "./DocumentLinksAgentGraph.js";
export {
  OCRAgentService,
  type OCRAgentService as OCRAgentServiceInterface,
  OCRAgentServiceLive,
  type OCRInput,
  type OCRResult,
} from "./OCRAgent.js";
export {
  type ConsolidationAction,
  type ConsolidationAttributeType,
  type ConsolidationProposal,
  type ConsolidationReport,
  PiConsolidationAgentService,
  type PiConsolidationAgentService as PiConsolidationAgentServiceInterface,
  PiConsolidationAgentServiceLive,
} from "./PiConsolidationAgent.js";
export {
  type DocumentAgentInput,
  type DocumentAgentResult,
  PiDocumentAgentService,
  type PiDocumentAgentService as PiDocumentAgentServiceInterface,
  PiDocumentAgentServiceLive,
} from "./PiDocumentAgent.js";
export {
  type PiTagExplorerAgentService as PiTagExplorerAgentServiceInterface,
  PiTagExplorerAgentService,
  PiTagExplorerAgentServiceLive,
  type TagExplorerCatalogTag,
  type TagExplorerInput,
  type TagExplorerNewTagProposal,
  type TagExplorerRejectedIdea,
  type TagExplorerResult,
  type TagExplorerSimilarDocument,
} from "./PiTagExplorerAgent.js";
export {
  type PipelineInput,
  type PipelineResult,
  type PipelineStepResult,
  type PipelineStreamEvent,
  ProcessingPipelineService,
  type ProcessingPipelineService as ProcessingPipelineServiceInterface,
  ProcessingPipelineServiceLive,
  type ProcessingState,
} from "./ProcessingPipeline.js";
// Compatibility schema-analysis exports retained for old callers. Catalog
// cleanup proposals now run through PiConsolidationAgent/SchemaCleanupJob.
export type {
  SchemaAnalysisGraphInput as SchemaAnalysisInput,
  SchemaAnalysisGraphResult as SchemaAnalysisResult,
} from "./SchemaAnalysisAgentGraph.js";
export {
  SchemaAnalysisAgentGraphService,
  type SchemaAnalysisAgentGraphService as SchemaAnalysisAgentGraphServiceInterface,
  SchemaAnalysisAgentGraphService as SchemaAnalysisAgentService,
  SchemaAnalysisAgentGraphServiceLive,
  SchemaAnalysisAgentGraphServiceLive as SchemaAnalysisAgentServiceLive,
  type SchemaAnalysisGraphInput,
  type SchemaAnalysisGraphResult,
} from "./SchemaAnalysisAgentGraph.js";
