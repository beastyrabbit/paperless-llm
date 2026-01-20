/**
 * Bootstrap analysis job - analyzes all documents and generates schema suggestions.
 */
import { Effect, Context, Layer, Ref, Fiber, pipe } from 'effect';
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
  totalDocuments: number | null;           // Total docs in Paperless (for "covering X documents")
  currentEntityCount: number | null;       // Count of entities in current phase (e.g., 47 correspondents)
  avgSecondsPerCategory: number | null;    // For time estimation
  estimatedRemainingSeconds: number | null; // ETA calculation
}

export interface SchemaSuggestion {
  type: 'schema_merge' | 'schema_delete';
  entityType: 'correspondent' | 'document_type' | 'tag';
  suggestion: string;
  reasoning: string;
  sourceId?: number;
  targetId?: number;
  documentCount: number;
}

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
// Analysis Helpers
// ===========================================================================

interface Entity {
  id: number;
  name: string;
  document_count?: number;
}

const normalizeString = (str: string): string =>
  str.toLowerCase().trim().replace(/\s+/g, ' ');

const findSimilarEntities = (entities: Entity[]): Array<{ source: Entity; target: Entity; similarity: number }> => {
  const similar: Array<{ source: Entity; target: Entity; similarity: number }> = [];

  for (let i = 0; i < entities.length; i++) {
    const e1 = entities[i];
    if (!e1) continue;

    for (let j = i + 1; j < entities.length; j++) {
      const e2 = entities[j];
      if (!e2) continue;

      const n1 = normalizeString(e1.name);
      const n2 = normalizeString(e2.name);

      // Check for exact match after normalization
      if (n1 === n2) {
        similar.push({ source: e1, target: e2, similarity: 1.0 });
        continue;
      }

      // Check for substring match
      if (n1.includes(n2) || n2.includes(n1)) {
        similar.push({ source: e1, target: e2, similarity: 0.8 });
        continue;
      }

      // Simple Levenshtein distance check for short strings
      if (n1.length <= 20 && n2.length <= 20) {
        const distance = levenshteinDistance(n1, n2);
        const maxLen = Math.max(n1.length, n2.length);
        const similarity = 1 - distance / maxLen;
        if (similarity >= 0.7) {
          similar.push({ source: e1, target: e2, similarity });
        }
      }
    }
  }

  return similar.sort((a, b) => b.similarity - a.similarity);
};

const levenshteinDistance = (a: string, b: string): number => {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i]![j] = matrix[i - 1]![j - 1]!;
      } else {
        matrix[i]![j] = Math.min(
          matrix[i - 1]![j - 1]! + 1,
          matrix[i]![j - 1]! + 1,
          matrix[i - 1]![j]! + 1
        );
      }
    }
  }

  return matrix[b.length]![a.length]!;
};

const findLowUsageEntities = (entities: Entity[], threshold = 1): Entity[] =>
  entities.filter((e) => (e.document_count ?? 0) <= threshold);

// ===========================================================================
// Live Implementation
// ===========================================================================

