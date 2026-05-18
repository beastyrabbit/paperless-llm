# W3-S16 OpenAPI Coverage Fix Worker Report

Implemented W3-S16 todo #22 coverage fix.

## Changes
- Expanded `packages/api-contracts/src/openapi.ts` route contracts from body-focused coverage to the current backend API surface:
  - Registered backend routes are now represented, including GET/read/query/status/delete routes.
  - Preserved docs/SSE entries for `/api/docs`, processing streams, case streams, and catalog streams.
  - Added query parameter metadata for routed query handling such as `/api/search`, `/api/pending`, `/api/documents/pending`, cases, catalog, and schema blocked checks.
  - Added generated OpenAPI `operationId` values and support for reusable route query parameter metadata.
- Updated `apps/backend/src/api/index.ts` route registry to retain raw route paths and export `getRegisteredRoutes()` for test-only drift coverage.
- Added a backend router test that normalizes registered `:param` paths to OpenAPI `{param}` paths and fails if any registered backend route is missing from shared OpenAPI contracts.

## Validation
- `pnpm --filter @repo/api-contracts build && pnpm --filter @repo/api-contracts typecheck && pnpm --filter @repo/api-contracts lint` ✅
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts` ✅
- `pnpm --filter @repo/backend test -- tests/server.test.ts` ✅
- `pnpm --filter @repo/backend typecheck` ✅
- OpenAPI generation smoke via built `@repo/api-contracts` ✅ (`paths=97`, `operations=110`)

## Notes / Risks
- Response schemas remain placeholders where no shared response schemas exist, per scope.
- Worktree had extensive pre-existing dirty/untracked files outside this task; only the files above and progress/report were intentionally changed.
