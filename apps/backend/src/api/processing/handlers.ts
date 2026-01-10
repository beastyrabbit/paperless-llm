/**
 * Processing API handlers.
 *
 * Document processing endpoints that invoke the processing pipeline.
 */
import { Effect } from 'effect';
import { TinyBaseService } from '../../services/index.js';
import { ProcessingPipelineService } from '../../agents/ProcessingPipeline.js';

// ===========================================================================
// Processing Control
// ===========================================================================

export const startProcessing = (docId: number, step?: string) =>
  Effect.gen(function* () {
    const pipeline = yield* ProcessingPipelineService;

    if (step && step !== 'all') {
      // Process a specific step
      const result = yield* pipeline.processStep(docId, step);
      return {
        status: result.success ? 'completed' : 'failed',
        doc_id: docId,
        step,
        data: result.data,
        error: result.error,
      };
    } else {
      // Process all steps
      const result = yield* pipeline.processDocument({ docId });
      return {
        status: result.success ? 'completed' : (result.needsReview ? 'needs_review' : 'failed'),
        doc_id: docId,
        step: 'all',
        data: result.steps,
        needsReview: result.needsReview,
        schemaReviewNeeded: result.schemaReviewNeeded,
        error: result.error,
      };
    }
  });

export const confirmProcessing = (docId: number, confirmed: boolean) =>
  Effect.succeed({
    status: 'confirmed',
    doc_id: docId,
    confirmed,
  });

// ===========================================================================
// Processing Status
// ===========================================================================

export const getProcessingStatus = Effect.succeed({
  is_processing: false,
  current_doc_id: null,
  current_step: null,
  queue_length: 0,
  processed_today: 0,
  errors_today: 0,
});

// ===========================================================================
// Processing Logs
// ===========================================================================

export const getProcessingLogs = (docId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const logs = yield* tinybase.getProcessingLogs(docId);
    return { logs };
  });

export const clearProcessingLogs = (docId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    yield* tinybase.clearProcessingLogs(docId);
    return { success: true };
  });
