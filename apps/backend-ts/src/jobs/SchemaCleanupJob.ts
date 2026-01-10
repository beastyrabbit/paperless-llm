/**
 * Schema cleanup job - applies approved schema changes (merges, deletes).
 */
import { Effect, Context, Layer, Ref } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { JobError } from '../errors/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface SchemaCleanupProgress {
  status: 'idle' | 'running' | 'completed' | 'error';
  total: number;
  processed: number;
  merged: number;
  deleted: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SchemaCleanupResult {
  merged: number;
  deleted: number;
  errors: number;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface SchemaCleanupJobService {
  readonly run: () => Effect.Effect<SchemaCleanupResult, JobError>;
  readonly getStatus: () => Effect.Effect<SchemaCleanupProgress, never>;
}

export const SchemaCleanupJobService = Context.GenericTag<SchemaCleanupJobService>('SchemaCleanupJobService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const SchemaCleanupJobServiceLive = Layer.effect(
  SchemaCleanupJobService,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;

    const progressRef = yield* Ref.make<SchemaCleanupProgress>({
      status: 'idle',
      total: 0,
      processed: 0,
      merged: 0,
      deleted: 0,
      errors: 0,
      startedAt: null,
      completedAt: null,
    });

    return {
      run: () =>
        Effect.gen(function* () {
          yield* Ref.set(progressRef, {
            status: 'running',
            total: 0,
            processed: 0,
            merged: 0,
            deleted: 0,
            errors: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
          });

          let merged = 0;
          let deleted = 0;
          let errors = 0;

          try {
            // Get all schema-related pending reviews
            const pendingItems = yield* tinybase.getPendingReviews();
            const schemaItems = pendingItems.filter(
              (item) => item.type === 'schema_merge' || item.type === 'schema_delete'
            );

            yield* Ref.update(progressRef, (p) => ({
              ...p,
              total: schemaItems.length,
            }));

            for (const item of schemaItems) {
              try {
                const metadata = item.metadata ? JSON.parse(item.metadata) as {
                  entityType?: string;
                  sourceId?: number;
                  targetId?: number;
                } : null;

                if (!metadata) {
                  errors++;
                  continue;
                }

                const { entityType, sourceId, targetId } = metadata;

                if (item.type === 'schema_merge' && sourceId && targetId) {
                  // Perform merge based on entity type
                  switch (entityType) {
                    case 'correspondent':
                      yield* paperless.mergeCorrespondents(sourceId, targetId);
                      break;
                    case 'document_type':
                      yield* paperless.mergeDocumentTypes(sourceId, targetId);
                      break;
                    case 'tag':
                      yield* paperless.mergeTags(sourceId, targetId);
                      break;
                    default:
                      errors++;
                      continue;
                  }
                  merged++;
                } else if (item.type === 'schema_delete' && sourceId) {
                  // Perform delete based on entity type
                  switch (entityType) {
                    case 'correspondent':
                      yield* paperless.deleteCorrespondent(sourceId);
                      break;
                    case 'document_type':
                      yield* paperless.deleteDocumentType(sourceId);
                      break;
                    case 'tag':
                      yield* paperless.deleteTag(sourceId);
                      break;
                    default:
                      errors++;
                      continue;
                  }
                  deleted++;
                }

                // Remove from pending after successful operation
                yield* tinybase.removePendingReview(item.id);

                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  processed: p.processed + 1,
                  merged: item.type === 'schema_merge' ? p.merged + 1 : p.merged,
                  deleted: item.type === 'schema_delete' ? p.deleted + 1 : p.deleted,
                }));
              } catch (error) {
                errors++;
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  processed: p.processed + 1,
                  errors: p.errors + 1,
                }));
              }
            }

            yield* Ref.update(progressRef, (p) => ({
              ...p,
              status: 'completed' as const,
              completedAt: new Date().toISOString(),
            }));

            return { merged, deleted, errors };
          } catch (error) {
            yield* Ref.update(progressRef, (p) => ({
              ...p,
              status: 'error' as const,
              completedAt: new Date().toISOString(),
            }));

            return yield* Effect.fail(
              new JobError({
                message: `Schema cleanup failed: ${error}`,
                jobName: 'schema_cleanup',
                cause: error,
              })
            );
          }
        }).pipe(
          Effect.mapError((e) =>
            e instanceof JobError
              ? e
              : new JobError({
                  message: `Schema cleanup failed: ${e}`,
                  jobName: 'schema_cleanup',
                  cause: e,
                })
          )
        ),

      getStatus: () => Ref.get(progressRef),
    };
  })
);
