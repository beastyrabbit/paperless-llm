import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context as PiContext,
  type Model,
} from "@earendil-works/pi-ai";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS,
  isOllamaModelRunning,
  makeGatedOllamaStreamSimple,
  PromptIdleTimeoutError,
  runWithPromptActivityWatchdog,
} from "../../src/agents/piOllamaModel.js";
import type { ConcurrencyLimitService } from "../../src/services/ConcurrencyLimitService.js";

const streamSimpleMock = vi.hoisted(() => vi.fn());

vi.mock("@earendil-works/pi-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-ai")>();
  return {
    ...actual,
    streamSimple: streamSimpleMock,
  };
});

const model: Model<Api> = {
  id: "llama3:test",
  name: "llama3:test",
  provider: "ollama",
  api: "openai-completions",
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
};

const context: PiContext = { messages: [] };

const makeMessage = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: Date.now(),
});

const makeConcurrency = () => {
  let active = 0;

  const withPermit = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.sync(() => {
      active += 1;
    }).pipe(
      Effect.zipRight(effect),
      Effect.ensuring(
        Effect.sync(() => {
          active -= 1;
        }),
      ),
    );

  return {
    service: {
      withOllama: withPermit,
      withMistral: (effect) => effect,
      withOcr: (effect) => effect,
    } satisfies ConcurrencyLimitService,
    active: () => active,
  };
};

const collectEvents = async (stream: AssistantMessageEventStream) => {
  const events = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("makeGatedOllamaStreamSimple", () => {
  beforeEach(() => {
    streamSimpleMock.mockReset();
  });

  it("emits an error event when streamSimple throws and releases the Ollama permit", async () => {
    const error = new Error("ollama unavailable");
    streamSimpleMock.mockImplementation(() => {
      throw error;
    });
    const concurrency = makeConcurrency();

    const stream = makeGatedOllamaStreamSimple(concurrency.service)(model, context);
    const events = await collectEvents(stream);
    const result = await stream.result();

    expect(events).toHaveLength(1);
    expect(streamSimpleMock).toHaveBeenCalledWith(
      model,
      context,
      expect.objectContaining({ timeoutMs: DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS }),
    );
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "error",
      error: {
        stopReason: "error",
        errorMessage: "ollama unavailable",
      },
    });
    expect(result).toMatchObject({ stopReason: "error", errorMessage: "ollama unavailable" });
    expect(concurrency.active()).toBe(0);
  });

  it("does not let Pi/OpenAI default request timeouts cap long local Ollama prompts", async () => {
    const source = createAssistantMessageEventStream();
    source.end(makeMessage("done"));
    streamSimpleMock.mockReturnValue(source);
    const concurrency = makeConcurrency();

    const stream = makeGatedOllamaStreamSimple(concurrency.service)(model, context, {
      timeoutMs: 15 * 60 * 1_000,
    });
    await collectEvents(stream);
    await stream.result();

    expect(streamSimpleMock).toHaveBeenCalledWith(
      model,
      context,
      expect.objectContaining({
        timeoutMs: DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS,
        maxRetries: 0,
      }),
    );
  });

  it("emits an error event when async iteration fails and releases the Ollama permit", async () => {
    const error = new Error("stream interrupted");
    streamSimpleMock.mockReturnValue({
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            throw error;
          },
        };
      },
      result: async () => makeMessage("unused"),
    } as unknown as AssistantMessageEventStream);
    const concurrency = makeConcurrency();

    const stream = makeGatedOllamaStreamSimple(concurrency.service)(model, context);
    const events = await collectEvents(stream);
    const result = await stream.result();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "error",
      error: {
        stopReason: "error",
        errorMessage: "stream interrupted",
      },
    });
    expect(result).toMatchObject({ stopReason: "error", errorMessage: "stream interrupted" });
    expect(concurrency.active()).toBe(0);
  });

  it("emits an error event when the source result fails and releases the Ollama permit", async () => {
    const error = new Error("missing final result");
    const source = createAssistantMessageEventStream();
    source.end(makeMessage("done"));
    vi.spyOn(source, "result").mockRejectedValue(error);
    streamSimpleMock.mockReturnValue(source);
    const concurrency = makeConcurrency();

    const stream = makeGatedOllamaStreamSimple(concurrency.service)(model, context);
    const events = await collectEvents(stream);
    const result = await stream.result();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "error",
      reason: "error",
      error: {
        stopReason: "error",
        errorMessage: "missing final result",
      },
    });
    expect(result).toMatchObject({ stopReason: "error", errorMessage: "missing final result" });
    expect(concurrency.active()).toBe(0);
  });
});

describe("prompt activity watchdog", () => {
  it("keeps a slow prompt alive while Ollama still reports the model as running", async () => {
    const abort = vi.fn();

    await expect(
      runWithPromptActivityWatchdog(
        async () => {
          await wait(20);
          return "done";
        },
        {
          label: "Test prompt",
          timeoutMs: 5,
          checkIntervalMs: 1,
          checkStillRunning: async () => true,
          abort,
        },
      ),
    ).resolves.toBe("done");

    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts when there is no prompt activity and Ollama is not running the model", async () => {
    const abort = vi.fn();

    await expect(
      runWithPromptActivityWatchdog(() => new Promise<never>(() => undefined), {
        label: "Test prompt",
        timeoutMs: 5,
        checkIntervalMs: 1,
        checkStillRunning: async () => false,
        abort,
      }),
    ).rejects.toBeInstanceOf(PromptIdleTimeoutError);

    expect(abort).toHaveBeenCalledOnce();
  });

  it("matches Ollama running models by explicit and implicit latest tags", () => {
    expect(
      isOllamaModelRunning([{ name: "gpt-oss:120b", model: "gpt-oss:120b" }], "gpt-oss:120b"),
    ).toBe(true);
    expect(
      isOllamaModelRunning([{ name: "llama3:latest", model: "llama3:latest" }], "llama3"),
    ).toBe(true);
    expect(isOllamaModelRunning([{ name: "llama3:8b", model: "llama3:8b" }], "gpt-oss:120b")).toBe(
      false,
    );
  });
});
