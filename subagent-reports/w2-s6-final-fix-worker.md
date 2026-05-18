# W2-S6 Final Fix Worker Handoff

## Changed files

- `packages/api-contracts/src/openapi.ts`
- `packages/api-contracts/src/types.ts`
- `apps/web/lib/api.ts`
- `subagent-reports/w2-s6-final-fix-worker.md`

## Exact fixes

1. Completed `apiRouteContracts` coverage for the remaining backend routes that validate request bodies through shared schemas in `apps/backend/src/api/index.ts`:
   - Added `ApprovePendingBodySchema` to OpenAPI schema exports.
   - Added pending item routes:
     - `POST /api/pending/{id}/approve`
     - `POST /api/pending/{id}/reject`
     - `POST /api/pending/{id}/reject-with-feedback`
     - `POST /api/pending/{id}/approve-cleanup`
     - `POST /api/pending/blocked`
   - Added job/settings/document routes:
     - `PATCH /api/jobs/schedule`
     - `PATCH /api/settings/ai-document-types`
     - `PATCH /api/settings/custom-fields`
     - `PATCH /api/settings/ai-tags`
     - `POST /api/documents/{id}/cleanup-tags`
   - Existing entries already covered the remaining shared-schema body routes for settings, jobs, processing, cases, catalog, metadata, schema, translation, and chat.

2. Fixed metadata tag DTO drift without changing backend response behavior:
   - Added `TagMetadataListItem` for `GET /api/metadata/tags`, matching backend `listTags()` responses: `{ paperless_tag_id, description }`.
   - Kept `TagMetadata` for single-tag get/update responses, matching current `{ id, paperless_tag_id, tag_name, description }` shape.
   - Added `TagMetadataBulkRequest` for bulk update request items.
   - Added `TagMetadataBulkResponse` for `POST /api/metadata/tags/bulk`, matching backend `bulkUpdateTags()` responses: `{ id, description }`.
   - Left `TagMetadataBulk` as a compatibility alias of `TagMetadataBulkRequest`.

3. Updated frontend API client endpoint typing:
   - `metadataApi.listTags()` now returns `ApiResponse<TagMetadataListItem[]>`.
   - `metadataApi.bulkUpdateTags()` now accepts `TagMetadataBulkRequest[]` and returns `ApiResponse<TagMetadataBulkResponse[]>`.
   - Re-exported the new request/response DTO types from `apps/web/lib/api.ts`.

## Commands run

- `pnpm --filter @repo/api-contracts typecheck` — passed.
- `pnpm --filter @repo/api-contracts lint` — passed.
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/web typecheck` — initially failed because `@repo/api-contracts` exports built `dist` declarations and the new source types had not been emitted yet; after building contracts, passed.
- `pnpm --filter @repo/api-contracts build && pnpm --filter @repo/web typecheck` — passed.
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/api/pending.test.ts` — passed; 2 files / 36 tests.
- `pnpm --filter @repo/web lint` — passed.
- OpenAPI/schema smoke:
  - `pnpm --filter @repo/api-contracts exec tsx -e "..."` — passed; verified new schemas and required route metadata entries, printed `34 36`.

## Notes / risks

- No backend response shapes were changed; contracts now match current handler behavior.
- Query parameter schemas remain outside this final fix, consistent with the W2-S6 scope already documented by prior workers.
- I did not edit W4-S20 accessibility files.

## Ready for final re-review

Yes. The latest W2-S6 reviewer issues were addressed with targeted contract/OpenAPI metadata and frontend typing fixes, and targeted validation passed.
