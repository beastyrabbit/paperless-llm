# Todo #14 / W3-S14 frontend polling handoff

## Scope inspected
Dashboard, sidebar, settings polling, existing frontend API/SSE helpers, backend routes/SSE patterns, and related tests. No source files were edited.

## Current polling inventory

### Global/layout-level polling
- `apps/web/app/layout.tsx:24-30` wraps every route in `AppTinyBaseProvider` and always renders `Sidebar`. Any polling in those components runs across the whole app.
- `apps/web/components/sidebar.tsx:34-52` owns its own status state and polls every 5s:
  - `processingApi.getAutoStatus()` (`GET /api/processing/auto/status`)
  - `documentsApi.getQueue()` (`GET /api/documents/queue`)
  - This duplicates dashboard polling when the dashboard is open.
- `apps/web/lib/tinybase/provider.tsx:33-34` sets `SYNC_INTERVAL_MS = 30000`; `apps/web/lib/tinybase/provider.tsx:408-428` calls `syncSettings()` on mount and every 30s globally. This is settings config sync, not high-frequency status polling, but it is global and should be considered separately from live status.

### Dashboard polling
- `apps/web/app/page.tsx:14-25` consumes `useDashboardData()` and renders returned status/state.
- `apps/web/components/dashboard/use-dashboard-data.ts:39-88` defines per-resource fetchers for settings, queue stats, cases, auto-processing status, Ollama status, and connection tests.
- `apps/web/components/dashboard/use-dashboard-data.ts:90-97` defines `lightRefresh()` with four calls every cycle: queue stats, cases, auto-processing status, Ollama status.
- `apps/web/components/dashboard/use-dashboard-data.ts:99-121` defines manual/full `refresh()` including settings and connection tests.
- `apps/web/components/dashboard/use-dashboard-data.ts:123-127` runs `refresh()` on mount then `window.setInterval(lightRefresh, 5000)`.

### Settings polling
- `apps/web/app/settings/components/ProcessingTab.tsx:35-51` polls auto-processing status every 10s with `processingApi.getAutoStatus()` and refreshes immediately after `processingApi.triggerAuto()` at `ProcessingTab.tsx:53-62`.
- `apps/web/app/settings/jobs/page.tsx:141-161` polls all job status every 5s via raw fetch to `/api/jobs/status`; `JobsPage.tsx:163-178` refreshes immediately after a trigger.
- `apps/web/app/settings/components/MaintenanceTab.tsx:148-161` initially loads bootstrap, bulk OCR, bulk ingest, schedules, and processing log stats.
- `apps/web/app/settings/components/MaintenanceTab.tsx:163-185` starts three separate 2s intervals only while the corresponding job status is `running`:
  - bootstrap: `jobsApi.getBootstrapStatus()`
  - bulk OCR: `jobsApi.getBulkOCRStatus()`
  - bulk ingest: `jobsApi.getBulkIngestStatus()`
- Other settings tabs have manual refresh buttons, but the inspected automatic polling hotspots are the above plus global TinyBase sync.

## API/client facts
- `apps/web/lib/api.ts:233-287` has `settingsApi`, including `getOllamaStatus()`, connection tests, settings CRUD, and processing-log stats.
- `apps/web/lib/api.ts:289-305` has `documentsApi.getQueue()`.
- `apps/web/lib/api.ts:307-340` has `processingApi.getStatus()`, `getAutoStatus()`, `triggerAuto()`, and existing document processing `EventSource` helper for `/api/processing/:docId/stream`.
- `apps/web/lib/api.ts:504-555` has `jobsApi.getStatus()`, `getBootstrapStatus()`, `getBulkOCRStatus()`, `getBulkIngestStatus()`, and job trigger/cancel helpers. `apps/web/app/settings/jobs/page.tsx` currently bypasses this helper for `/api/jobs/status`.

## Existing backend status/SSE facts
- Registered HTTP routes:
  - `apps/backend/src/api/index.ts:358-405`: `/api/jobs/status`, per-job and bootstrap/bulk job status routes.
  - `apps/backend/src/api/index.ts:518-532`: `/api/processing/status` and `/api/processing/auto/status`.
- Auto-processing payload is assembled in `apps/backend/src/api/processing/handlers.ts:109-126` and includes `running`, `enabled`, `queue_length`, timestamps, current doc info, processed/error counts.
- Existing SSE routes are not a general global-status stream:
  - `apps/backend/src/server.ts:126-128` defines `/api/processing/:docId/stream`, `/api/cases/document/:docId/stream`, `/api/catalog/runs/:runId/stream`.
  - `apps/backend/src/server.ts:580-592` handles processing SSE for one doc.
  - `apps/backend/src/server.ts:594-638` handles case stream by polling every 2s server-side and emitting `case_snapshot`.
  - `apps/backend/src/server.ts:640-660` starts catalog stream similarly.
