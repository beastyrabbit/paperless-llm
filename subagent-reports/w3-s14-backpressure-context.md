# W3-S14 Backpressure And Live Update Discipline — implementation context

Source task: `docs/plans/audit-rework-tasks.md` W3-S14, covering findings `A2`, `H1`, `H2`, `H3`, `H4`, `E9`, `E10`, `E12` from `docs/AUDIT.md`.

## Recommended serial milestones

1. **Backend backpressure foundation**
   - Add config keys and runtime primitives for request rate limiting plus global LLM/OCR concurrency gates.
   - Prefer a small Effect-managed runtime service/layer (for refs/semaphores/token buckets) over ad-hoc module globals.
   - Wire request limiting early in `apps/backend/src/server.ts` before body parsing and route dispatch.
2. **LLM/OCR budget and concurrency enforcement**
   - Gate Mistral OCR/chat and Ollama/Pi prompt paths through shared semaphores.
   - Track OCR usage per run/day before and after Mistral OCR calls; enforce hard caps before downloading/encoding huge PDFs when possible.
   - Apply same gates to pipeline, bulk OCR, and bulk ingest paths so jobs cannot bypass limits.
3. **Locks, cancellation, and admin release**
   - Extend lock service/API with explicit admin release/prune endpoints.
   - Add cancellable in-flight pipeline run registry (docId/runId -> Fiber/Deferred/interrupt) and endpoint(s) to cancel user-visible runs.
   - Expose UI actions where runs/locks are visible.
4. **SSE and tag-cache discipline**
   - Replace `server.ts` mutable `tagCache` with an Effect-managed cache/ref.
   - Rework processing/case/catalog SSE to stop promptly on client close and use Effect interruption/stream finalizers; avoid starting processing that continues after the client disconnects unless explicitly requested.
5. **Frontend live-update discipline**
   - Centralize dashboard/sidebar/settings/jobs polling in a provider or shared external store with one interval per tab and preferably cross-tab sharing (BroadcastChannel/localStorage leader) or EventSource where suitable.
   - Keep UI-specific polling only for rare, non-global pages.
6. **Focused validation/tests**
   - Add backend tests for 429, concurrency gate, budget cap, lock release/cancel, and SSE disconnect cleanup.
   - Add frontend tests that dashboard + sidebar do not schedule duplicate independent 5s polling loops.

## High-value files and evidence

### Task/audit evidence

- `docs/plans/audit-rework-tasks.md` W3-S14 acceptance: rate limiting, global LLM/OCR caps, Effect-managed tag cache, interrupting SSE loops on close, centralized frontend polling/EventSource, lock release UI/API, cancel endpoint, OCR budget caps.
- `docs/AUDIT.md:47-48`: `A2` says no rate limiting; recommends token-bucket per IP/token and semaphores for Ollama/Mistral.
- `docs/AUDIT.md:103-106`: `E9/E10/E12` call out stale lock release, no user-facing cancellation, and missing Mistral OCR usage/budget tracking.
- `docs/AUDIT.md:135-138`: `H1-H4` call out mutable tag cache, SSE loops, no global auto-processing cap, duplicate frontend polling.

### Backend request/SSE handling

- `apps/backend/src/server.ts:21-25`: only body size limit exists (`MAX_BODY_SIZE = 10MB`); no request rate limiter.
- `apps/backend/src/server.ts:111-120`: module-level mutable tag cache:
  - `let tagCache: TagCache | null = null;`
  - TTL 60s.
- `apps/backend/src/server.ts:242-529`: `handleSSEStream` writes processing SSE and runs `pipeline.processDocumentStream` or `pipeline.processStepStream` to drain. It does **not** subscribe to `req.close`, so processing can continue until completion even if client disconnects; `sendEvent` also ignores backpressure/closed response.
- `apps/backend/src/server.ts:308-338`: processing SSE reads/writes the global tag cache directly.
- `apps/backend/src/server.ts:594-647` and `651-688`: case/catalog SSE loops do track `closed` via `req.on("close")`, but they run a manual `while (!closed)` plus `await delay(2000)`. The current sleep is a plain Promise and is not interrupted until the delay returns; no max duration/central Stream helper.
- `apps/backend/src/server.ts:668-758`: normal route dispatch parses entire body before `handleRequest`; rate limiting should happen before `parseBody(req)`.
- `apps/web/app/api/[...path]/route.ts:67-96`: frontend proxy forwards backend streams/body as-is and injects backend bearer token; changes to backend SSE headers/status propagate through this route.

