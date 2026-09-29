import { Effect, Layer, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { ConcurrencyLimitServiceLive } from "../../src/services/ConcurrencyLimitService.js";
import {
  type OllamaChatOptions,
  OllamaService,
  OllamaServiceLive,
} from "../../src/services/OllamaService.js";
import { TinyBaseService } from "../../src/services/TinyBaseService.js";

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

const createTinyBaseLayer = () =>
  Layer.succeed(TinyBaseService, {
    getAllSettings: vi.fn(() => Effect.succeed({})),
  } as unknown as TinyBaseService);

const createTestLayer = (requestTimeoutMs = 1_000) => {
  const configLayer = createConfigLayer(requestTimeoutMs);
  return Layer.provideMerge(
    OllamaServiceLive,
    Layer.mergeAll(
      configLayer,
      createTinyBaseLayer(),
      Layer.provide(ConcurrencyLimitServiceLive, configLayer),
    ),
  );
};

const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("OllamaService streams", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe.each(["chat", "generate"] as const)("%s streaming", (operation) => {
    const encodeChunk = (content: string, done = false) =>
      JSON.stringify(
        operation === "chat"
          ? { model: "llama", message: { role: "assistant", content }, done }
          : { response: content, done },
      );

    const collect = (options?: OllamaChatOptions) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const ollama = yield* OllamaService;
          const stream =
            operation === "chat"
              ? ollama
                  .chatStream("llama", [{ role: "user", content: "Hello" }], options)
                  .pipe(Stream.map((chunk) => chunk.message.content))
              : ollama.generateStream("llama", "Hello", options);
          return yield* Effect.either(Stream.runCollect(stream));
        }).pipe(Effect.provide(createTestLayer())),
      );

    const mockBody = (parts: Uint8Array[]) => {
      const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("decodes fragmented UTF-8, blank lines and an unterminated final chunk", async () => {
      const bytes = new TextEncoder().encode(
        ` \n${encodeChunk("Grüße")}\n\n${encodeChunk("!", true)}`,
      );
      const fetchMock = mockBody(Array.from(bytes, (byte) => Uint8Array.of(byte)));

      const result = await collect({ format: "json", think: false, temperature: 0, num_ctx: 4096 });

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(Array.from(result.right)).toEqual(["Grüße", "!"]);
      expect(fetchMock.mock.calls[0]?.[0]).toBe(`http://ollama.test/api/${operation}`);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body).toMatchObject({
        model: "llama",
        stream: true,
        format: "json",
        think: false,
        options: { temperature: 0, num_ctx: 4096 },
      });
      expect(body.options).not.toHaveProperty("format");
      expect(body.options).not.toHaveProperty("think");
      if (operation === "chat") {
        expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      } else {
        expect(body.prompt).toBe("Hello");
      }
    });

    it("stops on a done chunk before parsing additional data", async () => {
      mockBody([new TextEncoder().encode(`${encodeChunk("Done", true)}\n{invalid}\n`)]);

      const result = await collect();

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(Array.from(result.right)).toEqual(["Done"]);
    });

    it.each(["{invalid}\n", "{invalid}"])("fails malformed input %j", async (invalid) => {
      mockBody([new TextEncoder().encode(`${encodeChunk("First")}\n${invalid}`)]);

      const result = await collect();

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect(result.left.message).toContain("Malformed Ollama stream chunk");
        expect(result.left.model).toBe("llama");
        expect(result.left.cause).toMatchObject({ line: "{invalid}" });
      }
    });

    it("ends on EOF without a done chunk", async () => {
      mockBody([new TextEncoder().encode(`${encodeChunk("Last")}\n`)]);

      const result = await collect();

      expect(result._tag).toBe("Right");
      if (result._tag === "Right") expect(Array.from(result.right)).toEqual(["Last"]);
    });

    it.each([
      { status: 503, expected: "Ollama API error: 503" },
      { status: 200, expected: "No response body" },
    ])("propagates response errors: $expected", async ({ status, expected }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status })),
      );

      const result = await collect();

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") expect(result.left.message).toContain(expected);
    });
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
