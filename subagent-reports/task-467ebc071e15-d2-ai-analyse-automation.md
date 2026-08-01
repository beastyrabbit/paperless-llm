# D2 AI-Analyse Automation

## Scope

- Added a new D2 document-analysis leaf scanner module.
- Added focused provider-free scanner tests.
- Did not edit shared routes, layers, barrels, config, frontend, shared Paperless adapters, or shared ledger schema.

## Changes

- `apps/backend/src/services/document-analysis/ai-analyse-automation-scanner.ts`
  - Adds an `AiAnalyseAutomationScanner` service with `scanOnce`, `start`, `stop`, `trigger`, `getStatus`, and `requestHumanRetry`.
  - Fully paginates Paperless documents and selects only documents whose live transient workflow state is the sole `ai-analyse` trigger.
  - Acquires a global operational-ledger lease so scanner work is concurrency-one and processes candidates sequentially.
  - Computes deterministic attempt identity from trigger revision plus latest original PDF source hash and scoped scanner config hash.
  - Persists compact D2 scanner attempt metadata/hashes to a D2 JSON state file beside the ledger by default.
  - Dedupes completed/review-waiting/paused attempts for the same identity, pauses failures while retaining the tag, and resumes only on human retry or changed trigger/source/config identity.
  - Calls D1 `recoverInterruptedApplies` before new work and delegates provider/apply behavior to D1 `DocumentAnalysisOrchestrator.run` in automatic mode.
  - Verifies `ai-analyse` tag removal only after a successful auto-apply; it never removes the tag itself.

- `apps/backend/tests/services/document-analysis/AiAnalyseAutomationScanner.test.ts`
  - Covers scanner disable, full pagination, sole-transient filtering, sequential processing, dedupe, paused failures, human retry, trigger revision resume, and recovery-before-new-work.
  - Uses mocks only; no live providers are called.

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

