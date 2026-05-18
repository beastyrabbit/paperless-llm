# Todo #36 / W4-S18 handoff: split `PaperlessService.ts` and `ProcessingPipeline.ts`

Scope: inspect files/imports/tests and prepare an implementation-ready, safe staged plan. No production/test code was edited.

## Current state and high-value evidence

### `apps/backend/src/services/PaperlessService.ts` (1,218 lines)
- Public contract and tag are defined at the top:
  - Interface spans `PaperlessService.ts:58-193` and includes document, version-aware document, tag, correspondent, document-type, custom-field, note, queue, and connection operations.
  - Context tag: `PaperlessService.ts:202`.
- Private shared types/helpers:
  - `PaginatedResponse<T>`: `PaperlessService.ts:208-213`.
  - Version normalization helpers: `normalizeVersion`/`versionSortKey`: `PaperlessService.ts:219-231`.
  - Paperless URL allowlist/normalization: `PaperlessService.ts:233-260`.
- Live layer starts at `PaperlessService.ts:265`; it depends on `ConfigService` and `TinyBaseService` only.
- Shared request/config helpers are currently nested inside the live layer:
  - Dynamic settings-backed config read: `getConfig` at `PaperlessService.ts:273-296`.
  - JSON request helper with `Accept: application/json; version=10`: `PaperlessService.ts:300-372`.
  - Binary request helper: `PaperlessService.ts:374-442`.
  - Multipart request helper: `PaperlessService.ts:444-488`.
  - `mapNotFound`, `getTagId`, `getCorrespondentId`, `getDocumentTypeId`, pagination helper `fetchAllDocuments`: `PaperlessService.ts:490-542`.
- Implementation naturally groups by existing comments:
  - Document + version operations: `PaperlessService.ts:547-737`.
  - Tag operations: `PaperlessService.ts:742-874`.
  - Correspondent operations: `PaperlessService.ts:879-942`.
  - Document type operations: `PaperlessService.ts:947-1010`.
  - Custom field operations: `PaperlessService.ts:1015-1027`.
  - Note operations: `PaperlessService.ts:1032-1041`.
  - Queue/count/test operations: `PaperlessService.ts:1046-1215`.
- Import/export compatibility matters:
  - Barrel export: `apps/backend/src/services/index.ts:42-45` exports `PaperlessService` and `PaperlessServiceLive` from `./PaperlessService.js`.
  - Many callers import through the barrel, but some directly import `../services/PaperlessService.js` or `../../src/services/PaperlessService.js` (tests and agents). Keep this path as the facade.

### Paperless callers/import graph
- `PaperlessService` is used by jobs, agents, services, and API handlers. Method usage is broad, so preserve the interface and runtime behavior.
- Notable direct imports:
  - `apps/backend/src/agents/PiConsolidationAgent.ts` imports from `../services/PaperlessService.js`.
  - `apps/backend/src/api/search/handlers.ts` imports from `../../services/PaperlessService.js`.
  - `apps/backend/tests/services/PaperlessService.test.ts` imports `PaperlessService, PaperlessServiceLive` from `../../src/services/PaperlessService.js`.
- Layer composition relies on `PaperlessServiceLive` depending on `ConfigService + TinyBaseService`:
  - `apps/backend/src/layers/index.ts:43-65` says Paperless is not in `ExternalServicesLayer` because it depends on TinyBase; `CoreServicesBaseLayer` provides `PaperlessServiceLive` with TinyBase/base services.

### `apps/backend/src/agents/ProcessingPipeline.ts` (1,244 lines)
- Public contract and tag:
  - Types `ProcessingState`, `PipelineInput`, `PipelineStepResult`, `PipelineResult`, `PipelineStreamEvent`, and interface `ProcessingPipelineService`: `ProcessingPipeline.ts:24-96`.
  - Context tag: `ProcessingPipeline.ts:98-100`.
- Pure/top-level helpers already separate from the live closure:
  - `event`: `ProcessingPipeline.ts:102-105`.
  - `toPipelineAgentEvent`: `ProcessingPipeline.ts:107-128`.
  - `parseStep`: `ProcessingPipeline.ts:131-142`.
