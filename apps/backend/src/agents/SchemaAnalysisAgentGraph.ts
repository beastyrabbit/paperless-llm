/**
 * Compatibility schema analysis agent. Manual cleanup now uses PiConsolidationAgent.
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import {
  type Agent,
  emitComplete,
  emitError,
  emitResult,
  emitStart,
  type StreamEvent,
} from "./base.js";

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
