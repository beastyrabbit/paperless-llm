# Todo #17 / W3-S14 final handoff: OCR usage tracking and budget caps

No source files were edited for this handoff.

## Requirement / source of truth

- `docs/AUDIT.md:106` (`E12`): “No token/page/cost budget tracking for Mistral OCR” in `MistralService` / `BulkOcrJob`; fix is to track usage per run/day and enforce a hard cap.
- `docs/plans/audit-rework-tasks.md:272-287` (`W3-S14`): includes “Track OCR usage and enforce budget caps”; acceptance says “Bulk OCR cannot exceed configured daily/run budget.”
- Current W3-S14 code already has request rate limits/concurrency caps (`ConcurrencyLimitService`), stale lock release, retries/timeouts, and tag-cache work. **User-facing document-run cancel and metrics do not appear landed in this worktree**: there is no `/api/processing/:docId/cancel` route and no metrics/observability service files. If those land before implementation, integrate usage events/counters with them rather than duplicating endpoints.

## Current code state that matters

### OCR call paths

1. **Main pipeline OCR uses `OCRAgent` and Mistral `/v1/ocr`.**
   - `apps/backend/src/agents/OCRAgent.ts:128-201` defines `runMistralOCR(pdfBytes)`.
   - It fetches `POST ${apiBaseUrl}/v1/ocr` with `{ model, document: { type: "document_url", document_url: data:application/pdf;base64,... }, include_image_base64: false }` (`OCRAgent.ts:151-169`).
   - Response is currently parsed as only `{ pages: { markdown, index }[] }`; return value is `{ text, pages: pages.length }` (`OCRAgent.ts:178-183`). Any Mistral `usage_info` / model fields are currently ignored.
   - The call is wrapped with both OCR and Mistral semaphores: `concurrency.withOcr(concurrency.withMistral(requestOnce))` (`OCRAgent.ts:190`).
   - Successful OCR persists TinyBase OCR content and memory facts at `OCRAgent.ts:326-434`; final processing log records `textLength`, `pages`, hashes, version IDs at `OCRAgent.ts:676-690`.
   - Cache/skip branches at `OCRAgent.ts:447-638` avoid Mistral calls; these should not consume budget except possibly “skipped/reused” observability.

2. **Bulk OCR job still uses chat-completions PDF vision via `MistralService.processDocument`, not `OCRAgent`.**
   - `apps/backend/src/jobs/BulkOcrJob.ts:145-164`: downloads PDF, calls `mistral.processDocument(pdfBase64, ocrPrompt)`, writes content to Paperless, transitions tags.
   - Progress has `processed/skipped/errors` only (`BulkOcrJob.ts:15-26`) and no budget/usage fields.
   - Cancellation is job-local: `fiberRef` + `cancelledRef`, `cancel()` interrupts the daemon fiber (`BulkOcrJob.ts:248-260`). Budget reservation must be released/finalized safely on interruption/failure.

3. **Bulk ingest also performs OCR through `MistralService.processDocument`.**
   - `apps/backend/src/jobs/BulkIngestJob.ts:210-253`: if `runOcr`, it checks TinyBase/Paperless content, otherwise downloads PDF and calls `mistral.processDocument(...)`; increments `ocrProcessed` only when content is stored.
   - If scope is strictly “Bulk OCR”, budget enforcement still should cover this path because it spends Mistral OCR/vision budget when `run_ocr=true`.

4. **Generic Mistral chat/vision service discards token usage.**
   - `apps/backend/src/services/MistralService.ts:38-50` response type includes `usage.prompt_tokens`, `completion_tokens`, `total_tokens`.
   - `chat`, `processImage`, and `processDocument` map to `choices[0]?.message.content ?? ""` only (`MistralService.ts:228-241`, `261-263`, `288-290`).
   - To track token/cost usage for the existing bulk jobs, change/extend the service so callers can receive usage metadata. Keep existing `processDocument(...): Effect<string>` compatibility or update all callers/tests deliberately.

