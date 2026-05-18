import {
  createAssistantMessageEventStream,
  streamSimple,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context as PiContext,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { Effect } from "effect";
import type { ConcurrencyLimitService } from "../services/index.js";
import { fetchWithTimeout, normalizeBaseUrl } from "../utils/http.js";

export const DEFAULT_OLLAMA_CONTEXT_WINDOW = 32_000;
export const DEFAULT_OLLAMA_MAX_TOKENS = 4_096;
export const DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
export const DEFAULT_PROMPT_WATCHDOG_CHECK_INTERVAL_MS = 15_000;
export const DEFAULT_OLLAMA_RUNNING_CHECK_TIMEOUT_MS = 2_000;

export interface OllamaRunningModelLike {
  name?: string;
  model?: string;
}

export interface PromptActivityWatchdogController {
  markActivity: (reason: string) => void;
}

export interface PromptActivityWatchdogStatus {
  elapsedMs: number;
  idleMs: number;
  stillRunning: boolean;
  lastActivityReason: string;
  checkError?: unknown;
}

export interface PromptActivityWatchdogOptions {
  label: string;
  timeoutMs: number;
  checkIntervalMs?: number;
  checkStillRunning?: () => Promise<boolean>;
  abort?: () => void;
  onHeartbeat?: (status: PromptActivityWatchdogStatus) => void | Promise<void>;
}

export class PromptIdleTimeoutError extends Error {
  readonly timeoutMs: number;
  readonly idleMs: number;
  readonly elapsedMs: number;
  readonly lastActivityReason: string;

  constructor(label: string, timeoutMs: number, status: PromptActivityWatchdogStatus) {
    super(
      `${label} idle timed out after ${timeoutMs}ms without active prompt or Ollama activity; last activity: ${status.lastActivityReason}`,
    );
    this.name = "PromptIdleTimeoutError";
    this.timeoutMs = timeoutMs;
    this.idleMs = status.idleMs;
    this.elapsedMs = status.elapsedMs;
    this.lastActivityReason = status.lastActivityReason;
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeModelId = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.includes(":") ? trimmed : `${trimmed}:latest`;
};

export const isOllamaModelRunning = (
  runningModels: readonly OllamaRunningModelLike[],
  modelId: string,
): boolean => {
  const target = normalizeModelId(modelId);
  if (!target) return false;
  return runningModels.some((entry) => {
    const candidates = [entry.model, entry.name]
      .filter((value): value is string => typeof value === "string")
      .map(normalizeModelId);
    return candidates.includes(target);
  });
};

export const checkOllamaModelRunning = async (
  ollamaUrl: string,
  modelId: string,
  timeoutMs = DEFAULT_OLLAMA_RUNNING_CHECK_TIMEOUT_MS,
): Promise<boolean> => {
  const response = await fetchWithTimeout(
    `${normalizeBaseUrl(ollamaUrl)}/api/ps`,
    { method: "GET" },
    timeoutMs,
  );
  if (!response.ok) return false;
  const payload = (await response.json()) as { models?: OllamaRunningModelLike[] };
  return isOllamaModelRunning(payload.models ?? [], modelId);
};

const resolveWatchdogCheckIntervalMs = (timeoutMs: number, configured?: number): number => {
  if (Number.isFinite(configured) && configured && configured > 0) {
    return Math.max(1, Math.trunc(configured));
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_PROMPT_WATCHDOG_CHECK_INTERVAL_MS;
  }
  return Math.max(
    1_000,
    Math.min(DEFAULT_PROMPT_WATCHDOG_CHECK_INTERVAL_MS, Math.trunc(timeoutMs / 4)),
  );
};

export const runWithPromptActivityWatchdog = async <T>(
  run: (controller: PromptActivityWatchdogController) => Promise<T>,
  options: PromptActivityWatchdogOptions,
): Promise<T> => {
  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let lastActivityReason = "started";

  const markActivity = (reason: string) => {
    lastActivityAt = Date.now();
    lastActivityReason = reason;
  };

  const runPromise = Promise.resolve().then(() => run({ markActivity }));
  const watchedRun = runPromise.then(
    (value) => ({ type: "done" as const, value }),
    (error) => ({ type: "error" as const, error }),
  );
  const checkIntervalMs = resolveWatchdogCheckIntervalMs(
    options.timeoutMs,
    options.checkIntervalMs,
  );

  while (true) {
    const result = await Promise.race([
      watchedRun,
      sleep(checkIntervalMs).then(() => ({ type: "tick" as const })),
    ]);

    if (result.type === "done") {
      return result.value;
    }
    if (result.type === "error") {
      throw result.error;
    }

    let stillRunning = false;
    let checkError: unknown;
    if (options.checkStillRunning) {
      try {
        stillRunning = await options.checkStillRunning();
      } catch (error) {
        checkError = error;
      }
    }
    if (stillRunning) {
      markActivity("ollama_model_running");
    }

    const now = Date.now();
    const status: PromptActivityWatchdogStatus = {
      elapsedMs: now - startedAt,
      idleMs: now - lastActivityAt,
      stillRunning,
      lastActivityReason,
      ...(checkError ? { checkError } : {}),
    };
    await options.onHeartbeat?.(status);

    if (options.timeoutMs > 0 && status.idleMs >= options.timeoutMs) {
      options.abort?.();
      runPromise.catch(() => undefined);
      throw new PromptIdleTimeoutError(options.label, options.timeoutMs, status);
    }
  }
};

// This is Ollama's local OpenAI-compatible /v1 protocol, not the hosted OpenAI API.
export const buildOllamaModel = (url: string, modelId: string): Model<"openai-completions"> => ({
  id: modelId,
  name: modelId,
  provider: "ollama",
  api: "openai-completions",
  baseUrl: `${url.replace(/\/$/, "")}/v1`,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: DEFAULT_OLLAMA_CONTEXT_WINDOW,
  maxTokens: DEFAULT_OLLAMA_MAX_TOKENS,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
});

const makeStreamErrorMessage = (model: Model<Api>, error: unknown): AssistantMessage => ({
  role: "assistant",
  content: [],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "error",
  errorMessage: error instanceof Error ? error.message : String(error),
  timestamp: Date.now(),
});

export interface GatedOllamaStreamSimpleOptions {
  providerTimeoutMs?: number;
}

const resolveOllamaProviderTimeoutMs = (
  requestedTimeoutMs: number | undefined,
  configuredTimeoutMs: number | undefined,
): number => {
  const fallback = configuredTimeoutMs ?? DEFAULT_OLLAMA_PROVIDER_TIMEOUT_MS;
  if (requestedTimeoutMs === undefined) return fallback;
  return Math.max(requestedTimeoutMs, fallback);
};

export const makeGatedOllamaStreamSimple =
  (concurrency: ConcurrencyLimitService, streamOptions: GatedOllamaStreamSimpleOptions = {}) =>
  (
    model: Model<Api>,
    context: PiContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const output = createAssistantMessageEventStream();

    void Effect.runPromise(
      concurrency.withOllama(
        Effect.tryPromise({
          try: async () => {
            const source = streamSimple(model, context, {
              ...options,
              timeoutMs: resolveOllamaProviderTimeoutMs(
                options?.timeoutMs,
                streamOptions.providerTimeoutMs,
              ),
              maxRetries: options?.maxRetries ?? 0,
            });
            for await (const event of source) {
              output.push(event);
            }
            output.end(await source.result());
          },
          catch: (error) => error,
        }),
      ),
    ).catch((error) => {
      const message = makeStreamErrorMessage(model, error);
      output.push({ type: "error", reason: "error", error: message });
      output.end(message);
    });

    return output;
  };
