# Todo #36 / W4-S18 — Split `PaperlessService.ts` and `ProcessingPipeline.ts` final handoff

Scope requested: **do not edit implementation**. This is an implementation-ready, staged-safe handoff for splitting `apps/backend/src/services/PaperlessService.ts` and `apps/backend/src/agents/ProcessingPipeline.ts` after the recent cancellation, tag-cache, max-steps, and metrics work.

## Current state / source-backed facts

### `PaperlessService.ts`

- File size: `apps/backend/src/services/PaperlessService.ts` is 1218 lines.
- Public API surface is in one file and must remain stable:
  - `PaperlessApiVersionInfo`, `PaperlessDocumentVersion`, `PaperlessVersionUploadResult`: `PaperlessService.ts:26-56`
  - `PaperlessService` interface: `PaperlessService.ts:58-199`
  - Effect tag: `PaperlessService.ts:202`
  - `PaperlessServiceLive`: `PaperlessService.ts:265-1218`
- Internal concerns already form clear split boundaries:
  1. **Types/interface/tag**: `PaperlessService.ts:26-202`.
  2. **Pagination/version URL helpers**: `PaginatedResponse`, `PaperlessDocumentWithVersions`, `normalizeVersion`, `versionSortKey`, `normalizePaperlessUrl`: `PaperlessService.ts:209-258`.
  3. **Config/client primitives** inside live layer: `getConfig`, `request`, `binaryRequest`, `multipartRequest`, `mapNotFound`: `PaperlessService.ts:273-505`.
  4. **ID lookup + pagination helpers**: `getTagId`, `getCorrespondentId`, `getDocumentTypeId`, `fetchAllDocuments`: `PaperlessService.ts:507-571`.
  5. **Document/version operations**: `PaperlessService.ts:574-746`.
  6. **Tag operations**: `PaperlessService.ts:749-861`.
  7. **Correspondent operations**: `PaperlessService.ts:868-916`.
  8. **Document type operations**: `PaperlessService.ts:923-971`.
  9. **Custom field and note operations**: `PaperlessService.ts:978-1008`.
  10. **Queue/count/connection operations**: `PaperlessService.ts:1015-1216`.
- Important post-change behavior to preserve:
  - Dynamic settings fallback: `getConfig()` reads `tinybaseService.getAllSettings()` and falls back to `ConfigService` values before every request (`PaperlessService.ts:273-293`). Do not cache config at layer construction.
  - SSRF/host safety: `normalizePaperlessUrl` enforces `http/https`, no credentials, optional `PAPERLESS_ALLOWED_HOSTS` (`PaperlessService.ts:230-258`). Keep this centralized and tested.
  - Request timeout uses `fetchWithTimeout` and `config.http.requestTimeoutMs` defaulting to `120_000` (`PaperlessService.ts:271`, `:327-339`, `:397-406`, `:454-464`).
  - Paperless v3/version headers are set in JSON and multipart requests (`Accept: application/json; version=10`), while binary download uses `Accept: */*` (`PaperlessService.ts:318-326`, `:388-396`, `:449-452`).
  - Queue stats have compatibility alias logic and dedupe/coarse-tag handling (`PaperlessService.ts:1015-1198`); this is high-risk for accidental behavior changes.
- Direct imports/users are broad. Keep `PaperlessService.ts` as the compatibility facade exporting the same symbols; callers import both from barrel and direct file:
  - `apps/backend/src/services/index.ts:61-65` re-exports `PaperlessService`, `PaperlessServiceLive`.
  - Direct service imports include `TagCacheService.ts`, `AutoProcessingService.ts`, `CatalogAgentService.ts`, `DocumentCaseService.ts`, plus `PiConsolidationAgent.ts` and search handlers.
  - Barrel imports include `server.ts`, jobs, OCR, PiDocumentAgent, API handlers, layers.
