/**
 * Bootstrap analysis job - analyzes all documents using AI to suggest new schema entities.
 *
 * This job runs SchemaAnalysis on all documents to discover:
 * - New correspondents that should be created
 * - New document types that should be created
 * - New tags that should be created
 *
 * Uses a slightly relaxed confidence threshold (0.85 vs 0.9 in pipeline) since
 * bootstrap is meant to discover entities across many documents.
 *
 * Tracks pending suggestions across documents to avoid duplicates.
 */
import { Effect, Context, Layer, Ref, Fiber } from 'effect';
import { ChatOllama } from '@langchain/ollama';
import { z } from 'zod';
import { ConfigService, PaperlessService, TinyBaseService, OllamaService, PromptService } from '../services/index.js';
import { JobError } from '../errors/index.js';

// ===========================================================================
// Types
// ===========================================================================

export type AnalysisType = 'all' | 'correspondents' | 'document_types' | 'tags';

export interface SuggestionsByType {
  correspondents: number;
  documentTypes: number;
  tags: number;
}

export interface BootstrapProgress {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  analysisType: AnalysisType;
  total: number;
  processed: number;
  suggestionsFound: number;
  suggestionsByType: SuggestionsByType;
  errors: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  // Enhanced progress tracking
  totalDocuments: number | null;
  currentEntityCount: number | null;
  avgSecondsPerDocument: number | null;
  estimatedRemainingSeconds: number | null;
}

// Schema for LLM structured output
const BootstrapAnalysisResultSchema = z.object({
  suggestions: z.array(z.object({
    entity_type: z.enum(['correspondent', 'document_type', 'tag']),
    suggested_name: z.string(),
    reasoning: z.string(),
    confidence: z.number(),
    similar_to_existing: z.array(z.string()),
  })),
  matches_pending: z.array(z.object({
    entity_type: z.enum(['correspondent', 'document_type', 'tag']),
    matched_name: z.string(),
  })),
  reasoning: z.string(),
  no_suggestions_reason: z.string().optional(),
});

type BootstrapAnalysisResult = z.infer<typeof BootstrapAnalysisResultSchema>;

// ===========================================================================
// Service Interface
// ===========================================================================

export interface BootstrapJobService {
  readonly start: (analysisType: AnalysisType) => Effect.Effect<void, JobError>;
  readonly getProgress: () => Effect.Effect<BootstrapProgress, never>;
  readonly cancel: () => Effect.Effect<void, never>;
  readonly skip: (count?: number) => Effect.Effect<void, never>;
}

export const BootstrapJobService = Context.GenericTag<BootstrapJobService>('BootstrapJobService');

// ===========================================================================
// Prompt Template Helpers
// ===========================================================================

/**
 * Fill in placeholders in the schema_analysis prompt template.
 * The prompt file contains placeholders like {document_content}, {existing_correspondents}, etc.
 */
