Implemented W4-S20: separated cases-page data fetching from untranslated view-model mapping and localized rendering.

Changed files:
- `apps/web/app/cases/page.tsx`
- `apps/web/app/cases/use-cases-data.ts`
- `apps/web/components/cases/case-list-model.ts`
- `apps/web/tests/case-list-model.test.ts`
- `progress.md`

What changed:
- Moved cases API loading state/error/data management from `app/cases/page.tsx` into `useCasesData(status)`, matching the existing dashboard `useDashboardData` style.
- Extracted non-i18n case list derivations into pure helpers:
  - status-filter parsing
  - queued/needs-input counts
  - first needs-input case discovery
  - per-row open-question count and destination URL
- Kept translation calls (`useTranslations`, `t(...)`) in the page component so fetching and i18n remain separated without behavior changes.
- Added unit tests for the extracted case-list model helpers.

Validation:
- `pnpm --filter @repo/web typecheck` passed.
- `pnpm --filter @repo/web test -- case-list-model.test.ts` passed.
- `pnpm --filter @repo/web lint` passed.

Notes/risks:
- `/mnt/storage/workspace/projects/paperless_local_llm/context.md` and `plan.md` were missing, so implementation followed the task prompt and existing code patterns.
- Worktree already contained extensive unrelated dirty/untracked changes; I only edited the files listed above.
