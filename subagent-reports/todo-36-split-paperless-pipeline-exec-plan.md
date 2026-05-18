# Implementation Plan

## Goal
Create a first, low-risk behavior-preserving extraction for Todo #36 that reduces `PaperlessService.ts` and `ProcessingPipeline.ts` without touching cancellation ownership, tag-state semantics, API behavior, or layer wiring.

## Tasks
1. **Preflight after cancellation/tag-state work lands**: Confirm the current branch includes the latest cancellation and tag-state changes, then inspect for local edits in `PaperlessService.ts` and `ProcessingPipeline.ts` before moving code.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - File: `apps/backend/src/agents/ProcessingPipeline.ts`
   - Changes: No code changes in this step; verify the worker starts from the post-cancellation/tag-state state and does not overwrite unrelated work.
   - Acceptance: Worker can state which commits/branch state it used; no unrelated formatting or semantic edits are included.

2. **Extract Paperless public/internal type aliases first**: Move only static type declarations that do not execute code.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - New file: `apps/backend/src/services/paperless/types.ts`
   - Changes: Move `PaperlessErrorType`, `PaperlessApiVersionInfo`, `PaperlessDocumentVersion`, `PaperlessVersionUploadResult`, `PaginatedResponse`, and `PaperlessDocumentWithVersions` into `types.ts`; re-export the public version types from `PaperlessService.ts`; import internal aliases back into the facade/live implementation as needed.
   - Acceptance: Existing direct imports from `../services/PaperlessService.js` and barrel imports still compile with no call-site changes.

3. **Extract Paperless URL normalization as the safe first behavior-bearing slice**: Move URL validation without changing logic.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - New file: `apps/backend/src/services/paperless/url.ts`
   - Changes: Move `ALLOWED_PAPERLESS_HOSTS`, `normalizePaperlessUrl`, and any small wrapper such as `normalizeConfiguredPaperlessUrl` if present/needed. Preserve accepted protocols, credential rejection, host allow-list behavior, trailing slash normalization, and `PaperlessError` construction.
   - Acceptance: `PaperlessService.test.ts` and backend typecheck pass; no changes to config reads or request construction.

4. **Extract Paperless version helpers**: Move pure version normalization/sorting helpers.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - New file: `apps/backend/src/services/paperless/versions.ts`
   - Changes: Move `normalizeVersion` and `versionSortKey`; import them into `PaperlessService.ts` for document-version methods.
   - Acceptance: Version methods compile and preserve ordering/normalization behavior; no API changes.

5. **Stop Paperless extraction before client/queue methods unless the first three tasks are clean**: Do not extract `request`, `binaryRequest`, `multipartRequest`, `getConfig`, lookup helpers, or queue/count logic in this first slice unless typecheck and targeted tests are already green.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - Changes: Leave dynamic TinyBase settings lookup, fetch timeout logic, headers, multipart behavior, and queue stats in the facade/live file for this first pass.
   - Acceptance: Diff is mostly moves/imports; no queue/count, auth/header, or settings behavior changes.

6. **Extract ProcessingPipeline public types/events/parse only after current cancellation/tag-state work is stable**: Move declarations and small pure helpers, not lifecycle or tag-map logic.
   - File: `apps/backend/src/agents/ProcessingPipeline.ts`
   - New file: `apps/backend/src/agents/processingPipeline/types.ts`
   - New file: `apps/backend/src/agents/processingPipeline/events.ts`
   - New file: `apps/backend/src/agents/processingPipeline/parse.ts`
   - Changes: Move `ProcessingState`, `PipelineInput`, `PipelineStepResult`, `PipelineResult`, `PipelineStreamEvent`, `ActiveDocumentRunInfo`, `CancelRunResult`, `ProcessingPipelineService` interface, `event`, `toPipelineAgentEvent`, and `parseStep`. Keep `ActiveDocumentRun` in `ProcessingPipeline.ts` unless moving it is required only as a non-exported type import.
   - Acceptance: `apps/backend/src/agents/index.ts` re-exports still work; tests importing `../../src/agents/ProcessingPipeline.js` still compile; no active-run, cancellation, lock, workflow tag, or case-state code is moved.

7. **Keep the compatibility facades unchanged from callers' perspective**: Re-export the same public symbols from original files.
   - File: `apps/backend/src/services/PaperlessService.ts`
   - File: `apps/backend/src/agents/ProcessingPipeline.ts`
   - Changes: Ensure both original files still export the same public interfaces, types, Effect tags, and live layers. Do not require caller import-path changes.
   - Acceptance: Grep-confirmed direct callers of `PaperlessService.js` and `ProcessingPipeline.js` need no edits.

