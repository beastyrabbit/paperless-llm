# D1.3 Recovery Correction

## Scope

- Updated D1 document-analysis recovery orchestration only.
- Added focused D1 recovery tests; no live providers are called.
- Left shared barrels, routes, contracts, Paperless shared adapters, ledger implementation, frontend, and server files untouched for this correction.

## Changes

- `apps/backend/src/services/document-analysis/orchestrator.ts`
  - `recoverInterruptedApplies` uses explicit trusted recovery policy/options: configured custom-field IDs, system tag IDs, parent tag IDs, workflow tag IDs, and ai-analyse tag ID.
  - Recovery acquires the document mutation lease, rereads live catalog/document/source/proposal state, validates source/catalog/proposal hashes, checks the live ai-analyse trigger, and preserves the trigger on conflicts.
  - Idempotent safe resume now completes already-final exact state, skips OCRmyPDF/upload when a matching approved OCR version is already present, resumes generation/upload only when no mutation occurred, and marks divergence as conflict.
  - Ambiguous metadata write failures are resolved by rereading live Paperless state; if the exact final state is present, recovery completes instead of stranding the run.

- `apps/backend/tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
  - Added recovery crash tests for journal-before-upload, approved-version-upload skip, already-final verification, and ambiguous metadata timeout resolved by reread.
  - Added assertions for exact generator/upload/patch/update call counts and mutation lease release.
  - Cleaned the strict proposal fixture so focused tests exercise the current structured-output contract.

## Verification

- `pnpm --filter @repo/backend test -- tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
  - Result: passed, 18 tests.
- `pnpm --filter @repo/backend typecheck`
  - Result: passed.
- `pnpm --filter @repo/backend lint`
  - Result: passed, Biome checked 164 files with no fixes applied.

