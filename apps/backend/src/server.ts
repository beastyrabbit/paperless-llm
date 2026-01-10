/**
 * HTTP server implementation.
 */
import { Effect, pipe, Layer, Runtime, Scope } from 'effect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppLayer } from './layers/index.js';
import { handleRequest } from './api/index.js';

// ===========================================================================
// Security Configuration
// ===========================================================================

// Maximum request body size (10MB - generous for document metadata)
const MAX_BODY_SIZE = 10 * 1024 * 1024;

// Allowed CORS origins - localhost variants for development
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
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
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3000');
  }
  // If origin is not in allowed list and is present, don't set header (browser will block)

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
};

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

    const server = createServer(async (req, res) => {
      setCorsHeaders(req, res);

      // Handle preflight requests
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const body = await parseBody(req);

        const effect = pipe(
          handleRequest(req, res, body),
          Effect.catchAll((e) => Effect.succeed({ status: 500, error: String(e) }))
        );

        const result = await runWithRuntime(effect);

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
