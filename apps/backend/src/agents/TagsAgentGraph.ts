/**
 * LangGraph-based Tags assignment agent.
 *
 * This agent uses the generic confirmation loop pattern with LangGraph
 * for structured state management and tool-augmented analysis.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import {
  ConfigService,
  OllamaService,
  PromptService,
  TinyBaseService,
  PaperlessService,
  QdrantService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Agent, AgentProcessResult, StreamEvent } from './base.js';
import {
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';
import {
  TagsAnalysisSchema,
  type TagsAnalysis,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
  type ConfirmationLoopLogEvent,
} from './graph/index.js';
import type { ProcessingLogEventType } from '../services/TinyBaseService.js';

// ===========================================================================
// Types
// ===========================================================================

export interface TagsInput {
  docId: number;
  content: string;
  docTitle: string;
  documentType?: string;
  existingTags: string[];
  currentTagIds: number[];
}

export interface TagsResult extends AgentProcessResult {
  tags: string[];
  newTags: string[];
  removedTags: string[];
  newTagsQueued: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface TagsAgentGraphService extends Agent<TagsInput, TagsResult> {
  readonly name: 'tags';
  readonly process: (input: TagsInput) => Effect.Effect<TagsResult, AgentError>;
  readonly processStream: (input: TagsInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TagsAgentGraphService = Context.GenericTag<TagsAgentGraphService>('TagsAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document tagging specialist. Your task is to analyze documents and suggest relevant, consistent tags.

## Tool Usage Guidelines

You have access to tools to search for similar processed documents. These tools are OPTIONAL and should be used sparingly:
- Only call a tool if you genuinely need more information
- If a tool returns "not found" or empty results, DO NOT call the same tool again - proceed with your analysis
- Make at most 2-3 tool calls total, then provide your final answer
- You can make your decision based on the document content alone if tools don't provide useful information

Guidelines:
1. Prefer existing tags for consistency
2. Be selective - 2-5 tags is usually appropriate
3. Each tag should add value for finding/organizing documents
4. Follow patterns from similar documents
5. Keep already applied tags unless there's a strong reason to remove them
6. Document type names are NOT tags - never suggest the document type as a tag

IMPORTANT: Only suggest new tags (is_new: true) when:
- No existing tag covers the concept at all
- You have very high confidence (>0.9)
- Multiple documents would benefit from this tag

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing tag suggestions.

Evaluation criteria:
- Are all suggested tags relevant to the document?
- Are there obvious tags that are missing?
- Is the number of tags appropriate (2-5 typically)?
- Do they follow the existing tagging patterns?

Confirm if:
- All tags are relevant and useful
- The selection is complete without being excessive
- Patterns from similar documents are followed

Reject if:
- Irrelevant tags are suggested
- Important categories are missing
- Too many or too few tags
- New tags are suggested when existing ones would work

You MUST respond with structured JSON matching the required schema.`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const TagsAgentGraphServiceLive = Layer.effect(
  TagsAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;

    const { autoProcessing, tags: tagConfig } = config.config;
    const settings = yield* tinybase.getAllSettings();

    // Get Ollama config
    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');
    const smallModel = ollama.getModel('small');

    // Create tools
    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    // Filter out workflow tags
    const filterWorkflowTags = (tags: string[]): string[] =>
      tags.filter((t) => !t.startsWith('llm-') && !t.startsWith('LLM-'));

    // Create the confirmation loop graph
    const graphConfig: ConfirmationLoopConfig<TagsAnalysis> = {
      agentName: 'tags',
      analysisSchema: TagsAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as {
          existingTags: string[];
          documentType?: string;
          currentTags?: string[];
          tagDescriptions?: string;
          documentTypeNames?: string;
        };

        return `## Document Content

${state.content.slice(0, 8000)}

## Document Type

This document has been classified as: **${ctx.documentType ?? 'Not assigned'}**

CRITICAL: Document type names are NOT tags. Never suggest the document type name as a tag.

## Already Applied Tags

${ctx.currentTags?.length ? ctx.currentTags.join(', ') : 'None'}

## Available Existing Tags

${ctx.existingTags.join(', ')}

${ctx.tagDescriptions ? `## Tag Descriptions\n\n${ctx.tagDescriptions}` : ''}

${ctx.documentTypeNames ? `## Document Type Names (DO NOT use as tags!)\n\n${ctx.documentTypeNames}` : ''}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Analyze this document and suggest appropriate tags. Use the search tools first to find similar documents and understand tagging patterns.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        const tagSummary = analysis.suggested_tags
          .map((t) => `- ${t.name} (${t.is_new ? 'NEW' : 'existing'}): ${t.relevance}`)
          .join('\n');

        const removeSummary = analysis.tags_to_remove.length
          ? `\n\nTags to remove:\n${analysis.tags_to_remove.map((t) => `- ${t.tag_name}: ${t.reason}`).join('\n')}`
          : '';

        return `## Analysis Result

Suggested tags:
${tagSummary}
${removeSummary}

Reasoning: ${analysis.reasoning}
Confidence: ${analysis.confidence}

## Document Excerpt

${state.content.slice(0, 4000)}

Review the tag suggestions and provide your confirmation decision.`;
      },
    };

    return {
      name: 'tags' as const,

      process: (input: TagsInput) =>
        Effect.gen(function* () {
          const filteredExistingTags = filterWorkflowTags(input.existingTags);

          // Get tag metadata for descriptions
          const tagMetadata = yield* tinybase.getAllTagMetadata();
          const tagDescriptions = tagMetadata
            .filter((t) => t.description)
            .map((t) => `- ${t.tagName}: ${t.description}`)
            .join('\n');

          // Get document types to exclude from tag suggestions
          const documentTypes = yield* paperless.getDocumentTypes();
          const documentTypeNames = documentTypes.map((dt) => dt.name).join(', ');

          // Get current tag names
          const allTags = yield* paperless.getTags();
          const currentTagNames = input.currentTagIds
            .map((id) => allTags.find((t) => t.id === id)?.name)
            .filter((n): n is string => !!n && !n.startsWith('llm-'));

          // Create logger to collect all events
          const logEntries: ConfirmationLoopLogEvent[] = [];
          const logger = (event: ConfirmationLoopLogEvent) => {
            logEntries.push(event);
          };

          // Log document context at start
          logger({
            eventType: 'prompt', // Use 'prompt' as context event
            data: {
              type: 'context',
              docId: input.docId,
              docTitle: input.docTitle,
              documentType: input.documentType,
              existingTags: filteredExistingTags,
              currentTags: currentTagNames,
            },
            timestamp: new Date().toISOString(),
          });

          // Create graph with logger
          const graphConfigWithLogger: ConfirmationLoopConfig<TagsAnalysis> = {
            ...graphConfig,
            logger,
          };
          const graph = createConfirmationLoopGraph(graphConfigWithLogger);

          // Run the graph
          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.docTitle,
                content: input.content,
                context: {
                  existingTags: filteredExistingTags,
                  documentType: input.documentType,
                  currentTags: currentTagNames,
                  tagDescriptions,
                  documentTypeNames,
                },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `tags-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `Tags graph failed: ${e}`, agent: 'tags', cause: e }),
          });

          // Store all log entries (use captured timestamps and IDs)
          for (const entry of logEntries) {
            yield* tinybase.addProcessingLog({
              id: entry.id,
              docId: input.docId,
              timestamp: entry.timestamp,
              step: 'tags',
              eventType: entry.eventType as ProcessingLogEventType,
              data: entry.data,
              parentId: entry.parentId,
            });
          }

          const analysis = result.analysis as TagsAnalysis | null;

          if (!result.success || !analysis) {
            // Queue for review
            const pendingId = yield* tinybase.addPendingReview({
              docId: input.docId,
              docTitle: input.docTitle,
              type: 'tag',
              suggestion: analysis?.suggested_tags?.map((t) => t.name).join(', ') ?? '',
              reasoning: analysis?.reasoning ?? result.error ?? 'Analysis failed',
              alternatives: [],
              attempts: result.attempts,
              lastFeedback: result.error ?? 'Max retries exceeded',
              nextTag: tagConfig.tagsDone,
              metadata: null,
            });

            yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

            // Log result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'tags',
              eventType: 'result',
              data: {
                success: false,
                needsReview: true,
                pendingReviewCreated: pendingId !== null,
                reasoning: result.error ?? 'Confirmation failed',
                attempts: result.attempts,
              },
            });

            return {
              success: false,
              value: null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: analysis?.confidence ?? 0,
              alternatives: [],
              attempts: result.attempts,
              needsReview: true,
              tags: [],
              newTags: [],
              removedTags: [],
              newTagsQueued: [],
            };
          }

          // Apply the confirmed analysis
          const appliedTags: string[] = [];
          const removedTags: string[] = [];
          const newTagsQueued: string[] = [];

          const tagNameToId = new Map(allTags.map((t) => [t.name.toLowerCase(), t.id]));
          let updatedTagIds = [...input.currentTagIds];

          // Handle removals first
          for (const removal of analysis.tags_to_remove) {
            const tagId = tagNameToId.get(removal.tag_name.toLowerCase());
            if (tagId && updatedTagIds.includes(tagId) && !removal.tag_name.startsWith('llm-')) {
              updatedTagIds = updatedTagIds.filter((id) => id !== tagId);
              removedTags.push(removal.tag_name);
            }
          }

          // Add tags
          for (const tagSuggestion of analysis.suggested_tags) {
            if (tagSuggestion.is_new) {
              const pendingId = yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'tag',
                suggestion: tagSuggestion.name,
                reasoning: tagSuggestion.relevance || analysis.reasoning,
                alternatives: [],
                attempts: 1,
                lastFeedback: null,
                nextTag: tagConfig.tagsDone,
                metadata: JSON.stringify({ confidence: analysis.confidence }),
              });
              // Only count if actually persisted (not skipped due to empty name)
              if (pendingId !== null) {
                newTagsQueued.push(tagSuggestion.name);
              }
            } else {
              const tagId = tagSuggestion.existing_tag_id ?? tagNameToId.get(tagSuggestion.name.toLowerCase());
              if (tagId && !updatedTagIds.includes(tagId)) {
                updatedTagIds.push(tagId);
                appliedTags.push(tagSuggestion.name);
              }
            }
          }

          // Update document if changes were made
          if (appliedTags.length > 0 || removedTags.length > 0) {
            yield* paperless.updateDocument(input.docId, { tags: updatedTagIds });
          }

          // Transition tag
          yield* paperless.transitionDocumentTag(
            input.docId,
            tagConfig.documentTypeDone,
            tagConfig.tagsDone
          );

          // Clean up any existing pending review for this document and type
          yield* tinybase.removePendingReviewByDocAndType(input.docId, 'tag');

          // Remove manual review tag if it was previously set
          yield* paperless.removeTagFromDocument(input.docId, tagConfig.manualReview);

          // Log result
          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'tags',
            eventType: 'result',
            data: {
              success: true,
              appliedTags,
              removedTags,
              newTagsQueued,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: appliedTags.join(', '),
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: [],
            attempts: result.attempts,
            needsReview: newTagsQueued.length > 0,
            tags: appliedTags,
            newTags: newTagsQueued,
            removedTags,
            newTagsQueued,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Tags process failed: ${e}`, agent: 'tags', cause: e })
          )
        ),

      processStream: (input: TagsInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('tags')));

            const filteredExistingTags = filterWorkflowTags(input.existingTags);

            const tagMetadata = yield* tinybase.getAllTagMetadata();
            const tagDescriptions = tagMetadata
              .filter((t) => t.description)
              .map((t) => `- ${t.tagName}: ${t.description}`)
              .join('\n');

            const documentTypes = yield* paperless.getDocumentTypes();
            const documentTypeNames = documentTypes.map((dt) => dt.name).join(', ');

            const allTags = yield* paperless.getTags();
            const currentTagNames = input.currentTagIds
              .map((id) => allTags.find((t) => t.id === id)?.name)
              .filter((n): n is string => !!n && !n.startsWith('llm-'));

            // Create logger to collect all events
            const logEntries: ConfirmationLoopLogEvent[] = [];
            const logger = (event: ConfirmationLoopLogEvent) => {
              logEntries.push(event);
            };

            // Log document context at start
            logger({
              eventType: 'prompt',
              data: {
                type: 'context',
                docId: input.docId,
                docTitle: input.docTitle,
                documentType: input.documentType,
                existingTags: filteredExistingTags,
                currentTags: currentTagNames,
              },
              timestamp: new Date().toISOString(),
            });

            // Create graph with logger
            const graphConfigWithLogger: ConfirmationLoopConfig<TagsAnalysis> = {
              ...graphConfig,
              logger,
            };
            const graph = createConfirmationLoopGraph(graphConfigWithLogger);

            // Run graph and process results
            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: {
                    existingTags: filteredExistingTags,
                    documentType: input.documentType,
                    currentTags: currentTagNames,
                    tagDescriptions,
                    documentTypeNames,
                  },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `tags-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'tags' })));
              return;
            }

            let lastAnalysis: TagsAnalysis | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as TagsAnalysis;
                yield* Effect.sync(() =>
                  emit.single(emitAnalyzing('tags', `Attempt ${(state.attempt as number) ?? 1}`))
                );
                yield* Effect.sync(() =>
                  emit.single(emitThinking('tags', lastAnalysis!.reasoning))
                );
              }

              if (node === 'confirm' && lastAnalysis) {
                const tagSummary = lastAnalysis.suggested_tags
                  .map((t) => `${t.name} (${t.is_new ? 'NEW' : 'existing'})`)
                  .join(', ');
                yield* Effect.sync(() =>
                  emit.single(emitConfirming('tags', tagSummary))
                );
              }

              if (node === 'apply' && lastAnalysis) {
                // Apply changes
                const appliedTags: string[] = [];
                const removedTags: string[] = [];
                const newTagsQueued: string[] = [];

                const tagNameToId = new Map(allTags.map((t) => [t.name.toLowerCase(), t.id]));
                let updatedTagIds = [...input.currentTagIds];

                for (const removal of lastAnalysis.tags_to_remove) {
                  const tagId = tagNameToId.get(removal.tag_name.toLowerCase());
                  if (tagId && updatedTagIds.includes(tagId) && !removal.tag_name.startsWith('llm-')) {
                    updatedTagIds = updatedTagIds.filter((id) => id !== tagId);
                    removedTags.push(removal.tag_name);
                  }
                }

                for (const tagSuggestion of lastAnalysis.suggested_tags) {
                  if (tagSuggestion.is_new) {
                    const pendingId = yield* tinybase.addPendingReview({
                      docId: input.docId,
                      docTitle: input.docTitle,
                      type: 'tag',
                      suggestion: tagSuggestion.name,
                      reasoning: tagSuggestion.relevance || lastAnalysis.reasoning,
                      alternatives: [],
                      attempts: 1,
                      lastFeedback: null,
                      nextTag: tagConfig.tagsDone,
                      metadata: null,
                    });
                    // Only count if actually persisted (not skipped due to empty name)
                    if (pendingId !== null) {
                      newTagsQueued.push(tagSuggestion.name);
                    }
                  } else {
                    const tagId = tagSuggestion.existing_tag_id ?? tagNameToId.get(tagSuggestion.name.toLowerCase());
                    if (tagId && !updatedTagIds.includes(tagId)) {
                      updatedTagIds.push(tagId);
                      appliedTags.push(tagSuggestion.name);
                    }
                  }
                }

                if (appliedTags.length > 0 || removedTags.length > 0) {
                  yield* paperless.updateDocument(input.docId, { tags: updatedTagIds });
                }

                yield* paperless.transitionDocumentTag(
                  input.docId,
                  tagConfig.documentTypeDone,
                  tagConfig.tagsDone
                );

                // Clean up any existing pending review for this document and type
                yield* tinybase.removePendingReviewByDocAndType(input.docId, 'tag');

                // Remove manual review tag if it was previously set
                yield* paperless.removeTagFromDocument(input.docId, tagConfig.manualReview);

                yield* Effect.sync(() =>
                  emit.single(emitResult('tags', {
                    success: true,
                    tags: appliedTags,
                    newTags: newTagsQueued,
                    removedTags,
                  }))
                );

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'tags',
                  eventType: 'result',
                  data: {
                    success: true,
                    appliedTags,
                    removedTags,
                    newTagsQueued,
                    reasoning: lastAnalysis.reasoning,
                    confidence: lastAnalysis.confidence,
                  },
                });
              }

              if (node === 'queue_review' && lastAnalysis) {
                const pendingId = yield* tinybase.addPendingReview({
                  docId: input.docId,
                  docTitle: input.docTitle,
                  type: 'tag',
                  suggestion: lastAnalysis.suggested_tags.map((t) => t.name).join(', '),
                  reasoning: lastAnalysis.reasoning,
                  alternatives: [],
                  attempts: autoProcessing.confirmationMaxRetries,
                  lastFeedback: 'Max retries exceeded',
                  nextTag: tagConfig.tagsDone,
                  metadata: null,
                });

                yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

                yield* Effect.sync(() =>
                  emit.single(emitResult('tags', {
                    success: false,
                    needsReview: true,
                    tags: [],
                    newTags: [],
                    removedTags: [],
                  }))
                );

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'tags',
                  eventType: 'result',
                  data: {
                    success: false,
                    needsReview: true,
                    pendingReviewCreated: pendingId !== null,
                    reasoning: 'Max retries exceeded',
                  },
                });
              }
            }

            // Store all log entries (use captured timestamps and IDs)
            for (const entry of logEntries) {
              yield* tinybase.addProcessingLog({
                id: entry.id,
                docId: input.docId,
                timestamp: entry.timestamp,
                step: 'tags',
                eventType: entry.eventType as ProcessingLogEventType,
                data: entry.data,
                parentId: entry.parentId,
              });
            }

            yield* Effect.sync(() => emit.single(emitComplete('tags')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({ message: `Tags stream failed: ${e}`, agent: 'tags', cause: e })
            )
          )
        ),
    };
  })
);
