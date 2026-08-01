# G0.2 Contract Correction Report

## Summary

Corrected the G0 proposal contracts so read-only proposal responses can represent expired/transient evidence without fabricating OCR citations, preview descriptors, confidence, chair votes, placeholder evidence IDs, safety dependencies, or current entity names. Added explicit freshness projections for stale/current-missing UX and a typed `compact_chair_decision` ledger contract allowed by storage policy. After coordinator guard feedback, split provider output from public projection: `AnalysisProposalSchema`/`strictDecodeAnalysisProposal` remain proof-bearing only, while `AnalysisProposalProjectionSchema`/`strictDecodeAnalysisProposalProjection` cover public available-or-expired responses.

## Files Touched

- `packages/api-contracts/src/analysis-contracts.ts`
- `packages/api-contracts/src/catalog-contracts.ts`
- `packages/api-contracts/src/storage-contracts.ts`
- `packages/api-contracts/src/errors.ts`
- `packages/api-contracts/src/openapi.ts`
- `packages/api-contracts/src/structured-output-contracts.ts`
- `apps/backend/src/api/analysis/query-handlers.ts`
- `apps/backend/src/api/catalog/query-handlers.ts`
- `apps/backend/src/services/document-analysis/proposals.ts`
- `apps/backend/src/services/operational-ledger/types.ts`
- `apps/backend/src/services/operational-ledger/service.ts`
- `apps/backend/tests/api-contracts/g0-contracts.test.ts`
- `apps/backend/tests/api/analysis-query-handlers.test.ts`
- `apps/backend/tests/api/catalog-query-handlers.test.ts`

## Verification

- `pnpm exec biome check --write packages/api-contracts/src/analysis-contracts.ts packages/api-contracts/src/catalog-contracts.ts packages/api-contracts/src/storage-contracts.ts packages/api-contracts/src/errors.ts packages/api-contracts/src/openapi.ts packages/api-contracts/src/structured-output-contracts.ts apps/backend/src/api/analysis/query-handlers.ts apps/backend/src/api/catalog/query-handlers.ts apps/backend/src/services/document-analysis/proposals.ts apps/backend/src/services/operational-ledger/types.ts apps/backend/src/services/operational-ledger/service.ts apps/backend/tests/api-contracts/g0-contracts.test.ts apps/backend/tests/api/analysis-query-handlers.test.ts apps/backend/tests/api/catalog-query-handlers.test.ts` passed with no fixes needed on the final run.
- `pnpm --filter @repo/api-contracts build && pnpm --filter @repo/api-contracts typecheck` passed.
- `pnpm --filter @repo/backend typecheck` passed.
- `pnpm --filter @repo/backend test -- tests/api-contracts/g0-contracts.test.ts tests/api/analysis-query-handlers.test.ts tests/api/catalog-query-handlers.test.ts` passed: 3 files, 20 tests.

## Notes

- This task did not implement compact chair-decision ledger write/read handlers; catalog read projection returns `evidence_expired`/`current_missing` until a real compact chair decision is persisted by a later owner. I removed a dangling partial `recordChairDecision` service implementation/declaration so the backend remains contract-only for this slice.
- The worktree had many pre-existing modified/untracked files before this task; I did not revert unrelated changes.
