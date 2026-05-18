# W3-S14 Frontend Polling Fix

## Changed files
- `apps/web/components/dashboard/use-dashboard-data.ts`
- `apps/web/tests/dashboard.test.tsx`

## Exact fix
- Removed dashboard-owned global status polling from the dashboard 5s refresh loop.
- Dashboard mount now loads only dashboard-local data (`settings`, `cases`, connection tests), while `GlobalStatusProvider` remains the sole owner of initial and interval refreshes for:
  - `/api/documents/queue`
  - `/api/processing/auto/status`
  - `/api/settings/ollama/status`
- Kept dashboard-local 5s case polling via `fetchCases` so route-local data can continue refreshing without duplicating centralized global endpoint polling.
- Preserved the dashboard manual refresh button behavior so an explicit user refresh still refreshes both dashboard-local data and global status through the provider's `refresh()` function.
- Added a focused dashboard test rendering `<Dashboard />` under `<GlobalStatusProvider />` with fake timers and fetch counts. It asserts each centralized global endpoint is called once on provider initial load and once after a provider tick, while `/api/cases` can refresh separately.

## Validation
- `pnpm --filter @repo/web test -- dashboard.test.tsx global-status-provider.test.tsx` ✅
- `pnpm --filter @repo/web typecheck` ✅
- `pnpm --filter @repo/web lint` ✅

## Ready for re-review
Yes. The duplicate dashboard polling of centralized global status endpoints has been removed and covered by a regression test.
