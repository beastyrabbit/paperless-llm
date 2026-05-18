# W4-S18 tag-state utility worker handoff

## Implemented

- Added `apps/backend/src/utils/tagState.ts` as a pure shared utility for:
  - `ProcessingState` and `WorkflowTagsConfig` types.
  - Workflow tag normalization/classification (`trim().toLowerCase()`, `llm-*` prefix support).
  - Document tag-name resolution from `tag_names` or ID map.
  - Deterministic processing state mapping with priority: failed > done/processed > review/manual/schema review > coarse ocr/metadata/index => metadata > index/tagsDone > metadata aliases > ocr/ocrDone > todo/pending/default.
  - `getWorkflowTagForState` for pipeline transitions.
- Updated `ProcessingPipeline.ts` to:
  - Re-export `ProcessingState` from the utility to preserve the old import path.
  - Keep TinyBase case phase state as local/authoritative.
  - Delegate tag-only state detection to `getProcessingStateFromDocumentTags`.
  - Use shared workflow tag normalization/classification for cleanup.
  - Use shared `getWorkflowTagForState`.
- Updated `server.ts` full-pipeline SSE state detection to use `getProcessingStateFromDocumentTags` while preserving existing `TagCacheService` usage, cache refresh behavior, max-step config, and abort-safe SSE flow.
- Updated `PiDocumentAgent.ts` and `PiConsolidationAgent.ts` to remove duplicated workflow tag helper implementations and import the shared helpers.
- Added focused utility tests in `apps/backend/tests/utils/tagState.test.ts`.

## Changed files

- `apps/backend/src/utils/tagState.ts`
- `apps/backend/tests/utils/tagState.test.ts`
- `apps/backend/src/server.ts`
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/src/agents/PiConsolidationAgent.ts`
- `progress.md`

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts tests/agents/PiConsolidationAgent.test.ts tests/utils/tagState.test.ts
```

Result: 44 tests passed.

Partially passed / blocked:

```bash
pnpm --filter @repo/backend test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts tests/server.test.ts tests/services/TagCacheService.test.ts
```

Result: utility, TagCacheService, and ProcessingPipeline tests passed; `tests/server.test.ts` timed out on two existing SSE tests because runtime import `parseDocumentIdString` is missing from `@repo/api-contracts`.

```bash
pnpm --filter @repo/backend typecheck
```

Result: failed on existing unrelated errors around missing `@repo/api-contracts` exports and `DocumentAuthorizationService` typing.

```bash
cd apps/backend && pnpm exec biome lint src/utils/tagState.ts tests/utils/tagState.test.ts src/agents/ProcessingPipeline.ts src/server.ts src/agents/PiDocumentAgent.ts src/agents/PiConsolidationAgent.ts
```

Result: no errors for this extraction; command emitted existing info-level style diagnostics in broader files.

## Open risks / questions

- Server SSE targeted tests cannot currently complete until the unrelated `@repo/api-contracts` `parseDocumentIdString` export issue is resolved.
- Backend typecheck is blocked by unrelated existing workspace errors.
- Workflow tag filtering now consistently normalizes configured/candidate workflow tag names with `trim().toLowerCase()`, matching the safer PiConsolidationAgent behavior from the handoff.

## Recommended next step

Fix the existing `@repo/api-contracts`/typecheck blockers, then rerun backend typecheck and the targeted server SSE tests.
