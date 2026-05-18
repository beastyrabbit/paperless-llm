# Todo #17 / W3-S14 — OCR usage tracking and budget caps handoff

## Request scope
Build an implementation-ready handoff for OCR usage tracking and budget caps. Inspected config, `OCRAgent`, `MistralService`, `BulkOcrJob`, `BulkIngestJob`, and TinyBase. No production code edits made.

## Current OCR call sites and bypass risks

### 1) Main pipeline OCR path: `OCRAgent`
- `apps/backend/src/agents/OCRAgent.ts:92-135` dynamically reads Mistral OCR config from TinyBase/settings and config fallback. It already supports `mistral.ocr_model` / `mistral.ocrModel` / `mistral.model` and coerces non-OCR models to `mistral-ocr-latest`.
- `apps/backend/src/agents/OCRAgent.ts:140-190` posts directly to `${apiBaseUrl}/v1/ocr` with a base64 data URL and returns `{ text, pages }` from `result.pages.length`.
- `apps/backend/src/agents/OCRAgent.ts:202-218` retries retryable Mistral OCR failures. Budget reservation/usage accounting must avoid double-counting failed retry attempts unless the API returned successful billable usage.
- `apps/backend/src/agents/OCRAgent.ts:280-323` skips reusable Paperless/text content and logs a skipped OCR result.
- `apps/backend/src/agents/OCRAgent.ts:326-455` persists successful OCR into TinyBase `documentOcrContent`, document memory `extractedFacts.ocr`, run summaries, and Paperless document versions.
- `apps/backend/src/agents/OCRAgent.ts:490-518` skips OCR for existing content (`>=50 chars`) and text documents before downloading PDF.
- `apps/backend/src/agents/OCRAgent.ts:518-595` downloads PDF, computes `sourcePdfSha256`, and reuses cached OCR when TinyBase memory hash matches.
- `apps/backend/src/agents/OCRAgent.ts:596-700` performs live Mistral OCR, handles empty responses, persists version/content, logs result, and transitions tags.

**Risk:** this path bypasses `MistralService`; usage/budget enforcement in `MistralService` alone will not protect the pipeline OCR agent.

### 2) Legacy bulk OCR job path: `BulkOcrJob`
- `apps/backend/src/jobs/BulkOcrJob.ts:49-56` depends on `MistralService`, not `OCRAgent`.
- `apps/backend/src/jobs/BulkOcrJob.ts:87-89` accepts raw `docsPerSecond` and computes `delayMs = Math.floor(1000 / docsPerSecond)` without clamping; unrelated but can combine poorly with budget caps if extreme values are passed.
- `apps/backend/src/jobs/BulkOcrJob.ts:107-108` loads up to 1000 docs by `tagConfig.pending`.
- `apps/backend/src/jobs/BulkOcrJob.ts:125-138` skips documents with Paperless content >100 chars and transitions tag.
- `apps/backend/src/jobs/BulkOcrJob.ts:141-152` downloads PDF, calls `mistral.processDocument(pdfBase64, prompt)`, then writes OCR text to Paperless content.
- `apps/backend/src/jobs/BulkOcrJob.ts:171-185` catches per-document errors and adds failed tag.

**Risk:** this does OCR through chat/completions `processDocument`, not `/v1/ocr`, so OCR-specific page accounting cannot be inferred unless this path is migrated to a shared OCR service/wrapper or explicitly counted as an OCR attempt with estimated pages. It also overwrites Paperless content unlike `OCRAgent`.

### 3) Bulk ingest job OCR path: `BulkIngestJob`
- `apps/backend/src/jobs/BulkIngestJob.ts:72-78` depends on `MistralService`, TinyBase, Qdrant, Paperless.
- `apps/backend/src/jobs/BulkIngestJob.ts:113-124` clamps docs/sec to 0.1..10.
- `apps/backend/src/jobs/BulkIngestJob.ts:175-180` can process all documents up to 10000 if no source tag is provided.
- `apps/backend/src/jobs/BulkIngestJob.ts:210-253` OCR phase: reuses TinyBase OCR if present, else Paperless content if >100 chars, else downloads PDF and calls `mistral.processDocument(pdfBase64, prompt)`, then stores OCR text in TinyBase as source `mistral` with pages hard-coded to `1`.
- `apps/backend/src/jobs/BulkIngestJob.ts:255-258` if `runOcr` is false, still reads existing TinyBase/Paperless content.

