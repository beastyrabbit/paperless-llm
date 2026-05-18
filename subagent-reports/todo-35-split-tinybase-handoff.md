# Todo #35 / W4-S18 — Split `TinyBaseService.ts` handoff

Scope requested: inspect `TinyBaseService.ts`, exports, tests, service interface; do not edit implementation. This report is implementation-ready context and a safe staged plan for splitting by persistence/table/domain concern.

## Current state

- Main file: `apps/backend/src/services/TinyBaseService.ts` is ~2.2k lines and currently owns:
  - filesystem persistence and debounced persistence (`lines 33-114`)
  - exported `storeSchema` (`lines 120-230`), although it is not applied with `setTablesSchema`; only exported from barrel
  - exported processing log and document-memory/consolidation types (`lines 233-278`, `431-487`)
  - full `TinyBaseService` interface and Effect tag (`lines 284-423`)
  - helper functions / JSON parsing / migrations / config import / canonical settings migration (`lines 429-889`)
  - live layer construction and every domain method (`lines 895-2198`)
- Barrel export: `apps/backend/src/services/index.ts:66-70` exports only `storeSchema`, `TinyBaseService`, `TinyBaseServiceLive` from `./TinyBaseService.js`. It does **not** re-export helper/type exports such as `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `DocumentMemory`, etc.
- Layer composition imports `TinyBaseServiceLive` from the barrel and expects a single live layer symbol:
  - `apps/backend/src/layers/index.ts:40` uses `DatabaseLayer = Layer.provideMerge(TinyBaseServiceLive, ConfigLayer)`.
  - `apps/backend/src/layers/index.ts:63-66` uses `TinyBaseServiceLive` under core services.
- Direct imports from `TinyBaseService.js` exist and should keep working during/after split:
  - services: `LockService.ts`, `AutoProcessingService.ts`, `CatalogAgentService.ts`, `PaperlessService.ts`, `QdrantService.ts`, `OllamaService.ts`, `MistralService.ts`, `DocumentCaseService.ts`
  - api/agents: `api/metadata/handlers.ts`, `agents/PiConsolidationAgent.ts`, `agents/PiTagExplorerAgent.ts`
  - tests: `tests/services/TinyBaseService.test.ts`, plus Paperless/Ollama/Mistral/settings/pending/jobs tests.

## High-value source evidence

### Persistence concern

`apps/backend/src/services/TinyBaseService.ts:33-114`

- Uses env var `PAPERLESS_LLM_TINYBASE_DATA_DIR`, defaulting to `path.join(process.cwd(), "data")`.
- Persistence file is `${dataDir}/tinybase.json`.
- Directory mode set to `0o700`, file mode `0o600`.
- Corrupt JSON is backed up to `tinybase.json.corrupt-${Date.now()}` and service starts fresh.
- `debouncedPersist` has module-level `persistTimeout`, so splitting must preserve singleton-ish behavior and avoid multiple timers accidentally sharing/clearing incorrectly.

Relevant tests: `apps/backend/tests/services/TinyBaseService.test.ts:31-44` set env vars per test; `50-145` assert initial persisted file, migration, newer-version rejection, and corrupt backup.

### Schema/table concern

`apps/backend/src/services/TinyBaseService.ts:120-230`

`storeSchema` defines only these tables: `schemaMetadata`, `pendingReviews`, `tagMetadata`, `customFieldMetadata`, `blockedSuggestions`, `translations`, `jobStatus`, `settings`, `processingLogs`, `documentOcrContent`, `documentMemory`, `consolidationReports`.

Important: other services write raw TinyBase tables not listed in `storeSchema`:

- `DocumentCaseService` writes/reads `documentCases`, `caseQuestions`, `caseAnswers` via `tinybase.store` (`apps/backend/src/services/DocumentCaseService.ts:360-401`).
- `CatalogAgentService` writes `catalogRuns`, `catalogProposals` (`apps/backend/src/services/CatalogAgentService.ts:139-160`).
- `LockService` writes `locks` (`apps/backend/src/services/LockService.ts:98-102`).

Because `storeSchema` is not currently applied anywhere, do not start enforcing it as part of this split unless separately approved and tested.

### Service interface concern

`apps/backend/src/services/TinyBaseService.ts:284-417`

Interface groups are already the desired domain boundaries:

1. Store/raw access: `readonly store: Store` and store operations (`getStoreJson`, `loadFromJson`)
2. Pending reviews
3. Tag metadata
4. Custom field metadata
5. Blocked suggestions
6. Translations
7. Job status
8. Settings
9. Processing logs
10. Document OCR content
11. Document memory
12. Consolidation reports

Hard compatibility point: many services depend on `readonly store: Store` for direct table manipulation. Removing or hiding it is not safe in this task.

### Live implementation setup concern

`apps/backend/src/services/TinyBaseService.ts:895-938`

The live layer currently:

1. creates `store = createStore()`
2. initializes three numeric counters: `nextBlockedId`, `nextTagMetaId`, `nextFieldMetaId`
3. loads persisted data
4. runs schema migration and verification
5. imports config only if no persisted data
6. migrates canonical settings
7. persists immediately if needed
8. initializes numeric counters from existing tables
9. adds tables listener that calls `debouncedPersist(store)`

This boot order is a behavioral invariant. Preserve it exactly in the first split.

### Domain method groups and key line ranges

- Pending reviews: `TinyBaseService.ts:1050-1291`
  - duplicate prevention by same `docId + type + normalized suggestion` (`1135-1147`)
  - empty suggestions return `null` (`1125-1133`)
- Tag metadata: `1293-1387`, uses `nextTagMetaId++` for new rows.
- Custom field metadata: `1388-1484`, uses `nextFieldMetaId++`.
- Blocked suggestions: `1485-1572`, uses `nextBlockedId++` and `normalizeString`.
- Translations: `1573-1620`, key is `${sourceLang}:${targetLang}:${sourceText}`.
- Job status: `1621-1704`, creates defaults when updating missing status.
- Settings + store operations: `1705-1799`.
- Processing logs: `1800-1913`, sorted by timestamp and JSON-validated data.
- Document OCR content: `1914-2026`.
- Document memory: helper row mappers at `940-1027`, service methods at `2027-2143`.
- Consolidation reports: helper mapper at `1029-1044`, service methods at `2144-2195`.

### Tests coverage

`apps/backend/tests/services/TinyBaseService.test.ts` directly imports from `../../src/services/TinyBaseService.js` and covers:

- persistence schema behavior and migrations (`lines 50-217`)
- pending reviews (`224-419`)
- blocked suggestions (`425-494`)
- tag metadata (`500-573`)
- translations (`579-611`)
- settings (`617-639`)
- store JSON export (`645-662`)

Coverage gaps: custom field metadata, job status, processing logs, document OCR content, document memory write/append, consolidation reports, `loadFromJson`, and direct-store tables used by `DocumentCaseService`, `CatalogAgentService`, `LockService`.

## Recommended file split

Keep `apps/backend/src/services/TinyBaseService.ts` as the public compatibility facade initially. Move internals under a new folder such as `apps/backend/src/services/tinybase/`.

Suggested target files:

1. `services/tinybase/persistence.ts`
   - `getDataDir`, `getPersistenceFile`, `ensureDataDir`, `loadPersistedData`, `persistStore`, `debouncedPersist`
   - Consider exporting only what `TinyBaseServiceLive` needs.
2. `services/tinybase/schema.ts`
   - `CURRENT_TINYBASE_SCHEMA_VERSION`, `storeSchema`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `verifyTinyBaseStoreSchema`
   - `SCHEMA_METADATA_TABLE`, `SCHEMA_VERSION_ROW`, migration list can remain private.
3. `services/tinybase/json.ts` or `helpers.ts`
   - `sanitizeForStorage`, `parseStoredJson`, validators (`isRecord`, arrays, record arrays), `normalizeString`, `generateId`
4. `services/tinybase/settingsImport.ts`
   - `flattenObject`, `autoImportConfigYaml`, `readConfigYamlSettings`, `migrateCanonicalSettings`
   - Depends on `fs`, `path`, `yaml`, `resolveConfigPath`, logger.
5. `services/tinybase/types.ts`
   - `ProcessingLogEventType`, `ProcessingLogEntry`, `ProcessingLogStats`, `HumanDecisionRecord`, `ReviewFeedbackRecord`, `RunSummaryRecord`, `DocumentMemory`, `ConsolidationReportRecord`
   - `TinyBaseService` interface can live here or remain in facade. Prefer move to `types.ts` and re-export from facade.
6. Domain factory modules returning partial service implementations:
   - `domains/pendingReviews.ts`
   - `domains/metadata.ts` (tag + custom field) or separate `tagMetadata.ts` / `customFieldMetadata.ts`
   - `domains/blockedSuggestions.ts`
   - `domains/translations.ts`
   - `domains/jobStatus.ts`
   - `domains/settings.ts`
   - `domains/storeOperations.ts`
   - `domains/processingLogs.ts`
   - `domains/documentOcrContent.ts`
   - `domains/documentMemory.ts`
   - `domains/consolidationReports.ts`

Factory pattern example conceptually:

- Each module exports a function accepting `Store` plus minimal helpers/counter closures:
  - `makePendingReviewOps(store, { generateId })`
  - `makeTagMetadataOps(store, { nextTagMetaId, sanitizeForStorage })`, where `nextTagMetaId` is a function closure like `() => nextTagMetaId++`
  - `makeBlockedSuggestionOps(store, { nextBlockedId, normalizeString, sanitizeForStorage })`
- `TinyBaseServiceLive` composes:
  - `return { store, ...makePendingReviewOps(...), ...makeSettingsOps(...), ... } satisfies TinyBaseService;`

This keeps boot/persistence in one place and moves domains independently.

## Safe staged plan

### Stage 0 — Baseline validation only

Run before edits:

```bash
pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts
pnpm --filter @repo/backend typecheck
```

If the repo uses root scripts instead, equivalent backend commands from repo root are `pnpm run test --filter` not guaranteed; `pnpm --filter @repo/backend ...` matches the package name in `apps/backend/package.json`.

### Stage 1 — Extract pure types/schema/helpers/persistence, keep implementation body

Files to add:

- `apps/backend/src/services/tinybase/types.ts`
- `apps/backend/src/services/tinybase/schema.ts`
- `apps/backend/src/services/tinybase/helpers.ts`
- `apps/backend/src/services/tinybase/persistence.ts`
- `apps/backend/src/services/tinybase/settingsImport.ts`

Modify only imports/re-exports in `TinyBaseService.ts`; keep `TinyBaseServiceLive` domain methods in place. Re-export every currently public symbol from `TinyBaseService.ts` so direct imports keep working:

- `storeSchema`
- `CURRENT_TINYBASE_SCHEMA_VERSION`
- `getTinyBaseSchemaVersion`
- `migrateTinyBaseStoreToCurrentSchema`
- `verifyTinyBaseStoreSchema` if moved/exported
- all exported types currently declared in the file
- `TinyBaseService`, `TinyBaseServiceLive`

Validation after Stage 1:

```bash
pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts
pnpm --filter @repo/backend typecheck
```

### Stage 2 — Extract low-risk domains without counters

Move factories for these domains first:

- translations
- settings
- store operations
- processing logs
- document OCR content
- document memory
- consolidation reports

These do not depend on numeric ID counters. Keep row mappers with their domain module. Compose them in `TinyBaseServiceLive` with spread objects. Validate after each 1-2 domain moves if possible.

### Stage 3 — Extract counter-dependent domains

Move domains with mutable counters carefully:

- blocked suggestions (`nextBlockedId++`)
- tag metadata (`nextTagMetaId++`)
- custom field metadata (`nextFieldMetaId++`)

Use closures provided by `TinyBaseServiceLive` to preserve counter state and initialization from persisted tables:

```ts
let nextBlockedId = getNextNumericRowId("blockedSuggestions");
const allocateBlockedId = () => nextBlockedId++;
```

Do not compute max ID inside every add unless intentionally changing semantics.

### Stage 4 — Extract pending reviews

Pending reviews are larger and have nuanced behavior (skip empty suggestion, duplicate detection, counts by many schema_* types). Move after helpers and tests are stable.

### Stage 5 — Optional facade cleanup

After all domains are extracted, `TinyBaseService.ts` should be a public facade containing:

- imports from `tinybase/*`
- `export type` / `export` re-exports for compatibility
- `TinyBaseService` tag if not moved
- `TinyBaseServiceLive` layer composition

Do not update all consumers to import new internal modules unless necessary; compatibility is safer.

## Risks and constraints

- **Do not remove `store` from `TinyBaseService`.** `DocumentCaseService`, `CatalogAgentService`, `LockService`, `ProcessingPipeline`, and some agents access raw tables directly.
- **Do not enforce `storeSchema` during this split.** It is currently only exported and incomplete relative to raw-table users (`documentCases`, `caseQuestions`, `caseAnswers`, `catalogRuns`, `catalogProposals`, `locks`). Enforcing schemas could break unrelated services.
- **Preserve boot order exactly**: load persisted -> migrate schema -> optional config import -> canonical settings migration -> persist if needed -> verify -> counter initialization -> listener.
- **Preserve direct import path compatibility**: `../../src/services/TinyBaseService.js` and `./TinyBaseService.js` are used by tests and services.
- **Be careful with module-level debounced persistence timer.** Moving to `persistence.ts` is fine, but avoid multiple independent timers per store unless intentionally designed and tested.
- **Be careful with `Effect.try` error mapping.** Domain factories should preserve `operation` names in `DatabaseError` because tests or logs may rely on them.
- **No behavior changes** should be included in this refactor. Avoid opportunistic fixes such as changing null sentinel behavior or row schemas.

## Suggested validation

Targeted:

```bash
pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts
pnpm --filter @repo/backend test -- tests/api/pending.test.ts tests/api/settings.test.ts
pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts tests/services/OllamaService.test.ts tests/services/MistralService.test.ts
pnpm --filter @repo/backend test -- tests/jobs/BootstrapJob.test.ts tests/jobs/BulkOcrJob.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

If time is constrained, minimum before handoff/merge:

```bash
pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts
pnpm --filter @repo/backend typecheck
```

Full backend regression:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend build
```

## Compact worker prompt

Implement Todo #35 / W4-S18: split `apps/backend/src/services/TinyBaseService.ts` by persistence/table/domain concern without behavior changes. Keep `TinyBaseService.ts` as the public compatibility facade so all existing imports from `./TinyBaseService.js` and `../../src/services/TinyBaseService.js` keep working. Preserve all current public exports, especially `storeSchema`, `CURRENT_TINYBASE_SCHEMA_VERSION`, `getTinyBaseSchemaVersion`, `migrateTinyBaseStoreToCurrentSchema`, `TinyBaseService`, `TinyBaseServiceLive`, and exported record/types. Do not remove `readonly store: Store` from the service interface.

Use staged extraction: first move pure types/schema/helpers/persistence/settings-import into `apps/backend/src/services/tinybase/`; then move domain method groups into factory modules and compose them in `TinyBaseServiceLive`. Preserve boot order in `TinyBaseServiceLive`: create store, load persisted data, migrate schema, import config only if no persisted data, migrate canonical settings, persist if needed, verify schema, initialize numeric ID counters, add debounced tables listener. Keep numeric ID counters as closures supplied to counter-dependent domains. Do not start enforcing `storeSchema` because it is currently exported-only and incomplete for raw-table users (`documentCases`, `caseQuestions`, `caseAnswers`, `catalogRuns`, `catalogProposals`, `locks`).

Success criteria: no functional behavior changes; all current direct imports still compile; service interface is unchanged; backend TinyBase tests pass; backend typecheck passes. Run at minimum `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts` and `pnpm --filter @repo/backend typecheck`; run broader backend tests/lint if time permits.
