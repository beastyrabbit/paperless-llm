# Todo #17 / W3-S14 — updated implementation-ready handoff: OCR usage tracking + budget caps

Request: update/build a handoff using latest code after concurrency caps. I inspected current backend config/layers/services/agents/jobs/tests. No production code was edited.

## Executive recommendation

Implement a shared `OcrBudgetService` (or `OcrUsageBudgetService`) with TinyBase-backed ledger/reservations and use it at every OCR-producing Mistral path:

1. `OCRAgent.runMistralOCR` direct `/v1/ocr` call.
2. `BulkOcrJob` before `mistral.processDocument(...)`.
3. `BulkIngestJob` before `mistral.processDocument(...)`.

Best long-term shape: add a first-class `MistralService.ocrDocument(pdfBytes | pdfBase64, metadata)` that wraps `/v1/ocr`, concurrency, budget reservation/reconciliation, and usage recording; migrate legacy bulk OCR paths away from chat/vision `processDocument`. Minimum safe implementation can guard existing call sites, but must not protect only `MistralService` or only `OCRAgent` because each currently has a bypass.

## Latest code facts after concurrency caps

### Shared concurrency is already in place

- `apps/backend/src/services/ConcurrencyLimitService.ts:7-10` exposes `withOllama`, `withMistral`, `withOcr`.
- `apps/backend/src/services/ConcurrencyLimitService.ts:16-34` builds Effect semaphores from `config.concurrency`, clamping invalid caps to `1`.
- `apps/backend/src/config/schema.ts:80-85` defines `ConcurrencyConfigSchema` with `ollamaMaxConcurrent`, `mistralMaxConcurrent`, `ocrMaxConcurrent`.
- `apps/backend/src/config/index.ts:84-88` default caps are all `1`.
- `apps/backend/src/config/yaml-loader.ts:91-100` normalizes YAML `concurrency.ollama_max_concurrent`, `mistral_max_concurrent`, `ocr_max_concurrent`.
- `apps/backend/src/config/yaml-loader.ts:296-300` supports env vars `PAPERLESS_LLM_OLLAMA_MAX_CONCURRENT`, `PAPERLESS_LLM_MISTRAL_MAX_CONCURRENT`, `PAPERLESS_LLM_OCR_MAX_CONCURRENT`.
- `apps/backend/src/layers/index.ts:48-52` creates/provides `ConcurrencyLayer`; `AppLayer` also provides it to the core graph.

Budget enforcement should compose with this service, not replace it. A budget block should occur before acquiring network permits if no PDF/download is needed for reservation; if page estimation requires bytes, block before the Mistral network call.

### OCRAgent direct Mistral OCR path

- `apps/backend/src/agents/OCRAgent.ts:89-93` injects `ConfigService`, `PaperlessService`, `TinyBaseService`, and `ConcurrencyLimitService`.
- `apps/backend/src/agents/OCRAgent.ts:95-141` dynamically resolves Mistral OCR settings from TinyBase/config. It accepts `mistral.ocr_model` / `mistral.ocrModel` / `mistral.model` and coerces non-OCR models to `mistral-ocr-latest`.
- `apps/backend/src/agents/OCRAgent.ts:146-225` posts directly to `${apiBaseUrl}/v1/ocr`, extracts text from `result.pages[].markdown`, and counts pages as `pages.length`.
- `apps/backend/src/agents/OCRAgent.ts:208-219` retries retryable failures; each attempt is wrapped in `concurrency.withOcr(concurrency.withMistral(requestOnce))`.
- `apps/backend/src/agents/OCRAgent.ts:497-522` skips live OCR for existing Paperless content or text documents.
- `apps/backend/src/agents/OCRAgent.ts:524-600` downloads PDF, computes `sourcePdfSha256`, and reuses cached TinyBase OCR when the hash matches.
- `apps/backend/src/agents/OCRAgent.ts:602-710` runs live Mistral OCR, persists successful OCR, transitions tags, and writes processing logs.

Budget implications:
- Do not count `existing_content`, `text_document`, mock mode, or `cached_ocr_result` as billable usage.
- Place reservation/check after cache miss is known and before `runMistralOCR` network request. Because current `/v1/ocr` actual pages are only known after success, reserve an estimate then reconcile to actual `pages` at `OCRAgent.ts:192-197`/success path.
- Retry loop must not double-count failed attempts. Reserve once per logical OCR operation with a request id; update completed once on success; mark failed/released after final failure.
- Current searchable PDF generation is also under `withOcr` (`OCRAgent.ts:227+`), but it is local `ocrmypdf`, not Mistral spend. Do not charge it to Mistral OCR budget.