- Therefore, moving dashboard/sidebar/settings global status to EventSource requires adding a new backend route and frontend API helper; centralizing polling can be implemented frontend-only.

## Design options

### Option A — Frontend-only centralized polling provider/hook (lowest risk, implementation-ready)
Create a shared status store/provider, likely under `apps/web/lib/status/` or `apps/web/components/status/`, mounted once near `AppTinyBaseProvider` in `app/layout.tsx`. It should own deduped polling for shared global status and expose hooks consumed by `Sidebar`, `useDashboardData`, and `ProcessingTab`.

Suggested shared data slices:
- `queueStats`: from `documentsApi.getQueue()`.
- `autoStatus`: from `processingApi.getAutoStatus()`.
- Optionally `ollamaStatus`: from `settingsApi.getOllamaStatus()`, because dashboard refreshes it every 5s and it is status-like.
- Optionally `caseRecords`: dashboard-only today; centralize only if another global UI needs it. Otherwise keep page-local to avoid unnecessary app-wide `/api/cases` requests.
- Keep connection tests page/manual only. `settingsApi.testConnection()` is more expensive and currently only runs on dashboard mount/manual full refresh, not the 5s light interval.
- Keep TinyBase settings sync separate unless specifically asked to replace settings polling; it is lower frequency and handles config persistence/optimistic updates.

Implementation sketch:
- Add `usePolling` or provider logic that starts one interval when at least one consumer is mounted or simply when layout is mounted (since sidebar is always present). Prefer a generic interval utility with:
  - immediate fetch on mount,
  - `setInterval` cleanup,
  - in-flight guard to avoid overlapping slow polls,
  - error state per resource,
  - optional `document.visibilityState`/`visibilitychange` pause or slower background polling.
- Replace sidebar’s local `useEffect` interval (`sidebar.tsx:47-52`) with `useGlobalStatus()`.
- Replace dashboard’s `lightRefresh()` calls to queue/auto/Ollama with shared refresh methods/state. Preserve its full `refresh()` behavior for settings + connection tests + cases; or split into global `refreshStatus()` plus dashboard-local `fetchSettings/fetchCases/testConnections`.
- Replace `ProcessingTab` local 10s auto-status interval with shared `autoStatus` and `refreshAutoStatus`; still call `processingApi.triggerAuto()` then `refreshAutoStatus()` immediately.
- Convert `JobsPage` raw fetch to `jobsApi.getStatus()` and optionally a `useJobStatusPolling({ enabled: true, intervalMs: 5000 })` hook, but this is route-local, not global.
- Convert `MaintenanceTab` three separate 2s intervals to a small reusable `useConditionalPolling(fetcher, enabled, 2000)`, or leave as-is if Todo #14 focuses only global status. These are suitable for SSE later because they represent progress updates while running.

Pros: no backend changes, easiest to test, eliminates duplicate `/api/processing/auto/status` and `/api/documents/queue` requests from sidebar+dashboard+ProcessingTab. Cons: still polling.

### Option B — Add a global status EventSource endpoint (larger change, best for live status)
Add a backend SSE endpoint such as `/api/status/stream` or `/api/processing/auto/stream` that emits snapshots every 2-5s or on state change. Payload could include `{ type: "status_snapshot", autoStatus, queueStats, jobs?: ..., timestamp }`.

Candidate data to include:
- Best fit: auto-processing status + queue stats; used by sidebar, dashboard, ProcessingTab.
- Optional: job status/progress while jobs are running; used by JobsPage and MaintenanceTab.
- Avoid connection tests in stream; they may hit external services and should stay manual/less frequent.
- Avoid full settings/secrets in stream; TinyBase settings sync should remain normal fetch/PATCH.

Backend pattern to reuse:
- Follow `apps/backend/src/server.ts:594-638`: set `Content-Type: text/event-stream`, `Cache-Control: no-cache`, close on `req.close`, write `data: ...\n\n` plus keep-alive comments, and sleep between emissions.
- Add a new route matcher constant near `server.ts:126-128` and handle before generic routing.
- The endpoint can call the same services used by existing handlers (`AutoProcessingService`, `PaperlessService` via queue handler or shared helper, job services) inside `runWithRuntime`.

Frontend changes:
- Add `statusApi.stream()` in `apps/web/lib/api.ts` returning `new EventSource(`${API_BASE}/api/status/stream`)`.
- Provider consumes stream, updates shared state from messages, and falls back to centralized polling on `onerror` or when `EventSource` is unavailable.

