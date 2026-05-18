# W3-S16 Effect Tracing OCR Sanitizer Fix Worker

## Implemented

- Adjusted the tracing attribute sanitizer so safe OCR summary attributes survive export:
  - `ocr.pages`
  - `ocr.text_length`
  - `ocr.outcome`
  - existing safe OCR flags `ocr.mock` and `ocr.force`
- Kept OCR/document content protections in place by adding targeted dangerous OCR key detection for OCR text/content/body/args/results/payload/PDF/base64/image/document/prompt/message/token attributes.
- Preserved the broader sanitizer behavior for secrets, prompts, request/response bodies, args/results, embeddings/vectors, payloads, images, base64, PDFs, and document content.
- Added tracing tests proving safe OCR attributes are retained while dangerous OCR/content attributes are redacted.

## Changed files

- `apps/backend/src/observability/tracing.ts`
- `apps/backend/tests/observability/tracing.test.ts`
- `subagent-reports/w3-s16-effect-tracing-ocr-sanitizer-fix-worker.md`

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/observability/tracing.test.ts tests/agents/OCRAgent.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

## Notes / risks

- Scope was limited to the tracing sanitizer and tracing tests.
- No OCRAgent implementation changes were needed.
- The allow-list is intentionally exact for safe OCR summary keys; unknown OCR keys that look like raw content or payload data remain redacted.
