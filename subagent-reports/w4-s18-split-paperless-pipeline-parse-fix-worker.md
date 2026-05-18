# W4-S18 Todo #36 Parse Step Regression Fix

## Implemented

- Restored baseline processing step normalization behavior in the extracted helper at `apps/backend/src/agents/processingPipeline/parse.ts`.
- Added `normalizeStep(step)` with the legacy mappings:
  - `ocr` -> `ocr`
  - `index`, `finalizing`, `complete` -> `index`
  - any other value -> `metadata`
- Kept `parseStep(step)` as the Effect-returning helper used by `ProcessingPipeline`, but it now succeeds with the normalized step instead of rejecting unknown values.
- Kept the split/facade structure intact; no extraction was reverted.

## Tests

Updated `apps/backend/tests/agents/ProcessingPipeline.test.ts`:

- Replaced the stricter regression test that expected unknown steps to fail.
- Added coverage for `normalizeStep()` legacy aliases and fallback behavior, including `finalizing`, `complete`, and an unknown step mapping to `metadata`.
- Added `processStep(42, "bogus")` coverage proving unknown runtime steps still execute through the metadata path for public compatibility.

## Changed files

- `apps/backend/src/agents/processingPipeline/parse.ts`
- `apps/backend/tests/agents/ProcessingPipeline.test.ts`
- `subagent-reports/w4-s18-split-paperless-pipeline-parse-fix-worker.md`

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts tests/services/PaperlessService.test.ts tests/api/processing.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

## Notes / risks

- This is behavior-preserving relative to the baseline normalization described in the reviewer blocker.
- No unrelated PaperlessService or ProcessingPipeline extraction files were reverted or broadened.
