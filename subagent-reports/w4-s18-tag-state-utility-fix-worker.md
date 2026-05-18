# W4-S18 Tag-State Utility Fix Worker Report

## Summary
Implemented the configured-only workflow tag cleanup fix for `ProcessingPipeline` while preserving broad `llm-*` classification for Pi agent guardrails.

## Changes
- Added `isConfiguredWorkflowTagName` in `apps/backend/src/utils/tagState.ts`.
- Updated `ProcessingPipeline` transitions to remove only configured workflow tag IDs, not every normalized `llm-*` tag.
- Kept `isWorkflowTagName` behavior unchanged for broad `llm-*` classification used by Pi agent/catalog guardrails.
- Extended tag-state utility tests to distinguish configured-only vs broad workflow classification.
- Added a ProcessingPipeline regression test proving an unrelated `llm-custom` tag remains when transitioning from `llm-index` to `llm-ocr` and then to `llm-failed`.

## Validation
Passed:
- `pnpm --filter @repo/backend test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts`
- `pnpm --filter @repo/backend test -- tests/server.test.ts tests/agents/PiDocumentAgent.test.ts tests/agents/PiConsolidationAgent.test.ts tests/agents/PiTagExplorerAgent.test.ts`
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`

## Notes / Risks
- `/mnt/storage/workspace/projects/paperless_local_llm/context.md` and `plan.md` were not present, so the task was implemented from the provided issue/scope and current code.
- The working tree contains many pre-existing unrelated modifications/untracked files; this report only covers the files changed for this task.
