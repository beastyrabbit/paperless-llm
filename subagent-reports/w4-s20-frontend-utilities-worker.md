Implemented W4-S20 frontend constants/utilities extraction.

Changed files:
- apps/web/lib/polling.ts
- apps/web/lib/tinybase/hooks/useProcessingLogs.ts
- apps/web/lib/tinybase/provider.tsx
- apps/web/app/settings/blocked/page.tsx
- apps/web/app/settings/jobs/page.tsx
- apps/web/lib/global-status.tsx
- apps/web/components/dashboard/use-dashboard-data.ts
- apps/web/app/settings/components/MaintenanceTab.tsx

Summary:
- Reused the existing exported `API_BASE` from `@/lib/api` in frontend files that had local duplicate `const API_BASE = ""` declarations.
- Added shared polling constants in `@/lib/polling`:
  - `DEFAULT_POLLING_INTERVAL_MS` for 5s dashboard/global/jobs polling.
  - `ACTIVE_JOB_POLLING_INTERVAL_MS` for 2s active maintenance job polling.
- Kept changes narrow and did not edit backend files or `apps/web/lib/api.ts`.

Validation:
- `pnpm --filter @repo/web typecheck` passed.
- `pnpm --filter @repo/web lint` passed.
- `pnpm --filter @repo/web test -- tests/global-status-provider.test.tsx tests/dashboard.test.tsx` passed.

Notes / risks:
- `/mnt/storage/workspace/projects/paperless_local_llm/context.md` and `plan.md` were not present when read was attempted.
- The worktree already contained extensive unrelated dirty changes; this task only added the shared polling module and small frontend import/constant replacements above.
