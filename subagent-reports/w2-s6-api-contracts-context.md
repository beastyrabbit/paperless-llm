# W2-S6 Shared API Contracts — implementation context

## Task target
From `docs/plans/audit-rework-tasks.md`, W2-S6 requires:
- create `packages/api-contracts`
- move shared schemas/types for API requests, responses, and errors into that package
- update backend route handlers to validate through shared schemas
- update frontend API client to import shared request/response types
- prepare OpenAPI generation from the same schema source

Related audit findings in `docs/AUDIT.md`: C4 frontend duplicates backend API types, D3 error response shapes vary, R1 package absent, R2 no OpenAPI/Swagger spec.

## Current architecture and high-value evidence

### Workspace/package setup
- `pnpm-workspace.yaml:1-3` already includes `packages/*`, so `packages/api-contracts` will be picked up automatically.
- `apps/backend/package.json:1-35`: backend is ESM (`type: module`), builds with `tsc`, depends on `effect`, `typebox`, and `zod`.
- `apps/web/package.json:1-38`: web has no runtime schema dependency today; depends on `@repo/ui`, Next 16, React 19, TinyBase.
- `packages/ui/package.json` is a useful package pattern: private workspace package, ESM, exports source files directly, no build script required for consumption.
- Backend `tsconfig` uses `module`/`moduleResolution: NodeNext`, `rootDir: ./src`, declarations, `noEmitOnError`. Importing a workspace package from backend should go through package exports, not relative paths outside `src`.
- Web `tsconfig` extends `@repo/typescript-config/nextjs.json` with bundler resolution and currently has `@/*` alias only.

### Backend router and validation
`apps/backend/src/api/index.ts` is the central route registry and validation boundary:
- imports `zod` at `index.ts:7` and `ValidationError` at `index.ts:8`.
- route handler type accepts `(params, body) => Effect<unknown, unknown, unknown>` at `index.ts:28-44`.
- `parseWithSchema`/`bodySchema`/`paramSchema` at `index.ts:54-81` convert Zod errors to `ValidationError` with `issues: { path, message, code }[]`.
- all request body schemas are currently local Zod constants (`index.ts:83-230` and later), e.g. `PositiveIntSchema`, `ProcessingStartBodySchema`, `CaseAnswerBodySchema`, `CatalogRunBodySchema`, metadata/tag/translation/chat schemas.
- routes call those local schemas before handler invocation, e.g. metadata tag update at `index.ts:663-668`, tag translations at `index.ts:683-691`, custom fields at `index.ts:722-738`.
- query params are parsed ad hoc in `handleRequest` rather than schema-validated: pending `type`, documents `tag`, search `q/limit`, cases `status`, catalog `run_id`, schema `block_type/name`.

### Backend HTTP error shapes
`apps/backend/src/server.ts` contains multiple response shapes:
- `toHttpError` at `server.ts:201-223` maps `ValidationError` to `{ status: 400, error: "Validation Error", message, issues }`, `NotFoundError` to 404, otherwise 500.
- auth failure returns `{ status: 401, error: "Unauthorized", requestId }` (not shown in snippets above but in server request handling).
- read-only rejection uses `{ status: 403, error: "Read Only Mode", message, requestId }` at `server.ts:163-169`.
- malformed SSE ids currently bypass `toHttpError` and return `{ error: "Invalid document ID" }` only at `server.ts:580-586` and `server.ts:594-599`.
- invalid JSON and too-large body also have custom shapes in the catch block. D3 should be addressed by defining shared `ApiError`/`ApiValidationIssue` schemas and using them where practical, at least for normal JSON API and router validation.

### Existing schema/type patterns
There are three schema systems in use:
1. **Zod**: only in `apps/backend/src/api/index.ts` for HTTP boundary validation. No Zod on frontend.
2. **Effect Schema**: used for domain/API-ish definitions:
   - `apps/backend/src/api/settings/api.ts:4-132` defines `TagsConfigSchema`, `SettingsSchema`, `SettingsUpdateSchema`, etc. via `Schema.Struct`, and `Schema.Schema.Type<...>` types.
   - `apps/backend/src/api/pending/api.ts:4-114` defines pending item/count/request schemas via `Schema.Struct` and types.
   - `apps/backend/src/models/index.ts` defines domain schemas/types such as `DocumentSchema`, `PendingCountsSchema`, `QueueStatsSchema`, `StreamEventSchema`.
   - Actual Effect Schema decoding is sparse: config validation uses `Schema.decodeUnknownSync(AppConfigSchema)`; API route validation does not use Effect Schema today.