const fillPromptTemplate = (
  template: string,
  values: {
    documentContent: string;
    existingCorrespondents: string[];
    existingDocTypes: string[];
    existingTags: string[];
    pendingCorrespondents: string[];
    pendingDocTypes: string[];
    pendingTags: string[];
    blockedGlobal: string[];
    blockedCorrespondents: string[];
    blockedDocTypes: string[];
    blockedTags: string[];
    similarDocs?: string;
  }
): string => {
  return template
    .replace('{document_content}', values.documentContent.slice(0, 8000))
    .replace('{existing_correspondents}', values.existingCorrespondents.join(', ') || 'None')
    .replace('{existing_document_types}', values.existingDocTypes.join(', ') || 'None')
    .replace('{existing_tags}', values.existingTags.join(', ') || 'None')
    .replace('{pending_correspondents}', values.pendingCorrespondents.join(', ') || 'None')
    .replace('{pending_document_types}', values.pendingDocTypes.join(', ') || 'None')
    .replace('{pending_tags}', values.pendingTags.join(', ') || 'None')
    .replace('{blocked_global}', values.blockedGlobal.join(', ') || 'None')
    .replace('{blocked_correspondents}', values.blockedCorrespondents.join(', ') || 'None')
    .replace('{blocked_document_types}', values.blockedDocTypes.join(', ') || 'None')
    .replace('{blocked_tags}', values.blockedTags.join(', ') || 'None')
    .replace('{similar_docs}', values.similarDocs ?? 'No similar documents available');
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const BootstrapJobServiceLive = Layer.effect(
  BootstrapJobService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const ollama = yield* OllamaService;
    const promptService = yield* PromptService;

    const progressRef = yield* Ref.make<BootstrapProgress>({
      status: 'idle',
      analysisType: 'all',
      total: 0,
      processed: 0,
      suggestionsFound: 0,
      suggestionsByType: { correspondents: 0, documentTypes: 0, tags: 0 },
      errors: 0,
      currentDocId: null,
      currentDocTitle: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      totalDocuments: null,
      currentEntityCount: null,
      avgSecondsPerDocument: null,
      estimatedRemainingSeconds: null,
    });

    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, JobError> | null>(null);
    const skipCountRef = yield* Ref.make(0);
    const cancelledRef = yield* Ref.make(false);

    // Get Ollama settings
    const settings = yield* tinybase.getAllSettings();
    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');

    // Confidence threshold for bootstrap (slightly relaxed)
    const CONFIDENCE_THRESHOLD = 0.85;

    // Helper to get blocked names
    const getBlockedNames = (blockType: string): Effect.Effect<Set<string>, never> =>
      Effect.gen(function* () {
        const blocked = yield* tinybase.getBlockedSuggestions(blockType as 'correspondent' | 'document_type' | 'tag' | 'global');
        return new Set(blocked.map((b) => b.normalizedName));
      }).pipe(Effect.catchAll(() => Effect.succeed(new Set<string>())));

    // Build the analysis prompt using the localized template
    const buildPrompt = (
      promptTemplate: string,
      content: string,
      analysisType: AnalysisType,
      existingCorrespondents: string[],
      existingDocTypes: string[],
      existingTags: string[],
      pendingSuggestions: { correspondent: string[]; document_type: string[]; tag: string[] },
      blockedCorrespondents: Set<string>,
      blockedDocTypes: Set<string>,
      blockedTags: Set<string>,
      blockedGlobal: Set<string>
    ): string => {
      // Fill in the template placeholders
      let prompt = fillPromptTemplate(promptTemplate, {
        documentContent: content,
        existingCorrespondents,
        existingDocTypes,
        existingTags,
        pendingCorrespondents: pendingSuggestions.correspondent,
        pendingDocTypes: pendingSuggestions.document_type,
        pendingTags: pendingSuggestions.tag,
        blockedGlobal: [...blockedGlobal],
        blockedCorrespondents: [...blockedCorrespondents],
        blockedDocTypes: [...blockedDocTypes],
        blockedTags: [...blockedTags],
      });

      // Add analysis type instruction for bootstrap (slightly relaxed threshold)
      const analysisInstructions = analysisType === 'all'
        ? `\n\n## Bootstrap Mode\nThis is a bootstrap analysis. Analyze for correspondents, document types, AND tags.\nNote: Using relaxed confidence threshold of ${CONFIDENCE_THRESHOLD} for bootstrap discovery.`
        : `\n\n## Bootstrap Mode\nThis is a bootstrap analysis. Analyze ONLY for ${analysisType.replace('_', ' ')}.\nNote: Using relaxed confidence threshold of ${CONFIDENCE_THRESHOLD} for bootstrap discovery.`;

      prompt += analysisInstructions;

      return prompt;
    };

    return {
      start: (analysisType) =>
        Effect.gen(function* () {
          const currentFiber = yield* Ref.get(fiberRef);
          if (currentFiber) {
            return yield* Effect.fail(
              new JobError({ message: 'Bootstrap job already running', jobName: 'bootstrap' })
            );
          }

          yield* Ref.set(cancelledRef, false);
          yield* Ref.set(skipCountRef, 0);
          yield* Ref.set(progressRef, {
            status: 'running',
            analysisType,
            total: 0,
            processed: 0,
            suggestionsFound: 0,
            suggestionsByType: { correspondents: 0, documentTypes: 0, tags: 0 },
            errors: 0,
            currentDocId: null,
            currentDocTitle: 'Initializing...',
            startedAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: null,
            totalDocuments: null,
            currentEntityCount: null,
            avgSecondsPerDocument: null,
            estimatedRemainingSeconds: null,
          });

          const runAnalysis = Effect.gen(function* () {
            // Track pending suggestions across all documents
            const pendingSuggestions: { correspondent: string[]; document_type: string[]; tag: string[] } = {
              correspondent: [],
              document_type: [],
              tag: [],
            };

            // Track suggestion counts by type
            const suggestionsByType: SuggestionsByType = {
              correspondents: 0,
              documentTypes: 0,
              tags: 0,
            };

            // Processing time tracking
            const processingTimes: number[] = [];

            // Get all documents
            yield* Ref.update(progressRef, (p) => ({
              ...p,
              currentDocTitle: 'Fetching documents...',
            }));

            const documents = yield* paperless.getDocuments({ pageSize: 10000 });
            const totalDocs = documents.length;

            yield* Ref.update(progressRef, (p) => ({
              ...p,
              total: totalDocs,
              totalDocuments: totalDocs,
              currentDocTitle: 'Fetching existing entities...',
            }));

            // Get existing entities from Paperless
            const [correspondents, docTypes, tags] = yield* Effect.all([
              paperless.getCorrespondents(),
              paperless.getDocumentTypes(),
              paperless.getTags(),
            ]);

            const existingCorrespondents = correspondents.map((c) => c.name);
            const existingDocTypes = docTypes.map((dt) => dt.name);
            const existingTags = tags.map((t) => t.name);

            // Get blocked suggestions
            const [blockedCorrespondents, blockedDocTypes, blockedTags, blockedGlobal] = yield* Effect.all([
              getBlockedNames('correspondent'),
              getBlockedNames('document_type'),
              getBlockedNames('tag'),
              getBlockedNames('global'),
            ]);

            // Load the localized prompt template (falls back to English if not available)
            const promptInfo = yield* promptService.getPrompt('schema_analysis').pipe(
              Effect.catchAll(() => Effect.succeed({ name: 'schema_analysis', content: '', category: 'system' as const }))
            );
            const promptTemplate = promptInfo.content;

            if (!promptTemplate) {
              console.error('[Bootstrap] Failed to load schema_analysis prompt template');
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                status: 'error' as const,
                errorMessage: 'Failed to load prompt template',
                completedAt: new Date().toISOString(),
              }));
              return;
            }

            // Create LLM client
            const llm = new ChatOllama({
              baseUrl: ollamaUrl,
              model: largeModel,
              temperature: 0.1,
              format: 'json',
            }).withStructuredOutput(BootstrapAnalysisResultSchema);

            // Process each document
            for (let i = 0; i < documents.length; i++) {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) break;

              // Check for skip
              const skipCount = yield* Ref.get(skipCountRef);
              if (skipCount > 0) {
                yield* Ref.update(skipCountRef, (n) => n - 1);
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  processed: p.processed + 1,
                }));
                continue;
              }

              const doc = documents[i]!;
              const docStartTime = Date.now();

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                currentDocId: doc.id,
                currentDocTitle: doc.title ?? `Document ${doc.id}`,
              }));

              // Skip documents without content
              if (!doc.content || doc.content.length < 100) {
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  processed: p.processed + 1,
                }));
                continue;
              }

              // Build prompt using the localized template
              const prompt = buildPrompt(
                promptTemplate,
                doc.content,
                analysisType,
                existingCorrespondents,
                existingDocTypes,
                existingTags,
                pendingSuggestions,
                blockedCorrespondents,
                blockedDocTypes,
                blockedTags,
                blockedGlobal
              );

              const analysisResult = yield* Effect.tryPromise({
                try: async () => {
                  // Use the filled prompt template directly (it contains all instructions)
                  const messages = [
                    { role: 'user' as const, content: prompt },
                  ];
                  return await llm.invoke(messages);
                },
                catch: (e) => e,
              }).pipe(
                Effect.catchAll((e) => {
                  console.error(`[Bootstrap] Analysis failed for doc ${doc.id}:`, e);
                  return Effect.succeed<BootstrapAnalysisResult>({
                    suggestions: [],
                    matches_pending: [],
                    reasoning: `Error: ${e}`,
                  });
                })
              );

              // Filter suggestions by confidence and blocked lists
              const validSuggestions = (analysisResult.suggestions ?? []).filter((s) => {
                if (s.confidence < CONFIDENCE_THRESHOLD) return false;
                const normalized = s.suggested_name.trim().toLowerCase();
                if (blockedGlobal.has(normalized)) return false;
                if (s.entity_type === 'correspondent' && blockedCorrespondents.has(normalized)) return false;
                if (s.entity_type === 'document_type' && blockedDocTypes.has(normalized)) return false;
                if (s.entity_type === 'tag' && blockedTags.has(normalized)) return false;
                // Check if already in pending
                if (s.entity_type === 'correspondent' && pendingSuggestions.correspondent.some(p => p.toLowerCase() === normalized)) return false;
                if (s.entity_type === 'document_type' && pendingSuggestions.document_type.some(p => p.toLowerCase() === normalized)) return false;
                if (s.entity_type === 'tag' && pendingSuggestions.tag.some(p => p.toLowerCase() === normalized)) return false;
                return true;
              });

              // Queue valid suggestions for review and track them
              for (const suggestion of validSuggestions) {
                // Add to pending tracking
                if (suggestion.entity_type === 'correspondent') {
                  pendingSuggestions.correspondent.push(suggestion.suggested_name);
                  suggestionsByType.correspondents++;
                } else if (suggestion.entity_type === 'document_type') {
                  pendingSuggestions.document_type.push(suggestion.suggested_name);
                  suggestionsByType.documentTypes++;
                } else if (suggestion.entity_type === 'tag') {
                  pendingSuggestions.tag.push(suggestion.suggested_name);
                  suggestionsByType.tags++;
                }

                // Add to pending review queue
                const pendingId = yield* tinybase.addPendingReview({
                  docId: doc.id,
                  docTitle: doc.title ?? `Document ${doc.id}`,
                  type: suggestion.entity_type,
                  suggestion: suggestion.suggested_name,
                  reasoning: suggestion.reasoning,
                  alternatives: suggestion.similar_to_existing,
                  attempts: 1,
                  lastFeedback: null,
                  nextTag: null,
                  metadata: JSON.stringify({
                    entityType: suggestion.entity_type,
                    confidence: suggestion.confidence,
                    isBootstrap: true,
                    sourceDocId: doc.id,
                  }),
                });

                if (pendingId !== null) {
                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    suggestionsFound: p.suggestionsFound + 1,
                    suggestionsByType: { ...suggestionsByType },
                  }));
                }
              }

              // Update processing time estimates
              const docDuration = (Date.now() - docStartTime) / 1000;
              processingTimes.push(docDuration);
              // Keep last 20 for rolling average
              if (processingTimes.length > 20) processingTimes.shift();

              const avgSeconds = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
              const remaining = totalDocs - (i + 1);
              const estimatedRemaining = Math.ceil(remaining * avgSeconds);

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                processed: p.processed + 1,
                suggestionsByType: { ...suggestionsByType },
                avgSecondsPerDocument: avgSeconds,
                estimatedRemainingSeconds: estimatedRemaining,
              }));

              // Small delay to avoid overwhelming the LLM
              yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 100)));
            }

            const cancelled = yield* Ref.get(cancelledRef);
            yield* Ref.update(progressRef, (p) => ({
              ...p,
              status: (cancelled ? 'cancelled' : 'completed') as BootstrapProgress['status'],
              completedAt: new Date().toISOString(),
              currentDocId: null,
              currentDocTitle: null,
            }));
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error('[Bootstrap] Job failed:', errorMessage);
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  status: 'error' as const,
                  errors: p.errors + 1,
                  errorMessage,
                  completedAt: new Date().toISOString(),
                }));
              })
            )
          );

          // Use forkDaemon so the fiber survives after the HTTP request completes
          const fiber = yield* Effect.forkDaemon(
            runAnalysis.pipe(
              Effect.mapError((e) =>
                new JobError({
                  message: `Bootstrap analysis failed: ${e}`,
                  jobName: 'bootstrap',
                  cause: e,
                })
              )
            )
          );

          yield* Ref.set(fiberRef, fiber);

          // Wait for completion and clean up fiber ref (also daemon to survive request)
          yield* Effect.forkDaemon(
            Effect.gen(function* () {
              yield* Fiber.await(fiber);
              yield* Ref.set(fiberRef, null);
            })
          );
        }),

      getProgress: () => Ref.get(progressRef),

      cancel: () =>
        Effect.gen(function* () {
          yield* Ref.set(cancelledRef, true);
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
          }
          yield* Ref.update(progressRef, (p) => ({
            ...p,
            status: 'cancelled' as const,
            completedAt: new Date().toISOString(),
          }));
        }),

      skip: (count = 1) => Ref.update(skipCountRef, (n) => n + count),
    };
  })
);
