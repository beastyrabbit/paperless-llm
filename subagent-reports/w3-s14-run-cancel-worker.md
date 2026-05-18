# W3-S14 run cancellation worker report

## Implemented
- Added pipeline-owned active document run registry in `ProcessingPipelineServiceLive` storing the actual running Effect fiber, run metadata, and cancellation refs per document.
- Added `cancelDocumentRun` and `getActiveDocumentRun` to the processing pipeline service.
- Refactored document lock execution to fork/register the monitored pipeline fiber after durable lock acquisition, then join it to preserve existing blocking API behavior.
- Cancellation now sets a cancellation flag/reason, interrupts the active fiber, and lets the run finalizer release the durable lock and clear case state.
- Added `run_cancelled` processing log event and cancellation logging before `lock_released`.
- Added `POST /api/processing/:docId/cancel` with optional `runId`/`reason` body validation and structured responses for `cancelling`, `no_active_run`, and `run_mismatch`.
- Added `processingApi.cancel` and a document detail Cancel Run action shown while local/case processing is active.
- Preserved read-only behavior: cancel POST remains blocked by backend and web proxy read-only allowlists.

## Changed files
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/src/api/processing/handlers.ts`
- `apps/backend/src/services/TinyBaseService.ts`
- `apps/backend/tests/agents/ProcessingPipeline.test.ts`
- `apps/backend/tests/api/processing.test.ts`
- `apps/backend/tests/server.test.ts`
- `apps/web/app/documents/[id]/page.tsx`
- `apps/web/lib/api.ts`
- `apps/web/messages/en.json`
- `apps/web/messages/de.json`
- `apps/web/tests/api-proxy-readonly.test.ts`
- `packages/api-contracts/src/request-schemas.ts`
- `packages/api-contracts/src/types.ts`

## Validation
Passed:
- `pnpm --filter @repo/backend test -- ProcessingPipeline`
- `pnpm --filter @repo/backend test -- processing server`
- `pnpm --filter @repo/web test -- api-proxy-readonly`
- `pnpm --filter @repo/api-contracts build`
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/web typecheck`
- `pnpm --filter @repo/backend lint && pnpm --filter @repo/web lint && pnpm --filter @repo/api-contracts lint`

## Open risks / notes
- Cancellation interrupts the Effect fiber and releases lock/state from the run finalizer; external non-stream HTTP requests may still continue underneath until their own timeout if they do not support AbortSignal.
- The endpoint returns structured mismatch/no-active results in the JSON body; router-level HTTP status remains the existing default behavior.
- Workflow tags are not retagged on cancellation; case `activeRunId` is cleared and running case status is returned to `ready` by existing finalizer semantics.
