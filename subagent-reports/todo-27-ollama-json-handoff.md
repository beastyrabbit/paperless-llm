# Todo #27 / W4-S17 — Ollama JSON mode / response format handoff

## Goal
Enable Ollama JSON mode / response-format payloads where supported. The implementation target is both native `OllamaService` calls and Pi agent calls routed through Ollama’s OpenAI-compatible `/v1` API.

## Current state and relevant files

### Native Ollama service
- `apps/backend/src/services/OllamaService.ts`
  - Lines 21-29: `OllamaChatOptions` only contains sampling/runtime fields (`temperature`, `top_p`, `top_k`, `num_predict`, `seed`, `stop`). No response format field exists.
  - Lines 72-93: `chat`, `chatStream`, `generate`, and `generateStream` all accept only `OllamaChatOptions`.
  - Lines 219-235: `chat()` sends `/api/chat` body with top-level `model`, `messages`, `stream: false`, and nested `options`; no top-level `format`.
  - Lines 237-289: `chatStream()` sends `/api/chat` body with `stream: true`; no `format`.
  - Lines 348-363: `generate()` sends `/api/generate` body with top-level `model`, `prompt`, `stream: false`, and nested `options`; no `format`.
  - Lines 365-432: `generateStream()` similarly lacks `format`.
  - Limitation: Ollama native JSON mode / structured outputs are not available through this wrapper yet. Implement as a top-level request field, not inside `options`.

### Pi Ollama model and payload hooks
- `apps/backend/src/agents/piOllamaModel.ts`
  - Lines 3-18: `buildOllamaModel(url, modelId)` returns a Pi `Model<"openai-completions">` pointing at `${url}/v1`, provider `ollama`, with compatibility flags. No response-format compatibility is encoded here.
- `apps/backend/src/agents/PiDocumentAgent.ts`
  - Lines 2230-2270: main document agent constructs `new PiAgent(...)` with `streamFn: streamSimple`, `getApiKey: () => "ollama"`, and an `onPayload` hook that currently only injects `{ temperature: 0, seed: modelSeed }` when the payload is a record.
  - This is the key hook for adding OpenAI-compatible `response_format` to Pi agent requests, because Pi uses `@earendil-works/pi-ai` OpenAI completions provider against Ollama `/v1`.
  - Lines 1996-2124: prompts require tool calls only. The main agent uses tools, so JSON mode must not break function/tool calling.
- `apps/backend/src/agents/PiTagExplorerAgent.ts`
  - Lines 294-303: constructs a Pi agent for tag exploration with `buildOllamaModel(...)`, `streamSimple`, and no `onPayload` hook.
- `apps/backend/src/agents/PiConsolidationAgent.ts`
  - Lines 475-484: constructs a Pi agent for consolidation with `buildOllamaModel(...)`, `streamSimple`, and no `onPayload` hook.

### Pi library evidence
- Backend dependency: `apps/backend/package.json` uses `@earendil-works/pi-ai` and `@earendil-works/pi-agent-core` `^0.74.0`.
- `node_modules/.pnpm/@earendil-works+pi-ai@0.74.0.../dist/types.d.ts`
  - Lines 46-49: `StreamOptions.onPayload?: (payload, model) => unknown | undefined | Promise<...>`.
  - Lines 240-278: `OpenAICompletionsCompat` has many compatibility flags, but no `response_format`/JSON-mode flag.
  - Lines 380-398: `Model` supports `compat`, but again no typed response-format support.
- `node_modules/.pnpm/@earendil-works+pi-ai@0.74.0.../dist/providers/openai-completions.js`
  - Lines 378-427: OpenAI completions params are built with `model`, `messages`, `stream`, optional `max_tokens`, `temperature`, `tools`, `tool_choice`, etc. No `response_format` is set by the provider.
  - Lines 75-80: provider calls `options?.onPayload?.(params, model)` and replaces params if a value is returned. Therefore app code can inject `response_format` safely without library changes.
- `node_modules/.pnpm/@earendil-works+pi-agent-core@0.74.0.../dist/agent.d.ts`
  - Lines 7-12 and 34-39: `AgentOptions.onPayload` is passed through as `SimpleStreamOptions["onPayload"]`.

### Small-model verifier / native JSON use case
- `apps/backend/src/agents/PiDocumentAgent.ts`
  - Lines 1124-1145: `verifyMetadataProposal()` calls `ollama.chat(...)` with a system prompt requiring JSON and options `{ temperature: 0, num_predict: 700, seed: verifierSeed }`.
  - Lines 784-788: verifier prompt explicitly says `Return JSON only.`
  - Lines 95-111 and tests below: verifier parser can extract JSON from fenced text, but native Ollama JSON mode would reduce malformed prose risk.

### Tests already present
- `apps/backend/tests/services/OllamaService.test.ts`
  - Lines 28-61: stream malformed JSON test.
  - Lines 63-94: timeout test.
  - Lines 96-120: configured large/small model selection test.
  - No tests assert request payload shape for `chat`/`generate` options.
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
  - Lines 1-15: imports only pure helpers from `PiDocumentAgent`.
  - Lines 76-114: verifier JSON parser tests, including fenced JSON extraction.
  - Lines 115-141: verifier prompt guardrail test.
  - No test currently covers `onPayload` behavior or Pi payload response_format injection.

### Config/settings limitation
- `apps/backend/src/config/schema.ts`
  - Lines 11-17 and 117-124: `OllamaConfig` has `url`, `model`, `modelLarge`, `modelSmall`, `embeddingModel`; no JSON-mode setting.