- Existing focused test: `apps/backend/tests/services/PaperlessService.test.ts:1-62` verifies configured timeout abort behavior.

### `ProcessingPipeline.ts`

- File size: `apps/backend/src/agents/ProcessingPipeline.ts` is 1420 lines.
- Public API surface is in one file and must remain stable:
  - `ProcessingState`: `ProcessingPipeline.ts:31`
  - `PipelineInput`, `PipelineStepResult`, `PipelineResult`, `PipelineStreamEvent`: `ProcessingPipeline.ts:33-78`
  - cancellation/active-run types: `ActiveDocumentRunInfo`, `CancelRunResult`, internal `ActiveDocumentRun`: `ProcessingPipeline.ts:80-99`
  - `ProcessingPipelineService` interface and Effect tag: `ProcessingPipeline.ts:103-130`
  - helpers `event`, `toPipelineAgentEvent`, `parseStep`: `ProcessingPipeline.ts:133-173`
  - `ProcessingPipelineServiceLive`: `ProcessingPipeline.ts:175-1420`
- Clear internal split boundaries:
  1. **Public types/tag + stream event helpers**: `ProcessingPipeline.ts:31-173`.
  2. **Instrumentation/failure helpers**: `bestEffort`, `addProcessingLog`, `instrumentPhase`, `classifyFailure`, `metricPhase`, `metricMode`, `buildFailureDetail`, `recordStageFailure`: `ProcessingPipeline.ts:192-320`.
  3. **Settings/store snapshot helpers** for dry-run rollback and bool settings: `ProcessingPipeline.ts:322-411`.
  4. **Case patching + lock/active-run lifecycle**: `patchCase`, `acquireDocumentLock`, `heartbeatWatchdog`, `withDocumentLock`: `ProcessingPipeline.ts:413-633`.
  5. **Runtime pipeline config and tag cache inside pipeline**: `getPipelineConfig`, `tagMapRef`, `refreshTagMap`, `getTagNames`: `ProcessingPipeline.ts:635-683`.
  6. **Workflow state projection**: `getCasePhaseState`, `getCurrentState`, `workflowTagNames`, `transition`, `workflowTagForState`, `defaultCaseStateFor`, `projectWorkflowState`: `ProcessingPipeline.ts:685-819`.
  7. **Step implementations**: `indexDocument`, `processMetadata`, `processIndex`, `dryRunOcrPreview`: `ProcessingPipeline.ts:821-984`.
  8. **Service methods**: active-run lookup/cancel, `processDocument`, `processStep`, stream wrappers: `ProcessingPipeline.ts:986-1418`.
- Important post-change behavior to preserve:
  - Active-run registry is local to `ProcessingPipelineServiceLive`: `const activeRuns = Ref.make(new Map<number, ActiveDocumentRun>())` (`ProcessingPipeline.ts:190`). The registry stores the actual `Fiber.RuntimeFiber`, run metadata, and cancellation refs (`:80-99`, `:576-632`).
  - Cancellation must interrupt the running fiber, not just release locks: `cancelDocumentRun` sets refs and calls `Fiber.interrupt(activeRun.fiber)` (`ProcessingPipeline.ts:992-1025`).
  - No-active cancellation is diagnostic-only and must not release durable locks (`ProcessingPipeline.ts:996-1011`; tested).
  - `withDocumentLock` is the cleanup owner: on completion/error/cancel it removes active run, releases lock, clears `documentCases.activeRunId`, records `run_cancelled`/`lock_released` logs (`ProcessingPipeline.ts:511-633`). Do not split this across HTTP/API layers.
  - Metrics are side effects via `metrics`/`observeDuration` imported from services barrel (`ProcessingPipeline.ts:16-18`). `instrumentPhase` and `recordStageFailure` are the important metric touchpoints (`ProcessingPipeline.ts:206-239`, `:287-320`). Keep label cardinality bounded.
  - Pipeline still has a **local tag map** (`tagMapRef`) refreshed from `paperless.getTags()` (`ProcessingPipeline.ts:668-683`, `:754`). This is separate from the new server `TagCacheService`; do not silently replace it unless the worker intentionally validates behavior and layer dependencies.
  - Case state is authoritative over Paperless tags in `getCurrentState` (`ProcessingPipeline.ts:685-731`), and tests assert this.
  - Dry-run rollback uses raw TinyBase store snapshots (`ProcessingPipeline.ts:347-411`). This depends on `TinyBaseService.store` and direct table names; preserve exact behavior.
