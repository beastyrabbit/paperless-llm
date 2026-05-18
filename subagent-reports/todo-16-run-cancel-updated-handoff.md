# Todo #16 / W3-S14 updated handoff: user-facing cancellation of in-flight document runs

## Distilled requirement

Implement **user-facing cancellation of in-flight document processing runs** using the current code state after W3-S14 rate-limit, shared concurrency, SSE tag-cache, and retry/timeout work. Cancellation must interrupt the **actual Effect fiber** running the pipeline and must not be implemented as durable lock release alone.

Source requirement:
- `docs/AUDIT.md:103-105`: `E9` stale lock recovery and `E10` “No user-facing cancellation for in-flight runs”; fix says expose a cancel endpoint and interrupt the running Effect.
- `docs/plans/audit-rework-tasks.md:280-289`: W3-S14 includes “Add user-facing cancel endpoint for in-flight runs”; acceptance says “In-flight processing can be cancelled or lock-released through supported paths.”

## Latest code state and relevant files

### Processing pipeline: locks exist, but no cancel/active-run API

`apps/backend/src/agents/ProcessingPipeline.ts`
- Service interface currently exposes only run/stream/state methods; no active-run lookup or cancellation method (`ProcessingPipelineService` around `:80-95`).
- `acquireDocumentLock` obtains durable `LockService` lock, writes `activeRunId`, and logs `run_started` (`:340-395`).
- `heartbeatWatchdog` keeps lock alive and fails after missed heartbeats (`:396-430`).
- `withDocumentLock` runs the supplied Effect inline and races it with heartbeat (`:432-515`). Important cleanup already exists:
  - releases `locks.release("document", docId, lock.runId)` (`:482-484`)
  - clears `activeRunId`, sets `lastRunId`, and maps running case back to `ready` (`:485-499`)
  - logs `lock_released` (`:503-508`)
  - currently returns `Effect.raceFirst(monitoredEffect, heartbeatWatchdog(...))` directly (`:513`), so no stored `Fiber.RuntimeFiber` can be interrupted by an API call.
- Entrypoints all go through `withDocumentLock` but are awaited by caller:
  - `processDocument` (`:868-1049`)
  - `processStep` (`:1052-1130`)
  - `processDocumentStream` delegates to `service.processDocument` (`:1133-1179`)
  - `processStepStream` delegates to `service.processStep`, except metadata step wraps its own `withDocumentLock` (`:1181-1212`).

Implementation consequence: the active run registry belongs inside `ProcessingPipelineServiceLive`, not in HTTP handlers, because manual processing, case runs, auto-processing, and SSE all reach the service.

### Durable locks are coordination, not cancellation

`apps/backend/src/services/LockService.ts`
- Interface has `acquire`, `release`, `get`, `heartbeat`, `list`, `pruneStale` (`:37-55`).
- `release` only deletes the TinyBase lock row, with optional runId guard (`:151-159`). It does not signal or stop pipeline work.
- `list`/`pruneStale` are available for future admin stale-lock work (`:205-215` etc.), but normal user cancel must interrupt the in-memory fiber first.

Split-brain risk: releasing `document:42` while the pipeline fiber continues allows a second run to acquire the lock and mutate the same document/case concurrently.

### Existing cancellation pattern to reuse

`apps/backend/src/jobs/BulkOcrJob.ts`
- Uses `Ref<Fiber.RuntimeFiber | null>` and a cancellation flag (`:71-72`).
- Forks daemon work, stores the fiber, and clears it after `Fiber.await` (`:221-243`).
- `cancel` sets cancelled flag, interrupts stored fiber, clears ref, and marks progress cancelled (`:248-260`).

`apps/backend/src/services/AutoProcessingService.ts`
- Auto-processing calls `pipeline.processDocument({ docId })` directly (`:305-325`), so pipeline-owned cancellation is required for auto runs.
- It has its own loop fiber and stop interrupt (`:386-393`), but that only stops the service loop, not an exposed user document cancel API.

### Backend APIs currently lack cancel

`apps/backend/src/api/processing/handlers.ts`
- `startProcessing` calls `pipeline.processStep`/`pipeline.processDocument` and returns after completion (`:14-41`).
- `getProcessingStatus` only reflects auto-processing state and queue length (`:69-80`); it does not list manual in-flight runs.
- No cancel handler.

