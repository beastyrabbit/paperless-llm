# W3-S14 Tag Cache Fix Worker Report

## Changed files
- `apps/backend/src/server.ts`
- `apps/backend/tests/server.test.ts`
- `progress.md`
- `subagent-reports/w3-s14-tag-cache-fix-worker.md`

## Exact fix
- Removed the early `fullPipeline` SSE return that delegated directly to `pipeline.processDocumentStream({ docId, dryRun })`.
- `full=true` streams now continue through the server-managed full-pipeline loop, which performs the initial `TagCacheService.getTags()` lookup and `TagCacheService.refresh()` between steps.
- Added `createHttpServerWithLayer(...)` as a narrow test seam with an option to skip background service startup; the public `createHttpServer(...)` behavior remains delegated to the same default AppLayer path.
- Added a focused server test proving `/api/processing/:id/stream?full=true` calls `TagCacheService.getTags()`/`refresh()`, uses `processStepStream`, and does not call `processDocumentStream`.

## Validation
- `pnpm --filter @repo/backend test -- tests/services/TagCacheService.test.ts tests/server.test.ts` ✅
- `pnpm --filter @repo/backend typecheck` ✅
- `pnpm --filter @repo/backend lint` ✅

## Notes / risks
- `context.md` and `plan.md` were not present in the workspace.
- This resolves the reviewed bypass in the server full-pipeline SSE path. `ProcessingPipeline.processDocumentStream` still contains its own local tag-map/direct tag-fetch behavior, but that path is no longer used by the `full=true` SSE route.

## Ready for re-review
Yes.
