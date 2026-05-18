# W4-S18 Stub/Orphan Agent Cleanup Handoff

## Summary
Clarified the remaining compatibility agent stubs instead of deleting them. `CustomFieldsAgentGraph`, `DocumentLinksAgentGraph`, and `SchemaAnalysisAgentGraph` are still exported from `apps/backend/src/agents/index.ts`, so removing them would be a public import/API change. Their file headers, service interfaces, live layers, and barrel export sections now explicitly describe them as deprecated compatibility-only no-op/skipped agents and point callers to `PiDocumentAgentService` or `PiConsolidationAgentService`.

## Import/orphan inspection
- Searched for imports/usages of the deleted legacy graph files:
  - `CorrespondentAgentGraph.ts`
  - `DocumentTypeAgentGraph.ts`
  - `SummaryAgentGraph.ts`
  - `TagsAgentGraph.ts`
  - `TitleAgentGraph.ts`
- No remaining source/test imports or service usages were found outside the handoff context report.
- `SchemaAnalysisAgentGraph.ts` is only referenced by the agents barrel export and itself.
- `CustomFieldsAgentGraph.ts` and `DocumentLinksAgentGraph.ts` are only referenced by the agents barrel export and themselves.

## Changed files
- `apps/backend/src/agents/SchemaAnalysisAgentGraph.ts`
- `apps/backend/src/agents/CustomFieldsAgentGraph.ts`
- `apps/backend/src/agents/DocumentLinksAgentGraph.ts`
- `apps/backend/src/agents/index.ts`
- `progress.md`

## Validation
- `pnpm --filter @repo/backend typecheck` failed due to unrelated existing dirty-worktree error in `apps/backend/src/agents/ProcessingPipeline.ts`:
  - returned service object missing `cancelDocumentRun` and `getActiveDocumentRun` from `ProcessingPipelineService`.
- `pnpm --filter @repo/backend lint` failed due to unrelated existing dirty-worktree lint errors in `apps/backend/src/agents/ProcessingPipeline.ts`:
  - `Fiber` should be imported as a type.
  - `activeRuns` is unused.

## Open risks/questions
- No behavior changed and no tests were added.
- The compatibility stubs remain exported intentionally; removing them should be a separate approved API-breaking cleanup if desired.
