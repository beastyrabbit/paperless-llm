# D2.1 AI-Analyse Scanner Correction

## Scope

- Corrected the existing D2 scanner leaf module and focused D2 tests.
- Did not add any scanner sidecar store or raw scanner state file.
- Did not edit shared routes, layers, barrels, config, frontend, or shared Paperless adapters.

## Changes

- `apps/backend/src/services/document-analysis/ai-analyse-automation-scanner.ts`
  - Removed all direct `node:fs` scanner-state reads/writes and removed the `stateFile` option/status field.
  - Stores scanner attempt state, dedupe decisions, paused failures, and human retry markers only as compact `operational-ledger.json` entries via `OperationalLedgerService.appendLedgerEntry`.
  - Uses allowed compact ledger kinds: `ids_hashes_state` for scanner attempt states and `retry_timestamps` for human retry markers.
  - Keeps deterministic run identity from trigger revision plus latest original PDF source hash and scoped configuration hash.
  - Keeps the global scanner lease in the operational ledger so scanner concurrency is exactly one.
  - Enumerates work through `readTagAssignmentReceipt(aiAnalyseTagId)` and hydrates only receipt documents for sole-transient live trigger checks.
  - Keeps D1 `recoverInterruptedApplies` before new work and delegates automatic run/apply behavior to `DocumentAnalysisOrchestrator`.
  - Retains paused-failure behavior, human retry/source/config-change resume, cancellation hooks, and verified final ai-analyse removal after successful apply.

- `apps/backend/tests/services/document-analysis/AiAnalyseAutomationScanner.test.ts`
  - Removed `stateFile` usage from scanner config.
  - Mocked Paperless tag assignment receipts and made global `listDocumentsPage` fail if accidentally used.
  - Added >100 triggered-document receipt coverage with two receipt pages and sole-transient filtering.
  - Added storage-policy assertions that only `operational-ledger.json` is created and forbidden/raw payload strings are not serialized.

## Verification

- `pnpm --filter @repo/backend test -- tests/services/document-analysis/AiAnalyseAutomationScanner.test.ts`
  - Result: passed, 6 tests.
- `pnpm --filter @repo/backend test -- tests/services/document-analysis/AiAnalyseAutomationScanner.test.ts tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
  - Result: passed, 2 files / 24 tests.
- `pnpm --filter @repo/backend typecheck`
  - Result: passed.
- `pnpm --filter @repo/backend exec biome lint src/services/document-analysis/ai-analyse-automation-scanner.ts tests/services/document-analysis/AiAnalyseAutomationScanner.test.ts --diagnostic-level=error`
  - Result: passed, 2 files.
- `pnpm --filter @repo/backend lint`
  - Result: passed, Biome checked 173 files with no fixes applied.