- Direct imports/users:
  - `apps/backend/src/agents/index.ts:87-96` re-exports all public pipeline types/tag/live layer.
  - `apps/backend/src/layers/index.ts:93-100` provides `ProcessingPipelineServiceLive` with `AgentsLayer` and `LockServiceLive`.
  - Runtime callers: `server.ts`, `AutoProcessingService.ts`, `api/processing/handlers.ts`, `api/pending/handlers.ts`, `api/cases/handlers.ts`.
  - Tests import direct from `../../src/agents/ProcessingPipeline.js`.

### Adjacent post-change context that affects the split

- `TagCacheService` is new and used by SSE full-pipeline code, not by `ProcessingPipelineServiceLive`:
  - service interface/live layer: `apps/backend/src/services/TagCacheService.ts:1-112`
  - app layer provides it after Paperless/Qdrant core services: `apps/backend/src/layers/index.ts:70-71`
  - server SSE loads it with `PaperlessService`, `ProcessingPipelineService`, and `ConfigService`: `apps/backend/src/server.ts:520-566`
  - SSE refreshes cached tags between full-pipeline steps: `server.ts:672-682`.
- `pipeline.maxSteps` already exists after prior W4-S18 work:
  - schema: `apps/backend/src/config/schema.ts:68-78`
  - default and safety comment: `apps/backend/src/config/index.ts:64-75`
  - YAML alias: `apps/backend/src/config/yaml-loader.ts:106`
  - server full-pipeline loop reads `configService.config.pipeline.maxSteps`: `server.ts:564`, loop bound at `server.ts:638-646`.
- Metrics registry is global/static, not an Effect service:
  - `apps/backend/src/services/MetricsService.ts:55-219`
  - services barrel re-exports it: `apps/backend/src/services/index.ts:34-39`
  - `/metrics` endpoint and request instrumentation live in `server.ts:818-821`, `server.ts:789-790`.
- Cancellation API mapping lives outside the pipeline:
  - `apps/backend/src/api/processing/handlers.ts:34-65` maps `cancelDocumentRun` results.
  - Tests in `apps/backend/tests/api/processing.test.ts:81-147` assert `cancelling`, `no_active_run`, and `run_mismatch` response shapes.

## Staged safe implementation plan

### Stage 0 — guardrails before editing

1. Confirm no pending uncommitted work belongs to another task before large mechanical moves. Current worktree is heavily modified/untracked; avoid sweeping formatting or unrelated edits.
2. Treat this as a refactor only: no public API changes, no behavior changes, no route/config changes.
3. Keep compatibility facade files:
   - `apps/backend/src/services/PaperlessService.ts` should continue exporting `PaperlessService`, `PaperlessServiceLive`, and public Paperless version types.
   - `apps/backend/src/agents/ProcessingPipeline.ts` should continue exporting all public pipeline types, `ProcessingPipelineService`, and `ProcessingPipelineServiceLive`.

### Stage 1 — split `PaperlessService.ts` first (lower behavioral risk)

Suggested files under `apps/backend/src/services/paperless/`:

