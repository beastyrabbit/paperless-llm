/**
 * HTTP server implementation.
 */
import { Effect, pipe, Layer, Runtime, Scope, Stream } from 'effect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppLayer } from './layers/index.js';
import { handleRequest } from './api/index.js';
import { ProcessingPipelineService, type PipelineStreamEvent } from './agents/index.js';
import { PaperlessService, ConfigService, QdrantService } from './services/index.js';

// ===========================================================================
// Security Configuration
// ===========================================================================

// Maximum request body size (10MB - generous for document metadata)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// Allowed CORS origins - localhost variants for development
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3765',
  'http://127.0.0.1:3765',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
]);

// ===========================================================================
// Request Body Parser
// ===========================================================================

class RequestTooLargeError extends Error {
  constructor() {
    super('Request body too large');
    this.name = 'RequestTooLargeError';
  }
}

const parseBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on('data', (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new RequestTooLargeError());
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });

    req.on('error', reject);
  });

// ===========================================================================
// CORS Headers
// ===========================================================================

const setCorsHeaders = (req: IncomingMessage, res: ServerResponse): void => {
  const origin = req.headers.origin;

  // Allow requests from allowed origins, or localhost development
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (!origin) {
    // Same-origin requests don't have Origin header - allow these
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3765');
  }
  // If origin is not in allowed list and is present, don't set header (browser will block)

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

// ===========================================================================
// Tag Cache (avoid fetching all tags for every SSE request)
// ===========================================================================

interface TagCache {
  tags: Array<{ id: number; name: string }>;
  timestamp: number;
}

const TAG_CACHE_TTL_MS = 60 * 1000; // 60 seconds
let tagCache: TagCache | null = null;

// ===========================================================================
// SSE Stream URL Pattern
// ===========================================================================

const SSE_STREAM_PATTERN = /^\/api\/processing\/(\d+)\/stream$/;

// ===========================================================================
// Server Creation
// ===========================================================================

export const createHttpServer = (port: number) =>
  Effect.gen(function* () {
    // Build a runtime from the AppLayer once, reuse for all requests
    const scope = yield* Scope.make();
    const runtime = yield* Layer.toRuntime(AppLayer).pipe(
      Scope.extend(scope),
      Effect.cached,
      Effect.flatten
    );

    const runWithRuntime = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
      Runtime.runPromise(runtime)(effect as Effect.Effect<A, never, never>);

    // Helper to run stream and pipe to SSE response
    const handleSSEStream = async (
      res: ServerResponse,
      docId: number,
      fullPipeline: boolean = false
    ): Promise<void> => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);

      // Helper to create events with timestamps
      const createEvent = (e: Omit<PipelineStreamEvent, 'timestamp'>): PipelineStreamEvent => ({
        ...e,
        timestamp: new Date().toISOString(),
      });

      const sendEvent = (event: PipelineStreamEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        await runWithRuntime(
          Effect.gen(function* () {
            const paperless = yield* PaperlessService;
            const pipeline = yield* ProcessingPipelineService;
            const configService = yield* ConfigService;
            const tagConfig = configService.config.tags;

            // Get document with error handling
            const doc = yield* paperless.getDocument(docId).pipe(
              Effect.catchAll((e) => {
                sendEvent(createEvent({ type: 'error', docId, message: `Failed to load document: ${e}` }));
                return Effect.fail(e);
              })
            );

            // Use cached tags or fetch fresh (with 60s TTL, graceful fallback)
            const now = Date.now();
            let allTags: Array<{ id: number; name: string }>;
            if (tagCache && (now - tagCache.timestamp) < TAG_CACHE_TTL_MS) {
              allTags = tagCache.tags;
            } else {
              allTags = yield* paperless.getTags().pipe(
                Effect.catchAll((e) => {
                  console.error('[SSE] Failed to fetch tags, using stale cache:', e);
                  // Fall back to stale cache if available, otherwise empty array
                  if (tagCache?.tags) {
                    sendEvent(createEvent({ type: 'step_start', docId, step: 'init', message: 'Using cached tag data' }));
                    return Effect.succeed(tagCache.tags);
                  }
                  sendEvent(createEvent({ type: 'error', docId, message: `Failed to load tags: ${e}` }));
                  return Effect.fail(e);
                })
              );
              tagCache = { tags: allTags, timestamp: now };
            }
            const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
            const tagNames = (doc.tags ?? []).map((id) => tagMap.get(id)).filter((n): n is string => n !== undefined);

            // Determine current state from tags using exact match (consistent with ProcessingPipeline)
            let currentState = 'pending';
            if (tagNames.includes(tagConfig.processed)) {
              currentState = 'processed';
            } else if (tagNames.includes(tagConfig.tagsDone)) {
              currentState = 'tags_done';
            } else if (tagNames.includes(tagConfig.documentTypeDone)) {
              currentState = 'document_type_done';
            } else if (tagNames.includes(tagConfig.correspondentDone)) {
              currentState = 'correspondent_done';
            } else if (tagNames.includes(tagConfig.titleDone)) {
              currentState = 'title_done';
            } else if (tagNames.includes(tagConfig.schemaReview)) {
              currentState = 'schema_review';
            } else if (tagNames.includes(tagConfig.summaryDone)) {
              currentState = 'summary_done';
            } else if (tagNames.includes(tagConfig.ocrDone)) {
              currentState = 'ocr_done';
            } else if (tagNames.includes(tagConfig.pending)) {
              currentState = 'pending';
            }

            sendEvent(createEvent({ type: 'pipeline_start', docId }));

            // Helper function to determine next step based on state
            const getNextStepForState = (state: string): string | null => {
              switch (state) {
                case 'pending':
                  return 'ocr';
                case 'ocr_done':
                  return 'summary';
                case 'summary_done':
                  return 'schema_analysis';
                case 'schema_review':
                  return 'title'; // After schema analysis (with or without review), continue to title
                case 'schema_analysis_done':
                  return 'title';
                case 'title_done':
                  return 'correspondent';
                case 'correspondent_done':
                  return 'document_type';
                case 'document_type_done':
                  return 'tags';
                case 'tags_done':
                  return 'custom_fields';
                case 'processed':
                  return null;
                default:
                  return 'title'; // Default to title if state unclear
              }
            };

            // Helper to get current state from document tags (accepts tagMap for refresh support)
            const getStateFromTags = (docTags: readonly number[], currentTagMap: Map<number, string>): string => {
              const docTagNames = docTags.map((id) => currentTagMap.get(id)).filter((n): n is string => n !== undefined);
              if (docTagNames.includes(tagConfig.processed)) return 'processed';
              if (docTagNames.includes(tagConfig.tagsDone)) return 'tags_done';
              if (docTagNames.includes(tagConfig.documentTypeDone)) return 'document_type_done';
              if (docTagNames.includes(tagConfig.correspondentDone)) return 'correspondent_done';
              if (docTagNames.includes(tagConfig.titleDone)) return 'title_done';
              if (docTagNames.includes(tagConfig.schemaReview)) return 'schema_review';
              if (docTagNames.includes(tagConfig.summaryDone)) return 'summary_done';
              if (docTagNames.includes(tagConfig.ocrDone)) return 'ocr_done';
              if (docTagNames.includes(tagConfig.pending)) return 'pending';
              return 'pending';
            };

            // Check if already processed
            if (currentState === 'processed') {
              sendEvent(createEvent({ type: 'pipeline_complete', docId, message: 'Already processed' }));
              return;
            }

            let nextStep = getNextStepForState(currentState);

            if (!nextStep) {
              sendEvent(createEvent({ type: 'pipeline_complete', docId }));
              return;
            }

            // Run step(s) - either single step or full pipeline loop
            let stepHadError = false;

            if (fullPipeline) {
              // Full pipeline mode: loop through all remaining steps
              const MAX_PIPELINE_STEPS = 10;
              let iterationCount = 0;
              let needsReview = false;
              let currentTagMap = tagMap;

              while (nextStep !== null && !stepHadError && !needsReview && iterationCount < MAX_PIPELINE_STEPS) {
                iterationCount++;

                yield* pipe(
                  pipeline.processStepStream(docId, nextStep),
                  Stream.tap((event) => Effect.sync(() => {
                    sendEvent(event);
                    // Check if step needs manual review - stop the loop
                    if (event.type === 'needs_review' || event.type === 'pipeline_paused' || event.type === 'schema_review_needed') {
                      needsReview = true;
                    }
                  })),
                  Stream.runDrain,
                  Effect.catchAll((e) => {
                    stepHadError = true;
                    sendEvent(createEvent({ type: 'step_error', docId, step: nextStep!, message: String(e) }));
                    return Effect.void;
                  })
                );

                if (!stepHadError && !needsReview) {
                  // Re-fetch tags to include any newly created ones
                  const updatedTags = yield* paperless.getTags();
                  currentTagMap = new Map(updatedTags.map((t) => [t.id, t.name]));

                  // Re-fetch document to get updated state
                  const updatedDoc = yield* paperless.getDocument(docId);
                  const updatedState = getStateFromTags(updatedDoc.tags ?? [], currentTagMap);

                  // Handle summary step when it might not update tags (e.g., disabled or error recovery)
                  if (nextStep === 'summary' && updatedState === 'ocr_done') {
                    // Summary step ran but state didn't change - could be disabled or skipped
                    // Check if we should advance to schema_analysis
                    nextStep = 'schema_analysis';
                  }
                  // Handle schema_analysis completion - it doesn't update tags, advance to title
                  // This handles both when summary is enabled (state = summary_done) and when disabled (state = ocr_done)
                  else if (nextStep === 'schema_analysis' && (updatedState === 'summary_done' || updatedState === 'ocr_done')) {
                    // schema_analysis completed but no state change - advance to title
                    nextStep = 'title';
                  }
                  // Handle custom_fields completion -> transition to processed
                  else if (nextStep === 'custom_fields' && updatedState === 'tags_done') {
                    // custom_fields completed but no state change - transition to processed
                    yield* paperless.transitionDocumentTag(docId, tagConfig.tagsDone, tagConfig.processed);
                    nextStep = null; // Pipeline complete
                  } else {
                    nextStep = getNextStepForState(updatedState);
                  }
                }
              }

              // Check for max iterations exceeded
              if (iterationCount >= MAX_PIPELINE_STEPS && nextStep !== null) {
                sendEvent(createEvent({
                  type: 'error',
                  docId,
                  message: 'Pipeline exceeded maximum step count - possible infinite loop'
                }));
                stepHadError = true;
              }
            } else {
              // Single step mode: run only the next step
              yield* pipe(
                pipeline.processStepStream(docId, nextStep),
                Stream.tap((event) => Effect.sync(() => sendEvent(event))),
                Stream.runDrain,
                Effect.catchAll((e) => {
                  stepHadError = true;
                  sendEvent(createEvent({ type: 'step_error', docId, step: nextStep!, message: String(e) }));
                  return Effect.void;
                })
              );
            }

            // Only send pipeline_complete on success (not after errors)
            if (!stepHadError) {
              sendEvent(createEvent({ type: 'pipeline_complete', docId }));
            }
          })
        );
      } catch (error) {
        console.error('[SSE] Stream error:', error);
        try {
          sendEvent(createEvent({
            type: 'error',
            docId,
            message: error instanceof Error ? error.message : String(error),
          }));
        } catch (sendError) {
          console.error('[SSE] Failed to send error event:', sendError);
        }
      } finally {
        res.end();
      }
    };

    const server = createServer(async (req, res) => {
      setCorsHeaders(req, res);

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Check for SSE stream requests
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      const sseMatch = url.pathname.match(SSE_STREAM_PATTERN);
      if (sseMatch && req.method === 'GET') {
        const docId = parseInt(sseMatch[1]!, 10);
        // Validate document ID is a positive number
        if (isNaN(docId) || docId <= 0) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid document ID' }));
          return;
        }
        // Check for full pipeline mode
        const fullPipeline = url.searchParams.get('full') === 'true';
        await handleSSEStream(res, docId, fullPipeline);
        return;
      }

      try {
        const body = await parseBody(req);

        const effect = pipe(
          handleRequest(req, res, body),
          Effect.catchAll((e) => Effect.succeed({ status: 500, error: String(e) }))
        );

        const result = await runWithRuntime(effect);

        // Handle binary PDF responses
        if (result instanceof Uint8Array) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline');
          res.setHeader('Content-Length', result.length);
          res.writeHead(200);
          res.end(Buffer.from(result));
          return;
        }

        res.setHeader('Content-Type', 'application/json');

        // Only use status as HTTP code if it's a numeric status code
        if (typeof result === 'object' && result !== null && 'status' in result) {
          const status = (result as { status: unknown }).status;
          if (typeof status === 'number' && status >= 100 && status < 600) {
            res.writeHead(status);
          } else {
            res.writeHead(200);
          }
        } else {
          res.writeHead(200);
        }

        res.end(JSON.stringify(result));
      } catch (error) {
        console.error('Request error:', error);

        res.setHeader('Content-Type', 'application/json');

        // Handle request too large error with proper status code
        if (error instanceof RequestTooLargeError) {
          res.writeHead(413);
          res.end(JSON.stringify({ error: 'Request Entity Too Large' }));
          return;
        }

        res.writeHead(500);
        res.end(
          JSON.stringify({
            error: 'Internal Server Error',
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    });

    // Initialize Qdrant collection on startup (graceful failure)
    runWithRuntime(
      Effect.gen(function* () {
        const qdrant = yield* QdrantService;
        yield* qdrant.ensureCollection().pipe(
          Effect.tap(() => Effect.sync(() => console.log('[Qdrant] Collection initialized successfully'))),
          Effect.catchAll((e) => {
            console.warn('[Qdrant] Collection initialization failed (vector search may be unavailable):', e);
            return Effect.void;
          })
        );
      })
    ).catch((e) => {
      console.warn('[Qdrant] Service initialization failed:', e);
    });

    server.listen(port, () => {
      console.log(`🚀 Backend-TS server running on http://localhost:${port}`);
    });

    // Return cleanup function
    return () => {
      server.close();
    };
  });
