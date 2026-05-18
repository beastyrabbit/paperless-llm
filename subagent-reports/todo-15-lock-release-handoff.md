# Todo #15 / W3-S14 — Admin lock release endpoint/UI action handoff

## Goal
Build an admin-facing action that releases a stuck document processing lock, with a backend endpoint and settings/admin UI affordance. Do **not** treat this as a normal user flow: it is a manual recovery tool for stale/stuck processing locks.

## Current lock model and behavior

### LockService
File: `apps/backend/src/services/LockService.ts`

Key lines:
- `LockScope` is currently only `"document" | "catalog"` (`:8`).
- `DurableLock` includes `id`, `scope`, `resourceId`, `owner`, `runId`, `acquiredAt`, `heartbeatAt`, `expiresAt`, `metadata` (`:10-20`).
- `LockService.release(scope, resourceId, runId?)` already exists (`:37-43`).
- `lockId(scope, resourceId)` is `${scope}:${resourceId}` (`:62-63`).
- `acquire` refuses to acquire an unexpired existing lock and returns `{ acquired:false, lock: existing }` (`:116-126`).
- `release` deletes the `locks` TinyBase row. If `runId` is provided it must match; if omitted, it force-releases any lock for that scope/resource (`:151-159`).
- `get`, `heartbeat`, `list`, and `pruneStale` already exist (`:169-230`).

Important implication: no new storage primitive is required for force release. Use `get` first if the endpoint needs to return/log the previous lock, then call `release("document", docId, maybeRunId)`.

### Pipeline lock lifecycle
File: `apps/backend/src/agents/ProcessingPipeline.ts`

Key lines:
- Processing acquires a document lock with owner `"pipeline"` and metadata `{ source: "processing_pipeline" }` (`:342-349`). It does not pass `runId`, so LockService generates one.
- Lock contention records a processing log with active run id, owner, and expiresAt (`:350-362`), then fails with “already being processed” (`:363-368`).
- Successful acquisition patches case `activeRunId` when not dry-run (`:370-372`) and logs `lock_acquired` or `lock_stale` (`:373-385`) plus `run_started` (`:386-392`).
- Heartbeat refreshes the lock by matching run id (`:396-428`).
- Normal cleanup calls `locks.release("document", docId, lock.runId)` and clears the case `activeRunId` only when it still matches the pipeline run id (`:479-500`), then logs `lock_released` (`:503-509`).

Implementation risk: force-releasing a live lock lets another run start while the old pipeline may still be executing. UI copy should clearly warn. Backend should return the previous lock details so users can see what was released.

### Existing stale recovery behavior in cases API
File: `apps/backend/src/api/cases/handlers.ts`

Key lines:
- `recoverStaleActiveWorkflowTag` checks `LockService.get("document", docId)` (`:91-102`).
- If an active lock exists, it updates the case to `automationStatus: "running"` and `activeRunId: activeLock.runId` (`:122-132`).
- If no active lock exists and the document has active workflow tags, it retags to queued, clears `activeRunId`, sets `automationStatus: "queued"`, and logs `lock_stale` (`:148-188`).
- `reconcileRunningCase` prunes stale locks, checks for an active lock, and if none, queues the case and logs stale recovery (`:193-235`).

Useful follow-up after manual release: the endpoint can either explicitly update the case/log (recommended for immediate UI consistency) or rely on cases list/get reconciliation. For an admin action, explicit case update and log is clearer.

## Existing processing API/router shape

### Route registry
File: `apps/backend/src/api/index.ts`

Relevant processing routes currently live together around `:464-530`:
- `POST /api/processing/:docId/start` validates `docId` and `ProcessingStartBodySchema`, then calls `processingHandlers.startProcessing` (`:493-504` in file; see nearby processing section).
- `POST /api/processing/:docId/confirm`
- `GET /api/processing/status`
- `GET /api/processing/:docId/logs`
- `DELETE /api/processing/:docId/logs`
- `GET /api/processing/auto/status`
- `POST /api/processing/auto/trigger`

Pattern: route uses `positiveIntParam(params, "docId")`, `bodySchema(...)` for bodies, and `Effect.flatMap(handler)`.

### Processing handlers
File: `apps/backend/src/api/processing/handlers.ts`

Current imports only include `AutoProcessingService`, `PaperlessService`, `TinyBaseService` from services (`:6-8`). Add `LockService` and likely `DocumentCaseService` if the endpoint updates case state.

Current handler style:
- `startProcessing(docId, step?, dryRun?)` returns snake_case JSON (`status`, `doc_id`, etc.) (`:14-41`).
- `getProcessingStatus` returns snake_case status for frontend (`:69-84`).
- `triggerAutoProcessing` returns `{ message, running, enabled, currently_processing_doc_id }` (`:128-137`).

Suggested endpoint/API shape:

```http
POST /api/processing/:docId/release-lock
Content-Type: application/json

{
  "runId": "optional-run-id-to-match",  // optional safety guard
  "force": true                         // optional; see note below
}
```

