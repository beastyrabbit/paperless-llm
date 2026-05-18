# Todo #35 / W4-S18 — Ready handoff: split `TinyBaseService.ts` by persistence/table/domain concern

## Scope and status

- Requested work for next worker: **final implementation handoff only; do not edit implementation now**.
- Current target file is `apps/backend/src/services/TinyBaseService.ts`, a ~2.2k line mixed-concern service containing:
  - filesystem persistence and debounced persistence,
  - store schema + schema migration/version verification,
  - config.yaml import and settings-key migration,
  - exported domain/service types,
  - all domain/table methods in one `TinyBaseServiceLive` layer.
- Important current branch context: `TinyBaseService.ts` has uncommitted changes already. Recent additions include structured logging, schema metadata/versioning, typed JSON parsing/validation, document OCR cache/memory methods, consolidation reports, canonical settings migration, and tests covering those additions. Do **not** overwrite or simplify these changes while splitting.

## High-value files and evidence

### Primary file: `apps/backend/src/services/TinyBaseService.ts`

Key sections to preserve exactly in behavior:

- Imports and service-level constants:
  - `fs`, `path`, `Context`, `Effect`, `Layer`, `createStore`, YAML parser, `resolveConfigPath`, `DatabaseError`, model types, logger at lines 5-24.
  - `CURRENT_TINYBASE_SCHEMA_VERSION = 1`, `SCHEMA_METADATA_TABLE`, `SCHEMA_VERSION_ROW` at lines 25-27.

- Persistence concern at lines 29-114:
  - `getDataDir()` uses `PAPERLESS_LLM_TINYBASE_DATA_DIR` or `${process.cwd()}/data` (lines 33-38).
  - `ensureDataDir()` creates/chmods dir to `0o700` (lines 43-50).
  - `loadPersistedData(store)` validates JSON with `JSON.parse`, calls `store.setJson`, logs failures, backs up corrupt data to `tinybase.json.corrupt-${Date.now()}` with `0o600`, returns boolean (lines 56-84).
  - `persistStore(store)` writes `store.getJson()` with `0o600` and logs failures without throwing (lines 90-99).
  - `debouncedPersist(store)` uses a module-level `persistTimeout` and 500ms delay (lines 105-113). Avoid changing semantics unless explicitly intended.

- Store schema definition at lines 120-230:
  - `storeSchema` includes all tables: `schemaMetadata`, `pendingReviews`, `tagMetadata`, `customFieldMetadata`, `blockedSuggestions`, `translations`, `jobStatus`, `settings`, `processingLogs`, `documentOcrContent`, `documentMemory`, `consolidationReports`.
  - Recent OCR/memory tables specifically:
    - `documentOcrContent` lines 200-207.
    - `documentMemory` lines 208-220.
    - `consolidationReports` lines 222-229.

- Exported types and interface at lines 236-417 and 438-488:
  - `ProcessingLogEventType`, `ProcessingLogEntry`, `ProcessingLogStats` (lines 236-276).
  - `TinyBaseService` interface with all methods (lines 285-417).
  - `TinyBaseService` Effect tag at line 424.
  - `HumanDecisionRecord`, `ReviewFeedbackRecord`, `RunSummaryRecord`, `DocumentMemory`, `ConsolidationReportRecord` at lines 438-488.
  - External imports depend on these exports from `./TinyBaseService.js` (see caller notes below), so the facade must re-export them or imports must be updated consistently.

