/**
 * Bulk OCR job - processes documents through Mistral OCR.
 */
import { Context, Effect, Fiber, Layer, Ref } from "effect";
import { JobError } from "../errors/index.js";
import { ConfigService, MistralService, OcrUsageService, PaperlessService } from "../services/index.js";
import { logger } from "../utils/logger.js";

const bulkOcrLogger = logger.child({ component: "bulk_ocr_job" });

// ===========================================================================
// Types
// ===========================================================================

export interface BulkOcrProgress {
  status: "idle" | "running" | "completed" | "cancelled" | "error";
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
  docsPerSecond: number;
  startedAt: string | null;
  completedAt: string | null;
  runId: string | null;
  budgetStopReason: string | null;
  budget: {
    dailyPagesUsed: number;
    dailyPageLimit: number | null;
    runPagesUsed: number;
    runPageLimit: number | null;
    dailyTokensUsed: number;
    dailyTokenLimit: number | null;
    runTokensUsed: number;
    runTokenLimit: number | null;
  } | null;
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

export const BulkOcrJobService = Context.GenericTag<BulkOcrJobService>("BulkOcrJobService");

// ===========================================================================
// Live Implementation
// ===========================================================================

export const BulkOcrJobServiceLive = Layer.effect(
  BulkOcrJobService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const mistral = yield* MistralService;
    const ocrUsage = yield* OcrUsageService;

    const { tags: tagConfig } = config.config;

    const progressRef = yield* Ref.make<BulkOcrProgress>({
      status: "idle",
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      currentDocId: null,
      currentDocTitle: null,
      docsPerSecond: 1,
      startedAt: null,
      completedAt: null,
      runId: null,
      budgetStopReason: null,
      budget: null,
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
              new JobError({ message: "Bulk OCR job already running", jobName: "bulk_ocr" }),
            );
          }

          const docsPerSecond = options?.docsPerSecond ?? 1;
          const skipExisting = options?.skipExisting ?? true;
          const delayMs = Math.floor(1000 / docsPerSecond);
          const runId = `bulk-ocr-${Date.now()}`;

          yield* Ref.set(cancelledRef, false);
          yield* Ref.set(progressRef, {
            status: "running",
            total: 0,
            processed: 0,
            skipped: 0,
            errors: 0,
            currentDocId: null,
            currentDocTitle: null,
            docsPerSecond,
            startedAt: new Date().toISOString(),
            completedAt: null,
            runId,
            budgetStopReason: null,
            budget: null,
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
                  yield* paperless.transitionDocumentTag(
                    doc.id,
                    tagConfig.pending,
                    tagConfig.ocrDone,
                  );
                  continue;
                }

                try {
                  // Download PDF and reserve budget before calling Mistral
                  const pdfBytes = yield* paperless.downloadPdf(doc.id);
                  const estimatedPages = ocrUsage.estimatePdfPages(pdfBytes);
                  const ocrPrompt = `Extract all text from this document. Preserve the structure and formatting as much as possible. Return only the extracted text, no explanations.`;
                  const estimatedTokens = ocrUsage.estimateOcrTokens(pdfBytes, ocrPrompt);
                  const reservation = yield* ocrUsage.reserve({
                    runId,
                    docId: doc.id,
                    source: "bulk_ocr",
                    estimatedPages,
                    estimatedTokens,
                  });
                  const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

                  // Run OCR with Mistral
                  const ocrResponse = yield* mistral.processDocumentWithUsage(pdfBase64, ocrPrompt).pipe(
                    Effect.tapError(() => ocrUsage.release(reservation, "mistral_error")),
                  );
                  yield* ocrUsage.commit(reservation, {
                    pages: estimatedPages,
                    tokens: ocrResponse.usage?.total_tokens,
                    promptTokens: ocrResponse.usage?.prompt_tokens,
                    completionTokens: ocrResponse.usage?.completion_tokens,
                    model: ocrResponse.model,
                  });
                  const ocrResult = ocrResponse.text;

                  // Write Mistral OCR content back to Paperless-ngx (overwrites existing content)
                  if (ocrResult.length > 0) {
                    yield* paperless.updateDocument(doc.id, { content: ocrResult });
                  } else {
                    bulkOcrLogger.warn("mistral_returned_empty_text", {
                      docId: doc.id,
                      title: doc.title,
                    });
                  }

                  // Move to next stage - atomic tag transition
                  yield* paperless.transitionDocumentTag(
                    doc.id,
                    tagConfig.pending,
                    tagConfig.ocrDone,
                  );

                  const budget = yield* ocrUsage.getSnapshot(runId);
                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    processed: p.processed + 1,
                    budget,
                  }));
                } catch (error) {
                  if (
                    error &&
                    typeof error === "object" &&
                    "_tag" in error &&
                    error._tag === "OcrBudgetExceededError"
                  ) {
                    const message = String((error as { message?: unknown }).message ?? error);
                    const budget = yield* ocrUsage.getSnapshot(runId);
                    yield* Ref.update(progressRef, (p) => ({
                      ...p,
                      status: "completed" as const,
                      budgetStopReason: message,
                      budget,
                      completedAt: new Date().toISOString(),
                      currentDocId: null,
                      currentDocTitle: null,
                    }));
                    break;
                  }
                  bulkOcrLogger.error("document_processing_failed", {
                    docId: doc.id,
                    title: doc.title,
                    error,
                  });

                  yield* Ref.update(progressRef, (p) => ({
                    ...p,
                    errors: p.errors + 1,
                  }));

                  // Best-effort: mark as failed, but don't let this abort the batch
                  yield* paperless.addTagToDocument(doc.id, tagConfig.failed).pipe(
                    Effect.catchAll((tagError) =>
                      Effect.sync(() => {
                        bulkOcrLogger.error("failed_tag_addition_failed", {
                          docId: doc.id,
                          title: doc.title,
                          failedTag: tagConfig.failed,
                          error: tagError,
                        });
                      }),
                    ),
                  );
                }

                // Rate limiting
                yield* sleep(delayMs);
              }

              const cancelled = yield* Ref.get(cancelledRef);
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                status: (cancelled ? "cancelled" : "completed") as BulkOcrProgress["status"],
                completedAt: new Date().toISOString(),
                currentDocId: null,
                currentDocTitle: null,
              }));
            } catch (error) {
              bulkOcrLogger.error("job_failed", { error });
              yield* Ref.update(progressRef, (p) => ({
                ...p,
                status: "error" as const,
                completedAt: new Date().toISOString(),
              }));
              throw error;
            }
          });

          // Use forkDaemon so the fiber survives after the HTTP request completes
          const fiber = yield* Effect.forkDaemon(
            runOcr.pipe(
              Effect.mapError(
                (e) =>
                  new JobError({
                    message: `Bulk OCR failed: ${e}`,
                    jobName: "bulk_ocr",
                    cause: e,
                  }),
              ),
            ),
          );

          yield* Ref.set(fiberRef, fiber);

          // Wait for completion and clean up fiber ref (also daemon to survive request)
          yield* Effect.forkDaemon(
            Effect.gen(function* () {
              yield* Fiber.await(fiber);
              yield* Ref.set(fiberRef, null);
            }),
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
            status: "cancelled" as const,
            completedAt: new Date().toISOString(),
          }));
        }),
    };
  }),
);
