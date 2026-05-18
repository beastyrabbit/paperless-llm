# Todo #50 / W4-S20 — Branded ID/domain types and bounded ID parsing handoff

## Scope read
Request was for an implementation-ready handoff only; no edits were made. I inspected shared API contract schemas/OpenAPI, backend route parameter parsing (including SSE routes), frontend route param usage, API client ID parameters, and related tests.

## Current state and high-value evidence

### Shared contract package
- `packages/api-contracts/src/request-schemas.ts:3-15`
  - Currently defines unbranded generic numeric helpers:
    - `NumberArraySchema = Schema.Array(Schema.Number.pipe(Schema.int()))`
    - `NullableOptionalIntSchema = Schema.NullOr(Schema.Number.pipe(Schema.int())).pipe(Schema.optional)`
    - `PositiveIntFromStringSchema = Schema.NumberFromString.pipe(Schema.int(), Schema.positive(), Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER))`
  - This is already bounded for positive string path params, but returns a plain `number`.
- `packages/api-contracts/src/request-schemas.ts:88-121, 153-170`
  - Request body ID fields are plain ints and often not positive/bounded:
    - settings selected arrays: `selected_type_ids`, `selected_field_ids`, `selected_tag_ids`
    - case answer: `selectedEntityId`, `metadataPatch.correspondentId`, `documentTypeId`, `tagIds`
    - bulk metadata IDs: tag/custom field `id`
    - schema block body `doc_id`
- `packages/api-contracts/src/types.ts` contains many public response/request IDs as `number`, e.g. document IDs (`docId`, `doc_id`, `current_doc_id`), tag IDs (`tag_id`, `paperless_tag_id`, `tagIds`), metadata entity IDs (`correspondentId`, `documentTypeId`, `entityId`, `targetEntityId`), blocked item IDs. These are structural API types, not runtime parsers.
- `packages/api-contracts/src/openapi.ts:831-840`
  - `pathParameters()` emits every path parameter as `{ type: "string" }` regardless of route param name.
  - Numeric path route contracts therefore currently document numeric IDs as strings even though backend parses most as positive ints.
- `packages/api-contracts/src/index.ts:1-4`
  - Package re-exports `request-schemas`, `openapi`, `types`, `errors`; new helper module must be exported here.
- There are no existing `Schema.brand` / branded type patterns in the repo (`grep` found none).

### Backend HTTP router
- `apps/backend/src/api/index.ts:149-154`
  - Shared parser helpers:
    - `paramSchema(schema, value, name)` calls `parseWithSchema(..., "path parameter 'name'")`.
    - `positiveIntParam(params, name)` uses `PositiveIntFromStringSchema` and returns plain `number`.
- `apps/backend/src/api/index.ts:481-512`
  - Document routes use `positiveIntParam(params, "id")` for `/api/documents/:id`, `/content`, `/pdf`, `/cleanup-tags`.
- `apps/backend/src/api/index.ts:524-553`
  - Processing routes use `positiveIntParam(params, "docId")` for `/start`, `/confirm`, logs GET/DELETE.
- `apps/backend/src/api/index.ts:567-587`
  - Cases document routes use `positiveIntParam(params, "docId")`; question/case IDs are strings (`questionId`, `caseId`).
- `apps/backend/src/api/index.ts:621-669`
  - Metadata tag/custom-field routes use `positiveIntParam(params, "tagId" | "fieldId")`.
- `apps/backend/src/api/index.ts:338-340, 724-725, 747-748`
  - Other numeric path params: pending blocked `blockId`, schema blocked `id`, search index `docId`.
- `apps/backend/src/api/index.ts:784-854`
  - Query parsing is manual and inconsistent with schema parsing. Search `limit` is bounded to 1..100; other query params are strings. This todo appears focused on IDs, so avoid broad query parser work unless required.

### Backend SSE routes bypass router helpers
- `apps/backend/src/server.ts:192-194`
  - SSE regexes currently constrain doc stream paths to digits: `^/api/processing/(\d+)/stream$`, `^/api/cases/document/(\d+)/stream$`; catalog run ID is string.
- `apps/backend/src/server.ts:823-847`
  - Stream handlers parse with `Number.parseInt` and only check `NaN || <= 0`; they do **not** check safe integer. Because regex allows arbitrary digit length, unsafe IDs can pass as rounded JS numbers.
  - These should use the same central bounded parser or a safe route regex plus parser.

### Frontend API client and route params
- `apps/web/lib/api.ts:285-342`
  - API client uses plain `number` document IDs for documents/processing/cases APIs (`get`, `getContent`, `getPdfUrl`, `processingApi.start/stream/confirm/getLogs/clearLogs`, `casesApi.getForDocument/run/getLogs/stream`).