`apps/backend/src/api/cases/handlers.ts`
- `reconcileRunningCase` handles stale/running case recovery when no active lock exists (`:193-225`); this is stale cleanup, not active cancellation.
- `runCase` calls `pipeline.processDocument({ docId, resume, dryRun })` directly (`:370-382`).

`apps/backend/src/api/index.ts`
- Processing routes include start/confirm/status/logs/auto (`:508-540`), but no `/cancel` route.
- Case run route remains `POST /api/cases/document/:docId/run` (`:552+`), no case cancel route.

`packages/api-contracts/src/request-schemas.ts`
- `ProcessingStartBodySchema` and `CaseRunBodySchema` exist (`:98-106`). Add `ProcessingCancelBodySchema` here if validating cancel body.

### Latest W3-S14 changes that affect design

**Rate limiting/read-only:**
- Backend server now has `RateLimitConfig`, `createRateLimiter`, and applies rate limiting before route dispatch (`apps/backend/src/server.ts:146-164`, `:404-411`, `:720-728`). New cancel POST will be subject to rate limiting; no special bypass is needed.
- Backend read-only allowlist allows safe methods and only settings test POSTs; GET processing stream is explicitly blocked (`apps/backend/src/server.ts:166-178`). A `POST /api/processing/:docId/cancel` will be blocked by default in read-only mode.
- Frontend proxy mirrors read-only logic (`apps/web/app/api/[...path]/route.ts:18-35`); a POST cancel will be blocked by default there too.

**Shared concurrency caps:**
- `ConcurrencyLimitService` exposes `withOllama`, `withMistral`, `withOcr` semaphores from config (`apps/backend/src/services/ConcurrencyLimitService.ts:7-34`).
- OCR/Mistral/Ollama paths use those gates (`apps/backend/src/agents/OCRAgent.ts:92`, `:210`; `apps/backend/src/services/MistralService.ts:99`, `:205`; `apps/backend/src/services/OllamaService.ts:119`, `:193`).
- Cancellation must not leak semaphore permits. Effect semaphore finalizers should release permits on fiber interruption, but tests should include a never/slow gated Effect or assert follow-up work can run after cancel if practical.

**Tag cache / SSE:**
- Full processing SSE no longer calls `processDocumentStream`; it fetches tags via `TagCacheService`, computes next step, loops `pipeline.processStepStream`, then refreshes tags after each successful step (`apps/backend/src/server.ts:413-430`, `:580-627`).
- `TagCacheService` is Effect-managed with a `Ref` cache and one-refresh semaphore (`apps/backend/src/services/TagCacheService.ts:25-42`, `:77-103`).
- Current processing SSE still does **not** attach `req.on("close")` to interrupt the processing stream. The route calls `handleSSEStream` directly (`apps/backend/src/server.ts:762-773`), and only case/catalog streams have `closed` loops later. User-facing cancellation should be an explicit endpoint/button; if worker also handles SSE disconnect, define it as cancellation of a stream-started run or as unsubscribe-only.

**Retry/timeouts/external I/O:**
- Mistral/OCR now has request timeouts and retry loops (`OCRAgent.ts:124-126`, `:161-181`, `:208-215`; `MistralService.ts:125-129`, `:168-181`, `:203-210`).
- Non-stream `Effect.tryPromise` fetches generally do not receive an interruption `AbortSignal`; interrupting the Effect fiber may stop awaiting but underlying HTTP may continue until timeout. Streaming Ollama creates an `AbortController` and passes `signal` (`OllamaService.ts:248-279`). This is a limitation/risk for “true” cancellation of slow HTTP calls.

### Contracts/status types lack explicit cancelled state

`packages/api-contracts/src/types.ts`
- `ProcessingLogEventType` has `run_started`, `run_completed`, `run_failed`, `lock_acquired`, `lock_released`, `lock_stale`, etc.; no `run_cancelled` (`:709-730`).
- `DocumentCase.automationStatus` is `idle | queued | running | needs_input | ready | done | failed`; no `cancelled` (`:828-833`).

`apps/backend/src/services/DocumentCaseService.ts`
- Backend `CaseAutomationStatus` mirrors that union (`:17-25`).

Recommended least-churn choice: add `run_cancelled` log event but do **not** add a new `automationStatus` unless product wants visible cancelled filters. On cancel finalization, clear `activeRunId`, set `lastRunId`, set `automationStatus` to `ready` (or `queued` if choosing auto-resume semantics), and avoid treating cancellation as `lastFailure`.