### API routing and current endpoints

- `apps/backend/src/api/index.ts:555-587`: processing routes include `POST /api/processing/:docId/start`, `POST /confirm`, status/logs, auto status/trigger. No cancel or lock release route.
- `apps/backend/src/api/jobs/handlers.ts:271-315`: bulk OCR start/status/cancel exists.
- `apps/backend/src/api/jobs/handlers.ts:329-374`: bulk ingest start/status/cancel exists.
- `apps/backend/src/api/index.ts:407-461`: job routes include bootstrap/bulk OCR/bulk ingest cancel endpoints, but these are job-specific, not in-flight document pipeline cancellation.

### Processing concurrency, locks, and cancellation gaps

- `apps/backend/src/agents/ProcessingPipeline.ts:342-393`: `acquireDocumentLock` acquires a document lock and fails if one is active.
- `apps/backend/src/agents/ProcessingPipeline.ts:396-428`: heartbeat watchdog refreshes lock every 5 minutes.
- `apps/backend/src/agents/ProcessingPipeline.ts:437-513`: `withDocumentLock` ensures lock release and races processing with heartbeat watchdog. There is no externally-visible Fiber registry, so an API cannot currently interrupt a running pipeline by document/run ID.
- `apps/backend/src/agents/ProcessingPipeline.ts:1133-1239`: stream methods use `Stream.asyncEffect`, emit all events, and call `emit.end()`; no link to HTTP client close.
- `apps/backend/src/services/LockService.ts:30-46`: lock service supports `acquire`, `release`, `get`, `heartbeat`, `list`, `pruneStale`.
- `apps/backend/src/services/LockService.ts:60`: default lock TTL is 15 minutes. `release` requires a matching `runId` if provided but can release by scope/resource without runId; no admin API exposes it.
- `apps/backend/src/services/AutoProcessingService.ts:302-320`: auto-processing calls `pipeline.processDocument({ docId })` serially in its loop. It does not have a global semaphore shared with manual runs/jobs; document lock prevents duplicate doc processing only.
- `apps/backend/src/jobs/BulkOcrJob.ts:72-73`, `223-259`: job has `cancelledRef` and interrupts its daemon fiber on cancel.
- `apps/backend/src/jobs/BulkIngestJob.ts:98-99`, `381-407`: same pattern for bulk ingest.
- `apps/backend/src/jobs/BootstrapJob.ts:95`: uses `Effect.all(..., { concurrency: "unbounded" })` for startup catalog reads; mostly compatibility/no heavy LLM.
- `apps/backend/src/agents/ProcessingPipeline.ts:619-626`, `719-726` and `apps/backend/src/agents/OCRAgent.ts:502-510`: several local `Effect.all(..., { concurrency: "unbounded" })` for Paperless/TinyBase reads. These are not the primary LLM/OCR cap target but are worth reviewing for upstream load.

### OCR/Mistral budget and config

- `apps/backend/src/config/schema.ts:64-70` and `apps/backend/src/config/index.ts:57-62`: `http` config currently has request timeout and Mistral retry settings only. No rate-limit, concurrency, or OCR budget config exists.
- `apps/backend/src/services/MistralService.ts:76-115`: dynamic config reads api key/model/base URL/timeouts/retries from TinyBase/config.
- `apps/backend/src/services/MistralService.ts:117-183`: generic Mistral request retry loop; no semaphore or usage tracking. Chat responses include token usage in the response type but `chat()` returns only content, discarding usage.
- `apps/backend/src/agents/OCRAgent.ts:127-217`: Mistral OCR request to `/v1/ocr` with retry loop; no concurrency gate, no usage tracking, no budget cap. Response has `pages` and text; pages are a practical budget unit.
- `apps/backend/src/agents/OCRAgent.ts:474-684`: `process()` downloads PDF, checks cached hash, calls `runMistralOCR`, persists version and logs. Budget enforcement should happen before `runMistralOCR` and record actual pages after success.
- `apps/backend/src/jobs/BulkOcrJob.ts:146-154`: legacy bulk OCR calls `MistralService.processDocument` directly, bypassing `OCRAgent` page/hash behavior and any OCRAgent-only budget logic.
- `apps/backend/src/jobs/BulkIngestJob.ts:227-235`: bulk ingest also calls `MistralService.processDocument` directly for OCR-like extraction.
- `apps/backend/src/services/TinyBaseService.ts:186-203`: TinyBase has settings, processingLogs, documentOcrContent but no OCR usage/budget table. `documentMemory.extractedFacts.ocr` currently stores per-document OCR facts, not daily/run aggregates.