- `apps/web/lib/api.ts:437-477`
  - Metadata APIs use plain `number` `tagId`/`fieldId`; pending unblock uses plain `number` `blockId`.
- `apps/web/app/documents/[id]/page.tsx:420-422`
  - Frontend document detail parses dynamic route param with `parseInt(resolvedParams.id)` without radix, regex validation, positivity, or safe integer guard. Invalid params produce `NaN` and are passed to API calls.
- `apps/web/app/documents/[id]/log/page.tsx:409-412`
  - Processing log page does the same unbounded `parseInt(resolvedParams.id)`.
- `apps/web/app/documents/[id]/process/page.tsx:1-9`
  - Legacy process route redirects string `id` to `/documents/${id}/log`; no parsing needed here unless choosing to normalize invalid IDs before redirect.
- `apps/web/components/documents/document-list-model.ts:5-9`
  - Good local pattern exists for numeric search: trim, `/^\d+$/`, `Number`, `Number.isSafeInteger`, `> 0`.
  - This should be consolidated into central helper instead of duplicating.

### Tests already covering adjacent behavior
- `apps/backend/tests/api/router.test.ts:170-196`
  - Existing validation tests verify invalid numeric path params return `ValidationError`; add bounded/safe-integer cases here.
- `apps/web/tests/document-list-model.test.ts:34-40`
  - Existing tests for numeric search normalization; after moving logic to central helper, retain/extend these to cover max safe integer and invalid digit strings.
- No tests exist in `packages/api-contracts`; if adding contract-level runtime helpers, create a small Vitest setup only if package already supports it? It currently has build/typecheck/lint only. Prefer adding tests in backend/web unless adding a package test script is approved.

## Recommended central helper design

### New shared helper module
Create `packages/api-contracts/src/ids.ts` (or `id-types.ts`) and export it from `packages/api-contracts/src/index.ts`.

Recommended contents:
```ts
import { Schema } from "effect";

export const PositiveSafeIntSchema = Schema.Number.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const PositiveSafeIntFromStringSchema = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.positive(),
  Schema.lessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);

export const DocumentIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("DocumentId"));
export const DocumentIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(Schema.brand("DocumentId"));
export type DocumentId = Schema.Schema.Type<typeof DocumentIdSchema>;

export const TagIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("TagId"));
export const TagIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(Schema.brand("TagId"));
export type TagId = Schema.Schema.Type<typeof TagIdSchema>;

export const CustomFieldIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("CustomFieldId"));
export const CustomFieldIdFromStringSchema = PositiveSafeIntFromStringSchema.pipe(Schema.brand("CustomFieldId"));
export type CustomFieldId = Schema.Schema.Type<typeof CustomFieldIdSchema>;

export const DocumentTypeIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("DocumentTypeId"));
export const CorrespondentIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("CorrespondentId"));
export const BlockedSuggestionIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("BlockedSuggestionId"));
export const MetadataEntityIdSchema = PositiveSafeIntSchema.pipe(Schema.brand("MetadataEntityId"));
```
Notes:
- Keep brands compile-time only; values remain numbers at runtime.
- Use `Schema.NullOr(X).pipe(Schema.optional)` wrappers for nullable body fields.
- For IDs that can be zero/null in upstream Paperless? Local evidence treats path IDs as strictly positive and nullable fields as `number | null`; do not allow `0` unless a specific field is known to use it. Existing frontend numeric search rejects `0`.
- Generic helpers should include `parsePositiveSafeIntString(value): number | null` or an Effect Schema decoder only if frontend needs a framework-neutral parse. Because frontend should not depend on Effect decoding in React components unnecessarily, a tiny pure helper is useful:
```ts
export const parsePositiveSafeIntString = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = Number(trimmed);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
```
If returning branded IDs from pure parser, cast only after checks: `return id as DocumentId` via a generic brand-specific wrapper or dedicated `parseDocumentId`.

### Update existing schemas to use helpers
- In `request-schemas.ts`, replace `PositiveIntFromStringSchema` with import/re-export/alias to `PositiveSafeIntFromStringSchema` to preserve current API imports while improving bounds/branding.
- Replace `NumberArraySchema` for ID arrays with positive safe integer arrays where field names are IDs:
  - `SelectedTypeIdsBodySchema.selected_type_ids` -> `DocumentTypeIdSchema` array (if document type ID)
  - `SelectedFieldIdsBodySchema.selected_field_ids` -> `CustomFieldIdSchema` array
  - `SelectedTagIdsBodySchema.selected_tag_ids` -> `TagIdSchema` array
  - `CaseAnswerBodySchema.selectedEntityId` -> `MetadataEntityIdSchema` nullable optional (entity kind varies)
  - `metadataPatch.correspondentId` -> `CorrespondentIdSchema` nullable optional
  - `metadataPatch.documentTypeId` -> `DocumentTypeIdSchema` nullable optional
  - `metadataPatch.tagIds` -> `TagIdSchema` array
  - `TagBulkUpdateBodySchema.id` -> `TagIdSchema`
  - `CustomFieldBulkUpdateBodySchema.id` -> `CustomFieldIdSchema`
  - `BlockSuggestionBodySchema.doc_id` -> `DocumentIdSchema` nullable optional
