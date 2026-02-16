/**
 * Bulk OCR job - processes documents through Mistral OCR.
 */
import { Effect, Context, Layer, Ref, Fiber } from 'effect';
import { ConfigService, PaperlessService, MistralService, TinyBaseService } from '../services/index.js';
import { JobError } from '../errors/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface BulkOcrProgress {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
  docsPerSecond: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface BulkOcrOptions {
  docsPerSecond?: number;
  skipExisting?: boolean;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface BulkOcrJobService {
  readonly start: (options?: BulkOcrOptions) => Effect.Effect<void, JobError>;
  readonly getProgress: () => Effect.Effect<BulkOcrProgress, never>;
  readonly cancel: () => Effect.Effect<void, never>;
}

export const BulkOcrJobService = Context.GenericTag<BulkOcrJobService>('BulkOcrJobService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const BulkOcrJobServiceLive = Layer.effect(
  BulkOcrJobService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const mistral = yield* MistralService;
    const tinybase = yield* TinyBaseService;

    const { tags: tagConfig } = config.config;

    const progressRef = yield* Ref.make<BulkOcrProgress>({
      status: 'idle',
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      currentDocId: null,
      currentDocTitle: null,
      docsPerSecond: 1,
      startedAt: null,
      completedAt: null,
    });

    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, JobError> | null>(null);
    const cancelledRef = yield* Ref.make(false);

    const sleep = (ms: number) =>
      Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

    return {
      start: (options) =>
        Effect.gen(function* () {
          const currentFiber = yield* Ref.get(fiberRef);
          if (currentFiber) {
            return yield* Effect.fail(
              new JobError({ message: 'Bulk OCR job already running', jobName: 'bulk_ocr' })
            );
          }

          const docsPerSecond = options?.docsPerSecond ?? 1;
          const skipExisting = options?.skipExisting ?? true;
          const delayMs = Math.floor(1000 / docsPerSecond);

          yield* Ref.set(cancelledRef, false);
          yield* Ref.set(progressRef, {
            status: 'running',
            total: 0,
            processed: 0,
            skipped: 0,
            errors: 0,
            currentDocId: null,
            currentDocTitle: null,
            docsPerSecond,
            startedAt: new Date().toISOString(),
            completedAt: null,
          });

          const runOcr = Effect.gen(function* () {
            try {
              // Get documents with pending tag
              const documents = yield* paperless.getDocumentsByTag(tagConfig.pending, 1000);

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                total: documents.length,
              }));

              for (const doc of documents) {
                const cancelled = yield* Ref.get(cancelledRef);
                if (cancelled) break;

                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  currentDocId: doc.id,
                  currentDocTitle: doc.title,
                }));

                // Check if already has OCR content
                if (skipExisting && doc.content && doc.content.length > 100) {
                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    skipped: p.skipped + 1,
                  }));

                  // Move to next stage - atomic tag transition
                  yield* paperless.transitionDocumentTag(doc.id, tagConfig.pending, tagConfig.ocrDone);
                  continue;
                }

                try {
                  // Download PDF
                  const pdfBytes = yield* paperless.downloadPdf(doc.id);
                  const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

                  // Run OCR with Mistral
                  const ocrPrompt = `Extract all text from this document. Preserve the structure and formatting as much as possible. Return only the extracted text, no explanations.`;
                  const ocrResult = yield* mistral.processDocument(pdfBase64, ocrPrompt);

                  // Write Mistral OCR content back to Paperless-ngx (overwrites existing content)
                  if (ocrResult.length > 0) {
                    yield* paperless.updateDocument(doc.id, { content: ocrResult });
                  } else {
                    console.warn(`[BulkOCR] Mistral returned empty text for document ${doc.id} (${doc.title}), keeping existing content`);
                  }

                  // Move to next stage - atomic tag transition
                  yield* paperless.transitionDocumentTag(doc.id, tagConfig.pending, tagConfig.ocrDone);

                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    processed: p.processed + 1,
                  }));
                } catch (error) {
                  console.error(`[BulkOCR] Failed to process document ${doc.id} (${doc.title}): ${String(error)}`);

                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    errors: p.errors + 1,
                  }));

                  // Best-effort: mark as failed, but don't let this abort the batch
                  yield* paperless.addTagToDocument(doc.id, tagConfig.failed).pipe(
                    Effect.catchAll((tagError) =>
                      Effect.sync(() =>
                        console.error(`[BulkOCR] Additionally failed to tag document ${doc.id} as failed: ${String(tagError)}`)
                      )
                    )
                  );
                }

                // Rate limiting
                yield* sleep(delayMs);
              }

              const cancelled = yield* Ref.get(cancelledRef);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                status: (cancelled ? 'cancelled' : 'completed') as BulkOcrProgress['status'],
                completedAt: new Date().toISOString(),
                currentDocId: null,
                currentDocTitle: null,
              }));
            } catch (error) {
              console.error(`[BulkOCR] Job failed: ${String(error)}`);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                status: 'error' as const,
                completedAt: new Date().toISOString(),
              }));
              throw error;
            }
          });

          // Use forkDaemon so the fiber survives after the HTTP request completes
          const fiber = yield* Effect.forkDaemon(
            runOcr.pipe(
              Effect.mapError((e) =>
                new JobError({
                  message: `Bulk OCR failed: ${e}`,
                  jobName: 'bulk_ocr',
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
    };
  })
);
