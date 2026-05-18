/**
 * Ollama LLM service for local model inference.
 */
import { Context, Effect, Layer, pipe, Stream } from "effect";
import { ConfigService } from "../config/index.js";
import { OllamaError } from "../errors/index.js";
import { withClientSpan } from "../observability/tracing.js";
import { fetchWithTimeout } from "../utils/http.js";
import { ConcurrencyLimitService } from "./ConcurrencyLimitService.js";
import { classifyMetricsErrorOutcome, metrics, observeDuration } from "./MetricsService.js";
import { TinyBaseService } from "./TinyBaseService.js";

// ===========================================================================
// Types
// ===========================================================================

export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  thinking?: string;
}

export type OllamaResponseFormat = "json" | Record<string, unknown>;

export interface OllamaChatOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  num_ctx?: number;
  seed?: number;
  stop?: string[];
  format?: OllamaResponseFormat;
  think?: boolean | "low" | "medium" | "high";
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface OllamaStreamChunk {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
}

export interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
  expires_at: string;
  size_vram: number;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface OllamaService {
  readonly listModels: () => Effect.Effect<OllamaModel[], OllamaError>;
  readonly getRunningModels: () => Effect.Effect<OllamaRunningModel[], OllamaError>;
  readonly chat: (
    model: string,
    messages: OllamaChatMessage[],
    options?: OllamaChatOptions,
  ) => Effect.Effect<OllamaChatResponse, OllamaError>;
  readonly chatStream: (
    model: string,
    messages: OllamaChatMessage[],
    options?: OllamaChatOptions,
  ) => Stream.Stream<OllamaStreamChunk, OllamaError>;
  readonly generate: (
    model: string,
    prompt: string,
    options?: OllamaChatOptions,
  ) => Effect.Effect<string, OllamaError>;
  readonly generateStream: (
    model: string,
    prompt: string,
    options?: OllamaChatOptions,
  ) => Stream.Stream<string, OllamaError>;
  readonly embed: (text: string) => Effect.Effect<number[], OllamaError>;
  readonly testConnection: () => Effect.Effect<boolean, OllamaError>;
  readonly getModel: (size: "generation" | "embedding") => string;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const OllamaService = Context.GenericTag<OllamaService>("OllamaService");

// ===========================================================================
// Live Implementation
// ===========================================================================

export const OllamaServiceLive = Layer.effect(
  OllamaService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const concurrency = yield* ConcurrencyLimitService;
    const { ollama: configOllama } = configService.config;

    // Cache initial model names at service creation time
    const dbSettings = yield* tinybaseService.getAllSettings();
    const cachedModel =
      dbSettings["ollama.model"] ?? dbSettings["ollama_model"] ?? configOllama.model;
    const cachedModelEmbedding =
      dbSettings["ollama.embedding_model"] ?? configOllama.embeddingModel;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<
      {
        url: string;
        model: string;
        modelEmbedding: string;
        requestTimeoutMs: number;
      },
      never
    > =>
      pipe(
        tinybaseService.getAllSettings(),
        Effect.map((settings) => {
          const model = settings["ollama.model"] ?? settings["ollama_model"] ?? configOllama.model;
          return {
            url: settings["ollama.url"] ?? configOllama.url,
            model,
            modelEmbedding: settings["ollama.embedding_model"] ?? configOllama.embeddingModel,
            requestTimeoutMs: configService.config.http?.requestTimeoutMs ?? 120_000,
          };
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            url: configOllama.url,
            model: configOllama.model,
            modelEmbedding: configOllama.embeddingModel,
            requestTimeoutMs: configService.config.http?.requestTimeoutMs ?? 120_000,
          }),
        ),
      );

    // Helper for making requests - reads config dynamically
    const request = <T>(
      method: string,
      path: string,
      body: unknown,
      operation: "list_models" | "chat" | "generate",
      modelLabel = "unknown",
    ): Effect.Effect<T, OllamaError> =>
      pipe(
        Effect.gen(function* () {
          const startedAt = Date.now();
          const { url: baseUrl, requestTimeoutMs } = yield* getConfig();

          if (!baseUrl) {
            return yield* Effect.fail(
              new OllamaError({
                message: "Ollama not configured",
              }),
            );
          }

          return yield* pipe(
            concurrency.withOllama(
              Effect.tryPromise({
                try: async () => {
                  const response = await fetchWithTimeout(
                    `${baseUrl}${path}`,
                    {
                      method,
                      headers: { "Content-Type": "application/json" },
                      body: body ? JSON.stringify(body) : undefined,
                    },
                    requestTimeoutMs,
                  );

                  if (!response.ok) {
                    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
                  }

                  return (await response.json()) as T;
                },
                catch: (error) =>
                  new OllamaError({
                    message: `Ollama request failed: ${String(error)}`,
                    cause: error,
                  }),
              }),
            ),
            Effect.tap(() =>
              Effect.sync(() =>
                metrics.llmRequestDuration.observe(
                  { provider: "ollama", operation, model: modelLabel, outcome: "success" },
                  observeDuration(startedAt),
                ),
              ),
            ),
            Effect.tapError((error) =>
              Effect.sync(() =>
                metrics.llmRequestDuration.observe(
                  {
                    provider: "ollama",
                    operation,
                    model: modelLabel,
                    outcome: classifyMetricsErrorOutcome(error),
                  },
                  observeDuration(startedAt),
                ),
              ),
            ),
          );
        }),
        withClientSpan("ollama.request", {
          "peer.service": "ollama",
          "http.request.method": method,
          "url.path": path,
          "ollama.operation": operation,
          "llm.model": modelLabel,
        }),
      );

    return {
      listModels: () =>
        pipe(
          request<{ models: OllamaModel[] }>("GET", "/api/tags", undefined, "list_models"),
          Effect.map((response) => response.models),
        ),

      getRunningModels: () =>
        pipe(
          request<{ models: OllamaRunningModel[] }>("GET", "/api/ps", undefined, "list_models"),
          Effect.map((response) => response.models ?? []),
        ),

      chat: (model, messages, options = {}) =>
        request<OllamaChatResponse>(
          "POST",
          "/api/chat",
          {
            model,
            messages,
            stream: false,
            format: options.format,
            think: options.think,
            options: {
              temperature: options.temperature ?? 0.1,
              top_p: options.top_p,
              top_k: options.top_k,
              num_predict: options.num_predict,
              num_ctx: options.num_ctx,
              seed: options.seed,
              stop: options.stop,
            },
          },
          "chat",
          model,
        ),

      chatStream: (model, messages, options = {}) =>
        Stream.asyncEffect<OllamaStreamChunk, OllamaError, never>((emit) =>
          Effect.gen(function* () {
            const { url: baseUrl, requestTimeoutMs } = yield* getConfig();
            const controller = new AbortController();

            void Effect.runPromise(
              concurrency.withOllama(
                Effect.tryPromise({
                  try: async () => {
                    const response = await fetchWithTimeout(
                      `${baseUrl}/api/chat`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          model,
                          messages,
                          stream: true,
                          format: options.format,
                          think: options.think,
                          options: {
                            temperature: options.temperature ?? 0.1,
                            top_p: options.top_p,
                            top_k: options.top_k,
                            num_predict: options.num_predict,
                            num_ctx: options.num_ctx,
                            seed: options.seed,
                            stop: options.stop,
                          },
                        }),
                        signal: controller.signal,
                      },
                      requestTimeoutMs,
                    );

                    if (!response.ok) {
                      throw new Error(`Ollama API error: ${response.status}`);
                    }

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error("No response body");

                    const decoder = new TextDecoder();
                    let buffer = "";

                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;

                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split("\n");
                      buffer = lines.pop() ?? "";

                      for (const line of lines) {
                        if (line.trim()) {
                          let chunk: OllamaStreamChunk;
                          try {
                            chunk = JSON.parse(line) as OllamaStreamChunk;
                          } catch (error) {
                            emit.fail(
                              new OllamaError({
                                message: `Malformed Ollama stream chunk: ${String(error)}`,
                                model,
                                cause: { line, error },
                              }),
                            );
                            controller.abort();
                            return;
                          }
                          emit.single(chunk);
                          if (chunk.done) {
                            emit.end();
                            return;
                          }
                        }
                      }
                    }

                    if (buffer.trim()) {
                      let chunk: OllamaStreamChunk;
                      try {
                        chunk = JSON.parse(buffer) as OllamaStreamChunk;
                      } catch (error) {
                        emit.fail(
                          new OllamaError({
                            message: `Malformed Ollama stream chunk: ${String(error)}`,
                            model,
                            cause: { line: buffer, error },
                          }),
                        );
                        controller.abort();
                        return;
                      }
                      emit.single(chunk);
                    }

                    emit.end();
                  },
                  catch: (error) =>
                    error instanceof OllamaError
                      ? error
                      : new OllamaError({
                          message: `Stream failed: ${String(error)}`,
                          model,
                          cause: error,
                        }),
                }),
              ),
            ).catch((error) => {
              emit.fail(
                error instanceof OllamaError
                  ? error
                  : new OllamaError({
                      message: `Stream failed: ${String(error)}`,
                      model,
                      cause: error,
                    }),
              );
            });

            return Effect.sync(() => {
              controller.abort();
            });
          }).pipe(
            withClientSpan("ollama.stream", {
              "peer.service": "ollama",
              "http.request.method": "POST",
              "url.path": "/api/chat",
              "ollama.operation": "chat_stream",
              "llm.model": model,
            }),
          ),
        ),

      generate: (model, prompt, options = {}) =>
        pipe(
          request<{ response: string }>(
            "POST",
            "/api/generate",
            {
              model,
              prompt,
              stream: false,
              format: options.format,
              think: options.think,
              options: {
                temperature: options.temperature ?? 0.1,
                top_p: options.top_p,
                top_k: options.top_k,
                num_predict: options.num_predict,
                num_ctx: options.num_ctx,
                seed: options.seed,
                stop: options.stop,
              },
            },
            "generate",
            model,
          ),
          Effect.map((response) => response.response),
        ),

      generateStream: (model, prompt, options = {}) =>
        Stream.asyncEffect<string, OllamaError, never>((emit) =>
          Effect.gen(function* () {
            const { url: baseUrl, requestTimeoutMs } = yield* getConfig();
            const controller = new AbortController();

            void Effect.runPromise(
              concurrency.withOllama(
                Effect.tryPromise({
                  try: async () => {
                    const response = await fetchWithTimeout(
                      `${baseUrl}/api/generate`,
                      {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          model,
                          prompt,
                          stream: true,
                          format: options.format,
                          think: options.think,
                          options: {
                            temperature: options.temperature ?? 0.1,
                            top_p: options.top_p,
                            top_k: options.top_k,
                            num_predict: options.num_predict,
                            num_ctx: options.num_ctx,
                            seed: options.seed,
                            stop: options.stop,
                          },
                        }),
                        signal: controller.signal,
                      },
                      requestTimeoutMs,
                    );

                    if (!response.ok) {
                      throw new Error(`Ollama API error: ${response.status}`);
                    }

                    const reader = response.body?.getReader();
                    if (!reader) throw new Error("No response body");

                    const decoder = new TextDecoder();
                    let buffer = "";

                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;

                      buffer += decoder.decode(value, { stream: true });
                      const lines = buffer.split("\n");
                      buffer = lines.pop() ?? "";

                      for (const line of lines) {
                        if (line.trim()) {
                          let chunk: { response: string; done: boolean };
                          try {
                            chunk = JSON.parse(line) as { response: string; done: boolean };
                          } catch (error) {
                            emit.fail(
                              new OllamaError({
                                message: `Malformed Ollama stream chunk: ${String(error)}`,
                                model,
                                cause: { line, error },
                              }),
                            );
                            controller.abort();
                            return;
                          }
                          emit.single(chunk.response);
                          if (chunk.done) {
                            emit.end();
                            return;
                          }
                        }
                      }
                    }

                    if (buffer.trim()) {
                      let chunk: { response: string; done: boolean };
                      try {
                        chunk = JSON.parse(buffer) as { response: string; done: boolean };
                      } catch (error) {
                        emit.fail(
                          new OllamaError({
                            message: `Malformed Ollama stream chunk: ${String(error)}`,
                            model,
                            cause: { line: buffer, error },
                          }),
                        );
                        controller.abort();
                        return;
                      }
                      emit.single(chunk.response);
                    }

                    emit.end();
                  },
                  catch: (error) =>
                    error instanceof OllamaError
                      ? error
                      : new OllamaError({
                          message: `Stream failed: ${String(error)}`,
                          model,
                          cause: error,
                        }),
                }),
              ),
            ).catch((error) => {
              emit.fail(
                error instanceof OllamaError
                  ? error
                  : new OllamaError({
                      message: `Stream failed: ${String(error)}`,
                      model,
                      cause: error,
                    }),
              );
            });

            return Effect.sync(() => {
              controller.abort();
            });
          }).pipe(
            withClientSpan("ollama.stream", {
              "peer.service": "ollama",
              "http.request.method": "POST",
              "url.path": "/api/generate",
              "ollama.operation": "generate_stream",
              "llm.model": model,
            }),
          ),
        ),

      embed: (text: string) =>
        Effect.gen(function* () {
          const startedAt = Date.now();
          const { url: baseUrl, modelEmbedding, requestTimeoutMs } = yield* getConfig();

          return yield* pipe(
            concurrency.withOllama(
              Effect.tryPromise({
                try: async () => {
                  const response = await fetchWithTimeout(
                    `${baseUrl}/api/embed`,
                    {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        model: modelEmbedding,
                        input: text,
                      }),
                    },
                    requestTimeoutMs,
                  );

                  if (!response.ok) {
                    throw new Error(
                      `Ollama embed error: ${response.status} ${response.statusText}`,
                    );
                  }

                  const result = (await response.json()) as { embeddings: number[][] };
                  return result.embeddings[0] ?? [];
                },
                catch: (error) =>
                  new OllamaError({
                    message: `Embedding failed: ${String(error)}`,
                    cause: error,
                  }),
              }),
            ),
            Effect.tap(() =>
              Effect.sync(() =>
                metrics.llmRequestDuration.observe(
                  {
                    provider: "ollama",
                    operation: "embed",
                    model: modelEmbedding,
                    outcome: "success",
                  },
                  observeDuration(startedAt),
                ),
              ),
            ),
            Effect.tapError((error) =>
              Effect.sync(() =>
                metrics.llmRequestDuration.observe(
                  {
                    provider: "ollama",
                    operation: "embed",
                    model: modelEmbedding,
                    outcome: classifyMetricsErrorOutcome(error),
                  },
                  observeDuration(startedAt),
                ),
              ),
            ),
          );
        }),

      testConnection: () =>
        pipe(
          request<{ models: OllamaModel[] }>("GET", "/api/tags", undefined, "list_models"),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false)),
        ),

      getModel: (size) => {
        switch (size) {
          case "generation":
            return cachedModel;
          case "embedding":
            return cachedModelEmbedding;
        }
      },
    };
  }),
);
