/**
 * HTTP server implementation.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseDocumentIdString } from "@repo/api-contracts";
import { Effect, Layer, pipe, Runtime, Scope, Stream } from "effect";
import { type PipelineStreamEvent, ProcessingPipelineService } from "./agents/index.js";
import { handleRequest } from "./api/index.js";
import { NotFoundError, ValidationError } from "./errors/index.js";
import { AppLayer } from "./layers/index.js";
import { annotateSpan, withServerSpan } from "./observability/tracing.js";
import {
  AutoProcessingService,
  ConfigService,
  DocumentAuthorizationService,
  DocumentCaseService,
  metrics,
  metricsRegistry,
  normalizeMetricPath,
  PaperlessService,
  QdrantService,
  TagCacheService,
  TinyBaseService,
} from "./services/index.js";
import { logger } from "./utils/logger.js";
import { getProcessingStateFromDocumentTags } from "./utils/tagState.js";

// ===========================================================================
// Security Configuration
// ===========================================================================

// Maximum request body size (10MB - generous for document metadata)
const MAX_BODY_SIZE = 10 * 1024 * 1024;
const serverLogger = logger.child({ component: "http_server" });

const DEFAULT_DEV_TRUSTED_UI_ORIGINS = [
  "https://paperless-llm-web.localhost:1355",
  "http://localhost:3765",
  "http://127.0.0.1:3765",
];

const parseOriginList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const shouldIncludeDefaultDevOrigins = (): boolean => process.env["NODE_ENV"] !== "production";

export const getTrustedUiOrigins = (): Set<string> =>
  new Set([
    ...(shouldIncludeDefaultDevOrigins() ? DEFAULT_DEV_TRUSTED_UI_ORIGINS : []),
    ...parseOriginList(process.env["CORS_ORIGINS"]),
    ...parseOriginList(process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"]),
  ]);

// ===========================================================================
// Request Body Parser
// ===========================================================================

class RequestTooLargeError extends Error {
  constructor() {
    super("Request body too large");
    this.name = "RequestTooLargeError";
  }
}

class InvalidJsonError extends Error {
  constructor(message = "Malformed JSON request body") {
    super(message);
    this.name = "InvalidJsonError";
  }
}

const parseBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalSize = 0;

    req.on("data", (chunk: Buffer) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        req.destroy();
        reject(new RequestTooLargeError());
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new InvalidJsonError(error instanceof Error ? error.message : undefined));
      }
    });

    req.on("error", reject);
  });

export const abortableDelay = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const isSseWritable = (res: ServerResponse): boolean => !res.destroyed && !res.writableEnded;

const writeSsePayload = (res: ServerResponse, signal: AbortSignal, payload: string): boolean => {
  if (signal.aborted || !isSseWritable(res)) return false;
  res.write(payload);
  return true;
};

const writeSseData = (res: ServerResponse, signal: AbortSignal, payload: unknown): boolean =>
  writeSsePayload(res, signal, `data: ${JSON.stringify(payload)}\n\n`);

const writeSseKeepAlive = (res: ServerResponse, signal: AbortSignal): boolean =>
  writeSsePayload(res, signal, `: keep-alive ${new Date().toISOString()}\n\n`);

const endSseResponse = (res: ServerResponse): void => {
  if (isSseWritable(res)) res.end();
};

export const createSseCloseSignal = (
  req: IncomingMessage,
  res: ServerResponse,
): { readonly signal: AbortSignal; readonly cleanup: () => void } => {
  const abortController = new AbortController();
  const abort = () => {
    if (!abortController.signal.aborted) abortController.abort();
  };

  req.on("close", abort);
  res.on("close", abort);

  return {
    signal: abortController.signal,
    cleanup: () => {
      req.off("close", abort);
      res.off("close", abort);
    },
  };
};

export const runEffectWithAbort = <A>(
  runtime: Runtime.Runtime<never>,
  effect: Effect.Effect<A, unknown, unknown>,
  signal: AbortSignal,
): Promise<A> => Runtime.runPromise(runtime)(effect as Effect.Effect<A, never, never>, { signal });

// ===========================================================================
// CORS Headers
// ===========================================================================

const setCorsHeaders = (req: IncomingMessage, res: ServerResponse): void => {
  const origin = req.headers.origin;
  const trustedUiOrigins = getTrustedUiOrigins();

  if (origin && trustedUiOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, X-Request-Id",
  );
  res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
  res.setHeader("Access-Control-Allow-Credentials", "true");
};

// ===========================================================================
// SSE Stream URL Pattern
// ===========================================================================

const SSE_STREAM_PATTERN = /^\/api\/processing\/(\d+)\/stream$/;
const CASE_STREAM_PATTERN = /^\/api\/cases\/document\/(\d+)\/stream$/;
const CATALOG_STREAM_PATTERN = /^\/api\/catalog\/runs\/([^/]+)\/stream$/;
const getApiAuthToken = (): string =>
  process.env["PAPERLESS_LLM_API_TOKEN"] ?? process.env["LOCAL_LLM_API_KEY"] ?? "";

const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

const isTruthyEnvValue = (value: string | undefined): boolean =>
  truthyEnvValues.has(value?.trim().toLowerCase() ?? "");

export const isApiDocsEnabled = (): boolean =>
  process.env["NODE_ENV"] !== "production" ||
  isTruthyEnvValue(process.env["PAPERLESS_LLM_ENABLE_API_DOCS"]);

const isPublicPath = (path: string): boolean =>
  path === "/" ||
  path === "/health" ||
  path === "/metrics" ||
  (isApiDocsEnabled() && (path === "/openapi.json" || path === "/api/docs"));

export interface RateLimitConfig {
  readonly rateLimitEnabled: boolean;
  readonly rateLimitWindowMs: number;
  readonly rateLimitMaxRequests: number;
  readonly rateLimitTrustProxy: boolean;
}

interface RateLimitEntry {
  windowStartMs: number;
  count: number;
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAtMs: number;
  readonly retryAfterSeconds?: number;
}

export const isProdReadOnlyMode = (): boolean =>
  isTruthyEnvValue(process.env["PAPERLESS_LLM_PROD_READ_ONLY"]) ||
  isTruthyEnvValue(process.env["PAPERLESS_LLM_READ_ONLY"]);

const READ_ONLY_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const READ_ONLY_SAFE_POST_PATHS = [
  /^\/api\/settings\/test-connection\/(paperless|ollama|mistral)$/,
];
const READ_ONLY_BLOCKED_SAFE_METHOD_PATHS = [
  /^\/api\/processing\/\d+\/stream$/,
  /^\/api\/cases\/document\/\d+\/stream$/,
  /^\/api\/settings\/check-import$/,
];

export const isReadOnlyRequestAllowed = (method: string | undefined, path: string): boolean => {
  const normalizedMethod = method?.toUpperCase() ?? "GET";
  if (
    normalizedMethod !== "OPTIONS" &&
    READ_ONLY_BLOCKED_SAFE_METHOD_PATHS.some((pattern) => pattern.test(path))
  ) {
    return false;
  }
  if (READ_ONLY_SAFE_METHODS.has(normalizedMethod)) return true;
  if (normalizedMethod !== "POST") return false;
  return READ_ONLY_SAFE_POST_PATHS.some((pattern) => pattern.test(path));
};

const readOnlyRejection = (requestId: string) => ({
  status: 403,
  error: "Read Only Mode",
  message:
    "PAPERLESS_LLM_PROD_READ_ONLY is enabled; mutating API requests are blocked to protect production documents.",
  requestId,
});

const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const normalizeRemoteAddress = (address: string | undefined): string => {
  const trimmed = address?.trim();
  if (!trimmed) return "unknown";
  return trimmed.startsWith("::ffff:") ? trimmed.slice("::ffff:".length) : trimmed;
};

export const getClientIp = (req: IncomingMessage, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
    const forwardedIp = forwardedFor?.split(",")[0]?.trim();
    if (forwardedIp) return normalizeRemoteAddress(forwardedIp);

    const realIp = firstHeaderValue(req.headers["x-real-ip"]);
    if (realIp) return normalizeRemoteAddress(realIp);
  }

  return normalizeRemoteAddress(req.socket.remoteAddress);
};

const normalizeRateLimitConfig = (config: RateLimitConfig): RateLimitConfig => ({
  rateLimitEnabled: config.rateLimitEnabled,
  rateLimitWindowMs:
    Number.isFinite(config.rateLimitWindowMs) && config.rateLimitWindowMs > 0
      ? Math.floor(config.rateLimitWindowMs)
      : 60_000,
  rateLimitMaxRequests:
    Number.isFinite(config.rateLimitMaxRequests) && config.rateLimitMaxRequests > 0
      ? Math.floor(config.rateLimitMaxRequests)
      : 300,
  rateLimitTrustProxy: config.rateLimitTrustProxy,
});

export const shouldBypassRateLimit = (method: string | undefined, path: string): boolean =>
  method?.toUpperCase() === "OPTIONS" || path === "/health" || path === "/metrics";

export const createRateLimiter = (
  config: RateLimitConfig,
  now: () => number = Date.now,
): ((key: string) => RateLimitResult) => {
  const normalized = normalizeRateLimitConfig(config);
  const entries = new Map<string, RateLimitEntry>();
  let checksSinceCleanup = 0;

  return (key: string): RateLimitResult => {
    if (!normalized.rateLimitEnabled) {
      return {
        allowed: true,
        limit: normalized.rateLimitMaxRequests,
        remaining: normalized.rateLimitMaxRequests,
        resetAtMs: now() + normalized.rateLimitWindowMs,
      };
    }

    const currentTimeMs = now();
    const windowMs = normalized.rateLimitWindowMs;
    const limit = normalized.rateLimitMaxRequests;
    const existing = entries.get(key);
    const entry =
      !existing || currentTimeMs - existing.windowStartMs >= windowMs
        ? { windowStartMs: currentTimeMs, count: 0 }
        : existing;

    entry.count += 1;
    entries.set(key, entry);

    checksSinceCleanup += 1;
    if (checksSinceCleanup >= 100 || entries.size > 10_000) {
      checksSinceCleanup = 0;
      for (const [entryKey, value] of entries.entries()) {
        if (currentTimeMs - value.windowStartMs >= windowMs * 2) entries.delete(entryKey);
      }
    }

    const resetAtMs = entry.windowStartMs + windowMs;
    const remaining = Math.max(0, limit - entry.count);
    if (entry.count <= limit) return { allowed: true, limit, remaining, resetAtMs };

    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAtMs,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAtMs - currentTimeMs) / 1000)),
    };
  };
};

const rateLimitRejection = (requestId: string) => ({
  status: 429,
  error: "Too Many Requests",
  message: "Too many requests. Please retry after the current rate limit window resets.",
  requestId,
});

const invalidDocumentIdRejection = (requestId: string) => ({
  status: 400,
  error: "Validation Error",
  message: "Invalid document ID",
  issues: [{ path: ["docId"], message: "Invalid document ID", code: "invalid_value" }],
  requestId,
});

const writeJsonResponse = (
  res: ServerResponse,
  status: number,
  payload: Record<string, unknown>,
): void => {
  res.setHeader("Content-Type", "application/json");
  res.writeHead(status);
  res.end(JSON.stringify(payload));
};

export const isAuthorized = (req: IncomingMessage, url: URL): boolean => {
  const apiAuthToken = getApiAuthToken();
  if (!apiAuthToken || isPublicPath(url.pathname)) return true;
  const authorization = req.headers.authorization ?? "";
  const headerToken = req.headers["x-api-key"];
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const apiKeyHeader = Array.isArray(headerToken) ? headerToken[0] : headerToken;
  return bearer === apiAuthToken || apiKeyHeader === apiAuthToken;
};

const createRequestId = (): string => randomUUID();

const apiDocsHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Paperless Local LLM API Docs</title>
    <style>
      body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0f172a; color: #e2e8f0; }
      main { max-width: 960px; margin: 0 auto; padding: 3rem 1.5rem; }
      a { color: #93c5fd; }
      pre { overflow: auto; background: #020617; border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem; }
      .card { background: #111827; border: 1px solid #334155; border-radius: 1rem; padding: 1.5rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Paperless Local LLM API Docs</h1>
      <div class="card">
        <p>This development-only page exposes the generated OpenAPI document.</p>
        <p><a href="/openapi.json">Open /openapi.json</a></p>
        <p>Use the JSON URL with Swagger UI, Scalar, ReDoc, or other OpenAPI tooling.</p>
        <pre>curl -sS http://127.0.0.1:8765/openapi.json</pre>
      </div>
    </main>
  </body>
</html>`;

const writeApiDocsResponse = (res: ServerResponse): void => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.writeHead(200);
  res.end(apiDocsHtml);
};

const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

export const sanitizeHeadersForLog = (
  headers: IncomingMessage["headers"],
): Record<string, string | string[] | undefined> => {
  const sanitized: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "***" : value;
  }
  return sanitized;
};

const httpOutcome = (statusCode: number): "success" | "error" =>
  statusCode >= 400 ? "error" : "success";

const errorClass = (error: unknown): string | undefined => {
  if (!error) return undefined;
  if (error instanceof Error && error.name) return error.name;
  if (typeof error === "object" && "error" in error)
    return String((error as { error: unknown }).error);
  return typeof error === "string" ? error : undefined;
};

const inferHttpStatus = (result: unknown): number => {
  if (result instanceof Uint8Array) return 200;
  if (typeof result === "object" && result !== null && "status" in result) {
    const status = (result as { status: unknown }).status;
    if (typeof status === "number" && status >= 100 && status < 600) return status;
  }
  return 200;
};

const annotateHttpSpan = (
  statusCode: number,
  durationMs: number,
  error?: unknown,
): Effect.Effect<void> =>
  annotateSpan({
    "http.response.status_code": statusCode,
    "http.server.duration_ms": durationMs,
    "http.response.outcome": httpOutcome(statusCode),
    ...(errorClass(error) ? { "error.type": errorClass(error) } : {}),
  });

const toHttpError = (error: unknown) => {
  if (
    error instanceof ValidationError ||
    (error as { _tag?: string })?._tag === "ValidationError"
  ) {
    const validation = error as ValidationError;
    return {
      status: 400,
      error: "Validation Error",
      message: validation.message,
      issues: validation.issues,
    };
  }
  if (error instanceof NotFoundError || (error as { _tag?: string })?._tag === "NotFoundError") {
    const notFound = error as NotFoundError;
    return {
      status: 404,
      error: "Not Found",
      message: notFound.message,
    };
  }
  return { status: 500, error: "Internal Server Error", message: String(error) };
};

// ===========================================================================
// Server Creation
// ===========================================================================

export const createHttpServerWithLayer = (
  port: number,
  host = "127.0.0.1",
  appLayer: Layer.Layer<never, unknown, never> = AppLayer,
  options: { readonly startBackgroundServices?: boolean } = {},
) =>
  Effect.gen(function* () {
    const startBackgroundServices = options.startBackgroundServices ?? true;
    // Build a runtime from the AppLayer once, reuse for all requests
    const scope = yield* Scope.make();
    const runtime = yield* Layer.toRuntime(appLayer).pipe(
      Scope.extend(scope),
      Effect.cached,
      Effect.flatten,
    );

    const runWithRuntime = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
      Runtime.runPromise(runtime)(effect as Effect.Effect<A, never, never>);

    const configService = yield* Effect.promise(() => runWithRuntime(ConfigService));
    const rateLimitConfig = configService.config.http ?? {
      rateLimitEnabled: true,
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 300,
      rateLimitTrustProxy: false,
    };
    const checkRateLimit = createRateLimiter(rateLimitConfig);

    // Helper to run stream and pipe to SSE response
    const handleSSEStream = async (
      req: IncomingMessage,
      res: ServerResponse,
      docId: number,
      fullPipeline: boolean = false,
      dryRun: boolean = false,
      requestId?: string,
      requestedStep?: "ocr" | "metadata" | "index",
    ): Promise<void> => {
      const sseLogger = serverLogger.child({
        requestId,
        docId,
        stream: "processing",
        fullPipeline,
        dryRun,
      });
      try {
        await runWithRuntime(
          Effect.gen(function* () {
            const auth = yield* DocumentAuthorizationService;
            yield* auth.authorizeDocument(docId, "process");
          }),
        );
      } catch (error) {
        const response = { ...toHttpError(error), requestId };
        res.setHeader("Content-Type", "application/json");
        res.writeHead(response.status);
        res.end(JSON.stringify(response));
        return;
      }
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.writeHead(200);
      const { signal, cleanup } = createSseCloseSignal(req, res);

      // Helper to create events with timestamps
      const createEvent = (e: Omit<PipelineStreamEvent, "timestamp">): PipelineStreamEvent => ({
        ...e,
        timestamp: new Date().toISOString(),
      });

      const sendEvent = (event: PipelineStreamEvent) => {
        writeSseData(res, signal, event);
      };

      try {
        await runEffectWithAbort(
          runtime,
          Effect.gen(function* () {
            const paperless = yield* PaperlessService;
            const pipeline = yield* ProcessingPipelineService;
            const configService = yield* ConfigService;
            const tagCache = yield* TagCacheService;
            const tagConfig = configService.config.tags;

            // Get document with error handling
            const doc = yield* paperless.getDocument(docId).pipe(
              Effect.catchAll((e) => {
                sendEvent(
                  createEvent({ type: "error", docId, message: `Failed to load document: ${e}` }),
                );
                return Effect.fail(e);
              }),
            );

            // Use cached tags or fetch fresh (with 60s TTL, graceful fallback)
            const tagResult = yield* tagCache.getTags().pipe(
              Effect.catchAll((e) => {
                sseLogger.warn("sse_tags_fetch_failed", {
                  error: e,
                  usingStaleCache: false,
                });
                sendEvent(
                  createEvent({ type: "error", docId, message: `Failed to load tags: ${e}` }),
                );
                return Effect.fail(e);
              }),
            );
            if (tagResult.source === "stale") {
              sseLogger.warn("sse_tags_fetch_failed", {
                error: tagResult.staleError,
                usingStaleCache: true,
              });
              sendEvent(
                createEvent({
                  type: "step_start",
                  docId,
                  step: "init",
                  message: "Using cached tag data",
                }),
              );
            }
            const tagMap = new Map(tagResult.tags.map((t) => [t.id, t.name]));
            const maxPipelineSteps = configService.config.pipeline.maxSteps;

            sendEvent(createEvent({ type: "pipeline_start", docId }));

            // Helper function to determine next step based on state
            const getNextStepForState = (state: string): string | null => {
              switch (state) {
                case "todo":
                  return "ocr";
                case "ocr":
                  return "metadata";
                case "metadata":
                  return "metadata";
                case "index":
                  return "index";
                case "review":
                case "done":
                case "failed":
                  return null;
                default:
                  return "ocr";
              }
            };

            const currentState = getProcessingStateFromDocumentTags(doc, tagConfig, tagMap);

            // Check if already processed
            if (currentState === "done") {
              sendEvent(
                createEvent({ type: "pipeline_complete", docId, message: "Already processed" }),
              );
              return;
            }

            let nextStep = requestedStep ?? getNextStepForState(currentState);

            if (!nextStep) {
              sendEvent(createEvent({ type: "pipeline_complete", docId }));
              return;
            }

            // Run step(s) - either single step or full pipeline loop
            let stepHadError = false;

            if (fullPipeline) {
              // Full pipeline mode: loop through all remaining steps
              let iterationCount = 0;
              let needsReview = false;
              let currentTagMap = tagMap;

              while (
                nextStep !== null &&
                !stepHadError &&
                !needsReview &&
                iterationCount < maxPipelineSteps
              ) {
                iterationCount++;
                const step = nextStep;

                yield* pipe(
                  pipeline.processStepStream(docId, step, dryRun),
                  Stream.tap((event) =>
                    Effect.sync(() => {
                      sendEvent(event);
                      if (event.type === "step_error" || event.type === "error") {
                        stepHadError = true;
                      }
                      // Check if step needs manual review - stop the loop
                      if (
                        event.type === "needs_review" ||
                        event.type === "pipeline_paused" ||
                        event.type === "schema_review_needed"
                      ) {
                        needsReview = true;
                      }
                    }),
                  ),
                  Stream.runDrain,
                  Effect.catchAll((e) => {
                    stepHadError = true;
                    sendEvent(
                      createEvent({
                        type: "step_error",
                        docId,
                        step,
                        message: String(e),
                      }),
                    );
                    return Effect.void;
                  }),
                );

                if (!stepHadError && !needsReview) {
                  // Refresh cached tags to include any newly created ones
                  const updatedTagResult = yield* tagCache.refresh();
                  if (updatedTagResult.source === "stale") {
                    sseLogger.warn("sse_tags_refresh_failed", {
                      error: updatedTagResult.staleError,
                      usingStaleCache: true,
                    });
                  }
                  currentTagMap = new Map(updatedTagResult.tags.map((t) => [t.id, t.name]));

                  // Re-fetch document to get updated state
                  const updatedDoc = yield* paperless.getDocument(docId);
                  const updatedState = getProcessingStateFromDocumentTags(
                    updatedDoc,
                    tagConfig,
                    currentTagMap,
                  );

                  nextStep = getNextStepForState(updatedState);
                }
              }

              // Check for max iterations exceeded
              if (iterationCount >= maxPipelineSteps && nextStep !== null) {
                sendEvent(
                  createEvent({
                    type: "error",
                    docId,
                    message: "Pipeline exceeded maximum step count - possible infinite loop",
                  }),
                );
                stepHadError = true;
              }
            } else {
              // Single step mode: run only the next step
              const step = nextStep;
              yield* pipe(
                pipeline.processStepStream(docId, step, dryRun),
                Stream.tap((event) =>
                  Effect.sync(() => {
                    sendEvent(event);
                    if (event.type === "step_error" || event.type === "error") {
                      stepHadError = true;
                    }
                  }),
                ),
                Stream.runDrain,
                Effect.catchAll((e) => {
                  stepHadError = true;
                  sendEvent(createEvent({ type: "step_error", docId, step, message: String(e) }));
                  return Effect.void;
                }),
              );
            }

            // Only send pipeline_complete on success (not after errors)
            if (!stepHadError) {
              sendEvent(createEvent({ type: "pipeline_complete", docId }));
            }
          }),
          signal,
        );
      } catch (error) {
        if (!signal.aborted) {
          sseLogger.error("sse_stream_error", { error });
          try {
            sendEvent(
              createEvent({
                type: "error",
                docId,
                message: error instanceof Error ? error.message : String(error),
              }),
            );
          } catch (sendError) {
            sseLogger.error("sse_error_event_send_failed", { error: sendError });
          }
        }
      } finally {
        cleanup();
        endSseResponse(res);
      }
    };

    const server = createServer(async (req, res) => {
      const requestId = createRequestId();
      const startedAt = Date.now();
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const requestLogger = serverLogger.child({
        requestId,
        method: req.method,
        path: url.pathname,
      });
      res.setHeader("X-Request-Id", requestId);
      res.on("finish", () => {
        const durationMs = Date.now() - startedAt;
        requestLogger.info("http_request_completed", {
          status: res.statusCode,
          durationMs,
        });
        const labels = {
          method: req.method?.toUpperCase() ?? "UNKNOWN",
          path: normalizeMetricPath(url.pathname),
          status: String(res.statusCode),
        };
        metrics.httpRequests.inc(labels);
        metrics.httpRequestDuration.observe(labels, durationMs / 1000);
      });

      setCorsHeaders(req, res);

      // Handle preflight requests
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (!shouldBypassRateLimit(req.method, url.pathname)) {
        const rateLimit = checkRateLimit(getClientIp(req, rateLimitConfig.rateLimitTrustProxy));
        res.setHeader("X-RateLimit-Limit", String(rateLimit.limit));
        res.setHeader("X-RateLimit-Remaining", String(rateLimit.remaining));
        res.setHeader("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAtMs / 1000)));

        if (!rateLimit.allowed) {
          requestLogger.warn("http_rate_limit_exceeded");
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds ?? 1));
          res.writeHead(429);
          res.end(JSON.stringify(rateLimitRejection(requestId)));
          return;
        }
      }

      if (url.pathname === "/metrics" && req.method === "GET") {
        res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
        res.writeHead(200);
        res.end(metricsRegistry.render());
        return;
      }

      // Check for SSE stream requests
      if (!isAuthorized(req, url)) {
        res.setHeader("Content-Type", "application/json");
        res.writeHead(401);
        res.end(JSON.stringify({ status: 401, error: "Unauthorized", requestId }));
        return;
      }

      if (isProdReadOnlyMode() && !isReadOnlyRequestAllowed(req.method, url.pathname)) {
        requestLogger.warn("prod_read_only_request_blocked");
        res.setHeader("Content-Type", "application/json");
        res.writeHead(403);
        res.end(JSON.stringify(readOnlyRejection(requestId)));
        return;
      }

      if (url.pathname === "/api/docs" && req.method === "GET") {
        if (isApiDocsEnabled()) {
          writeApiDocsResponse(res);
        } else {
          res.setHeader("Content-Type", "application/json");
          res.writeHead(404);
          res.end(JSON.stringify({ status: 404, error: "Not Found", requestId }));
        }
        return;
      }

      const sseMatch = url.pathname.match(SSE_STREAM_PATTERN);
      const caseStreamMatch = url.pathname.match(CASE_STREAM_PATTERN);
      const catalogStreamMatch = url.pathname.match(CATALOG_STREAM_PATTERN);
      if (sseMatch && req.method === "GET") {
        const docId = parseDocumentIdString(sseMatch[1] ?? "");
        if (docId === null) {
          writeJsonResponse(res, 400, invalidDocumentIdRejection(requestId));
          return;
        }
        // Check for full pipeline mode
        const fullPipeline = url.searchParams.get("full") === "true";
        const dryRun = url.searchParams.get("dryRun") === "true";
        const requestedStepParam = url.searchParams.get("step");
        const requestedStep =
          requestedStepParam === "ocr" ||
          requestedStepParam === "metadata" ||
          requestedStepParam === "index"
            ? requestedStepParam
            : undefined;
        if (requestedStepParam && !requestedStep) {
          writeJsonResponse(res, 400, {
            status: 400,
            error: "Validation Error",
            message: "Invalid processing step",
            issues: [
              {
                path: ["step"],
                message: "Expected one of: ocr, metadata, index",
                code: "invalid_value",
              },
            ],
            requestId,
          });
          return;
        }
        await runWithRuntime(
          Effect.promise(() =>
            handleSSEStream(req, res, docId, fullPipeline, dryRun, requestId, requestedStep),
          ).pipe(
            Effect.tap(() => annotateHttpSpan(res.statusCode, Date.now() - startedAt)),
            Effect.tapError((error) =>
              annotateHttpSpan(res.statusCode, Date.now() - startedAt, error),
            ),
            withServerSpan("http.sse.processing", {
              "request.id": requestId,
              "http.request.method": req.method?.toUpperCase() ?? "UNKNOWN",
              "http.route": "/api/processing/:id/stream",
              "url.path": "/api/processing/:id/stream",
              "paperless.stream.kind": "processing",
              "paperless.document.id": docId,
              "pipeline.full": fullPipeline,
              "pipeline.dry_run": dryRun,
              "pipeline.requested_step": requestedStep ?? "auto",
            }),
          ),
        );
        return;
      }
      if (caseStreamMatch && req.method === "GET") {
        const docId = parseDocumentIdString(caseStreamMatch[1] ?? "");
        if (docId === null) {
          writeJsonResponse(res, 400, invalidDocumentIdRejection(requestId));
          return;
        }
        try {
          await runWithRuntime(
            Effect.gen(function* () {
              const auth = yield* DocumentAuthorizationService;
              yield* auth.authorizeDocument(docId, "view");
            }),
          );
        } catch (error) {
          const response = { ...toHttpError(error), requestId };
          res.setHeader("Content-Type", "application/json");
          res.writeHead(response.status);
          res.end(JSON.stringify(response));
          return;
        }
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);
        const { signal, cleanup } = createSseCloseSignal(req, res);
        try {
          while (!signal.aborted) {
            const payload = await runEffectWithAbort(
              runtime,
              Effect.gen(function* () {
                const cases = yield* DocumentCaseService;
                const tinybase = yield* TinyBaseService;
                const caseRecord = yield* cases.getOrCreateCaseForDocument(docId);
                const logs = yield* tinybase.getProcessingLogs(docId);
                return {
                  type: "case_snapshot",
                  case: caseRecord,
                  logs,
                  timestamp: new Date().toISOString(),
                };
              }).pipe(
                Effect.tap(() => annotateHttpSpan(res.statusCode, Date.now() - startedAt)),
                Effect.tapError((error) =>
                  annotateHttpSpan(res.statusCode, Date.now() - startedAt, error),
                ),
                withServerSpan("http.sse.case", {
                  "request.id": requestId,
                  "http.request.method": req.method?.toUpperCase() ?? "UNKNOWN",
                  "http.route": "/api/cases/document/:id/stream",
                  "url.path": "/api/cases/document/:id/stream",
                  "paperless.stream.kind": "case",
                  "paperless.document.id": docId,
                }),
              ),
              signal,
            );
            if (signal.aborted) break;
            writeSseData(res, signal, payload);
            writeSseKeepAlive(res, signal);
            await abortableDelay(2000, signal);
          }
        } catch (error) {
          if (!signal.aborted) {
            writeSseData(res, signal, {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          cleanup();
          endSseResponse(res);
        }
        return;
      }
      if (catalogStreamMatch && req.method === "GET") {
        const runId = decodeURIComponent(catalogStreamMatch[1] ?? "");
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.writeHead(200);
        const { signal, cleanup } = createSseCloseSignal(req, res);
        try {
          while (!signal.aborted) {
            const payload = await runEffectWithAbort(
              runtime,
              Effect.gen(function* () {
                const tinybase = yield* TinyBaseService;
                const logs = (yield* tinybase.getProcessingLogs(0)).filter(
                  (log) => log.step === `catalog:${runId}`,
                );
                return {
                  type: "catalog_snapshot",
                  runId,
                  logs,
                  timestamp: new Date().toISOString(),
                };
              }).pipe(
                Effect.tap(() => annotateHttpSpan(res.statusCode, Date.now() - startedAt)),
                Effect.tapError((error) =>
                  annotateHttpSpan(res.statusCode, Date.now() - startedAt, error),
                ),
                withServerSpan("http.sse.catalog", {
                  "request.id": requestId,
                  "http.request.method": req.method?.toUpperCase() ?? "UNKNOWN",
                  "http.route": "/api/catalog/runs/:runId/stream",
                  "url.path": "/api/catalog/runs/:runId/stream",
                  "paperless.stream.kind": "catalog",
                  "paperless.catalog.run_id.length": runId.length,
                }),
              ),
              signal,
            );
            if (signal.aborted) break;
            writeSseData(res, signal, payload);
            writeSseKeepAlive(res, signal);
            await abortableDelay(2000, signal);
          }
        } catch (error) {
          if (!signal.aborted) {
            writeSseData(res, signal, {
              type: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          cleanup();
          endSseResponse(res);
        }
        return;
      }

      try {
        const body = await parseBody(req);

        const effect = pipe(
          handleRequest(req, res, body),
          Effect.either,
          Effect.flatMap((exit) => {
            const result =
              exit._tag === "Left" ? { ...toHttpError(exit.left), requestId } : exit.right;
            const statusCode = inferHttpStatus(result);
            return annotateHttpSpan(
              statusCode,
              Date.now() - startedAt,
              exit._tag === "Left" ? exit.left : result,
            ).pipe(Effect.as(result));
          }),
          withServerSpan("http.request", {
            "request.id": requestId,
            "http.request.method": req.method?.toUpperCase() ?? "UNKNOWN",
            "http.route": normalizeMetricPath(url.pathname),
            "url.path": normalizeMetricPath(url.pathname),
          }),
        );

        const result = await runWithRuntime(effect);

        // Handle binary PDF responses
        if (result instanceof Uint8Array) {
          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", "inline");
          res.setHeader("Content-Length", result.length);
          res.writeHead(200);
          res.end(Buffer.from(result));
          return;
        }

        res.setHeader("Content-Type", "application/json");

        // Only use status as HTTP code if it's a numeric status code
        if (typeof result === "object" && result !== null && "status" in result) {
          const status = (result as { status: unknown }).status;
          if (typeof status === "number" && status >= 100 && status < 600) {
            res.writeHead(status);
          } else {
            res.writeHead(200);
          }
        } else {
          res.writeHead(200);
        }

        res.end(JSON.stringify(result));
      } catch (error) {
        requestLogger.error("http_request_failed", {
          headers: sanitizeHeadersForLog(req.headers),
          error,
        });

        res.setHeader("Content-Type", "application/json");

        // Handle request too large error with proper status code
        if (error instanceof RequestTooLargeError) {
          res.writeHead(413);
          res.end(
            JSON.stringify({
              status: 413,
              error: "Request Entity Too Large",
              requestId,
            }),
          );
          return;
        }

        if (error instanceof InvalidJsonError) {
          res.writeHead(400);
          res.end(
            JSON.stringify({
              status: 400,
              error: "Invalid JSON",
              message: error.message,
              requestId,
            }),
          );
          return;
        }

        res.writeHead(500);
        res.end(
          JSON.stringify({
            status: 500,
            error: "Internal Server Error",
            message: error instanceof Error ? error.message : String(error),
            requestId,
          }),
        );
      }
    });

    if (isProdReadOnlyMode()) {
      serverLogger.warn("prod_read_only_mode_enabled", {
        blockedMethods: ["POST", "PATCH", "PUT", "DELETE"],
        allowedPostPaths: [
          "/api/settings/test-connection/paperless",
          "/api/settings/test-connection/ollama",
          "/api/settings/test-connection/mistral",
        ],
      });
      serverLogger.info("qdrant_collection_initialization_skipped_read_only");
      serverLogger.info("auto_processing_initialization_skipped_read_only");
    } else if (!startBackgroundServices) {
      serverLogger.info("qdrant_collection_initialization_skipped_test");
      serverLogger.info("auto_processing_initialization_skipped_test");
    } else {
      // Initialize Qdrant collection on startup (graceful failure)
      runWithRuntime(
        Effect.gen(function* () {
          const qdrant = yield* QdrantService;
          yield* qdrant.ensureCollection().pipe(
            Effect.tap(() => Effect.sync(() => serverLogger.info("qdrant_collection_initialized"))),
            Effect.catchAll((e) => {
              serverLogger.warn("qdrant_collection_initialization_failed", { error: e });
              return Effect.void;
            }),
          );
        }),
      ).catch((e) => {
        serverLogger.warn("qdrant_service_initialization_failed", { error: e });
      });

      // Start Auto Processing Service on startup
      runWithRuntime(
        Effect.gen(function* () {
          const autoProcessing = yield* AutoProcessingService;
          yield* autoProcessing.start().pipe(
            Effect.tap(() => Effect.sync(() => serverLogger.info("auto_processing_initialized"))),
            Effect.catchAll((e) => {
              serverLogger.warn("auto_processing_initialization_failed", { error: e });
              return Effect.void;
            }),
          );
        }),
      ).catch((e) => {
        serverLogger.warn("auto_processing_service_initialization_failed", { error: e });
      });
    }

    server.listen(port, host, () => {
      serverLogger.info("http_server_listening", { host, port, url: `http://${host}:${port}` });
    });

    // Return cleanup function
    return () => {
      // Stop AutoProcessingService gracefully
      runWithRuntime(
        Effect.gen(function* () {
          const autoProcessing = yield* AutoProcessingService;
          yield* autoProcessing.stop();
        }),
      ).catch(() => {
        // Ignore errors during shutdown
      });
      server.close();
    };
  });

export const createHttpServer = (port: number, host = "127.0.0.1") =>
  createHttpServerWithLayer(port, host);
