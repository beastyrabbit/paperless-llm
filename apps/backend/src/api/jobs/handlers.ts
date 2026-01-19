/**
 * Jobs API handlers.
 */
import { Effect, pipe } from 'effect';
import {
  BootstrapJobService,
  SchemaCleanupJobService,
  BulkOcrJobService,
  BulkIngestJobService,
} from '../../jobs/index.js';

// ===========================================================================
// Job Status
// ===========================================================================

export const getAllJobStatus = Effect.gen(function* () {
  const bootstrap = yield* BootstrapJobService;
  const schemaCleanup = yield* SchemaCleanupJobService;
  const bulkOcr = yield* BulkOcrJobService;
  const bulkIngest = yield* BulkIngestJobService;

  const bootstrapProgress = yield* bootstrap.getProgress();
  const schemaCleanupStatus = yield* schemaCleanup.getStatus();
  const bulkOcrProgress = yield* bulkOcr.getProgress();
  const bulkIngestProgress = yield* bulkIngest.getProgress();

  return {
    bootstrap: {
      job_name: 'bootstrap',
      status: bootstrapProgress.status,
      last_run: bootstrapProgress.startedAt ?? null,
      last_result: bootstrapProgress.status === 'completed' ? {
        total: bootstrapProgress.total,
        processed: bootstrapProgress.processed,
        suggestions: bootstrapProgress.suggestionsFound,
      } : null,
    },
    schema_cleanup: {
      job_name: 'schema_cleanup',
      status: schemaCleanupStatus.status,
      last_run: schemaCleanupStatus.startedAt ?? null,
      last_result: schemaCleanupStatus.status === 'completed' ? {
        total: schemaCleanupStatus.total,
        processed: schemaCleanupStatus.processed,
      } : null,
    },
    bulk_ocr: {
      job_name: 'bulk_ocr',
      status: bulkOcrProgress.status,
      last_run: bulkOcrProgress.startedAt ?? null,
      last_result: bulkOcrProgress.status === 'completed' ? {
        total: bulkOcrProgress.total,
        processed: bulkOcrProgress.processed,
        skipped: bulkOcrProgress.skipped,
      } : null,
    },
    bulk_ingest: {
      job_name: 'bulk_ingest',
      status: bulkIngestProgress.status,
      last_run: bulkIngestProgress.startedAt ?? null,
      last_result: bulkIngestProgress.status === 'completed' ? {
        total: bulkIngestProgress.total,
        processed: bulkIngestProgress.processed,
        skipped: bulkIngestProgress.skipped,
        ocr_processed: bulkIngestProgress.ocrProcessed,
        vector_indexed: bulkIngestProgress.vectorIndexed,
      } : null,
    },
  };
});

export const getJobStatus = (jobName: string) =>
  Effect.gen(function* () {
    switch (jobName) {
      case 'bootstrap': {
        const job = yield* BootstrapJobService;
        const progress = yield* job.getProgress();
        return {
          job_name: 'bootstrap',
          status: progress.status,
          last_run: progress.startedAt ?? null,
          last_result: progress,
        };
      }
      case 'schema_cleanup':
      case 'schema-cleanup': {
        const job = yield* SchemaCleanupJobService;
        const status = yield* job.getStatus();
        return {
          job_name: 'schema_cleanup',
          status: status.status,
          last_run: status.startedAt ?? null,
          last_result: status,
        };
      }
      case 'bulk_ocr':
      case 'bulk-ocr': {
        const job = yield* BulkOcrJobService;
        const progress = yield* job.getProgress();
        return {
          job_name: 'bulk_ocr',
          status: progress.status,
          last_run: progress.startedAt ?? null,
          last_result: progress,
        };
      }
      case 'bulk_ingest':
      case 'bulk-ingest': {
        const job = yield* BulkIngestJobService;
        const progress = yield* job.getProgress();
        return {
          job_name: 'bulk_ingest',
          status: progress.status,
          last_run: progress.startedAt ?? null,
          last_result: progress,
        };
      }
      default:
        return {
          status: 404,
          error: 'Not Found',
          message: `Job '${jobName}' not found`,
        };
    }
  });

// ===========================================================================
// Bootstrap Job
// ===========================================================================

export const startBootstrap = (analysisType: string) =>
  Effect.gen(function* () {
    const job = yield* BootstrapJobService;
    const progress = yield* job.getProgress();

    if (progress.status === 'running') {
      return {
        status: 400,
        error: 'Bad Request',
        message: 'Bootstrap analysis is already running',
      };
    }

    const type = analysisType as 'all' | 'correspondents' | 'document_types' | 'tags';
    yield* job.start(type);

    return {
      message: `Bootstrap analysis started (type: ${analysisType})`,
      analysis_type: analysisType,
      status: 'running',
    };
  });

export const getBootstrapStatus = Effect.gen(function* () {
  const job = yield* BootstrapJobService;
  const progress = yield* job.getProgress();

  // Transform camelCase to snake_case for API response
  return {
    status: progress.status,
    total: progress.total,
    processed: progress.processed,
    skipped: 0, // Not implemented yet
    current_doc_id: progress.currentDocId,
    current_doc_title: progress.currentDocTitle,
    suggestions_found: progress.suggestionsFound,
    suggestions_by_type: {
      correspondents: progress.suggestionsByType.correspondents,
      document_types: progress.suggestionsByType.documentTypes,
      tags: progress.suggestionsByType.tags,
    },
    errors: progress.errors,
    started_at: progress.startedAt,
    completed_at: progress.completedAt,
    error_message: progress.errorMessage,
    // Enhanced progress tracking
    total_documents: progress.totalDocuments,
    current_entity_count: progress.currentEntityCount,
    avg_seconds_per_category: progress.avgSecondsPerCategory,
    estimated_remaining_seconds: progress.estimatedRemainingSeconds,
  };
});

