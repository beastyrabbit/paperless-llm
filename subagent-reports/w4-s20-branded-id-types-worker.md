# W4-S20 Branded ID Types Worker Report

## Implemented
- Added `packages/api-contracts/src/ids.ts` with positive safe integer schemas, branded ID schemas, route string schemas, and pure parsers (`parsePositiveSafeIntString`, `parseDocumentIdString`).
- Exported shared ID helpers from `@repo/api-contracts`.
- Updated request schemas to use positive safe integer branded IDs for selected ID-bearing body fields and kept `PositiveIntFromStringSchema` as a bounded alias.
- Updated backend route boundary parsing to use route-specific document/tag/custom-field/blocked-suggestion ID schemas while preserving existing structured `ValidationError` failures.
- Updated backend SSE document stream parsing to reject unsafe/invalid document IDs before opening streams.
- Updated OpenAPI path parameter generation to document known numeric ID params as integer min `1`, max `Number.MAX_SAFE_INTEGER` without globally treating `{id}` as numeric.
- Updated frontend numeric document search and selected document route params to use shared bounded parsing instead of raw `parseInt`; invalid route IDs now trigger `notFound()`.
- Added invalid/oversized ID test coverage in backend router tests and frontend document-list parser tests.

## Changed files
- `packages/api-contracts/src/ids.ts`
- `packages/api-contracts/src/index.ts`
- `packages/api-contracts/src/request-schemas.ts`
- `packages/api-contracts/src/openapi.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/src/server.ts`
- `apps/backend/tests/api/router.test.ts`
- `apps/web/components/documents/document-list-model.ts`
- `apps/web/app/documents/[id]/page.tsx`
- `apps/web/app/documents/[id]/log/page.tsx`
- `apps/web/tests/document-list-model.test.ts`
- `progress.md`

## Validation
- `pnpm --filter @repo/api-contracts typecheck` ✅
- `pnpm --filter @repo/api-contracts build` ✅
- `pnpm --filter @repo/web test -- tests/document-list-model.test.ts` ✅
- `pnpm --filter @repo/web typecheck` ✅
- `pnpm --filter @repo/api-contracts lint` ✅
- `pnpm --filter @repo/web lint` ✅
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts` ❌: 28/29 passed; failing test is existing `rejects oversized settings strings before handlers run` due missing `TinyBaseService`, not touched by this task.
- `pnpm --filter @repo/backend typecheck` ❌: existing `DocumentAuthorizationService.ts` type errors outside this task.
- `pnpm --filter @repo/backend lint` ❌: existing `DocumentAuthorizationService.ts` and `src/observability/tracing.ts` lint errors outside this task.

## Notes / risks
- `context.md` and `plan.md` were requested but are absent in the workspace, so implementation followed `subagent-reports/todo-50-branded-id-types-handoff.md`.
- I did not broaden API client parameter branding to avoid UI churn; runtime boundaries and route/body contracts are covered.
- The worktree contains extensive unrelated pre-existing changes; I only edited the files listed above.
