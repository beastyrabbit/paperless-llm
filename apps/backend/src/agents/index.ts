/**
 * Agent exports.
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

// Title Agent
export {
  TitleAgentService,
  TitleAgentServiceLive,
  type TitleAgentService as TitleAgentServiceInterface,
  type TitleInput,
  type TitleAnalysis,
} from './TitleAgent.js';

// Correspondent Agent
export {
  CorrespondentAgentService,
  CorrespondentAgentServiceLive,
  type CorrespondentAgentService as CorrespondentAgentServiceInterface,
  type CorrespondentInput,
  type CorrespondentAnalysis,
} from './CorrespondentAgent.js';

// OCR Agent
export {
  OCRAgentService,
  OCRAgentServiceLive,
  type OCRAgentService as OCRAgentServiceInterface,
  type OCRInput,
  type OCRResult,
} from './OCRAgent.js';

// Document Type Agent
export {
  DocumentTypeAgentService,
  DocumentTypeAgentServiceLive,
  type DocumentTypeAgentService as DocumentTypeAgentServiceInterface,
  type DocumentTypeInput,
  type DocumentTypeAnalysis,
} from './DocumentTypeAgent.js';

// Tags Agent
export {
  TagsAgentService,
  TagsAgentServiceLive,
  type TagsAgentService as TagsAgentServiceInterface,
  type TagsInput,
  type TagsAnalysis,
  type TagsResult,
} from './TagsAgent.js';

// Custom Fields Agent
export {
  CustomFieldsAgentService,
  CustomFieldsAgentServiceLive,
  type CustomFieldsAgentService as CustomFieldsAgentServiceInterface,
  type CustomFieldsInput,
  type CustomFieldsAnalysis,
  type CustomFieldsResult,
  type FieldValue,
} from './CustomFieldsAgent.js';

// Schema Analysis Agent
export {
  SchemaAnalysisAgentService,
  SchemaAnalysisAgentServiceLive,
  type SchemaAnalysisAgentService as SchemaAnalysisAgentServiceInterface,
  type SchemaAnalysisInput,
  type SchemaAnalysisResult,
  type SchemaSuggestion,
  type PendingMatch,
} from './SchemaAnalysisAgent.js';

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
