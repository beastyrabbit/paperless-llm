# Todo #16 / W3-S14 handoff: user-facing cancellation of in-flight document runs

## Requirement distilled

Build cancellation for **in-flight document processing runs** (manual document/case runs, processing SSE runs, and auto-processing runs), not just lock release. The implementation must own/track the actual Effect `Fiber` for a document run and interrupt it from an API/UI action. Do **not** present `LockService.release()` alone as cancellation; that creates split-brain if the pipeline fiber keeps running after the lock is removed.

Source requirement evidence:
- `docs/AUDIT.md:103-105`: `E9` stale lock recovery and `E10` “No user-facing cancellation for in-flight runs”; fix says expose a cancel endpoint and interrupt the running Effect.
- `docs/plans/audit-rework-tasks.md:280-289`: W3-S14 includes “Add user-facing cancel endpoint for in-flight runs”; acceptance: “In-flight processing can be cancelled or lock-released through supported paths.”

## Current architecture and exact code points

### Pipeline lock lifecycle exists, but no external fiber ownership/cancel API

`apps/backend/src/agents/ProcessingPipeline.ts`
- Service interface (`:65-86`) exposes `processDocument`, `processDocumentStream`, `processStep`, `processStepStream`, `getCurrentState`; no cancel/list-active method.
- `acquireDocumentLock` (`:340-395`) acquires durable `LockService` lock with owner `pipeline`, writes `activeRunId` to document case, and logs `run_started`.
- `heartbeatWatchdog` (`:397-432`) keeps lock alive and fails after missed heartbeats.
- `withDocumentLock` (`:434-509`) wraps a supplied effect, logs `run_completed`/`run_failed`, releases `LockService` lock in `Effect.ensuring`, clears `activeRunId`, sets `lastRunId`, and logs `lock_released`.
- `processDocument` (`:862-1031`) and `processStep` (`:1033-1129`) run the real OCR/metadata/index effects under `withDocumentLock`, but they are awaited directly by the caller; no `Fiber.RuntimeFiber` is stored where an API handler can interrupt it.
- Stream wrappers (`:1133-1215`) call the same methods and emit SSE events, but do not own a cancellable run registry.

Important behavior: if a run is interrupted correctly, `withDocumentLock`’s `ensuring` block should release the durable lock and clear `activeRunId`. But current `tapError(recordStageFailure)` probably will not run for pure Effect interruption; design needs an explicit cancellation path/log/state update, not only failure classification.

### Durable locks are not cancellation

`apps/backend/src/services/LockService.ts`
- Interface (`:30-48`) has `acquire`, `release`, `get`, `heartbeat`, `list`, `pruneStale`.
- Default TTL is 15 minutes (`:52`).
- `release` (`:126-143`) deletes the TinyBase row only if optional `runId` matches. It does not know about, signal, or interrupt running fibers.
- `list`/`pruneStale` (`:172-213`) support admin stale-lock work but are not exposed through document-processing API today.

Split-brain risk: releasing `document:42` while `ProcessingPipeline.processDocument({ docId: 42 })` continues lets another run acquire the lock and mutate the same Paperless document/case concurrently.

### Existing cancellable job pattern to reuse

`apps/backend/src/jobs/BulkOcrJob.ts`
- Imports `Fiber`/`Ref` (`:4`).
- Maintains `fiberRef` and `cancelledRef` (`:72-73`).
- `start` rejects duplicate running job (`:78-86`), forks daemon work (`:208-219`), stores fiber (`:221`), and clears fiberRef after `Fiber.await` (`:224-229`).
- `cancel` sets cancelled flag, interrupts stored fiber, clears ref, and updates progress to `cancelled` (`:234-248`).

Similar pattern exists for auto-processing’s daemon loop:
`apps/backend/src/services/AutoProcessingService.ts`
- Keeps `fiberRef` for background loop (`:60`) and interrupts it in `stop` (`:386-400`).
- The loop calls `pipeline.processDocument({ docId: doc.id })` directly (`:306-328`), so document-level cancel must be inside/shared by `ProcessingPipelineService`, not only HTTP request code, or auto-processing runs will remain uncancellable.

### API routes and handlers lack run cancel

