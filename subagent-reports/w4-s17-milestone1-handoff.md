# W4-S17 Milestone 1 Handoff — Ollama JSON/response format + field-specific retry text

Scope requested: **milestone 1 only** from W4-S17: Ollama JSON/response-format support and field-specific retry correction text. No source files were edited while gathering this handoff. Do **not** add prompt files or `PromptService`; keep Pi agent instructions/tools/schemas in TypeScript.

## Source context read

- `subagent-reports/w4-polish-context.md` confirms W4-S17 decomposes into multiple prompt reliability items; this handoff intentionally covers only:
  - structured-output / JSON mode support
  - field-specific correction text
- `docs/plans/audit-rework-tasks.md:323-328` lists W4-S17 and specifically: “Enable Ollama JSON mode/response format where supported” and “Generate retry correction text from validation error paths.”
- `docs/AUDIT.md:224-228` maps these to Q4/Q5.
- `subagent-reports/w2-s6-worker.md` says W2-S6 was marked complete, but the implementation worker should still start after W2-S6 is merged/available and recheck changed imports/line numbers.

## High-value implementation files

### 1) Native Ollama service JSON format support

**File:** `apps/backend/src/services/OllamaService.ts`

Current facts:
- `OllamaChatOptions` is only generation options; no response format field:
  - `apps/backend/src/services/OllamaService.ts:26-33`
  - fields: `temperature`, `top_p`, `top_k`, `num_predict`, `seed`, `stop`
- `/api/chat` request bodies put generation controls under `options` only:
  - `apps/backend/src/services/OllamaService.ts:227-240`
  - request body shape: `{ model, messages, stream: false, options: { ... } }`
- `/api/generate` does the same:
  - `apps/backend/src/services/OllamaService.ts:352-367`
- Streaming variants duplicate the body construction for `/api/chat` and `/api/generate` and need the same top-level `format` behavior.

Minimal design:
- Add a typed top-level response format option to `OllamaChatOptions`, e.g.:
  - `format?: "json" | Record<string, unknown>`
- Keep `format` **top-level** in native Ollama `/api/chat` and `/api/generate` request bodies, not inside `options`:
  - `{ model, messages, stream: false, format: options.format, options: { ... } }`
  - include only when defined to preserve current behavior.
- Apply to all four call paths for consistency:
  - `chat`
  - `chatStream`
  - `generate`
  - `generateStream`
- Existing exports from `apps/backend/src/services/index.ts` already include `OllamaChatOptions`; type changes should flow through.

Likely direct use to update:
- `apps/backend/src/agents/PiDocumentAgent.ts:1125-1142` small-model verifier calls `ollama.chat(...)` and currently passes `{ temperature: 0, num_predict: 700, seed: context.verifierSeed }`.
- Add `format: "json"` there because `parseMetadataVerificationResponse()` expects JSON and the verifier system prompt says “only return JSON”.

Tests:
- Extend `apps/backend/tests/services/OllamaService.test.ts`.
- Add a fetch-stub test that calls `ollama.chat("llama", messages, { format: "json", temperature: 0 })` and asserts the POST body includes top-level `format: "json"` and does not nest `format` inside `options`.
- Add equivalent for `generate` if time permits; at minimum test one chat path and one generate path because they use separate body construction.

### 2) Pi OpenAI-compatible response_format support

**File:** `apps/backend/src/agents/piOllamaModel.ts`

Current facts:
- `buildOllamaModel()` configures Ollama’s OpenAI-compatible `/v1` endpoint:
  - `apps/backend/src/agents/piOllamaModel.ts:3-22`
  - `api: "openai-completions"`, `baseUrl: ${url}/v1`, context/max tokens, compat flags.
- Main Pi document agent currently injects only deterministic options:
  - `apps/backend/src/agents/PiDocumentAgent.ts:2265-2268`
  - `onPayload: (payload) => isRecord(payload) ? { ...payload, temperature: 0, seed: modelSeed } : payload`