- `config.example.yaml`
  - Lines 21-25: only Ollama URL/models are shown.
- `apps/backend/src/api/settings/api.ts` and `handlers.ts`, `TinyBaseService.ts` settings migration only know URL/model/embedding. No UI/API setting exists for toggling JSON mode.

## Likely implementation approach

1. Add typed format support to `OllamaService`:
   - Define a type such as `export type OllamaResponseFormat = "json" | Record<string, unknown>;` (or `OllamaChatFormat`) in `OllamaService.ts`.
   - Add `format?: OllamaResponseFormat` to `OllamaChatOptions` or a new request options type used by `chat/generate` and streaming variants.
   - When building native `/api/chat` and `/api/generate` bodies, put `format: options.format` at top level alongside `model`, `messages`/`prompt`, and `stream`, not under nested `options`.
   - Avoid serializing `format: undefined` if possible; current code already includes some undefined nested options, but top-level omission is cleaner.

2. Use native JSON mode for the small-model metadata verifier:
   - In `PiDocumentAgent.ts` around lines 1124-1139, pass `format: "json"` to `ollama.chat(...)` for `verifyMetadataProposal()`.
   - Do not force JSON mode for `api/chat/handlers.ts` general chat or `api/metadata/handlers.ts` description/translation generation; those are prose/text outputs.

3. Add a reusable Pi payload helper instead of duplicating fragile hooks:
   - Existing main document agent hook at lines 2267-2268 should be replaced or wrapped by an exported helper, e.g. `withOllamaJsonResponseFormat(payload, { temperature, seed, jsonMode })` or narrower `buildOllamaAgentPayload(payload, seed)`.
   - For OpenAI-compatible Ollama `/v1/chat/completions`, inject top-level `response_format: { type: "json_object" }` only when appropriate.
   - Preserve existing deterministic fields: current hook must still inject `temperature: 0` and `seed: modelSeed` for the main document agent.
   - Consider adding the same hook to `PiTagExplorerAgent` and `PiConsolidationAgent` if the requirement is all Pi Ollama tool agents. They are tool-only agents but currently lack `seed` too; do not add unrelated determinism changes unless desired.

4. Be careful with tools:
   - Main Pi agents rely on OpenAI tool/function calling. Some providers/models may not support JSON mode together with tools. Ollama OpenAI-compatible JSON mode is usually `response_format: { type: "json_object" }`; confirm locally against Ollama if possible.
   - If JSON mode interferes with tool calls, scope Pi `response_format` narrowly (for example only native verifier) or guard it behind a helper/config flag. The task wording says “where supported,” so support detection/guarding matters.

## Suggested tests to add

1. `apps/backend/tests/services/OllamaService.test.ts`
   - Add a non-stream `chat` test that stubs `fetch`, calls `ollama.chat("llama", [], { format: "json" })`, parses `fetch` body, and asserts top-level `format === "json"` and `options.format` is absent.
   - Add a `generate` test with a schema object format, asserting top-level `format` preserves the object.
   - Optional: add `chatStream` or `generateStream` payload-shape test if stream code is changed separately.

2. `apps/backend/tests/agents/PiDocumentAgent.test.ts`
   - If a pure/exported helper is introduced for Pi payload mutation, test:
     - non-record payload returns unchanged/undefined according to helper contract;
     - existing hook behavior still adds `temperature: 0` and `seed`;
     - when enabled for Ollama/OpenAI-compatible payloads, adds `response_format: { type: "json_object" }`;
     - preserves existing `tools` and `tool_choice` fields.
   - Keep tests pure; do not spin up PiAgent unless necessary.

## Validation commands
- Targeted backend unit tests:
  - `pnpm --filter @repo/backend test -- tests/services/OllamaService.test.ts tests/agents/PiDocumentAgent.test.ts`
- Typecheck:
  - `pnpm --filter @repo/backend typecheck`
- If behavior is uncertain with a real Ollama version/model, manually smoke test `/v1/chat/completions` with tools plus `response_format: {"type":"json_object"}` and native `/api/chat` with `format: "json"`.

## Risks / constraints
- Do not reintroduce `PromptService` or prompt-file driven paths; project rules require Pi agent instructions/tools/placeholders in TypeScript.
- Native Ollama `format` belongs at top level of `/api/chat` and `/api/generate` requests.
- Pi uses Ollama’s OpenAI-compatible `/v1` endpoint via `buildOllamaModel()`, so native `format` is not relevant there; use `response_format` through `onPayload`.
- Existing prompts/tool loops depend on tool calls. JSON mode may not be supported in combination with tool calls for all Ollama versions/models; implement “where supported” conservatively.
- There is currently no config/settings flag for JSON mode. Adding one touches config schema, settings API/UI, and TinyBase mappings; avoid unless explicitly requested by planner.

## Compact worker prompt
Implement Ollama JSON mode support. In `OllamaService.ts`, add typed `format?: "json" | Record<string, unknown>` support and send it as top-level `format` for native `/api/chat` and `/api/generate` (streaming and non-streaming), never inside nested `options`. Use `format: "json"` for the small-model verifier call in `PiDocumentAgent.ts`. For Pi agents using `buildOllamaModel(...)/v1`, add a small tested payload helper/hook that preserves existing `{ temperature: 0, seed }` behavior and, only where safe/supported, injects OpenAI-compatible `response_format: { type: "json_object" }`; do not break tool calls. Add unit tests for native payload shape and any exported Pi payload helper. Validate with targeted backend tests and typecheck.