### Frontend currently starts runs but has no cancel UX

`apps/web/lib/api.ts`
- `processingApi` has `start`, `stream`, `confirm`, status/logs/auto helpers; no cancel (`:313-345`).
- `casesApi.run` wraps `POST /api/cases/document/:docId/run`; no cancel (`:348-356`).

`apps/web/app/documents/[id]/page.tsx`
- Imports `casesApi`, not `processingApi`; `X` icon is already imported (`:42-56`).
- `runCase` sets local `processing=true`, awaits `casesApi.run`, refreshes, then clears processing (`:562-570`). Because request blocks until run completes, an initiating tab can show a spinner but no cancellation action.
- Header action area shows refresh/logs/questions/complete/run-retry; no cancel button (`:722-785`).
- Derived `caseStatus` is available (`:621`); `activeRunId` is on `caseRecord` from contracts.

Messages:
- `apps/web/messages/en.json` has common `cancel` and document detail keys around `documentDetail.runCase/retryCase/running`; add document-specific `cancelRun`, `cancelling`, maybe `cancelled` in both `en.json` and `de.json`.

## Implementation-ready design

### 1) Extend `ProcessingPipelineService` with active-run registry

Add types in `ProcessingPipeline.ts` (or adjacent service type file):

```ts
export interface ActiveDocumentRunInfo {
  docId: number;
  runId: string;
  startedAt: string;
  source?: "manual" | "case" | "sse" | "auto" | "step";
  step?: string;
  dryRun?: boolean;
}

export type CancelRunResult =
  | { status: "cancelling" | "cancelled"; docId: number; runId: string }
  | { status: "no_active_run"; docId: number; lockRunId?: string | null }
  | { status: "run_mismatch"; docId: number; activeRunId: string; requestedRunId: string };
```

Extend service interface:
- `cancelDocumentRun(input: { docId: number; runId?: string; reason?: string }): Effect.Effect<CancelRunResult, AgentError>`
- `getActiveDocumentRun(docId: number): Effect.Effect<ActiveDocumentRunInfo | null, never>` (optional but useful for status/UI/admin).

Registry shape:
- `Ref<Map<number, ActiveRun>>` is enough if only one active run per document; include `runId` to guard races.
- `ActiveRun` should include `fiber: Fiber.RuntimeFiber<A, E>` (widen to `Fiber.RuntimeFiber<unknown, unknown>` if needed), info, and optional `cancelRequested` Ref/boolean.

### 2) Refactor `withDocumentLock` to own a cancellable fiber

Current `runId` exists only after `acquireDocumentLock`, so register after lock acquisition.

Recommended structure inside `withDocumentLock`:
1. Acquire durable lock as today.
2. Build a `monitoredEffect` preserving existing `tap` completion logging, `tapError` failure logging, heartbeat race, and `ensuring` cleanup.
3. Add cancellation-specific finalization. In Effect, pure interruption may not flow through `tapError`; use an explicit cancellation flag set by `cancelDocumentRun`, or inspect `Exit` via `Effect.onExit`/`Effect.exit` to log `run_cancelled` only for interrupted/cancel-requested exits.
4. Fork the monitored race and register `{ docId, runId, fiber, startedAt, step/source/dryRun }` in `activeRuns` before awaiting it.
5. Await/join the fiber so existing API behavior remains blocking.
6. In finalizer, remove the registry entry only if the same `runId`, then release lock and clear case as today.

Important ordering: `cancelDocumentRun` must interrupt the fiber first. Lock release/case clearing should happen from the run finalizer, not from the API handler as a standalone substitute.

### 3) Cancellation semantics

Endpoint and service behavior:
- If active run exists and requested `runId` is absent or matches: set cancel flag/reason, `Fiber.interrupt(fiber)`, return `{ status: "cancelling" | "cancelled", docId, runId }` with HTTP 202 or 200.
- If requested `runId` does not match active registry run: return conflict (`409`) or structured `{ status: "run_mismatch" ... }`; do not interrupt a newer run.
- If no active registry run exists: query `LockService.get("document", docId)` for diagnostics. Return `404` or idempotent `200` with `{ status: "no_active_run", lockRunId }`. Do **not** delete the lock in user cancel unless a matching active fiber was found.