**Risk:** another `MistralService.processDocument` bypass; can scan 10k docs and charge via chat/vision without any OCR page/accounting unless guarded centrally. Pages are currently hard-coded to 1 when stored.

### 4) MistralService generic vision/chat path
- `apps/backend/src/services/MistralService.ts:100-143` dynamically reads TinyBase settings (`mistral.api_key`, `mistral.model`, api base url aliases) and HTTP retry settings.
- `apps/backend/src/services/MistralService.ts:148-218` central request helper with retry, timeout, and transient status handling.
- `apps/backend/src/services/MistralService.ts:267-275` `processDocument` uses `/v1/chat/completions` with `image_url: data:application/pdf;base64,...`, not the OCR endpoint.

**Risk:** if budget enforcement only wraps `OCRAgent.runMistralOCR`, legacy bulk jobs can still spend through `processDocument`; if enforcement only wraps `MistralService.request`, `OCRAgent` can still spend through its direct fetch.

## Config and settings context
- `apps/backend/src/config/schema.ts:21-26` Mistral config only has `apiKey`, `model`, `apiBaseUrl`.
- `apps/backend/src/config/schema.ts:79-85` HTTP safety config has timeouts/retries only; no budget fields.
- `apps/backend/src/config/schema.ts:125-129` resolved Mistral config mirrors only those three fields.
- `apps/backend/src/config/index.ts:26-29` default Mistral model is `pixtral-12b-latest`; `OCRAgent` overrides to OCR model when needed.
- `apps/backend/src/config/index.ts:74-78` default Mistral retry values are 3 attempts / 5000 ms base delay.
- `apps/backend/src/config/yaml-loader.ts:55-63` YAML normalizes Mistral snake_case to camelCase.
- `apps/backend/src/config/yaml-loader.ts:91-102` YAML normalizes HTTP snake_case retry/timeouts.
- `apps/backend/src/config/yaml-loader.ts:246-250` env supports `MISTRAL_API_KEY`, `MISTRAL_MODEL`, `MISTRAL_API_BASE_URL`.
- `apps/backend/src/config/yaml-loader.ts:268-274` env supports HTTP timeout/retry settings only.
- `config.example.yaml` Mistral section currently documents only `api_key`, `model`, `api_base_url`; HTTP section documents timeout/retry only.
- `apps/backend/src/api/settings/handlers.ts:97-101` settings API exposes Mistral API key/model.
- `apps/backend/src/api/settings/handlers.ts:238-239` maps only `mistral_api_key` and `mistral_model`; no OCR/budget settings mapping yet.

**Implementation implication:** budget caps need new config schema/defaults, YAML/env normalization, optional settings API fields (if UI/runtime configurable), and docs/example config updates. Existing patterns store runtime settings as strings in TinyBase and parse with helper functions.

## TinyBase data model context
Current schema in `apps/backend/src/services/TinyBaseService.ts`:
- `settings` table: `key`, `value`, `updatedAt` (`:186-190`); `setSetting/getAllSettings` at `:1723-1756`.
- `processingLogs` table: `docId`, `timestamp`, `step`, `eventType`, JSON `data` (`:191-198`); `addProcessingLog` stringifies data at `:1805-1819`.
- `documentOcrContent` table: `docId`, `content`, `pages`, `source`, timestamps (`:200-207`); methods declared at `:367-385`, implemented at `:1918-2025`.
- `documentMemory` table: `ocrVersionIds`, `extractedFacts`, run summaries, etc. (`:208-217`). `DocumentMemory` interface has `ocrVersionIds: number[]`, `extractedFacts: Record<string, unknown>`, and `runSummaries` (`:465-478`). `patchDocumentMemory` merges whole `extractedFacts` object with the provided one, not a deep merge (`:2053-2074`).

**Recommended new TinyBase model:** add a dedicated append-only-ish OCR usage table, not just processing logs, because caps need fast aggregate queries and durable decisions.

