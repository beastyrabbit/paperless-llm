/**
 * Generic LangGraph confirmation loop factory.
 *
 * This creates a reusable state machine for the analyze -> confirm -> apply pattern
 * with tool support and memory for pipeline execution.
 */
import { StateGraph, Annotation, MemorySaver, END } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { ConfirmationResultSchema, type ConfirmationResult } from './types.js';

// ===========================================================================
// State Definition
// ===========================================================================

// Maximum number of tool calls allowed before forcing structured output
const MAX_TOOL_CALLS = 5;

/**
 * State annotation for the confirmation loop graph.
 */
export const ConfirmationLoopState = Annotation.Root({
  // Document context
  docId: Annotation<number>,
  docTitle: Annotation<string>,
  content: Annotation<string>,

  // Agent-specific context (prompt variables)
  context: Annotation<Record<string, unknown>>,

  // Loop control
  attempt: Annotation<number>,
  maxRetries: Annotation<number>,
  feedback: Annotation<string | null>,

  // Analysis result (agent-specific schema stored as any)
  analysis: Annotation<unknown | null>,

  // Confirmation result
  confirmation: Annotation<ConfirmationResult | null>,

  // Messages for tool calls
  messages: Annotation<BaseMessage[]>({
    reducer: (prev, next) => [...prev, ...next],
  }),

  // Tool call tracking to prevent infinite loops
  toolCallCount: Annotation<number>,
  toolCallCache: Annotation<Record<string, string>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
  }),

  // Outcome flags
  confirmed: Annotation<boolean>,
  needsReview: Annotation<boolean>,
  error: Annotation<string | null>,
});

export type ConfirmationLoopStateType = typeof ConfirmationLoopState.State;

// ===========================================================================
// Logger Event Type
// ===========================================================================

export type ConfirmationLoopLogEventType =
  | 'prompt'
  | 'response'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'confirming'
  | 'retry';

export interface ConfirmationLoopLogEvent {
  eventType: ConfirmationLoopLogEventType;
  data: Record<string, unknown>;
  timestamp: string;
  id?: string;
  parentId?: string;
}

// ===========================================================================
// Graph Factory Configuration
// ===========================================================================

export interface ConfirmationLoopConfig<TAnalysis> {
  /** Agent type name */
  agentName: string;

  /** Zod schema for structured analysis output */
  analysisSchema: z.ZodType<TAnalysis>;

  /** System prompt for analysis */
  analysisSystemPrompt: string;

  /** Function to build user prompt from state */
  buildAnalysisPrompt: (state: ConfirmationLoopStateType) => string;

  /** System prompt for confirmation */
  confirmationSystemPrompt: string;

  /** Function to build confirmation prompt from analysis */
  buildConfirmationPrompt: (state: ConfirmationLoopStateType, analysis: TAnalysis) => string;

  /** Tools available to the agent (optional) */
  tools?: StructuredToolInterface[];

  /** Large model URL (for analysis) */
  largeModelUrl: string;

  /** Large model name */
  largeModelName: string;

  /** Small model URL (for confirmation) */
  smallModelUrl: string;

  /** Small model name */
  smallModelName: string;

  /** Optional logger for detailed event capture */
  logger?: (event: ConfirmationLoopLogEvent) => void;
}

// ===========================================================================
// Helper Functions
// ===========================================================================

/**
 * Extract thinking content from model response.
 * Handles <think>...</think> blocks, additional_kwargs.reasoning_content (LangChain),
 * and additional_kwargs.thinking (fallback).
 */
function extractThinking(response: AIMessage): string | undefined {
  const content = typeof response.content === 'string'
    ? response.content
    : Array.isArray(response.content)
      ? response.content.map(c => typeof c === 'string' ? c : (c as { text?: string }).text ?? '').join('')
      : '';

  // Extract <think>...</think> blocks (some models still use this)
  const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
  if (thinkMatch?.[1]) {
    return thinkMatch[1].trim();
  }

  // Check for reasoning_content (LangChain with reasoning: true)
  if (response.additional_kwargs?.reasoning_content) {
    return response.additional_kwargs.reasoning_content as string;
  }

  // Fallback: check thinking (older convention)
  if (response.additional_kwargs?.thinking) {
    return response.additional_kwargs.thinking as string;
  }

  return undefined;
}

/**
 * Check if a message is a ToolMessage.
 * Uses _getType() method when available (LangChain standard), with fallback to property check.
 * This is serialization-safe - works even after messages are deserialized from checkpointer.
 */