### Existing tests to extend

- Backend tests are Vitest under `apps/backend/tests`.
- `apps/backend/tests/server.test.ts` currently covers auth/read-only/header sanitization; add rate limiter/unit helper tests here or in a new server/backpressure test.
- `apps/backend/tests/services/LockService.test.ts` exists for lock behavior; extend for list/release/prune/admin helper behavior if API/service changes.
- `apps/backend/tests/agents/ProcessingPipeline.test.ts` already mocks `LockService` and has timeout/failure assertions; good place for cancellation/concurrency gate tests.
- `apps/backend/tests/agents/OCRAgent.test.ts` covers Mistral OCR path; add budget cap/usage recording tests here if budget is in OCRAgent/service.
- `apps/backend/tests/jobs/BulkOcrJob.test.ts` covers job cancel/progress and direct Mistral use; extend to ensure budget/concurrency gates apply to job paths.
- Frontend tests include `apps/web/tests/dashboard.test.tsx` and setup stubs EventSource (`apps/web/tests/setup.ts`). Add tests around centralized polling provider/hook behavior.

### Frontend polling/live update hotspots

- `apps/web/components/dashboard/use-dashboard-data.ts:83-126`: dashboard initial `refresh()` then `setInterval(lightRefresh, 5000)`. Light refresh hits queue, cases, auto status, Ollama status.
- `apps/web/components/sidebar.tsx:35-51`: sidebar has another `setInterval(fetchStatus, 5000)` hitting auto status and queue.
- `apps/web/lib/tinybase/provider.tsx:394-410`: TinyBase provider polls settings periodically via `SYNC_INTERVAL_MS` (constant above; inspect if changing settings sync).
- `apps/web/app/settings/jobs/page.tsx:156-160`: jobs page polls `/api/jobs/status` every 5 seconds.
- `apps/web/app/settings/components/ProcessingTab.tsx:46-50`: processing settings tab polls auto status every 10 seconds.
- `apps/web/app/settings/components/MaintenanceTab.tsx:163-185`: maintenance tab polls bootstrap/bulk OCR/bulk ingest every 2 seconds while each is running.
- `apps/web/lib/tinybase/hooks/useProcessingLogs.ts:97-149`: `useProcessingStream` opens an EventSource to `/api/processing/:docId/stream` and closes on cleanup. Warning: this stream triggers processing, so it should not be used as a passive log subscription.
- `apps/web/lib/api.ts:146-153`, `191`: EventSource helpers for processing and case streams.

## Important patterns already used

- Effect service/layer pattern with `Context.GenericTag` and `Layer.effect` is standard (`LockService`, `AutoProcessingService`, jobs, agents). New backpressure/cache/budget services should follow this.
- Mutable runtime state is usually kept in Effect `Ref`s inside services (`AutoProcessingService`, bulk jobs) rather than module globals; W3-S14 explicitly asks to convert tag cache to Effect-managed cache/ref.
- Long-running jobs use `Effect.forkDaemon` and store `Fiber.RuntimeFiber` in a `Ref` for cancellation (`BulkOcrJob`, `BulkIngestJob`, `BootstrapJob`). Reuse this concept for pipeline run cancellation, but scope it as a real service so API/SSE/manual/auto share it.
- Route validation currently lives in `apps/backend/src/api/index.ts` with Zod schemas and `bodySchema`/`paramSchema` wrappers.
- Config schema/defaults are in `apps/backend/src/config/schema.ts` and `apps/backend/src/config/index.ts`; settings UI may also need fields in `apps/backend/src/api/settings/handlers.ts`, `apps/backend/src/api/settings/api.ts`, and settings components if user-configurable.

