import type { IncomingMessage } from "node:http";
import { request } from "node:http";
import { createServer as createNetServer } from "node:net";
import { Effect, Layer, Runtime, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProcessingPipelineService } from "../src/agents/ProcessingPipeline.js";
import { ConfigService } from "../src/config/index.js";
import type { Document } from "../src/models/index.js";
import {
  clearMemoryTraceSpans,
  getMemoryTraceSpans,
  makeTracingLayer,
} from "../src/observability/tracing.js";
import {
  abortableDelay,
  createHttpServer,
  createHttpServerWithLayer,
  createRateLimiter,
  getClientIp,
  getTrustedUiOrigins,
  isApiDocsEnabled,
  isAuthorized,
  isProdReadOnlyMode,
  isReadOnlyRequestAllowed,
  runEffectWithAbort,
  sanitizeHeadersForLog,
  shouldBypassRateLimit,
} from "../src/server.js";
import {
  DocumentAuthorizationServiceNoop,
  MistralService,
  type MistralService as MistralServiceType,
  metricsRegistry,
  OllamaService,
  type OllamaService as OllamaServiceType,
  PaperlessService,
  type PaperlessService as PaperlessServiceType,
  QdrantService,
  type QdrantService as QdrantServiceType,
  TagCacheService,
} from "../src/services/index.js";

const makeRequest = (
  headers: IncomingMessage["headers"] = {},
  remoteAddress = "127.0.0.1",
): IncomingMessage => ({ headers, socket: { remoteAddress } }) as IncomingMessage;

const createHealthLayer = (
  overrides: {
    paperless?: () => Effect.Effect<boolean, unknown>;
    ollama?: () => Effect.Effect<boolean, unknown>;
    qdrant?: () => Effect.Effect<boolean, unknown>;
    mistral?: () => Effect.Effect<boolean, unknown>;
  } = {},
) =>
  Layer.mergeAll(
    Layer.succeed(PaperlessService, {
      testConnection: overrides.paperless ?? (() => Effect.succeed(true)),
    } as unknown as PaperlessServiceType),
    Layer.succeed(OllamaService, {
      testConnection: overrides.ollama ?? (() => Effect.succeed(true)),
    } as unknown as OllamaServiceType),
    Layer.succeed(QdrantService, {
      testConnection: overrides.qdrant ?? (() => Effect.succeed(true)),
    } as unknown as QdrantServiceType),
    Layer.succeed(MistralService, {
      testConnection: overrides.mistral ?? (() => Effect.succeed(true)),
    } as unknown as MistralServiceType),
    Layer.succeed(ConfigService, {
      config: {
        http: {
          rateLimitEnabled: true,
          rateLimitWindowMs: 1000,
          rateLimitMaxRequests: 100,
          rateLimitTrustProxy: false,
        },
      },
    } as unknown as ConfigService),
  );

const getFreePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate test port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });

const requestSse = (port: number, path: string) =>
  new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }));
      },
    );
    req.on("error", reject);
    req.end();
  });

const requestOptions = (port: number, path: string, origin: string) =>
  new Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined> }>(
    (resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "OPTIONS",
          headers: { origin },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers }));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );

const requestGet = (port: number, path: string) =>
  new Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: responseBody,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

