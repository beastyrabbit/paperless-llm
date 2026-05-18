# Todo #49 / W4-S20 — Per-document authorization checks handoff

## Executive summary

The app currently has only a single backend API token (`Authorization: Bearer` / `X-API-Key`) and forwards one configured Paperless token to Paperless-ngx. There is no local user/session identity and no local document ACL model. Paperless-ngx itself is owner/object-permission aware, so a least-privileged Paperless token already constrains direct Paperless API reads/writes; however local state and derived stores (TinyBase cases/logs and Qdrant search/chat payloads) are not filtered by Paperless document visibility.

Implementation should therefore add a small document-authorization boundary/hook around routes that accept a `docId` or expose derived document data. For today’s single-user local product model, this can be a minimal `DocumentAuthorizationService` that defaults to permissive/no-op, but centralizes future checks and protects derived state when an authorization mode is enabled.

## Product/auth model findings

- Current product docs frame this as a local app for Paperless-ngx (`README.md:3-7`) and production safety uses least-privileged Paperless tokens/read-only mode, not local users:
  - `docs/PROD_READONLY.md:3-15`: read-only mode blocks mutations and processing streams when pointed at production.
  - `docs/PROD_READONLY.md:45-49`: recommends least-privileged Paperless token, disabled auto-processing/pipeline, allowed Paperless hosts.
- Backend auth is app-token only:
  - `apps/backend/src/server.ts:365-374` `isAuthorized()` accepts only `Authorization: Bearer <PAPERLESS_LLM_API_TOKEN>` or `X-API-Key`; public paths bypass auth.
  - No request principal/user is extracted; `handleRequest(req, res, body)` receives only raw request/body (`apps/backend/src/server.ts:965`; `apps/backend/src/api/index.ts:800-858`).
- Web proxy injects the same app token for browser calls:
  - `apps/web/app/api/[...path]/route.ts:96-113` creates backend request and sets `authorization: Bearer ${apiAuthToken}` when configured.
  - This means frontend requests cannot distinguish Paperless users.
- PaperlessService uses one configured Paperless token for all upstream calls:
  - Interface doc operations in `apps/backend/src/services/PaperlessService.ts:60-85`.
  - Requests send `Authorization: Token ${token}` at `PaperlessService.ts:332`, `:402`, `:459`.
  - `getDocument`, `updateDocument`, `downloadPdf`, `getDocumentContent` use normal Paperless endpoints (`PaperlessService.ts:574`, `:635`, `:637`, `:642`).
- Local `Document` model omits Paperless permission fields:
  - `apps/backend/src/models/index.ts:10-28` includes id/title/content/tags/etc.
  - It does **not** include `owner`, `permissions`, `user_can_change`, `is_shared_by_requester`.

## Paperless-ngx reference behavior

Local `.ref/paperless-ngx` shows the product model Paperless uses:

- Object permission class:
  - `.ref/paperless-ngx/src/documents/permissions.py:28-50`: `PaperlessObjectPermissions` maps methods to `view/add/change/delete` permissions and allows owner; unowned objects are allowed.
- Document visibility:
  - `.ref/paperless-ngx/src/documents/permissions.py:166-214`: `_permitted_document_ids(user)` returns documents where user is owner, document is unowned, or user/group has `view_document`; superuser sees all.
  - `.ref/paperless-ngx/src/documents/permissions.py:258-287`: `get_objects_for_user_owner_aware()` and `has_perms_owner_aware()` implement owner/unowned/guardian-perm checks.
- View filtering:
  - `.ref/paperless-ngx/src/documents/filters.py:950-961`: `ObjectOwnedOrGrantedPermissionsFilter` returns objects with explicit perms, owned by requester, or unowned.
  - `.ref/paperless-ngx/src/documents/views.py:943-960`: `DocumentViewSet` uses `IsAuthenticated`, `PaperlessObjectPermissions`, and `ObjectOwnedOrGrantedPermissionsFilter`.
  - Several detail actions manually call `has_perms_owner_aware()` (e.g. `.ref/.../views.py:1097-1112`).
