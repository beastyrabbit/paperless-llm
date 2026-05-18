# Todo #29 / W4-S17 handoff: dynamic prompt content budget

No edits were made.

## Current issue

The code still uses fixed character caps for document excerpts while the rest of the prompt (system prompt, tool instructions, catalogs, memory, similar docs) can vary substantially. This is the Q6 audit item: `docs/AUDIT.md:224-229` says static content truncation ignores prompt/catalog size and should compute remaining context budget dynamically.

## High-value code context

### Model/context configuration

- `apps/backend/src/agents/piOllamaModel.ts:3-21`
  - `buildOllamaModel(url, modelId)` targets Ollama OpenAI-compatible `/v1`.
  - It hardcodes `contextWindow: 32_000` and `maxTokens: 4_096` (`lines 13-14`).
  - These values are not exported and not configurable through app config.
- `apps/backend/src/config/schema.ts:13-19`, `122-127`
  - `ollama` config currently has only `url`, `model`, `modelLarge`, `modelSmall`, `embeddingModel`.
  - No `contextWindow` / `maxTokens` field exists in schema or resolved config.
- `apps/backend/src/config/index.ts:19-24`
  - Defaults have no context-size fields.
- `apps/backend/src/config/yaml-loader.ts:26-36`, `255-260`
  - YAML/env normalization only handles model names and embedding model; no context window env vars.

### Shared truncation helper

- `apps/backend/src/utils/promptData.ts:1-13`
  - Defines untrusted-data delimiters and instruction.
  - `formatUntrustedDataBlock(content, maxChars)` slices with `content.slice(0, maxChars)` and wraps delimiters.
  - `formatUntrustedDocumentText(content, maxChars)` is just a pass-through wrapper. This is the best place for reusable budget/estimation helpers, but keep delimiter behavior unchanged.

### PiDocumentAgent: three prompt surfaces

- Verifier prompt: `apps/backend/src/agents/PiDocumentAgent.ts:889-930`
  - `buildMetadataVerifierPrompt(input)` returns pretty-printed JSON.
  - Fixed excerpt at `line 923`: `formatUntrustedDocumentText(input.content, 4_000)`.
  - The verifier also includes full `proposed_metadata` and `catalogs`, so large catalogs can crowd out the 4k excerpt.
- Verifier call: `apps/backend/src/agents/PiDocumentAgent.ts:1239-1263`
  - Builds prompt and sends it via `ollama.chat(...)`.
  - Options reserve/generate `num_predict: 700` (`line 1262`), which should be treated as output-token reservation for verifier budgeting.
- Main document prompt: `apps/backend/src/agents/PiDocumentAgent.ts:2170-2247`
  - `buildUserPrompt(...)` builds `payload` containing document metadata, required tool sequence, language guidance, catalog guidance, full `catalogs`, `already_applied_metadata`, `human_decisions`, `review_feedback`.
  - Fixed excerpt at `line 2207`: `formatUntrustedDocumentText(content, 12_000)`.
  - It then wraps the JSON payload with several instruction strings (`lines 2234-2247`). Those wrappers and system prompt should count against budget.
- Main agent creation: `apps/backend/src/agents/PiDocumentAgent.ts:2353-2392`
  - `systemPrompt: buildSystemPrompt(settings.promptLanguage)` and `model: buildOllamaModel(...)`.
  - `onPayload` only injects `{ temperature: 0, seed: modelSeed }`; no context override is sent.
  - Any budget design should use the same context config as `buildOllamaModel` to avoid drift.

### PiTagExplorerAgent prompt surface

- `apps/backend/src/agents/PiTagExplorerAgent.ts:256-284`
  - `buildPrompt(input, promptLanguage)` includes full `catalog_tags` and `similar_documents` plus a fixed `content_excerpt`.
  - Fixed excerpt at `line 279`: `formatUntrustedDocumentText(input.content, 10_000)`.
- Agent creation/call: `apps/backend/src/agents/PiTagExplorerAgent.ts:292-305`
  - Uses `buildOllamaModel(runtime.ollamaUrl, runtime.model)` and prompts with `buildPrompt(...)`.
  - Runtime settings only include URL/model/timeout/language; no context info.

### Existing tests and patterns

- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
  - Imports exported pure helpers from `PiDocumentAgent.ts`; adding exported pure budget helpers fits the current pattern.
  - Existing tests around `lines 141-185` verify verifier prompt delimiters. Extend this area for dynamic budget behavior.
- There is currently no `PiTagExplorerAgent` test file. Add either a new pure-helper test for prompt budgeting or move generic helper tests to a utility test (preferred if helper lives in `utils/promptData.ts`).
- `apps/backend/tests/config/config.test.ts:123-145` tests YAML aliases for `model_large`/`model_small`; extend this if adding context config normalization/env.

## Recommended implementation design

1. **Expose/centralize model context constants.**
   - In `piOllamaModel.ts`, export defaults such as `DEFAULT_OLLAMA_CONTEXT_WINDOW = 32_000` and `DEFAULT_OLLAMA_MAX_TOKENS = 4_096`, and use them in `buildOllamaModel`.
   - Better implementation-ready option: add optional resolved config fields `ollama.contextWindow` and `ollama.maxTokens`, with defaults `32_000` and `4_096`, YAML aliases `context_window` / `max_tokens`, env vars `OLLAMA_CONTEXT_WINDOW` / `OLLAMA_MAX_TOKENS`, then pass these into `buildOllamaModel(url, modelId, { contextWindow, maxTokens })`.
   - If scope must stay small, do constants only; but dynamic budget from configurable context size is more complete.