- `@earendil-works/pi-ai` supports pre-request payload mutation:
  - `node_modules/.../@earendil-works/pi-ai/dist/types.d.ts:47-49`: `onPayload?: (payload, model) => unknown | undefined | Promise<...>`
  - `node_modules/.../providers/openai-completions.js:76-80`: OpenAI completions payload is built, then `options.onPayload` may replace it before `client.chat.completions.create(...)`.
- The OpenAI-completions provider’s base payload does not set response format:
  - `node_modules/.../providers/openai-completions.js:382-430`: builds `model`, `messages`, `stream`, cache fields, max tokens, temperature, tools/tool_choice, thinking; no `response_format`.

Minimal design:
- Add a small typed helper in `piOllamaModel.ts` rather than scattering raw payload mutation:
  - e.g. `export type OllamaOpenAiResponseFormat = "json" | { type: "json_object" } | { type: "json_schema"; json_schema: unknown }`
  - e.g. `export const withOllamaOpenAiPayloadOptions = (payload, options) => ...`
  - Map simple `"json"` to OpenAI-compatible `response_format: { type: "json_object" }`.
  - Preserve deterministic settings: `temperature`, `seed`.
- Use this helper from `PiDocumentAgent.ts` `onPayload` instead of an inline object spread.
- **Important risk:** the main Pi agents are tool-calling agents. Forcing `response_format: { type: "json_object" }` on tool-call conversations may interfere with actual function/tool calls on some OpenAI-compatible servers. Milestone 1 should add typed support, but only enable it by default on calls that expect plain JSON text (the native small verifier via `OllamaService.chat`). Do not enable JSON response format globally for document/tag/consolidation tool agents unless a focused test or manual smoke run proves Ollama still emits tool calls.
- If the worker decides to enable `response_format` for a Pi tool agent, add/keep an escape hatch and test that `tools` remain present in the final payload.

Likely files if helper is added:
- `apps/backend/src/agents/piOllamaModel.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts` (replace inline `onPayload` mutation with helper; likely no behavior change unless response format is explicitly requested)
- Optional similar cleanup in:
  - `apps/backend/src/agents/PiTagExplorerAgent.ts:294-300`
  - `apps/backend/src/agents/PiConsolidationAgent.ts:480-486`

Tests:
- If adding helper, add a small unit test (new test file or existing backend agent test) that verifies:
  - `temperature` and `seed` are preserved/injected
  - `responseFormat: "json"` becomes `response_format: { type: "json_object" }`
  - non-object payloads are returned unchanged or undefined as designed.

### 3) Field-specific retry correction text

**File:** `apps/backend/src/agents/PiDocumentAgent.ts`

Current facts:
- The final metadata tool schema is TypeBox:
  - `apps/backend/src/agents/PiDocumentAgent.ts:1276-1294`
  - fields include `tagIdsToAdd`, `tagIdsToRemove`, `customFieldsJson`, `linkedDocumentsJson`, `confidence`, etc.
- Pi validates tool arguments before execution through `@earendil-works/pi-ai`:
  - `node_modules/.../@earendil-works/pi-agent-core/dist/agent-loop.js:338-368`
  - `validateToolArguments()` errors become an error tool result.
- `@earendil-works/pi-ai` validation errors already contain paths:
  - `node_modules/.../@earendil-works/pi-ai/dist/utils/validation.js:253-279`
  - error format: `Validation failed for tool "finish_document_metadata":\n  - tagIdsToAdd.0: Expected number\n\nReceived arguments:\n...`
  - path formatting is at `validation.js:220-230` and uses dot paths like `tagIdsToAdd.0`.
- Current retry loop uses generic text:
  - `apps/backend/src/agents/PiDocumentAgent.ts:2436-2450`
  - It says “Your previous final metadata tool call was rejected” and `Verifier feedback: ${finalToolError}`, but does not highlight invalid fields/paths.
- `getFailedFinalToolError()` currently returns the raw failed final tool result text truncated to 1,000 chars:
  - `apps/backend/src/agents/PiDocumentAgent.ts:2394-2407`