3. **TypeBox**: used in Pi agent tool schemas (`apps/backend/src/agents/PiDocumentAgent.ts`, `PiConsolidationAgent.ts`, `PiTagExplorerAgent.ts`) via `import { Type } from "typebox"`; this is for agent tool schema definitions, not API route contracts.

Important OpenAPI-compatible option already present: `effect` includes `JSONSchema.make(schema, { target: "openApi3.1" })` (confirmed in installed `effect/dist/dts/JSONSchema.d.ts`). That makes Effect Schema the best existing single schema source for types + runtime decoding + JSON Schema/OpenAPI preparation. TypeBox is also JSON-schema-native but currently scoped to Pi tools, and using it for API would add a second validation style to frontend/backend contracts.

### Frontend API client and duplicated types
`apps/web/lib/api.ts` is both client implementation and a large duplicated contract file:
- `ApiValidationIssue` and `ApiResponse<T>` are locally defined at `lib/api.ts:7-21`.
- `fetchApi<T>` wraps `fetch`, JSON parsing, and errors at `lib/api.ts:43-63`.
- endpoint wrappers start at `lib/api.ts:65` and hardcode request bodies and response generics, e.g. settings update at `lib/api.ts:73-77`, workflow tag creation at `lib/api.ts:83-87`.
- types begin around `lib/api.ts:433` and run to EOF. Examples: `Settings` at `433-470`, `QueueStats` at `576-592`, `DocumentDetail` at `603-619`, case request/response types at `1184-1220`.
- Some frontend types appear stale/drifted. Example: frontend `Settings` includes `paperless_connected: boolean` at `lib/api.ts:436`, but backend `SettingsSchema` has no `paperless_connected` and does include `paperless_token`, `paperless_token_configured`, `mistral_model`, `vector_search_*`, pipeline fields, `debug`, etc. This is direct evidence for C4.
- Additional direct fetches bypass `lib/api.ts` in `apps/web/lib/tinybase/provider.tsx`, `apps/web/app/settings/blocked/page.tsx`, and `apps/web/app/settings/jobs/page.tsx`; W2-S6 can leave behavior intact, but shared types will not cover all consumers until those are migrated or typed.
- `apps/web/app/settings/components/shared/types.ts` also duplicates settings/model/tag status types. This should be considered for import cleanup if touching settings contracts.

### Backend handler response sources
Likely response contracts come from a mix of handlers and services:
- `apps/backend/src/api/documents/handlers.ts` returns frontend-shaped snake_case documents and queue stats. `getQueueStats` returns extra status fields `paperless_reachable`, `status`, `errors` in addition to the frontend `QueueStats` fields.
- `apps/backend/src/api/settings/handlers.ts` returns a `Settings` typed from `apps/backend/src/api/settings/api.ts`, but the frontend duplicate is incomplete/stale.
- `apps/backend/src/api/jobs/handlers.ts` has local request interface `BulkIngestStartRequest` and maps job progress structures to API shapes.
- `apps/backend/src/api/pending/api.ts` already contains Effect schemas for some pending request/response-ish types, but `pending/handlers.ts` also has local request interfaces (e.g. reject-with-feedback, blocked suggestion).
- Service-level types duplicated in frontend include `DocumentCaseService` case types, `CatalogAgentService` run/proposal types, `TinyBaseService` processing log types, `AutoProcessingService` status, `QdrantService` search result, job progress types.

### Tests and current validation coverage
- `apps/backend/tests/api/router.test.ts:172-199` asserts invalid numeric path params and invalid processing step fail with `ValidationError`. If replacing Zod validation, keep these semantics or update tests to structured 400 at HTTP/server boundary.
- Backend API test suites exist for cases, chat, documents, pending, router, settings.
- Frontend has Vitest tests and Playwright E2E; `web/tests/api-proxy-readonly.test.ts` covers proxy behavior.

## Recommended implementation sequence

1. **Choose Effect Schema as the contract source.**
   - Rationale: already a backend dependency and schema pattern; supports runtime decoding and `JSONSchema.make(..., { target: "openApi3.1" })`; no new frontend dependency if `@repo/api-contracts` exports plain inferred TS types and schemas. If frontend imports schemas too, add `effect` as dependency of `@repo/api-contracts` only and let workspace resolution handle it.
   - Avoid TypeBox for API contracts unless deliberately standardizing on JSON Schema-first, because current API validation is Zod and domain schemas are Effect Schema.