const requestJson = (port: number, path: string, body: unknown) =>
  new Promise<{ statusCode: number; body: unknown }>((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let responseBody = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              body: responseBody ? JSON.parse(responseBody) : null,
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

describe("server security helpers", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    metricsRegistry.reset();
  });

  it("does not authorize api_key query parameters", () => {
    process.env["PAPERLESS_LLM_API_TOKEN"] = "secret";

    expect(
      isAuthorized(makeRequest(), new URL("http://localhost/api/documents?api_key=secret")),
    ).toBe(false);
  });

  it("authorizes bearer and x-api-key headers", () => {
    process.env["PAPERLESS_LLM_API_TOKEN"] = "secret";

    expect(
      isAuthorized(
        makeRequest({ authorization: "Bearer secret" }),
        new URL("http://localhost/api/documents"),
      ),
    ).toBe(true);
    expect(
      isAuthorized(
        makeRequest({ "x-api-key": "secret" }),
        new URL("http://localhost/api/documents"),
      ),
    ).toBe(true);
  });

  it.each([
    "/api/processing/9007199254740992/stream",
    "/api/cases/document/9007199254740992/stream",
  ])("returns structured validation errors for invalid SSE document IDs: %s", async (path) => {
    const port = await getFreePort();
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", createHealthLayer(), {
        startBackgroundServices: false,
      }),
    );

    try {
      const response = await requestGet(port, path);
      const body = JSON.parse(response.body) as {
        status?: number;
        error?: string;
        message?: string;
        issues?: Array<{ path?: string[]; message?: string; code?: string }>;
        requestId?: string;
      };

      expect(response.statusCode).toBe(400);
      expect(response.headers["content-type"]).toContain("application/json");
      expect(body).toMatchObject({
        status: 400,
        error: "Validation Error",
        message: "Invalid document ID",
        issues: [{ path: ["docId"], message: "Invalid document ID", code: "invalid_value" }],
      });
      expect(body.requestId).toEqual(expect.any(String));
    } finally {
      shutdown();
    }
  });

  it("serves public Prometheus metrics", async () => {
    process.env["PAPERLESS_LLM_API_TOKEN"] = "secret";
    const port = await getFreePort();
    const layer = Layer.succeed(ConfigService, {
      config: {
        http: {
          rateLimitEnabled: true,
          rateLimitWindowMs: 60_000,
          rateLimitMaxRequests: 1,
          rateLimitTrustProxy: false,
        },
      },
    } as unknown as ConfigService);
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );

    try {
      const response = await requestGet(port, "/metrics");
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.body).toContain("# TYPE paperless_llm_http_requests_total counter");
    } finally {
      await shutdown();
    }
  });

  it("includes default local and Portless CORS origins outside production", () => {
    delete process.env["NODE_ENV"];
    delete process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"];
    delete process.env["CORS_ORIGINS"];

    expect([...getTrustedUiOrigins()]).toEqual(
      expect.arrayContaining([
        "https://paperless-llm-web.localhost:1355",
        "http://localhost:3765",
        "http://127.0.0.1:3765",
      ]),
    );
  });

  it("combines documented and legacy env-configured trusted CORS origins", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"] = "https://paperless.example";
    process.env["CORS_ORIGINS"] = "http://localhost:3765, http://127.0.0.1:3765";

    expect(getTrustedUiOrigins()).toEqual(
      new Set(["https://paperless.example", "http://localhost:3765", "http://127.0.0.1:3765"]),
    );
  });

  it("does not include default local CORS origins in production", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"];
    delete process.env["CORS_ORIGINS"];

    expect(getTrustedUiOrigins()).toEqual(new Set());
  });

  it("redacts sensitive headers before logging", () => {
    expect(
      sanitizeHeadersForLog({
        authorization: "Bearer secret",
        "x-api-key": "secret",
        cookie: "session=secret",
        host: "localhost",
      }),
    ).toEqual({
      authorization: "***",
      "x-api-key": "***",
      cookie: "***",
      host: "localhost",
    });
  });

  it("detects production read-only mode from explicit truthy env values", () => {
    process.env["PAPERLESS_LLM_PROD_READ_ONLY"] = "true";
    expect(isProdReadOnlyMode()).toBe(true);

    process.env["PAPERLESS_LLM_PROD_READ_ONLY"] = "0";
    process.env["PAPERLESS_LLM_READ_ONLY"] = "on";
    expect(isProdReadOnlyMode()).toBe(true);
  });

  it("allows only safe reads and connection tests in read-only mode", () => {
    expect(isReadOnlyRequestAllowed("GET", "/api/documents/123")).toBe(true);
    expect(isReadOnlyRequestAllowed("HEAD", "/health")).toBe(true);
    expect(isReadOnlyRequestAllowed("OPTIONS", "/api/documents/123")).toBe(true);
    expect(isReadOnlyRequestAllowed("POST", "/api/settings/test-connection/paperless")).toBe(true);
    expect(isReadOnlyRequestAllowed("POST", "/api/settings/test-connection/ollama")).toBe(true);
    expect(isReadOnlyRequestAllowed("POST", "/api/settings/test-connection/mistral")).toBe(true);
    expect(isReadOnlyRequestAllowed("POST", "/api/settings/test-connection/qdrant")).toBe(false);

    expect(isReadOnlyRequestAllowed("GET", "/api/processing/123/stream")).toBe(false);
    expect(isReadOnlyRequestAllowed("GET", "/api/cases/document/123/stream")).toBe(false);
    expect(isReadOnlyRequestAllowed("GET", "/api/settings/check-import")).toBe(false);
    expect(isReadOnlyRequestAllowed("POST", "/api/processing/123")).toBe(false);
    expect(isReadOnlyRequestAllowed("POST", "/api/processing/123/cancel")).toBe(false);
    expect(isReadOnlyRequestAllowed("POST", "/api/processing/123/release-lock")).toBe(false);
    expect(isReadOnlyRequestAllowed("POST", "/api/processing/locks/prune")).toBe(false);
    expect(isReadOnlyRequestAllowed("PATCH", "/api/settings")).toBe(false);
    expect(isReadOnlyRequestAllowed("DELETE", "/api/tags/123")).toBe(false);
  });

  it("serves API docs in development", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["PAPERLESS_LLM_CONFIG"] = "/tmp/paperless-llm-test-missing-config.yaml";
    const port = await getFreePort();
    const cleanup = await Effect.runPromise(createHttpServer(port));

    try {
      const response = await requestGet(port, "/api/docs");

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("/openapi.json");
    } finally {
      cleanup();
    }
  });

  it("gates API docs in production unless explicitly enabled", () => {
    process.env["NODE_ENV"] = "production";
    delete process.env["PAPERLESS_LLM_ENABLE_API_DOCS"];
    expect(isApiDocsEnabled()).toBe(false);

    process.env["PAPERLESS_LLM_ENABLE_API_DOCS"] = "true";
    expect(isApiDocsEnabled()).toBe(true);
  });

  it("returns structured HTTP 400 JSON for invalid request bodies", async () => {
    process.env["PAPERLESS_LLM_CONFIG"] = "/tmp/paperless-llm-test-missing-config.yaml";
    const port = await getFreePort();
    const cleanup = await Effect.runPromise(createHttpServer(port));

    try {
      const response = await requestJson(port, "/api/pending/bulk", {
        ids: "not-an-array",
        action: "approve",
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toMatchObject({
        status: 400,
        error: "Validation Error",
      });
      expect((response.body as { issues?: unknown }).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: expect.arrayContaining(["ids"]) }),
        ]),
      );
    } finally {
      cleanup();
    }
  });
});

