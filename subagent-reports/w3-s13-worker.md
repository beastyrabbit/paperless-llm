# W3-S13 Worker Report

Implemented the remaining W3-S13 frontend refactor items.

## Changed files

- `apps/web/app/cases/page.tsx`
- `apps/web/app/cases/error.tsx`
- `apps/web/app/documents/page.tsx`
- `apps/web/app/documents/error.tsx`
- `apps/web/app/documents/[id]/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/app/settings/error.tsx`
- `apps/web/app/settings/components/ConnectionsTab.tsx`
- `apps/web/lib/tinybase/provider.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/de.json`
- `docs/plans/audit-rework-tasks.md`

## Implementation details

- Added i18n coverage for the audited cases and document detail routes, route error boundaries, and remaining user-facing settings connection labels/placeholders touched in this pass.
- Added corresponding `en`/`de` message keys for cases, document detail, settings load/errors, settings connection placeholders, OpenAI connector labels, and secret-save states.
- Replaced document route direct settings API reads with TinyBase settings hooks for Paperless URL and workflow tag filtering, keeping TinyBase as the settings source of truth for audited frontend routes.
- Converted settings save-all to a React 19 `useActionState` form action with success/error/pending UI.
- Converted secret settings updates in `ConnectionsTab` to form actions with pending/error states.
- Changed TinyBase `updateSetting`/`updateSettings` to rethrow failed PATCHes so action states can show errors instead of silently swallowing failures.
- Marked W3-S13 complete in `docs/plans/audit-rework-tasks.md`.

## Validation

- `pnpm --filter @repo/web typecheck` — exit 0
- `pnpm --filter @repo/web lint` — exit 0
- `pnpm --filter @repo/web test -- settings-page.test.tsx document-list-model.test.ts dashboard.test.tsx` — exit 0; 3 files / 7 tests passed

## Remaining gaps / risks

- The worktree had many pre-existing modified and untracked files before this task; I preserved them and only edited the files listed above.
- Some broader settings subroutes/components outside the actively audited settings tab flow still contain hardcoded copy and should be handled in W4-S20 or a follow-up i18n sweep if those routes are in scope.
- German messages added in this pass use English fallback copy rather than human translation.
