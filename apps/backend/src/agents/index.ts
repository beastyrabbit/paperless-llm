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
