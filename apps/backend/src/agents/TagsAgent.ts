/**
 * Tags assignment agent.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import { ConfigService, OllamaService, PromptService, TinyBaseService, PaperlessService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import {
  type Agent,
  type AgentProcessResult,
  type StreamEvent,
  runConfirmationLoop,
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';

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

export interface TagSuggestion {
  name: string;
  isNew: boolean;
  relevance: string;
}

export interface TagRemoval {
  tagName: string;
  reason: string;
}

export interface TagsAnalysis {
  suggestedTags: TagSuggestion[];
  tagsToRemove: TagRemoval[];
  reasoning: string;
  confidence: number;
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

export interface TagsAgentService extends Agent<TagsInput, TagsResult> {
  readonly name: 'tags';
  readonly process: (input: TagsInput) => Effect.Effect<TagsResult, AgentError>;
  readonly processStream: (input: TagsInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TagsAgentService = Context.GenericTag<TagsAgentService>('TagsAgentService');

// ===========================================================================
// Response Parsers
// ===========================================================================

const parseAnalysisResponse = (response: string, existingTags: string[]): TagsAnalysis => {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        suggested_tags?: Array<{ name: string; relevance?: string; is_new?: boolean; isNew?: boolean }>;
        suggestedTags?: Array<{ name: string; relevance?: string; is_new?: boolean; isNew?: boolean }>;
        tags_to_remove?: Array<{ tag_name?: string; tagName?: string; reason?: string }>;
        tagsToRemove?: Array<{ tag_name?: string; tagName?: string; reason?: string }>;
        reasoning?: string;
        confidence?: number;
      };

      const suggestedTags = (parsed.suggested_tags ?? parsed.suggestedTags ?? []).map((t) => ({
        name: t.name,
        isNew: t.is_new ?? t.isNew ?? !existingTags.some((e) => e.toLowerCase() === t.name.toLowerCase()),
        relevance: t.relevance ?? '',
      }));

      const tagsToRemove = (parsed.tags_to_remove ?? parsed.tagsToRemove ?? []).map((t) => ({
        tagName: t.tag_name ?? t.tagName ?? '',
        reason: t.reason ?? '',
      }));

      return {
        suggestedTags,
        tagsToRemove,
        reasoning: parsed.reasoning ?? '',
        confidence: parsed.confidence ?? 0.5,
      };
    }
  } catch {
    // Fall back to text extraction
  }

  // Simple text extraction fallback
  const lines = response.split('\n').filter(Boolean);
  const tags = lines[0]?.split(',').map((t) => t.trim()).filter(Boolean) ?? [];

  return {
    suggestedTags: tags.map((name) => ({
      name,
      isNew: !existingTags.some((e) => e.toLowerCase() === name.toLowerCase()),
      relevance: '',
    })),
    tagsToRemove: [],
    reasoning: lines.slice(1).join(' ').slice(0, 200),
    confidence: 0.5,
  };
};

const parseConfirmationResponse = (response: string): { confirmed: boolean; feedback?: string } => {
  const lower = response.toLowerCase();
  const confirmed = lower.includes('yes') || lower.includes('confirmed') || lower.includes('accept');
  const feedback = confirmed ? undefined : response.replace(/^(no|rejected|feedback:)\s*/i, '');
  return { confirmed, feedback };
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const TagsAgentServiceLive = Layer.effect(
  TagsAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const { autoProcessing, tags: tagConfig } = config.config;

    // Filter out workflow tags
    const filterWorkflowTags = (tags: string[]): string[] =>
      tags.filter((t) => !t.startsWith('llm-') && !t.startsWith('LLM-'));

    return {
      name: 'tags' as const,

      process: (input: TagsInput) =>
        runConfirmationLoop<TagsAnalysis, TagsResult>({
          maxRetries: autoProcessing.confirmationMaxRetries,

          analyze: (feedback) =>
            Effect.gen(function* () {
              const filteredTags = filterWorkflowTags(input.existingTags);

              const prompt = yield* prompts.renderPrompt('tags', {
                document_content: input.content.slice(0, 8000),
                existing_tags: JSON.stringify(filteredTags),
                document_type: input.documentType ?? 'Not assigned',
                feedback: feedback ?? 'None',
              });

              const response = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              return parseAnalysisResponse(response, filteredTags);
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Tags analysis failed: ${e}`,
                  agent: 'tags',
                  step: 'analyze',
                  cause: e,
                })
              )
            ),

          confirm: (analysis) =>
            Effect.gen(function* () {
              if (analysis.suggestedTags.length === 0) {
                return { confirmed: true }; // No tags to suggest is valid
              }

              const tagSummary = analysis.suggestedTags
                .map((t) => `${t.name} (${t.isNew ? 'NEW' : 'existing'}): ${t.relevance}`)
                .join('\n');

              const prompt = yield* prompts.renderPrompt('tags_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_tags: tagSummary,
                reasoning: analysis.reasoning,
              });

              const response = yield* ollama.generate(
                ollama.getModel('small'),
                prompt,
                { temperature: 0 }
              );

              return parseConfirmationResponse(response);
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Tags confirmation failed: ${e}`,
                  agent: 'tags',
                  step: 'confirm',
                  cause: e,
                })
              )
            ),

          apply: (analysis) =>
            Effect.gen(function* () {
              const appliedTags: string[] = [];
              const removedTags: string[] = [];
              const newTagsQueued: string[] = [];

              // Get all tags for ID lookup
              const allTags = yield* paperless.getTags();
              const tagNameToId = new Map(
                allTags.map((t) => [t.name.toLowerCase(), t.id])
              );

              // Work with current tag IDs
              let updatedTagIds = [...input.currentTagIds];

              // Handle tag removals first
              for (const removal of analysis.tagsToRemove) {
                const tagId = tagNameToId.get(removal.tagName.toLowerCase());
                // Don't remove workflow tags
                if (tagId && updatedTagIds.includes(tagId) && !removal.tagName.startsWith('llm-')) {
                  updatedTagIds = updatedTagIds.filter((id) => id !== tagId);
                  removedTags.push(removal.tagName);
                }
              }

              // Add new tags
              for (const tagSuggestion of analysis.suggestedTags) {
                if (tagSuggestion.isNew) {
                  // Queue new tags for user confirmation
                  newTagsQueued.push(tagSuggestion.name);

                  yield* tinybase.addPendingReview({
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
                } else {
                  // Find and apply existing tag
                  const tagId = tagNameToId.get(tagSuggestion.name.toLowerCase());
                  if (tagId && !updatedTagIds.includes(tagId)) {
                    updatedTagIds.push(tagId);
                    appliedTags.push(tagSuggestion.name);
                  }
                }
              }

              // Update document tags if there were changes
              if (appliedTags.length > 0 || removedTags.length > 0) {
                yield* paperless.updateDocument(input.docId, { tags: updatedTagIds });
              }

              // TagsAgent runs after TitleAgent in current pipeline
              yield* paperless.transitionDocumentTag(
                input.docId,
                tagConfig.titleDone,
                tagConfig.tagsDone
              );

              return {
                success: true,
                value: appliedTags.join(', '),
                reasoning: analysis.reasoning,
                confidence: analysis.confidence,
                alternatives: [],
                attempts: 1,
                needsReview: newTagsQueued.length > 0,
                tags: appliedTags,
                newTags: newTagsQueued,
                removedTags,
                newTagsQueued,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Tags application failed: ${e}`,
                  agent: 'tags',
                  step: 'apply',
                  cause: e,
                })
              )
            ),

          onMaxRetries: (lastAnalysis) =>
            Effect.gen(function* () {
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'tag',
                suggestion: lastAnalysis.suggestedTags.map((t) => t.name).join(', '),
                reasoning: lastAnalysis.reasoning,
                alternatives: [],
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.tagsDone,
                metadata: null,
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              return {
                success: false,
                value: lastAnalysis.suggestedTags.map((t) => t.name).join(', '),
                reasoning: lastAnalysis.reasoning,
                confidence: lastAnalysis.confidence,
                alternatives: [],
                attempts: autoProcessing.confirmationMaxRetries,
                needsReview: true,
                tags: [],
                newTags: [],
                removedTags: [],
                newTagsQueued: [],
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Tags queue failed: ${e}`,
                  agent: 'tags',
                  step: 'queue',
                  cause: e,
                })
              )
            ),
        }),

      processStream: (input: TagsInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('tags')));

            const filteredTags = filterWorkflowTags(input.existingTags);
            let feedback: string | null = null;
            let lastAnalysis: TagsAnalysis | null = null;

            for (let attempt = 0; attempt < autoProcessing.confirmationMaxRetries; attempt++) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('tags', `Attempt ${attempt + 1}`))
              );

              const prompt = yield* prompts.renderPrompt('tags', {
                document_content: input.content.slice(0, 8000),
                existing_tags: JSON.stringify(filteredTags),
                document_type: input.documentType ?? 'Not assigned',
                feedback: feedback ?? 'None',
              });

              const analysisResponse = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(analysisResponse, filteredTags);
              lastAnalysis = analysis;

              yield* Effect.sync(() =>
                emit.single(emitThinking('tags', analysis.reasoning))
              );

              if (analysis.suggestedTags.length === 0) {
                // No tags to suggest - this is valid
                yield* paperless.transitionDocumentTag(
                  input.docId,
                  tagConfig.titleDone,
                  tagConfig.tagsDone
                );

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('tags', {
                      success: true,
                      tags: [],
                      newTags: [],
                      removedTags: [],
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('tags')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              const tagSummary = analysis.suggestedTags
                .map((t) => `${t.name} (${t.isNew ? 'NEW' : 'existing'})`)
                .join(', ');

              yield* Effect.sync(() =>
                emit.single(emitConfirming('tags', tagSummary))
              );

              const confirmPrompt = yield* prompts.renderPrompt('tags_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_tags: tagSummary,
                reasoning: analysis.reasoning,
              });

              const confirmResponse = yield* ollama.generate(
                ollama.getModel('small'),
                confirmPrompt,
                { temperature: 0 }
              );

              const confirmation = parseConfirmationResponse(confirmResponse);

              if (confirmation.confirmed) {
                const appliedTags: string[] = [];
                const removedTags: string[] = [];
                const newTagsQueued: string[] = [];

                const allTags = yield* paperless.getTags();
                const tagNameToId = new Map(
                  allTags.map((t) => [t.name.toLowerCase(), t.id])
                );

                let updatedTagIds = [...input.currentTagIds];

                // Handle removals
                for (const removal of analysis.tagsToRemove) {
                  const tagId = tagNameToId.get(removal.tagName.toLowerCase());
                  if (tagId && updatedTagIds.includes(tagId) && !removal.tagName.startsWith('llm-')) {
                    updatedTagIds = updatedTagIds.filter((id) => id !== tagId);
                    removedTags.push(removal.tagName);
                  }
                }

                // Add tags
                for (const tagSuggestion of analysis.suggestedTags) {
                  if (tagSuggestion.isNew) {
                    newTagsQueued.push(tagSuggestion.name);

                    yield* tinybase.addPendingReview({
                      docId: input.docId,
                      docTitle: input.docTitle,
                      type: 'tag',
                      suggestion: tagSuggestion.name,
                      reasoning: tagSuggestion.relevance || analysis.reasoning,
                      alternatives: [],
                      attempts: 1,
                      lastFeedback: null,
                      nextTag: tagConfig.tagsDone,
                      metadata: null,
                    });
                  } else {
                    const tagId = tagNameToId.get(tagSuggestion.name.toLowerCase());
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
                  tagConfig.titleDone,
                  tagConfig.tagsDone
                );

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('tags', {
                      success: true,
                      tags: appliedTags,
                      newTags: newTagsQueued,
                      removedTags,
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('tags')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              feedback = confirmation.feedback ?? 'Not confirmed';
            }

            // Max retries - queue for review
            if (lastAnalysis) {
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'tag',
                suggestion: lastAnalysis.suggestedTags.map((t) => t.name).join(', '),
                reasoning: lastAnalysis.reasoning,
                alternatives: [],
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.tagsDone,
                metadata: null,
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('tags', {
                    success: false,
                    needsReview: true,
                    tags: [],
                    newTags: [],
                    removedTags: [],
                  })
                )
              );
            }

            yield* Effect.sync(() => emit.single(emitComplete('tags')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Tags stream failed: ${e}`,
                agent: 'tags',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