Response shape:

```ts
interface LockReleaseResponse {
  success: boolean;
  doc_id: number;
  released: boolean;
  previous_lock: DurableLock | null;
  message: string;
}
```

Recommended semantics:
- Fetch `previousLock = yield* locks.get("document", docId)` before release.
- If no lock: return `{ success: true, released: false, previous_lock: null, message: "No active lock for document ..." }`.
- If `runId` is supplied and does not match: `release` will return false. Prefer returning a 409-like payload if this codebase supports statusful payloads, or `{ success:false, released:false, previous_lock }` with clear message. There is no existing HTTP status helper in handlers; router often serializes returned objects directly.
- If no `runId` is supplied, this is a force release because `LockService.release` omits the run-id guard. UI can omit runId for a simple admin “force release current lock” action.
- After successful release, update `DocumentCaseService.getOrCreateCaseForDocument(docId)` and, if `activeRunId` is null or matches `previousLock.runId`, set `{ activeRunId:null, automationStatus:"queued" }` or at minimum clear `activeRunId`. Consider preserving non-running statuses (`needs_input`, `done`, `failed`) rather than forcing queued.
- Log via `TinyBaseService.addProcessingLog` with `step: "lock"`, `eventType: "lock_released"`, data including `{ manual: true, previousRunId, owner, expiresAt }`. `lock_released` is already an allowed event type (`packages/api-contracts/src/types.ts:699-724`).

Contract additions needed:
- `packages/api-contracts/src/request-schemas.ts`: add a body schema, likely `LockReleaseBodySchema = Schema.Struct({ runId: OptionalStringSchema, force: OptionalBooleanSchema })`; export its type. See processing schema pattern at `:98-102`.
- `packages/api-contracts/src/types.ts`: add `DurableLock`/`LockReleaseResponse`-style exported interfaces, or local API typing can use an inline frontend type. Prefer contracts because `apps/web/lib/api.ts` imports all shared response types.
- `packages/api-contracts/src/openapi.ts`: import/register `LockReleaseBodySchema` in `apiContractSchemas` and add route contract near processing route (`:87-100`).
- `apps/backend/src/api/index.ts`: import `LockReleaseBodySchema` and add `POST /api/processing/:docId/release-lock` near other processing routes.

## Read-only mode behavior

File: `apps/backend/src/server.ts`

Key lines:
- Read-only mode is enabled by `PAPERLESS_LLM_PROD_READ_ONLY` or `PAPERLESS_LLM_READ_ONLY` (`:139-141`).
- Only `GET`, `HEAD`, `OPTIONS` are generally allowed (`:143`), with a narrow POST allowlist only for settings connection tests (`:144`, `:158-160`).
- Read-only blocks mutating requests before route handling (`:560-573`).
- Existing server test asserts POST processing paths are blocked in read-only (`apps/backend/tests/server.test.ts:80-90`).

Required behavior for release endpoint: it is mutating and must remain blocked in read-only mode. Do **not** add it to `READ_ONLY_SAFE_POST_PATHS`. Add/adjust a server helper test to assert `POST /api/processing/123/release-lock` is false if desired.

## Frontend/UI context

### API client
File: `apps/web/lib/api.ts`

Relevant patterns:
- Shared contract types imported/exported from `@repo/api-contracts` at top (`:5-55`).
- Processing API methods are grouped in `processingApi` (`:307-340`). Add e.g.:

```ts
releaseLock: (docId: number, body?: { runId?: string; force?: boolean }) =>
  fetchApi<LockReleaseResponse>(`/api/processing/${docId}/release-lock`, {
    method: "POST",
    body: JSON.stringify(body ?? { force: true }),
  })
```

### Settings page tabs
File: `apps/web/app/settings/page.tsx`

Relevant lines:
- Tabs include `processing` and `maintenance` (`:34-45`).
- `ProcessingTab` renders in processing tab (`:176-178`).
- `MaintenanceTab` renders in maintenance tab (`:166-169`, content later).

Best placement: `ProcessingTab` is the most direct place because it already displays auto-processing state/current doc. A small “Admin lock recovery” card can sit beside the existing Auto-Processing card.

### Processing tab
File: `apps/web/app/settings/components/ProcessingTab.tsx`

Relevant lines:
- Imports `Button`, `Card`, `Input` not currently imported; currently uses `Button`, `Card`, etc. but no `Input`, no `Alert` (`:3-18`).
- It fetches auto status every 10s and stores `autoStatus` (`:35-51`).
- Existing “Check Now” action uses local loading state and `processingApi.triggerAuto()` (`:53-62`, `:181-194`).
- It displays currently processing doc id when present (`:161-165`).