Suggested table: `ocrUsageEvents` (or `ocrUsageLedger`):
- `id: string` unique event id
- `docId: number` (0 or -1 for non-document probes if needed; prefer nullable sentinel consistent with TinyBase limitations)
- `source: string` enum-like: `ocr_agent` | `bulk_ocr` | `bulk_ingest` | `mistral_service`
- `provider: string` = `mistral`
- `operation: string` = `ocr_endpoint` | `chat_document`
- `model: string`
- `pages: number` actual pages processed if known; estimated/reserved pages before call if implementing reservations
- `bytes: number` PDF byte size if known
- `status: string` = `reserved` | `completed` | `failed` | `blocked`
- `budgetWindow: string` e.g. `YYYY-MM-DD` for daily caps or `YYYY-MM` for monthly caps
- `costUnits: number` (page units; keep name generic if later adding token costs)
- `costUsdMicros: number` optional estimated cost if configured price exists
- `requestId: string` optional correlation/idempotency key to avoid retry double counting
- `error: string`
- `createdAt`, `updatedAt`

Suggested service methods on `TinyBaseService`:
- `recordOcrUsageEvent(event)` / `updateOcrUsageEvent(id, updates)`
- `getOcrUsageSummary(window)` returning used/reserved/blocked by day/month and optionally by doc/source
- `checkOcrBudget(request)` returning allowed/blocked plus remaining

TinyBase persistence is debounced and existing schema version is `CURRENT_TINYBASE_SCHEMA_VERSION = 1`; schema changes may need migration/verification updates in the same file.

## Budget cap design recommendation
1. Create one shared OCR budget/usage guard service used by **all** live OCR-producing code paths.
   - Minimum call sites to protect: `OCRAgent.runMistralOCR`, `BulkOcrJob` before `mistral.processDocument`, and `BulkIngestJob` before `mistral.processDocument`.
   - Better long-term: expose a single `MistralService.ocrDocument(pdfBytes/pdfBase64, metadata)` method returning `{ text, pages, usage }`, migrate legacy jobs to it, and keep `processDocument` as generic vision/chat. This avoids future bypasses.
2. Cap units should be pages rather than tokens for `/v1/ocr`; for legacy `processDocument` paths, either migrate them to `/v1/ocr` or count an estimate/reservation as 1 page minimum plus optional PDF page count if implemented.
3. Enforce before network calls. If exact page count is unknown pre-call, use a conservative reservation (configurable default, e.g. 1 or max pages estimate) or parse PDF page count locally. On success, reconcile with actual returned pages. On failure, release or mark failed reservation depending on whether response indicates billable usage.
4. Existing cache/skips should not consume budget:
   - `OCRAgent` existing content/text-doc skips (`:490-515`) and cached-hash reuse (`:520-595`) should record zero-cost/skipped logs at most.
   - Bulk jobs reusing existing TinyBase/Paperless content should not consume budget.
5. Budget block behavior should be explicit and non-destructive:
   - Return a typed error/result indicating `budget_exceeded`.
   - Do not transition to OCR done on blocked OCR.
   - Prefer processing log/run summary with `eventType: "error"` or `result` and `skipReason/error: "ocr_budget_exceeded"`.
   - For bulk jobs, increment `skipped` or a new `blocked` count (if adding field) and continue; avoid failed tag unless product decision says budget block is a failure.

## Config keys to add (suggested)
Add a new config section, e.g. `ocrBudget`, to avoid overloading `http` or `mistral`:
- `enabled: boolean` default `false`
- `dailyPageLimit?: number` default `0`/undefined meaning no limit
- `monthlyPageLimit?: number` default `0`/undefined
- `perDocumentPageLimit?: number` optional hard cap
- `warnAtPercent?: number` optional
- `countFailedRequests?: boolean` default `false` unless provider confirms failures are billed
- `pricePerThousandPagesUsd?: number` optional display/estimate only
- `mode: "block" | "warn"` optional; default `block` when enabled

Wire through:
- `apps/backend/src/config/schema.ts`: schema + `ResolvedConfig`
- `apps/backend/src/config/index.ts`: defaults + applyDefaults
- `apps/backend/src/config/yaml-loader.ts`: snake_case aliases and env variables like `PAPERLESS_LLM_OCR_BUDGET_ENABLED`, `PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT`, etc.
- `config.example.yaml`: document the budget section
- `apps/backend/src/api/settings/handlers.ts` and `apps/backend/src/api/settings/api.ts` if runtime settings/UI should expose caps.

