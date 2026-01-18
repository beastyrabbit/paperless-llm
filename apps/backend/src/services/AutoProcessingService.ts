/**
 * Auto Processing Service - Background loop for automatic document processing.
 *
 * Continuously checks for pending documents and processes them through the pipeline.
 */
import { Effect, Context, Layer, Ref, Fiber, Duration, Deferred, Option } from 'effect';
import { ConfigService } from '../config/index.js';
import { PaperlessService } from './PaperlessService.js';
import { TinyBaseService } from './TinyBaseService.js';
import { ProcessingPipelineService } from '../agents/ProcessingPipeline.js';

// ===========================================================================
// Types
// ===========================================================================

export interface AutoProcessingStatus {
  running: boolean;
  enabled: boolean;
  intervalMinutes: number;
  lastCheckAt: string | null;
  currentlyProcessingDocId: number | null;
  currentlyProcessingDocTitle: string | null;
  currentStep: string | null;
  processedSinceStart: number;
  errorsSinceStart: number;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface AutoProcessingService {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => Effect.Effect<void, never>;
  readonly getStatus: () => Effect.Effect<AutoProcessingStatus, never>;
  readonly trigger: () => Effect.Effect<void, never>;
}

export const AutoProcessingService = Context.GenericTag<AutoProcessingService>('AutoProcessingService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const AutoProcessingServiceLive = Layer.effect(
  AutoProcessingService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const pipeline = yield* ProcessingPipelineService;

    // State refs
    const runningRef = yield* Ref.make(false);
    const currentDocRef = yield* Ref.make<number | null>(null);
    const currentDocTitleRef = yield* Ref.make<string | null>(null);
    const currentStepRef = yield* Ref.make<string | null>(null);
    const lastCheckRef = yield* Ref.make<string | null>(null);
    const processedCountRef = yield* Ref.make(0);
    const errorCountRef = yield* Ref.make(0);
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);

    // Deferred for triggering immediate check (interrupts sleep)
    const triggerDeferredRef = yield* Ref.make<Deferred.Deferred<void, never> | null>(null);

    const tagConfig = config.config.tags;

    // Get auto processing settings from TinyBase (runtime configurable)
    const getSettings = Effect.gen(function* () {
      const enabledStr = yield* tinybase.getSetting('auto_processing.enabled');
      const intervalStr = yield* tinybase.getSetting('auto_processing.interval_minutes');

      // Parse and validate interval - fall back to config default if invalid
      const parsedInterval = intervalStr ? parseInt(intervalStr, 10) : NaN;
      const intervalMinutes = Number.isFinite(parsedInterval) && parsedInterval > 0
        ? parsedInterval
        : config.config.autoProcessing.intervalMinutes;

      return {
        enabled: enabledStr === 'true' ? true : enabledStr === 'false' ? false : config.config.autoProcessing.enabled,
        intervalMinutes,
      };
    });

    // The main processing loop
    const runLoop: Effect.Effect<void, never, never> = Effect.gen(function* () {
      console.log('[AutoProcessing] Background loop started');

      while (yield* Ref.get(runningRef)) {
        const settings = yield* getSettings.pipe(
          Effect.catchAll(() => Effect.succeed({ enabled: false, intervalMinutes: 5 }))
        );

        // If not enabled, wait a short time and check again
        if (!settings.enabled) {
          yield* Effect.sleep(Duration.seconds(5));
          continue;
        }

        // Check for documents at any pipeline stage (not just pending)
        // Priority order: pending first, then intermediate stages
        // Map tag -> what step will be processed next
        // Pipeline order: OCR -> Summary -> Title -> Correspondent -> DocType -> Tags
        const pipelineStages: Array<{ tag: string; processingStep: string }> = [
          { tag: tagConfig.pending, processingStep: 'ocr' },
          { tag: tagConfig.ocrDone, processingStep: 'summary' },
          { tag: tagConfig.summaryDone, processingStep: 'title' },
          { tag: tagConfig.titleDone, processingStep: 'correspondent' },
          { tag: tagConfig.correspondentDone, processingStep: 'document_type' },
          { tag: tagConfig.documentTypeDone, processingStep: 'tags' },
          { tag: tagConfig.tagsDone, processingStep: 'finalizing' },
        ];

        let docToProcess: { id: number; title: string; tags: readonly number[] } | null = null;
        let currentStep: string | null = null;

        // Get the processed tag ID so we can filter it out
        const processedTagOption = yield* paperless.getTagByName(tagConfig.processed).pipe(
          Effect.catchAll(() => Effect.succeed(Option.none<{ id: number }>()))
        );
        const processedTagId = Option.isSome(processedTagOption) ? processedTagOption.value.id : null;

        for (const stage of pipelineStages) {
          // Fetch more docs so we can filter, then take first valid one
          const docs = yield* paperless.getDocumentsByTag(stage.tag, 10).pipe(
            Effect.catchAll((e) => {
              console.error(`[AutoProcessing] Error fetching documents with tag ${stage.tag}:`, e);
              return Effect.succeed([]);
            })
          );

          // Filter out documents that already have the processed tag
          const eligibleDocs = processedTagId !== null
            ? docs.filter(d => !d.tags.includes(processedTagId))
            : docs;

          if (eligibleDocs.length > 0) {
            docToProcess = eligibleDocs[0]!;
            currentStep = stage.processingStep;
            console.log(`[AutoProcessing] Found document at stage "${stage.tag}" - processing: ${stage.processingStep}`);
            break;
          } else if (docs.length > 0 && eligibleDocs.length === 0) {
            console.log(`[AutoProcessing] Documents at "${stage.tag}" already have processed tag - skipping`);
          }
        }

        // Update last check time on every poll
        yield* Ref.set(lastCheckRef, new Date().toISOString());

        if (docToProcess) {
          const doc = docToProcess;
          console.log(`[AutoProcessing] Processing document ${doc.id}: ${doc.title}`);

          yield* Ref.set(currentDocRef, doc.id);
          yield* Ref.set(currentDocTitleRef, doc.title);
          yield* Ref.set(currentStepRef, currentStep);

          // Process the document
          yield* pipeline.processDocument({ docId: doc.id }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                if (result.success) {
                  console.log(`[AutoProcessing] Document ${doc.id} processed successfully`);
                } else if (result.needsReview) {
                  console.log(`[AutoProcessing] Document ${doc.id} needs manual review`);
                } else {
                  console.log(`[AutoProcessing] Document ${doc.id} processing failed: ${result.error}`);
                }
              })
            ),
            Effect.tap(() => Ref.update(processedCountRef, (n) => n + 1)),
            Effect.catchAll((e) => {
              console.error(`[AutoProcessing] Error processing document ${doc.id}:`, e);
              return Ref.update(errorCountRef, (n) => n + 1);
            })
          );

          yield* Ref.set(currentDocRef, null);
          yield* Ref.set(currentDocTitleRef, null);
          yield* Ref.set(currentStepRef, null);

          // Immediately check for more work (no wait)
          continue;
        }