function isToolMessage(m: BaseMessage): boolean {
  // Check by _getType() method (LangChain standard)
  const msg = m as unknown as Record<string, unknown>;
  if (typeof msg._getType === 'function') {
    return (msg._getType as () => string)() === 'tool';
  }
  // Fallback: check for tool_call_id property (unique to ToolMessage)
  return 'tool_call_id' in m;
}

/**
 * Check if a message is an AIMessage with tool_calls.
 * Uses _getType() method when available, with fallback to property check.
 * This is serialization-safe - works even after messages are deserialized from checkpointer.
 */
function isAIMessageWithToolCalls(m: BaseMessage): boolean {
  const msg = m as unknown as Record<string, unknown>;
  // Check by _getType() method
  if (typeof msg._getType === 'function') {
    const isAI = (msg._getType as () => string)() === 'ai';
    return isAI && Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0;
  }
  // Fallback: check for tool_calls property
  return 'tool_calls' in msg && Array.isArray(msg.tool_calls) && (msg.tool_calls as unknown[]).length > 0;
}

/**
 * Get the type string of a message for logging purposes.
 * Returns a human-readable type identifier.
 */
function getMessageType(m: BaseMessage): string {
  if (isToolMessage(m)) return 'tool_result';
  if (isAIMessageWithToolCalls(m)) return 'ai_tool_call';
  // Use _getType if available
  const msg = m as unknown as Record<string, unknown>;
  if (typeof msg._getType === 'function') {
    return (msg._getType as () => string)();
  }
  // Fallback to constructor name
  return m.constructor?.name || 'unknown';
}

// ===========================================================================
// Node Functions
// ===========================================================================

