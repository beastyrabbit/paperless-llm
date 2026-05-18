# W3-S14 OCR budget token/config fix worker report

## Implemented

- Added conservative pre-call OCR token estimation in `OcrUsageService`:
  - `estimateOcrTokens(pdfBytes, prompt?)` estimates the base64 document payload, prompt text, and request envelope before a Mistral OCR call.
  - The estimate intentionally overcounts so token caps can be enforced before vendor calls.
- Wired token estimates into all OCR budget reservation call sites before Mistral OCR work starts:
  - `OCRAgent` direct `/v1/ocr` path.
  - `BulkOcrJob` direct `MistralService.processDocumentWithUsage(...)` path.
  - `BulkIngestJob` direct OCR path when OCR is run.
- Hardened `OcrUsageService.reserve()` so a configured token cap cannot be enforced with an absent/zero token estimate; it fails before the OCR call instead of allowing the call through.
- Preserved cached/skipped OCR behavior: cached OCR still returns before reservation, so it does not burn page/token budget.
- Tightened OCR budget config validation:
  - OCR budget limits are now `null`/omitted for unlimited, or positive integers for configured caps.
  - Negative, zero, fractional, and non-numeric env/YAML values fail config validation instead of silently becoming unlimited.
  - Env values `null`/`unlimited` are accepted as explicit unlimited.
- Prevented invalid persisted TinyBase OCR budget settings from disabling a configured fallback cap.

## Changed files

- `apps/backend/src/services/OcrUsageService.ts`
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/jobs/BulkOcrJob.ts`
- `apps/backend/src/jobs/BulkIngestJob.ts`
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `apps/backend/src/config/yaml-loader.ts`
- `apps/backend/tests/services/OcrUsageService.test.ts`
- `apps/backend/tests/config/config.test.ts`
- `apps/backend/tests/jobs/BulkOcrJob.test.ts`
- `apps/backend/tests/agents/OCRAgent.test.ts`

## Tests added/updated

- Added service tests for:
  - token cap pre-call rejection;
  - rejecting reservations when token caps are configured but no positive token estimate is supplied;
  - conservative OCR token estimation;
  - invalid persisted settings not disabling configured token caps.
- Added config tests for:
  - invalid negative/fractional YAML OCR budget limits;
  - invalid non-numeric env OCR budget limits;
  - explicit `null`/`unlimited` values remaining unlimited.
- Updated OCR usage mocks so bulk OCR reservations carry estimated token values.

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/services/OcrUsageService.test.ts tests/config/config.test.ts tests/jobs/BulkOcrJob.test.ts tests/agents/OCRAgent.test.ts tests/services/MistralService.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

## Notes / risks

- The token estimator is conservative and based on request payload size, not vendor-side billing internals. It is designed to fail safe before OCR calls when token caps are configured.
- Existing page cap behavior is preserved.
- No unrelated worktree changes were intentionally modified.