        // No work found - wait for interval
        console.log(`[AutoProcessing] No documents in pipeline. Waiting ${settings.intervalMinutes} minutes...`);

        // Create a deferred for manual trigger interruption
        const triggerDeferred = yield* Deferred.make<void, never>();
        yield* Ref.set(triggerDeferredRef, triggerDeferred);

        // Wait for either the interval or a manual trigger
        yield* Effect.race(
          Effect.sleep(Duration.minutes(settings.intervalMinutes)),
          Deferred.await(triggerDeferred)
        );

        yield* Ref.set(triggerDeferredRef, null);
      }

      console.log('[AutoProcessing] Background loop stopped');
    }).pipe(Effect.catchAll(() => Effect.void)) as Effect.Effect<void, never, never>;

    const service: AutoProcessingService = {
      start: () =>
        Effect.gen(function* () {
          const isRunning = yield* Ref.get(runningRef);
          if (isRunning) {
            console.log('[AutoProcessing] Already running');
            return;
          }

          yield* Ref.set(runningRef, true);
          yield* Ref.set(processedCountRef, 0);
          yield* Ref.set(errorCountRef, 0);

          // Fork the loop as a daemon (runs independently of parent scope)
          const fiber = yield* Effect.forkDaemon(runLoop);
          yield* Ref.set(fiberRef, fiber as Fiber.RuntimeFiber<void, never>);

          console.log('[AutoProcessing] Service started');
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Ref.set(runningRef, false);

          // Interrupt any pending trigger deferred
          const triggerDeferred = yield* Ref.get(triggerDeferredRef);
          if (triggerDeferred) {
            yield* Deferred.succeed(triggerDeferred, undefined);
          }

          // Wait for fiber to complete
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
          }

          console.log('[AutoProcessing] Service stopped');
        }),

      getStatus: () =>
        Effect.gen(function* () {
          const running = yield* Ref.get(runningRef);
          const currentDocId = yield* Ref.get(currentDocRef);
          const currentDocTitle = yield* Ref.get(currentDocTitleRef);
          const currentStep = yield* Ref.get(currentStepRef);
          const lastCheckAt = yield* Ref.get(lastCheckRef);
          const processed = yield* Ref.get(processedCountRef);
          const errors = yield* Ref.get(errorCountRef);
          const settings = yield* getSettings.pipe(
            Effect.catchAll(() => Effect.succeed({ enabled: false, intervalMinutes: 5 }))
          );

          return {
            running,
            enabled: settings.enabled,
            intervalMinutes: settings.intervalMinutes,
            lastCheckAt,
            currentlyProcessingDocId: currentDocId,
            currentlyProcessingDocTitle: currentDocTitle,
            currentStep,
            processedSinceStart: processed,
            errorsSinceStart: errors,
          };
        }),

      trigger: () =>
        Effect.gen(function* () {
          const triggerDeferred = yield* Ref.get(triggerDeferredRef);
          if (triggerDeferred) {
            yield* Deferred.succeed(triggerDeferred, undefined);
            console.log('[AutoProcessing] Manual trigger - checking for work now');
          } else {
            console.log('[AutoProcessing] Manual trigger - already checking or not waiting');
          }
        }),
    };

    return service;
  })
);