- Live layer starts at `ProcessingPipeline.ts:144`; dependencies are loaded at `ProcessingPipeline.ts:147-154`: `ConfigService`, `PaperlessService`, `TinyBaseService`, `LockService`, `DocumentCaseService`, `QdrantService`, `OCRAgentService`, `PiDocumentAgentService`.
- Internal responsibilities are currently mixed in one closure:
  - Best-effort logging/error classification/failure recording: `ProcessingPipeline.ts:160-242`.
  - Settings bool helpers: `ProcessingPipeline.ts:244-266`.
  - Dry-run TinyBase case snapshot/restore: `ProcessingPipeline.ts:268-339`.
  - Case patching + lock acquisition/heartbeat/release wrapper: `ProcessingPipeline.ts:341-516`.
  - Runtime pipeline config from settings/defaults: `ProcessingPipeline.ts:518-546`.
  - Tag map/current state/workflow transition/projection: `ProcessingPipeline.ts:548-703`.
  - Qdrant indexing step: `ProcessingPipeline.ts:705-783`.
  - Metadata step wrapper: `ProcessingPipeline.ts:785-824`.
  - Index step wrapper: `ProcessingPipeline.ts:827-839`.
  - Dry-run OCR preview: `ProcessingPipeline.ts:841-862`.
  - Service methods/orchestration and streams: `ProcessingPipeline.ts:865-1241`.
- Key behavior to preserve:
  - Case phase is authoritative over tag-derived state (`getCasePhaseState` then `getCurrentState` at `ProcessingPipeline.ts:564-610`).
  - Workflow state updates patch cases and project tags unless dry-run (`projectWorkflowState` at `ProcessingPipeline.ts:679-703`).
  - Lock lifecycle records processing logs, keeps heartbeat, records failures, releases locks, and clears active run (`ProcessingPipeline.ts:341-516`).
  - Dry-run paths wrap effects in `withCaseSnapshot` so TinyBase case rows are restored (`ProcessingPipeline.ts:328-339`, used at `ProcessingPipeline.ts:1046` and `ProcessingPipeline.ts:1138`).
  - Stream wrappers emit pipeline/step events and pass Pi document-agent events through `toPipelineAgentEvent` (`ProcessingPipeline.ts:1139-1239`).

### ProcessingPipeline callers/import graph
- Barrel export: `apps/backend/src/agents/index.ts:86-95` exports all pipeline types/tag/live from `./ProcessingPipeline.js`.
- Direct imports used by API/services/tests:
  - `apps/backend/src/services/AutoProcessingService.ts` imports `ProcessingPipelineService` from `../agents/ProcessingPipeline.js`.
  - `apps/backend/src/api/cases/handlers.ts`, `api/processing/handlers.ts`, `api/pending/handlers.ts` import it directly.
  - `apps/backend/tests/agents/ProcessingPipeline.test.ts` imports `ProcessingPipelineService, ProcessingPipelineServiceLive` from `../../src/agents/ProcessingPipeline.js`.
- App layer relies on `ProcessingPipelineServiceLive` being provided after agents and lock service:
  - `apps/backend/src/layers/index.ts:90-98` builds `PipelineLayer = Layer.provideMerge(ProcessingPipelineServiceLive, Layer.mergeAll(AgentsLayer, LockServiceLive))`.

### Existing tests relevant to safe split
- `apps/backend/tests/services/PaperlessService.test.ts` currently covers configured HTTP timeout on `getTags()` using `PaperlessServiceLive` and mocked `fetch`.
- `apps/backend/tests/agents/ProcessingPipeline.test.ts` covers:
  - Case phase is authoritative (`getCurrentState` returns `index` even when tags say OCR): around `ProcessingPipeline.test.ts:233-284`.
  - Index step failure when Qdrant upsert fails; verifies updateDocument transitions and processing log: `ProcessingPipeline.test.ts:286-331`.
  - OCR failure transitions to failed and logs stage failure: `ProcessingPipeline.test.ts:333-385`.
  - Timeout failures classified as retryable and recorded on case/logs: `ProcessingPipeline.test.ts:387-446`.
  - Unknown step rejected: `ProcessingPipeline.test.ts:448-481`.
- Useful validation commands:
  - Targeted: `pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts tests/agents/ProcessingPipeline.test.ts`
  - Backend typecheck: `pnpm --filter @repo/backend typecheck`
  - Backend lint: `pnpm --filter @repo/backend lint`
  - Broader backend tests if time: `pnpm --filter @repo/backend test`

## Recommended split boundaries

### PaperlessService: clear staged boundary
Keep `apps/backend/src/services/PaperlessService.ts` as the public facade to avoid touching all callers. It should continue exporting `PaperlessService`, `PaperlessServiceLive`, and public Paperless types.

Suggested internal module layout:

```text
apps/backend/src/services/PaperlessService.ts          # facade: public types/interface/tag + re-export live
apps/backend/src/services/paperless/types.ts           # PaginatedResponse, version types if not kept in facade
apps/backend/src/services/paperless/url.ts             # ALLOWED_PAPERLESS_HOSTS, normalizePaperlessUrl, normalizeConfiguredPaperlessUrl
apps/backend/src/services/paperless/client.ts          # createPaperlessClient/getConfig/request/binary/multipart/mapNotFound
apps/backend/src/services/paperless/documentOps.ts     # getDocument(s), similar, tag filters, update, content, PDF/version ops
apps/backend/src/services/paperless/tagOps.ts          # getTags/getTag/getTagByName/getOrCreate/add/remove/transition/delete/rename/color/merge
apps/backend/src/services/paperless/catalogOps.ts      # correspondents, document types, custom fields
apps/backend/src/services/paperless/noteOps.ts         # addNote/getNotes
apps/backend/src/services/paperless/queueOps.ts        # getQueueStats/getTotalDocumentCount/testConnection
apps/backend/src/services/paperless/live.ts            # Layer.effect assembly returning full PaperlessService
```

Implementation notes:
- A shared `PaperlessClient` object should expose `request`, `binaryRequest`, `multipartRequest`, `mapNotFound`, `fetchAllDocuments`, and ID lookup helpers. Keep request helpers backed by dynamic TinyBase settings (`getAllSettings`) to preserve runtime config changes.
- `queueOps` needs access to `tagConfig` plus `getTagId` and `request`; do not duplicate counting logic unless tests are expanded.
- `tagOps.transitionDocumentTag` currently ignores `_fromTagName` and removes all `llm-` prefixed tags except the target (`PaperlessService.ts:784-830`). Preserve that behavior exactly; other agents/jobs depend on it.
- Avoid changing public import paths. If the interface/types move to `paperless/types.ts`, re-export them from `PaperlessService.ts`; direct imports must continue to work.

### ProcessingPipeline: clear staged boundary
Keep `apps/backend/src/agents/ProcessingPipeline.ts` as the public facade to avoid touching API/service/test imports. It should continue exporting all public types, tag, and `ProcessingPipelineServiceLive`.

Suggested internal module layout:

```text
apps/backend/src/agents/ProcessingPipeline.ts                  # facade: public types/tag + live assembly
apps/backend/src/agents/processingPipeline/events.ts           # event(), toPipelineAgentEvent()
apps/backend/src/agents/processingPipeline/steps.ts            # parseStep type guard; maybe dryRunOcrPreview
apps/backend/src/agents/processingPipeline/failures.ts         # errorMessage, classifyFailure, buildFailureDetail
apps/backend/src/agents/processingPipeline/settings.ts         # getBoolSetting, getAnyBoolSetting, getPipelineConfig factory
apps/backend/src/agents/processingPipeline/caseSnapshot.ts     # snapshotCaseRows/restoreCaseRows/withCaseSnapshot
apps/backend/src/agents/processingPipeline/runCoordinator.ts   # patchCase, recordStageFailure, lock/heartbeat/withDocumentLock helpers
apps/backend/src/agents/processingPipeline/workflowState.ts    # tagMap refresh, getCurrentState, transition, workflowTagForState, projectWorkflowState
apps/backend/src/agents/processingPipeline/indexing.ts         # indexDocument/processIndex
apps/backend/src/agents/processingPipeline/metadata.ts         # processMetadata wrapper
apps/backend/src/agents/processingPipeline/live.ts             # create service object and wire processDocument/processStep/stream wrappers
```

Implementation notes:
- There is a natural dependency direction: public facade -> live assembly -> helper factories. Helper modules should import only types/services they need; avoid importing from the facade if it creates cycles. Prefer `import type` for `PipelineStreamEvent`, `ProcessingState`, etc., if public types remain in the facade.
- `workflowState` should own `tagMapRef`, `refreshTagMap`, `getCurrentState`, `transition`, and `projectWorkflowState`. This keeps tag/case state rules together.
- `runCoordinator` should own lock acquisition, heartbeat, release, active-run cleanup, best-effort logs, and failure recording; this keeps durable run lifecycle isolated from step business logic.
- `indexing` should own Qdrant-specific metadata gathering and dry-run index preview. It needs `paperless`, `qdrant`, `tinybase`, `getAnyBoolSetting`, `addProcessingLog`, `recordStageFailure`, and `projectWorkflowState`.
- `metadata` should own only the Pi document-agent wrapper and state projection around review/success/failure. Keep Pi agent event conversion in `events.ts`.
- Service method orchestration (`processDocument`, `processStep`, stream methods) can remain in the facade/live assembly initially; extract it only after helpers are stable.

## Safe staged plan

1. **Baseline validation before refactor**
   - Run targeted tests for the two files.
   - Run backend typecheck.
   - Capture any pre-existing failures before changing code.