`apps/backend/src/api/processing/handlers.ts`
- `startProcessing` (`:12-37`) invokes pipeline directly and returns only after completion/needs_review/failure.
- `getProcessingStatus` (`:56-72`) reflects auto-processing status only; it cannot report manually-started in-flight runs.
- No cancel handler.

`apps/backend/src/api/cases/handlers.ts`
- `runCase` (`:370-393`) runs `pipeline.processDocument({ docId, resume, dryRun })` directly.
- `reconcileRunningCase` (`:192-225`) recovers a case if no active lock exists, but that is stale-lock reconciliation, not active cancellation.

`apps/backend/src/api/index.ts`
- Processing routes around `:500-527`: `POST /api/processing/:docId/start`, `POST /confirm`, `GET /status`, logs. No `cancel`.
- Case run route around `:541-548`: `POST /api/cases/document/:docId/run`. No case cancel.
- Job cancel examples around `:383-398`, `:410-425`: `POST /api/jobs/bootstrap/cancel`, `/bulk-ocr/cancel`, `/bulk-ingest/cancel`.

`packages/api-contracts/src/request-schemas.ts`
- `ProcessingStartBodySchema` (`:98-102`) allows only `step` and `dryRun`.
- `CaseRunBodySchema` (`:103-106`) allows `resume` and `dryRun`.
- Add any cancel request/response schema here if using body validation/contracts.

### SSE stream currently can start real work and is not interrupted on client close

`apps/backend/src/server.ts`
- Processing SSE pattern: `SSE_STREAM_PATTERN = /^\/api\/processing\/(\d+)\/stream$/` (`:126`).
- Read-only mode blocks GET processing stream because it mutates documents (`:146-149` and test below).
- `handleSSEStream` (`:240-519`) runs `pipeline.processDocumentStream` for `full=true` (`:271-282`) or loops `pipeline.processStepStream` (`:420-488`) and writes events.
- No `req.on("close")`/abort signal for the processing SSE path; if browser disconnects, the server-side Effect can keep running. Case/catalog SSE loops do set `closed` on request close (`:601-642` etc.), but processing SSE does not.

This is adjacent to, but distinct from, user cancel. Worker should consider whether closing an SSE connection is “cancel” or just “unsubscribe”. For user-facing cancellation, prefer an explicit cancel button/endpoint; optionally make processing SSE disconnect interrupt only the stream-driven run to avoid orphaned work.

### Read-only mode must block cancel endpoints in both backend and frontend proxy

Backend: `apps/backend/src/server.ts`
- `isReadOnlyRequestAllowed` (`:143-158`) allows safe methods, blocks `GET /api/processing/:id/stream`, allows only one safe POST class (`/api/settings/test-connection/...`). New cancel route using POST/DELETE will be blocked by default. If using GET for status only, keep safe.

Frontend proxy: `apps/web/app/api/[...path]/route.ts`
- Mirrors read-only logic (`:14-35`). New POST cancel is blocked by default; if adding any safe GET active-runs endpoint, it will be allowed unless added to blocked-safe list.

Tests: `apps/backend/tests/server.test.ts:72-89` and `apps/web/tests/api-proxy-readonly.test.ts` cover read-only allow/block. Add cancel route expectations.

### UI currently starts runs but has no cancellation affordance

`apps/web/lib/api.ts`
- `processingApi` (`:309-337`) has `start`, `stream`, `confirm`, status/logs, auto trigger; no cancel.
- `casesApi.run` (`:340-344`) wraps `POST /api/cases/document/:docId/run`; no cancel.
- Jobs API has cancellation examples (`:523-559`): `cancelBootstrap`, `cancelBulkOCR`, `cancelBulkIngest`.

`apps/web/app/documents/[id]/page.tsx`
- Document detail page imports `casesApi` but not `processingApi` (`:42-54`).
- `runCase` (`:563-573`) sets local `processing=true`, awaits `casesApi.run`, refreshes, then sets `processing=false`. Because the request blocks until completion, the UI can only show a spinner for the initiating tab’s request.
- Header actions (`:722-781`) show Refresh, Paperless link, fast review, logs, answer questions, complete, or Run/Retry button. No cancel button.
- `caseStatus`/`processingStatus` derived around `:643-658`; running status is displayed but not actionable.