- Serialization/validation/schema migration helpers at lines 490-647:
  - `sanitizeForStorage()` converts null/undefined to empty string and object values to JSON string (lines 494-508).
  - Type guards for JSON blobs: `isRecord`, `isStringArray`, `isNumberArray`, `isUnknownArray`, `isHumanDecisionRecordArray`, `isReviewFeedbackRecordArray`, `isRunSummaryRecordArray` (lines 510-555).
  - `parseStoredJson()` logs parse/validation failures and falls back instead of throwing (lines 557-576).
  - Schema helpers: `getTinyBaseSchemaVersion()` exported at lines 584-587, `migrateTinyBaseStoreToCurrentSchema()` exported at lines 613-638, `verifyTinyBaseStoreSchema()` exported at lines 640-647.
  - Tests import `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, and `migrateTinyBaseStoreToCurrentSchema` directly from `TinyBaseService.js`, so preserve facade re-exports.

- Config/settings import and migration at lines 649-890:
  - `flattenObject()` lines 652-669.
  - `autoImportConfigYaml(store)` uses several fallback paths and logs outcomes (lines 674-726).
  - `readConfigYamlSettings()` uses `resolveConfigPath()` and respects `PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT` (lines 728-735+).
  - `migrateCanonicalSettings(store)` maps legacy aliases to canonical keys and syncs some latest alias values (lines 740-890). Preserve all mappings.

- Live layer initialization at lines 896-939:
  - `createStore()` at line 899.
  - numeric ID counters for `blockedSuggestions`, `tagMetadata`, `customFieldMetadata` and `getNextNumericRowId()` lines 900-910.
  - initialization order is important:
    1. `loadPersistedData(store)` line 914,
    2. `migrateTinyBaseStoreToCurrentSchema(store)` line 915,
    3. if no persisted data, `autoImportConfigYaml(store)` lines 921-923,
    4. `migrateCanonicalSettings(store)` line 925,
    5. persist if new store/migration/settings migration lines 926-928,
    6. `verifyTinyBaseStoreSchema(store)` line 929,
    7. initialize numeric counters lines 931-933,
    8. `store.addTablesListener(() => debouncedPersist(store))` lines 935-938.

- Document memory helpers near layer top at lines 941-1045:
  - `createEmptyMemory()` returns default document memory with `sessionId: doc-${docId}-${generateId()}` (lines 941-957).
  - `rowToMemory()` parses all JSON fields via typed validators and fallbacks (lines 959-1007).
  - `writeMemory()` JSON-stringifies each structured field (lines 1010-1024).
  - `getOrCreateMemory()` line 1027.
  - `rowToConsolidationReport()` parses `proposals` with `isUnknownArray` (lines 1030-1045).

- Domain method blocks in live implementation:
  - Pending Reviews: starts around line 1050; notable duplicate/empty-suggestion handling in `addPendingReview` around lines 1135-1174.
  - Tag Metadata: starts around line 1306.
  - Custom Field Metadata: starts around line 1390.
  - Blocked Suggestions: starts around line 1470.
  - Translations: starts around line 1552.
  - Job Status: starts around line 1598.
  - Settings: starts around line 1679.
  - Store operations: starts around line 1751; `loadFromJson` must still migrate + verify schema.
  - Processing Logs: starts around line 1784; `data` field parsed via `parseStoredJson(..., isRecord)` and logs sorted by timestamp.
  - Document OCR Content: lines 1919-2026.
  - Document Memory: lines 2032-2143.
  - Consolidation Reports: lines 2149-2189.

### Tests: `apps/backend/tests/services/TinyBaseService.test.ts`

- Test harness uses temp data dir and disables config import:
  - imports `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `TinyBaseService`, `TinyBaseServiceLive` from `../../src/services/TinyBaseService.js` (lines 11-17).
  - `PAPERLESS_LLM_TINYBASE_DATA_DIR` and `PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT=true` set in `beforeEach` (lines 31-35), cleaned in `afterEach` (lines 37-44).
- Persistence/schema tests to keep passing:
  - initializes fresh store with schema version and persistence file (lines 50-66).
  - migrates legacy persisted store and preserves existing settings row (lines 68-99).
  - rejects newer persisted schema versions (lines 101-123).
  - backs up corrupt persisted stores (lines 125-145).
  - idempotent migrations using raw `createStore()` (lines 147-154).
  - invalid typed JSON blobs fall back without throwing for document memory and pending review alternatives (lines 156-217).
- Domain tests cover pending reviews, blocked suggestions, tag metadata, translations, settings, store JSON export (lines 224-662). They are not exhaustive for all method groups, so typecheck and broader backend tests are still needed after splitting.

### Direct callers / compatibility constraints