2. **Create `packages/api-contracts` with minimal package scaffolding.**
   - Likely files: `packages/api-contracts/package.json`, `tsconfig.json`, `src/index.ts`, `src/errors.ts`, `src/common.ts`, then domain files (`settings.ts`, `documents.ts`, `processing.ts`, `cases.ts`, `catalog.ts`, `pending.ts`, `metadata.ts`, `jobs.ts`, `schema.ts`, `translation.ts`, `chat.ts`, `search.ts`).
   - Package exports can follow `@repo/ui` style by exporting `./src/index.ts`, or add a build script if preferred. For backend NodeNext, an exports map with types/default to `./src/index.ts` should work similarly to `@repo/ui`.
   - Add dependency on `effect` in package. If using `JSONSchema.make`, no additional package needed.

3. **Start with shared common/error contracts and request body contracts used by router validation.**
   - Define `ApiValidationIssueSchema`, `ApiErrorSchema`, `ApiErrorResponse` types.
   - Define `PositiveIntFromStringSchema` / `PositiveIntSchema` equivalent for path params. Effect Schema can decode/coerce via transformations; if that is too much for first slice, keep local `z.coerce` temporarily but move body schemas first. Acceptance wants backend validation through shared schemas, so at least body schemas should be shared.
   - Define request schemas for current local Zod body schemas in `apps/backend/src/api/index.ts:90-230` and later.
   - Preserve permissive/passthrough behavior where current Zod schemas use `.passthrough()` or `LooseObjectSchema`, especially `SettingsUpdateBodySchema` and schedule updates, to avoid breaking existing settings UI.

4. **Add an Effect Schema validation adapter in backend router.**
   - Replace `ZodType`/`z` helpers in `apps/backend/src/api/index.ts` with a helper around `Schema.decodeUnknownEither`/`Schema.decodeUnknownSync` or `Schema.decodeUnknown`.
   - Convert decode errors to existing `ValidationError` with `issues` matching `{ path, message, code }[]`. Exact Effect parse error path formatting needs checking during implementation. Existing frontend expects `issues` but is tolerant.
   - Keep `ValidationError` mapping in `server.ts:201-212`, but consider using shared `ApiError` type/constructor for shape consistency.

5. **Move response/request TypeScript types from `apps/web/lib/api.ts` into contracts gradually.**
   - Export inferred types from schemas for request/response DTOs.
   - Update `apps/web/lib/api.ts` to import types from `@repo/api-contracts`, not redeclare them. Keep `fetchApi` and endpoint functions in web unless creating a generated/typed client is in scope (probably not for W2-S6).
   - Update backend handlers to import request parameter types from contracts where they currently rely on inferred local Zod or local interfaces.
   - Prioritize high-use routes and all routes with request validation. If time-limited, do not attempt perfect full response validation for every handler in one PR; but remove duplicated frontend contract declarations for the endpoints you move.

6. **Prepare OpenAPI generation, not necessarily serve docs.**
   - Add a contracts export such as `apiRoutes` metadata containing method/path/request/response/error schemas, or at least an `openapi.ts` helper that maps named schemas through `JSONSchema.make(schema, { target: "openApi3.1" })`.
   - W2-S6 says “Prepare OpenAPI generation”; W3-S16 handles generating/serving API docs. A simple script/export proving schemas can become OpenAPI components is enough.

7. **Add/update tests.**
   - Backend router tests for invalid request body should assert structured validation errors from shared schemas.
   - Add a compile-time/usage test is not easy; rely on `pnpm run typecheck` across both apps. If adding package tests, a simple contract JSON schema generation test is useful.

## Likely files to edit in implementation

Create:
- `packages/api-contracts/package.json`
- `packages/api-contracts/tsconfig.json`
- `packages/api-contracts/src/index.ts`
- `packages/api-contracts/src/errors.ts`
- `packages/api-contracts/src/common.ts`
- `packages/api-contracts/src/{settings,documents,processing,cases,catalog,pending,metadata,jobs,schema,translation,chat,search}.ts` (can consolidate if smaller)
- optional `packages/api-contracts/src/openapi.ts` or `scripts/generate-openapi.ts`