### MistralService generic PDF/chat path

- `apps/backend/src/services/MistralService.ts:97-100` injects Config, TinyBase, and ConcurrencyLimitService.
- `apps/backend/src/services/MistralService.ts:150-220` central request helper wraps every attempt with `concurrency.withMistral(requestOnce)`.
- `apps/backend/src/services/MistralService.ts:269-291` `processDocument` sends a PDF data URL to `/v1/chat/completions`, not `/v1/ocr`.

Budget implications:
- Budgeting only `/v1/ocr` leaves legacy bulk jobs able to spend through chat/vision PDF processing.
- Either migrate `processDocument` OCR callers to new `/v1/ocr` method, or treat `processDocument` calls with PDF data as OCR-producing and reserve estimated pages/tokens at callers.

### Bulk OCR job path

- `apps/backend/src/jobs/BulkOcrJob.ts:87-89` still accepts raw `docsPerSecond` and computes `Math.floor(1000 / docsPerSecond)` without clamping.
- `apps/backend/src/jobs/BulkOcrJob.ts:107-108` loads up to 1000 docs with pending tag.
- `apps/backend/src/jobs/BulkOcrJob.ts:125-138` skips existing content and transitions to OCR-done.
- `apps/backend/src/jobs/BulkOcrJob.ts:141-148` downloads PDF, base64 encodes it, and calls `mistral.processDocument(...)`.
- `apps/backend/src/jobs/BulkOcrJob.ts:150-165` writes OCR text back to Paperless content and transitions tags.
- `apps/backend/src/jobs/BulkOcrJob.ts:171-180` counts errors and later adds failed tag.

Budget implications:
- Add guard before `mistral.processDocument`; if blocked, do not call Mistral, do not transition to OCR-done, and record a processing log/usage ledger event.
- Product choice: count budget block as `skipped` or add `blocked` to `BulkOcrProgress`. Backward-compatible option: increment `skipped` and log `skipReason: "ocr_budget_exceeded"`; clearer option: add `blocked` field and update API/UI tests.
- If touching this area, clamp `docsPerSecond` like BulkIngest does, but that is adjacent rather than core budget scope.

### Bulk ingest path

- `apps/backend/src/jobs/BulkIngestJob.ts:113-124` already clamps docs/sec to 0.1..10.
- `apps/backend/src/jobs/BulkIngestJob.ts:175-180` can ingest up to 10000 docs when no source tag is supplied.
- `apps/backend/src/jobs/BulkIngestJob.ts:214-224` reuses TinyBase/Paperless content without live OCR.
- `apps/backend/src/jobs/BulkIngestJob.ts:226-233` downloads PDF and calls `mistral.processDocument(...)` when OCR is needed.
- `apps/backend/src/jobs/BulkIngestJob.ts:233-241` catches OCR errors and falls back to existing `doc.content`.
- `apps/backend/src/jobs/BulkIngestJob.ts:246-252` stores OCR text in TinyBase with `pages` hard-coded to `1`.

Budget implications:
- Add guard before live OCR. If blocked, do not call Mistral; fall back to existing content if present and continue indexing, otherwise skip for insufficient content.
- Current hard-coded pages `1` is not enough for accurate actual usage. Migration to shared `/v1/ocr` method would return real page count. If keeping `processDocument`, record `estimatedPages`/reserved pages and clearly mark `operation: "chat_document"`.

## Data model to add

Add a dedicated TinyBase usage ledger table; processing logs alone are not a good cap source because they are JSON blobs and not optimized for aggregate decisions.

Current TinyBase relevant schema:
- `apps/backend/src/services/TinyBaseService.ts:120-230` has `settings`, `processingLogs`, `documentOcrContent`, `documentMemory`, but no usage ledger.
- `apps/backend/src/services/TinyBaseService.ts:348-365` exposes settings and processing log service methods.
- `apps/backend/src/services/TinyBaseService.ts:367-385` exposes document OCR content methods.
- TinyBase cells cannot store nulls; follow existing sentinel/string patterns.

Suggested table: `ocrUsageEvents`.