2. **Paperless stage 1: pure/shared helpers**
   - Extract URL normalization and version normalization helpers first.
   - Keep `PaperlessService.ts` facade exports stable.
   - Run `PaperlessService.test.ts` and typecheck.

3. **Paperless stage 2: client factory**
   - Extract dynamic config + request helpers into `services/paperless/client.ts`.
   - Confirm HTTP headers/status handling/timeout behavior are unchanged.
   - Run `PaperlessService.test.ts`.

4. **Paperless stage 3: operation groups**
   - Move operations group-by-group: document/version, tag, catalog, note, queue.
   - After each group, reassemble object in `paperless/live.ts` and keep the public `PaperlessServiceLive` export intact.
   - Run backend typecheck after each group if possible.

5. **Pipeline stage 1: pure helpers**
   - Extract `event`, `toPipelineAgentEvent`, `parseStep`, bool settings, failure classifier, and dry-run OCR preview.
   - Run `ProcessingPipeline.test.ts` and typecheck.

6. **Pipeline stage 2: case snapshot and run coordinator**
   - Extract dry-run case snapshot and lock/run/failure lifecycle. Preserve best-effort behavior and all processing-log event shapes.
   - Run `ProcessingPipeline.test.ts`; pay special attention to timeout classification and OCR/index failure tests.

7. **Pipeline stage 3: workflow state projection**
   - Extract tag map refresh/current-state/tag projection into `workflowState.ts`.
   - Preserve case-authoritative state precedence and workflow tag cleanup semantics.
   - Run `ProcessingPipeline.test.ts`; the case-authoritative state and tag update assertions are the canaries.

8. **Pipeline stage 4: step handlers**
   - Extract indexing and metadata wrappers, then optionally OCR/processStep orchestration if still large.
   - Keep stream wrappers until the end because they couple service recursion and event emission.

9. **Final validation**
   - Run targeted tests, backend typecheck, backend lint.
   - If practical, run full backend test suite.

## Risks and constraints

- **Do not break public import paths.** Many files and tests import `PaperlessService.ts` and `ProcessingPipeline.ts` directly; keep them as facades.
- **Effect environment types can regress subtly.** Helper factories should accept concrete service instances/functions rather than returning effects with unexpected `R` requirements unless intentionally typed.
- **Layer dependency order is important.** `PaperlessServiceLive` still needs `ConfigService + TinyBaseService`; `ProcessingPipelineServiceLive` still needs all current dependencies. Do not alter `layers/index.ts` semantics unless necessary.
- **Dry-run semantics are fragile.** `withCaseSnapshot` restores TinyBase case rows after dry-run pipeline/step execution. Preserve this when moving code.
- **Failure/log shapes are asserted.** Tests assert `stage_failed`, `qdrant_index`, failure `kind/retryable`, tag updates, and updateCase payloads.
- **Workflow tag cleanup differs between PaperlessService and Pipeline.** Paperless `transitionDocumentTag` removes all `llm-` tags except target; pipeline `transition` removes configured workflow tags only. Preserve both behaviors.
- **ESM/NodeNext import extensions.** New local imports must use `.js` specifiers in TypeScript source, matching existing style.
- **No PromptService or prompt-file paths.** Project rule says Pi agent instructions/tools/schemas/placeholders stay TypeScript-defined; the split should not introduce prompt-file driven processing.

## Compact worker prompt

Goal: Refactor `apps/backend/src/services/PaperlessService.ts` and `apps/backend/src/agents/ProcessingPipeline.ts` into smaller internal modules while preserving public exports/import paths and behavior.

Evidence/context: Keep `PaperlessService.ts` and `ProcessingPipeline.ts` as facades because callers/tests import them directly. Paperless groups are document/version, tag, catalog, note, queue; shared dynamic config/request helpers must keep TinyBase-backed runtime settings, timeout, headers, NotFound mapping, and v10 accept header. Pipeline groups are events/step parsing, settings, failures, case snapshots, run/lock coordinator, workflow state projection, indexing, metadata, and service orchestration. Existing tests assert timeout handling, case-authoritative state, Qdrant/OCR failure transitions/logs, timeout classification, and unknown step rejection.

Success criteria: targeted tests pass, backend typecheck passes, public exports unchanged, layer dependencies unchanged, dry-run and lock/failure behavior preserved, no broad caller import churn.

Hard constraints: Use `.js` import specifiers. Do not introduce PromptService/prompt files. Do not change public service interfaces unless explicitly necessary and approved.

Validation: `pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts tests/agents/ProcessingPipeline.test.ts`; `pnpm --filter @repo/backend typecheck`; `pnpm --filter @repo/backend lint`; optionally full `pnpm --filter @repo/backend test`.
