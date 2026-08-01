# Task bd1b76561c95: D1.1 Document Analysis Correction

## Files Modified

- `apps/backend/src/services/document-analysis/errors.ts`
- `apps/backend/src/services/document-analysis/ocr.ts`
- `apps/backend/src/services/document-analysis/proposals.ts`
- `apps/backend/src/services/document-analysis/searchable-pdf.ts`
- `apps/backend/src/services/document-analysis/orchestrator.ts`
- `apps/backend/tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`

## Corrections Implemented

- Strengthened approved OCR reuse identity to require source hash, OCR hash, OCR content hash, exact Mistral OCR model, and OCR options version; forged content-hash labels and model/options mismatches are ignored, and `forceOcr` bypasses reuse.
- Corrected tag policy: 1-3 ordinary tags are normal, 4-5 require strong ordinary-tag-specific evidence, and more than 5 always requires review; arbitrary total field-evidence count no longer gates otherwise-normal proposals.
- Reworked apply to use persisted `AnalysisProposalValues` directly rather than fabricating an `AnalysisProposal`, require proposal decision `undecided` plus run state `approved`, transition `approved -> applying`, and write an `applying` journal before OCRmyPDF/Paperless mutation.
- Added live preread freshness checks for document/source/OCR/catalog preconditions before mutation, final metadata/content/version verification after mutation, replay prevention after applied/rejected decisions, and automatic-mode safe apply through the same path.
- Preserved live system and parent tags, preserved unconfigured custom fields by only sending configured custom field updates, and removed `ai-analyse` only in the final exact metadata update; pre-upload failures leave the trigger tag untouched.
- Expanded crash recovery from list-only to reread-based recovery that marks interrupted applies as verified applied or conflict.
- Tightened OCRmyPDF invocation to fixed `--skip-text --deskew --rotate-pages --output-type pdf` argv with `shell: false`, bounded output, timeout TERM then KILL, cancellation handling, and temp cleanup.

## Verification

- Passed: `pnpm --filter @repo/backend test -- tests/services/document-analysis/DocumentAnalysisOrchestrator.test.ts`
  - Result: 11 tests passed.
- Passed: `pnpm --filter @repo/backend exec biome lint --diagnostic-level=error src/services/document-analysis tests/services/document-analysis`
  - Result: checked 6 files, no diagnostics.
- Blocked by unrelated existing errors: `pnpm --filter @repo/backend typecheck`
  - Result: fails in `src/services/CatalogEvidenceService.ts` on catalog-evidence read-port/document shape mismatches outside D1 ownership.

## Notes

- No live providers are called by the added tests.
- No shared barrels, shared Paperless/ledger files, routes, layers, contracts, server files, or frontend files were edited for this correction.