- `apps/backend/src/services/index.ts` re-exports `storeSchema`, `TinyBaseService`, and `TinyBaseServiceLive` from `./TinyBaseService.js` (lines 82-86). Keep this public surface stable.
- `apps/backend/src/agents/PiDocumentAgent.ts` imports `type DocumentMemory` from `../services/TinyBaseService.js` (line 28), and uses document memory fallback/case memory migration at lines 2456-2478; preserve the exported type path or update the import.
- `apps/backend/src/services/DocumentCaseService.ts` imports `type HumanDecisionRecord`, `type ReviewFeedbackRecord`, and `TinyBaseService` from `./TinyBaseService.js` (lines 11-15). It reads legacy `documentMemory` rows directly from `tinybase.store` during case creation/migration (lines 425-469). Do not rename the table/fields.
- OCR uses both OCR content cache and document memory:
  - `apps/backend/src/agents/OCRAgent.ts` persists OCR content via `setDocumentOcrContent()` lines 389-392.
  - patches memory with `ocrVersionIds` and `extractedFacts.ocr` lines 447-461.
  - reads `getDocumentMemory()` + `getDocumentOcrContent()` for cache hit logic lines 557-578.
- Many services/API handlers depend on `TinyBaseService` via service barrel or direct import. Grep summary found references across jobs, agents, API handlers, `PaperlessService`, `OllamaService`, `MistralService`, `QdrantService`, `LockService`, `CatalogAgentService`, etc. Avoid changing method names or the Effect tag identity.

## Suggested target split

Prefer a compatibility facade: keep `apps/backend/src/services/TinyBaseService.ts` as the stable public module exporting the tag, live layer, and re-exported types/helpers. Move implementation details into `apps/backend/src/services/tinybase/` or similarly named subfolder.

Suggested files:

1. `apps/backend/src/services/tinybase/types.ts`
   - `ProcessingLogEventType`, `ProcessingLogEntry`, `ProcessingLogStats`.
   - `HumanDecisionRecord`, `ReviewFeedbackRecord`, `RunSummaryRecord`, `DocumentMemory`, `ConsolidationReportRecord`.
   - `TinyBaseService` interface.
   - Imports `Store`, `Effect`, `DatabaseError`, and model types.
   - This avoids type cycles between the facade and domain method factories.