### Existing storage/logging/config patterns

- TinyBase schema has `settings`, `processingLogs`, `documentOcrContent`, and `documentMemory` tables but no usage table (`apps/backend/src/services/TinyBaseService.ts:186-208`).
- Processing logs are append-only JSON rows via `addProcessingLog`; used by OCR for results/errors and by pipeline for locks/runs.
- Settings are stored as string values in TinyBase; backend reads from `ConfigService.config` + `tinybase.getAllSettings()` fallbacks. Examples:
  - `MistralService.ts:88-126` dynamically resolves Mistral settings + HTTP retry/timeout.
  - `OCRAgent.ts:85-126` resolves `mistral.ocr_model` / `mistral.model` and timeout/retry settings.
  - `apps/backend/src/api/settings/handlers.ts:324-357` maps API setting keys to TinyBase keys and stringifies values.
- Config schema/defaults currently have no budget fields:
  - `apps/backend/src/config/schema.ts:22-27` Mistral config only has `apiKey`, `model`, `apiBaseUrl`.
  - `apps/backend/src/config/index.ts:26-30` Mistral defaults; `index.ts:86-90` concurrency defaults.
  - YAML/env loader has Mistral aliases at `apps/backend/src/config/yaml-loader.ts:54-62` and env vars at `yaml-loader.ts:282-285`.
- Frontend settings schema/mapping has Mistral API key/model only:
  - `apps/web/lib/tinybase/schemas.ts:30-34`.
  - API/store mapping at `schemas.ts:128-132`.
  - Backend settings API returns only `mistral_api_key(_configured)` and `mistral_model` (`apps/backend/src/api/settings/handlers.ts:152-154`), with update map at `handlers.ts:237-239`.

### API/contracts/OpenAPI patterns

- Contract request schemas live in `packages/api-contracts/src/request-schemas.ts`; e.g. `BulkOcrStartBodySchema` at `:109-112`, `ProcessingStartBodySchema` at `:132-136`, `LockReleaseBodySchema` at `:137-140`.
- OpenAPI route list is generated from static entries in `packages/api-contracts/src/openapi.ts`; bulk OCR endpoints at `:329-346` and processing lock release at `:475-479`.
- `apps/backend/src/api/index.ts` imports contract schemas and registers routes. Bulk OCR start route is `POST /api/jobs/bulk-ocr/start` at `:395-401`; status/cancel at `:403-405`.
- Settings API types are also defined in backend (`apps/backend/src/api/settings/api.ts`), not only shared contracts.

### Existing tests to extend

- `apps/backend/tests/agents/OCRAgent.test.ts`: currently covers cached OCR reuse; useful for tests that skipped/cached OCR does not spend budget and real OCR records usage.
- `apps/backend/tests/services/MistralService.test.ts`: best place to verify token usage extraction/compatibility for chat-completions-based `processDocument`.
- `apps/backend/tests/jobs/BulkOcrJob.test.ts`: mocks `MistralService.processDocument`; extend for start rejection/preflight halt when run/day budget is exhausted and for progress fields if added.
- `apps/backend/tests/jobs/BulkIngestJob.test.ts` does not exist; if implementing budget enforcement there, add focused tests or cover through a pure usage service.
- `apps/backend/tests/config/config.test.ts`: extend for YAML aliases/env/defaults for budget settings.
- `apps/backend/tests/api/settings.test.ts` and `apps/web/tests/settings-page.test.tsx`: extend only if adding UI/settings surface.

## Recommended implementation shape

### 1. Add a small OCR usage/budget service

Add `apps/backend/src/services/OcrUsageService.ts` (export from `services/index.ts`, layer into `layers/index.ts`). Responsibilities:

- Read budget config from resolved config + TinyBase settings.
- Track usage per day and per run/job in TinyBase.
- Provide **atomic-ish preflight/reservation** methods before expensive calls and commit/release methods after call success/failure/interruption.
- Return structured errors that can map to `JobError`/`AgentError` with a clear “budget exceeded” message.

