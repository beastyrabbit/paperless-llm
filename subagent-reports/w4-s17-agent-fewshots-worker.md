# W4-S17 agent few-shots worker handoff

Implemented Todo #30 / W4-S17.

## Changes

- Added compact TypeScript-defined few-shot examples for:
  - `PiDocumentAgent` via exported `buildDocumentAgentFewShotExamples`, inserted into the system prompt so dynamic excerpt budgeting accounts for the added static text.
  - `PiTagExplorerAgent` via exported `buildTagExplorerFewShotExamples`, inserted before `Input JSON` in exported `buildTagExplorerPromptWithExcerpt`.
  - `PiConsolidationAgent` via exported `buildConsolidationAgentFewShotExamples`, included as `few_shot_examples` in exported `buildConsolidationAgentPrompt` before the untrusted catalog payload.
- Kept examples synthetic, tool/proposal-shaped, short, and bounded.
- Added/updated tests for bounded examples, expected tool names, prompt placement, and untrusted delimiters.
- Updated `progress.md`.

## Validation

Passed:

```bash
pnpm --filter @repo/backend test -- tests/utils/promptData.test.ts tests/agents/PiDocumentAgent.test.ts tests/agents/PiTagExplorerAgent.test.ts tests/agents/PiConsolidationAgent.test.ts
pnpm --filter @repo/backend lint
```

Also ran targeted agent tests separately; they passed.

Typecheck attempted:

```bash
pnpm --filter @repo/backend typecheck
```

It failed with unrelated existing errors in files outside this task scope:

- `src/agents/ProcessingPipeline.ts(524,23)`: `"run_cancelled"` not assignable to `ProcessingLogEventType`.
- `src/api/index.ts(27,3)`: missing `ProcessingCancelBodySchema` export from `@repo/api-contracts`.
- `src/services/MetricsService.ts(150,73)`: object possibly `undefined`.
- `src/services/MistralService.ts(263,11)`, `(271,13)`, `(286,13)`, `(311,13)`, `(334,11)`: argument arity mismatches.

## Risks / notes

- `context.md` and `plan.md` were not present; implementation used the provided updated handoff as source context.
- Worktree had many pre-existing modified/untracked files. I only edited files needed for W4-S17 and did not touch backend server/metrics/cancel files.