## Likely files to modify by milestone

Backend foundation:
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `config.example.yaml`, `.env.example` if adding env-configurable caps
- new service such as `apps/backend/src/services/RuntimeBackpressureService.ts` or `BackpressureService.ts`
- `apps/backend/src/services/index.ts`, `apps/backend/src/layers/index.ts`
- `apps/backend/src/server.ts`
- `apps/backend/tests/server.test.ts` plus new service tests

LLM/OCR budget/concurrency:
- `apps/backend/src/services/MistralService.ts`
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/services/OllamaService.ts` and/or `apps/backend/src/agents/piOllamaModel.ts` / `PiDocumentAgent.ts` for Pi prompt/Ollama gating
- `apps/backend/src/jobs/BulkOcrJob.ts`, `apps/backend/src/jobs/BulkIngestJob.ts`
- `apps/backend/src/services/TinyBaseService.ts` if adding persisted usage table
- `apps/backend/tests/services/MistralService.test.ts`, `apps/backend/tests/agents/OCRAgent.test.ts`, `apps/backend/tests/jobs/BulkOcrJob.test.ts`

Locks/cancel/admin API:
- `apps/backend/src/services/LockService.ts`
- new/extended processing-run registry service
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/api/processing/handlers.ts`, `apps/backend/src/api/index.ts`
- `apps/web/lib/api.ts`
- UI likely `apps/web/app/documents/[id]/page.tsx`, `apps/web/app/documents/[id]/process/page.tsx`, `apps/web/app/settings/components/ProcessingTab.tsx`, `apps/web/app/settings/components/MaintenanceTab.tsx` or a dedicated admin/locks section.

SSE/cache:
- `apps/backend/src/server.ts`
- new tag cache/backpressure service tests
- `apps/backend/tests/server.test.ts` or integration-style HTTP tests if feasible

Frontend polling:
- `apps/web/components/dashboard/use-dashboard-data.ts`
- `apps/web/components/sidebar.tsx`
- `apps/web/lib/api.ts`
- new provider/hook under `apps/web/components` or `apps/web/lib`, possibly layout wiring in `apps/web/app/layout.tsx`
- `apps/web/app/settings/jobs/page.tsx`, `apps/web/app/settings/components/ProcessingTab.tsx`, `apps/web/app/settings/components/MaintenanceTab.tsx`
- `apps/web/tests/dashboard.test.tsx` or new polling-provider test

## Risks and design notes

- **SSE processing stream currently has side effects.** `/api/processing/:docId/stream` can start pipeline work. Do not blindly share/reconnect EventSource for this endpoint as a passive state source; add separate status/log streams if needed.
- **Budget enforcement must cover all OCR entry points.** OCRAgent-only enforcement will miss `BulkOcrJob` and `BulkIngestJob` because they use `MistralService.processDocument` directly.
- **Concurrency caps must be global across manual, SSE, auto, and jobs.** A local semaphore inside one job/service instance is insufficient if other paths bypass it. Put gates in shared layer/service used by Mistral/Ollama/OCR calls or pipeline runner.
- **Cancellation needs real Fiber ownership.** Lock release alone does not stop an in-flight Mistral/Ollama/Paperless call. A cancel endpoint should interrupt the fiber and then release/mark state consistently. Underlying `fetchWithTimeout` should respect AbortSignal/Effect interruption if possible; verify `apps/backend/src/utils/http.ts` before implementation.
- **Manual admin lock release can cause split-brain if used while a fiber is still alive.** Safer API should report active run info and require force/admin intent; normal cancel should interrupt first, release second.
- **Rate limiting in local/single-process memory is acceptable for this app but not distributed.** Document that limits are per backend process unless a persistent/distributed store is added.
- **Frontend multi-tab discipline is harder than one-provider-per-tab.** Acceptance says multiple tabs should not multiply backend polling unnecessarily. A single React provider reduces duplicate polling in one tab, but cross-tab requires BroadcastChannel/localStorage leader election or SSE shared at browser level (not natively shared). Call this out if implementing only per-tab dedupe.
- **Read-only mode allow/block lists may need updates.** Existing read-only logic blocks processing stream and mutations; new cancel/lock release endpoints must be blocked in read-only mode.

