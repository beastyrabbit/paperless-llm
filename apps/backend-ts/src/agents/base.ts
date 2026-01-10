/**
 * Base agent patterns and shared utilities.
 */
import { Effect, Stream } from 'effect';
import type { AgentError } from '../errors/index.js';

// ===========================================================================
// Agent Types
// ===========================================================================

export interface AgentAnalysis<T = unknown> {
  result: T;
  reasoning: string;
  confidence: number;
  alternatives: string[];
  thinking?: string;
}

export interface ConfirmationResult {
  confirmed: boolean;
  feedback?: string;
  suggestedChange?: string;
}

export interface AgentProcessResult {
  success: boolean;
  value: string | null;
  reasoning: string;
  confidence: number;
  alternatives: string[];
  attempts: number;
  needsReview: boolean;
}

export interface StreamEvent {
  type: 'start' | 'thinking' | 'analyzing' | 'confirming' | 'result' | 'error' | 'complete';
  step: string;
  data?: unknown;
  timestamp: string;
}

// ===========================================================================
// Agent Interface
// ===========================================================================

export interface Agent<TInput, TResult> {
  readonly name: string;
  readonly process: (input: TInput) => Effect.Effect<TResult, AgentError>;
  readonly processStream?: (input: TInput) => Stream.Stream<StreamEvent, AgentError>;
}

// ===========================================================================
// Confirmation Loop Pattern
// ===========================================================================

export interface ConfirmationLoopOptions<TAnalysis, TResult> {
  maxRetries: number;
  analyze: (feedback: string | null) => Effect.Effect<TAnalysis, AgentError>;
  confirm: (analysis: TAnalysis) => Effect.Effect<ConfirmationResult, AgentError>;
  apply: (analysis: TAnalysis) => Effect.Effect<TResult, AgentError>;
  onRetry?: (attempt: number, feedback: string) => Effect.Effect<void, never>;
  onMaxRetries?: (lastAnalysis: TAnalysis) => Effect.Effect<TResult, AgentError>;
}

export const runConfirmationLoop = <TAnalysis, TResult>(
  options: ConfirmationLoopOptions<TAnalysis, TResult>
): Effect.Effect<TResult, AgentError> =>
  Effect.gen(function* () {
    let feedback: string | null = null;
    let lastAnalysis: TAnalysis | null = null;

    for (let attempt = 0; attempt < options.maxRetries; attempt++) {
      const analysis: TAnalysis = yield* options.analyze(feedback);
      lastAnalysis = analysis;

      const confirmation: ConfirmationResult = yield* options.confirm(analysis);

      if (confirmation.confirmed) {
        return yield* options.apply(analysis);
      }

      feedback = confirmation.feedback ?? 'Not confirmed';

      if (options.onRetry) {
        yield* options.onRetry(attempt + 1, feedback as string);
      }
    }

    // Max retries reached
    if (options.onMaxRetries && lastAnalysis) {
      return yield* options.onMaxRetries(lastAnalysis);
    }

    // Default: return the last analysis result
    return yield* options.apply(lastAnalysis!);
  });

// ===========================================================================
// Stream Event Helpers
// ===========================================================================

export const createStreamEvent = (
  type: StreamEvent['type'],
  step: string,
  data?: unknown
): StreamEvent => ({
  type,
  step,
  data,
  timestamp: new Date().toISOString(),
});

export const emitStart = (step: string): StreamEvent =>
  createStreamEvent('start', step);

export const emitThinking = (step: string, thought: string): StreamEvent =>
  createStreamEvent('thinking', step, { thought });

export const emitAnalyzing = (step: string, progress: string): StreamEvent =>
  createStreamEvent('analyzing', step, { progress });

export const emitConfirming = (step: string, suggestion: string): StreamEvent =>
  createStreamEvent('confirming', step, { suggestion });

export const emitResult = (step: string, result: unknown): StreamEvent =>
  createStreamEvent('result', step, result);

export const emitError = (step: string, error: string): StreamEvent =>
  createStreamEvent('error', step, { error });

export const emitComplete = (step: string): StreamEvent =>
  createStreamEvent('complete', step);