Potential UX placement: show a destructive/outline “Cancel run” button when either local `processing` is true or `caseRecord.automationStatus === "running" && caseRecord.activeRunId` is set. The button should call the cancel endpoint with the active runId if available, then refresh case/document/logs.

### Contracts/status types currently have no “cancelled” document-case status

`apps/backend/src/services/DocumentCaseService.ts`
- `CasePhase` (`:17`) = `new | ocr | metadata | index | done | failed`.
- `CaseAutomationStatus` (`:18-25`) = `idle | queued | running | needs_input | ready | done | failed`; no `cancelled`.

`packages/api-contracts/src/types.ts`
- `DocumentCase.automationStatus` (`:815-837`) mirrors same union; no `cancelled`.
- `ProcessingLogEventType` (`:720-725`) has `run_started`, `run_completed`, `run_failed`, `lock_released`, etc.; no `run_cancelled`.

Design choice needed: either (A) add `cancelled` to backend/contracts/UI labels and log event type `run_cancelled`, or (B) represent cancellation as `automationStatus: "ready"`/`phase: previous-or-new`, `activeRunId: null`, `lastRunId`, `lastFailure: null`, plus a processing log with existing `eventType: "result"` or `"error"`. I recommend adding explicit `run_cancelled` log event; adding `automationStatus: "cancelled"` is user-clear but wider because filters and labels need updates.

### External I/O interruption risk

`apps/backend/src/utils/http.ts`
- `fetchWithTimeout` supports an upstream `AbortSignal` in `init.signal` (`:32-44`) and aborts underlying fetch (`:49-58`). Good foundation.

But non-stream service requests generally do not pass an Effect interruption signal into fetch:
- `apps/backend/src/services/MistralService.ts:166-213` wraps `fetchWithTimeout` in `Effect.tryPromise` without a signal. Interrupting the Effect fiber may stop awaiting, but the underlying HTTP request may continue until timeout unless wired with an abort callback/signal.
- `apps/backend/src/services/OllamaService.ts` streaming methods create `AbortController` and return an abort finalizer from `Stream.asyncEffect` (`:246-343`, `:374-...`). Non-stream `request` paths also use `Effect.tryPromise` around `fetchWithTimeout` without interruption signal.

Implementation risk: Fiber cancellation must be tested at the Effect level (lock/case/log cleanup), but actual network I/O may continue in background until timeout for Mistral/Paperless/Ollama non-stream calls unless those Effect wrappers become interruption-aware. If worker is scoped strictly to user-facing pipeline cancellation, still call this out in code comments/tests or wire abort for the services touched by pipeline.

## Recommended implementation design

### 1) Add a pipeline-owned active run registry

Best location: inside `ProcessingPipelineServiceLive`, because all entry points (processing API, case API, auto-processing, SSE) already share this service from the app layer.

Extend `ProcessingPipelineService` with methods like:
- `cancelDocumentRun(input: { docId: number; runId?: string; reason?: string }): Effect.Effect<CancelRunResult, AgentError>`
- `getActiveDocumentRun(docId: number): Effect.Effect<ActiveRunInfo | null, never>` or `listActiveRuns()` for status/UI/admin.

Registry shape can be `Ref<Map<number, ActiveRun>>` or `Ref<Map<string, ActiveRun>>`, where `ActiveRun` includes `docId`, `runId`, `startedAt`, `source` (`manual|case|sse|auto|step` if available), `step?`, `fiber`, and a `cancelRequested` flag/ref/deferred if needed.

Important: `runId` is produced only after `acquireDocumentLock`. Therefore register the fiber inside/just after `withDocumentLock` acquires the lock. Existing `withDocumentLock` currently receives `effect` and then executes it inline. Refactor it so the monitored effect is forked and stored before being joined/awaited by the caller:
1. acquire durable lock.
2. build `monitoredEffect` with current completion/failure/ensuring behavior plus explicit cancellation cleanup/logging.
3. fork `Effect.raceFirst(monitoredEffect, heartbeatWatchdog(...))` or fork the monitored race.
4. `Ref.update(activeRuns, set docId/runId -> fiber/info)`.
5. await/join the fiber so existing APIs still block/return same result.
6. in `ensuring`/finalizer, remove registry entry only if same runId, release lock, clear activeRunId, log lock release.