// Helper to generate unique IDs for log events
const generateLogId = (prefix: string): string =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${prefix}`;

// Track the last prompt ID for parent-child relationships
let lastPromptId: string | undefined;
let lastResponseId: string | undefined;

/**
 * Creates the analyze node that can use tools before producing structured output.
 *
 * Flow:
 * 1. If tools available, model can request tool calls
 * 2. Tool results are added to messages
 * 3. Model continues until it produces a final response (no tool calls)
 * 4. Final response is parsed as structured output
 */
const createAnalyzeNode = <TAnalysis>(config: ConfirmationLoopConfig<TAnalysis>) => {
  return async (state: ConfirmationLoopStateType): Promise<Partial<ConfirmationLoopStateType>> => {
    try {
      // Build user prompt
      const userPrompt = config.buildAnalysisPrompt(state);

      // Build base messages
      const baseMessages: BaseMessage[] = [
        new SystemMessage(config.analysisSystemPrompt),
        new HumanMessage(userPrompt),
      ];

      // Add feedback if this is a retry
      if (state.feedback) {
        baseMessages.push(
          new HumanMessage(`Previous attempt was rejected. Feedback: ${state.feedback}\n\nPlease revise your analysis.`)
        );

        // Log retry event
        config.logger?.({
          eventType: 'retry',
          data: {
            attempt: state.attempt + 1,
            feedback: state.feedback,
          },
          timestamp: new Date().toISOString(),
          id: generateLogId('retry'),
        });
      }

      // Combine with any existing messages (tool calls and results from previous iterations)
      // Include both AIMessages with tool_calls and ToolMessages for proper message flow
      // Use serialization-safe checks instead of instanceof (which fails after checkpointer deserialization)
      const toolRelatedMessages = state.messages.filter(
        m => isToolMessage(m) || isAIMessageWithToolCalls(m)
      );
      const allMessages = [...baseMessages, ...toolRelatedMessages];

      // Check if this is a continuation after tool calls
      const isToolContinuation = state.messages.some(m => isToolMessage(m));

      // Generate prompt ID and log prompt event with message structure
      const promptId = generateLogId('prompt');
      lastPromptId = promptId;
      config.logger?.({
        eventType: 'prompt',
        data: {
          systemPrompt: config.analysisSystemPrompt,
          userPrompt,
          model: config.largeModelName,
          attempt: state.attempt + 1,
          // Include message structure for debugging
          isToolContinuation,
          messageCount: allMessages.length,
          messageTypes: allMessages.map(m => getMessageType(m)),
        },
        timestamp: new Date().toISOString(),
        id: promptId,
      });

      // Check if we have tools and should allow tool calls
      // Allow tools on first attempt OR when retrying with feedback (analysis was rejected)
      const shouldAllowTools = config.tools && config.tools.length > 0 && (!state.analysis || state.feedback);
      if (shouldAllowTools) {
        // First phase: Allow model to call tools
        const toolModel = new ChatOllama({
          baseUrl: config.largeModelUrl,
          model: config.largeModelName,
          temperature: 0.1,
          think: true,
        }).bindTools(config.tools!); // Non-null assertion safe due to shouldAllowTools check

        // Debug: Log actual messages being sent to verify tool results are included
        console.log('[DEBUG] Messages being sent to tool model:', JSON.stringify(allMessages.map(m => ({
          type: getMessageType(m),
          contentPreview: typeof m.content === 'string' ? m.content.slice(0, 100) : 'non-string',
          hasToolCalls: 'tool_calls' in m && Array.isArray((m as Record<string, unknown>).tool_calls),
          toolCallId: 'tool_call_id' in m ? (m as Record<string, unknown>).tool_call_id : undefined,
        })), null, 2));

        const response = await toolModel.invoke(allMessages);

        // Extract thinking from response
        const thinking = extractThinking(response as AIMessage);
        if (thinking) {
          config.logger?.({
            eventType: 'thinking',
            data: { thinking },
            timestamp: new Date().toISOString(),
            id: generateLogId('thinking'),
            parentId: promptId,
          });
        }

        // Check if model wants to call tools
        if ((response as AIMessage).tool_calls?.length) {
          // Log response with tool calls
          const responseId = generateLogId('response');
          lastResponseId = responseId;
          config.logger?.({
            eventType: 'response',
            data: {
              content: response.content,
              thinking,
              hasToolCalls: true,
              toolCalls: (response as AIMessage).tool_calls,
            },
            timestamp: new Date().toISOString(),
            id: responseId,
            parentId: promptId,
          });

          return {
            messages: [response],
            attempt: state.attempt, // Don't increment yet, we're still in tool loop
          };
        }
      }

      // Final phase: Get structured output
      const structuredModel = new ChatOllama({
        baseUrl: config.largeModelUrl,
        model: config.largeModelName,
        temperature: 0.1,
        format: 'json',
        think: true,
      }).withStructuredOutput(config.analysisSchema);

      const analysis = await structuredModel.invoke(allMessages);

      // Log response event
      const responseId = generateLogId('response');
      lastResponseId = responseId;
      config.logger?.({
        eventType: 'response',
        data: {
          content: JSON.stringify(analysis),
          hasToolCalls: false,
          analysis,
        },
        timestamp: new Date().toISOString(),
        id: responseId,
        parentId: promptId,
      });

      return {
        analysis,
        attempt: state.attempt + 1,
        // Keep messages for observability and debugging (tool call history)
      };
    } catch (error) {
      return {
        error: `Analysis failed: ${String(error)}`,
        attempt: state.attempt + 1,
      };
    }
  };
};

const createConfirmNode = <TAnalysis>(config: ConfirmationLoopConfig<TAnalysis>) => {
  return async (state: ConfirmationLoopStateType): Promise<Partial<ConfirmationLoopStateType>> => {
    try {
      if (!state.analysis) {
        return { error: 'No analysis to confirm' };
      }

      const model = new ChatOllama({
        baseUrl: config.smallModelUrl,
        model: config.smallModelName,
        temperature: 0,
        format: 'json', // Request JSON output
        think: true,
      });

      const structuredModel = model.withStructuredOutput(ConfirmationResultSchema);

      const confirmPrompt = config.buildConfirmationPrompt(state, state.analysis as TAnalysis);
      const messages = [
        new SystemMessage(config.confirmationSystemPrompt),
        new HumanMessage(confirmPrompt),
      ];

      const confirmation = await structuredModel.invoke(messages);

      // Log confirming event (child of the prompt that produced the analysis)
      config.logger?.({
        eventType: 'confirming',
        data: {
          model: config.smallModelName,
          systemPrompt: config.confirmationSystemPrompt,
          confirmPrompt,
          confirmed: confirmation.confirmed,
          feedback: confirmation.feedback,
        },
        timestamp: new Date().toISOString(),
        id: generateLogId('confirming'),
        parentId: lastPromptId,
      });

      return {
        confirmation,
        confirmed: confirmation.confirmed,
        feedback: confirmation.confirmed ? null : (confirmation.feedback ?? 'Not confirmed'),
      };
    } catch (error) {
      // On confirmation error, treat as not confirmed
      return {
        confirmation: { confirmed: false, feedback: `Confirmation error: ${String(error)}` },
        confirmed: false,
        feedback: `Confirmation error: ${String(error)}`,
      };
    }
  };
};

/**
 * Generate a cache key for a tool call to detect duplicates.
 */
const getToolCallCacheKey = (name: string, args: Record<string, unknown>): string => {
  return `${name}:${JSON.stringify(args, Object.keys(args).sort())}`;
};

const createToolNode = <TAnalysis>(config: ConfirmationLoopConfig<TAnalysis>) => {
  return async (state: ConfirmationLoopStateType): Promise<Partial<ConfirmationLoopStateType>> => {
    if (!config.tools?.length) {
      return {};
    }

    // Get the last message to check for tool calls
    // Use serialization-safe check instead of instanceof/type assertion
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || !isAIMessageWithToolCalls(lastMessage)) {
      return {};
    }

    const toolCalls = (lastMessage as unknown as { tool_calls: Array<{ name: string; args: Record<string, unknown>; id?: string }> }).tool_calls;
    const toolMessages: ToolMessage[] = [];
    const newCacheEntries: Record<string, string> = {};
    let newToolCallCount = 0;

    for (const toolCall of toolCalls) {
      const tool = config.tools.find((t) => t.name === toolCall.name);
      if (tool) {
        // Check for duplicate tool calls
        const cacheKey = getToolCallCacheKey(toolCall.name, toolCall.args);
        const cachedResult = state.toolCallCache[cacheKey];

        if (cachedResult) {
          // Return cached result for duplicate calls
          // Still count this as a tool call to prevent infinite loops
          newToolCallCount++;
          console.log(`[TOOL CACHE] Duplicate tool call detected: ${toolCall.name}, returning cached result (call ${state.toolCallCount + newToolCallCount}/${MAX_TOOL_CALLS})`);
          config.logger?.({
            eventType: 'tool_result',
            data: {
              toolName: toolCall.name,
              toolArgs: toolCall.args,
              cached: true,
              result: cachedResult,
            },
            timestamp: new Date().toISOString(),
            id: generateLogId('tool_result'),
            parentId: lastResponseId,
          });

          toolMessages.push(
            new ToolMessage({
              content: `[Cached - call ${state.toolCallCount + newToolCallCount}/${MAX_TOOL_CALLS}] ${cachedResult}`,
              tool_call_id: toolCall.id!,
            })
          );
          continue;
        }

        // Generate tool call ID
        const toolCallId = generateLogId('tool_call');
        newToolCallCount++;

        // Log tool_call event (child of the response that requested tools)
        config.logger?.({
          eventType: 'tool_call',
          data: {
            toolName: toolCall.name,
            toolArgs: toolCall.args,
          },
          timestamp: new Date().toISOString(),
          id: toolCallId,
          parentId: lastResponseId,
        });

        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const result = await (tool as any).invoke(toolCall.args);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

          // Cache the result
          newCacheEntries[cacheKey] = resultStr;

          // Log tool_result event (child of the tool call)
          config.logger?.({
            eventType: 'tool_result',
            data: {
              toolName: toolCall.name,
              result: typeof result === 'string' ? result : result,
            },
            timestamp: new Date().toISOString(),
            id: generateLogId('tool_result'),
            parentId: toolCallId,
          });

          toolMessages.push(
            new ToolMessage({
              content: resultStr,
              tool_call_id: toolCall.id!,
            })
          );
        } catch (error) {
          const errorResult = `Tool error: ${String(error)}`;
          // Cache error results too to prevent repeated failing calls
          newCacheEntries[cacheKey] = errorResult;

          // Log tool error (child of the tool call)
          config.logger?.({
            eventType: 'tool_result',
            data: {
              toolName: toolCall.name,
              error: String(error),
            },
            timestamp: new Date().toISOString(),
            id: generateLogId('tool_result'),
            parentId: toolCallId,
          });

          toolMessages.push(
            new ToolMessage({
              content: errorResult,
              tool_call_id: toolCall.id!,
            })
          );
        }
      }
    }

    return {
      messages: toolMessages,
      toolCallCount: state.toolCallCount + newToolCallCount,
      toolCallCache: newCacheEntries,
    };
  };
};

// ===========================================================================
// Conditional Edges
// ===========================================================================

const shouldContinueAfterAnalysis = (state: ConfirmationLoopStateType): string => {
  if (state.error) {
    return 'error';
  }

  // Check for tool calls (use serialization-safe check)
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage && isAIMessageWithToolCalls(lastMessage)) {
    // Enforce maximum tool call limit to prevent infinite loops
    if (state.toolCallCount >= MAX_TOOL_CALLS) {
      console.log(`[TOOL LIMIT] Maximum tool calls (${MAX_TOOL_CALLS}) reached, forcing structured output`);
      return 'confirm';
    }
    return 'tools';
  }

  return 'confirm';
};

const shouldRetry = (state: ConfirmationLoopStateType): string => {
  if (state.error) {
    return 'queue_review';
  }

  if (state.confirmed) {
    return 'apply';
  }

  if (state.attempt >= state.maxRetries) {
    return 'queue_review';
  }

  return 'analyze';
};

// ===========================================================================
// Graph Factory
// ===========================================================================

/**
 * Creates a LangGraph confirmation loop for any agent type.
 */
export const createConfirmationLoopGraph = <TAnalysis>(
  config: ConfirmationLoopConfig<TAnalysis>
) => {
  // Create memory saver for graph execution context
  const memory = new MemorySaver();

  const graph = new StateGraph(ConfirmationLoopState)
    // Add nodes
    .addNode('analyze', createAnalyzeNode(config))
    .addNode('confirm', createConfirmNode(config))
    .addNode('tools', createToolNode(config))
    .addNode('apply', async (state) => {
      // Apply is handled externally - just mark as complete
      return { confirmed: true };
    })
    .addNode('queue_review', async (state) => {
      return { needsReview: true };
    })

    // Add edges
    .addEdge('__start__', 'analyze')
    .addConditionalEdges('analyze', shouldContinueAfterAnalysis, {
      tools: 'tools',
      confirm: 'confirm',
      error: 'queue_review',
    })
    .addEdge('tools', 'analyze')
    .addConditionalEdges('confirm', shouldRetry, {
      analyze: 'analyze',
      apply: 'apply',
      queue_review: 'queue_review',
    })
    .addEdge('apply', END)
    .addEdge('queue_review', END);

  return graph.compile({ checkpointer: memory });
};

// ===========================================================================
// Execution Helper
// ===========================================================================

export interface ConfirmationLoopInput {
  docId: number;
  docTitle: string;
  content: string;
  context: Record<string, unknown>;
  maxRetries: number;
}

export interface ConfirmationLoopResult<TAnalysis> {
  success: boolean;
  analysis: TAnalysis | null;
  confirmed: boolean;
  needsReview: boolean;
  attempts: number;
  error: string | null;
}

/**
 * Runs the confirmation loop graph.
 */
export const runConfirmationLoop = async <TAnalysis>(
  graph: ReturnType<typeof createConfirmationLoopGraph<TAnalysis>>,
  input: ConfirmationLoopInput,
  threadId: string
): Promise<ConfirmationLoopResult<TAnalysis>> => {
  const initialState: ConfirmationLoopStateType = {
    docId: input.docId,
    docTitle: input.docTitle,
    content: input.content,
    context: input.context,
    attempt: 0,
    maxRetries: input.maxRetries,
    feedback: null,
    analysis: null,
    confirmation: null,
    messages: [],
    toolCallCount: 0,
    toolCallCache: {},
    confirmed: false,
    needsReview: false,
    error: null,
  };

  const finalState = await graph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });

  return {
    success: finalState.confirmed && !finalState.error,
    analysis: finalState.analysis as TAnalysis | null,
    confirmed: finalState.confirmed,
    needsReview: finalState.needsReview,
    attempts: finalState.attempt,
    error: finalState.error,
  };
};

/**
 * Streams the confirmation loop execution.
 */
export async function* streamConfirmationLoop<TAnalysis>(
  graph: ReturnType<typeof createConfirmationLoopGraph<TAnalysis>>,
  input: ConfirmationLoopInput,
  threadId: string
): AsyncGenerator<{ node: string; state: Partial<ConfirmationLoopStateType> }> {
  const initialState: ConfirmationLoopStateType = {
    docId: input.docId,
    docTitle: input.docTitle,
    content: input.content,
    context: input.context,
    attempt: 0,
    maxRetries: input.maxRetries,
    feedback: null,
    analysis: null,
    confirmation: null,
    messages: [],
    toolCallCount: 0,
    toolCallCache: {},
    confirmed: false,
    needsReview: false,
    error: null,
  };

  const stream = await graph.stream(initialState, {
    configurable: { thread_id: threadId },
    streamMode: 'updates',
  });

  for await (const chunk of stream) {
    for (const [node, state] of Object.entries(chunk)) {
      yield { node, state: state as Partial<ConfirmationLoopStateType> };
    }
  }
}