2. `apps/backend/src/services/tinybase/schema.ts`
   - `CURRENT_TINYBASE_SCHEMA_VERSION`, `storeSchema`, schema metadata constants if needed.
   - `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `verifyTinyBaseStoreSchema`.
   - Keep schema version at `1`; this refactor should not change persisted shape, so no schema bump.

3. `apps/backend/src/services/tinybase/persistence.ts`
   - `getDataDir`, `getPersistenceFile`, `ensureDataDir`, `loadPersistedData`, `persistStore`, `debouncedPersist`.
   - Import/use `tinybaseLogger` from a shared logger module or define `tinybaseLogger` in `logging.ts`.
   - Preserve file modes and corrupt-backup behavior.

4. `apps/backend/src/services/tinybase/logging.ts`
   - `export const tinybaseLogger = logger.child({ component: "tinybase" });`
   - Keeps logging consistent across extracted modules.

5. `apps/backend/src/services/tinybase/serialization.ts`
   - `generateId`, `normalizeString`, `sanitizeForStorage`.
   - Type guards and `parseStoredJson`.
   - This module may import domain types from `types.ts` for validators.

6. `apps/backend/src/services/tinybase/configImport.ts`
   - `flattenObject`, `autoImportConfigYaml`, `readConfigYamlSettings`, `migrateCanonicalSettings`.
   - Imports `fs`, `path`, YAML parser, `resolveConfigPath`, and logger.
   - Preserve `PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT` handling and all canonical key mappings.

7. Domain/table modules, ideally returning method groups that can be spread into the service object:
   - `pendingReviews.ts`
   - `metadata.ts` or separate `tagMetadata.ts` and `customFieldMetadata.ts`
   - `blockedSuggestions.ts`
   - `translations.ts`
   - `jobStatus.ts`
   - `settings.ts`
   - `storeOperations.ts`
   - `processingLogs.ts`
   - `documentOcrContent.ts`
   - `documentMemory.ts`
   - `consolidationReports.ts`

A practical method-factory pattern:

```ts
export const makeDocumentOcrContentMethods = (store: Store) => ({
  setDocumentOcrContent: ...,
  getDocumentOcrContent: ...,
  hasDocumentOcrContent: ...,
  deleteDocumentOcrContent: ...,
  getDocumentOcrContentStats: ...,
});
```

For metadata and blocked suggestions, the factories need mutable ID counters or allocator callbacks. To preserve behavior, keep counter state in `TinyBaseServiceLive` and pass callbacks such as `nextBlockedId: () => nextBlockedId++`, `nextTagMetaId: () => nextTagMetaId++`, `nextFieldMetaId: () => nextFieldMetaId++`.

`TinyBaseService.ts` facade after split should roughly:

- import `Context`, `Effect`, `Layer`, `createStore`;
- import types from `./tinybase/types.js`;
- re-export public types/helpers/schema functions from submodules;
- create `export const TinyBaseService = Context.GenericTag<TinyBaseService>("TinyBaseService")`;
- implement `TinyBaseServiceLive` by composing initialization utilities and spreading method factories into one object.

## Staged safe implementation plan

### Stage 0 — baseline and guardrails

1. Run or at least record baseline validation before editing if feasible:
   - `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts`
   - `pnpm --filter @repo/backend typecheck`
2. Confirm working tree has many unrelated uncommitted changes. Do not run broad formatting that might touch unrelated files.
3. Use file moves/copy carefully; preserve public import paths unless intentionally updated.

### Stage 1 — extract pure/public types and schema first

1. Create `services/tinybase/types.ts` and move exported type/interface declarations.
2. Create `services/tinybase/schema.ts` and move `storeSchema`, schema version constants/functions.
3. In `TinyBaseService.ts`, re-export the moved public symbols:
   - `export type { ... } from "./tinybase/types.js";`
   - `export { CURRENT_TINYBASE_SCHEMA_VERSION, storeSchema, getTinyBaseSchemaVersion, migrateTinyBaseStoreToCurrentSchema, verifyTinyBaseStoreSchema } from "./tinybase/schema.js";`
4. Keep `TinyBaseService` tag name unchanged.
5. Run targeted typecheck/test if possible before proceeding.

### Stage 2 — extract infrastructure helpers

1. Move logger to `tinybase/logging.ts`.
2. Move persistence helpers to `tinybase/persistence.ts`.
3. Move serialization helpers to `tinybase/serialization.ts`.
4. Move config import/settings migration helpers to `tinybase/configImport.ts`.
5. Update `TinyBaseServiceLive` imports and preserve initialization order exactly.
6. Run `TinyBaseService.test.ts` after this stage because persistence/schema/config behavior is most fragile.

### Stage 3 — extract table/domain method groups one at a time

Recommended order from least coupled to most coupled:

1. `documentOcrContent.ts` (self-contained, recent OCR budget/cache changes touch it; preserve timestamps and stats).
2. `translations.ts`, `settings.ts`, `jobStatus.ts`, `processingLogs.ts`.
3. `pendingReviews.ts` (uses `generateId`, `sanitizeForStorage`, `parseStoredJson`, `isStringArray`; has duplicate/empty-suggestion behavior).
4. `blockedSuggestions.ts` (requires `normalizeString` and next ID allocator).
5. `tagMetadata.ts` and `customFieldMetadata.ts` (require next ID allocators and model types).
6. `documentMemory.ts` (recent memory changes; includes helpers and append methods).
7. `consolidationReports.ts`.
8. `storeOperations.ts` should receive/store schema migration functions and keep `loadFromJson()` migrating + verifying.

After each extracted group, run TypeScript or the targeted TinyBase test if quick enough. This makes it easier to catch missed imports/method-name mismatches.

### Stage 4 — final cleanup

1. Ensure `TinyBaseService.ts` is now a thin facade/composition module, not a second copy of implementation details.
2. Ensure public imports still work:
   - `../../src/services/TinyBaseService.js` tests.
   - `../services/TinyBaseService.js` type imports in `PiDocumentAgent.ts`.
   - `./TinyBaseService.js` imports in `DocumentCaseService.ts` and other services.
   - Barrel export in `services/index.ts`.
3. Avoid schema/data shape changes. No migration version bump should be needed for a pure split.
4. Run final validation below.

## Risks and invariants

- **No behavior changes**: This is a structure-only refactor. Persisted TinyBase JSON shape must remain byte-compatible in table/row/cell names and JSON-stringified fields.
- **No schema version bump**: Since no storage shape changes are intended, keep `CURRENT_TINYBASE_SCHEMA_VERSION = 1`.
- **Effect tag identity/name**: `Context.GenericTag<TinyBaseService>("TinyBaseService")` must stay the public service tag.
- **Initialization order matters**: load persisted data, migrate schema, optionally config import, migrate canonical settings, persist if needed, verify schema, initialize counters, add listener.
- **Config import semantics**: preserve `PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT`, fallback paths, and `resolveConfigPath()` usage.
- **Recent OCR/memory changes**: preserve `documentOcrContent` APIs and `DocumentMemory` JSON validation/fallback behavior. These are used by `OCRAgent` cache/persistence logic and `PiDocumentAgent`/`DocumentCaseService` legacy memory migration.
- **Module cycles**: Avoid domain modules importing the facade `TinyBaseService.ts` for types. Put shared types in `tinybase/types.ts` and have the facade re-export them.
- **Mutable counters**: Keep numeric IDs monotonic based on existing table row IDs. If extracting, pass allocator callbacks from the live layer.
- **Debounced persistence**: Existing timeout is module-scoped. A refactor could make it store-scoped, but that is a behavior improvement, not necessary. Prefer preserving current semantics in this split unless tests motivate otherwise.
- **Formatter blast radius**: Use targeted formatting/lint or no formatting on unrelated files; the working tree has many unrelated edits.

## Validation plan

Minimum targeted validation after split:

```bash
pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts
pnpm --filter @repo/backend typecheck
```

Recommended broader validation if time permits:

```bash
pnpm --filter @repo/backend test -- tests/agents/OCRAgent.test.ts tests/services/DocumentCaseService.test.ts tests/agents/PiDocumentAgent.test.ts
pnpm --filter @repo/backend test
pnpm --filter @repo/backend lint
```

If full backend test/lint is too slow or blocked by unrelated branch issues, record exact command/output and at least complete the TinyBase test plus backend typecheck.

## Final worker prompt

Implement Todo #35 / W4-S18: split `apps/backend/src/services/TinyBaseService.ts` into smaller modules by persistence/table/domain concern without changing behavior. Keep `TinyBaseService.ts` as the public compatibility facade exporting the same symbols used today (`TinyBaseService`, `TinyBaseServiceLive`, `storeSchema`, `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, and exported types such as `DocumentMemory`, `HumanDecisionRecord`, `ReviewFeedbackRecord`).

Use the staged plan in `subagent-reports/todo-35-split-tinybase-ready-handoff.md` as source of truth. Preserve all persistence semantics, schema version `1`, table/field names, config import/settings migration behavior, typed JSON fallback behavior, OCR content methods, document memory methods, consolidation reports, and live-layer initialization order. Avoid cycles by moving shared types to a submodule and re-exporting them from the facade. Extract domain method groups into factories that receive the `Store` and any needed ID allocator callbacks.

Success criteria:

- The refactor is structural only; callers do not need to rediscover or change behavior.
- All public imports from `./TinyBaseService.js` and service barrel continue to work.
- `documentOcrContent` and `documentMemory` behavior used by `OCRAgent`, `PiDocumentAgent`, and `DocumentCaseService` is preserved.
- `TinyBaseService.ts` is substantially smaller and delegates to concern-focused modules.
- Validation passes, at minimum:
  - `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts`
  - `pnpm --filter @repo/backend typecheck`
- If any validation cannot be completed because of unrelated workspace issues, report the exact command and failure.
