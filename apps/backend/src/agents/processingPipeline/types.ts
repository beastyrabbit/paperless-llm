import type { Effect, Stream } from "effect";
import type { AgentError } from "../../errors/index.js";
import type { Document } from "../../models/index.js";
import type { ProcessingState } from "../../utils/tagState.js";

export type { ProcessingState } from "../../utils/tagState.js";

export interface PipelineInput {
  docId: number;
  mockOcr?: boolean;
  auto?: boolean;
  resume?: boolean;
  rerun?: boolean;
  dryRun?: boolean;
  onAgentEvent?: (event: PipelineStreamEvent) => void;
}

export interface PipelineStepResult {
  step: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PipelineResult {
  docId: number;
  success: boolean;
  needsReview: boolean;
  schemaReviewNeeded?: boolean;
  steps: Record<string, PipelineStepResult>;
  error?: string;
}

export interface PipelineStreamEvent {
  type:
    | "pipeline_start"
    | "step_start"
    | "step_complete"
    | "step_error"
    | "needs_review"
    | "schema_review_needed"
    | "pipeline_paused"
    | "pipeline_complete"
    | "warning"
    | "error"
    | "analyzing"
    | "thinking"
    | "confirming";
  docId: number;
  step?: string;
  data?: unknown;
  message?: string;
  reason?: string;
  timestamp: string;
}

export interface ActiveDocumentRunInfo {
  docId: number;
  runId: string;
  startedAt: string;
  source?: "manual" | "case" | "sse" | "auto" | "step";
  step?: string;
  dryRun?: boolean;
}

export type CancelRunResult =
  | { status: "cancelling"; docId: number; runId: string }
  | { status: "cancelled_orphaned_run"; docId: number; runId: string; lockReleased: boolean }
  | { status: "no_active_run"; docId: number; lockRunId?: string | null }
  | { status: "run_mismatch"; docId: number; activeRunId: string; requestedRunId: string };

export interface ProcessingPipelineService {
  readonly processDocument: (input: PipelineInput) => Effect.Effect<PipelineResult, AgentError>;
  readonly cancelDocumentRun: (input: {
    docId: number;
    runId?: string;
    reason?: string;
  }) => Effect.Effect<CancelRunResult, AgentError>;
  readonly getActiveDocumentRun: (
    docId: number,
  ) => Effect.Effect<ActiveDocumentRunInfo | null, never>;
  readonly processDocumentStream: (
    input: PipelineInput,
  ) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly processStep: (
    docId: number,
    step: string,
    dryRun?: boolean,
  ) => Effect.Effect<PipelineStepResult, AgentError>;
  readonly processStepStream: (
    docId: number,
    step: string,
    dryRun?: boolean,
  ) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly getCurrentState: (doc: Document) => ProcessingState;
}