describe("rate limiting helpers", () => {
  const config = {
    rateLimitEnabled: true,
    rateLimitWindowMs: 1000,
    rateLimitMaxRequests: 2,
    rateLimitTrustProxy: false,
  };

  it("allows max requests and rejects the next request", () => {
    let now = 1000;
    const limit = createRateLimiter(config, () => now);

    expect(limit("1.2.3.4")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limit("1.2.3.4")).toMatchObject({ allowed: true, remaining: 0 });
    expect(limit("1.2.3.4")).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
    });

    now = 1500;
    expect(limit("1.2.3.4")).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
  });

  it("resets after the configured window", () => {
    let now = 1000;
    const limit = createRateLimiter(config, () => now);

    limit("1.2.3.4");
    limit("1.2.3.4");
    expect(limit("1.2.3.4").allowed).toBe(false);

    now = 2000;
    expect(limit("1.2.3.4")).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("tracks separate clients independently", () => {
    const limit = createRateLimiter(config, () => 1000);

    limit("1.2.3.4");
    limit("1.2.3.4");

    expect(limit("5.6.7.8")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limit("1.2.3.4").allowed).toBe(false);
  });

  it("allows unlimited requests when disabled", () => {
    const limit = createRateLimiter({ ...config, rateLimitEnabled: false }, () => 1000);

    expect(Array.from({ length: 5 }, () => limit("1.2.3.4").allowed)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("uses socket addresses unless proxy headers are explicitly trusted", () => {
    const req = makeRequest(
      { "x-forwarded-for": "203.0.113.10, 198.51.100.2", "x-real-ip": "203.0.113.11" },
      "::ffff:10.0.0.5",
    );

    expect(getClientIp(req, false)).toBe("10.0.0.5");
    expect(getClientIp(req, true)).toBe("203.0.113.10");
  });

  it("falls back to x-real-ip when trusted forwarded-for is absent", () => {
    expect(getClientIp(makeRequest({ "x-real-ip": "203.0.113.11" }, "10.0.0.5"), true)).toBe(
      "203.0.113.11",
    );
  });

  it("bypasses OPTIONS preflight and health checks", () => {
    expect(shouldBypassRateLimit("OPTIONS", "/api/documents")).toBe(true);
    expect(shouldBypassRateLimit("GET", "/health")).toBe(true);
    expect(shouldBypassRateLimit("GET", "/api/documents")).toBe(false);
  });

  it("returns default local and configured CORS origins on preflight", async () => {
    delete process.env["NODE_ENV"];
    delete process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"];
    delete process.env["CORS_ORIGINS"];
    const port = await getFreePort();
    const layer = Layer.succeed(ConfigService, {
      config: { http: { ...config } },
    } as unknown as ConfigService);
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );

    try {
      const defaultResponse = await requestOptions(
        port,
        "/api/documents",
        "https://paperless-llm-web.localhost:1355",
      );
      expect(defaultResponse.statusCode).toBe(204);
      expect(defaultResponse.headers["access-control-allow-origin"]).toBe(
        "https://paperless-llm-web.localhost:1355",
      );
    } finally {
      shutdown();
    }

    process.env["PAPERLESS_LLM_TRUSTED_UI_ORIGINS"] = "https://paperless.example";
    const configuredPort = await getFreePort();
    const configuredShutdown = await Effect.runPromise(
      createHttpServerWithLayer(configuredPort, "127.0.0.1", layer, {
        startBackgroundServices: false,
      }),
    );

    try {
      const configuredResponse = await requestOptions(
        configuredPort,
        "/api/documents",
        "https://paperless.example",
      );
      expect(configuredResponse.statusCode).toBe(204);
      expect(configuredResponse.headers["access-control-allow-origin"]).toBe(
        "https://paperless.example",
      );
    } finally {
      configuredShutdown();
    }
  });

  it("returns structured HTTP 429 responses before route dispatch", async () => {
    const port = await getFreePort();
    const layer = Layer.succeed(ConfigService, {
      config: { http: { ...config, rateLimitMaxRequests: 1 } },
    } as unknown as ConfigService);
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );

    try {
      await requestJson(port, "/api/pending/bulk", { ids: [], action: "approve" });
      const response = await requestJson(port, "/api/pending/bulk", { ids: [], action: "approve" });

      expect(response.statusCode).toBe(429);
      expect(response.body).toMatchObject({
        status: 429,
        error: "Too Many Requests",
        requestId: expect.any(String),
      });
    } finally {
      shutdown();
    }
  });
});

describe("health HTTP responses", () => {
  it("returns HTTP 200 when all dependencies are up", async () => {
    const port = await getFreePort();
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", createHealthLayer(), {
        startBackgroundServices: false,
      }),
    );

    try {
      const response = await requestGet(port, "/health");
      const body = JSON.parse(response.body) as { status: number; health: string };

      expect(response.statusCode).toBe(200);
      expect(body).toMatchObject({ status: 200, health: "healthy" });
    } finally {
      shutdown();
    }
  });

  it("records traced HTTP status and error outcome after handler conversion", async () => {
    clearMemoryTraceSpans();
    const port = await getFreePort();
    const layer = Layer.mergeAll(
      createHealthLayer({ ollama: () => Effect.succeed(false) }),
      makeTracingLayer({
        enabled: true,
        sink: "memory",
        serviceName: "test",
        exportIntervalMs: 1000,
      }),
    );
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );

    try {
      const response = await requestGet(port, "/health");
      expect(response.statusCode).toBe(503);
      const span = getMemoryTraceSpans().find((entry) => entry.name === "http.request");
      expect(span?.attributes).toMatchObject({
        "http.response.status_code": 503,
        "http.response.outcome": "error",
      });
    } finally {
      shutdown();
    }
  });

  it("returns HTTP 503 when a dependency is down", async () => {
    const port = await getFreePort();
    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(
        port,
        "127.0.0.1",
        createHealthLayer({ ollama: () => Effect.succeed(false) }),
        { startBackgroundServices: false },
      ),
    );

    try {
      const response = await requestGet(port, "/health");
      const body = JSON.parse(response.body) as { status: number; health: string };

      expect(response.statusCode).toBe(503);
      expect(body).toMatchObject({ status: 503, health: "unhealthy" });
    } finally {
      shutdown();
    }
  });
});

