/**
 * API router - maps HTTP requests to handlers.
 */
import { Effect } from 'effect';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as settingsHandlers from './settings/handlers.js';
import * as pendingHandlers from './pending/handlers.js';
import * as jobsHandlers from './jobs/handlers.js';
import * as documentsHandlers from './documents/handlers.js';
import * as processingHandlers from './processing/handlers.js';
import * as promptsHandlers from './prompts/handlers.js';
import * as metadataHandlers from './metadata/handlers.js';
import * as schemaHandlers from './schema/handlers.js';
import * as translationHandlers from './translation/handlers.js';

// ===========================================================================
// Types
// ===========================================================================

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

interface RouteMatch {
  handler: (params: Record<string, string>, body: unknown) => Effect.Effect<unknown, unknown, unknown>;
  params: Record<string, string>;
}

interface Route {
  method: HttpMethod;
  pattern: RegExp;
  paramNames: string[];
  handler: (params: Record<string, string>, body: unknown) => Effect.Effect<unknown, unknown, unknown>;
}

// ===========================================================================
// Route Registry
// ===========================================================================

const routes: Route[] = [];

const addRoute = (
  method: HttpMethod,
  path: string,
  handler: (params: Record<string, string>, body: unknown) => Effect.Effect<unknown, unknown, unknown>
) => {
  // Convert path pattern to regex
  const paramNames: string[] = [];
  const pattern = new RegExp(
    '^' +
      path
        .replace(/\//g, '\\/')
        .replace(/:(\w+)/g, (_, name) => {
          paramNames.push(name);
          return '([^/]+)';
        }) +
      '$'
  );

  routes.push({ method, pattern, paramNames, handler });
};

// ===========================================================================
// Health & Root
// ===========================================================================

addRoute('GET', '/', () =>
  Effect.succeed({
    name: 'Paperless Local LLM (TypeScript)',
    version: '0.1.0',
    status: 'running',
  })
);

addRoute('GET', '/health', () =>
  Effect.succeed({ status: 'healthy' })
);

// ===========================================================================
// Settings API - /api/settings
// ===========================================================================

addRoute('GET', '/api/settings', () => settingsHandlers.getSettings);

addRoute('PATCH', '/api/settings', (_, body) =>
  settingsHandlers.updateSettings(body as any)
);

addRoute('POST', '/api/settings/test-connection/:service', (params) => {
  switch (params.service) {
    case 'paperless':
      return settingsHandlers.testPaperlessConnection;
    case 'ollama':
      return settingsHandlers.testOllamaConnection;
    case 'mistral':
      return settingsHandlers.testMistralConnection;
    case 'qdrant':
      return settingsHandlers.testQdrantConnection;
    default:
      return Effect.succeed({ status: 'error', message: `Unknown service: ${params.service}`, details: null });
  }
});

addRoute('GET', '/api/settings/ollama/models', () => settingsHandlers.getOllamaModels);

addRoute('GET', '/api/settings/mistral/models', () => settingsHandlers.getMistralModels);

addRoute('GET', '/api/settings/tags/status', () => settingsHandlers.getTagsStatus);

addRoute('POST', '/api/settings/tags/create', (_, body) => {
  const { tag_names } = body as { tag_names?: string[] };
  return settingsHandlers.createWorkflowTags(tag_names ?? []);
});

addRoute('POST', '/api/settings/import-config', () => settingsHandlers.importConfigFromYaml);

addRoute('GET', '/api/settings/check-import', () => settingsHandlers.checkAndImportSettings);

addRoute('POST', '/api/settings/clear-database', () => settingsHandlers.clearDatabase);

// ===========================================================================
// Pending Reviews API - /api/pending
// ===========================================================================

addRoute('GET', '/api/pending', () => pendingHandlers.listPendingItems());

addRoute('GET', '/api/pending/counts', () => pendingHandlers.getPendingCounts);

addRoute('GET', '/api/pending/similar', () => pendingHandlers.getSimilarItems);

addRoute('GET', '/api/pending/search-entities', () => pendingHandlers.getSearchEntities);

addRoute('GET', '/api/pending/blocked', () => pendingHandlers.getBlocked);

addRoute('POST', '/api/pending/merge', (_, body) =>
  pendingHandlers.mergeSimilarItems(body as any)
);

addRoute('POST', '/api/pending/bulk', (_, body) =>
  pendingHandlers.bulkAction(body as any)
);

// Parameterized routes MUST come after specific routes
addRoute('GET', '/api/pending/:id', (params) => pendingHandlers.getPendingItem(params.id!));

addRoute('POST', '/api/pending/:id/approve', (params, body) =>
  pendingHandlers.approvePendingItem(params.id!, body as any)
);

addRoute('POST', '/api/pending/:id/reject', (params, body) =>
  pendingHandlers.rejectPendingItem(params.id!, body as any)
);

addRoute('POST', '/api/pending/:id/reject-with-feedback', (params, body) =>
  pendingHandlers.rejectWithFeedback(params.id!, body as any)
);

addRoute('POST', '/api/pending/:id/approve-cleanup', (params, body) => {
  const { final_name } = body as { final_name?: string };
  return pendingHandlers.approveCleanup(params.id!, final_name);
});

addRoute('DELETE', '/api/pending/blocked/:blockId', (params) =>
  pendingHandlers.unblockItem(parseInt(params.blockId!, 10))
);

// ===========================================================================
// Jobs API - /api/jobs
// ===========================================================================

addRoute('GET', '/api/jobs/status', () => jobsHandlers.getAllJobStatus);

addRoute('GET', '/api/jobs/status/:jobName', (params) =>
  jobsHandlers.getJobStatus(params.jobName!)
);

// Bootstrap
addRoute('POST', '/api/jobs/bootstrap/start', (_, body) => {
  const { analysis_type } = body as { analysis_type?: string };
  return jobsHandlers.startBootstrap(analysis_type ?? 'all');
});

addRoute('GET', '/api/jobs/bootstrap/status', () => jobsHandlers.getBootstrapStatus);

addRoute('POST', '/api/jobs/bootstrap/cancel', () => jobsHandlers.cancelBootstrap);

addRoute('POST', '/api/jobs/bootstrap/skip', (_, body) => {
  const { count } = body as { count?: number };
  return jobsHandlers.skipBootstrap(count ?? 1);
});

// Schema Cleanup
addRoute('POST', '/api/jobs/schema-cleanup/run', () => jobsHandlers.runSchemaCleanup);

addRoute('GET', '/api/jobs/schema-cleanup/status', () => jobsHandlers.getSchemaCleanupStatus);

// Bulk OCR
addRoute('POST', '/api/jobs/bulk-ocr/start', (_, body) => {
  const { docs_per_second, skip_existing } = body as { docs_per_second?: number; skip_existing?: boolean };
  return jobsHandlers.startBulkOcr(docs_per_second ?? 1, skip_existing ?? true);
});

addRoute('GET', '/api/jobs/bulk-ocr/status', () => jobsHandlers.getBulkOcrStatus);

addRoute('POST', '/api/jobs/bulk-ocr/cancel', () => jobsHandlers.cancelBulkOcr);

// Metadata Enhancement
addRoute('POST', '/api/jobs/metadata-enhancement/run', () =>
  Effect.succeed({ status: 'started', message: 'Metadata enhancement started' })
);

// Job Schedules
addRoute('GET', '/api/jobs/schedule', () =>
  Effect.succeed({
    jobs: {
      schema_cleanup: { enabled: false, schedule: 'daily', cron: '0 2 * * *' },
      metadata_enhancement: { enabled: false, schedule: 'daily', cron: '0 3 * * *' },
      bulk_ocr: { enabled: false, schedule: 'daily', cron: '0 4 * * *' },
    },
  })
);

addRoute('PATCH', '/api/jobs/schedule', (_, body) =>
  Effect.succeed({ success: true, ...(body as Record<string, unknown>) })
);

// ===========================================================================
// Settings API - AI Document Types
// ===========================================================================

addRoute('GET', '/api/settings/ai-document-types', () => settingsHandlers.getAiDocumentTypes);

addRoute('PATCH', '/api/settings/ai-document-types', (_, body) => {
  const { selected_type_ids } = body as { selected_type_ids?: number[] };
  return settingsHandlers.updateAiDocumentTypes(selected_type_ids ?? []);
});

// Custom fields settings
addRoute('GET', '/api/settings/custom-fields', () => settingsHandlers.getCustomFields);

addRoute('PATCH', '/api/settings/custom-fields', (_, body) => {
  const { selected_field_ids } = body as { selected_field_ids?: number[] };
  return settingsHandlers.updateCustomFields(selected_field_ids ?? []);
});

// AI Tags settings
addRoute('GET', '/api/settings/ai-tags', () => settingsHandlers.getAiTags);

addRoute('PATCH', '/api/settings/ai-tags', (_, body) => {
  const { selected_tag_ids } = body as { selected_tag_ids?: number[] };
  return settingsHandlers.updateAiTags(selected_tag_ids ?? []);
});

// ===========================================================================
// Documents API - /api/documents
// ===========================================================================

addRoute('GET', '/api/documents/queue', () => documentsHandlers.getQueueStats);

addRoute('GET', '/api/documents/pending', () => documentsHandlers.getPendingDocuments());

addRoute('GET', '/api/documents/:id', (params) =>
  documentsHandlers.getDocument(parseInt(params.id!, 10))
);

addRoute('GET', '/api/documents/:id/content', (params) =>
  documentsHandlers.getDocumentContent(parseInt(params.id!, 10))
);

addRoute('GET', '/api/documents/:id/pdf', (params) =>
  documentsHandlers.getDocumentPdf(parseInt(params.id!, 10))
);

// ===========================================================================
// Processing API - /api/processing
// ===========================================================================

addRoute('POST', '/api/processing/:docId/start', (params, body) => {
  const { step } = body as { step?: string };
  return processingHandlers.startProcessing(parseInt(params.docId!, 10), step);
});

addRoute('POST', '/api/processing/:docId/confirm', (params) => {
  const confirmed = true; // Default to true for confirmation endpoint
  return processingHandlers.confirmProcessing(parseInt(params.docId!, 10), confirmed);
});

addRoute('GET', '/api/processing/status', () => processingHandlers.getProcessingStatus);

// ===========================================================================
// Prompts API - /api/prompts
// ===========================================================================

addRoute('GET', '/api/prompts', () => promptsHandlers.listPrompts());

addRoute('GET', '/api/prompts/groups', () => promptsHandlers.listPromptGroups());

addRoute('GET', '/api/prompts/preview-data', () => promptsHandlers.getPreviewData);

addRoute('GET', '/api/prompts/languages', () => promptsHandlers.getLanguages);

addRoute('GET', '/api/prompts/:name', (params) => promptsHandlers.getPrompt(params.name!));

addRoute('PUT', '/api/prompts/:name', (params, body) => {
  const { content } = body as { content: string };
  return promptsHandlers.updatePrompt(params.name!, content);
});

// ===========================================================================
// Metadata API - /api/metadata
// ===========================================================================

// Tags
addRoute('GET', '/api/metadata/tags', () => metadataHandlers.listTags);

addRoute('GET', '/api/metadata/tags/:tagId', (params) =>
  metadataHandlers.getTag(parseInt(params.tagId!, 10))
);

addRoute('PUT', '/api/metadata/tags/:tagId', (params, body) =>
  metadataHandlers.updateTag(parseInt(params.tagId!, 10), body as any)
);

addRoute('DELETE', '/api/metadata/tags/:tagId', (params) =>
  metadataHandlers.deleteTag(parseInt(params.tagId!, 10))
);

addRoute('POST', '/api/metadata/tags/bulk', (_, body) =>
  metadataHandlers.bulkUpdateTags(body as any)
);

// Tag Translations
addRoute('GET', '/api/metadata/tags/:tagId/translations', (params) =>
  metadataHandlers.getTagTranslations(parseInt(params.tagId!, 10))
);

addRoute('PUT', '/api/metadata/tags/:tagId/translations/:lang', (params, body) =>
  metadataHandlers.updateTagTranslation(parseInt(params.tagId!, 10), params.lang!, body as any)
);

// Tag AI Operations
addRoute('POST', '/api/metadata/tags/:tagId/optimize-description', (params, body) =>
  metadataHandlers.optimizeTagDescription(parseInt(params.tagId!, 10), body as any)
);

addRoute('POST', '/api/metadata/tags/:tagId/translate-description', (params, body) =>
  metadataHandlers.translateTagDescription(parseInt(params.tagId!, 10), body as any)
);

// Custom Fields
addRoute('GET', '/api/metadata/custom-fields', () => metadataHandlers.listCustomFields);

addRoute('GET', '/api/metadata/custom-fields/:fieldId', (params) =>
  metadataHandlers.getCustomField(parseInt(params.fieldId!, 10))
);

addRoute('PUT', '/api/metadata/custom-fields/:fieldId', (params, body) =>
  metadataHandlers.updateCustomField(parseInt(params.fieldId!, 10), body as any)
);

addRoute('DELETE', '/api/metadata/custom-fields/:fieldId', (params) =>
  metadataHandlers.deleteCustomField(parseInt(params.fieldId!, 10))
);

addRoute('POST', '/api/metadata/custom-fields/bulk', (_, body) =>
  metadataHandlers.bulkUpdateCustomFields(body as any)
);

// ===========================================================================
// Schema API - /api/schema (Blocked Suggestions)
// ===========================================================================

addRoute('GET', '/api/schema/blocked', () => schemaHandlers.getBlocked());

addRoute('POST', '/api/schema/blocked', (_, body) => schemaHandlers.blockSuggestion(body as any));

addRoute('DELETE', '/api/schema/blocked/:id', (params) =>
  schemaHandlers.unblock(parseInt(params.id!, 10))
);

addRoute('GET', '/api/schema/blocked/check', () => {
  // Query params would be handled in request handler
  return schemaHandlers.checkBlocked('', '');
});

// ===========================================================================
// Translation API - /api/translation
// ===========================================================================

addRoute('POST', '/api/translation/translate', (_, body) =>
  translationHandlers.translate(body as any)
);

addRoute('POST', '/api/translation/translate/prompts', (_, body) => {
  const { source_lang, target_lang } = body as { source_lang: string; target_lang: string };
  return translationHandlers.translatePrompts(source_lang, target_lang);
});

addRoute('GET', '/api/translation/translations/:targetLang', (params) =>
  translationHandlers.getTranslations(params.targetLang!)
);

addRoute('POST', '/api/translation/cache/clear', (_, body) => {
  const { target_lang, content_type } = body as { target_lang?: string; content_type?: string };
  return translationHandlers.clearCache(target_lang, content_type);
});

addRoute('GET', '/api/translation/languages', () => translationHandlers.getLanguages);

// ===========================================================================
// Route Matching
// ===========================================================================

const matchRoute = (method: string, path: string): RouteMatch | null => {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? '';
      });
      return { handler: route.handler, params };
    }
  }
  return null;
};

// ===========================================================================
// Request Handler
// ===========================================================================

export const handleRequest = (
  req: IncomingMessage,
  res: ServerResponse,
  body: unknown
): Effect.Effect<unknown, unknown, unknown> => {
  const method = req.method as HttpMethod;
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;

  // Add query params handling
  const queryType = url.searchParams.get('type');

  const match = matchRoute(method, path);

  if (!match) {
    return Effect.succeed({
      status: 404,
      error: 'Not Found',
      message: `No handler for ${method} ${path}`,
    });
  }

  // Inject query params if applicable
  if (queryType && path === '/api/pending') {
    return pendingHandlers.listPendingItems(queryType);
  }

  return match.handler(match.params, body);
};
