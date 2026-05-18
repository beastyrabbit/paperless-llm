import { Effect, Layer, Ref } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import {
  ConcurrencyLimitService,
  ConcurrencyLimitServiceLive,
} from "../../src/services/ConcurrencyLimitService.js";

const makeLayer = (concurrency: {
  ollamaMaxConcurrent?: number;
  mistralMaxConcurrent?: number;
  ocrMaxConcurrent?: number;
}) =>
  Layer.provide(
    ConcurrencyLimitServiceLive,
    Layer.succeed(ConfigService, {
      config: { concurrency },
    } as unknown as ConfigService),
  );

const maxActiveFor = (
  run: (service: ConcurrencyLimitService, effect: Effect.Effect<void>) => Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const service = yield* ConcurrencyLimitService;
    const active = yield* Ref.make(0);
    const maxActive = yield* Ref.make(0);
    const work = Effect.gen(function* () {
      const current = yield* Ref.updateAndGet(active, (value) => value + 1);
      yield* Ref.update(maxActive, (value) => Math.max(value, current));
      yield* Effect.sleep("10 millis");
      yield* Ref.update(active, (value) => value - 1);
    });

    yield* Effect.all([run(service, work), run(service, work), run(service, work)], {
      concurrency: "unbounded",
    });
    return yield* Ref.get(maxActive);
  });

describe("ConcurrencyLimitService", () => {
  it("serializes Ollama work when cap is 1", async () => {
    const maxActive = await Effect.runPromise(
      maxActiveFor((service, effect) => service.withOllama(effect)).pipe(
        Effect.provide(makeLayer({ ollamaMaxConcurrent: 1 })),
      ),
    );

    expect(maxActive).toBe(1);
  });

  it("serializes Mistral work when cap is 1", async () => {
    const maxActive = await Effect.runPromise(
      maxActiveFor((service, effect) => service.withMistral(effect)).pipe(
        Effect.provide(makeLayer({ mistralMaxConcurrent: 1 })),
      ),
    );

    expect(maxActive).toBe(1);
  });

  it("clamps invalid OCR caps to 1", async () => {
    const maxActive = await Effect.runPromise(
      maxActiveFor((service, effect) => service.withOcr(effect)).pipe(
        Effect.provide(makeLayer({ ocrMaxConcurrent: 0 })),
      ),
    );

    expect(maxActive).toBe(1);
  });
});