Columns:
- `id: string` unique row/event id. Use generated id or deterministic logical request id for idempotency.
- `requestId: string` logical OCR operation id to prevent retry double counting, e.g. `ocr_agent:${docId}:${sourcePdfSha256}` for OCRAgent; `bulk_ocr:${jobRunId}:${docId}` for bulk jobs.
- `docId: number` document id; use `0` or `-1` if a future non-document probe must be represented.
- `source: string` enum-like: `ocr_agent` | `bulk_ocr` | `bulk_ingest` | `mistral_service`.
- `provider: string` initially `mistral`.
- `operation: string` `ocr_endpoint` | `chat_document`.
- `model: string` resolved Mistral model used/reserved.
- `pagesReserved: number` pages reserved before request.
- `pagesActual: number` actual successful pages; `0` until completion if unknown.
- `bytes: number` source PDF byte length if available.
- `status: string` `reserved` | `completed` | `failed` | `released` | `blocked` | `skipped`.
- `budgetWindowDay: string` `YYYY-MM-DD` in UTC/local chosen consistently.
- `budgetWindowMonth: string` `YYYY-MM`.
- `costUnits: number` use page units initially; for `chat_document`, use estimated page-equivalent units.
- `costUsdMicros: number` optional estimate if pricing config exists; `0` if not configured.
- `reason: string` e.g. `budget_exceeded`, `existing_content`, `retry_failed`.
- `error: string` short error message.
- `createdAt: string`, `updatedAt: string`.

Add types/methods to `TinyBaseService`:
- `recordOcrUsageEvent(event)` or `createOcrUsageReservation(request)`.
- `updateOcrUsageEvent(id, updates)`.
- `getOcrUsageSummary(window)` returning totals by day/month: completed/reserved/blocked pages and costs.
- `getOcrUsageByRequestId(requestId)` for idempotency.

Budget calculation:
- For hard caps, count `completed + currently reserved` pages in the window to prevent concurrent races from exceeding caps.
- Do not count `blocked`, `skipped`, or `released` in used totals.
- Decide failure behavior via config: default release failed reservations unless provider documents failures as billed.

Schema migration note:
- `CURRENT_TINYBASE_SCHEMA_VERSION` is still `1`; adding a table may not require destructive migration, but update any schema verification tests and consider bumping if project treats schema changes that way.

## Config/model keys to add

Add a new `ocrBudget` section rather than overloading `http`, `mistral`, or `concurrency`.

Suggested config shape:

```ts
ocrBudget: {
  enabled: boolean;              // default false
  dailyPageLimit: number;         // default 0 = unlimited
  monthlyPageLimit: number;       // default 0 = unlimited
  perDocumentPageLimit: number;   // default 0 = unlimited
  reservePagesDefault: number;    // default 1 for unknown page count
  countFailedRequests: boolean;   // default false
  mode: "block" | "warn";        // default "block" when enabled
  warnAtPercent: number;          // default 0 or 80, optional
  pricePerThousandPagesUsd: number; // default 0, estimate only
}
```

Files to update:
- `apps/backend/src/config/schema.ts`: add `OcrBudgetConfigSchema`, type, optional `ocrBudget` on `AppConfigSchema`, and required `ocrBudget` on `ResolvedConfig`.
- `apps/backend/src/config/index.ts`: defaults and `applyDefaults` merge.
- `apps/backend/src/config/yaml-loader.ts`: normalize YAML `ocr_budget` to `ocrBudget` and snake_case keys such as `daily_page_limit`.
- Env vars: `PAPERLESS_LLM_OCR_BUDGET_ENABLED`, `PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT`, `PAPERLESS_LLM_OCR_MONTHLY_PAGE_LIMIT`, `PAPERLESS_LLM_OCR_PER_DOCUMENT_PAGE_LIMIT`, `PAPERLESS_LLM_OCR_RESERVE_PAGES_DEFAULT`, `PAPERLESS_LLM_OCR_COUNT_FAILED_REQUESTS`, `PAPERLESS_LLM_OCR_BUDGET_MODE`, `PAPERLESS_LLM_OCR_WARN_AT_PERCENT`, `PAPERLESS_LLM_OCR_PRICE_PER_THOUSAND_PAGES_USD`.
- `config.example.yaml`: add `ocr_budget:` near `http`/`concurrency`.

Settings API/UI exposure is a product choice. If exposed:
- `apps/backend/src/api/settings/api.ts` must add fields to `SettingsSchema` and `SettingsUpdateSchema`.
- `apps/backend/src/api/settings/handlers.ts` must read config/TinyBase values in `getSettings` and map frontend fields in `SETTINGS_KEY_MAP`.
If not exposed, keep budget config/env-only for this slice and document that decision.

## Service/layer integration

Create `apps/backend/src/services/OcrBudgetService.ts` and export/provide it.

Suggested service API:

```ts
interface OcrBudgetService {
  reserve(request: OcrBudgetRequest): Effect.Effect<OcrBudgetReservation, OcrBudgetError>;
  complete(reservation: OcrBudgetReservation, actual: { pages: number; model?: string }): Effect.Effect<void, never>;
  fail(reservation: OcrBudgetReservation, error: unknown): Effect.Effect<void, never>;
  recordSkipped(request: OcrBudgetRequest & { reason: string }): Effect.Effect<void, never>;
  summary(window?: { day?: string; month?: string }): Effect.Effect<OcrBudgetSummary, DatabaseError>;
}
```

`OcrBudgetError` should be typed/recognizable, e.g. `_tag: "OcrBudgetExceeded"`, with limit, used, requested, remaining, window. Callers can then map to skip/block behavior instead of treating as generic Mistral failure.

Layering:
- Export from `apps/backend/src/services/index.ts`.
- Provide from `apps/backend/src/layers/index.ts` after Config + TinyBase. Because the service needs TinyBase + Config, build it alongside core services or a new `BudgetLayer` and make it available to `OCRAgent`, `BulkOcrJob`, and `BulkIngestJob`.
- Tests that currently provide mocked services will need `Layer.succeed(OcrBudgetService, mock)` or the live layer with TinyBase mocks.

Concurrency/race risk:
- Budget checks must be atomic enough for concurrent OCR runs. In-process service can use a `Ref`/semaphore or serialize reserve/update methods. Since TinyBase writes are synchronous behind Effect, simplest is to serialize `reserve` operations with an Effect semaphore/mutex inside `OcrBudgetServiceLive` and include `reserved` totals in cap checks.

## Implementation approach by call site

### Preferred: shared OCR method

1. Add `MistralService.ocrDocument(pdfBytes, metadata)` returning `{ text, pages, model, requestId }`.
2. Inside it: resolve OCR model, call `OcrBudgetService.reserve`, wrap network call with `withOcr(withMistral(...))`, complete/fail reservation once per logical call.
3. Refactor `OCRAgent.runMistralOCR` to use this method or extract common helper.
4. Refactor `BulkOcrJob` and `BulkIngestJob` to use the same method, storing actual `pages` instead of hard-coded `1`.

This reduces future bypasses and gives one place for response shape/accounting.

### Minimum acceptable

- Inject `OcrBudgetService` into `OCRAgentServiceLive`, `BulkOcrJobServiceLive`, and `BulkIngestJobServiceLive`.
- `OCRAgent`: after cache miss and before direct `/v1/ocr`, reserve with `operation: "ocr_endpoint"`, `pagesReserved = reservePagesDefault` (or parsed PDF page count if implemented), complete with actual `pages` on success, fail/release on final failure.
- `BulkOcrJob`/`BulkIngestJob`: reserve before `mistral.processDocument` with `operation: "chat_document"` and estimated pages. Complete with reserved pages unless migrated to actual OCR endpoint.

## Tests to add/update

Existing test context:
- `apps/backend/tests/agents/OCRAgent.test.ts` currently has one cached-hash reuse test and already layers `ConcurrencyLimitServiceLive`.
- `apps/backend/tests/services/MistralService.test.ts` covers retry, timeout, and serialization under cap 1.
- `apps/backend/tests/services/ConcurrencyLimitService.test.ts` covers semaphore serialization/clamping.
- `apps/backend/tests/jobs/BulkOcrJob.test.ts` has progress, skip, process, tag, cancellation, and completion tests.
- There is no `apps/backend/tests/jobs/BulkIngestJob.test.ts` yet.
- `apps/backend/tests/config/config.test.ts` has examples for rate-limit and concurrency YAML/env parsing.

Add tests:

1. New `apps/backend/tests/services/OcrBudgetService.test.ts`
   - Disabled config allows reservation and records no/blocking minimal events as designed.
   - Daily cap blocks when completed+reserved pages would exceed limit.
   - Monthly cap blocks similarly.
   - Concurrent reservations are serialized; with limit 1 and two concurrent 1-page reservations, only one succeeds.
   - Completion reconciles reserved estimate to actual pages.
   - Failure releases reservation by default when `countFailedRequests=false`; counts/marks failed when true.
   - Idempotent request id does not double count retries.

2. `apps/backend/tests/config/config.test.ts`
   - YAML `ocr_budget:` snake_case loads into `config.ocrBudget`.
   - Env overrides work for booleans/numbers/mode.
   - Defaults are safe: disabled, page limits 0/unlimited, reserve default >=1.

