/**
 * LangGraph-based Schema Analysis agent with structured output.
 *
 * This is a single-run agent that analyzes documents and suggests new
 * correspondents, document types, or tags that could be added to improve the schema.
 * Uses LangGraph StateGraph with memory for execution context.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import { StateGraph, Annotation, MemorySaver, END } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import {
  ConfigService,
  OllamaService,
  TinyBaseService,
  PaperlessService,
  QdrantService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Agent, StreamEvent } from './base.js';
import {
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitResult,
  emitComplete,
} from './base.js';
import {
  SchemaAnalysisResultSchema,
  type SchemaAnalysisOutput,
  createAgentTools,
} from './graph/index.js';

// ===========================================================================
// Types
// ===========================================================================

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
    entityType: 'correspondent' | 'document_type' | 'tag';
    suggestedName: string;
    reasoning: string;
    confidence: number;
    similarToExisting: string[];
  }>;
  matchesPending: Array<{
    entityType: 'correspondent' | 'document_type' | 'tag';
    matchedName: string;
  }>;
  reasoning: string;
  noSuggestionsReason?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface SchemaAnalysisAgentGraphService extends Agent<SchemaAnalysisGraphInput, SchemaAnalysisGraphResult> {
  readonly name: 'schema_analysis';
  readonly process: (input: SchemaAnalysisGraphInput) => Effect.Effect<SchemaAnalysisGraphResult, AgentError>;
  readonly processStream: (input: SchemaAnalysisGraphInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const SchemaAnalysisAgentGraphService = Context.GenericTag<SchemaAnalysisAgentGraphService>('SchemaAnalysisAgentGraphService');

// ===========================================================================
// System Prompt
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a schema analysis specialist for a document management system.

Your task is to analyze documents and suggest new entities (correspondents, document types, tags) that should be added to improve the system's schema.

You have access to tools to search for similar processed documents. Use these to see how similar documents were classified and what entities were used.

Guidelines:
1. Only suggest NEW entities that don't already exist
2. Never suggest entities that are on the blocked list
3. If a document matches a pending suggestion, note the match
4. Be conservative - only suggest entities with high confidence (>0.8)
5. Consider how the entity would apply to other similar documents
6. Use consistent naming conventions matching existing entities

Entity Types:
- correspondent: The sender/originator of documents (companies, organizations, people)
- document_type: Categories like Invoice, Contract, Letter, Report
- tag: Descriptive labels like "urgent", "tax-related", "2024"

You MUST respond with structured JSON matching the required schema.`;

// ===========================================================================
// LangGraph State
// ===========================================================================

const SchemaAnalysisState = Annotation.Root({
  // Input
  docId: Annotation<number>,
  content: Annotation<string>,
  pendingSuggestions: Annotation<{ correspondent: string[]; document_type: string[]; tag: string[] } | null>,

  // Context from Paperless
  existingCorrespondents: Annotation<string[]>,
  existingDocTypes: Annotation<string[]>,
  existingTags: Annotation<string[]>,
  blockedCorrespondents: Annotation<Set<string>>,
  blockedDocTypes: Annotation<Set<string>>,
  blockedTags: Annotation<Set<string>>,
  blockedGlobal: Annotation<Set<string>>,

  // Messages for tool calls
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
  }),

  // Analysis result
  analysis: Annotation<SchemaAnalysisOutput | null>,
  error: Annotation<string | null>,
});

type SchemaAnalysisStateType = typeof SchemaAnalysisState.State;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const SchemaAnalysisAgentGraphServiceLive = Layer.effect(
  SchemaAnalysisAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;

    const { tags: tagConfig } = config.config;
    const settings = yield* tinybase.getAllSettings();
    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');

    // Create tools for the agent
    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    // Create memory saver for graph execution context
    const memory = new MemorySaver();

    // Helper to get blocked names for a type
    const getBlockedNames = (blockType: string): Effect.Effect<Set<string>, never> =>
      Effect.gen(function* () {
        const blocked = yield* tinybase.getBlockedSuggestions(blockType as 'correspondent' | 'document_type' | 'tag' | 'global');
        return new Set(blocked.map((b) => b.normalizedName));
      }).pipe(Effect.catchAll(() => Effect.succeed(new Set<string>())));

    // Filter out blocked suggestions
    const filterBlockedSuggestions = (
      suggestions: SchemaAnalysisOutput['suggestions'],
      blockedCorrespondents: Set<string>,
      blockedDocTypes: Set<string>,
      blockedTags: Set<string>,
      blockedGlobal: Set<string>
    ): SchemaAnalysisOutput['suggestions'] => {
      return suggestions.filter((s) => {
        const normalized = s.suggested_name.trim().toLowerCase();
        if (blockedGlobal.has(normalized)) return false;
        if (s.entity_type === 'correspondent' && blockedCorrespondents.has(normalized)) return false;
        if (s.entity_type === 'document_type' && blockedDocTypes.has(normalized)) return false;
        if (s.entity_type === 'tag' && blockedTags.has(normalized)) return false;
        return true;
      });
    };

    // Convert structured output to result format
    const toResult = (state: SchemaAnalysisStateType): SchemaAnalysisGraphResult => {
      if (!state.analysis) {
        return {
          docId: state.docId,
          hasSuggestions: false,
          suggestions: [],
          matchesPending: [],
          reasoning: state.error ?? 'Analysis failed',
          noSuggestionsReason: state.error ?? 'Analysis failed',
        };
      }

      const filteredSuggestions = filterBlockedSuggestions(
        state.analysis.suggestions,
        state.blockedCorrespondents,
        state.blockedDocTypes,
        state.blockedTags,
        state.blockedGlobal
      );

      return {
        docId: state.docId,
        hasSuggestions: filteredSuggestions.length > 0,
        suggestions: filteredSuggestions.map((s) => ({
          entityType: s.entity_type,
          suggestedName: s.suggested_name,
          reasoning: s.reasoning,
          confidence: s.confidence,
          similarToExisting: s.similar_to_existing,
        })),
        matchesPending: state.analysis.matches_pending.map((m) => ({
          entityType: m.entity_type,
          matchedName: m.matched_name,
        })),
        reasoning: state.analysis.reasoning,
        noSuggestionsReason: state.analysis.no_suggestions_reason,
      };
    };

    // Build the analysis prompt
    const buildPrompt = (state: SchemaAnalysisStateType): string => {
      const correspondentsList = state.existingCorrespondents.join(', ') || 'None yet';
      const docTypesList = state.existingDocTypes.join(', ') || 'None yet';
      const tagsList = state.existingTags.join(', ') || 'None yet';

      const blockedCorrespondentsList = [...state.blockedCorrespondents].sort().join(', ') || 'None';
      const blockedDocTypesList = [...state.blockedDocTypes].sort().join(', ') || 'None';
      const blockedTagsList = [...state.blockedTags].sort().join(', ') || 'None';
      const blockedGlobalList = [...state.blockedGlobal].sort().join(', ') || 'None';

      const pending = state.pendingSuggestions ?? { correspondent: [], document_type: [], tag: [] };
      const pendingCorrespondentsList = pending.correspondent.join(', ') || 'None';
      const pendingDocTypesList = pending.document_type.join(', ') || 'None';
      const pendingTagsList = pending.tag.join(', ') || 'None';

      return `## Document Content

${state.content.slice(0, 8000)}

## Existing Entities

### Correspondents
${correspondentsList}

### Document Types
${docTypesList}

### Tags
${tagsList}

## Blocked Entities (DO NOT suggest these)

### Blocked Correspondents
${blockedCorrespondentsList}

### Blocked Document Types
${blockedDocTypesList}

### Blocked Tags
${blockedTagsList}

### Blocked Global
${blockedGlobalList}

## Pending Suggestions (note matches if applicable)

### Pending Correspondents
${pendingCorrespondentsList}

### Pending Document Types
${pendingDocTypesList}

### Pending Tags
${pendingTagsList}

Analyze this document and suggest any new entities that should be added to the schema. Use search tools to find similar documents if helpful.`;
    };

    // Node: Analyze with tools
    const analyzeNode = async (state: SchemaAnalysisStateType): Promise<Partial<SchemaAnalysisStateType>> => {
      try {
        const baseMessages: BaseMessage[] = [
          new SystemMessage(ANALYSIS_SYSTEM_PROMPT),
          new HumanMessage(buildPrompt(state)),
        ];

        // Include any tool results from previous iterations
        const allMessages = [...baseMessages, ...state.messages.filter(m => m instanceof ToolMessage)];

        // If we don't have analysis yet, try with tools first
        if (!state.analysis) {
          const toolModel = new ChatOllama({
            baseUrl: ollamaUrl,
            model: largeModel,
            temperature: 0.1,
            think: true,
          }).bindTools(tools);

          const response = await toolModel.invoke(allMessages);

          // Check if model wants to call tools
          if ((response as AIMessage).tool_calls?.length) {
            return { messages: [response] };
          }
        }

        // Get structured output
        const structuredModel = new ChatOllama({
          baseUrl: ollamaUrl,
          model: largeModel,
          temperature: 0.1,
          format: 'json',
          think: true,
        }).withStructuredOutput(SchemaAnalysisResultSchema);

        const analysis = await structuredModel.invoke(allMessages);
        return { analysis, messages: [] };
      } catch (error) {
        return { error: `Analysis failed: ${String(error)}` };
      }
    };

    // Node: Execute tools
    const toolsNode = async (state: SchemaAnalysisStateType): Promise<Partial<SchemaAnalysisStateType>> => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (!lastMessage || !(lastMessage as AIMessage).tool_calls?.length) {
        return {};
      }

      const toolCalls = (lastMessage as AIMessage).tool_calls!;
      const toolMessages: ToolMessage[] = [];

      for (const toolCall of toolCalls) {
        const tool = tools.find((t) => t.name === toolCall.name);
        if (tool) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = await (tool as any).invoke(toolCall.args);
            toolMessages.push(
              new ToolMessage({
                content: typeof result === 'string' ? result : JSON.stringify(result),
                tool_call_id: toolCall.id!,
              })
            );
          } catch (error) {
            toolMessages.push(
              new ToolMessage({
                content: `Tool error: ${String(error)}`,
                tool_call_id: toolCall.id!,
              })
            );
          }
        }
      }

      return { messages: toolMessages };
    };

    // Routing function
    const shouldContinue = (state: SchemaAnalysisStateType): string => {
      if (state.error || state.analysis) {
        return END;
      }
      const lastMessage = state.messages[state.messages.length - 1];
      if (lastMessage && (lastMessage as AIMessage).tool_calls?.length) {
        return 'tools';
      }
      return END;
    };

    // Build graph
    const graph = new StateGraph(SchemaAnalysisState)
      .addNode('analyze', analyzeNode)
      .addNode('tools', toolsNode)
      .addEdge('__start__', 'analyze')
      .addConditionalEdges('analyze', shouldContinue, {
        tools: 'tools',
        [END]: END,
      })
      .addEdge('tools', 'analyze')
      .compile({ checkpointer: memory });

    return {
      name: 'schema_analysis' as const,

      process: (input: SchemaAnalysisGraphInput) =>
        Effect.gen(function* () {
          const { docId, content, pendingSuggestions } = input;

          // Get existing entities from Paperless
          const [correspondents, docTypes, tags] = yield* Effect.all([
            paperless.getCorrespondents(),
            paperless.getDocumentTypes(),
            paperless.getTags(),
          ]);

          // Get blocked suggestions
          const [blockedCorrespondents, blockedDocTypes, blockedTags, blockedGlobal] = yield* Effect.all([
            getBlockedNames('correspondent'),
            getBlockedNames('document_type'),
            getBlockedNames('tag'),
            getBlockedNames('global'),
          ]);

          const initialState: SchemaAnalysisStateType = {
            docId,
            content,
            pendingSuggestions: pendingSuggestions ?? null,
            existingCorrespondents: correspondents.map((c) => c.name),
            existingDocTypes: docTypes.map((dt) => dt.name),
            existingTags: tags.map((t) => t.name),
            blockedCorrespondents,
            blockedDocTypes,
            blockedTags,
            blockedGlobal,
            messages: [],
            analysis: null,
            error: null,
          };

          const result = yield* Effect.tryPromise({
            try: async () => graph.invoke(initialState, {
              configurable: { thread_id: `schema-${docId}-${Date.now()}` },
            }),
            catch: (e) => new AgentError({ message: `Schema analysis graph failed: ${e}`, agent: 'schema_analysis', cause: e }),
          });

          return toResult(result);
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Schema analysis failed: ${e}`, agent: 'schema_analysis', cause: e })
          )
        ),

      processStream: (input: SchemaAnalysisGraphInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const { docId, content, pendingSuggestions } = input;

            yield* Effect.sync(() => emit.single(emitStart('schema_analysis')));
            yield* Effect.sync(() => emit.single(emitAnalyzing('schema_analysis', 'Fetching existing entities')));

            // Get existing entities
            const [correspondents, docTypes, tags] = yield* Effect.all([
              paperless.getCorrespondents(),
              paperless.getDocumentTypes(),
              paperless.getTags(),
            ]);

            // Get blocked suggestions
            const [blockedCorrespondents, blockedDocTypes, blockedTags, blockedGlobal] = yield* Effect.all([
              getBlockedNames('correspondent'),
              getBlockedNames('document_type'),
              getBlockedNames('tag'),
              getBlockedNames('global'),
            ]);

            yield* Effect.sync(() => emit.single(emitAnalyzing('schema_analysis', 'Analyzing document for schema improvements')));

            const initialState: SchemaAnalysisStateType = {
              docId,
              content,
              pendingSuggestions: pendingSuggestions ?? null,
              existingCorrespondents: correspondents.map((c) => c.name),
              existingDocTypes: docTypes.map((dt) => dt.name),
              existingTags: tags.map((t) => t.name),
              blockedCorrespondents,
              blockedDocTypes,
              blockedTags,
              blockedGlobal,
              messages: [],
              analysis: null,
              error: null,
            };

            const result = yield* Effect.tryPromise({
              try: async () => {
                let finalState = initialState;
                const stream = await graph.stream(initialState, {
                  configurable: { thread_id: `schema-stream-${docId}-${Date.now()}` },
                  streamMode: 'updates',
                });

                for await (const chunk of stream) {
                  for (const [, state] of Object.entries(chunk)) {
                    finalState = { ...finalState, ...(state as Partial<SchemaAnalysisStateType>) };
                  }
                }
                return finalState;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Schema analysis failed: ${result}`, agent: 'schema_analysis' })));
              return;
            }

            if (result.analysis) {
              yield* Effect.sync(() => emit.single(emitThinking('schema_analysis', result.analysis!.reasoning)));
            }

            const finalResult = toResult(result);

            yield* Effect.sync(() => emit.single(emitResult('schema_analysis', finalResult)));
            yield* Effect.sync(() => emit.single(emitComplete('schema_analysis')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({ message: `Schema analysis stream failed: ${e}`, agent: 'schema_analysis', cause: e })
            )
          )
        ),
    };
  })
);