## Validation commands

Backend-focused:
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`
- `pnpm --filter @repo/backend test`
- Targeted during development: `pnpm --filter @repo/backend test -- server.test.ts`, `... LockService.test.ts`, `... OCRAgent.test.ts`, `... ProcessingPipeline.test.ts`, `... BulkOcrJob.test.ts`

Frontend-focused:
- `pnpm --filter @repo/web typecheck`
- `pnpm --filter @repo/web lint`
- `pnpm --filter @repo/web test`

Full required safety net:
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test`

## Compact worker meta-prompts

### Worker 1 — backend rate limiting + global gates foundation

Goal: Add configurable backend request rate limiting and global Effect-managed concurrency gates for LLM/OCR calls. Evidence: `server.ts` has no limiter before `parseBody`; config `http` only has timeout/retry; audit `A2/H3` asks token buckets and semaphores. Success: excess requests return structured `429`; Mistral/Ollama/OCR call paths use shared caps; tests prove caps/429. Hard constraints: follow Effect service/layer pattern; no prompt-file/PromptService reintroduction; keep existing auth/read-only behavior. Validation: backend typecheck/lint/test plus targeted server/backpressure tests.

### Worker 2 — OCR usage budget

Goal: Track OCR usage per run/day and enforce configured hard caps across OCRAgent, BulkOcrJob, and BulkIngestJob. Evidence: OCRAgent calls `/v1/ocr`; bulk jobs call `MistralService.processDocument` directly; TinyBase has no usage table; config lacks budget keys. Success: configured cap prevents bulk OCR from exceeding daily/run budget, returns user-visible failure, and records usage. Hard constraints: budget cannot be bypassed by direct MistralService job paths; cached/skipped OCR should not burn budget. Validation: OCRAgent/BulkOcr/Mistral tests plus backend typecheck/lint/test.

### Worker 3 — lock release and in-flight cancellation

Goal: Add supported API/UI for admin lock release and user-facing cancellation of in-flight document runs. Evidence: `LockService.release/list/pruneStale` exist but no API; pipeline has no Fiber registry; jobs have working Fiber cancellation pattern. Success: users can cancel active doc processing; admins can list/release stale locks; state/logs show cancellation/release; read-only mode blocks these mutations. Hard constraints: releasing a lock must not be presented as cancelling unless the active Fiber is interrupted; avoid split-brain by requiring force/admin path for lock-only release. Validation: LockService/ProcessingPipeline/API tests and frontend tests for buttons if UI added.

### Worker 4 — SSE and tag cache discipline

Goal: Replace module-level tag cache with Effect-managed cache/ref and rework SSE loops to interrupt/finish promptly on client close. Evidence: `server.ts` has `let tagCache`, processing SSE lacks close handling, case/catalog loops use manual Promise delay. Success: disconnecting clients stops stream work; tag cache updates are managed through Effect state; tests or a controlled harness verify close cleanup. Hard constraints: processing stream side effects must remain explicit; do not turn processing EventSource into passive auto-reconnecting status stream without design decision. Validation: backend typecheck/lint/test plus targeted SSE close/cache tests where feasible.

### Worker 5 — frontend centralized live updates

Goal: Reduce duplicate frontend polling by centralizing dashboard/sidebar global status updates, with a path toward cross-tab discipline. Evidence: dashboard and sidebar both poll queue/auto status every 5s; settings/jobs/maintenance have additional polling. Success: dashboard + sidebar share one status source per tab; no duplicate 5s intervals for the same global endpoints; ideally cross-tab BroadcastChannel leader avoids multiplying in multiple tabs. Hard constraints: do not use `/api/processing/:docId/stream` as a passive global status feed because it starts processing. Validation: web typecheck/lint/test and a unit test asserting shared polling behavior.