export const BootstrapJobServiceLive = Layer.effect(
  BootstrapJobService,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;

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
      avgSecondsPerCategory: null,
      estimatedRemainingSeconds: null,
    });

    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, JobError> | null>(null);
    const skipCountRef = yield* Ref.make(0);
    const cancelledRef = yield* Ref.make(false);

    const analyzeCorrespondents = (correspondents: Entity[]): SchemaSuggestion[] => {
      const suggestions: SchemaSuggestion[] = [];

      // Find similar correspondents
      const similar = findSimilarEntities(correspondents);
      for (const { source, target, similarity } of similar) {
        suggestions.push({
          type: 'schema_merge',
          entityType: 'correspondent',
          suggestion: `Merge "${source.name}" into "${target.name}"`,
          reasoning: `Similarity: ${(similarity * 100).toFixed(0)}%`,
          sourceId: source.id,
          targetId: target.id,
          documentCount: (source.document_count ?? 0) + (target.document_count ?? 0),
        });
      }

      // Find low-usage correspondents
      const lowUsage = findLowUsageEntities(correspondents, 0);
      for (const entity of lowUsage) {
        suggestions.push({
          type: 'schema_delete',
          entityType: 'correspondent',
          suggestion: `Delete unused correspondent "${entity.name}"`,
          reasoning: 'No documents assigned',
          sourceId: entity.id,
          documentCount: 0,
        });
      }

      return suggestions;
    };

    const analyzeDocumentTypes = (types: Entity[]): SchemaSuggestion[] => {
      const suggestions: SchemaSuggestion[] = [];

      const similar = findSimilarEntities(types);
      for (const { source, target, similarity } of similar) {
        suggestions.push({
          type: 'schema_merge',
          entityType: 'document_type',
          suggestion: `Merge "${source.name}" into "${target.name}"`,
          reasoning: `Similarity: ${(similarity * 100).toFixed(0)}%`,
          sourceId: source.id,
          targetId: target.id,
          documentCount: (source.document_count ?? 0) + (target.document_count ?? 0),
        });
      }

      const lowUsage = findLowUsageEntities(types, 0);
      for (const entity of lowUsage) {
        suggestions.push({
          type: 'schema_delete',
          entityType: 'document_type',
          suggestion: `Delete unused document type "${entity.name}"`,
          reasoning: 'No documents assigned',
          sourceId: entity.id,
          documentCount: 0,
        });
      }

      return suggestions;
    };

    const analyzeTags = (tags: Entity[]): SchemaSuggestion[] => {
      const suggestions: SchemaSuggestion[] = [];

      const similar = findSimilarEntities(tags);
      for (const { source, target, similarity } of similar) {
        suggestions.push({
          type: 'schema_merge',
          entityType: 'tag',
          suggestion: `Merge "${source.name}" into "${target.name}"`,
          reasoning: `Similarity: ${(similarity * 100).toFixed(0)}%`,
          sourceId: source.id,
          targetId: target.id,
          documentCount: (source.document_count ?? 0) + (target.document_count ?? 0),
        });
      }

      // Don't suggest deleting tags with no documents - they may be workflow tags
      return suggestions;
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
          yield* Ref.set(progressRef, {
            status: 'running',
            analysisType,
            total: 0,
            processed: 0,
            suggestionsFound: 0,
            suggestionsByType: { correspondents: 0, documentTypes: 0, tags: 0 },
            errors: 0,
            currentDocId: null,
            currentDocTitle: 'Initializing...', // Signal that initialization has started
            startedAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: null,
            totalDocuments: null,
            currentEntityCount: null,
            avgSecondsPerCategory: null,
            estimatedRemainingSeconds: null,
          });

          const runAnalysis = Effect.gen(function* () {
            let allSuggestions: SchemaSuggestion[] = [];
            let processedCategories = 0;
            const categoryDurations: number[] = [];

            // Calculate how many entity categories we'll process (for progress tracking)
            let totalCategories = 0;
            if (analysisType === 'all' || analysisType === 'correspondents') totalCategories++;
            if (analysisType === 'all' || analysisType === 'document_types') totalCategories++;
            if (analysisType === 'all' || analysisType === 'tags') totalCategories++;

            // Fetch total document count for context display
            const totalDocs = yield* paperless.getTotalDocumentCount();

            yield* Ref.update(progressRef, (p) => ({
              ...p,
              total: totalCategories,
              totalDocuments: totalDocs,
            }));

            // Helper to update timing estimates
            const updateTimingEstimates = (categoriesRemaining: number) => {
              if (categoryDurations.length === 0) return;
              const avgSeconds = categoryDurations.reduce((a, b) => a + b, 0) / categoryDurations.length;
              const estimatedRemaining = Math.ceil(categoriesRemaining * avgSeconds);
              return { avgSecondsPerCategory: avgSeconds, estimatedRemainingSeconds: estimatedRemaining };
            };

            if (analysisType === 'all' || analysisType === 'correspondents') {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) return;

              // Fetch correspondents first to get count
              const correspondents = yield* paperless.getCorrespondents();

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                currentDocTitle: `Analyzing ${correspondents.length} correspondents...`,
                currentEntityCount: correspondents.length,
              }));

              const categoryStartTime = Date.now();
              const corrSuggestions = analyzeCorrespondents(correspondents);
              const categoryDuration = (Date.now() - categoryStartTime) / 1000;
              categoryDurations.push(categoryDuration);

              const corrCount = corrSuggestions.length;
              allSuggestions = [...allSuggestions, ...corrSuggestions];
              processedCategories++;

              // Update suggestions by type, processed count, and timing estimates
              const timingEstimates = updateTimingEstimates(totalCategories - processedCategories);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                processed: processedCategories,
                suggestionsByType: {
                  ...p.suggestionsByType,
                  correspondents: corrCount,
                },
                ...(timingEstimates || {}),
              }));
            }

            if (analysisType === 'all' || analysisType === 'document_types') {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) return;

              // Fetch document types first to get count
              const types = yield* paperless.getDocumentTypes();

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                currentDocTitle: `Analyzing ${types.length} document types...`,
                currentEntityCount: types.length,
              }));

              const categoryStartTime = Date.now();
              const typeSuggestions = analyzeDocumentTypes(types);
              const categoryDuration = (Date.now() - categoryStartTime) / 1000;
              categoryDurations.push(categoryDuration);

              const typeCount = typeSuggestions.length;
              allSuggestions = [...allSuggestions, ...typeSuggestions];
              processedCategories++;

              // Update suggestions by type, processed count, and timing estimates
              const timingEstimates = updateTimingEstimates(totalCategories - processedCategories);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                processed: processedCategories,
                suggestionsByType: {
                  ...p.suggestionsByType,
                  documentTypes: typeCount,
                },
                ...(timingEstimates || {}),
              }));
            }

            if (analysisType === 'all' || analysisType === 'tags') {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) return;

              // Fetch tags first to get count
              const tags = yield* paperless.getTags();

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                currentDocTitle: `Analyzing ${tags.length} tags...`,
                currentEntityCount: tags.length,
              }));

              const categoryStartTime = Date.now();
              const tagSuggestions = analyzeTags(tags);
              const categoryDuration = (Date.now() - categoryStartTime) / 1000;
              categoryDurations.push(categoryDuration);

              const tagCount = tagSuggestions.length;
              allSuggestions = [...allSuggestions, ...tagSuggestions];
              processedCategories++;

              // Update suggestions by type, processed count, and timing estimates
              const timingEstimates = updateTimingEstimates(totalCategories - processedCategories);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                processed: processedCategories,
                suggestionsByType: {
                  ...p.suggestionsByType,
                  tags: tagCount,
                },
                ...(timingEstimates || {}),
              }));
            }

            // Add suggestions to pending reviews
            for (const suggestion of allSuggestions) {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) break;

              const pendingId = yield* tinybase.addPendingReview({
                docId: suggestion.sourceId ?? 0,
                docTitle: suggestion.suggestion,
                type: suggestion.type,
                suggestion: suggestion.suggestion,
                reasoning: suggestion.reasoning,
                alternatives: [],
                attempts: 0,
                lastFeedback: null,
                nextTag: null,
                metadata: JSON.stringify({
                  entityType: suggestion.entityType,
                  sourceId: suggestion.sourceId,
                  targetId: suggestion.targetId,
                  documentCount: suggestion.documentCount,
                }),
              });

              // Only count if actually persisted (not skipped due to empty suggestion)
              if (pendingId === null) {
                continue;
              }

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                suggestionsFound: p.suggestionsFound + 1,
              }));
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
            // Proper Effect error handling - catches Effect failures that try/catch misses
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                const errorMessage = error instanceof Error ? error.message : String(error);
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
