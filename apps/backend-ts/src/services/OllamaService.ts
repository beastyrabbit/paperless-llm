/**
 * Ollama LLM service for local model inference.
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import { ConfigService } from '../config/index.js';
import { TinyBaseService } from './TinyBaseService.js';
import { OllamaError } from '../errors/index.js';

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
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stop?: string[];
}

export interface OllamaChatResponse {
  model: string;
  message: OllamaChatMessage;
  done: boolean;
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

// ===========================================================================
// Service Interface
// ===========================================================================

export interface OllamaService {
  readonly listModels: () => Effect.Effect<OllamaModel[], OllamaError>;
  readonly chat: (
    model: string,
    messages: OllamaChatMessage[],
    options?: OllamaChatOptions
  ) => Effect.Effect<OllamaChatResponse, OllamaError>;
  readonly chatStream: (
    model: string,
    messages: OllamaChatMessage[],
    options?: OllamaChatOptions
  ) => Stream.Stream<OllamaStreamChunk, OllamaError>;
  readonly generate: (
    model: string,
    prompt: string,
    options?: OllamaChatOptions
  ) => Effect.Effect<string, OllamaError>;
  readonly generateStream: (
    model: string,
    prompt: string,
    options?: OllamaChatOptions
  ) => Stream.Stream<string, OllamaError>;
  readonly testConnection: () => Effect.Effect<boolean, OllamaError>;
  readonly getModel: (size: 'large' | 'small') => string;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const OllamaService = Context.GenericTag<OllamaService>('OllamaService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const OllamaServiceLive = Layer.effect(
  OllamaService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const { ollama: configOllama } = configService.config;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<{ url: string; modelLarge: string; modelSmall: string }, never> =>
      Effect.gen(function* () {
        const dbSettings = yield* tinybaseService.getAllSettings();
        return {
          url: dbSettings['ollama.url'] ?? configOllama.url,
          modelLarge: dbSettings['ollama.model_large'] ?? configOllama.modelLarge,
          modelSmall: dbSettings['ollama.model_small'] ?? configOllama.modelSmall,
        };
      });

    // Helper for making requests - reads config dynamically
    const request = <T>(
      method: string,
      path: string,
      body?: unknown
    ): Effect.Effect<T, OllamaError> =>
      Effect.gen(function* () {
        const { url: baseUrl } = yield* getConfig();

        if (!baseUrl) {
          return yield* Effect.fail(new OllamaError({
            message: 'Ollama not configured',
          }));
        }

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`${baseUrl}${path}`, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: body ? JSON.stringify(body) : undefined,
            });

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
        });
      });

    return {
      listModels: () =>
        pipe(
          request<{ models: OllamaModel[] }>('GET', '/api/tags'),
          Effect.map((response) => response.models)
        ),

      chat: (model, messages, options = {}) =>
        request<OllamaChatResponse>('POST', '/api/chat', {
          model,
          messages,
          stream: false,
          options: {
            temperature: options.temperature ?? 0.1,
            top_p: options.top_p,
            top_k: options.top_k,
            num_predict: options.num_predict,
            stop: options.stop,
          },
        }),

      chatStream: (model, messages, options = {}) =>
        Stream.asyncEffect<OllamaStreamChunk, OllamaError, never>((emit) =>
          Effect.gen(function* () {
            const { url: baseUrl } = yield* getConfig();
            const controller = new AbortController();

            (async () => {
              try {
                const response = await fetch(`${baseUrl}/api/chat`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model,
                    messages,
                    stream: true,
                    options: {
                      temperature: options.temperature ?? 0.1,
                      top_p: options.top_p,
                      top_k: options.top_k,
                      num_predict: options.num_predict,
                      stop: options.stop,
                    },
                  }),
                  signal: controller.signal,
                });

                if (!response.ok) {
                  throw new Error(`Ollama API error: ${response.status}`);
                }

                const reader = response.body?.getReader();
                if (!reader) throw new Error('No response body');

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() ?? '';

                  for (const line of lines) {
                    if (line.trim()) {
                      const chunk = JSON.parse(line) as OllamaStreamChunk;
                      emit.single(chunk);
                      if (chunk.done) {
                        emit.end();
                        return;
                      }
                    }
                  }
                }

                emit.end();
              } catch (error) {
                emit.fail(
                  new OllamaError({
                    message: `Stream failed: ${String(error)}`,
                    model,
                    cause: error,
                  })
                );
              }
            })();

            return Effect.sync(() => {
              controller.abort();
            });
          })
        ),

      generate: (model, prompt, options = {}) =>
        pipe(
          request<{ response: string }>('POST', '/api/generate', {
            model,
            prompt,
            stream: false,
            options: {
              temperature: options.temperature ?? 0.1,
              top_p: options.top_p,
              top_k: options.top_k,
              num_predict: options.num_predict,
              stop: options.stop,
            },
          }),
          Effect.map((response) => response.response)
        ),

      generateStream: (model, prompt, options = {}) =>
        Stream.asyncEffect<string, OllamaError, never>((emit) =>
          Effect.gen(function* () {
            const { url: baseUrl } = yield* getConfig();
            const controller = new AbortController();

            (async () => {
              try {
                const response = await fetch(`${baseUrl}/api/generate`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model,
                    prompt,
                    stream: true,
                    options: {
                      temperature: options.temperature ?? 0.1,
                      top_p: options.top_p,
                      top_k: options.top_k,
                      num_predict: options.num_predict,
                      stop: options.stop,
                    },
                  }),
                  signal: controller.signal,
                });

                if (!response.ok) {
                  throw new Error(`Ollama API error: ${response.status}`);
                }

                const reader = response.body?.getReader();
                if (!reader) throw new Error('No response body');

                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  buffer += decoder.decode(value, { stream: true });
                  const lines = buffer.split('\n');
                  buffer = lines.pop() ?? '';

                  for (const line of lines) {
                    if (line.trim()) {
                      const chunk = JSON.parse(line) as { response: string; done: boolean };
                      emit.single(chunk.response);
                      if (chunk.done) {
                        emit.end();
                        return;
                      }
                    }
                  }
                }

                emit.end();
              } catch (error) {
                emit.fail(
                  new OllamaError({
                    message: `Stream failed: ${String(error)}`,
                    model,
                    cause: error,
                  })
                );
              }
            })();

            return Effect.sync(() => {
              controller.abort();
            });
          })
        ),

      testConnection: () =>
        pipe(
          request<{ models: OllamaModel[] }>('GET', '/api/tags'),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        ),

      getModel: (size) =>
        Effect.gen(function* () {
          const { modelLarge, modelSmall } = yield* getConfig();
          return size === 'large' ? modelLarge : modelSmall;
        }).pipe(Effect.runSync),
    };
  })
);