Suggested UI action:
- Add a second card labelled “Admin lock recovery”/“Release document lock”.
- Minimal UI: numeric document ID input, optional run id input (can be hidden/advanced), Release button, success/error message.
- Pre-fill doc id from `autoStatus.currently_processing_doc_id` when available, or offer a button/action to use it.
- Disable button when no valid positive doc id or while releasing.
- Use `processingApi.releaseLock(docId, { force: true })`; after success call `fetchAutoStatus()`.
- Warning text: “Only use when processing is stuck; releasing a live lock can allow duplicate processing.”
- Add translations in both `apps/web/messages/en.json` and `apps/web/messages/de.json`. Existing `settings.autoProcessing` keys are at `en.json:363-389` and `de.json:363-...`; add sibling keys like `lockRecovery.title`, or keys under `settings.autoProcessing` if placing in same tab.

Alternative placement: `MaintenanceTab` already contains admin/destructive operations and uses `ConfirmActionDialog` (`apps/web/app/settings/components/MaintenanceTab.tsx`). It is much larger, but has established destructive action patterns. If using MaintenanceTab, add state and handler near processing-log state, and use confirmation dialog before release.

## Existing tests and recommended additions

Backend tests:
- `apps/backend/tests/services/LockService.test.ts` already verifies guarded release behavior: wrong run id returns false, correct run id releases, then reacquire succeeds (`:34-68`). Add a specific force-release test if endpoint relies on omitted runId.
- `apps/backend/tests/api/router.test.ts` validates route/body schema failures for processing start (`:185-199`). Add tests for invalid `docId` on release route and/or invalid body once schema exists.
- Add a new `apps/backend/tests/api/processing.test.ts` or extend existing router tests with mocked layers to test handler behavior:
  - no active lock => `{ released:false, previous_lock:null }`
  - active lock + no runId => calls `LockService.release("document", docId, undefined)` and logs `lock_released`
  - active lock + mismatched runId => not released/success false (or defined chosen response)
  - case activeRunId cleared only when appropriate.
- `apps/backend/tests/server.test.ts` read-only helper currently asserts processing POSTs are blocked (`:80-90`). Add `expect(isReadOnlyRequestAllowed("POST", "/api/processing/123/release-lock")).toBe(false)`.

Frontend tests:
- Existing `apps/web/tests/settings-page.test.tsx` mocks settings components, so it will not cover `ProcessingTab` internals.
- Add a focused test for `ProcessingTab` (e.g. `apps/web/tests/processing-tab.test.tsx`) mocking `@/lib/api` and `@/lib/tinybase`:
  - renders recovery card
  - entering doc id and clicking release calls `processingApi.releaseLock`
  - success/error message appears
  - button disables for invalid doc id/loading.

Validation commands:
- Backend targeted: `pnpm --filter @repo/backend test -- LockService processing router server` (confirm package names in `package.json`; if unsure, run `pnpm run test` from repo root or `cd apps/backend && pnpm run test`).
- Frontend targeted: `pnpm --filter @repo/web test -- processing-tab settings-page` or `cd apps/web && pnpm run test`.
- Required final checks: `pnpm run typecheck`, `pnpm run lint`, plus relevant tests.

## Implementation risks / decisions to settle

1. **Force release vs guarded release**: LockService supports both. For an admin “release stuck lock” action, force release is useful, but risky. Recommended: endpoint accepts optional `runId`; UI default uses force with a confirmation warning. If the current lock is shown to the user first in future, pass runId for safer release.
2. **Case state after release**: If the released lock matches `case.activeRunId`, clear it. Setting `automationStatus:"queued"` is consistent with stale recovery for running/stuck cases, but do not overwrite `needs_input`, `done`, or `failed` unless the product explicitly wants that.
3. **Paperless tags**: Existing stale recovery retags active workflow documents to queued only when no active lock exists. The release endpoint does not have to retag directly; doing so would duplicate case recovery logic and require Paperless calls. Simpler endpoint: release lock + clear case activeRunId + log. Cases API can reconcile tags on next load. If immediate retagging is required, reuse/extract the existing recovery helper rather than copying logic.
4. **Read-only**: Endpoint must be blocked by existing server read-only guard. No read-only allowlist change.

## Compact worker prompt

Implement Todo #15 / W3-S14: add an admin document-lock release endpoint and settings UI action. Use existing `LockService.release("document", docId, runId?)`; do not create a new lock store. Add contract schema/type/route for `POST /api/processing/:docId/release-lock` with optional `{ runId?: string, force?: boolean }`, return `{ success, doc_id, released, previous_lock, message }`. Handler should get previous lock, release it (force when no runId), log `lock_released` with manual metadata, and clear matching document case `activeRunId` without overwriting terminal/needs-input states. Keep endpoint blocked in read-only mode by not adding it to server allowlists; add a read-only helper assertion. Add `processingApi.releaseLock` and a Processing settings/admin card with doc id input, warning/confirmation, loading state, and success/error feedback, refreshing auto status afterward. Add/update en/de translations and targeted backend/frontend tests. Validate with typecheck, lint, and relevant backend/web tests.
