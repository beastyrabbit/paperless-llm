import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { PaperlessError } from "../../src/errors/index.js";
import type { Tag } from "../../src/models/index.js";
import { PaperlessService } from "../../src/services/PaperlessService.js";
import { TagCacheService, TagCacheServiceLive } from "../../src/services/TagCacheService.js";

const tag = (id: number, name: string): Tag => ({ id, name, slug: name.toLowerCase() });

const makeLayer = (getTags: ReturnType<typeof vi.fn>, ttlMs = 60_000) =>
  Layer.provideMerge(
    TagCacheServiceLive(ttlMs),
    Layer.succeed(PaperlessService, { getTags } as unknown as PaperlessService),
  );

const runWithCache = <A>(
  getTags: ReturnType<typeof vi.fn>,
  effect: Effect.Effect<A, unknown, TagCacheService>,
  ttlMs?: number,
) => Effect.runPromise(effect.pipe(Effect.provide(makeLayer(getTags, ttlMs))));

describe("TagCacheService", () => {
  it("caches tags within the TTL", async () => {
    const getTags = vi.fn(() => Effect.succeed([tag(1, "Todo")]));

    const results = await runWithCache(
      getTags,
      Effect.gen(function* () {
        const cache = yield* TagCacheService;
        const first = yield* cache.getTags();
        const second = yield* cache.getTags();
        return { first, second };
      }),
    );

    expect(getTags).toHaveBeenCalledTimes(1);
    expect(results.first.source).toBe("fresh");
    expect(results.second.source).toBe("cached");
    expect(results.second.tags).toEqual([tag(1, "Todo")]);
  });

  it("force refresh bypasses the TTL and updates cached tags", async () => {
    const getTags = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed([tag(1, "Todo")]))
      .mockReturnValueOnce(Effect.succeed([tag(2, "Done")]));

    const results = await runWithCache(
      getTags,
      Effect.gen(function* () {
        const cache = yield* TagCacheService;
        const first = yield* cache.getTags();
        const second = yield* cache.refresh();
        const peeked = yield* cache.peek();
        return { first, second, peeked };
      }),
    );

    expect(getTags).toHaveBeenCalledTimes(2);
    expect(results.first.tags).toEqual([tag(1, "Todo")]);
    expect(results.second).toMatchObject({ source: "fresh", tags: [tag(2, "Done")] });
    expect(results.peeked?.tags).toEqual([tag(2, "Done")]);
  });

  it("returns stale cached tags when an expired refresh fails", async () => {
    const error = new PaperlessError({ message: "Paperless unavailable" });
    const getTags = vi
      .fn()
      .mockReturnValueOnce(Effect.succeed([tag(1, "Todo")]))
      .mockReturnValueOnce(Effect.fail(error));

    const result = await runWithCache(
      getTags,
      Effect.gen(function* () {
        const cache = yield* TagCacheService;
        yield* cache.getTags();
        return yield* cache.getTags();
      }),
      0,
    );

    expect(getTags).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("stale");
    expect(result.tags).toEqual([tag(1, "Todo")]);
    expect(result.staleError).toBe(error);
  });

  it("fails when the initial fetch fails and no stale cache exists", async () => {
    const error = new PaperlessError({ message: "Paperless unavailable" });
    const getTags = vi.fn(() => Effect.fail(error));

    const result = await runWithCache(
      getTags,
      Effect.gen(function* () {
        const cache = yield* TagCacheService;
        return yield* Effect.either(cache.getTags());
      }),
    );

    expect(getTags).toHaveBeenCalledTimes(1);
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left).toBe(error);
  });

  it("deduplicates concurrent cold-cache refreshes", async () => {
    const getTags = vi.fn(() => Effect.promise(() => new Promise<Tag[]>((resolve) => {
      setTimeout(() => resolve([tag(1, "Todo")]), 10);
    })));

    const results = await runWithCache(
      getTags,
      Effect.gen(function* () {
        const cache = yield* TagCacheService;
        return yield* Effect.all([cache.getTags(), cache.getTags()], { concurrency: "unbounded" });
      }),
    );

    expect(getTags).toHaveBeenCalledTimes(1);
    expect(results.map((result) => result.source)).toEqual(["fresh", "cached"]);
    expect(results[0].tags).toEqual([tag(1, "Todo")]);
    expect(results[1].tags).toEqual([tag(1, "Todo")]);
  });
});