- API response shape can include ACL data:
  - `.ref/paperless-ngx/src/documents/serialisers.py:1017-1021`: document serializer has `owner` field.
  - `.ref/.../serialisers.py:1226-1250`: document fields include `owner`, `permissions`, `user_can_change`, `is_shared_by_requester`, `set_permissions`.

## Routes that need hooks/checks

### Direct doc-id routes

Registered in `apps/backend/src/api/index.ts`:

- Document reads/mutation:
  - `GET /api/documents/:id` (`index.ts:484` -> `documentsHandlers.getDocument`, `handlers.ts:262`).
  - `GET /api/documents/:id/content` (`index.ts:488` -> `getDocumentContent`, `handlers.ts:326`).
  - `GET /api/documents/:id/pdf` (`index.ts:492` -> `getDocumentPdf`, `handlers.ts:342`).
  - `POST /api/documents/:id/cleanup-tags` (`index.ts:496-508` -> `cleanupDocumentTags`, `handlers.ts:352`).
- Processing:
  - `POST /api/processing/:docId/start` (`index.ts:511-520` -> `startProcessing`, `processing/handlers.ts:20`).
  - `POST /api/processing/:docId/confirm` (`index.ts:522-527`).
  - `POST /api/processing/:docId/cancel` (`index.ts:529-536`; verify compile state because `cancelProcessing`/schema were not in the read handler snippet).
  - `POST /api/processing/:docId/release-lock` (`index.ts:538-546` -> `releaseDocumentLock`, `processing/handlers.ts:107`).
  - `GET/DELETE /api/processing/:docId/logs` (`index.ts:556-560` -> `getProcessingLogs`/`clearProcessingLogs`, `processing/handlers.ts:218-228`).
- Cases:
  - `GET /api/cases/document/:docId` (`index.ts:575-577` -> `getOrCreateDocumentCase`, `cases/handlers.ts:302`).
  - `POST /api/cases/document/:docId/run` (`index.ts:579-584` -> `runCase`, `cases/handlers.ts:363`).
  - `GET /api/cases/document/:docId/logs` (`index.ts:586-588` -> `getCaseLogs`, `cases/handlers.ts:385`).
  - `GET /api/cases/:caseId` (`index.ts:601-602` -> `getCase`, `cases/handlers.ts:294`) where case id is usually `doc-${docId}`.
  - `POST /api/cases/questions/:questionId/answer` (`index.ts:590-599` -> `answerQuestion`, `cases/handlers.ts:309`) must authorize based on the question’s owning case/doc after lookup.
- Search/index/chat:
  - `POST /api/search/index/:docId` (`index.ts:773-774` -> `searchHandlers.indexDocument`, `search/handlers.ts:37`).
  - `GET /api/search` (`index.ts:772`) returns Qdrant results with doc IDs/titles without Paperless recheck (`search/handlers.ts:10-34`).
  - `POST /api/chat` (`index.ts:781-785`) searches Qdrant and returns sources (`chat/handlers.ts:49-131`).

### SSE routes outside `api/index.ts`

These bypass `handleRequest()` and are handled directly in `apps/backend/src/server.ts`:

- `GET /api/processing/:docId/stream`: regex at `server.ts:196`, match at `server.ts:852-867`, implementation `handleSSEStream` starts at `server.ts:485`.
- `GET /api/cases/document/:docId/stream`: regex at `server.ts:197`, match at `server.ts:852-899`.
- Catalog stream is not per-document (`server.ts:198`, `:900-938`) but may expose catalog logs; not in scope unless logs contain doc IDs/content.

These need explicit authorization before opening the SSE response; they will not be covered by a router-level middleware added only to `handleRequest()`.

### List/derived routes

- `GET /api/documents/pending` uses Paperless `getDocumentsByTags()` (`documents/handlers.ts:108-180`), so Paperless token visibility applies upstream.
- `GET /api/documents/queue` aggregates counts from Paperless (`documents/handlers.ts:13-91`); if using a least-privileged Paperless token, upstream filtering should apply, but semantics of queue counts under limited tokens should be verified.
- `GET /api/cases` returns all local TinyBase cases after syncing workflow docs (`cases/handlers.ts:282-291`) and is not currently Paperless-visibility-filtered.
- `GET /api/processing/locks`, `/api/processing/status`, `/api/processing/auto/status` may reveal current doc IDs/lock owners. Decide if they are admin-only or if single-user local makes them safe.
- Qdrant payload currently stores only `docId`, title, tags, correspondent, document type (`QdrantService.ts:27-43`, `:212-219`), and `searchSimilar()` returns those directly (`QdrantService.ts:139-188`). There is no ACL payload/filter.

