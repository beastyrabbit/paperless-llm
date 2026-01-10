/**
 * HTTP server implementation.
 */
import { Effect, pipe, Layer, Runtime, Scope } from 'effect';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { AppLayer } from './layers/index.js';
import { handleRequest } from './api/index.js';

// ===========================================================================
// Request Body Parser
// ===========================================================================

const parseBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
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

const setCorsHeaders = (res: ServerResponse): void => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
      setCorsHeaders(res);

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