Modify:
- `apps/backend/package.json` add `@repo/api-contracts: workspace:*`; remove `zod` only if no longer used anywhere backend (currently only API router uses it).
- `apps/web/package.json` add `@repo/api-contracts: workspace:*`.
- `apps/backend/src/api/index.ts` replace local Zod schemas/imports with shared contract schemas and validation adapter.
- `apps/backend/src/server.ts` optionally import shared `ApiError`/helpers for consistent shapes; at minimum align validation/read-only/auth/invalid JSON shapes with shared type.
- `apps/web/lib/api.ts` remove local type declarations and import from `@repo/api-contracts`; keep API wrapper functions.
- `apps/web/app/settings/components/shared/types.ts` if settings component types duplicate moved contracts.
- Backend tests: `apps/backend/tests/api/router.test.ts` and route-specific API tests.
- Frontend tests only if type import changes break mocked shapes.

## Risks / decisions to make

- **Schema system migration risk:** Effect Schema parse error formatting differs from Zod. Ensure `ValidationError.issues` remains stable enough for frontend (`path`, `message`, `code`).
- **Strictness risk:** Existing Zod schemas are often permissive (`passthrough`, loose settings object). Effect Schema default excess-property behavior may differ. Preserve current leniency unless explicitly tightening a route.
- **Drift already exists:** Some frontend types do not match backend responses. Moving them blindly can cause compile errors or reveal runtime assumptions. Treat compile errors as useful, but validate handler actual return shape before “fixing” contracts.
- **Response validation scope:** Acceptance says requests/responses/errors shared; validating every outgoing response at runtime may be too large. A practical first implementation can share response schemas/types and validate request bodies/errors at runtime; optionally add response schemas to route metadata for OpenAPI.
- **OpenAPI route metadata:** Current router has no machine-readable route table for schemas. If `apiRoutes` metadata is introduced, avoid duplicating paths in two places without a plan; consider using contract route constants in backend route registration.
- **Frontend direct fetches:** `lib/api.ts` is not the only fetch layer. W2-S6 can focus on the central client, but remaining direct fetches are a follow-up risk.
- **SSE endpoints:** EventSource streams are separate from JSON APIs and have ad hoc error/event shapes. Do not over-scope; define stream event schemas if easy, but JSON routes are the acceptance-critical path.
- **Package exports + NodeNext:** Backend may require explicit `.js` in relative imports but package imports via exports should be fine. Test `pnpm --filter @repo/backend typecheck` early after adding the package.

## Validation commands
Run targeted checks first, then full checks:

```bash
pnpm --filter @repo/api-contracts typecheck
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/web typecheck
pnpm --filter @repo/backend test -- tests/api/router.test.ts
pnpm --filter @repo/backend test
pnpm --filter @repo/web test
pnpm run lint
pnpm run typecheck
```

If package has no tests, skip its test command. If OpenAPI helper/script is added, run it directly (e.g. `pnpm --filter @repo/api-contracts test` or `pnpm exec tsx scripts/generate-openapi.ts --check`, depending on implementation).

## Compact worker meta-prompt

Implement W2-S6 “Introduce Shared API Contracts”. Create `packages/api-contracts` as a workspace package using Effect Schema as the single source for shared API request/response/error DTOs, because the backend already uses `effect/Schema` and Effect can generate OpenAPI 3.1 JSON Schema via `JSONSchema.make`. Move the route body schemas currently local to `apps/backend/src/api/index.ts` into the package, define shared `ApiValidationIssue`/`ApiError` contracts, and update the backend router to validate request bodies/path params through the shared schemas while preserving current permissive behavior and `ValidationError` issue shape. Update `apps/web/lib/api.ts` to import request/response/error types from `@repo/api-contracts` instead of redeclaring the large duplicated contract block; keep the fetch wrapper/client functions unless a minimal typed helper naturally falls out. Add package dependencies to backend/web. Prepare OpenAPI generation by exporting schema/route metadata or an OpenAPI component helper from the contracts package; serving docs is not required for W2-S6.

Success criteria: `packages/api-contracts` exists and is consumed by both backend and web; backend no longer owns duplicate local request schemas for routes migrated; frontend no longer redeclares shared API DTOs in `lib/api.ts`; invalid request bodies still return structured 400 validation errors with `issues`; contract/type drift breaks `pnpm run typecheck`; OpenAPI-compatible JSON schema generation from the same schema source is demonstrably available. Validate with backend/web/package typechecks, backend API/router tests, frontend tests, and lint. Stop and ask for a decision if choosing a schema library other than Effect Schema, if a contract mismatch requires changing externally visible response fields, or if full response runtime validation would balloon the PR beyond W2-S6 scope.
