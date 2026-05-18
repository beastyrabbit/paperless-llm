# Implementation Plan

## Goal
Extract the first safe concern from `PiDocumentAgent.ts` after todo #33 and #50 land, without changing public imports or agent behavior.

## Tasks
1. **Confirm post-#33/#50 baseline before editing**: Check that the branch already contains todo #33 tag-state extraction and todo #50 ID work.
   - File: `apps/backend/src/agents/PiDocumentAgent.ts`
   - Changes: No code changes; verify the file imports workflow helpers from the shared tag-state utility instead of defining local `getWorkflowTagNames` / `isWorkflowTagName`, and preserve any branded ID type/imports introduced by #50.
   - Acceptance: `pnpm --filter @repo/backend typecheck` passes or existing failures are documented before this slice.

2. **Create the narrow first extraction module**: Move only the few-shot example builder into a dedicated module.
   - File: `apps/backend/src/agents/document/fewShotExamples.ts`
   - Changes: Add this new file and move the current `buildDocumentAgentFewShotExamples(promptLanguage: string)` implementation from `PiDocumentAgent.ts` into it unchanged. Keep the examples TypeScript-defined; do not introduce prompt files or PromptService.
   - Acceptance: A diff of the moved function shows only relocation/import formatting, with no string/content changes.

3. **Keep the facade export stable**: Re-export the moved helper from the existing public module path.
   - File: `apps/backend/src/agents/PiDocumentAgent.ts`
   - Changes: Remove the local `buildDocumentAgentFewShotExamples` function body, import it from `./document/fewShotExamples.js`, and export it from `PiDocumentAgent.ts` so `apps/backend/tests/agents/PiDocumentAgent.test.ts` and downstream imports continue using `../../src/agents/PiDocumentAgent.js`.
   - Acceptance: `buildSystemPrompt(...)` still calls `buildDocumentAgentFewShotExamples(...)`, and existing test imports do not need to change.

4. **Run focused validation**: Validate this extraction only.
   - File: `apps/backend/tests/agents/PiDocumentAgent.test.ts`
   - Changes: No test changes expected.
   - Acceptance: Run `pnpm --filter @repo/backend test -- PiDocumentAgent.test.ts` and `pnpm --filter @repo/backend typecheck`. If feasible, also run `pnpm --filter @repo/backend lint`.

5. **Stop after the first slice**: Do not extract tools, metadata verifier, public service types, memory helpers, or ID-related types in this worker pass.
   - File: `apps/backend/src/agents/PiDocumentAgent.ts`
   - Changes: Leave all side-effectful/service-closure code in place.
   - Acceptance: The implementation diff is limited to one new few-shot module plus import/re-export/removal in `PiDocumentAgent.ts`.

## Files to Modify
- `apps/backend/src/agents/PiDocumentAgent.ts` - replace the inline few-shot builder with an import/re-export; keep the public facade path stable.

## New Files
- `apps/backend/src/agents/document/fewShotExamples.ts` - TypeScript-defined Pi document-agent few-shot examples.

## Dependencies
- Task 1 must happen first so the worker starts from the post-#33/#50 code, not the older handoff line numbers.
- Tasks 2 and 3 are coupled: the new module must be imported and re-exported by `PiDocumentAgent.ts` in the same commit.
- Task 4 depends on Tasks 2 and 3.
- Task 5 is a scope guard for this narrow worker pass.

## Risks
- **Todo #33 conflict**: Older handoff text mentions local workflow tag helpers in `PiDocumentAgent.ts`; after #33 these should be gone. Do not recreate or move them during this slice.
- **Todo #50 conflict**: #50 may change `docId` and API-facing ID types. This first slice intentionally avoids moving public interfaces or `docId`-typed helpers.
- **Prompt regression risk**: Few-shot text is covered by tests for compactness/safety. Move the function byte-for-byte as much as formatting allows.
- **Facade compatibility risk**: Existing tests import `buildDocumentAgentFewShotExamples` from `PiDocumentAgent.ts`; re-export must remain.
- **Scope creep risk**: Extracting tools/verifier/memory in the same pass raises circular-import and closure-dependency risk. Leave those for later slices after this baseline proves the facade pattern.

## Final Worker Prompt
Implement only the first safe extraction slice for todo #34 after todo #33 and #50 have landed. Create `apps/backend/src/agents/document/fewShotExamples.ts` and move the existing `buildDocumentAgentFewShotExamples(promptLanguage: string)` implementation from `apps/backend/src/agents/PiDocumentAgent.ts` into it unchanged. In `PiDocumentAgent.ts`, import and re-export that helper so existing imports from `./PiDocumentAgent.js` and `apps/backend/tests/agents/PiDocumentAgent.test.ts` keep working. Do not move public service interfaces, branded ID types, workflow tag helpers, metadata verifier code, memory helpers, or tool executors. Do not introduce PromptService or prompt files; examples must remain TypeScript-defined. Before editing, confirm the branch already reflects #33 by using shared tag-state helpers rather than local workflow helper definitions, and preserve any #50 branded-ID changes. Validate with `pnpm --filter @repo/backend test -- PiDocumentAgent.test.ts` and `pnpm --filter @repo/backend typecheck`; run backend lint if feasible and report skipped validation.