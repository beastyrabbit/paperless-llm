# Todo #12 / W3-S14 — implementation-ready handoff: replace mutable tag cache

## Scope and source requirement

- Requested work: replace the mutable tag cache with an Effect-managed cache/ref. Inspect server and services. Do **not** edit code in this handoff task.
- Source requirement: `docs/plans/audit-rework-tasks.md:270-277` W3-S14 includes `Replace mutable tag cache with Effect-managed cache/ref`.
- Audit finding: `docs/AUDIT.md:135` H1 says the tag cache is shared mutable global state with no lock and recommends `Effect.Ref` plus `Effect.cached` or `Cache.make`.

## Current implementation and exact files

### `apps/backend/src/server.ts`

- Lines `111-120` define the problematic module global:
  - `interface TagCache { tags: Array<{ id: number; name: string }>; timestamp: number; }`
  - `const TAG_CACHE_TTL_MS = 60 * 1000`
  - `let tagCache: TagCache | null = null`
- Lines `229-237` create one Effect runtime from `AppLayer` for the HTTP server, so an Effect service added to `AppLayer` will be available to all request handlers.
- Lines `308-338` directly read/write the global cache during `/api/processing/:docId/stream`:
  - If `tagCache` is fresh, use it.
  - Else call `paperless.getTags()`.
  - On fetch failure, warn and fall back to stale cache if present, sending SSE step message `Using cached tag data`; otherwise send an SSE error and fail.
  - After a fetch, mutate `tagCache = { tags: allTags, timestamp: now }`.
- Lines `465-468` in full-pipeline mode re-fetch tags after each step via `paperless.getTags()` to include newly created tags. This should either force-refresh the new cache or explicitly update it, otherwise initial cache replacement only handles the first lookup.
- Lines `584-591` route processing SSE to `handleSSEStream`. That helper currently receives `res` but not `req`; close-handling is out of scope for this specific tag-cache task unless the worker is also assigned SSE interruption.

### `apps/backend/src/services/PaperlessService.ts`

- Lines `120-121`: service interface has `getTags(): Effect.Effect<Tag[], PaperlessErrorType>`.
- Lines `749-753`: implementation requests `GET /tags/` with `{ page_size: 1000 }` and returns `response.results`.
- Existing tag mutators (`getOrCreateTag`, `addTagToDocument`, `transitionDocumentTag`, rename/delete/merge below this area) do not invalidate any cache today. For this task, the server cache is the target, but adding a reusable service creates a clear place for later invalidation.

### Layer/export wiring

- `apps/backend/src/services/index.ts:47-50` exports `PaperlessService`; add a new service export here.
- `apps/backend/src/layers/index.ts:19-29` imports service live layers; add the cache service live layer here.
- `apps/backend/src/layers/index.ts:62-65` builds `CoreServicesLayer` from `PaperlessServiceLive` and `QdrantServiceLive` over base/TinyBase services. A tag cache service depending on `PaperlessService` should be provided **after** `PaperlessServiceLive`, e.g. via a small `Layer.provideMerge(TagCacheServiceLive(), CoreServicesLayerWithoutCache)` shape, or by merging it in a layer that receives `PaperlessService` in its environment.

### Adjacent mutable tag state worth knowing

- `apps/backend/src/agents/ProcessingPipeline.ts:548-563` uses a local object `tagMapRef = { current: new Map(...) }` inside `ProcessingPipelineServiceLive` and mutates it in `refreshTagMap`.
- `apps/backend/src/agents/ProcessingPipeline.ts:619-633` refreshes that local map after workflow tag transitions.
- This is not the H1 server module-global cache, but it is another mutable tag map. Do not broaden scope unless asked; mention it in PR notes if untouched.

### Tests and validation files

- Existing server tests: `apps/backend/tests/server.test.ts:1-92` only cover auth/CORS/read-only/header sanitization helpers.
- Existing Paperless service test: `apps/backend/tests/services/PaperlessService.test.ts` already shows how to build test layers with mocked `ConfigService`, `TinyBaseService`, `PaperlessServiceLive`, and mocked `fetch`.
- Best new unit test location: `apps/backend/tests/services/TagCacheService.test.ts` (new file). Optionally add a very small server helper test only if a helper is exported; avoid full HTTP integration unless needed.

## Recommended design

Create `apps/backend/src/services/TagCacheService.ts` using Effect service/layer patterns used elsewhere (`Context.GenericTag`, `Layer.effect`, `Ref.make`). Prefer `Ref` + a one-permit refresh semaphore over a plain module variable so state is owned by the Effect runtime and refreshes do not stampede.

Suggested public shape:

```ts
export type TagCacheSource = "cached" | "fresh" | "stale";

export interface TagCacheEntry {
  readonly tags: Tag[];
  readonly timestamp: number;
}

export interface TagCacheResult {
  readonly tags: Tag[];
  readonly source: TagCacheSource;
  readonly ageMs: number;
  readonly staleError?: unknown;
}

export interface TagCacheService {
  readonly getTags: () => Effect.Effect<TagCacheResult, PaperlessErrorType>;
  readonly refresh: () => Effect.Effect<TagCacheResult, PaperlessErrorType>;
  readonly invalidate: () => Effect.Effect<void>;
  readonly peek: () => Effect.Effect<TagCacheEntry | null>;
}
```

Implementation notes:

- Default TTL should preserve behavior: `60_000` ms.
- Use `Clock.currentTimeMillis` rather than `Date.now()` inside the service so tests can be deterministic if desired.
- `getTags()`:
  1. Read `Ref<Option/nullable entry>`.
  2. If present and `now - timestamp < ttlMs`, return `{ tags, source: "cached", ageMs }`.
  3. Otherwise acquire a one-permit semaphore/mutex, re-read the ref (another fiber may have refreshed), and fetch if still expired/missing.
  4. On successful fetch, set the ref with completion timestamp and return `source: "fresh"`.
  5. On fetch failure with a previous entry, return stale tags with `source: "stale"` and `staleError`; on failure with no entry, fail.
