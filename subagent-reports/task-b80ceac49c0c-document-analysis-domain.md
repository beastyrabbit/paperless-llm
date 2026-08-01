# Task b80ceac49c0c: Document Analysis Domain

## Files Added

- `apps/backend/src/services/document-analysis/errors.ts`
- `apps/backend/src/services/document-analysis/ocr.ts`
- `apps/backend/src/services/document-analysis/proposals.ts`
- `apps/backend/src/services/document-analysis/searchable-pdf.ts`
- `apps/backend/src/services/document-analysis/orchestrator.ts`
- `apps/backend/tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`

## Summary

Added a scoped document-analysis orchestration domain without touching shared barrels, layers, routes, contracts, server code, or frontend code. The new modules select the latest original PDF, reuse matching approved OCR versions unless forced, keep OCR previews memory-only, call the existing `DocumentAnalysisSkill` with medium reasoning, persist only hashes/proposal metadata/evidence through the operational ledger, guard stale OCR hash drift, and provide whole-bundle apply with OCRmyPDF generation/upload, Mistral text content patch, exact Paperless metadata update, ai-analyse removal, postread verification, mutation leases, crash-recovery discovery, and sanitized failures.

## Verification

- Passed: `pnpm --filter @repo/backend test -- tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
- Passed: `pnpm --filter @repo/backend exec biome lint --diagnostic-level=error src/services/document-analysis tests/services/document-analysis`
- Blocked by unrelated existing errors: `pnpm --filter @repo/backend typecheck`

Remaining typecheck failures are outside this task scope:

- `src/services/CatalogEvidenceService.ts(83,3): Module "./catalog-evidence/index.js" has no exported member "CatalogCounterexample".`
- `src/services/catalog-evidence/engine.ts(314,3): Property "documents" does not exist ...`
- `src/services/catalog-evidence/engine.ts(315,3): Property "pageLimit" does not exist ...`
