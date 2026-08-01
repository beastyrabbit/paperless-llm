# D6.1 Analysis Command Correction

## Scope

- Updated `apps/backend/src/api/analysis/command-handlers.ts`.
- Updated focused provider-free tests in `apps/backend/tests/api/analysis-command-handlers.test.ts`.
- Did not edit shared API registration, server, layers, barrels, contracts, frontend, or catalog-apply files.

## Implemented

- Start and random-cycle analysis now prepare the live trigger before scheduling: acquire document lease, reread Paperless, conditionally add `ai-analyse` with a document-state precondition, reread/verify the trigger, derive a trigger revision from the verified Paperless state, then schedule the D1 provider path.
- Trigger preparation handles already-tagged documents without writes, stale tag adds as 409, and ambiguous tag-add failures by rereading and accepting only when the trigger is verified.
- Retry and force-OCR now reassert the live trigger before scheduling; `awaiting_review` uses the legal `awaiting_review -> retrying` transition, while `failed` runs create a deterministic new retry/force run instead of attempting an illegal terminal-state transition.
- Process-memory command idempotency was removed; accepted command responses are recorded in the operational ledger as allowed `state_journal` entries with command marker evidence IDs and task-key rationale, so handler recreation can return the prior accepted response without duplicating Paperless mutations or scheduling.
- Apply/retry/force accepted markers record the actual scheduled task key, and cancel now cancels those recorded task keys instead of assuming `runId`.

## Verification

```text
pnpm run test tests/api/analysis-command-handlers.test.ts
Result: PASS, 13 tests passed.
```

```text
pnpm run typecheck
Result: PASS, tsc --noEmit completed successfully.
```

```text
pnpm exec biome lint --diagnostic-level=error src/api/analysis/command-handlers.ts tests/api/analysis-command-handlers.test.ts
Result: PASS, touched-file lint completed successfully.
```

```text
pnpm run lint
Result: FAIL due to out-of-scope existing catalog-apply lint errors:
- src/services/catalog-apply/service.ts unused DocumentUpdate import.
- src/services/catalog-apply/service.ts unused CompactChairDecisionRecord import.
- src/services/catalog-apply/service.ts unused targetEntityId parameter.
- tests/services/catalog-apply/CatalogApplyService.test.ts unused CatalogApplyConflict import.
```
