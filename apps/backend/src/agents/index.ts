/**
 * Agent exports.
 */

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

export {
  OCRAgentService,
  OCRAgentServiceLive,
  type OCRAgentService as OCRAgentServiceInterface,
  type OCRInput,
  type OCRResult,
} from './OCRAgent.js';

export {
  PiDocumentAgentService,
  PiDocumentAgentServiceLive,
  type DocumentAgentInput,
  type DocumentAgentResult,
  type PiDocumentAgentService as PiDocumentAgentServiceInterface,
} from './PiDocumentAgent.js';

export {
  PiConsolidationAgentService,
  PiConsolidationAgentServiceLive,
  type ConsolidationAction,
  type ConsolidationAttributeType,
  type ConsolidationProposal,
  type ConsolidationReport,
  type PiConsolidationAgentService as PiConsolidationAgentServiceInterface,
} from './PiConsolidationAgent.js';

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

// Legacy compatibility exports for callers that still import per-field agents.
export {
  SummaryAgentService,
  SummaryAgentServiceLive,
  type SummaryAgentService as SummaryAgentServiceInterface,
  type SummaryInput,
  type SummaryResult,
} from './SummaryAgentGraph.js';

export {
  TitleAgentGraphService,
  TitleAgentGraphServiceLive,
  type TitleAgentGraphService as TitleAgentGraphServiceInterface,
  type TitleInput,
} from './TitleAgentGraph.js';
export { TitleAgentGraphService as TitleAgentService } from './TitleAgentGraph.js';
export { TitleAgentGraphServiceLive as TitleAgentServiceLive } from './TitleAgentGraph.js';

export {
  CorrespondentAgentGraphService,
  CorrespondentAgentGraphServiceLive,
  type CorrespondentAgentGraphService as CorrespondentAgentGraphServiceInterface,
  type CorrespondentInput,
} from './CorrespondentAgentGraph.js';
export { CorrespondentAgentGraphService as CorrespondentAgentService } from './CorrespondentAgentGraph.js';
export { CorrespondentAgentGraphServiceLive as CorrespondentAgentServiceLive } from './CorrespondentAgentGraph.js';

export {
  DocumentTypeAgentGraphService,
  DocumentTypeAgentGraphServiceLive,
  type DocumentTypeAgentGraphService as DocumentTypeAgentGraphServiceInterface,
  type DocumentTypeInput,
} from './DocumentTypeAgentGraph.js';
export { DocumentTypeAgentGraphService as DocumentTypeAgentService } from './DocumentTypeAgentGraph.js';
export { DocumentTypeAgentGraphServiceLive as DocumentTypeAgentServiceLive } from './DocumentTypeAgentGraph.js';

export {
  TagsAgentGraphService,
  TagsAgentGraphServiceLive,
  type TagsAgentGraphService as TagsAgentGraphServiceInterface,
  type TagsInput,
  type TagsResult,
} from './TagsAgentGraph.js';
export { TagsAgentGraphService as TagsAgentService } from './TagsAgentGraph.js';
export { TagsAgentGraphServiceLive as TagsAgentServiceLive } from './TagsAgentGraph.js';

export {
  SchemaAnalysisAgentGraphService,
  SchemaAnalysisAgentGraphServiceLive,
  type SchemaAnalysisAgentGraphService as SchemaAnalysisAgentGraphServiceInterface,
  type SchemaAnalysisGraphInput,
  type SchemaAnalysisGraphResult,
} from './SchemaAnalysisAgentGraph.js';
export { SchemaAnalysisAgentGraphService as SchemaAnalysisAgentService } from './SchemaAnalysisAgentGraph.js';
export { SchemaAnalysisAgentGraphServiceLive as SchemaAnalysisAgentServiceLive } from './SchemaAnalysisAgentGraph.js';
export type { SchemaAnalysisGraphInput as SchemaAnalysisInput } from './SchemaAnalysisAgentGraph.js';
export type { SchemaAnalysisGraphResult as SchemaAnalysisResult } from './SchemaAnalysisAgentGraph.js';

export {
  CustomFieldsAgentGraphService,
  CustomFieldsAgentGraphServiceLive,
  type CustomFieldsAgentGraphService as CustomFieldsAgentGraphServiceInterface,
  type CustomFieldsGraphInput,
  type CustomFieldsGraphResult,
  type FieldValueResult,
} from './CustomFieldsAgentGraph.js';
export { CustomFieldsAgentGraphService as CustomFieldsAgentService } from './CustomFieldsAgentGraph.js';
export { CustomFieldsAgentGraphServiceLive as CustomFieldsAgentServiceLive } from './CustomFieldsAgentGraph.js';
export type { CustomFieldsGraphInput as CustomFieldsInput } from './CustomFieldsAgentGraph.js';
export type { CustomFieldsGraphResult as CustomFieldsResult } from './CustomFieldsAgentGraph.js';
export type { FieldValueResult as FieldValue } from './CustomFieldsAgentGraph.js';

export {
  DocumentLinksAgentGraphService,
  DocumentLinksAgentGraphServiceLive,
  type DocumentLinksAgentGraphService as DocumentLinksAgentGraphServiceInterface,
  type DocumentLinksGraphInput,
  type DocumentLinksGraphResult,
  type DocumentLinkResult,
  type DocumentLinkSuggestionOutput,
} from './DocumentLinksAgentGraph.js';
export { DocumentLinksAgentGraphService as DocumentLinksAgentService } from './DocumentLinksAgentGraph.js';
export { DocumentLinksAgentGraphServiceLive as DocumentLinksAgentServiceLive } from './DocumentLinksAgentGraph.js';
export type { DocumentLinksGraphInput as DocumentLinksInput } from './DocumentLinksAgentGraph.js';
export type { DocumentLinksGraphResult as DocumentLinksResult } from './DocumentLinksAgentGraph.js';
