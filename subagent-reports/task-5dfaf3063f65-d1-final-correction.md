# Task 5dfaf3063f65: D1.2 Final D1 Correction

## Files Modified

- `apps/backend/src/services/document-analysis/errors.ts`
- `apps/backend/src/services/document-analysis/ocr.ts`
- `apps/backend/src/services/document-analysis/proposals.ts`
- `apps/backend/src/services/document-analysis/searchable-pdf.ts`
- `apps/backend/src/services/document-analysis/orchestrator.ts`
- `apps/backend/tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`

## Summary

- Added live `ai-analyse` trigger checks before OCR/Codex provider work, after OCR before Codex, before proposal recording, and immediately before Paperless mutation.
- Replaced caller-supplied/default catalog context with D1-built deterministic live catalog snapshots from `getTags`, `getCorrespondents`, `getDocumentTypes`, and `getCustomFields`; persisted that hash as a catalog precondition and recomputed it before apply.
- Added live catalog validation for proposed correspondent, document type, ordinary tag, and custom-field IDs, including rejection of workflow/system/parent/ai-analyse tags as ordinary targets.
- Automatic safe runs now return the post-apply ledger run state (`succeeded`) instead of the earlier `approved` state.
- Apply fails closed when `systemTagIds` or `parentTagIds` are absent, so omitted preservation inputs cannot silently delete Paperless-managed tags.
- Failure handling now checks whether a run exists before writing analysis failure state, avoiding `orDie` masking for pre-run/pre-analyzing failures.
- Recovery verifies already-complete live state and marks it applied; unsafe partial states remain conflict-marked rather than replayed without enough persisted trigger/classification context.

## Verification

- Passed: `pnpm --filter @repo/backend test -- tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
  - Result: 14 tests passed.
- Passed: `pnpm --filter @repo/backend exec biome lint --diagnostic-level=error src/services/document-analysis tests/services/document-analysis`
  - Result: checked 6 files, no diagnostics.
- Blocked by unrelated existing errors: `pnpm --filter @repo/backend typecheck`
  - Result: fails only in `src/services/catalog-evidence/evidence.ts` for missing `riskFlags` shorthand values.
- Checked D1 typecheck output specifically: `pnpm --filter @repo/backend exec tsc --noEmit --pretty false 2>&1 | rg "document-analysis|DocumentAnalysisOrchestrator"`
  - Result: no D1/document-analysis matches.

## Notes

- No live providers are called by the tests.
- No shared barrels, shared Paperless/ledger files, routes, layers, contracts, server files, or frontend files were edited.
