# W2-S6 Worker Report

## Changed files

- `packages/api-contracts/package.json`
- `packages/api-contracts/tsconfig.json`
- `packages/api-contracts/src/index.ts`
- `packages/api-contracts/src/errors.ts`
- `packages/api-contracts/src/request-schemas.ts`
- `packages/api-contracts/src/openapi.ts`
- `packages/api-contracts/src/types.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/package.json`
- `apps/web/lib/api.ts`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `docs/plans/audit-rework-tasks.md`

## Implemented

- Created `@repo/api-contracts` as a workspace package using Effect Schema.
- Moved common API error contracts into the package:
  - `ApiValidationIssueSchema` / `ApiValidationIssue`
  - `ApiErrorSchema` / `ApiError`
  - `ApiResponse<T>`
- Moved backend router request body/path validation schemas from `apps/backend/src/api/index.ts` into `packages/api-contracts/src/request-schemas.ts`, including settings, pending, jobs, processing, cases, catalog, metadata, schema, translation, and chat request bodies.
- Replaced backend router Zod validation with Effect Schema decoding from `@repo/api-contracts`.
  - Preserved `ValidationError` issue shape: `{ path, message, code }[]`.
  - Preserved permissive passthrough behavior for previously loose schemas via `Schema.Record({ key: Schema.String, value: Schema.Unknown })` and schema extension where needed.
  - Added small mutable-array adapters at handler boundaries because Effect Schema array output types are readonly while existing handlers expect mutable arrays.
- Moved the frontend API DTO/type block out of `apps/web/lib/api.ts` into `packages/api-contracts/src/types.ts`.
  - `apps/web/lib/api.ts` now imports/re-exports shared API response/request/DTO types from `@repo/api-contracts` while keeping the fetch client functions local.
- Added OpenAPI preparation from the same schema source:
  - `apiContractSchemas`
  - `apiRouteContracts`
  - `toOpenApiSchema()`
  - `apiContractJsonSchemas()` using `JSONSchema.make(..., { target: "openApi3.1" })`.
- Added workspace dependencies from backend/web to `@repo/api-contracts` and updated `pnpm-lock.yaml`.
- Added `lucide-react` as a direct web dependency because after a clean `pnpm install`, web typecheck could not resolve the many direct `lucide-react` imports from the web app. This was required to validate from a clean dependency graph.
- Marked W2-S6 complete in `docs/plans/audit-rework-tasks.md`.

## Left incomplete / deferred

- Runtime response validation for every backend response was intentionally not added to keep W2-S6 reviewable. Response/DTO types are shared, and request/error validation is centralized through the shared schema package.
- `/openapi.json` and dev API docs serving are not implemented here; that is W3-S16. This pass only prepares schema/route metadata and JSON Schema generation helpers.
- Query parameter schemas are still mostly handled by existing ad hoc router logic; the migrated scope focused on route body schemas and path integer validation as requested.

## Validation evidence

Commands run:

- `CI=true pnpm install --lockfile-only` — exit 0
- `CI=true pnpm install` — exit 0
- `pnpm --filter @repo/api-contracts typecheck` — exit 0
- `pnpm --filter @repo/backend typecheck` — exit 0
- `pnpm --filter @repo/web typecheck` — exit 0
- `pnpm --filter @repo/api-contracts lint` — exit 0
- `pnpm --filter @repo/backend lint` — initially failed on a type-only import; fixed; rerun exit 0
- `pnpm --filter @repo/web lint` — initially failed on unused type imports; fixed; rerun exit 0
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/api/pending.test.ts tests/api/settings.test.ts tests/api/cases.test.ts` — exit 0; 4 files / 61 tests passed
- `pnpm --filter @repo/web test -- api-proxy-readonly.test.ts` — exit 0; 1 file / 4 tests passed
- `pnpm --filter @repo/api-contracts exec tsx -e "import { apiContractJsonSchemas } from './src/index.ts'; const schemas = apiContractJsonSchemas(); if (!schemas.ApiError || !schemas.ProcessingStartBody) throw new Error('missing schema'); console.log(Object.keys(schemas).length);"` — exit 0; printed `35`

## Decisions / risks

- Used Effect Schema as recommended; no alternate schema source was introduced.
- The visible HTTP error shape remains unchanged through the existing `ValidationError` path.
- Effect Schema emits readonly arrays; adapters in the router preserve existing handler signatures rather than broadening handler/service types in this pass.
- The frontend DTO move is broad but mechanical; the runtime API client behavior is unchanged.