Suggested API (names flexible):

```ts
interface OcrUsageBudget {
  dailyPageLimit: number | null;   // null/0 means disabled/unlimited
  runPageLimit: number | null;
  dailyTokenLimit: number | null;
  runTokenLimit: number | null;
  costLimitCentsDaily?: number | null;
}
interface OcrUsageReservation {
  id: string;
  scope: "run" | "document" | "job";
  runId: string;
  docId?: number;
  estimatedPages: number;
  estimatedTokens?: number;
}
```

Minimum acceptance-oriented scope: **page limits** for `/v1/ocr` and bulk jobs, plus token usage recording for chat-completion Mistral calls when available. Cost can be recorded as nullable/derived if rates are configured; do not hardcode vendor prices without an explicit config field.

TinyBase storage options:

- Prefer a dedicated `ocrUsage` / `ocrUsageReservations` table instead of stuffing everything in `processingLogs` or settings. Current TinyBase service already owns schema/table accessors; add typed methods instead of exposing raw store to new callers.
- If a dedicated table is too large for scope, use `processingLogs` for append-only `ocr_usage` events plus a service method that aggregates logs by day. This is simpler but less efficient and harder to reserve atomically. For “hard cap”, a table/service with reservation rows is better.

Important behavior:

- Enforce caps **before** making a Mistral request. If estimated pages/tokens would exceed daily or run cap, fail before download/OCR where possible.
- For unknown page counts, estimate conservatively. There is no `page_count` field in `DocumentSchema` (`apps/backend/src/models/index.ts:7-25`). Options:
  - Count PDF pages from `pdfBytes` with a small local helper (e.g. scan for `/Type /Page` excluding `/Pages`) after `downloadPdf` and before Mistral; document that this is approximate.
  - Or reserve `1` page pre-call and reconcile after response, but this can overshoot hard daily caps on multi-page PDFs. Avoid this as the only enforcement if acceptance is strict.
- On success, commit actual usage from response (`pages.length` for `/v1/ocr`; `usage.total_tokens` for chat-completions; page estimate if no page metadata). On failure/interruption, release reservation unless the API returned usage that should be counted.
- On retry: reserve once per actual attempt or reserve per document with max estimated pages, then commit only successful/spent attempt. Be explicit: Mistral may bill failed attempts differently; safest is to commit usage only when response includes usage/page data and record failed attempts separately.

### 2. Extend OCR/Mistral return metadata without breaking call sites unnecessarily

- In `OCRAgent.ts`, expand `MistralOCRResponse` to include optional usage metadata. Mistral OCR API is commonly documented with `usage_info` (for example pages/doc size); verify exact shape when implementing. Current local code only proves `pages` exists.
- Make `runMistralOCR` return `{ text, pages, usage? }` and call `OcrUsageService.reserve/commit/release` around the request.
- In `MistralService.ts`, add a metadata-returning method such as `processDocumentWithUsage(...) => Effect<{ text: string; usage?: MistralChatResponse["usage"]; model: string }, MistralError>`, then implement `processDocument` as `.pipe(Effect.map(r => r.text))` for compatibility. Bulk jobs can opt into the usage method.

### 3. Wire budgets into bulk jobs and API status

- `BulkOcrJob.start(options)` should get/generate a run/job id and pass it to usage reservations. Current progress has no run id; adding one helps per-run caps and audit logs.
- `BulkOcrProgress` should include budget/usage fields if exposed to UI/API, e.g. `usage: { pagesReserved, pagesUsed, tokensUsed, dailyPagesUsed, dailyPageLimit, runPageLimit }` or snake_case equivalent in API contracts.
- `BulkIngestJob` should either share the same usage service for OCR calls when `runOcr=true` or explicitly be documented as out of scope. Since it can spend the same OCR budget (`BulkIngestJob.ts:227-232`), recommended implementation is to enforce there too.
- When cap is hit mid-bulk-job, stop the job cleanly (status `completed` with budget stop reason or `error` with clear `BudgetExceeded`); do not keep iterating and logging per-document errors. Acceptance says cannot exceed configured budget, not necessarily “all docs must fail”.