Pros: removes client timer duplication and supports near-live updates. Cons/risks: backend queue stats may call Paperless, so a 2s stream can be expensive; EventSource auth/cookies/proxy behavior must match existing setup; existing Next API proxy route may need to support streaming if the frontend uses same-origin proxy.

### Option C — Hybrid recommended path
Implement Option A first with an abstraction that can later swap the transport. Name APIs around “status snapshots” instead of “polling”:
- `GlobalStatusProvider`
- `useGlobalStatus()` returning `{ queueStats, autoStatus, ollamaStatus, refresh, errors, isLoading }`
- Internally start with centralized polling.
- Add EventSource only for narrowly suitable progress streams later (global auto/queue status and running job progress), with polling fallback.

This is probably the best implementation-ready route for W3-S14 unless the parent explicitly requires backend SSE in the same task.

## Risks and constraints
- Sidebar is always mounted (`layout.tsx:24-30`), so provider-level polling is effectively app-wide. Poll only truly global, cheap status data there.
- Dashboard currently calls 4 endpoints every 5s; sidebar calls 2 of the same family every 5s; ProcessingTab calls auto status every 10s. Centralizing only queue+auto already removes the main duplicate load.
- `fetchApi` returns `{ ok: false, status: 0 }` on network error (`apps/web/lib/api.ts:211-229`); consumers that currently check only `.data` may silently ignore failures. Shared state should expose per-resource errors or preserve dashboard `errorKey` behavior.
- Must avoid overlapping requests if one poll takes longer than the interval.
- Connection tests should not move into high-frequency polling or SSE.
- Settings secrets/config state in TinyBase should not be mixed into public status snapshots.
- Existing SSE in `server.ts` is implemented outside the generic `addRoute` router; adding another SSE endpoint likely needs server-level code, not only `api/index.ts`.

## Tests to add/update
- Unit test shared provider/hook with fake timers:
  - starts one interval and performs immediate fetch;
  - when both Sidebar and Dashboard/ProcessingTab consume the hook, only one `/api/processing/auto/status` and one `/api/documents/queue` call occur per tick;
  - clears interval on unmount;
  - does not overlap in-flight refreshes.
- Update `apps/web/tests/dashboard.test.tsx` (`dashboard.test.tsx:72-171` has reusable fetch fixtures) for new hook/provider shape or mock shared status hook. Preserve assertions at `dashboard.test.tsx:179-201`.
- Add/adjust a sidebar test (none exists today) to verify it renders status from shared provider and does not set its own interval.
- Update `apps/web/tests/tinybase-provider.test.tsx` only if layout/provider nesting changes affect tests; do not conflate TinyBase settings sync with global status.
- If adding SSE:
  - expand `apps/web/tests/setup.ts:10-20` MockEventSource so tests can dispatch messages/errors and verify `.close()` is called;
  - backend test for new stream route headers and at least one JSON event, if feasible;
  - frontend fallback test: EventSource error triggers polling or leaves manual refresh working.

## Validation commands
- Targeted frontend unit tests: `pnpm --filter @repo/web test -- dashboard.test.tsx` plus any new provider/sidebar tests.
- Frontend typecheck: `pnpm --filter @repo/web typecheck`.
- Frontend lint: `pnpm --filter @repo/web lint`.
- If backend SSE is added: `pnpm --filter @repo/backend test` and `pnpm --filter @repo/backend typecheck`.
- Optional full checks before handoff: `pnpm run typecheck && pnpm run lint`.

## Compact worker prompt
Implement Todo #14 by centralizing duplicated frontend polling for global status. Use the inspected evidence in `subagent-reports/todo-14-frontend-polling-handoff.md`. Prefer a frontend-only `GlobalStatusProvider`/`useGlobalStatus` mounted from `apps/web/app/layout.tsx` that owns one deduped polling loop for auto-processing status and queue stats (optionally Ollama status), with immediate refresh, cleanup, in-flight guard, per-resource error state, and manual refresh. Replace local intervals in `apps/web/components/sidebar.tsx`, `apps/web/components/dashboard/use-dashboard-data.ts`, and `apps/web/app/settings/components/ProcessingTab.tsx` while preserving UI behavior and dashboard full refresh/connection tests. For route-local job/progress polling, either leave behavior unchanged or factor into a reusable conditional polling hook; do not move connection tests or TinyBase settings sync into high-frequency global polling. Add/update tests proving duplicate consumers produce one poll per tick and existing dashboard/sidebar/processing UI still works. If you choose EventSource, add a backend stream only for suitable status/progress data with polling fallback and tests; do not stream settings/secrets or connection tests. Validate with targeted web tests, `pnpm --filter @repo/web typecheck`, and `pnpm --filter @repo/web lint` (plus backend checks if SSE is added).
