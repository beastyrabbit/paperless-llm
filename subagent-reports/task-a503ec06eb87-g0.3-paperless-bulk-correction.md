# G0.3 Paperless Bulk Contract Correction

## Summary

Replaced the loose Paperless bulk operation request shape with a strict typed union for the official Paperless document bulk edit operations:

- `modify_tags` with `parameters.addTagIds` and `parameters.removeTagIds`
- `set_correspondent` with `parameters.correspondentId`
- `set_document_type` with `parameters.documentTypeId`

The public contract retains `documentIds`, nonempty `preconditions`, `payloadHash`, and `idempotencyKey`, and rejects unknown top-level keys, unknown parameter keys, duplicate IDs, legacy operations, and empty tag modifications. The Paperless catalog adapter now maps this typed contract directly to `/documents/bulk_edit/` request bodies while leaving async task polling as a separate `pollTask` call.

## Files Modified

- `packages/api-contracts/src/paperless-capability-contract.ts`
- `apps/backend/src/services/paperless/catalog-adapter.ts`
- `apps/backend/src/services/catalog-apply/service.ts`
- `apps/backend/tests/services/PaperlessService.test.ts`
- `apps/backend/tests/services/catalog-apply/CatalogApplyService.test.ts`
- `apps/backend/tests/api-contracts/g0-contracts.test.ts`
- `subagent-reports/task-a503ec06eb87-g0.3-paperless-bulk-correction.md`

## Contract Details

- `PaperlessBulkOperationSchema` now exposes only `modify_tags`, `set_correspondent`, and `set_document_type`.
- `PaperlessBulkOperationRequestSchema` is a discriminated union of strict operation-specific schemas.
- `strictDecodePaperlessBulkOperationRequest` rejects hidden `payload`, undeclared parameter fields such as legacy `tagId`, duplicate document/tag IDs, and no-op `modify_tags`.
- The generated OpenAPI document is covered for the `/api/paperless/bulk-operations` request schema and typed 409/502/503 responses.

## Adapter Details

The adapter emits exact official Paperless payloads:

```json
{ "documents": [42], "method": "modify_tags", "parameters": { "add_tags": [9], "remove_tags": [3] } }
```

```json
{ "documents": [42], "method": "set_correspondent", "parameters": { "correspondent": 17 } }
```

```json
{ "documents": [42], "method": "set_document_type", "parameters": { "document_type": 23 } }
```

## Verification

- `pnpm exec biome check --write packages/api-contracts/src/paperless-capability-contract.ts apps/backend/src/services/paperless/catalog-adapter.ts apps/backend/src/services/catalog-apply/service.ts apps/backend/tests/services/PaperlessService.test.ts apps/backend/tests/services/catalog-apply/CatalogApplyService.test.ts apps/backend/tests/api-contracts/g0-contracts.test.ts` passed; fixed one formatting change after the OpenAPI test update.
- `pnpm --filter @repo/api-contracts build` passed.
- `pnpm --filter @repo/backend test -- tests/api-contracts/g0-contracts.test.ts tests/services/PaperlessService.test.ts tests/services/catalog-apply/CatalogApplyService.test.ts` passed: 3 files, 46 tests.
- `pnpm --filter @repo/backend typecheck` passed.
- `pnpm --filter @repo/backend lint` passed.
- Final targeted `rg` found no remaining `readLooseRecord`, legacy bulk operation names, or old `addTags`/`removeTags` field names in the touched contract/backend files.

## Remaining Work

No implementation work remains for this G0.3 scope. Handler implementation and operational ledger changes were intentionally left untouched.