Guard duplicate active registry entries: if a lock is held but registry missing, return lock contention as today. If registry has a run but no lock, treat as bug; do not allow starting a second run.

### 2) Cancellation semantics

Endpoint should interrupt the fiber first, then rely on finalizers to release lock and clear case state.

Suggested result cases:
- `202`/success-ish: active run found and cancellation requested/interrupted. Return `{ status: "cancelling"|"cancelled", doc_id, run_id }`.
- `404` or idempotent `200`: no active in-memory run for doc/run. If lock exists, return `{ status: "no_active_run", lock }` and tell caller it may be stale/admin-release-only. Avoid deleting lock in normal user cancel unless matching active fiber is found.
- `409`: runId mismatch when caller provided a stale `activeRunId`.

Case/log state:
- Log `run_cancelled` (add event type) or `result` with `{ cancelled: true }` if not extending union.
- Clear `activeRunId`, set `lastRunId` to cancelled run, set `automationStatus` to `ready` or `queued` (or explicit `cancelled` if adding that status), and avoid setting `lastFailure` unless product wants cancellation treated as failure.
- Consider workflow tag after cancellation: if cancellation occurred mid-stage, document may have `llm-ocr`/`llm-metadata`/`llm-index`. Leaving an active-stage tag means auto-processing may resume later. Retagging to `todo` is safer for “cancel and stop for now”, but may surprise users by undoing visible state. At minimum document in response/log; choose one source-of-truth. The existing stale recovery retags active-without-lock cases to queued (`apps/backend/src/api/cases/handlers.ts:80-188`).

### 3) API surface

Minimal endpoints:
- `POST /api/processing/:docId/cancel` (user-facing document run cancel). Body optional `{ runId?: string, reason?: string }`.
- Optional safe `GET /api/processing/:docId/run` or include active run in existing `GET /api/cases/document/:docId`/`GET /api/processing/status` so UI can decide when to show cancel.

Where to wire:
- Add handler in `apps/backend/src/api/processing/handlers.ts` using `ProcessingPipelineService.cancelDocumentRun`.
- Add route in `apps/backend/src/api/index.ts` near processing routes.
- Add contracts in `packages/api-contracts/src/request-schemas.ts` if validating a body; update openapi map (`packages/api-contracts/src/openapi.ts`) if adding schemas.
- Add `processingApi.cancel(docId, runId?)` in `apps/web/lib/api.ts`.

Read-only: POST cancel is blocked by default in backend and frontend proxy. Add tests to lock this in; no allow-list addition needed.

### 4) UI

`apps/web/app/documents/[id]/page.tsx` is the immediate user-facing surface.
- Import `processingApi` and `X`/stop icon already imported (`X` is present).
- Show “Cancel run” when `processing` is true or `caseRecord?.automationStatus === "running"` with `activeRunId`.
- Handler calls `processingApi.cancel(docId, caseRecord?.activeRunId ?? undefined)`, sets action error on failure, refreshes document/case, and clears local `processing` if this tab started the run.
- Disable Run/Retry while running; disable Cancel while cancel request is in flight.
- Add translations in `apps/web/messages/en.json` and `de.json` for cancel action/status if needed. Existing common `cancel` exists, but document-specific “cancel run/cancelling/cancelled” likely needs keys.

Longer-term UI: active run status could also appear in sidebar/dashboard because auto-processing status exposes current doc (`apps/web/components/sidebar.tsx`, dashboard hooks), but detail page is enough for user-facing document-run cancellation.

## Split-brain and race risks to handle explicitly

