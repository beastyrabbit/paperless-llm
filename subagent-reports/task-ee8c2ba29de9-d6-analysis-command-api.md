# D6 Analysis Command API Modules

## Scope

- Added a standalone backend command handler module under `apps/backend/src/api/analysis/command-handlers.ts`.
- Added focused provider-free command tests under `apps/backend/tests/api/analysis-command-handlers.test.ts`.
- Did not edit shared API registration, server, layers, barrels, contracts, or frontend files.

## Implemented

- Frozen endpoint and SSE stream registration descriptors for analysis commands without registering routes.
- Command handler factory with injectable daemon runtime for background scheduling and cancellation.
- Strict request decoding and frozen response validation for start, apply, reject, retry, cancel, force OCR, random-cycle select, and random-cycle reset.
- Error mapping for command-visible failures: stale/precondition and CAS conflicts to 409, malformed/schema/provider classes to 502, capability gaps to 503.
- Idempotency for accepted command bodies using requestId/idempotencyKey/cycle body identities.
- Ledger precondition checks for proposal hashes and run-state hashes, including apply CAS `awaiting_review -> approved` before scheduling D1 apply.
- Random-cycle select with full Paperless pagination at limit 250, cursor rotation, ledger recording, and review-mode D1 background execution.
- Reset command through the operational ledger only, with no background provider scheduling.

## Verification

```text
pnpm run test tests/api/analysis-command-handlers.test.ts
Result: PASS, 7 tests passed.
```

```text
pnpm run typecheck
Result: PASS, tsc --noEmit completed successfully.
```

```text
pnpm run lint
Result: PASS, biome lint --diagnostic-level=error . completed successfully.
```

## Notes

- The root `pnpm run test -- apps/backend/tests/api/analysis-command-handlers.test.ts` was not usable because the workspace fan-out passed a backend-relative test path to multiple packages; the backend package command above is the exact focused run that matched the test file.
- Existing unrelated modified and untracked files were present before this task and were left untouched.