- `types.ts`: `PaperlessErrorType` if exported internally, `PaperlessApiVersionInfo`, `PaperlessDocumentVersion`, `PaperlessVersionUploadResult`, `PaginatedResponse`, `PaperlessDocumentWithVersions`.
- `url.ts`: `normalizePaperlessUrl`, `normalizeConfiguredPaperlessUrl`, `ALLOWED_PAPERLESS_HOSTS`.
- `versions.ts`: `normalizeVersion`, `versionSortKey`.
- `client.ts`: create a small internal client factory that receives `getConfig` and `requestTimeoutMs`, and returns `{ request, binaryRequest, multipartRequest, mapNotFound }`.
- `lookups.ts` or keep in live file: `getTagId`, `getCorrespondentId`, `getDocumentTypeId`, `fetchAllDocuments` can be helper factories over `request/mapNotFound`.

Safe boundary: build the same service object in `PaperlessServiceLive`; only move helpers. Avoid over-abstracting methods into many factories unless typecheck stays simple.

Must preserve:

- dynamic `TinyBaseService.getAllSettings()` fallback on every request;
- URL validation and `PAPERLESS_ALLOWED_HOSTS` behavior;
- `fetchWithTimeout` use and request headers;
- queue stats alias/coarse-tag logic;
- direct import path `./PaperlessService.js` for callers.

### Stage 2 — split `ProcessingPipeline.ts` without moving ownership

Suggested files under `apps/backend/src/agents/processingPipeline/`:

- `types.ts`: public `ProcessingState`, pipeline input/result/event types, active-run/cancel types, and possibly the service interface type. Re-export from facade.
- `events.ts`: `event`, `toPipelineAgentEvent`.
- `steps.ts` or `parse.ts`: `parseStep`.
- `metrics.ts`: `instrumentPhase`, `metricPhase`, `metricMode`, `classifyFailure`, `buildFailureDetail`. Keep `recordStageFailure` near live layer if it needs `patchCase/addProcessingLog`, or make a factory taking dependencies.
- `caseSnapshot.ts`: `getBoolSetting`, `getAnyBoolSetting`, raw-store snapshot/restore helpers.
- `workflowState.ts`: pure `workflowTagForState`, `defaultCaseStateFor`, and ideally pure `stateFromTagNames`. Keep impure `getCasePhaseState`, `transition`, `projectWorkflowState` in live/factory if that avoids dependency churn.
- `lockLifecycle.ts`: only if done carefully: a factory for `withDocumentLock` over `locks`, `cases`, `activeRuns`, `addProcessingLog`, `recordStageFailure`, `patchCase`. This is the highest-risk extraction because cancellation correctness lives here.
- `pipelineSteps.ts`: factories for `indexDocument`, `processMetadata`, `processIndex`, `dryRunOcrPreview` over dependencies.

Recommended order:

1. Move type/event/parse/pure workflow helpers first.
2. Move metrics helpers that do not own cleanup.
3. Move case snapshot helpers.
4. Only then consider extracting lock lifecycle and step factories. If type churn is high, leave lock lifecycle in facade for this todo and still achieve a smaller, reviewable file via low-risk extractions.

Must preserve:

- active-run registry remains inside `ProcessingPipelineServiceLive` and is not recreated per method call;
- `cancelDocumentRun` interrupts `activeRun.fiber`;
- `withDocumentLock` still owns acquisition, active-run registration, heartbeat race, release, active-case cleanup, and cancellation logging;
- all TinyBase processing log event shapes;
- dry-run snapshot restoration;
- `getCurrentState` prioritizes document case phase over tags;
- pipeline metrics are emitted in the same success/failure paths.

### Stage 3 — optional cleanup only if safe

- If shared workflow/tag state utility from earlier W4-S18 is not yet extracted in the worker’s branch, do not combine it with this large split unless tests are added. Server still has inline `getNextStepForState`/`getStateFromTags` (`server.ts:568-621`) while pipeline has its own richer state logic (`ProcessingPipeline.ts:685-731`). This task is specifically the Paperless/Pipeline split handoff; behavior-preserving extraction is safer than semantic unification.
- Do not replace pipeline’s local `tagMapRef` with `TagCacheService` in the same worker unless explicitly approved; doing so changes layer dependencies and stale-cache behavior.