## Tests to add/update
Targeted test files:
- `apps/backend/tests/agents/OCRAgent.test.ts`
  - Existing cached hash reuse test verifies no live Mistral fetch. Add tests that budget block prevents fetch and does not call `downloadPdf` if page count/reservation does not require it, or downloads then blocks before Mistral if page estimation needs bytes.
  - Test successful OCR records completed usage with actual `pages` from `/v1/ocr` response.
  - Test transient retry does not double count completed pages.
  - Test existing-content/text-doc/cache skips do not consume budget.
- `apps/backend/tests/services/MistralService.test.ts`
  - Existing retry/timeout tests at `tests/services/MistralService.test.ts:29-92`. Add tests only if budget guard is implemented inside/around MistralService or if new `ocrDocument` lives there.
- `apps/backend/tests/jobs/BulkOcrJob.test.ts`
  - Existing tests cover skip/process/counts. Add budget-block test for `mistral.processDocument` path; assert no Mistral call when cap reached and progress reflects skipped/blocked/error as chosen.
  - Add docsPerSecond clamp test if touching the area (currently unclamped at `BulkOcrJob.ts:87-89`).
- New `apps/backend/tests/jobs/BulkIngestJob.test.ts` (none currently exists)
  - Add minimal tests for `runOcr: true` with cap reached: no Mistral call; existing content path still indexes; budget block does not crash whole job.
- `apps/backend/tests/services/TinyBaseService.test.ts` or adjacent TinyBase tests
  - Add persistence/aggregation tests for new usage table and migration/default schema.
- `apps/backend/tests/api/settings.test.ts`
  - Existing settings tests assert mappings. Add get/update tests for OCR budget fields if exposed via settings.

## Validation commands
Run from repo root:
- `pnpm run typecheck`
- `pnpm run test -- --run apps/backend/tests/agents/OCRAgent.test.ts apps/backend/tests/jobs/BulkOcrJob.test.ts apps/backend/tests/services/MistralService.test.ts`
- If adding BulkIngest tests: `pnpm run test -- --run apps/backend/tests/jobs/BulkIngestJob.test.ts`
- If settings/config changed: include `apps/backend/tests/api/settings.test.ts` and any config/TinyBase tests.
- Final safety: `pnpm run test` and `pnpm run lint` if time allows.

## Open questions / assumptions
- I did not have web access in this toolset. Verify current Mistral OCR response shape/pricing before finalizing `usage_info` parsing. Local code currently only uses `pages.length` from `/v1/ocr`.
- Product decision needed: when a budget cap blocks OCR in bulk jobs, should progress count it as `skipped`, `errors`, or a new `blocked` counter? Recommended: add `blocked` if API compatibility permits; otherwise `skipped` with explicit reason in logs.
- Product decision needed: should caps apply only to `/v1/ocr` or all PDF-to-Mistral document processing (`MistralService.processDocument`) too? Recommended: all OCR-producing PDF calls to avoid bypass/spend surprises.
- Product decision needed: whether runtime settings UI should expose caps or config/env only is enough.

## Compact worker prompt
Implement OCR usage tracking and budget caps across all Mistral OCR-producing paths. Add config/schema/default/env/YAML support for an `ocrBudget` section; add TinyBase usage ledger + service methods for recording and summarizing OCR page/cost usage; enforce caps before network calls and record completed/blocked/skipped events. Protect `OCRAgent.runMistralOCR`, `BulkOcrJob`, and `BulkIngestJob` so legacy `MistralService.processDocument` paths cannot bypass caps. Do not count existing-content/text-document/cache reuse as paid usage. Prefer a shared guard/service or new shared Mistral OCR method to avoid duplicated logic. Add tests for successful usage recording, cap blocking, skipped/cache paths, retry non-double-counting, BulkOcr blocking, and BulkIngest blocking (new test file likely needed). Update settings API/docs if caps are runtime configurable. Validate with targeted Vitest tests plus typecheck/lint.