1. **Lock release without fiber interrupt**: never use normal cancel endpoint to just `locks.release`; interrupt active fiber first.
2. **RunId mismatch**: UI may have stale `activeRunId`; cancel endpoint should compare provided runId to registry/lock and return conflict/no-op rather than cancel a newer run.
3. **Registry cleanup race**: if run finishes while cancel request arrives, endpoint should be idempotent and return completed/no-active, not fail with 500.
4. **Auto-processing current refs**: auto loop sets `currentDocRef` before calling pipeline and clears after it returns (`AutoProcessingService.ts:300-332`). If cancellation interrupts pipeline and is caught by auto loop’s `catchAll`, current refs should still clear. Verify with test if possible.
5. **SSE disconnect vs cancel**: a disconnected browser should not leave a request-local stream running forever. If worker adds close interruption, decide whether that is “cancel processing” or “unsubscribe”. For explicit cancel button, use API endpoint.
6. **Underlying HTTP request abort**: pipeline fiber interruption may not abort non-stream `Effect.tryPromise` fetches. For true cancellation under slow Mistral/Paperless/Ollama, wire AbortSignal into service request helpers or accept timeout-bound background I/O as a known limitation.
7. **State after cancellation**: active-stage tags/case phase can cause auto-processing to immediately resume. Decide whether user cancel means “stop this run but leave queued” or “pause until user manually reruns”. Current statuses lack `cancelled`; `ready` plus log is least schema churn, explicit `cancelled` is clearer.

## Test plan

Backend unit tests:
- Extend `apps/backend/tests/agents/ProcessingPipeline.test.ts`.
  - Mock OCR/metadata as a never-ending `Effect.async` or long `Effect.sleep` to start a run.
  - Start `pipeline.processDocument({ docId })` in a forked test fiber.
  - Wait until `activeRunId`/registry is visible, call `cancelDocumentRun({ docId, runId })`.
  - Assert the run fiber exits/interrupted, `LockService.release("document", docId, runId)` called, `DocumentCaseService.updateCase` clears `activeRunId` and sets expected status/lastRunId, `TinyBaseService.addProcessingLog` records cancellation and `lock_released`.
  - Add runId mismatch test: wrong runId does not interrupt and returns conflict/failure.
  - Add no-active-run test: returns no-op/stale lock response and does not release lock unless explicitly designed.

API tests:
- Add/extend API router/handler tests if present, or integration-style handler test for `processingHandlers.cancelProcessing`.
- Extend `apps/backend/tests/server.test.ts` to assert read-only blocks `POST /api/processing/123/cancel`.
- Extend `apps/web/tests/api-proxy-readonly.test.ts` similarly for proxy.

Frontend tests:
- Add document detail page test if existing test harness supports it; otherwise test `processingApi.cancel` shape and read-only proxy.
- UI behavior to cover: running case shows Cancel, clicking calls endpoint with activeRunId, refreshes, and clears spinner/error handling.

Manual validation:
1. Start backend/web (`pnpm run dev` or targeted backend/web dev).
2. Start processing a document from detail page.
3. Confirm case has `automationStatus=running` and `activeRunId`.
4. Click Cancel.
5. Confirm HTTP response cancellation, log entry appears, lock row is gone, `activeRunId` cleared, button returns to Run/Retry, and no second/further pipeline mutation occurs after cancel.
6. Try stale runId cancel and no-active cancel.
7. Enable read-only env and confirm cancel returns 403 through backend and web proxy.

Targeted commands:
- `pnpm --filter @repo/backend test -- ProcessingPipeline` (or repo’s actual backend test command if filters differ)
- `pnpm --filter @repo/backend test -- server`
- `pnpm run typecheck`
- `pnpm run lint`

## Compact worker prompt

Implement user-facing cancellation for in-flight document processing runs. Add a pipeline-owned active run registry that stores the actual `Fiber.RuntimeFiber` for each document run after `withDocumentLock` acquires its runId, and expose `cancelDocumentRun`/active-run lookup on `ProcessingPipelineService`. The cancel path must interrupt the fiber before releasing/clearing lock state; do not implement cancellation as lock release only. Add `POST /api/processing/:docId/cancel` with optional runId guard, wire `processingApi.cancel`, and show a Cancel Run action on `apps/web/app/documents/[id]/page.tsx` when the case/local state is running. Log cancellation, release locks via existing finalizers, clear `activeRunId`, and handle stale/no-active and runId-mismatch cases without split-brain. Preserve read-only protections (new mutating cancel route must be 403 in read-only mode) and add focused backend/UI/proxy tests. Watch for non-stream fetches that are not abort-aware; at minimum document/contain the limitation, ideally wire abort signals where pipeline cancellation depends on slow Mistral/Paperless/Ollama calls.
