# W4-S18 Todo #36 — Split PaperlessService / ProcessingPipeline Worker Report

## Summary
Implemented the narrow first extraction slice from the Todo #36 handoff. This was a behavior-preserving mechanical extraction only; both original facade files still expose the same public service types/tags/live layers and no caller import paths were changed.

## Changes

### PaperlessService split
- Added `apps/backend/src/services/paperless/types.ts`
  - `PaperlessErrorType`
  - `PaperlessApiVersionInfo`
  - `PaperlessDocumentVersion`
  - `PaperlessVersionUploadResult`
  - `PaginatedResponse`
  - `PaperlessDocumentWithVersions`
- Added `apps/backend/src/services/paperless/url.ts`
  - `ALLOWED_PAPERLESS_HOSTS`
  - `normalizePaperlessUrl`
  - `normalizeConfiguredPaperlessUrl`
- Added `apps/backend/src/services/paperless/versions.ts`
  - `normalizeVersion`
  - `versionSortKey`
- Updated `apps/backend/src/services/PaperlessService.ts` to import those helpers/types and re-export the public version types from the original facade path.

### ProcessingPipeline split
- Added `apps/backend/src/agents/processingPipeline/types.ts`
  - public pipeline input/result/event types
  - active-run/cancel public types
  - `ProcessingPipelineService` interface
  - `ProcessingState` type re-export from tag-state utilities
- Added `apps/backend/src/agents/processingPipeline/events.ts`
  - `event`
  - `toPipelineAgentEvent`
- Added `apps/backend/src/agents/processingPipeline/parse.ts`
  - `parseStep`
- Updated `apps/backend/src/agents/ProcessingPipeline.ts` to import/re-export those extracted pieces while keeping the local public `ProcessingPipelineService` interface declaration as a thin compatibility extension for TypeScript value/type merging with the existing Effect tag.

## Explicitly unchanged
- Paperless dynamic TinyBase settings fallback and ConfigService fallback per request.
- Paperless request, binary request, multipart request, timeout, auth/header behavior.
- Paperless queue-count/alias/coarse-tag logic.
- ProcessingPipeline active-run registry, cancellation, fiber interruption, lock lifecycle, heartbeat, and cleanup ownership.
- ProcessingPipeline local tag map, tag-state semantics, workflow projection, dry-run snapshots, API response shapes, and layer wiring.

## Validation
Passed:

```bash
pnpm --filter @repo/backend test -- tests/services/PaperlessService.test.ts
pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts
pnpm --filter @repo/backend test -- tests/api/processing.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

## Notes / risks
- The requested root `context.md` and `plan.md` files were not present, so I used the supplied exec plan and ready handoff files.
- The worktree was already heavily modified/untracked outside this task. I avoided touching unrelated files.
- The extraction intentionally stops before higher-risk client/queue/cancellation/tag-state split boundaries.
