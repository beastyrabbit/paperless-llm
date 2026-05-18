# W4-S17 prompt budget worker report

Implemented dynamic prompt content budgeting for TypeScript-defined agent prompts.

## Changes

- Added shared prompt budgeting helpers in `apps/backend/src/utils/promptData.ts`:
  - `estimatePromptTokens`
  - `computeContentExcerptCharBudget`
  - `formatBudgetedUntrustedDocumentText`
- Exported shared Ollama model defaults from `apps/backend/src/agents/piOllamaModel.ts` and reused them in `buildOllamaModel`.
- Replaced hard-coded excerpt budgeting in:
  - `buildMetadataVerifierPrompt` (`4_000` max, dynamically reduced using verifier system prompt + static prompt + 700 output tokens)
  - main `PiDocumentAgent` user prompt (`12_000` max, dynamically reduced using system prompt + static prompt + model max output reserve)
  - `PiTagExplorerAgent` prompt (`10_000` max, dynamically reduced using tag explorer system prompt + static prompt + model max output reserve)
- Preserved untrusted document delimiters for all budgeted excerpts.
- Added tests:
  - `apps/backend/tests/utils/promptData.test.ts` for shrinking, max clamping, over-budget non-negative behavior, and delimiter preservation.
  - Extended `apps/backend/tests/agents/PiDocumentAgent.test.ts` with verifier truncation behavior under constrained context.

## Validation

Passed:

```sh
pnpm --filter @repo/backend test -- tests/utils/promptData.test.ts tests/agents/PiDocumentAgent.test.ts
pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts
pnpm --filter @repo/backend lint
```

Blocked by unrelated existing typecheck/API-contract issue:

```sh
pnpm --filter @repo/backend typecheck
```

Failure:

```text
src/api/index.ts(42,3): error TS2305: Module '"@repo/api-contracts"' has no exported member 'generateOpenApiDocument'.
```

## Notes / risks

- Budgeting uses a conservative approximation (`3 chars/token`) plus a 1,024-token safety margin; no tokenizer dependency was introduced.
- Runtime-configurable Ollama context window/max tokens were not added to avoid broader config/API churn. The implementation uses the centralized defaults exported from `piOllamaModel.ts`.
- Existing unrelated dirty worktree changes were preserved; no OllamaService/concurrency/backend API/OpenAPI files were edited.
