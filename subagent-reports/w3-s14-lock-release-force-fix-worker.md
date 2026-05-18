# W3-S14 Todo #15 Lock Release Force/RunId Fix

## Changed files

- `apps/backend/src/services/LockService.ts`
- `apps/backend/src/api/processing/handlers.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/tests/api/processing.test.ts`
- `apps/backend/tests/services/LockService.test.ts`
- `subagent-reports/w3-s14-lock-release-force-fix-worker.md`

## Fixes implemented

- Backend lock release now requires one of:
  - a non-empty `runId` that matches the active lock; or
  - explicit `force: true`.
- `force: false`, omitted `force` with no run ID, and empty/whitespace-only `runId` no longer release locks.
- The route now passes the full decoded lock-release request (`{ runId?, force? }`) into the processing handler instead of dropping `force`.
- `LockService.release(...)` is now guarded-only and refuses empty run IDs.
- Added an explicit `LockService.forceRelease(...)` API for unconditional release, used only when the handler sees `force === true`.
- Processing log metadata now records `force: true` only for explicit force releases and `force: false` for matching-run releases.
- Existing UI behavior/copy was not changed; the frontend default `{ force: true }` remains explicit and read-only blocking was untouched.

## Tests added/updated

- `apps/backend/tests/api/processing.test.ts` now covers:
  - no active lock;
  - omitted force/no runId does not release;
  - `force: false` does not release;
  - empty/whitespace `runId` does not release;
  - matching runId releases and trims surrounding whitespace;
  - mismatched runId does not release;
  - `force: true` force releases.
- `apps/backend/tests/services/LockService.test.ts` now covers:
  - empty runId guard does not release;
  - explicit `forceRelease(...)` releases.

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/api/processing.test.ts tests/services/LockService.test.ts tests/server.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

The targeted server test run still emits the existing Qdrant compatibility warning in two tests, but all tests pass.

## Open risks/questions

- None for this scope.