State/logging:
- Add `run_cancelled` to `ProcessingLogEventType` and log it with `{ runId, reason, dryRun }`.
- Ensure finalizer still logs `lock_released` and clears `activeRunId`/sets `lastRunId`.
- Prefer `automationStatus: "ready"` after cancellation for least schema churn. If product wants “cancelled” as a durable status, update backend service types, API contracts, filters, status labels, and tests.
- Decide tag semantics. If cancellation happens mid-stage, current workflow tag may be `llm-ocr`/`llm-metadata`/`llm-index`. Leaving an active-stage tag can cause auto-processing to resume later. Safer user semantics may be retag to queued/todo, but that is product-sensitive. Minimum: document chosen behavior in log/response and tests.

### 4) Backend API surface

Exact files to edit:
- `apps/backend/src/agents/ProcessingPipeline.ts`: registry, service methods, cancellation-aware finalization.
- `packages/api-contracts/src/request-schemas.ts`: add `ProcessingCancelBodySchema` with optional `runId` and `reason` (string, optional/null-safe as desired).
- `packages/api-contracts/src/types.ts`: add `run_cancelled` to `ProcessingLogEventType`; optionally define response types if this package contains API response contracts.
- `apps/backend/src/api/processing/handlers.ts`: add `cancelProcessing(docId, body)` using `ProcessingPipelineService.cancelDocumentRun`.
- `apps/backend/src/api/index.ts`: add `POST /api/processing/:docId/cancel` near start/confirm route and validate body.
- `apps/backend/src/server.ts`: no allowlist addition for POST cancel; add/adjust tests to verify read-only blocks it. If worker chooses SSE-close interruption, implement here carefully.

Suggested route:
- `POST /api/processing/:docId/cancel`
- Body: `{ "runId"?: string, "reason"?: string }`
- Response examples:
  - `202 { status: "cancelling", doc_id: 42, run_id: "..." }`
  - `409 { status: "run_mismatch", doc_id: 42, active_run_id: "new", requested_run_id: "old" }`
  - `404/200 { status: "no_active_run", doc_id: 42, lock_run_id?: "..." }`

### 5) Frontend API/UI

Exact files to edit:
- `apps/web/lib/api.ts`: add `processingApi.cancel(docId, options?: { runId?: string; reason?: string })` posting to `/api/processing/${docId}/cancel`.
- `apps/web/app/documents/[id]/page.tsx`: import `processingApi`; add local `cancelling` state; show Cancel Run action when `processing` is true OR `caseRecord?.automationStatus === "running"` (ideally with `caseRecord.activeRunId`). Handler calls cancel endpoint with `caseRecord?.activeRunId`, refreshes document/case/logs, clears local processing on success, and surfaces action errors.
- `apps/web/messages/en.json`, `apps/web/messages/de.json`: add document detail labels (`cancelRun`, `cancelling`, optionally `cancelled`).

UX guidance:
- Keep Run/Retry disabled while running/cancelling.
- Cancel button can be destructive/outline with existing `X` icon.
- If active run is from another tab/auto-processing, `caseRecord.activeRunId` is the runId guard.

## Test plan

Backend unit tests:
- Extend `apps/backend/tests/agents/ProcessingPipeline.test.ts`.
  - Build a mock OCR/document-agent effect that does not complete until interrupted (e.g. `Effect.async` with finalizer or long sleep), start `pipeline.processDocument({ docId })` in a forked test fiber.
  - Wait until `getActiveDocumentRun(docId)` or case `activeRunId` is visible.
  - Call `cancelDocumentRun({ docId, runId })`.
  - Assert run fiber exits interrupted/cancelled, registry clears, `LockService.release("document", docId, runId)` is called, case update clears `activeRunId` and sets `lastRunId`, and TinyBase logs `run_cancelled` plus `lock_released`.
  - Add runId mismatch test: wrong runId returns conflict and does not interrupt active fiber.
  - Add no-active test: returns no-active diagnostics and does not release lock as a fake cancel.
  - Add/seal duplicate-start behavior if registry and lock can disagree.
- Consider a semaphore leak regression: with concurrency cap 1 and a never/slow gated step, cancel then run a second gated operation; it should not hang. Existing `apps/backend/tests/services/ConcurrencyLimitService.test.ts` covers semaphore behavior (`:41-70`) but not pipeline cancellation.