## Decision points for planner/product

1. **Single-user local only vs multi-user Paperless passthrough**
   - If single-user local is the product model, implement an authorization service hook that permits all by default but is called consistently. This satisfies “where product model requires it” without inventing local users.
   - If multi-user is required, the current architecture is insufficient: web proxy/backend must carry a real Paperless user/session/token per request or maintain local user/ACL state. A single app token cannot tell which Paperless user is requesting.
2. **Use upstream Paperless as the source of truth?**
   - Recommended for minimal implementation: `authorizeDocument(docId, action)` calls `paperless.getDocument(docId)` for `view` actions and `paperless.updateDocument(docId, {})` is **not** acceptable for change checks because it mutates/risks mutation. For mutations, rely on the actual mutating Paperless call to fail, or add a safe capability check only if Paperless exposes one for the current token.
   - For derived local data (cases/logs/Qdrant), `paperless.getDocument(docId)` before returning data is a safe view check and prevents local leakage when Paperless denies/404s.
3. **404 vs 403 behavior**
   - To avoid existence leaks, prefer mapping denied/not-found from authorization checks to a uniform `404 Not Found` for document-scoped local data. Direct Paperless calls already return upstream status through current error mapping.
4. **Qdrant/search strategy**
   - Minimal: after vector search, recheck each result with `paperless.getDocument(docId)` and drop denied docs before returning. Do the same for chat sources/context.
   - Better future: store ACL metadata (`owner`, view user/group IDs) in payload and filter in Qdrant only if a real principal exists. Not useful in current single-token design.
5. **Cases/questions**
   - Cases are local and keyed by doc id, so they need an authorization check around every case read/write. Question answer routes must first load the question/case to learn `docId`, then authorize, then answer.
6. **Admin operational endpoints**
   - Decide whether lock/status endpoints remain app-token-admin-only. If not, filter/remove current doc IDs that are not authorized.

## Minimal implementation hooks/placeholders

Suggested minimal shape (implementation worker can adjust names):

- Add `apps/backend/src/services/DocumentAuthorizationService.ts` with Effect service:
  - `authorizeDocument(docId: number, action: "view" | "process" | "change" | "admin"): Effect.Effect<void, NotFoundError | AuthorizationError>`
  - `filterAuthorizedDocuments<T extends { id?: number; docId?: number }>(items, action): Effect.Effect<T[], never>` for search/list cases.
  - Default/single-user mode: if `PAPERLESS_LLM_DOCUMENT_AUTHORIZATION` is unset/`"single-user"`, return `Effect.void` but still centralizes calls.
  - Optional Paperless-backed mode: for `view`/derived reads, call `paperless.getDocument(docId)` and map 404/403-like Paperless failures to `NotFoundError`/`AuthorizationError`.
- Export from `apps/backend/src/services/index.ts` and provide in `apps/backend/src/layers/index.ts`.
- Add a small error type in `apps/backend/src/errors/index.ts` only if there is no existing auth/forbidden error. Map to HTTP 403 or 404 in `server.ts:421-450` (`toHttpError`).
- Wire hooks into:
  - Router handlers listed above.
  - SSE direct branches in `server.ts` before `res.writeHead(200)`.
  - Search/chat post-filtering before returning Qdrant results/sources.
  - `listCases()` filtering before returning local cases.
- Do **not** reintroduce prompt-file/PromptService paths; unrelated but mandatory project rule.

## Implementation risks/constraints

