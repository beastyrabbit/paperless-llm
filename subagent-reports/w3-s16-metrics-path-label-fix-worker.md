# W3-S16 Metrics Path Label Fix Worker

Implemented metrics HTTP path label normalization fix for todo #24.

## Changes
- Updated `apps/backend/src/services/MetricsService.ts` so `normalizeMetricPath()` derives dynamic path labels from `apiRouteContracts` instead of a small hardcoded regex list.
- Converts OpenAPI-style placeholders like `{docId}` into metric labels like `:docId`.
- Preserves exact static route labels before checking dynamic patterns so static routes such as `/api/documents/pending`, `/api/pending/counts`, `/api/metadata/tags/bulk`, and `/api/schema/blocked/check` are not incorrectly collapsed into dynamic labels.
- Added representative tests for pending IDs, case IDs, question IDs, catalog run/proposal IDs, document IDs, metadata tag/language IDs, search doc IDs, settings service segments, static-route collisions, and rendered metrics output.

## Validation
- Passed: `pnpm --filter @repo/backend test -- MetricsService server router`
- Passed: `pnpm --filter @repo/backend typecheck`
- Passed: `pnpm --filter @repo/backend lint`

## Notes / Risks
- The implementation is tied to `apiRouteContracts`; the existing router test enforces that registered backend routes are documented there, including SSE stream routes.
- Unknown/unregistered paths are left unchanged, matching prior behavior and limiting scope to registered route labels.