### 4. Config/settings surface

Suggested config keys (settle exact names before editing):

```yaml
ocr_budget:
  daily_page_limit: 0     # 0/null = unlimited
  run_page_limit: 0
  daily_token_limit: 0
  run_token_limit: 0
  cost_limit_cents_daily: 0
```

or under `mistral.ocrBudget` if you prefer service-local config. Whichever is chosen, update all layers consistently:

- `apps/backend/src/config/schema.ts` + `ResolvedConfig`.
- `apps/backend/src/config/index.ts` defaults and merge.
- `apps/backend/src/config/yaml-loader.ts` aliases and env vars, e.g. `PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT`, `PAPERLESS_LLM_OCR_RUN_PAGE_LIMIT`, token/cost equivalents.
- `config.example.yaml` / `config.prod.readonly.example.yaml` and `.env.example` if env vars are added.
- Backend settings API (`apps/backend/src/api/settings/api.ts`, `handlers.ts`) and frontend TinyBase settings mappings if the UI should show/edit caps.

Keep defaults unlimited or high enough to avoid breaking existing installs. The “hard cap” should only activate when configured.

### 5. Observability / metrics integration if it lands

No metrics service is present in this worktree. If a W3-S16 metrics worker lands before implementation:

- Increment counters/gauges through the shared metrics service rather than adding parallel ad hoc metrics.
- Suggested metric dimensions: `source` (`ocr_agent`, `bulk_ocr`, `bulk_ingest`), `model`, `status` (`reserved`, `committed`, `released`, `rejected_budget`), `reason`, maybe `run_id` only in logs not Prometheus labels.
- Continue to persist usage in TinyBase even with metrics; metrics are not a source of truth for enforcing daily caps.

## Risks / decisions to make before coding

- **Page estimate accuracy:** strict hard caps need a pre-call estimate. There is no Paperless page count in the local `Document` model. Implement a tested local PDF page estimator or use a PDF library if already available (none found in this handoff). If using regex scanning, call it conservative and test common `/Type /Page` vs `/Type /Pages` cases.
- **Mistral OCR response shape:** local code only models `pages`; verify `usage_info` exact field names during implementation. Do not assume token usage from `/v1/ocr` unless the API returns it.
- **Billing semantics on failed/retried calls:** Mistral may bill failed requests differently. The safe local behavior is reservation before attempt, commit only response-reported usage, release otherwise, and log failed attempts.
- **Cost budgets:** pricing changes externally. Only enforce cost if rates/price-per-page/token are explicitly configurable; otherwise track pages/tokens and leave cost null/estimated.
- **Concurrent hard caps:** multiple OCR jobs can run through semaphores. Current defaults are `mistralMaxConcurrent=1` and `ocrMaxConcurrent=1`, but configs allow more. The usage service must reserve/update in one critical section (Effect `Ref`/semaphore around TinyBase table updates or TinyBase synchronous store writes inside one effect) to prevent races.
- **Cancellation/interruption:** bulk job cancellation already interrupts the job fiber. Wrap reservations with `Effect.acquireRelease` or `Effect.ensuring` so reserved budget is released if a job/document is cancelled mid-call.

## Files likely to edit

