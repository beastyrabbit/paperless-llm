# W3-S14 OCR budget blank env fix worker report

## Implemented

- Changed OCR budget env parsing so blank/whitespace-only values are invalid instead of being treated as `null`/unlimited.
- Preserved explicit `null` and `unlimited` env values as the only env strings that intentionally disable a budget cap.
- Added config coverage proving `PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT="   "` fails validation instead of silently overriding a YAML `daily_page_limit` cap to unlimited.
- Extended explicit-unlimited coverage to include both `null` and `unlimited` env strings.

## Changed files

- `apps/backend/src/config/yaml-loader.ts`
- `apps/backend/tests/config/config.test.ts`
- `subagent-reports/w3-s14-ocr-budget-blank-env-fix-worker.md`

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/config/config.test.ts tests/services/OcrUsageService.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

## Notes / risks

- I chose the stricter allowed behavior from the task: blank OCR budget env values are invalid. This prevents an accidentally blank environment variable from disabling a configured YAML cap.
- No OCR runtime or unrelated dirty worktree files were changed.
