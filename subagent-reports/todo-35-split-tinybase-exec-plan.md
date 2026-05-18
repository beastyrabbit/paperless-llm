# Implementation Plan

## Goal
Extract the lowest-risk TinyBase service infrastructure slice after the OCR budget/memory work lands, preserving the public `TinyBaseService.ts` module and all current storage/schema behavior.

## Tasks
1. **Confirm post-merge baseline and current TinyBase shape**: Before editing, verify the OCR budget/memory changes are present and tests are green or failures are understood.
   - File: `apps/backend/src/services/TinyBaseService.ts`
   - Changes: no code change; confirm `storeSchema` includes current tables, especially `ocrUsageEvents`, `documentOcrContent`, `documentMemory`, and `consolidationReports`.
   - Acceptance: record results for `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts` and `pnpm --filter @repo/backend typecheck` before refactor.

2. **Create a tinybase logger module**: Move only the logger child to an internal module.
   - File: `apps/backend/src/services/tinybase/logging.ts`
   - Changes: add `export const tinybaseLogger = logger.child({ component: "tinybase" });` importing `logger` from `../../utils/logger.js`.
   - Acceptance: `TinyBaseService.ts` imports `tinybaseLogger` from `./tinybase/logging.js`; no log event names or payloads change.

3. **Extract store schema and schema migration helpers**: Move schema-only declarations and schema-version helpers into a new module.
   - File: `apps/backend/src/services/tinybase/schema.ts`
   - Changes: move `CURRENT_TINYBASE_SCHEMA_VERSION`, `storeSchema`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, and `verifyTinyBaseStoreSchema`; keep `SCHEMA_METADATA_TABLE` and `SCHEMA_VERSION_ROW` internal unless needed by tests.
   - Acceptance: `ocrUsageEvents` remains in `storeSchema` exactly as currently landed; schema version remains `1`; persisted row/table names do not change.

4. **Preserve the public facade exports**: Keep caller imports stable while delegating to the extracted schema module.
   - File: `apps/backend/src/services/TinyBaseService.ts`
   - Changes: import schema helpers for live-layer initialization and `loadFromJson`; re-export public schema symbols from `./tinybase/schema.js` so existing tests and callers importing from `./TinyBaseService.js` continue to work.
   - Acceptance: imports from `../../src/services/TinyBaseService.js` still expose `CURRENT_TINYBASE_SCHEMA_VERSION`, `storeSchema`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, and `verifyTinyBaseStoreSchema`.

5. **Extract public type declarations only if schema extraction is clean**: Move exported interfaces/types that do not require runtime initialization.
   - File: `apps/backend/src/services/tinybase/types.ts`
   - Changes: move `ProcessingLogEventType`, `ProcessingLogEntry`, `ProcessingLogStats`, `HumanDecisionRecord`, `ReviewFeedbackRecord`, `RunSummaryRecord`, `DocumentMemory`, `ConsolidationReportRecord`, and the `TinyBaseService` interface; import `Store`, `Effect`, `DatabaseError`, and model types directly here.
   - Acceptance: `TinyBaseService.ts` re-exports these types and uses the imported `TinyBaseService` interface for `Context.GenericTag<TinyBaseService>("TinyBaseService")`; `PiDocumentAgent.ts`, `DocumentCaseService.ts`, tests, and service barrel do not need import-path changes.

6. **Do not extract table/domain methods in this first slice**: Leave all method implementations, persistence functions, config import, serialization helpers, document memory helpers, and OCR content/usage behavior in `TinyBaseService.ts` for now.
   - File: `apps/backend/src/services/TinyBaseService.ts`
   - Changes: no domain-method movement in this slice.
   - Acceptance: diff is limited to imports/re-exports plus removal of moved logger/schema/type declarations; live-layer initialization order is unchanged.

7. **Run targeted validation**: Verify compatibility after the narrow extraction.
   - File: N/A
   - Changes: no code change.
   - Acceptance: pass or record exact failures for:
     - `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts`
     - `pnpm --filter @repo/backend test -- tests/services/OcrUsageService.test.ts` if present after OCR budget work
     - `pnpm --filter @repo/backend typecheck`

## Files to Modify
- `apps/backend/src/services/TinyBaseService.ts` - replace in-file logger/schema/type declarations with imports and public re-exports; keep live implementation and all domain methods in place.

## New Files
- `apps/backend/src/services/tinybase/logging.ts` - shared TinyBase logger child.
- `apps/backend/src/services/tinybase/schema.ts` - store schema, schema version constants, migration, and verification helpers.
- `apps/backend/src/services/tinybase/types.ts` - public TinyBase service/type declarations, only if tasks 2-4 validate cleanly.

## Dependencies
- Task 1 must happen after the current OCR budget/memory work lands.
- Task 3 depends on Task 2 because schema helpers use `tinybaseLogger`.
- Task 4 depends on Task 3 to keep the public facade compatible.
- Task 5 is optional for this first slice and should only proceed after schema extraction validates.
- Task 7 depends on all extraction tasks completed in this slice.

## Risks
- `context.md` was not present at `/mnt/storage/workspace/projects/paperless_local_llm/context.md`; use `subagent-reports/todo-35-split-tinybase-ready-handoff.md` plus the landed code as source of truth.
- The ready handoff predates current OCR budget changes: current `storeSchema` includes `ocrUsageEvents`, and `OcrUsageService.ts` reads `tinybase.store.getTable("ocrUsageEvents")` directly. Do not drop, rename, or relocate this table in a way that changes raw-store access.
- Moving the `TinyBaseService` interface can create type-only cycles if submodules import the facade. `types.ts` must import only lower-level dependencies, never `TinyBaseService.ts`.
- Re-export mistakes are the most likely breakage because tests and callers import helpers/types from `./TinyBaseService.js`.
- Avoid extracting persistence/config/domain methods in this slice; those areas have higher conflict risk with OCR usage persistence, document OCR cache, and memory validation changes.
- No schema version bump is allowed for this structural refactor.

## Final Worker Prompt
Implement only the first safe extraction slice for Todo #35. After confirming the current OCR budget/memory changes are present, split `apps/backend/src/services/TinyBaseService.ts` by moving the TinyBase logger to `apps/backend/src/services/tinybase/logging.ts`, the store schema and schema-version helpers to `apps/backend/src/services/tinybase/schema.ts`, and, only if clean, exported public types/interfaces to `apps/backend/src/services/tinybase/types.ts`. Keep `TinyBaseService.ts` as the compatibility facade: it must still export `TinyBaseService`, `TinyBaseServiceLive`, `storeSchema`, `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `verifyTinyBaseStoreSchema`, and all existing public types. Do not move domain/table methods yet. Preserve schema version `1`, live-layer initialization order, all table/field names, and the current `ocrUsageEvents`, `documentOcrContent`, `documentMemory`, and `consolidationReports` schema exactly. Validate with the TinyBase service test, OCR usage service test if present, and backend typecheck; report exact command output for any unrelated failures.
