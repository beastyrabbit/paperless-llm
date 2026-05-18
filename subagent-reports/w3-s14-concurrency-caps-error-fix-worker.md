Implemented W3-S14 todo #11 concurrency wrapper error propagation.

Changed files:
- `apps/backend/src/agents/piOllamaModel.ts`
  - Added conversion of failures from gated `streamSimple(...)`, async iteration, or `source.result()` into Pi `error` stream events with an `AssistantMessage` carrying `stopReason: "error"` and `errorMessage`.
  - Kept the existing `concurrency.withOllama(...)` wrapping so the permit is released by the Effect semaphore on both success and failure.
- `apps/backend/tests/agents/piOllamaModel.test.ts`
  - Added focused coverage for synchronous `streamSimple` throw, async iterator failure, and source `result()` rejection.
  - Each test asserts an error event/result is emitted and the mocked Ollama permit is released.

Validation:
- `pnpm --filter @repo/backend test -- tests/agents/piOllamaModel.test.ts` — passed.
- `pnpm --filter @repo/backend test -- tests/services/ConcurrencyLimitService.test.ts tests/services/MistralService.test.ts tests/services/OllamaService.test.ts tests/agents/OCRAgent.test.ts tests/config/config.test.ts tests/agents/piOllamaModel.test.ts` — passed.
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/backend lint` — passed.

Notes:
- The requested `context.md` and `plan.md` files were not present at the workspace root, so I proceeded from the task text and actual code.
- The worktree already contained many unrelated dirty/untracked files; I only touched the concurrency wrapper, its focused test, and this report.

Open risks/questions:
- None identified for this scope.

Recommended next step:
- Review the wrapper/test changes and continue W3-S14 review closure.
