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

  // Outcome flags
  confirmed: Annotation<boolean>,
  needsReview: Annotation<boolean>,
  error: Annotation<string | null>,
});

export type ConfirmationLoopStateType = typeof ConfirmationLoopState.State;

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
}

// ===========================================================================
// Node Functions
// ===========================================================================

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
      // Build base messages
      const baseMessages: BaseMessage[] = [
        new SystemMessage(config.analysisSystemPrompt),
        new HumanMessage(config.buildAnalysisPrompt(state)),
      ];

      // Add feedback if this is a retry
      if (state.feedback) {
        baseMessages.push(
          new HumanMessage(`Previous attempt was rejected. Feedback: ${state.feedback}\n\nPlease revise your analysis.`)
        );
      }

      // Combine with any existing messages (tool calls and results from previous iterations)
      // Include both AIMessages with tool_calls and ToolMessages for proper message flow
      const toolRelatedMessages = state.messages.filter(
        m => m instanceof ToolMessage || (m instanceof AIMessage && (m as AIMessage).tool_calls?.length)
      );
      const allMessages = [...baseMessages, ...toolRelatedMessages];

      // Check if we have tools and should allow tool calls
      // Allow tools on first attempt OR when retrying with feedback (analysis was rejected)
      const shouldAllowTools = config.tools && config.tools.length > 0 && (!state.analysis || state.feedback);
      if (shouldAllowTools) {
        // First phase: Allow model to call tools
        const toolModel = new ChatOllama({
          baseUrl: config.largeModelUrl,
          model: config.largeModelName,
          temperature: 0.1,
        }).bindTools(config.tools!); // Non-null assertion safe due to shouldAllowTools check

        const response = await toolModel.invoke(allMessages);

        // Check if model wants to call tools
        if ((response as AIMessage).tool_calls?.length) {
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
      }).withStructuredOutput(config.analysisSchema);

      const analysis = await structuredModel.invoke(allMessages);

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
      });

      const structuredModel = model.withStructuredOutput(ConfirmationResultSchema);

      const messages = [
        new SystemMessage(config.confirmationSystemPrompt),
        new HumanMessage(config.buildConfirmationPrompt(state, state.analysis as TAnalysis)),
      ];

      const confirmation = await structuredModel.invoke(messages);

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

const createToolNode = <TAnalysis>(config: ConfirmationLoopConfig<TAnalysis>) => {
  return async (state: ConfirmationLoopStateType): Promise<Partial<ConfirmationLoopStateType>> => {
    if (!config.tools?.length) {
      return {};
    }

    // Get the last message to check for tool calls
    const lastMessage = state.messages[state.messages.length - 1];
    if (!lastMessage || !(lastMessage as AIMessage).tool_calls?.length) {
      return {};
    }

    const toolCalls = (lastMessage as AIMessage).tool_calls!;
    const toolMessages: ToolMessage[] = [];

    for (const toolCall of toolCalls) {
      const tool = config.tools.find((t) => t.name === toolCall.name);
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
};

// ===========================================================================
// Conditional Edges
// ===========================================================================

const shouldContinueAfterAnalysis = (state: ConfirmationLoopStateType): string => {
  if (state.error) {
    return 'error';
  }

  // Check for tool calls
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage && (lastMessage as AIMessage).tool_calls?.length) {
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