Minimal design:
- Add an exported helper near the existing small exported helpers in `PiDocumentAgent.ts`, e.g.:
  - `export const buildFinalToolRetryCorrection = (finalToolError: string): string => ...`
- Parse validation lines from raw Pi tool error text:
  - match lines like `/^\s*-\s+([^:]+):\s*(.+)$/gm`
  - convert numeric path segments to bracket notation for clarity:
    - `tagIdsToAdd.0` -> `finish_document_metadata.tagIdsToAdd[0]`
    - `customFieldsJson` -> `finish_document_metadata.customFieldsJson`
  - include a compact list like:
    - `Invalid field: finish_document_metadata.tagIdsToAdd[0] — Expected number`
- Use the helper in the confirmation retry loop instead of the hardcoded block at `PiDocumentAgent.ts:2440-2449`.
- Preserve the current non-validation fallback text for verifier/application failures (`Tag ID 999 does not exist`, low confidence, ID/name mismatch, etc.), but label it as tool/verifier feedback rather than schema validation.
- Keep the correction concise and operational:
  - “Call exactly one final tool again.”
  - “Do not write prose.”
  - “Correct only the invalid fields; do not repeat invalid values.”

Tests:
- Extend `apps/backend/tests/agents/PiDocumentAgent.test.ts`.
- Import the new exported helper.
- Add a unit test with a representative Pi validation error string:
  ```text
  Validation failed for tool "finish_document_metadata":
    - tagIdsToAdd.0: Expected number
    - confidence: Expected number

  Received arguments:
  { ... }
  ```
  Assert the correction contains:
  - `finish_document_metadata.tagIdsToAdd[0]`
  - `Expected number`
  - `finish_document_metadata.confidence`
  - `call exactly one final tool` or equivalent.
- Add a fallback test for a non-schema error such as `Tag ID 999 does not exist.` to ensure verifier/tool feedback still appears.

## Validation commands

Targeted first:

```bash
pnpm --filter @repo/backend test -- tests/services/OllamaService.test.ts
pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts
pnpm --filter @repo/backend typecheck
```

Then broader safety:

```bash
pnpm run lint
pnpm run test
```

Optional manual smoke after implementation if Ollama is available:

```bash
curl -s http://localhost:11434/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"model":"<local-model>","messages":[{"role":"user","content":"Return {\"ok\": true} as JSON only"}],"stream":false,"format":"json"}'
```

## Implementation risks / constraints

- Do not add prompt files or resurrect `PromptService`.
- Native Ollama uses top-level `format`; do not put it inside `options`.
- OpenAI-compatible `/v1` uses `response_format`, but applying `response_format: { type: "json_object" }` to tool-call agents may conflict with function/tool call behavior. Prefer typed support plus native verifier JSON mode unless tested.
- Preserve deterministic `temperature: 0` and `seed` behavior for Pi document runs.
- Keep edits narrow; dynamic prompt budgets, few-shot examples, memory validation, and editable aliases are later W4-S17 milestones, not this one.

## Compact worker prompt for after W2-S6 finishes

Implement W4-S17 milestone 1 only. Add typed Ollama JSON/response format support without prompt files: extend `OllamaChatOptions` with top-level native `format?: "json" | object`, include it in `/api/chat` and `/api/generate` bodies for both streaming and non-streaming calls, and use `format: "json"` for the small-model metadata verifier in `PiDocumentAgent`. Add a typed helper in `piOllamaModel.ts` for OpenAI-compatible payload mutation (`response_format: { type: "json_object" }`) but do not force it on tool-calling Pi agents unless verified safe. Replace generic final-tool retry text in `PiDocumentAgent` with a helper that parses Pi/typebox validation error paths from failed final tool results and names fields such as `finish_document_metadata.tagIdsToAdd[0]`; keep a clear fallback for non-schema verifier/tool errors. Add focused tests in `OllamaService.test.ts` and `PiDocumentAgent.test.ts`. Validate with backend targeted tests, backend typecheck, then lint/test. Stop and ask if enabling `response_format` globally for Pi tool calls is required, because that may change tool-call behavior.