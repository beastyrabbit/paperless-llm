# W2-S6 DTO / HTTP 400 Fix Worker Handoff

## Changed files

- `packages/api-contracts/src/types.ts`
- `packages/api-contracts/dist/types.d.ts` and generated source map output from `pnpm --filter @repo/api-contracts build`
- `apps/backend/src/api/pending/api.ts`
- `apps/backend/tests/server.test.ts`
- `subagent-reports/w2-s6-dto-400-fix-worker.md`

## Exact fixes

1. Metadata DTO drift
   - Changed `TagMetadata.tag_name` from required to optional nullable (`tag_name?: string | null`) so `metadataApi.getTag()` matches current backend `getTag()` behavior, which returns `id`, `paperless_tag_id`, and `description` without changing the externally visible response shape.
   - Changed `CustomFieldMetadata.extra_data` from `Record<string, unknown> | null` to `unknown`, matching the backend custom-field handlers/schema that accept and echo arbitrary JSON/unknown values.

2. Duplicate backend pending request schemas
   - Replaced duplicate local schemas in `apps/backend/src/api/pending/api.ts` with imports/re-exports from `@repo/api-contracts`:
     - `ApproveRequestSchema` -> `ApprovePendingBodySchema`
     - `RejectRequestSchema` -> `RejectPendingBodySchema`
     - `MergeRequestSchema` -> `MergePendingBodySchema`
     - `BulkActionRequestSchema` -> `BulkPendingBodySchema`
   - Preserved existing public export names and types (`ApproveRequest`, `RejectRequest`, `MergeRequest`, `BulkActionRequest`) so pending handlers/tests continue to import from `./api.js` unchanged.

3. HTTP-level structured 400 coverage
   - Added a backend HTTP server test that starts `createHttpServer()`, sends an invalid JSON body to `POST /api/pending/bulk`, and asserts:
     - HTTP status `400`
     - JSON `error: "Validation Error"`
     - an `issues` array containing the invalid `ids` path
   - The test sets `PAPERLESS_LLM_CONFIG` to a missing absolute test path to avoid loading local developer config during server startup.

## Validation

- `pnpm --filter @repo/api-contracts typecheck` — exit 0
- `pnpm --filter @repo/api-contracts lint` — exit 0
- `pnpm --filter @repo/api-contracts build` — exit 0
- `pnpm --filter @repo/backend typecheck` — exit 0
- `pnpm --filter @repo/backend lint` — exit 0
- `pnpm --filter @repo/backend test -- tests/server.test.ts tests/api/router.test.ts tests/api/pending.test.ts` — exit 0; 3 files / 43 tests passed
- `pnpm --filter @repo/web typecheck` — exit 0

Note: the server test emits an existing Qdrant compatibility warning to stderr during AppLayer startup, but the test passes and does not depend on Qdrant.

## Ready for re-review

Yes. The requested W2-S6 final review issues were addressed without changing runtime metadata response shapes or touching W3-S14/W4-S17 files.
