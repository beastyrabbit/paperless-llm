# W3-S13 Fix Worker Report

## Changed files

- `apps/web/lib/tinybase/provider.tsx`
- `apps/web/app/documents/page.tsx`
- `apps/web/app/documents/[id]/page.tsx`
- `apps/web/app/documents/[id]/log/page.tsx`
- `apps/web/app/settings/page.tsx`
- `apps/web/app/settings/components/ConnectionsTab.tsx`
- `apps/web/messages/en.json`
- `apps/web/messages/de.json`
- `apps/web/tests/tinybase-provider.test.tsx`

## Fixes applied

- Completed TinyBase workflow tag sync for all workflow tag keys consumed by document list/detail routes, including `summary_done` and `manual_review`, and included the same full tag set when saving settings.
- Changed TinyBase setting mutations to rollback optimistic local values on failed PATCH, expose the failure through `lastSyncError`/`_error`, and resolve with success/failure instead of causing ignored-promise unhandled rejections.
- Added visible settings mutation/sync error display on the settings page.
- Updated document list filtering to use the configured `tags.manual_review` setting instead of reusing the review tag.
- Updated document detail processing status, OCR accordion state, processed/run/retry state to derive status from configured TinyBase workflow tags instead of hardcoded workflow tag names.
- Replaced remaining hardcoded ConnectionsTab labels/help text for secret show/hide controls, model search/empty text, and OpenAI connector title/help with i18n keys.
- Added i18n coverage for the document processing log route user-facing labels and step labels.
- Added a TinyBase provider regression test covering failed PATCH rollback and surfaced error state.
- Kept `docs/plans/audit-rework-tasks.md` as-is; after these fixes, no W3-S13 checklist item needed to be unmarked.

## Validation

- `pnpm --filter @repo/web typecheck` — exit 0
- `pnpm --filter @repo/web lint` — exit 0
- `pnpm --filter @repo/web test -- settings-page.test.tsx tinybase-provider.test.tsx document-list-model.test.ts dashboard.test.tsx` — exit 0; 4 files / 8 tests passed
- `pnpm --filter @repo/web test` — exit 0; 6 files / 13 tests passed

## Remaining gaps / risks

- German strings added in this pass are English fallback copy where no translation was provided.
- True exhaustive i18n for every future/unrelated settings subroute is outside this W3-S13 blocker pass; this pass covered the reviewed/touched areas.

## Decisions needed

- None.
