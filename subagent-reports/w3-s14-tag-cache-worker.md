# W3-S14 / Todo #12 Tag Cache Worker Report

## Changed files
- `apps/backend/src/services/TagCacheService.ts`
- `apps/backend/src/services/index.ts`
- `apps/backend/src/layers/index.ts`
- `apps/backend/src/server.ts`
- `apps/backend/tests/services/TagCacheService.test.ts`
- `progress.md`

## Behavior implemented
- Added an Effect-managed `TagCacheService` backed by `Ref<TagCacheEntry | null>` and a one-permit semaphore to avoid cold/expired-cache refresh stampedes.
- Preserved the 60s default TTL for cached Paperless tags.
- `getTags()` returns `fresh`, `cached`, or `stale` source metadata; stale tags are returned only when a previous cache entry exists and a refresh fails.
- `refresh()` bypasses TTL, updates the cache on success, and falls back to stale cached tags on failure.
- `invalidate()` and `peek()` are available for future mutation paths/tests.
- Removed the mutable module-level `tagCache`/`TAG_CACHE_TTL_MS` from `server.ts`.
- Processing SSE initialization now uses `TagCacheService.getTags()` and preserves the existing no-cache failure SSE error and stale-cache `Using cached tag data` event.
- The existing server full-pipeline loop tag recheck was changed to use `TagCacheService.refresh()` so newly-created tags update the shared cache when that path is used.

## Validation
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/backend test -- tests/services/TagCacheService.test.ts tests/server.test.ts` — passed, 11 tests.
- `pnpm --filter @repo/backend lint` — passed.

## Remaining gaps / risks
- Requested `context.md` and `plan.md` were missing at repo root, so implementation used `subagent-reports/todo-12-tag-cache-handoff.md` and code inspection.
- The worktree already contained many unrelated dirty/untracked changes; only the tag-cache-related files above were intentionally changed.
- `ProcessingPipeline.ts` still has its separate local mutable tag map; left untouched per scope.
