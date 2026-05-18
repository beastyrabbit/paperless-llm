# W3-S14 / Todo #15 — Lock release worker report

## Implemented
- Added shared API contract support for lock recovery:
  - `LockReleaseBodySchema` with optional `runId`/`force`.
  - `DurableLock`, lock release/list/prune response types.
  - OpenAPI route entries for release/list/prune lock endpoints.
- Added backend processing lock admin endpoints:
  - `GET /api/processing/locks` lists durable locks.
  - `POST /api/processing/locks/prune` prunes stale locks.
  - `POST /api/processing/:docId/release-lock` releases a document lock, guarded by optional `runId` or force-released when omitted.
- Release handler behavior:
  - Fetches and returns the previous lock.
  - Returns released=false when no lock exists.
  - Returns success=false on run-id mismatch.
  - Logs manual `lock_released` on success.
  - Clears matching document case `activeRunId` and moves recoverable statuses to `queued` without overwriting terminal/needs-input statuses.
- Added settings Processing tab “Admin lock recovery” UI card:
  - Document ID input, optional run ID input, warning copy, confirm prompt, use-current-doc helper, loading state, success/error feedback.
  - Uses `processingApi.releaseLock()` and refreshes global auto status afterward.
  - Added English and German translations.
- Kept read-only safety by not allowlisting lock mutation endpoints and added explicit read-only assertions.

## Changed files
- `packages/api-contracts/src/request-schemas.ts`
- `packages/api-contracts/src/types.ts`
- `packages/api-contracts/src/openapi.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/src/api/processing/handlers.ts`
- `apps/backend/tests/api/processing.test.ts`
- `apps/backend/tests/api/router.test.ts`
- `apps/backend/tests/server.test.ts`
- `apps/backend/tests/services/LockService.test.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/settings/components/ProcessingTab.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/de.json`
- `apps/web/tests/processing-tab.test.tsx`
- `progress.md`

## Validation
- `pnpm --filter @repo/backend test -- LockService processing router server` ✅
- `pnpm --filter @repo/web test -- processing-tab` ✅
- `pnpm --filter @repo/backend typecheck` ✅
- `pnpm --filter @repo/web typecheck` ✅
- `pnpm --filter @repo/api-contracts typecheck` ✅
- `pnpm --filter @repo/backend lint` ✅
- `pnpm --filter @repo/web lint` ✅

## Notes / risks
- The UI intentionally warns and confirms because force-releasing a live lock can permit duplicate processing.
- The endpoint does not retag Paperless workflow tags directly; existing case reconciliation can recover tags on case/list access.
- Worktree contains many pre-existing unrelated modified/untracked files; only the files above were intentionally changed for this task.
