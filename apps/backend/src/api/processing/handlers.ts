/**
 * Processing API handlers.
 *
 * Stub implementations for document processing endpoints.
 */
import { Effect } from 'effect';

// ===========================================================================
// Processing Control
// ===========================================================================

export const startProcessing = (docId: number, step?: string) =>
  Effect.succeed({
    status: 'started',
    doc_id: docId,
    step: step ?? 'all',
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