- Beware readonly arrays from Effect Schema decode; existing router has `mutableNumberArray()` and `toCaseAnswerHandlerBody()` to convert readonly arrays back to mutable handler expectations.
- Type assignability risk: branded numbers may not assign to plain `number[]` in mutable helpers/handlers depending on TypeScript variance. Since branded number is assignable to number, most call sites should work, but readonly branded arrays to `number[]` may still need `[...array]` (already done in many places).

### Backend parser design
- In `apps/backend/src/api/index.ts`, replace `positiveIntParam` with named typed parsers or a generic parser over a schema:
```ts
const documentIdParam = (params, name = "docId") => paramSchema(DocumentIdFromStringSchema, routeParam(params, name), name);
const tagIdParam = ...;
const customFieldIdParam = ...;
const blockedSuggestionIdParam = ...;
```
- For `/api/documents/:id`, use `documentIdParam(params, "id")`.
- For `docId` routes and search indexing, use `documentIdParam(params, "docId")`.
- For tag/custom field/block ID routes, use respective helpers.
- Handlers currently accept `number`; branded IDs should pass because they are numbers. Avoid changing service signatures in this task unless typecheck demands it.

### SSE bounded parsing
- Reuse the same central parsing in `apps/backend/src/server.ts` for processing/case streams.
- Current regex already excludes non-digits but not unsafe integer length. Recommended: keep regex for quick matching, then decode with `DocumentIdFromStringSchema` via `Schema.decodeUnknownEither` or pure `parseDocumentId`; reject invalid/unsafe with the same 400 JSON.
- Also consider read-only safe method regex (`apps/backend/src/server.ts:237`) currently uses `\d+`; it can remain as path authorization pattern, but unsafe digit streams should still fail later.

### Frontend bounded parsing and branded parameters
- Reuse shared pure parser in `apps/web/components/documents/document-list-model.ts:getNumericSearchId` to avoid duplicate regex logic.
- Replace `parseInt(resolvedParams.id)` in:
  - `apps/web/app/documents/[id]/page.tsx:422`
  - `apps/web/app/documents/[id]/log/page.tsx:411`
- Suggested UX: if `parseDocumentIdParam(resolvedParams.id)` returns null, render `notFound()` or an error state before firing API calls. In client components, `notFound()` from `next/navigation` may be usable, but if this file is a client component verify imports/behavior. Safer minimal approach: set `docId` to `null` and render an invalid-document message without calling APIs; but route pages currently assume `number` throughout. Planner should choose one consistent approach.
- API client (`apps/web/lib/api.ts`) can accept branded aliases for better compile-time intent:
  - `documentsApi.get(id: DocumentId)` etc.
  - `processingApi.*(docId: DocumentId)`
  - `casesApi.getForDocument/run/getLogs/stream(docId: DocumentId)`
  - `metadataApi.*(tagId: TagId, fieldId: CustomFieldId)`
  - `pendingApi.unblock(blockId: BlockedSuggestionId)`
  This may require casting existing numeric data returned by server if response interfaces remain plain number. To keep churn bounded, initially type route parsing outputs and request body schemas; widen API client params to `number` if brands cause excessive UI casts.

### OpenAPI contract update
- Current `pathParameters()` makes all path params strings. Add a small mapper by param name:
  - numeric IDs: `id`, `docId`, `tagId`, `fieldId`, `blockId` when route context indicates numeric. Careful: `{id}` is ambiguous because `/api/pending/{id}` is string while `/api/schema/blocked/{id}` is numeric and `/api/documents/{id}` is numeric. Name-only mapping is unsafe for plain `id`.
  - Suggested function: `pathParameterSchema(path, name)` and route/path-aware cases:
    - `/api/documents/{id}` family: integer min 1 max `Number.MAX_SAFE_INTEGER`
    - `/api/schema/blocked/{id}`: integer min 1 max safe
    - `docId`, `tagId`, `fieldId`, `blockId`: integer min 1 max safe
    - `caseId`, `questionId`, `runId`, `proposalId`, `service`, `jobName`, `targetLang`, `lang`, pending `{id}`: string
- This keeps docs aligned with backend. Brands will likely not show in JSON Schema; optionally add `description` or `x-brand`, but do not rely on that for validation.

