# W3-S14 / todo #13 SSE close worker handoff

## Implemented
- Added shared backend SSE close/cancellation helpers in `apps/backend/src/server.ts`:
  - `createSseCloseSignal(req, res)` aborts on request/response close and returns cleanup.
  - `abortableDelay(ms, signal)` resolves promptly when the signal aborts.
  - Safe SSE write/end helpers skip writes after abort/destroy/end.
  - `runEffectWithAbort(...)` runs Effect work with the SSE abort signal so active fibers are interrupted on client close.
- Updated processing SSE (`/api/processing/:docId/stream`) to create a close signal, pass it into Effect runtime execution, skip error emission after close, and only end the response if still writable.
- Updated case SSE (`/api/cases/document/:docId/stream`) to interrupt in-flight case/log lookup effects, re-check close before writes, and replace the 2s polling sleep with `abortableDelay`.
- Updated catalog SSE (`/api/catalog/runs/:runId/stream`) with the same interruptible runtime execution, post-await close checks, safe writes, and abortable polling sleep.
- Added focused tests in `apps/backend/tests/server.test.ts` for abortable delays and Effect interruption/finalizer execution on abort.

## Changed files
- `apps/backend/src/server.ts`
- `apps/backend/tests/server.test.ts`
- `progress.md`
- `subagent-reports/w3-s14-sse-close-worker.md`

## Validation
- Passed: `pnpm --filter @repo/backend test -- server.test.ts`
- Passed: `pnpm --filter @repo/backend test -- server.test.ts tests/api/cases.test.ts`
- Passed: `pnpm --filter @repo/backend lint`
- Blocked by unrelated existing errors: `pnpm --filter @repo/backend typecheck`
  - `src/api/index.ts` imports missing `LockReleaseBodySchema` and `SearchQuerySchema` from `@repo/api-contracts`.
  - `src/api/index.ts(839,60)` passes `unknown` where `string` is expected.

## Risks / notes
- The worktree had extensive pre-existing dirty/untracked changes; edits were limited to backend server/test SSE close handling plus requested progress/report files.
- No frontend, metrics, tracing, or health changes were made.
- Normal open-connection SSE event payload shapes are preserved; abort/close paths suppress writes and final error events after disconnect.