Backend core:
- `apps/backend/src/services/OcrUsageService.ts` (new)
- `apps/backend/src/services/index.ts`
- `apps/backend/src/layers/index.ts`
- `apps/backend/src/services/TinyBaseService.ts` (schema + typed accessors for usage/reservations)
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/services/MistralService.ts`
- `apps/backend/src/jobs/BulkOcrJob.ts`
- `apps/backend/src/jobs/BulkIngestJob.ts` (recommended, because it can OCR)

Config/settings/contracts:
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `apps/backend/src/config/yaml-loader.ts`
- `apps/backend/src/api/settings/api.ts`
- `apps/backend/src/api/settings/handlers.ts`
- `packages/api-contracts/src/types.ts` (if exposing progress usage)
- `packages/api-contracts/src/request-schemas.ts` / `openapi.ts` only if adding request fields or new endpoints
- `config.example.yaml`, `config.prod.readonly.example.yaml`, `.env.example` if new config/env vars

Frontend only if exposing settings/status:
- `apps/web/lib/tinybase/schemas.ts`
- `apps/web/lib/tinybase/hooks/useSettings.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/settings/page.tsx` or relevant settings components

## Tests to add/update

Targeted backend tests:
1. `apps/backend/tests/services/OcrUsageService.test.ts` (new):
   - default unlimited budget permits reservations.
   - daily page cap rejects a reservation that would exceed remaining pages.
   - run page cap rejects within a run while another run/day may still have capacity.
   - release on failure/cancel returns reserved pages to available budget.
   - concurrent reservations cannot overshoot cap.
   - day bucketing uses current date deterministically (inject clock if needed or isolate helper).
2. `apps/backend/tests/agents/OCRAgent.test.ts`:
   - real Mistral `/v1/ocr` path reserves before fetch and commits actual page usage.
   - cached/existing/text-document skip branches do not consume budget.
   - budget exceeded returns `success:false` or fails with clear `AgentError` before Mistral fetch.
3. `apps/backend/tests/services/MistralService.test.ts`:
   - new metadata method returns text + `usage` from chat-completions.
   - existing `processDocument` still returns a string for compatibility.
4. `apps/backend/tests/jobs/BulkOcrJob.test.ts`:
   - job stops/rejects when run cap would be exceeded before calling Mistral.
   - progress/API includes budget usage if added.
   - cancellation releases outstanding reservation.
5. Add `BulkIngestJob` tests if enforcing there.
6. `apps/backend/tests/config/config.test.ts`: defaults, YAML aliases, env vars for budget config.
7. API/settings tests if adding settings fields.

Frontend tests if UI fields are added:
- `apps/web/tests/settings-page.test.tsx`: caps render and save as numbers.
- `apps/web/tests/tinybase-provider.test.tsx`: sync/update mapping for new budget settings if using TinyBase settings.

## Validation commands

Run focused checks first:

```bash
pnpm --filter backend test -- apps/backend/tests/services/OcrUsageService.test.ts apps/backend/tests/agents/OCRAgent.test.ts apps/backend/tests/services/MistralService.test.ts apps/backend/tests/jobs/BulkOcrJob.test.ts apps/backend/tests/config/config.test.ts
pnpm --filter backend typecheck
```

Then broader checks before finish:

```bash
pnpm --filter backend test
pnpm --filter backend build
pnpm --filter web typecheck
pnpm --filter web test   # if frontend tests changed
pnpm run lint
```

If full web tests/build are too slow or unavailable, at least run backend tests/typecheck plus the targeted frontend test file(s) changed.

## Final worker prompt

Implement Todo #17 / W3-S14 OCR usage tracking and budget caps. Add a typed backend usage/budget service that persists OCR usage per day and per run/job, reserves budget before expensive Mistral OCR/PDF calls, commits actual pages/tokens when responses provide them, and releases reservations on failure/interruption. Enforce configured hard caps for Bulk OCR so it cannot exceed daily/run budget; also enforce the same service for `OCRAgent` and preferably `BulkIngestJob` because they spend the same Mistral OCR budget. Keep defaults unlimited/backward-compatible. Extend config/YAML/env/settings contracts as needed for page/token/cost caps, but do not hardcode vendor pricing. Preserve existing `MistralService.processDocument` compatibility while adding a metadata-returning path for token usage. Add focused tests for usage reservations, cap rejection, cancellation release, OCR skip behavior, chat usage extraction, bulk OCR budget stop, and config parsing. If metrics/run-cancel code has landed before you edit, integrate usage events with the shared metrics/cancel primitives instead of duplicating them. Validate with targeted backend tests, backend typecheck/build, and frontend/settings tests if UI or contracts are changed.
