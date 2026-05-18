# W4-S20 Document Authorization Fix Worker Report

Implemented the document authorization review fixes for processing aggregate endpoints and read-only case SSE blocking.

## Changes
- `apps/backend/src/api/processing/handlers.ts`
  - Filters `/api/processing/locks` document-scoped locks through `DocumentAuthorizationService`; unauthorized document locks are omitted while non-document locks remain visible.
  - Redacts unauthorized current document IDs from `/api/processing/status`.
  - Redacts unauthorized current document IDs and titles from `/api/processing/auto/status`.
  - Redacts unauthorized current document IDs from `/api/processing/auto/trigger` responses.
  - Default/no-op authorization still preserves visible document details.
- `apps/backend/src/server.ts`
  - Blocks `GET /api/cases/document/:docId/stream` in production read-only mode because the route calls `getOrCreateCaseForDocument` and may mutate local state.
- `apps/backend/tests/api/processing.test.ts`
  - Added tests for Paperless-style authorization filtering/redaction of processing locks and aggregate statuses.
- `apps/backend/tests/server.test.ts`
  - Added read-only allowlist coverage for blocking the case SSE route.
- `progress.md`
  - Updated task status and validation notes.

## Validation
- `pnpm --filter @repo/backend test -- tests/api/processing.test.ts tests/server.test.ts` ✅
- `pnpm --filter @repo/backend typecheck` ✅
- `pnpm --filter @repo/backend lint` ✅

## Notes / Risks
- Requested `context.md` and `plan.md` were not present at the repository root, so implementation was based on the task description and actual code inspection.
- The case SSE route remains mutating outside read-only mode; read-only mode now blocks it as requested.