API/read-only tests:
- Add handler/router test for `POST /api/processing/:docId/cancel` body validation and status mapping.
- Extend `apps/backend/tests/server.test.ts` read-only assertion to include `POST /api/processing/123/cancel` (current read-only test around `:246-255`).
- Extend `apps/web/tests/api-proxy-readonly.test.ts` to verify proxy blocks `/api/processing/123/cancel` before backend fetch (existing mutating block test `:18-35`).
- If SSE-close interruption is implemented, add a server test near processing SSE tests (`apps/backend/tests/server.test.ts:465-540`). Current SSE test verifies TagCache full=true behavior.

Frontend tests:
- Add API helper shape test if a low-level API test pattern exists; otherwise cover via component test.
- Add document detail test if feasible: mock a running `DocumentCase` with `activeRunId`, assert Cancel Run is shown, click it, verify POST `/api/processing/:docId/cancel` with runId and refresh behavior.
- Existing web tests are under `apps/web/tests/`; no document detail test currently found, so a focused new test may need setup/mocks for Next/i18n.

Manual validation:
1. Start backend/web.
2. Start a long-running document/case run.
3. Confirm case has `automationStatus=running` and `activeRunId`.
4. Click Cancel Run.
5. Confirm response is cancelling/cancelled; processing log has `run_cancelled` and `lock_released`; lock row disappears; `activeRunId` clears; Run/Retry button returns; no later pipeline mutations occur after cancel.
6. Try stale runId cancel and no-active cancel.
7. Enable read-only env and confirm backend and web proxy return 403 for cancel.
8. Under low concurrency caps (`ollamaMaxConcurrent/mistralMaxConcurrent/ocrMaxConcurrent=1`), cancel a blocked/slow run and verify subsequent runs are not starved.

Targeted validation commands:
- `pnpm --filter @repo/backend test -- ProcessingPipeline`
- `pnpm --filter @repo/backend test -- server`
- `pnpm --filter @repo/backend test -- ConcurrencyLimitService TagCacheService` (if cancellation changes touch gates/tag cache/SSE)
- `pnpm --filter @repo/web test -- api-proxy-readonly` (or repo’s actual web test filter)
- `pnpm run typecheck`
- `pnpm run lint`

## Risks / decisions to make explicitly

1. **Do not release lock as cancellation.** Normal cancel must interrupt the active fiber first; lock release alone is admin/stale-lock behavior.
2. **Interruption vs `tapError`.** Pure Effect interruption likely will not run current `tapError(recordStageFailure)`; add explicit cancellation logging/state handling.
3. **RunId race.** Stale UI must not cancel a newer run. Compare provided runId to registry and/or lock.
4. **Registry cleanup race.** If run completes while cancel request arrives, return no-active/idempotent response, not 500.
5. **SSE close semantics.** Explicit cancel endpoint is user-facing cancellation. Closing EventSource can be unsubscribe-only unless worker intentionally defines it as cancelling a stream-started processing run.
6. **External HTTP abort.** Non-stream Mistral/Ollama/Paperless fetches may continue until timeout after fiber interruption. Either wire AbortSignal into relevant `Effect.tryPromise` helpers or document/contain this limitation.
7. **Workflow tags after cancel.** Product decision: leave active-stage tag (may resume), retag to queued/todo (stops active state), or add explicit cancelled state. Choose and test one behavior.

## Compact worker prompt

Implement user-facing cancellation for in-flight document processing runs. Add a pipeline-owned active run registry in `ProcessingPipelineServiceLive` that stores the actual `Fiber.RuntimeFiber` for each document run after `withDocumentLock` acquires its runId, and expose `cancelDocumentRun` plus optional active-run lookup. The cancel path must interrupt the fiber before lock/case cleanup; do not implement normal cancellation as `LockService.release()` alone. Add `POST /api/processing/:docId/cancel` with optional runId/reason body, validate via API contracts, log `run_cancelled`, preserve finalizer lock release and `activeRunId` clearing, and handle runId mismatch/no-active races safely. Wire `processingApi.cancel` and show a Cancel Run action on document detail while local or case state is running. Preserve read-only protections (cancel POST must be 403 in backend and frontend proxy read-only mode), be mindful of existing rate limiting/concurrency gates/tag-cache SSE code, and add focused backend/API/proxy/UI tests plus typecheck/lint validation.
