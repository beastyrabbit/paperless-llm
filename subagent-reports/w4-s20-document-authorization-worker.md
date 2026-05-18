# W4-S20 Document Authorization Worker Report

## Implemented

Added centralized per-document authorization hooks without inventing a local ACL/user model.

The current product model remains single-token/local by default. The new `DocumentAuthorizationService` defaults to permissive no-op behavior and can optionally perform Paperless-backed document visibility checks when `PAPERLESS_LLM_DOCUMENT_AUTHORIZATION` is set to `paperless`, `paperless-view`, or `upstream`.

## Changed files

- `apps/backend/src/services/DocumentAuthorizationService.ts`
  - New Effect service with `authorizeDocument()` and `filterAuthorizedDocuments()`.
  - Default no-op layer for tests/current single-user mode.
  - Optional Paperless `getDocument()` visibility check mode, normalized to `NotFoundError` for denied/not-found access.
- `apps/backend/src/services/index.ts`
  - Exported document authorization service/types/layers.
- `apps/backend/src/layers/index.ts`
  - Provided document authorization in the app layer after Paperless is available.
- `apps/backend/src/api/documents/handlers.ts`
  - Added authorization checks for document detail/content/PDF/cleanup-tags.
- `apps/backend/src/api/processing/handlers.ts`
  - Added authorization checks for start/confirm/cancel/release-lock/get logs/clear logs.
- `apps/backend/src/api/cases/handlers.ts`
  - Added authorization checks for list/get/document case/run/logs and question answer by owning case/doc.
  - Filters list results through the authorization boundary.
- `apps/backend/src/api/search/handlers.ts`
  - Added auth before indexing a document.
  - Filters Qdrant search results through the authorization boundary before returning.
- `apps/backend/src/api/chat/handlers.ts`
  - Filters Qdrant RAG sources before prompt/context construction and before returning sources.
- `apps/backend/src/server.ts`
  - Added authorization before opening processing SSE and case SSE streams.
- Tests updated/added:
  - `apps/backend/tests/api/documents.test.ts`
  - `apps/backend/tests/api/processing.test.ts`
  - `apps/backend/tests/api/cases.test.ts`
  - `apps/backend/tests/api/chat.test.ts`
  - `apps/backend/tests/server.test.ts`

## Validation

Passed:

```sh
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test -- tests/api/processing.test.ts tests/api/documents.test.ts tests/api/cases.test.ts tests/api/chat.test.ts tests/server.test.ts
```

Also ran full backend tests:

```sh
pnpm --filter @repo/backend test
```

Full suite had one remaining unrelated failure in `tests/api/router.test.ts` (`rejects oversized settings strings before handlers run`) due `TinyBaseService` not being provided in that existing route-test path. The authorization-related server failures from missing test auth service were fixed.

## Notes / risks

- No multi-user ownership/ACL model exists locally; this implementation intentionally does not invent one.
- Default behavior preserves the current single-token app behavior.
- Optional Paperless-backed mode adds per-result Paperless reads for derived stores (search/chat/cases), which is acceptable for current small limits but may need batching/caching if enabled in high-volume environments.
- Mutating capability checks are still not distinguishable from view checks without a real principal or safe upstream permission endpoint; the hook centralizes future enforcement.
