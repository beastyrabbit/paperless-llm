/**
 * Mistral AI service for OCR and vision tasks.
 */
import { Effect, Context, Layer, pipe } from 'effect';
import { ConfigService } from '../config/index.js';
import { TinyBaseService } from './TinyBaseService.js';
import { MistralError } from '../errors/index.js';

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
  role: 'system' | 'user' | 'assistant';
  content: string | MistralContent[];
}

export interface MistralContent {
  type: 'text' | 'image_url';
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

// ===========================================================================
// Service Interface
// ===========================================================================

export interface MistralService {
  readonly listModels: () => Effect.Effect<MistralModel[], MistralError>;
  readonly chat: (
    messages: MistralChatMessage[],
    options?: MistralChatOptions
  ) => Effect.Effect<string, MistralError>;
  readonly processImage: (
    imageBase64: string,
    prompt: string,
    options?: MistralChatOptions
  ) => Effect.Effect<string, MistralError>;
  readonly processDocument: (
    pdfBase64: string,
    prompt: string,
    options?: MistralChatOptions
  ) => Effect.Effect<string, MistralError>;
  readonly testConnection: () => Effect.Effect<boolean, MistralError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const MistralService = Context.GenericTag<MistralService>('MistralService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const MistralServiceLive = Layer.effect(
  MistralService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybaseService = yield* TinyBaseService;
    const { mistral: configMistral } = configService.config;

    // Helper to get current config from TinyBase with fallback to ConfigService
    const getConfig = (): Effect.Effect<{ apiKey: string; model: string }, never> =>
      Effect.gen(function* () {
        const dbSettings = yield* tinybaseService.getAllSettings();
        return {
          apiKey: dbSettings['mistral.api_key'] ?? configMistral.apiKey,
          model: dbSettings['mistral.model'] ?? configMistral.model,
        };
      });

    // Helper for making requests - reads config dynamically
    const request = <T>(
      method: string,
      path: string,
      body?: unknown
    ): Effect.Effect<T, MistralError> =>
      Effect.gen(function* () {
        const { apiKey } = yield* getConfig();

        if (!apiKey) {
          return yield* Effect.fail(new MistralError({
            message: 'Mistral API key not configured',
          }));
        }

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch(`https://api.mistral.ai${path}`, {
              method,
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: body ? JSON.stringify(body) : undefined,
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(`Mistral API error: ${response.status} ${text}`);
            }

            return (await response.json()) as T;
          },
          catch: (error) =>
            new MistralError({
              message: `Mistral request failed: ${String(error)}`,
              cause: error,
            }),
        });
      });

    return {
      listModels: () =>
        pipe(
          request<{ data: MistralModel[] }>('GET', '/v1/models'),
          Effect.map((response) => response.data)
        ),

      chat: (messages, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          return yield* pipe(
            request<MistralChatResponse>('POST', '/v1/chat/completions', {
              model,
              messages,
              temperature: options.temperature ?? 0.1,
              top_p: options.top_p,
              max_tokens: options.max_tokens ?? 4096,
            }),
            Effect.map((response) => response.choices[0]?.message.content ?? '')
          );
        }),

      processImage: (imageBase64, prompt, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          return yield* pipe(
            request<MistralChatResponse>('POST', '/v1/chat/completions', {
              model,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
                    },
                    { type: 'text', text: prompt },
                  ],
                },
              ],
              temperature: options.temperature ?? 0.1,
              max_tokens: options.max_tokens ?? 4096,
            }),
            Effect.map((response) => response.choices[0]?.message.content ?? '')
          );
        }),

      processDocument: (pdfBase64, prompt, options = {}) =>
        Effect.gen(function* () {
          const { model } = yield* getConfig();
          return yield* pipe(
            request<MistralChatResponse>('POST', '/v1/chat/completions', {
              model,
              messages: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'image_url',
                      image_url: { url: `data:application/pdf;base64,${pdfBase64}` },
                    },
                    { type: 'text', text: prompt },
                  ],
                },
              ],
              temperature: options.temperature ?? 0.1,
              max_tokens: options.max_tokens ?? 8192,
            }),
            Effect.map((response) => response.choices[0]?.message.content ?? '')
          );
        }),

      testConnection: () =>
        pipe(
          request<{ data: MistralModel[] }>('GET', '/v1/models'),
          Effect.map(() => true),
          Effect.catchAll(() => Effect.succeed(false))
        ),
    };
  })
);
