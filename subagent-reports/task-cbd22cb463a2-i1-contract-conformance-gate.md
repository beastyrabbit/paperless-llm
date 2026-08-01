# I1 Contract Conformance Gate

## Summary

Reviewed the new analysis/catalog query and command handler surfaces against the frozen Effect schemas, OpenAPI response semantics, and status/error expectations. Fixed handler-local conformance gaps and made the coordinator-confirmed minimal CatalogProposal projection contract correction so public catalog proposals now expose persisted human decision and apply progress state directly.

## Files Modified

- `packages/api-contracts/src/catalog-contracts.ts`
- `packages/api-contracts/src/openapi.ts`
- `apps/backend/src/api/query-utils.ts`
- `apps/backend/src/api/analysis/query-handlers.ts`
- `apps/backend/src/api/catalog/query-handlers.ts`
- `apps/backend/src/api/analysis/command-handlers.ts`
- `apps/backend/src/api/catalog/command-handlers.ts`
- `apps/backend/tests/api-contracts/g0-contracts.test.ts`
- `apps/backend/tests/api/analysis-query-handlers.test.ts`
- `apps/backend/tests/api/analysis-command-handlers.test.ts`
- `apps/backend/tests/api/catalog-query-handlers.test.ts`
- `apps/backend/tests/api/catalog-command-handlers.test.ts`
- `subagent-reports/task-cbd22cb463a2-i1-contract-conformance-gate.md`

## Changes

- Added strict query parameter validation via `requestEffect`, then wired analysis run list and catalog epoch list handlers to their frozen query schemas.
- Added local command guards for duplicate random-cycle excluded document IDs and duplicate catalog epoch scope values.
- Fixed analysis retry/force-OCR command ordering so illegal run states are rejected before any Paperless trigger-tag mutation.
- Added `projectionVersion`, `decision`, and `apply` projections to `CatalogProposalSchema`, registered the new schemas in OpenAPI, and hydrated them from proposal records plus the latest apply journal.
- Added conformance tests for missing/extra/null/empty request semantics, stale hashes, forged evidence/projection extras, illegal state transitions, workflow tag preservation, and unknown/invalid GET filters.
- Added GET side-effect tests covering all new analysis/catalog query functions with fake Paperless and ledger mutation ports that would fail if called.
- Added cross-service D3 -> ledger -> D5 -> D7 -> D4 conformance proving a D3 persisted proposal hydrates through the public projection, is approved/applied by command handlers, and schedules the D4 apply request.
- Tightened OpenAPI fixture assertions for catalog command routes to require typed 202/409/502/503 coverage.

## Verification

- `pnpm exec biome check --write packages/api-contracts/src/catalog-contracts.ts packages/api-contracts/src/openapi.ts apps/backend/src/api/query-utils.ts apps/backend/src/api/analysis/query-handlers.ts apps/backend/src/api/catalog/query-handlers.ts apps/backend/src/api/analysis/command-handlers.ts apps/backend/src/api/catalog/command-handlers.ts apps/backend/tests/api-contracts/g0-contracts.test.ts apps/backend/tests/api/analysis-query-handlers.test.ts apps/backend/tests/api/catalog-query-handlers.test.ts apps/backend/tests/api/analysis-command-handlers.test.ts apps/backend/tests/api/catalog-command-handlers.test.ts` passed.
- `pnpm --filter @repo/api-contracts build` passed.
- `pnpm --filter @repo/backend test -- tests/api-contracts/g0-contracts.test.ts tests/api/analysis-query-handlers.test.ts tests/api/analysis-command-handlers.test.ts tests/api/catalog-query-handlers.test.ts tests/api/catalog-command-handlers.test.ts` passed: 5 files, 60 tests.
- `pnpm --filter @repo/backend typecheck` passed.
- `pnpm --filter @repo/backend test` passed: 48 files, 534 tests.
- `pnpm --filter @repo/backend lint` passed.

## Remaining Work

No remaining I1 work is known. The only frozen contract change made was the coordinator-confirmed CatalogProposal public projection omission.
