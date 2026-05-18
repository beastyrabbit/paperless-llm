/**
 * Effect-managed cache for Paperless tags.
 */
import { Clock, Context, Effect, Layer, Ref } from "effect";
import type { NotFoundError, PaperlessError } from "../errors/index.js";
import type { Tag } from "../models/index.js";
import { PaperlessService } from "./PaperlessService.js";

export type TagCacheSource = "cached" | "fresh" | "stale";

type PaperlessErrorType = PaperlessError | NotFoundError;

export interface TagCacheEntry {
  readonly tags: Tag[];
  readonly timestamp: number;
}

export interface TagCacheResult {
  readonly tags: Tag[];
  readonly source: TagCacheSource;
  readonly ageMs: number;
  readonly staleError?: PaperlessErrorType;
}

export interface TagCacheService {
  readonly getTags: () => Effect.Effect<TagCacheResult, PaperlessErrorType>;
  readonly refresh: () => Effect.Effect<TagCacheResult, PaperlessErrorType>;
  readonly invalidate: () => Effect.Effect<void>;
  readonly peek: () => Effect.Effect<TagCacheEntry | null>;
}

export const TagCacheService = Context.GenericTag<TagCacheService>("TagCacheService");

const DEFAULT_TAG_CACHE_TTL_MS = 60_000;

export const TagCacheServiceLive = (ttlMs = DEFAULT_TAG_CACHE_TTL_MS) =>
  Layer.effect(
    TagCacheService,
    Effect.gen(function* () {
      const paperless = yield* PaperlessService;
      const cacheRef = yield* Ref.make<TagCacheEntry | null>(null);
      const refreshSemaphore = yield* Effect.makeSemaphore(1);

      const ageFor = (entry: TagCacheEntry, now: number): number => Math.max(0, now - entry.timestamp);

      const fetchAndStore = Effect.gen(function* () {
        const tags = yield* paperless.getTags();
        const timestamp = yield* Clock.currentTimeMillis;
        const entry: TagCacheEntry = { tags, timestamp };
        yield* Ref.set(cacheRef, entry);
        return {
          tags,
          source: "fresh" as const,
          ageMs: 0,
        };
      });

      const refreshWithStaleFallback = (): Effect.Effect<TagCacheResult, PaperlessErrorType> =>
        fetchAndStore.pipe(
          Effect.catchAll((error) =>
            Ref.get(cacheRef).pipe(
              Effect.flatMap((entry) => {
                if (!entry) return Effect.fail(error);
                return Clock.currentTimeMillis.pipe(
                  Effect.map((now) => ({
                    tags: entry.tags,
                    source: "stale" as const,
                    ageMs: ageFor(entry, now),
                    staleError: error,
                  })),
                );
              }),
            ),
          ),
        );

      const getTags = (): Effect.Effect<TagCacheResult, PaperlessErrorType> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const cached = yield* Ref.get(cacheRef);
          if (cached && ageFor(cached, now) < ttlMs) {
            return {
              tags: cached.tags,
              source: "cached" as const,
              ageMs: ageFor(cached, now),
            };
          }

          return yield* refreshSemaphore.withPermits(1)(
            Effect.gen(function* () {
              const recheckNow = yield* Clock.currentTimeMillis;
              const rechecked = yield* Ref.get(cacheRef);
              if (rechecked && ageFor(rechecked, recheckNow) < ttlMs) {
                return {
                  tags: rechecked.tags,
                  source: "cached" as const,
                  ageMs: ageFor(rechecked, recheckNow),
                };
              }
              return yield* refreshWithStaleFallback();
            }),
          );
        });

      return {
        getTags,
        refresh: () => refreshSemaphore.withPermits(1)(refreshWithStaleFallback()),
        invalidate: () => Ref.set(cacheRef, null),
        peek: () => Ref.get(cacheRef),
      } satisfies TagCacheService;
    }),
  );
