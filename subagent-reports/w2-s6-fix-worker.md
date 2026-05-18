# W2-S6 Fix Worker Report

## Changed files

- `packages/api-contracts/package.json`
- `packages/api-contracts/tsconfig.json`
- `packages/api-contracts/src/openapi.ts`
- `packages/api-contracts/src/types.ts`
- `apps/web/app/settings/components/shared/types.ts`
- `apps/backend/Dockerfile`
- `Dockerfile.frontend`
- `subagent-reports/w2-s6-fix-worker.md`

## Fixes applied

1. **Runtime package export/start failure**
   - Changed `@repo/api-contracts` package exports from raw `./src/index.ts` to built `./dist/index.js` / `./dist/index.d.ts`.
   - Added a real package `build` script and TypeScript emit settings (`noEmit: false`, declarations, source maps).
   - Verified backend can import the built workspace package from compiled backend context.
   - Updated backend and frontend Dockerfiles to copy `packages/api-contracts` manifests/source and build/copy it before backend/web builds, so container builds have the workspace package available instead of a missing workspace dependency/source.

2. **OpenAPI route metadata drift**
   - Corrected pending merge route to `POST /api/pending/merge`.
   - Corrected metadata tag update route to `PUT /api/metadata/tags/{tagId}`.
   - Corrected metadata tag bulk route to `POST /api/metadata/tags/bulk`.
   - Replaced non-existent unscoped tag optimize/translate metadata with actual tag-id scoped routes:
     - `POST /api/metadata/tags/{tagId}/optimize-description`
     - `POST /api/metadata/tags/{tagId}/translate-description`
   - Added actual tag translation and custom-field metadata routes represented by shared schemas:
     - `PUT /api/metadata/tags/{tagId}/translations/{lang}`
     - `PUT /api/metadata/custom-fields/{fieldId}`
     - `POST /api/metadata/custom-fields/bulk`
   - Corrected translation route to `POST /api/translation/translate` and added `POST /api/translation/cache/clear`.

3. **Duplicate frontend contract types**
   - Replaced duplicated DTO definitions in `apps/web/app/settings/components/shared/types.ts` with type re-exports from `@repo/api-contracts`.
   - Kept only settings-page UI-local types/constants in that file (`ConnectionStatus`, `VALID_TABS`, `SettingsTab`).

4. **Request/type drift**
   - Updated metadata tag request DTOs so typed clients can only send fields accepted by backend schemas/handlers:
     - `TagMetadataUpdate`: optional `tag_name`, `description`
     - `TagMetadataBulk`: `id` plus the same accepted fields
   - Updated custom-field request/response DTOs to match current backend schemas/handlers:
     - `CustomFieldMetadataUpdate`: optional `name`, `extra_data`
     - `CustomFieldMetadataBulk`: `id` plus the same accepted fields
     - `CustomFieldMetadata`: current stub response shape (`id`, `name`, `data_type`, `extra_data`)
   - Loosened tag metadata response optional fields where current handlers do not return the previous full shape.

5. **Audit task status**
   - Left `docs/plans/audit-rework-tasks.md` W2-S6 marked complete because the blocker fixes now satisfy the reviewed acceptance scope.

## Commands run

- `pnpm --filter @repo/api-contracts build` — exit 0
- `pnpm --filter @repo/api-contracts typecheck` — exit 0
- `pnpm --filter @repo/backend typecheck` — exit 0
- `pnpm --filter @repo/web typecheck` — exit 0
- `pnpm --filter @repo/api-contracts lint` — exit 0
- `pnpm --filter @repo/backend lint` — exit 0
- `pnpm --filter @repo/web lint` — exit 0
- `pnpm --filter @repo/api-contracts build && pnpm --filter @repo/backend build` — exit 0
- Runtime import smoke from `apps/backend`:
  - `node -e "const m = await import('@repo/api-contracts'); ..."` — exit 0, printed `contracts import from backend ok 24`
  - `node -e "const m = await import('./dist/api/index.js'); ..."` — exit 0, printed `backend dist api import ok`
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/api/pending.test.ts tests/api/settings.test.ts tests/api/cases.test.ts` — exit 0; 4 files / 61 tests passed
- `pnpm --filter @repo/web test -- api-proxy-readonly.test.ts settings-page.test.tsx` — exit 0; 2 files / 5 tests passed

## Remaining risks

- Full runtime response validation is still deferred, matching the original W2-S6 scope decision.
- Query parameter schemas remain mostly outside the route contract metadata; current W2-S6 acceptance was focused on shared request/body/error schemas and OpenAPI generation prep.
- I did not run full Docker image builds; Dockerfile changes were made to include/build `@repo/api-contracts`, but container validation should still be done in a broader integration pass if desired.

## Re-review recommendation

W2-S6 can be re-reviewed. The prior blocker areas have targeted fixes and validation evidence.