- `refresh()` should bypass TTL and fetch/update. If fetch fails and a stale entry exists, either return `source: "stale"` (matching current graceful fallback) or fail; choose one and test it. For preserving server behavior after full-pipeline steps, returning stale is acceptable but log the stale event.
- `invalidate()` clears the ref. Keep this available for future tag mutations even if not wired to every Paperless tag mutator in this task.

Server changes the worker should make:

- Remove `TagCache` interface, `TAG_CACHE_TTL_MS`, and `let tagCache` from `server.ts`.
- Import `TagCacheService` from `./services/index.js`.
- In `handleSSEStream` non-fullPipeline path, yield `const tagCache = yield* TagCacheService` alongside `PaperlessService`, `ProcessingPipelineService`, and `ConfigService`.
- Replace lines `308-338` with service usage:
  - `const tagResult = yield* tagCache.getTags().pipe(Effect.catchAll(...))`.
  - If `tagResult.source === "stale"`, preserve current warning and SSE message `Using cached tag data`. Include `tagResult.staleError` in the warning.
  - If no cache and fetch fails, preserve current SSE error `Failed to load tags: ${e}` and fail.
  - Build `tagMap` from `tagResult.tags`.
- Replace full-pipeline lines `466-468` with a forced cache refresh, e.g. `const updatedTagResult = yield* tagCache.refresh(); currentTagMap = new Map(updatedTagResult.tags.map(...))`. Preserve current error behavior or explicitly document/test stale fallback.

Layer wiring approach:

- Export `TagCacheService`, `TagCacheServiceLive`, and result types from `apps/backend/src/services/index.ts`.
- Add the live layer to `apps/backend/src/layers/index.ts` after `PaperlessServiceLive` is available. Keep only one instance in `AppLayer`; do not instantiate per request.

## Tests to add

Create `apps/backend/tests/services/TagCacheService.test.ts` with a mocked `PaperlessService` layer.

High-value cases:

1. **Caches within TTL**: two `getTags()` calls return same tags and `paperless.getTags` called once; second result has `source: "cached"`.
2. **Refresh after TTL / forced refresh**: with very low TTL or `refresh()`, service fetches again and updates tags.
3. **Stale fallback**: after one successful fetch, make `paperless.getTags` fail; expired `getTags()` returns prior tags with `source: "stale"` and exposes the error for logging.
4. **No stale cache failure**: first fetch failure returns a failed Effect.
5. **Concurrent refresh de-dupe**: when cache is cold/expired, two concurrent `getTags()` callers should result in one Paperless fetch if the semaphore/recheck is implemented.

Optional server test:

- If a helper is extracted for mapping `TagCacheResult` to SSE/log behavior, test it in `apps/backend/tests/server.test.ts`. Avoid brittle full SSE integration unless necessary.

## Validation commands

From repo root:

- `pnpm --filter @repo/backend test -- tests/services/TagCacheService.test.ts`
- `pnpm --filter @repo/backend test -- tests/server.test.ts`
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`

If filter syntax is not accepted in the local pnpm version, run from `apps/backend`:

- `pnpm run test -- tests/services/TagCacheService.test.ts`
- `pnpm run typecheck`
- `pnpm run lint`

## Risks and constraints

- Preserve current graceful fallback semantics: stale cache may be used when Paperless tag fetch fails; no-cache failure should still emit the existing SSE error and fail.
- Do not reintroduce prompt-file or PromptService paths; irrelevant here but mandatory project rule.
- Do not create a new cache per request. The cache must live in the server runtime/layer so it is shared safely through Effect state.
- Avoid scope creep into W3-S14 SSE close handling, request rate limiting, or frontend polling unless assigned separately.
- If touching `ProcessingPipeline.ts` local `tagMapRef`, be explicit: it is separate from the audited `server.ts` global cache and may need a larger design to avoid behavioral drift.

## Compact worker prompt

Goal: Replace the `server.ts` module-level mutable tag cache with an Effect-managed tag cache service. Preserve current SSE behavior, including 60s TTL and stale-cache fallback on Paperless tag-fetch failure.

Evidence: `apps/backend/src/server.ts:111-120` defines `let tagCache`; `server.ts:308-338` reads/writes it in processing SSE; `server.ts:465-468` force-fetches tags after full-pipeline steps. `PaperlessService.getTags` is defined at `apps/backend/src/services/PaperlessService.ts:120-121` and implemented at `749-753`. Service/layer exports are in `apps/backend/src/services/index.ts` and `apps/backend/src/layers/index.ts`.

Implement: Add `apps/backend/src/services/TagCacheService.ts` with `Context.GenericTag`, `Layer.effect`, `Ref`, and a refresh semaphore/mutex. API should return tags plus source (`fresh`/`cached`/`stale`) and support `refresh`, `invalidate`, `peek`. Wire it into service exports and `AppLayer`. Update `server.ts` to use `TagCacheService` and delete the global cache. Use forced refresh after full-pipeline step rechecks.

Tests: Add `apps/backend/tests/services/TagCacheService.test.ts` for TTL caching, forced refresh, stale fallback, no-stale failure, and concurrent refresh de-dupe. Run backend targeted tests plus typecheck/lint.

Stop/escalate: Ask before changing broader SSE interruption, rate limiting, frontend polling, or the separate `ProcessingPipeline.ts` local `tagMapRef`; those are adjacent W3-S14 items but not required for this todo.