describe("SSE close helpers", () => {
  it("resolves abortable delays promptly when the close signal aborts", async () => {
    const controller = new AbortController();
    const delayPromise = abortableDelay(10_000, controller.signal);

    controller.abort();

    await expect(
      Promise.race([delayPromise, abortableDelay(100).then(() => "timeout")]),
    ).resolves.toBeUndefined();
  });

  it("interrupts running effects when the close signal aborts", async () => {
    const controller = new AbortController();
    let finalized = false;
    const running = runEffectWithAbort(
      Runtime.defaultRuntime,
      Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
      controller.signal,
    ).catch(() => undefined);

    controller.abort();

    await vi.waitFor(() => expect(finalized).toBe(true));
    await running;
  });
});

describe("processing SSE", () => {
  it("uses TagCacheService for full=true streams instead of processDocumentStream", async () => {
    const port = await getFreePort();
    const doc = (tags: number[]): Document =>
      ({ id: 123, title: "Test document", tags }) as unknown as Document;
    const getDocument = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed(doc([1])))
      .mockReturnValueOnce(Effect.succeed(doc([2])));
    const getTags = vi.fn(() =>
      Effect.succeed({ source: "fresh" as const, tags: [{ id: 1, name: "todo", slug: "todo" }] }),
    );
    const refresh = vi.fn(() =>
      Effect.succeed({ source: "fresh" as const, tags: [{ id: 2, name: "done", slug: "done" }] }),
    );
    const processDocumentStream = vi.fn(() => Stream.empty);
    const processStepStream = vi.fn(() =>
      Stream.make({
        type: "step_complete" as const,
        docId: 123,
        step: "ocr",
        message: "done",
        timestamp: new Date().toISOString(),
      }),
    );
    const config = {
      tags: {
        todo: "todo",
        ocr: "ocr",
        metadata: "metadata",
        review: "review",
        index: "index",
        done: "done",
        failed: "failed",
        pending: "todo",
        ocrDone: "ocr-done",
        summaryDone: "summary-done",
        schemaReview: "schema-review",
        titleDone: "title-done",
        correspondentDone: "correspondent-done",
        documentTypeDone: "document-type-done",
        tagsDone: "tags-done",
        processed: "processed",
        manualReview: "manual-review",
      },
      pipeline: { maxSteps: 10 },
    };
    const layer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      Layer.succeed(PaperlessService, { getDocument } as unknown as PaperlessService),
      Layer.succeed(TagCacheService, { getTags, refresh, invalidate: vi.fn(), peek: vi.fn() }),
      Layer.succeed(ConfigService, { config } as unknown as ConfigService),
      Layer.succeed(ProcessingPipelineService, {
        processDocument: vi.fn(),
        processDocumentStream,
        processStep: vi.fn(),
        processStepStream,
        getCurrentState: vi.fn(),
      } as unknown as ProcessingPipelineService),
    );

    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );
    try {
      const response = await requestSse(port, "/api/processing/123/stream?full=true");

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('"type":"pipeline_start"');
      expect(response.body).toContain('"type":"pipeline_complete"');
      expect(getTags).toHaveBeenCalledTimes(1);
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(processStepStream).toHaveBeenCalledWith(123, "ocr", false);
      expect(processDocumentStream).not.toHaveBeenCalled();
    } finally {
      shutdown();
    }
  });

  it("uses configured max step limit for full=true streams", async () => {
    const port = await getFreePort();
    const doc = (tags: number[]): Document =>
      ({ id: 123, title: "Looping document", tags }) as unknown as Document;
    const getDocument = vi.fn(() => Effect.succeed(doc([1])));
    const tags = [{ id: 1, name: "todo", slug: "todo" }];
    const getTags = vi.fn(() => Effect.succeed({ source: "fresh" as const, tags }));
    const refresh = vi.fn(() => Effect.succeed({ source: "fresh" as const, tags }));
    const processStepStream = vi.fn(() =>
      Stream.make({
        type: "step_complete" as const,
        docId: 123,
        step: "ocr",
        message: "done",
        timestamp: new Date().toISOString(),
      }),
    );
    const config = {
      tags: {
        todo: "todo",
        ocr: "ocr",
        metadata: "metadata",
        review: "review",
        index: "index",
        done: "done",
        failed: "failed",
        pending: "todo",
        ocrDone: "ocr-done",
        summaryDone: "summary-done",
        schemaReview: "schema-review",
        titleDone: "title-done",
        correspondentDone: "correspondent-done",
        documentTypeDone: "document-type-done",
        tagsDone: "tags-done",
        processed: "processed",
        manualReview: "manual-review",
      },
      pipeline: { maxSteps: 1 },
    };
    const layer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      Layer.succeed(PaperlessService, { getDocument } as unknown as PaperlessService),
      Layer.succeed(TagCacheService, { getTags, refresh, invalidate: vi.fn(), peek: vi.fn() }),
      Layer.succeed(ConfigService, { config } as unknown as ConfigService),
      Layer.succeed(ProcessingPipelineService, {
        processDocument: vi.fn(),
        processDocumentStream: vi.fn(() => Stream.empty),
        processStep: vi.fn(),
        processStepStream,
        getCurrentState: vi.fn(),
      } as unknown as ProcessingPipelineService),
    );

    const shutdown = await Effect.runPromise(
      createHttpServerWithLayer(port, "127.0.0.1", layer, { startBackgroundServices: false }),
    );
    try {
      const response = await requestSse(port, "/api/processing/123/stream?full=true");

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain(
        "Pipeline exceeded maximum step count - possible infinite loop",
      );
      expect(processStepStream).toHaveBeenCalledTimes(1);
    } finally {
      shutdown();
    }
  });
});
