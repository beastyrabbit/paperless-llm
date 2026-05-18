# W3-S14 frontend polling worker report

## Changed files
- `apps/web/lib/global-status.tsx`
- `apps/web/app/layout.tsx`
- `apps/web/components/sidebar.tsx`
- `apps/web/components/dashboard/use-dashboard-data.ts`
- `apps/web/app/settings/components/ProcessingTab.tsx`
- `apps/web/tests/dashboard.test.tsx`
- `apps/web/tests/global-status-provider.test.tsx`
- `progress.md`

## Behavior implemented
- Added `GlobalStatusProvider` / `useGlobalStatus` as a client-side per-tab status store.
- Mounted the provider once from the app layout inside the existing TinyBase provider.
- Centralized one 5s polling loop for shared global status endpoints:
  - `GET /api/documents/queue`
  - `GET /api/processing/auto/status`
  - `GET /api/settings/ollama/status`
- Added an in-flight refresh guard so simultaneous provider/dashboard/manual refresh calls share the same refresh promise instead of issuing duplicate endpoint calls.
- Replaced sidebar-local 5s polling with shared status state.
- Replaced dashboard queue/auto/Ollama polling with shared status refresh/state; dashboard keeps route-local case polling and full refresh connection checks.
- Replaced ProcessingTab's local 10s auto-processing polling with shared status state and refreshes shared status after `triggerAuto()`.
- Did not add or use an EventSource endpoint; `/api/processing/:docId/stream` remains untouched and is not used as a passive global feed.

## Tests added/updated
- Added `apps/web/tests/global-status-provider.test.tsx` to prove multiple consumers under one provider create one interval and one request per centralized endpoint per tick.
- Updated `apps/web/tests/dashboard.test.tsx` to render the dashboard under `GlobalStatusProvider`.

## Validation
- `pnpm --filter @repo/web test -- dashboard.test.tsx global-status-provider.test.tsx` ✅
- `pnpm --filter @repo/web typecheck` ✅
- `pnpm --filter @repo/web lint` ✅

## Remaining gaps / risks
- Job/maintenance route-local polling was left unchanged because the approved scope emphasized global status/dashboard/sidebar duplication.
- Global status is still polling-based, not SSE-based; the provider abstraction should make a future transport swap straightforward.
- The working tree had many pre-existing unrelated dirty/untracked files; this worker only touched the files listed above.
