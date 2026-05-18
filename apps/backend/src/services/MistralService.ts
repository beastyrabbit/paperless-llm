/**
 * Mistral AI service for OCR and vision tasks.
 */
import { Context, Effect, Layer, pipe } from "effect";
import { ConfigService } from "../config/index.js";
import { MistralError } from "../errors/index.js";
import { withClientSpan } from "../observability/tracing.js";
import {
  fetchWithTimeout,
  getRetryAfterMs,
  isTransientHttpStatus,
  normalizeBaseUrl,
} from "../utils/http.js";
import { ConcurrencyLimitService } from "./ConcurrencyLimitService.js";
import {
  classifyMetricsErrorOutcome,
  metricReasonFromError,
  metrics,
  observeDuration,
} from "./MetricsService.js";
import { TinyBaseService } from "./TinyBaseService.js";

// ===========================================================================
// Types
// ===========================================================================

export interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface MistralChatMessage {
  role: "system" | "user" | "assistant";
  content: string | MistralContent[];
}

export interface MistralContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface MistralChatOptions {
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
}

export interface MistralChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface MistralDocumentResult {
  readonly text: string;
  readonly usage?: MistralChatResponse["usage"];
  readonly model: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface MistralService {
  readonly listModels: () => Effect.Effect<MistralModel[], MistralError>;
  readonly chat: (
    messages: MistralChatMessage[],
    options?: MistralChatOptions,
  ) => Effect.Effect<string, MistralError>;
  readonly processImage: (
    imageBase64: string,
    prompt: string,
    options?: MistralChatOptions,
  ) => Effect.Effect<string, MistralError>;
  readonly processDocument: (
    pdfBase64: string,
    prompt: string,
    options?: MistralChatOptions,
  ) => Effect.Effect<string, MistralError>;
  readonly processDocumentWithUsage: (
    pdfBase64: string,
    prompt: string,
    options?: MistralChatOptions,
  ) => Effect.Effect<MistralDocumentResult, MistralError>;
  readonly testConnection: () => Effect.Effect<boolean, MistralError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const MistralService = Context.GenericTag<MistralService>("MistralService");

// ===========================================================================
// Live Implementation
// ===========================================================================

export const MistralServiceLive = Layer.effect(
  MistralService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const concurrency = yield* ConcurrencyLimitService;
    const { mistral: configMistral } = configService.config;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<
      {
        apiKey: string;
        model: string;
        apiBaseUrl: string;
        requestTimeoutMs: number;
        retryAttempts: number;
        retryBaseDelayMs: number;
      },
      never
    > =>
      pipe(
        tinybaseService.getAllSettings(),
        Effect.map((dbSettings) => ({
          apiKey: dbSettings["mistral.api_key"] ?? configMistral.apiKey,
          model: dbSettings["mistral.model"] ?? configMistral.model,
          apiBaseUrl: normalizeBaseUrl(
            dbSettings["mistral.api_base_url"] ??
              dbSettings["mistral.apiBaseUrl"] ??
              configMistral.apiBaseUrl ??
              "https://api.mistral.ai",
          ),
          requestTimeoutMs: configService.config.http?.requestTimeoutMs ?? 120_000,
          retryAttempts: Math.max(1, configService.config.http?.mistralRetryAttempts ?? 3),
          retryBaseDelayMs: Math.max(
            1,
            configService.config.http?.mistralRetryBaseDelayMs ?? 5_000,
          ),
        })),
        Effect.catchAll(() =>
          Effect.succeed({
            apiKey: configMistral.apiKey,
            model: configMistral.model,
            apiBaseUrl: normalizeBaseUrl(configMistral.apiBaseUrl ?? "https://api.mistral.ai"),
            requestTimeoutMs: configService.config.http?.requestTimeoutMs ?? 120_000,
            retryAttempts: Math.max(1, configService.config.http?.mistralRetryAttempts ?? 3),
            retryBaseDelayMs: Math.max(
              1,
              configService.config.http?.mistralRetryBaseDelayMs ?? 5_000,
            ),
          }),
        ),
      );

    const isRetryableMistralError = (error: MistralError): boolean =>
      error.statusCode === undefined || isTransientHttpStatus(error.statusCode);

    // Helper for making requests - reads config dynamically
    const request = <T>(
      method: string,
      path: string,
      body: unknown,
      operation: "list_models" | "chat" | "image" | "document",
      modelLabel = "unknown",
    ): Effect.Effect<T, MistralError> =>
      pipe(
        Effect.gen(function* () {
          const startedAt = Date.now();
          const { apiKey, apiBaseUrl, requestTimeoutMs, retryAttempts, retryBaseDelayMs } =
            yield* getConfig();

          if (!apiKey) {
            return yield* Effect.fail(
              new MistralError({
                message: "Mistral API key not configured",
              }),
            );
          }

          const requestOnce = Effect.tryPromise({
            try: async () => {
              const response = await fetchWithTimeout(
                `${apiBaseUrl}${path}`,
                {
                  method,
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                  },
                  body: body ? JSON.stringify(body) : undefined,
                },
                requestTimeoutMs,
              );

              if (!response.ok) {
                const text = await response.text();
                throw new MistralError({
                  message: `Mistral API error: ${response.status} ${text}`,
                  statusCode: response.status,
                  retryAfterMs: getRetryAfterMs(response) ?? undefined,
                });
              }

              return (await response.json()) as T;
            },
            catch: (error) =>
              error instanceof MistralError
                ? error
                : new MistralError({
                    message: `Mistral request failed: ${String(error)}`,
                    cause: error,
                  }),
          });

          let lastError: MistralError | null = null;
          for (let attempt = 0; attempt < retryAttempts; attempt++) {
            const result = yield* Effect.either(concurrency.withMistral(requestOnce));
            if (result._tag === "Right") {
              metrics.llmRequestDuration.observe(
                { provider: "mistral", operation, model: modelLabel, outcome: "success" },
                observeDuration(startedAt),
              );
              return result.right;
            }

            lastError = result.left;
            if (!isRetryableMistralError(result.left) || attempt === retryAttempts - 1) {
              metrics.llmRequestDuration.observe(
                {
                  provider: "mistral",
                  operation,
                  model: modelLabel,
                  outcome: classifyMetricsErrorOutcome(result.left),
                },
                observeDuration(startedAt),
              );
              return yield* Effect.fail(result.left);
            }

            metrics.retries.inc({
              component: "mistral",
              operation,
              reason: metricReasonFromError(result.left),
            });
            const delayMs = result.left.retryAfterMs ?? retryBaseDelayMs * 2 ** attempt;
            yield* Effect.sleep(`${delayMs} millis`);
          }

          const error =
            lastError ?? new MistralError({ message: "Mistral request failed without a cause" });
          metrics.llmRequestDuration.observe(
            {
              provider: "mistral",
              operation,
              model: modelLabel,
              outcome: classifyMetricsErrorOutcome(error),
            },
            observeDuration(startedAt),
          );
          return yield* Effect.fail(error);
        }),
        withClientSpan("mistral.request", {
          "peer.service": "mistral",
          "http.request.method": method,
          "url.path": path,
          "mistral.operation": operation,
          "llm.model": modelLabel,
        }),
      );

    return {
      listModels: () =>
        pipe(
          request<{ data: MistralModel[] }>("GET", "/v1/models", undefined, "list_models"),
          Effect.map((response) => response.data),
        ),

      chat: (messages, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          return yield* pipe(
            request<MistralChatResponse>(
              "POST",
              "/v1/chat/completions",
              {
                model,
                messages,
                temperature: options.temperature ?? 0.1,
                top_p: options.top_p,
                max_tokens: options.max_tokens ?? 4096,
              },
              "chat",
              model,
            ),
            Effect.map((response) => response.choices[0]?.message.content ?? ""),
          );
        }),

      processImage: (imageBase64, prompt, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          return yield* pipe(
            request<MistralChatResponse>(
              "POST",
              "/v1/chat/completions",
              {
                model,
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "image_url",
                        image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                      },
                      { type: "text", text: prompt },
                    ],
                  },
                ],
                temperature: options.temperature ?? 0.1,
                max_tokens: options.max_tokens ?? 4096,
              },
              "image",
              model,
            ),
            Effect.map((response) => response.choices[0]?.message.content ?? ""),
          );
        }),

      processDocument: (pdfBase64, prompt, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          const response = yield* request<MistralChatResponse>(
            "POST",
            "/v1/chat/completions",
            {
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
                    },
                    { type: "text", text: prompt },
                  ],
                },
              ],
              temperature: options.temperature ?? 0.1,
              max_tokens: options.max_tokens ?? 8192,
            },
            "document",
            model,
          );
          return response.choices[0]?.message.content ?? "";
        }),

      processDocumentWithUsage: (pdfBase64, prompt, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          const response = yield* request<MistralChatResponse>(
            "POST",
            "/v1/chat/completions",
            {
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    {
                      type: "image_url",
                      image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
                    },
                    { type: "text", text: prompt },
                  ],
                },
              ],
              temperature: options.temperature ?? 0.1,
              max_tokens: options.max_tokens ?? 8192,
            },
            "document",
            model,
          );
          return {
            text: response.choices[0]?.message.content ?? "",
            usage: response.usage,
            model: response.model ?? model,
          };
        }),

      testConnection: () =>
        pipe(
          request<{ data: MistralModel[] }>("GET", "/v1/models", undefined, "list_models"),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        ),
    };
  }),
);
