import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { ConcurrencyLimitServiceLive } from "../../src/services/ConcurrencyLimitService.js";
import { metricsRegistry } from "../../src/services/MetricsService.js";
import { MistralService, MistralServiceLive } from "../../src/services/MistralService.js";
import { TinyBaseService } from "../../src/services/TinyBaseService.js";

const createConfigLayer = (overrides: { requestTimeoutMs?: number; retryAttempts?: number } = {}) =>
  Layer.succeed(ConfigService, {
    config: {
      mistral: {
        apiKey: "test-key",
        model: "mistral-large-latest",
        apiBaseUrl: "http://mistral.test",
      },
      http: {
        requestTimeoutMs: overrides.requestTimeoutMs ?? 1_000,
        agentPromptTimeoutMs: 1_000,
        mistralRetryAttempts: overrides.retryAttempts ?? 3,
        mistralRetryBaseDelayMs: 1,
      },
      concurrency: {
        ollamaMaxConcurrent: 1,
        mistralMaxConcurrent: 1,
        ocrMaxConcurrent: 1,
      },
    },
  } as unknown as ConfigService);

const createTinyBaseLayer = () =>
  Layer.succeed(TinyBaseService, {
    getAllSettings: vi.fn(() => Effect.succeed({})),
  } as unknown as TinyBaseService);

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("MistralService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    metricsRegistry.reset();
  });

  it("retries transient Mistral failures", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: "mistral-large-latest", object: "model", created: 0, owned_by: "mistral" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const TestLayer = Layer.provideMerge(
      MistralServiceLive,
      Layer.mergeAll(
        createConfigLayer(),
        createTinyBaseLayer(),
        Layer.provide(ConcurrencyLimitServiceLive, createConfigLayer()),
      ),
    );

    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const mistral = yield* MistralService;
        return yield* mistral.listModels();
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(models).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const renderedMetrics = metricsRegistry.render();
    expect(renderedMetrics).toContain(
      'paperless_llm_retries_total{component="mistral",operation="list_models",reason="http_500"} 1',
    );
    expect(renderedMetrics).toContain(
      'paperless_llm_llm_request_duration_seconds_count{provider="mistral",operation="list_models",model="unknown",outcome="success"} 1',
    );
  });

  it("serializes Mistral requests when the global cap is 1", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const TestLayer = Layer.provideMerge(
      MistralServiceLive,
      Layer.mergeAll(
        createConfigLayer(),
        createTinyBaseLayer(),
        Layer.provide(ConcurrencyLimitServiceLive, createConfigLayer()),
      ),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const mistral = yield* MistralService;
        const first = yield* Effect.fork(mistral.listModels());
        yield* Effect.promise(sleep);
        const second = yield* Effect.fork(mistral.listModels());
        yield* Effect.promise(sleep);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolvers[0]?.(
          Response.json({
            data: [{ id: "first", object: "model", created: 0, owned_by: "mistral" }],
          }),
        );
        yield* Effect.fromFiber(first);
        yield* Effect.promise(sleep);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        resolvers[1]?.(
          Response.json({
            data: [{ id: "second", object: "model", created: 0, owned_by: "mistral" }],
          }),
        );
        yield* Effect.fromFiber(second);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  it("returns document text with token usage metadata", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          model: "mistral-large-latest",
          choices: [{ message: { content: "OCR text" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const configLayer = createConfigLayer({ retryAttempts: 1 });
    const TestLayer = Layer.provideMerge(
      MistralServiceLive,
      Layer.mergeAll(
        configLayer,
        createTinyBaseLayer(),
        Layer.provide(ConcurrencyLimitServiceLive, configLayer),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const mistral = yield* MistralService;
        return yield* mistral.processDocumentWithUsage("pdf", "prompt");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.text).toBe("OCR text");
    expect(result.usage?.total_tokens).toBe(15);
  });

  it("fails hanging Mistral endpoints within the configured timeout", async () => {
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const configLayer = createConfigLayer({ requestTimeoutMs: 5, retryAttempts: 1 });
    const TestLayer = Layer.provideMerge(
      MistralServiceLive,
      Layer.mergeAll(
        configLayer,
        createTinyBaseLayer(),
        Layer.provide(ConcurrencyLimitServiceLive, configLayer),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const mistral = yield* MistralService;
        return yield* Effect.either(mistral.listModels());
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("timed out");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
