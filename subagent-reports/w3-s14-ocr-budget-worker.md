# W3-S14 OCR budget worker handoff

Implemented OCR usage tracking and configurable budget caps.

## Changed
- Added `OcrUsageService` with TinyBase-backed OCR usage events, active reservations, commits, releases, budget snapshots, and a local PDF page estimator.
- Added unlimited-by-default OCR budget config:
  - `ocr_budget.daily_page_limit`
  - `ocr_budget.run_page_limit`
  - `ocr_budget.daily_token_limit`
  - `ocr_budget.run_token_limit`
  - env aliases `PAPERLESS_LLM_OCR_*_LIMIT`
- Wired enforcement into:
  - `OCRAgent` before Mistral `/v1/ocr` fetches.
  - `BulkOcrJob` before direct `MistralService` document OCR calls, with progress `budget` and `budgetStopReason` fields.
  - `BulkIngestJob` before direct OCR calls when `runOcr=true`.
- Added `MistralService.processDocumentWithUsage()` while preserving `processDocument()` string compatibility.
- Added TinyBase `ocrUsageEvents` schema metadata and service/layer exports.
- Updated config examples and env example.

## Validation
Passed:

```bash
pnpm --filter backend test -- tests/services/OcrUsageService.test.ts tests/config/config.test.ts tests/jobs/BulkOcrJob.test.ts tests/agents/OCRAgent.test.ts tests/services/MistralService.test.ts
pnpm --filter backend typecheck
pnpm run lint
```

## Notes / risks
- Page caps are enforced pre-call using a conservative local PDF `/Type /Page` estimator. If a malformed PDF undercounts pages and Mistral reports more pages, usage is still committed but a strict external billing count could diverge.
- Failed Mistral calls release reservations unless usage is returned; this matches the local safe behavior but may not mirror vendor billing for failed attempts.
- Cost caps were not added because there is no approved configurable price source; pages/tokens are tracked/enforced.
- Existing unrelated dirty worktree changes were preserved.