## Boundaries / non-goals

- Do not reintroduce prompt-file or `PromptService` paths.
- Do not rename public service tags or interfaces.
- Do not change API response shapes, especially processing cancellation responses.
- Do not move cancellation ownership into HTTP handlers or `LockService`.
- Do not change queue-count semantics, alias handling, or Paperless URL validation.
- Do not enforce TinyBase `storeSchema` or hide `TinyBaseService.store` as part of this split.
- Do not resurrect deleted legacy graph files.

## Implementation risks

- **Import cycles**: `ProcessingPipeline.ts` imports from `../services/index.js`, while services import the pipeline in some places. Prefer leaf helper modules that import only types or direct services minimally. Avoid helper modules under `services/` importing agents.
- **Effect type widening**: moving helpers can expose environment/error types. Keep helper factories generic or keep impure helpers local if type signatures become noisy.
- **Cancellation regression**: extracting `withDocumentLock` incorrectly can register the active run too late, fail to remove it, double-release locks, or convert fiber interruption into normal success/failure.
- **Metrics regression**: moving `instrumentPhase`/`recordStageFailure` can drop increments on error paths or increase label cardinality.
- **Tag cache confusion**: server uses `TagCacheService`; pipeline uses a local map. They are intentionally separate in current code.
- **Queue stats regression**: Paperless queue counts contain nuanced compatibility branches; move mechanically and test.

## Tests / validation plan

Targeted tests after the split:

```bash
pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts
pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts
pnpm --filter @repo/backend test -- tests/api/processing.test.ts tests/server.test.ts
pnpm --filter @repo/backend test -- tests/services/TagCacheService.test.ts tests/services/MetricsService.test.ts
pnpm --filter @repo/backend typecheck
```

Broader final checks if time allows:

```bash
pnpm --filter @repo/backend test -- PaperlessService ProcessingPipeline processing server TagCacheService MetricsService
pnpm run lint
```

Specific assertions to watch:

- Paperless timeout test still fails hanging fetch within configured timeout.
- Pipeline state test still returns case phase as authoritative (`index` over `llm-ocr`).
- Qdrant failure and OCR failure tests still update Paperless workflow tags and record processing logs.
- Timeout failure still records `kind: "timeout", retryable: true` and increments pipeline error metrics.
- Cancellation tests still interrupt the active fiber and emit `run_cancelled` + `lock_released` logs.
- API cancellation mapping still returns `run_id`, `lock_run_id`, `active_run_id` fields as currently tested.
- Server SSE full pipeline still uses `pipeline.maxSteps` and `TagCacheService`.

## Final worker prompt

Implement Todo #36 / W4-S18 as a behavior-preserving split of `apps/backend/src/services/PaperlessService.ts` and `apps/backend/src/agents/ProcessingPipeline.ts`. Keep both original files as compatibility facades exporting the same public types, Effect tags, and live layers. For `PaperlessService`, extract internal Paperless helper modules for public/version types, URL normalization, version helpers, and request/client primitives while preserving dynamic TinyBase settings lookup, URL safety checks, timeout behavior, headers, and queue-count alias semantics. For `ProcessingPipeline`, extract low-risk helper modules for types/events/parse, metrics/failure classification, case snapshot helpers, and pure workflow-state helpers; only extract lock lifecycle or step factories if you can keep cancellation/cleanup ownership identical. Do not move cancellation to HTTP/LockService, do not replace the pipeline local tag map with `TagCacheService`, and do not change API/config behavior. Validate with PaperlessService, ProcessingPipeline, processing API, server, TagCacheService, MetricsService targeted tests plus backend typecheck; run lint if feasible. Stop and ask before any behavior change, layer dependency change, public API rename, or cancellation/tag-cache semantic change.
