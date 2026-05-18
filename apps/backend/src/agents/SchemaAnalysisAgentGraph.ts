/**
 * Compatibility schema analysis agent.
 *
 * This service is intentionally retained for external callers that still import the
 * old SchemaAnalysisAgentGraph API. It no longer performs catalog suggestion work;
 * manual catalog cleanup is owned by PiConsolidationAgent/SchemaCleanupJob.
 *
 * @deprecated Use PiConsolidationAgentService for catalog cleanup proposals.
 */
import { Context, Effect, Layer, Stream } from "effect";
import type { AgentError } from "../errors/index.js";
import { type Agent, emitComplete, emitResult, emitStart, type StreamEvent } from "./base.js";

export interface SchemaAnalysisGraphInput {
  docId: number;
  content: string;
  pendingSuggestions?: {
    correspondent: string[];
    document_type: string[];
    tag: string[];
  };
}

export interface SchemaAnalysisGraphResult {
  docId: number;
  hasSuggestions: boolean;
  suggestions: Array<{
    entityType: "correspondent" | "document_type" | "tag";
    suggestedName: string;
    reasoning: string;
    confidence: number;
    similarToExisting: string[];
  }>;
  matchesPending: Array<{
    entityType: "correspondent" | "document_type" | "tag";
    matchedName: string;
  }>;
  reasoning: string;
  noSuggestionsReason?: string;
}

/**
 * @deprecated Compatibility-only service; use PiConsolidationAgentService instead.
 */
export interface SchemaAnalysisAgentGraphService
  extends Agent<SchemaAnalysisGraphInput, SchemaAnalysisGraphResult> {
  readonly name: "schema_analysis";
  readonly process: (
    input: SchemaAnalysisGraphInput,
  ) => Effect.Effect<SchemaAnalysisGraphResult, AgentError>;
  readonly processStream: (
    input: SchemaAnalysisGraphInput,
  ) => Stream.Stream<StreamEvent, AgentError>;
}

export const SchemaAnalysisAgentGraphService = Context.GenericTag<SchemaAnalysisAgentGraphService>(
  "SchemaAnalysisAgentGraphService",
);

/**
 * Compatibility layer that emits a successful skipped/no-suggestions result.
 * It must not be wired into the active processing pipeline.
 *
 * @deprecated Compatibility-only layer; use PiConsolidationAgentServiceLive instead.
 */
export const SchemaAnalysisAgentGraphServiceLive = Layer.succeed(SchemaAnalysisAgentGraphService, {
  name: "schema_analysis" as const,
  process: (input) =>
    Effect.succeed({
      docId: input.docId,
      hasSuggestions: false,
      suggestions: [],
      matchesPending: [],
      reasoning: "Compatibility schema analysis is disabled; run manual consolidation instead.",
      noSuggestionsReason: "Manual consolidation agent owns catalog cleanup suggestions.",
    }),
  processStream: (input) =>
    Stream.async<StreamEvent>((emit) => {
      const result: SchemaAnalysisGraphResult = {
        docId: input.docId,
        hasSuggestions: false,
        suggestions: [],
        matchesPending: [],
        reasoning: "Compatibility schema analysis is disabled; run manual consolidation instead.",
        noSuggestionsReason: "Manual consolidation agent owns catalog cleanup suggestions.",
      };
      emit.single(emitStart("schema_analysis"));
      emit.single(emitResult("schema_analysis", result));
      emit.single(emitComplete("schema_analysis"));
      emit.end();
    }),
});