3. `apps/backend/tests/agents/OCRAgent.test.ts`
   - Budget block prevents `/v1/ocr` fetch and returns/logs explicit budget exceeded result.
   - Successful OCR records completed usage with actual `pages` from mocked `/v1/ocr` response.
   - Transient retry does not double-count: two fetch attempts but one completed usage event.
   - Existing content/text document/cache paths do not consume budget.
   - Concurrency caps still apply; do not deadlock by acquiring `withOcr` twice around local `ocrmypdf` and Mistral if using shared method.

4. `apps/backend/tests/jobs/BulkOcrJob.test.ts`
   - Cap reached: `mistral.processDocument` not called; no OCR-done transition; progress reflects chosen blocked/skipped behavior; usage ledger has blocked event.
   - Successful path records usage.
   - Existing-content skip does not consume budget.

5. New `apps/backend/tests/jobs/BulkIngestJob.test.ts`
   - `runOcr: true`, cap reached: no Mistral call; if existing content is present, indexing can continue; otherwise document is skipped for insufficient content.
   - Existing TinyBase OCR/Paperless content path does not consume budget.
   - Successful OCR stores actual pages if migrated to `/v1/ocr`; otherwise stores/records estimated pages and operation `chat_document`.

6. TinyBase persistence/aggregation tests
   - Add to existing TinyBase tests if present or create focused tests for `ocrUsageEvents` methods.
   - Verify JSON persistence round-trip includes usage rows and summaries aggregate correctly.

7. Settings tests, only if runtime exposure is implemented
   - Update `apps/backend/tests/api/settings.test.ts` for get/update fields and masked/no-secret behavior if any budget secret-like fields are added (none suggested).

## Validation commands

Run from repo root:

```bash
pnpm --filter @repo/backend test -- tests/services/OcrBudgetService.test.ts tests/config/config.test.ts tests/agents/OCRAgent.test.ts tests/jobs/BulkOcrJob.test.ts tests/jobs/BulkIngestJob.test.ts
pnpm --filter @repo/backend test -- tests/services/MistralService.test.ts tests/services/ConcurrencyLimitService.test.ts
pnpm run typecheck
pnpm run lint
```

If package filtering is unavailable in the current shell, use the existing project scripts:

```bash
pnpm run test -- --run apps/backend/tests/services/OcrBudgetService.test.ts apps/backend/tests/agents/OCRAgent.test.ts apps/backend/tests/jobs/BulkOcrJob.test.ts
pnpm run typecheck
pnpm run lint
```

Final safety if time allows: `pnpm run test`.

## Risks and decisions to settle

- **Mistral response/pricing:** local code only uses `/v1/ocr` `pages.length`; no current usage/cost fields are parsed. Verify current Mistral OCR pricing/response before relying on `costUsdMicros` or additional provider usage fields.
- **Legacy `processDocument` billing unit:** chat/vision PDF calls do not expose page count in current code. Recommended: migrate bulk OCR to `/v1/ocr`; otherwise count estimated page-equivalents and label operation distinctly.
- **Budget block UX:** decide whether bulk progress gets a new `blocked` counter or reuses `skipped`. Recommended for compatibility: skip + explicit ledger/log reason; for clarity: add `blocked` and update consumers.
- **Runtime settings exposure:** config/env-only is simpler and safer for a first budget cap. Expose settings only if product requires live adjustability.
- **Atomicity across processes:** this app appears single-process with TinyBase local storage. In-process serialized reservations protect local concurrency. Multi-process deployments would need durable locking/transaction semantics beyond current TinyBase patterns.

## Compact worker prompt

Implement OCR usage tracking and budget caps after the existing concurrency-cap work. Add a TinyBase-backed `OcrBudgetService` with an `ocrUsageEvents` ledger, reservation/completion/failure/block accounting, and daily/monthly/per-document page caps from a new `ocrBudget` config section (YAML/env/defaults, docs example). Wire the service through exports/layers. Enforce it on every OCR-producing Mistral path: `OCRAgent` direct `/v1/ocr`, `BulkOcrJob`, and `BulkIngestJob`; do not count existing-content/text-document/cache skips. Prefer adding a shared `MistralService.ocrDocument` using `/v1/ocr` and migrate legacy bulk jobs to it so actual page counts are recorded; if not, guard `processDocument` callers with estimated page units and label `operation: "chat_document"`. Budget blocks must prevent Mistral network calls, avoid OCR-done tag transitions, and record explicit blocked/skipped ledger/log entries. Add focused tests for config parsing, budget service aggregation/idempotency/concurrent reservation, OCRAgent success/block/retry/skip behavior, BulkOcr block behavior, and a new BulkIngest budget test. Validate targeted backend tests plus typecheck/lint.