## Implementation risks / constraints
- **No PromptService/prompt-file changes**: unrelated but mandatory project rule.
- **Effect Schema brands may alter inferred request types**. Downstream handlers/services mostly accept plain `number`; branded `number` should be assignable to number, but arrays are readonly from Schema and already require mutable copies.
- **Ambiguous `id` path params**: do not globally treat `{id}` as numeric; pending item IDs are strings.
- **Frontend route invalid IDs currently cause API calls with `NaN`**. Fixing this may require UI behavior choice (`notFound` vs inline error). If not obvious, escalate to parent/planner.
- **SSE stream routes bypass `handleRequest`**, so changing only router helpers will leave a hole.
- **OpenAPI path params are generated from route strings**, not schemas, so explicit mapping is required.

## Suggested tests

### Backend (`apps/backend/tests/api/router.test.ts`)
Add validation tests for:
- `/api/documents/9007199254740992` rejects (`MAX_SAFE_INTEGER + 1`).
- `/api/documents/0`, `/api/documents/-1`, `/api/documents/1.5` reject or 404 as applicable. Note: route regex `([^/]+)` matches `-1` and `1.5`, so these should produce ValidationError, not 404.
- `/api/metadata/tags/9007199254740992` rejects before handler.
- String routes still accept string IDs where intended (e.g. `/api/pending/some-string` attempts handler and may require dependencies, so avoid if service dependencies make it hard).

### Backend SSE (`apps/backend/src/server.ts`)
Harder to unit test because full server/runtime. If no existing server route test harness, note as manual/targeted validation:
- GET `/api/processing/9007199254740992/stream` returns 400 `Invalid document ID` instead of attempting stream.
- GET `/api/cases/document/9007199254740992/stream` returns 400.
If adding tests is expensive, keep parser as a small exported/internal pure function and test it in a lightweight unit test.

### Frontend (`apps/web/tests/document-list-model.test.ts` and/or new helper tests)
- Existing tests cover positive, zero, negative, non-numeric.
- Add max safe boundary:
  - `String(Number.MAX_SAFE_INTEGER)` accepted.
  - `"9007199254740992"` rejected.
  - decimals and whitespace around valid digits handled consistently.
- If document route parsing is factored into a pure helper, test that helper instead of trying to render Next route pages.

### API contracts / type validation
- Run `pnpm --filter @repo/api-contracts typecheck` and build.
- If adding branded aliases to exported types/interfaces, run full `pnpm run typecheck` to catch frontend/backend assignment churn.

## Validation commands
- `pnpm --filter @repo/api-contracts typecheck`
- `pnpm --filter @repo/api-contracts build`
- `pnpm --filter @repo/backend test -- apps/backend/tests/api/router.test.ts` (Vitest filter may vary; if not accepted, run `pnpm --filter @repo/backend test`)
- `pnpm --filter @repo/web test -- apps/web/tests/document-list-model.test.ts` (or full `pnpm --filter @repo/web test`)
- `pnpm run typecheck`
- `pnpm run lint` if code was edited

## Compact worker prompt

Implement branded ID/domain types and bounded ID parsing. Add a shared exported helper module in `packages/api-contracts` with positive safe integer schemas, string parsers, and brands for DocumentId, TagId, CustomFieldId, DocumentTypeId, CorrespondentId, BlockedSuggestionId/MetadataEntityId. Update request schemas so all ID-bearing body fields use positive safe integers and nullable wrappers where currently nullable. Preserve or alias `PositiveIntFromStringSchema` to avoid import churn, but ensure it bounds to `Number.MAX_SAFE_INTEGER` and consider branded route-specific schemas.

Update backend route param parsing in `apps/backend/src/api/index.ts` to use route-specific ID parsers for document/tag/custom-field/block IDs while keeping string IDs (pending item IDs, case/question/catalog IDs, service/job/lang) as strings. Also update SSE stream parsing in `apps/backend/src/server.ts`; current stream regex/`parseInt` accepts unsafe digit strings, so decode with the shared bounded DocumentId parser and return the existing 400 invalid-document response on failure.

Update frontend route param parsing in `apps/web/app/documents/[id]/page.tsx` and `apps/web/app/documents/[id]/log/page.tsx` to use the same bounded positive safe integer logic instead of raw `parseInt`; avoid firing API calls for invalid IDs. Reuse the shared parser in `components/documents/document-list-model.ts` for numeric search. Optionally type API client ID params with the new brands if the churn is manageable; otherwise keep runtime boundary fixes first.

Update OpenAPI path parameter generation so numeric route params are documented as integer min 1 max `Number.MAX_SAFE_INTEGER`, but do not globally treat `{id}` as numeric because `/api/pending/{id}` is a string ID. Add/extend tests for unsafe integers and invalid IDs in backend router tests and frontend numeric parser tests. Validate with api-contracts typecheck/build, backend router tests, web parser tests, and full typecheck/lint if files changed.
