import { Effect } from "effect";
import type { QueueStats } from "../models/index.js";
import type { PaperlessService } from "../services/PaperlessService.js";
import type { PaperlessErrorType } from "../services/paperless/types.js";

const PAPERLESS_STATUS_CACHE_TTL_MS = 5_000;

let queueStatsCache: { value: QueueStats; expiresAtMs: number } | null = null;
let queueStatsInFlight: Promise<QueueStats> | null = null;
let totalDocumentCountCache: { value: number; expiresAtMs: number } | null = null;
let totalDocumentCountInFlight: Promise<number> | null = null;

const fromPromise = <A>(promise: Promise<A>): Effect.Effect<A, PaperlessErrorType> =>
  Effect.tryPromise({
    try: () => promise,
    catch: (error) => error as PaperlessErrorType,
  });

export const clearPaperlessStatusCacheForTests = () => {
  queueStatsCache = null;
  queueStatsInFlight = null;
  totalDocumentCountCache = null;
  totalDocumentCountInFlight = null;
};

export const getCachedQueueStats = (
  paperless: PaperlessService,
): Effect.Effect<QueueStats, PaperlessErrorType> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (queueStatsCache && queueStatsCache.expiresAtMs > now) return queueStatsCache.value;
    if (queueStatsInFlight) return yield* fromPromise(queueStatsInFlight);

    const promise = Effect.runPromise(paperless.getQueueStats())
      .then((value) => {
        queueStatsCache = {
          value,
          expiresAtMs: Date.now() + PAPERLESS_STATUS_CACHE_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        queueStatsInFlight = null;
      });

    queueStatsInFlight = promise;
    return yield* fromPromise(promise);
  });

export const getCachedTotalDocumentCount = (
  paperless: PaperlessService,
): Effect.Effect<number, PaperlessErrorType> =>
  Effect.gen(function* () {
    const now = Date.now();
    if (totalDocumentCountCache && totalDocumentCountCache.expiresAtMs > now) {
      return totalDocumentCountCache.value;
    }
    if (totalDocumentCountInFlight) return yield* fromPromise(totalDocumentCountInFlight);

    const promise = Effect.runPromise(paperless.getTotalDocumentCount())
      .then((value) => {
        totalDocumentCountCache = {
          value,
          expiresAtMs: Date.now() + PAPERLESS_STATUS_CACHE_TTL_MS,
        };
        return value;
      })
      .finally(() => {
        totalDocumentCountInFlight = null;
      });

    totalDocumentCountInFlight = promise;
    return yield* fromPromise(promise);
  });