2. **Add reusable approximate prompt budget helpers.**
   - No tokenizer dependency exists. Use conservative char/token approximation.
   - Suggested helper location: `apps/backend/src/utils/promptData.ts`.
   - Suggested exports:
     - `estimatePromptTokens(text: string, charsPerToken = 4): number`.
     - `computeContentExcerptCharBudget({ contextWindowTokens, reservedOutputTokens, staticPromptText, maxExcerptChars, minExcerptChars?, safetyMarginTokens? }): number`.
     - Or `formatBudgetedUntrustedDocumentText(content, budget)` wrapping the existing delimiter helper.
   - Use a safety margin (e.g. 1_024 tokens) and clamp to `[minExcerptChars, maxExcerptChars]`, but if the static prompt already exceeds the context budget, return a tiny safe budget (e.g. 0 or 500 chars) rather than negative.

3. **Avoid circular prompt-size calculations by building prompt with an empty excerpt first.**
   - For each prompt, build the same payload with `content_excerpt: formatUntrustedDocumentText("", 0)` or a placeholder, stringify it, and compute budget from that static prompt.
   - Then rebuild the prompt with the computed excerpt budget.
   - Include system prompt in `staticPromptText` for main PiDocumentAgent because `systemPrompt` also consumes context.
   - Include verifier system message text and `num_predict: 700` as reserved output for verifier.
   - Include tag explorer system prompt (`"You are a read-only tag exploration micro-agent."`) in tag explorer budget.

4. **Refactor prompt builders minimally.**
   - `buildMetadataVerifierPrompt` should accept optional budget/config, or split into internal `buildMetadataVerifierPromptWithExcerpt(contentExcerpt)` plus exported wrapper.
   - `buildUserPrompt` currently closes over `buildSystemPrompt`; make it accept context budget inputs or compute in caller using `buildSystemPrompt(settings.promptLanguage)`.
   - `PiTagExplorerAgent`’s `buildPrompt` is currently local and unexported. Either export a pure prompt/budget helper for tests, or move generic helper tests to `promptData.test.ts` and cover explorer via a small exported builder if acceptable.

5. **Preserve invariants.**
   - Keep untrusted-data delimiters around every document excerpt.
   - Do not remove catalog/memory fields to make room; only adapt content excerpt length for this todo.
   - Do not reintroduce prompt files or PromptService; project rules require TypeScript-defined agent prompts.

## Implementation risks / decisions to make

- **Token estimation is approximate.** Without a tokenizer, use conservative char/token math and safety margin. Document the heuristic in code.
- **Static prompt can exceed budget even with zero content.** Decide whether to return zero-content excerpt and log/continue, or later implement catalog/memory compaction. For this todo, zero/tiny excerpt is acceptable; do not silently produce negative caps.
- **Config surface scope.** Adding `ollama.contextWindow`/`maxTokens` touches schema, defaults, YAML/env loader, tests, and `buildOllamaModel` call sites (`PiDocumentAgent`, `PiTagExplorerAgent`, `PiConsolidationAgent` if signature changes). If the worker chooses constants-only, note that runtime context size still cannot be changed per model.
- **Pretty JSON costs.** Verifier uses `JSON.stringify(..., null, 2)`, main/tag prompts use compact JSON. Budget helper must operate on the actual emitted prompt string.

## Suggested tests

1. `utils/promptData` helper tests (new or existing utility test):
   - Computes a smaller excerpt budget when `staticPromptText` grows.
   - Clamps at `maxExcerptChars` when plenty of context remains.
   - Never returns negative when static prompt exceeds context.
   - Preserves untrusted-data delimiters when formatting budgeted text.

2. `PiDocumentAgent.test.ts`:
   - Verifier prompt with huge `catalogs` produces a shorter/truncated `content_excerpt` than with small catalogs, while still containing start/end delimiters.
   - Main document prompt with huge catalogs/memory computes a content excerpt below the old fixed `12_000` cap.
   - Existing delimiter test should continue to pass.

3. `PiTagExplorerAgent` or utility-level test:
   - With huge `catalogTags`/`similarDocuments`, explorer content excerpt is below old fixed `10_000` cap and still delimited.

4. Config tests if adding config fields:
   - Defaults resolve to `contextWindow: 32_000`, `maxTokens: 4_096`.
   - YAML snake_case `context_window` / `max_tokens` and env vars load correctly.
   - `buildOllamaModel` uses the configured values.

## Targeted validation commands

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`
- If adding utility/config tests: `pnpm --filter @repo/backend test -- tests/config/config.test.ts tests/agents/PiDocumentAgent.test.ts`
- Final backend check: `pnpm --filter @repo/backend typecheck`

## Compact worker prompt

Implement Todo #29 dynamic prompt content budgeting. Do not use prompt files. Centralize Ollama context-window/max-output settings (prefer configurable `ollama.contextWindow`/`ollama.maxTokens` with defaults 32_000/4_096; at minimum export constants from `piOllamaModel.ts`). Add conservative prompt token/char budget helpers in TypeScript, preserving untrusted-data delimiters. Use them to replace fixed `formatUntrustedDocumentText(..., 12_000)` in `PiDocumentAgent` main prompt, `4_000` in `buildMetadataVerifierPrompt`, and `10_000` in `PiTagExplorerAgent`, computing remaining excerpt budget from actual static prompt size, system prompt, reserved output tokens, and safety margin. Add unit tests for clamping/over-budget behavior and for document/verifier/tag explorer prompts still using delimiters while shrinking excerpts when catalogs/memory are large. Validate with targeted backend tests and typecheck.
