# W4-S17 / Todo #27 — Ollama JSON mode worker handoff

## Implemented
- Added typed native Ollama response-format support in `apps/backend/src/services/OllamaService.ts`:
  - `export type OllamaResponseFormat = "json" | Record<string, unknown>`
  - `OllamaChatOptions.format?: OllamaResponseFormat`
  - `format` is sent as a top-level field for `/api/chat` and `/api/generate` request bodies, both streaming and non-streaming.
  - `format` is not placed inside nested `options`.
- Enabled native Ollama JSON mode for the small-model metadata verifier in `apps/backend/src/agents/PiDocumentAgent.ts` via `format: "json"`.
- Added `buildOllamaPiPayload()` helper in `PiDocumentAgent.ts`:
  - preserves existing deterministic Pi payload behavior (`temperature: 0`, `seed`)
  - can add OpenAI-compatible `response_format: { type: "json_object" }` when explicitly requested
  - avoids adding `response_format` when `tools` are present or a payload already has `response_format`, to avoid breaking tool calls/overriding provider input
- Switched the main document agent `onPayload` hook to use the helper without enabling JSON response format for tool-call payloads.
- Added focused tests for native request payload shape and Pi helper behavior.

## Changed files
- `apps/backend/src/services/OllamaService.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/tests/services/OllamaService.test.ts`
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
- `progress.md`
- `subagent-reports/w4-s17-ollama-json-worker.md`

## Validation
- Passed: `pnpm --filter @repo/backend test -- tests/services/OllamaService.test.ts tests/agents/PiDocumentAgent.test.ts`
- Passed: `pnpm --filter @repo/backend typecheck`
- Passed: `pnpm --filter @repo/backend lint`

## Notes / risks
- `context.md` and `plan.md` were not present in the repository root when read; implementation followed `subagent-reports/todo-27-ollama-json-handoff.md`.
- The worktree had extensive pre-existing dirty/untracked changes. I only edited the scoped backend service/agent/test files, `progress.md`, and this handoff.
- OpenAI-compatible `response_format` is available through the helper but is not enabled for the main tool-calling Pi document agent because tool calls plus JSON response format may not be supported across all Ollama versions/models.
