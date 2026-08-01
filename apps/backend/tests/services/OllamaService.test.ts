import { Effect, Layer, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { ConcurrencyLimitServiceLive } from "../../src/services/ConcurrencyLimitService.js";
import { OllamaService, OllamaServiceLive } from "../../src/services/OllamaService.js";

const createConfigLayer = (requestTimeoutMs = 1_000) =>
  Layer.succeed(ConfigService, {
    config: {
      ollama: {
        url: "http://ollama.test",
        model: "llama",
        embeddingModel: "nomic-embed-text",
      },
      http: {
        requestTimeoutMs,
      },
      concurrency: {
        ollamaMaxConcurrent: 1,
        mistralMaxConcurrent: 1,
        ocrMaxConcurrent: 1,
      },
    },
  } as unknown as ConfigService);

const createTestLayer = (requestTimeoutMs = 1_000) => {
  const configLayer = createConfigLayer(requestTimeoutMs);
  return Layer.provideMerge(
    OllamaServiceLive,
    Layer.mergeAll(configLayer, Layer.provide(ConcurrencyLimitServiceLive, configLayer)),
  );
};

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OllamaService streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails chat streams on malformed JSON chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const body = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{not-json}\n"));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      }),
    );

    const TestLayer = createTestLayer();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        return yield* Effect.either(Stream.runCollect(ollama.chatStream("llama", [])));
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Malformed Ollama stream chunk");
    }
  });

  it("fails hanging Ollama endpoints within the configured timeout", async () => {
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

    const TestLayer = createTestLayer(5);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        return yield* Effect.either(ollama.listModels());
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("timed out");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serializes non-stream Ollama requests when the global cap is 1", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const TestLayer = createTestLayer();
    await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        const first = yield* Effect.fork(ollama.listModels());
        yield* Effect.promise(sleep);
        const second = yield* Effect.fork(ollama.listModels());
        yield* Effect.promise(sleep);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        resolvers[0]?.(Response.json({ models: [] }));
        yield* Effect.fromFiber(first);
        yield* Effect.promise(sleep);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        resolvers[1]?.(Response.json({ models: [] }));
        yield* Effect.fromFiber(second);
      }).pipe(Effect.provide(TestLayer)),
    );
  });

  it("sends chat response format as a top-level Ollama field", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        model: "llama",
        message: { role: "assistant", content: "{}" },
        done: true,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const TestLayer = createTestLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        return yield* ollama.chat("llama", [], {
          format: "json",
          temperature: 0,
          num_ctx: 32_000,
          think: false,
        });
      }).pipe(Effect.provide(TestLayer)),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const requestOptions = body.options as Record<string, unknown>;
    expect(body.format).toBe("json");
    expect(body.think).toBe(false);
    expect(requestOptions).toMatchObject({ temperature: 0 });
    expect(requestOptions).toMatchObject({ num_ctx: 32_000 });
    expect(requestOptions).not.toHaveProperty("format");
  });

  it("sends generate schema response format as a top-level Ollama field", async () => {
    const schemaFormat = {
      type: "object",
      properties: { confirmed: { type: "boolean" } },
      required: ["confirmed"],
    };
    const fetchMock = vi.fn(async () => Response.json({ response: "{}" }));
    vi.stubGlobal("fetch", fetchMock);

    const TestLayer = createTestLayer();

    await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        return yield* ollama.generate("llama", "Return JSON", { format: schemaFormat });
      }).pipe(Effect.provide(TestLayer)),
    );

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    const requestOptions = body.options as Record<string, unknown>;
    expect(body.format).toEqual(schemaFormat);
    expect(requestOptions).not.toHaveProperty("format");
  });

  it("uses one configured model for generation", async () => {
    const TestLayer = createTestLayer();

    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const ollama = yield* OllamaService;
        return {
          generation: ollama.getModel("generation"),
          embedding: ollama.getModel("embedding"),
        };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(models).toEqual({
      generation: "llama",
      embedding: "nomic-embed-text",
    });
  });
});