- **No real principal exists.** Anything beyond single-user/no-op or upstream-token visibility requires product decision and broader auth design.
- **Paperless GET can be both existence and visibility check.** Under a least-privileged token, a forbidden doc may appear as 403 or 404 depending on Paperless; normalize if avoiding leaks.
- **Derived stores can leak stale titles/doc IDs.** Qdrant and TinyBase must be filtered; PaperlessService-only changes are not enough.
- **SSE bypasses router.** Any router-only guard misses processing/case streams.
- **Potential compile drift nearby:** `api/index.ts:529-536` references cancel route symbols; verify current branch before editing.
- **Performance:** per-result Paperless checks in search/chat can add N requests. Limit is small (search default 10, chat 5), acceptable for minimal fix. For case lists, consider batching by doc IDs if Paperless supports it; otherwise serial/parallel with bounded concurrency.

## Tests to add/update

Backend unit tests:

- `apps/backend/tests/server.test.ts`
  - Existing auth helper tests at `server.test.ts:156-187` cover app token only. Add tests for SSE doc auth if service is injectable with test layer, or extract a pure helper for stream authorization decisions.
- `apps/backend/tests/api/documents.test.ts`
  - Currently only queue stats test. Add tests that `getDocumentContent`, `getDocumentPdf`, and `cleanupDocumentTags` call `DocumentAuthorizationService` before local response/mutation (or fail when denied).
- `apps/backend/tests/api/processing.test.ts`
  - Existing release-lock tests use mock `LockService`/`DocumentCaseService`/`TinyBaseService`. Add `DocumentAuthorizationService` mock and assert denied `releaseDocumentLock`, `getProcessingLogs`, `clearProcessingLogs`, `startProcessing` do not mutate/call pipeline/locks.
- `apps/backend/tests/api/cases.test.ts`
  - Add denied tests for `getOrCreateDocumentCase`, `runCase`, `getCaseLogs`, `getCase`, and `answerQuestion` (answer must not persist when owning doc denied).
- `apps/backend/tests/api/router.test.ts`
  - Confirm doc-scoped route requests map denied auth errors to expected HTTP shape if testing through `handleRequest`.
- `apps/backend/tests/api/chat.test.ts` and/or `apps/backend/tests/api/search.test.ts` (new if absent)
  - Mock Qdrant returns mixed docs; mock auth denies one; response drops denied sources/results.
- `apps/backend/tests/services/PaperlessService.test.ts`
  - Only needed if adding Paperless ACL/permission fields to model parsing or client behavior.

Frontend tests likely unnecessary for minimal backend guard unless error handling changes response shape.

## Validation commands

Recommended after implementation:

```sh
pnpm --filter @repo/backend test
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

If root scripts are the expected workflow, run:

```sh
pnpm run test
pnpm run typecheck
pnpm run lint
```

Manual checks:

1. With default single-user/no-op mode, existing document detail, PDF, processing stream, case page, search, chat still work.
2. With a test auth service denying doc `123`, all doc-scoped local endpoints return the chosen denial status and do not stream/process/mutate.
3. Search/chat never return denied doc IDs/titles from Qdrant.
4. Production read-only mode still blocks mutating/processing routes before or alongside auth checks (`docs/PROD_READONLY.md` contract unchanged).

## Final worker prompt

Implement Todo #49 / W4-S20: add implementation-ready per-document authorization hooks where the product model requires them. The current app has only single app-token auth and one configured Paperless token; there is no per-request user identity. Therefore implement a central Effect-based `DocumentAuthorizationService` that defaults to single-user permissive mode but is called consistently for every document-scoped route and derived document data path. If adding an optional Paperless-backed mode, use `paperless.getDocument(docId)` as the safe view check and normalize denial/not-found according to existing error conventions.

Required coverage:
- Direct doc routes: `/api/documents/:id`, `/:id/content`, `/:id/pdf`, `/:id/cleanup-tags`.
- Processing routes: start/confirm/cancel/release-lock/logs and processing SSE stream.
- Case routes: document case get/run/logs, case by `doc-${id}`, question answer by owning case/doc, case SSE stream, and filtered `listCases()`.
- Search/chat: post-filter Qdrant results/sources by document authorization before returning or injecting into prompts.
- Export/provide the new service through existing service/layer indexes; add a small auth error mapping only if needed.

Do not invent multi-user auth or local ACLs without a product decision. Do not change prompt architecture. Preserve read-only mode behavior. Add targeted backend tests for denied docs and no-op single-user behavior. Validate with backend tests, typecheck, and lint.