8. **Run narrow validation immediately after the extraction slice**: Validate only the affected behavior and type surface.
   - File: `apps/backend/tests/services/PaperlessService.test.ts`
   - File: `apps/backend/tests/agents/ProcessingPipeline.test.ts`
   - File: `apps/backend/tests/api/processing.test.ts`
   - Changes: No test changes expected; run existing tests.
   - Acceptance: Commands pass:
     - `pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts`
     - `pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts`
     - `pnpm --filter @repo/backend test -- tests/api/processing.test.ts`
     - `pnpm --filter @repo/backend typecheck`

9. **Only if validation is green, optionally run broader checks**: Catch import-cycle or barrel export regressions.
   - File: project root scripts/config
   - Changes: No code changes.
   - Acceptance: Run `pnpm --filter @repo/backend test -- tests/server.test.ts tests/services/TagCacheService.test.ts tests/services/MetricsService.test.ts`; run `pnpm run lint` if feasible.

## Files to Modify
- `apps/backend/src/services/PaperlessService.ts` - keep as compatibility facade/live implementation; remove moved type/url/version helper definitions and import/re-export them.
- `apps/backend/src/agents/ProcessingPipeline.ts` - keep as compatibility facade/live implementation; remove moved public type/event/parse helper definitions and import/re-export them.
- `apps/backend/src/agents/index.ts` - modify only if re-export paths need adjustment, but prefer leaving it exporting from `./ProcessingPipeline.js` unchanged.

## New Files
- `apps/backend/src/services/paperless/types.ts` - Paperless public version types plus internal pagination/document-version aliases.
- `apps/backend/src/services/paperless/url.ts` - URL normalization and host allow-list validation.
- `apps/backend/src/services/paperless/versions.ts` - pure version normalization/sort helpers.
- `apps/backend/src/agents/processingPipeline/types.ts` - processing pipeline public types and service interface type.
- `apps/backend/src/agents/processingPipeline/events.ts` - stream event construction and Pi agent event mapping.
- `apps/backend/src/agents/processingPipeline/parse.ts` - step-name validation helper.

## Dependencies
- Task 1 must happen after the cancellation/tag-state work is merged or otherwise frozen.
- Tasks 2-4 can be done before any ProcessingPipeline extraction and are the safest first slice.
- Task 5 is a hard stop condition for this narrow plan unless the worker explicitly gets approval to expand scope.
- Task 6 depends on no active edits to ProcessingPipeline cancellation, active-run, workflow tag-state, or case-state code.
- Tasks 8-9 depend on all extraction tasks compiling.

## Risks
- `context.md` requested by the task was not present at `/mnt/storage/workspace/projects/paperless_local_llm/context.md`; this plan relies on the provided handoff and current source inspection.
- ProcessingPipeline has recent cancellation/tag-state churn; extracting anything beyond types/events/parse is likely to conflict with active-run, lock cleanup, workflow-state projection, or local tag-map changes.
- Moving `ProcessingPipelineService` into a helper module can create import-cycle pressure if that module imports runtime services; keep `types.ts` type-only except for `Context` and model/error type imports.
- Do not move `activeRuns`, `ActiveDocumentRun`, `cancelDocumentRun`, `withDocumentLock`, `heartbeatWatchdog`, `getPipelineConfig`, `tagMapRef`, `refreshTagMap`, `getCurrentState`, `transition`, or `projectWorkflowState` in this first slice.
- Paperless URL extraction must preserve `PAPERLESS_ALLOWED_HOSTS`, credential rejection, and protocol restrictions exactly.
- Paperless request/client extraction is deliberately deferred because it risks changing dynamic TinyBase settings fallback, timeout behavior, and headers.
- Queue stats/count logic is deliberately untouched because compatibility aliases and coarse-tag handling are high-risk.

## Final Worker Prompt
Implement the narrow first extraction slice for Todo #36 after the current cancellation/tag-state work is merged or frozen. Do not change behavior or public imports. First extract Paperless static types to `apps/backend/src/services/paperless/types.ts`, URL normalization to `apps/backend/src/services/paperless/url.ts`, and pure version helpers to `apps/backend/src/services/paperless/versions.ts`, while keeping `apps/backend/src/services/PaperlessService.ts` as the same public facade and live layer. Then extract only ProcessingPipeline public types, stream event helpers, and `parseStep` to `apps/backend/src/agents/processingPipeline/types.ts`, `events.ts`, and `parse.ts`, while keeping `apps/backend/src/agents/ProcessingPipeline.ts` as the public facade/live layer. Do not move or modify cancellation, active-run registry, lock lifecycle, tag-map/cache behavior, workflow state projection, queue stats, request/client config, API responses, or layer wiring. Validate with `PaperlessService.test.ts`, `ProcessingPipeline.test.ts`, `api/processing.test.ts`, and backend typecheck; run broader server/TagCache/Metrics tests and lint if feasible. Stop and ask before any public API rename, layer dependency change, cancellation semantic change, tag-state/tag-cache semantic change, or request/queue behavior change.
