/**
 * Shared process-wide concurrency gates for local/remote heavy AI resources.
 */
import { Context, Effect, Layer } from "effect";
import { ConfigService } from "../config/index.js";

export interface ConcurrencyLimitService {
  readonly withOllama: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly withMistral: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly withOcr: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export const ConcurrencyLimitService =
  Context.GenericTag<ConcurrencyLimitService>("ConcurrencyLimitService");

const clampCap = (value: number | undefined): number => {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.floor(value ?? 1));
};

export const ConcurrencyLimitServiceLive = Layer.effect(
  ConcurrencyLimitService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const concurrency = configService.config.concurrency;
    const ollama = yield* Effect.makeSemaphore(clampCap(concurrency?.ollamaMaxConcurrent));
    const mistral = yield* Effect.makeSemaphore(clampCap(concurrency?.mistralMaxConcurrent));
    const ocr = yield* Effect.makeSemaphore(clampCap(concurrency?.ocrMaxConcurrent));

    return {
      withOllama: (effect) => ollama.withPermits(1)(effect),
      withMistral: (effect) => mistral.withPermits(1)(effect),
      withOcr: (effect) => ocr.withPermits(1)(effect),
    } satisfies ConcurrencyLimitService;
  }),
);
