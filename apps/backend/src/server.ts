/**
 * HTTP server implementation.
 */
import { Effect, pipe, Layer, Runtime, Scope, Stream } from 'effect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppLayer } from './layers/index.js';
import { handleRequest } from './api/index.js';
import { ProcessingPipelineService, type PipelineStreamEvent } from './agents/index.js';
import { PaperlessService } from './services/index.js';

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
      docId: number
    ): Promise<void> => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.writeHead(200);

      const sendEvent = (event: PipelineStreamEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      try {
        // Get current state and run next step
          // Get document and resolve tag names
          const doc = yield* paperless.getDocument(docId).pipe(
            Effect.catchAll((e) => {
              sendEvent({ type: 'error', docId, message: `Failed to load document: ${e}` });
              return Effect.fail(e);
            })
          );
          const allTags = yield* paperless.getTags().pipe(
            Effect.catchAll((e) => {
              sendEvent({ type: 'error', docId, message: `Failed to load tags: ${e}` });
              return Effect.fail(e);
            })
          );
          const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
          const tagNames = (doc.tags ?? []).map((id) => tagMap.get(id)).filter((n): n is string => n !== undefined);
          sendEvent({ type: 'pipeline_start', docId });

          // Determine next step based on current state
          let nextStep: string | null = null;
          switch (currentState) {
            case 'pending':
              nextStep = 'ocr';
              break;
            case 'ocr_done':
              nextStep = 'title';
              break;
            case 'title_done':
              nextStep = 'correspondent';
              break;
            case 'correspondent_done':
              nextStep = 'document_type';
              break;
            case 'document_type_done':
              nextStep = 'tags';
              break;
            case 'tags_done':
              nextStep = 'custom_fields';
              break;
            case 'processed':
              sendEvent({ type: 'pipeline_complete', docId, message: 'Already processed' });
              return;
            default:
              nextStep = 'title'; // Default to title if state unclear
          }

          if (!nextStep) {
            sendEvent({ type: 'pipeline_complete', docId });
            return;
          }

          // Run the next step with streaming for detailed LLM info
          // Note: step_start event is emitted by the agent stream
          yield* pipe(
            pipeline.processStepStream(docId, nextStep),
            Stream.tap((event) => Effect.sync(() => sendEvent(event))),
            Stream.runDrain,
            Effect.catchAll((e) => {
              sendEvent({ type: 'step_error', docId, step: nextStep, message: String(e) });
              return Effect.void;
            })
          );

          sendEvent({ type: 'pipeline_complete', docId });
        });

        await runWithRuntime(effect);
      } catch (error) {
        sendEvent({
          type: 'error',
          docId,
          message: error instanceof Error ? error.message : String(error),
        });
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
        await handleSSEStream(res, docId);
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

    server.listen(port, () => {
      console.log(`🚀 Backend-TS server running on http://localhost:${port}`);
    });

    // Return cleanup function
    return () => {
      server.close();
    };
  });