export const cancelBootstrap = Effect.gen(function* () {
  const job = yield* BootstrapJobService;
  const progress = yield* job.getProgress();

  if (progress.status !== 'running') {
    return {
      message: 'No running bootstrap analysis to cancel',
      status: 'idle',
    };
  }

  yield* job.cancel();

  return {
    message: 'Bootstrap analysis cancellation requested',
    status: 'cancelling',
  };
});

export const skipBootstrap = (count: number) =>
  Effect.gen(function* () {
    const job = yield* BootstrapJobService;
    const progress = yield* job.getProgress();

    if (progress.status !== 'running') {
      return {
        message: 'No running bootstrap analysis to skip',
        status: 'idle',
      };
    }

    // Limit count to prevent abuse
    const safeCount = Math.max(1, Math.min(count, 1000));
    yield* job.skip(safeCount);

    return {
      message: `Skip requested for ${safeCount} document(s)`,
      status: 'skipping',
      count: safeCount,
    };
  });

// ===========================================================================
// Schema Cleanup Job
// ===========================================================================

export const runSchemaCleanup = Effect.gen(function* () {
  const job = yield* SchemaCleanupJobService;
  const status = yield* job.getStatus();

  if (status.status === 'running') {
    return {
      status: 400,
      error: 'Bad Request',
      message: 'Schema cleanup is already running',
    };
  }

  const result = yield* job.run();

  return {
    message: 'Schema cleanup completed',
    status: 'completed',
    result,
  };
});

export const getSchemaCleanupStatus = Effect.gen(function* () {
  const job = yield* SchemaCleanupJobService;
  return yield* job.getStatus();
});

// ===========================================================================
// Bulk OCR Job
// ===========================================================================

export const startBulkOcr = (docsPerSecond: number, skipExisting: boolean) =>
  Effect.gen(function* () {
    const job = yield* BulkOcrJobService;
    const progress = yield* job.getProgress();

    if (progress.status === 'running') {
      return {
        status: 400,
        error: 'Bad Request',
        message: 'Bulk OCR is already running',
      };
    }

    yield* job.start({ docsPerSecond, skipExisting });

    return {
      message: `Bulk OCR started (${docsPerSecond} docs/sec)`,
      docs_per_second: docsPerSecond,
      skip_existing: skipExisting,
      status: 'running',
    };
  });

export const getBulkOcrStatus = Effect.gen(function* () {
  const job = yield* BulkOcrJobService;
  return yield* job.getProgress();
});

export const cancelBulkOcr = Effect.gen(function* () {
  const job = yield* BulkOcrJobService;
  const progress = yield* job.getProgress();

  if (progress.status !== 'running') {
    return {
      message: 'No running bulk OCR job to cancel',
      status: 'idle',
    };
  }

  yield* job.cancel();

  return {
    message: 'Bulk OCR cancellation requested',
    status: 'cancelling',
  };
});

// ===========================================================================
// Bulk Ingest Job (OCR + Vector DB)
// ===========================================================================

interface BulkIngestStartRequest {
  docs_per_second?: number;
  skip_existing_ocr?: boolean;
  skip_existing_vector?: boolean;
  run_ocr?: boolean;
  transition_tag?: boolean;
  source_tag?: string;
  target_tag?: string;
}

export const startBulkIngest = (request: BulkIngestStartRequest) =>
  Effect.gen(function* () {
    const job = yield* BulkIngestJobService;
    const progress = yield* job.getProgress();

    if (progress.status === 'running') {
      return {
        status: 400,
        error: 'Bad Request',
        message: 'Bulk ingest is already running',
      };
    }

    yield* job.start({
      docsPerSecond: request.docs_per_second ?? 0.5,
      skipExistingOcr: request.skip_existing_ocr ?? true,
      skipExistingVector: request.skip_existing_vector ?? false,
      runOcr: request.run_ocr ?? true,
      transitionTag: request.transition_tag ?? false,
      sourceTag: request.source_tag,
      targetTag: request.target_tag,
    });

    return {
      message: `Bulk ingest started (${request.docs_per_second ?? 0.5} docs/sec)`,
      docs_per_second: request.docs_per_second ?? 0.5,
      run_ocr: request.run_ocr ?? true,
      status: 'running',
    };
  });

export const getBulkIngestStatus = Effect.gen(function* () {
  const job = yield* BulkIngestJobService;
  const progress = yield* job.getProgress();

  return {
    status: progress.status,
    total: progress.total,
    processed: progress.processed,
    skipped: progress.skipped,
    errors: progress.errors,
    ocr_processed: progress.ocrProcessed,
    vector_indexed: progress.vectorIndexed,
    current_doc_id: progress.currentDocId,
    current_doc_title: progress.currentDocTitle,
    current_phase: progress.currentPhase,
    docs_per_second: progress.docsPerSecond,
    started_at: progress.startedAt,
    completed_at: progress.completedAt,
    error_message: progress.errorMessage,
  };
});

export const cancelBulkIngest = Effect.gen(function* () {
  const job = yield* BulkIngestJobService;
  const progress = yield* job.getProgress();

  if (progress.status !== 'running') {
    return {
      message: 'No running bulk ingest job to cancel',
      status: 'idle',
    };
  }

  yield* job.cancel();

  return {
    message: 'Bulk ingest cancellation requested',
    status: 'cancelling',
  };
});
