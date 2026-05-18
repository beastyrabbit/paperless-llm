# Todo #28 / W4-S17 handoff: retry correction text from validation error paths

## Scope / current behavior

No edits were made. The relevant implementation is concentrated in `apps/backend/src/agents/PiDocumentAgent.ts` plus Pi runtime validation in installed packages.

Current PiDocumentAgent already retries final-tool failures, but the retry prompt just embeds raw tool/verifier error text. The requested improvement should generate targeted correction text from TypeBox validation error paths such as `tagIdsToAdd.0` or `candidateName`.

## Key files and evidence

### Main agent

- `apps/backend/src/agents/PiDocumentAgent.ts`
  - Lines 321-359: helper functions for detecting tool calls and reading tool-result text.
  - Lines 465-471: final tools are only `request_human_decision` and `finish_document_metadata`; `isFinalToolResultMessage` filters tool-result messages for these tools.
  - Lines 473-500: `classifyFinalMetadataOutcome` fails the run if a final tool failed, no final tool was called, or no successful `finish_document_metadata` occurred for non-paused runs.
  - Lines 641-702: `normalizeFinishMetadataArguments` is the existing compatibility shim for final metadata args. It handles common aliases (`document_type_id`, `tag_ids_to_add`, `custom_fields`, etc.) before schema validation.
  - Lines 760-807: verifier prompt / low-confidence logic. This produces semantic rejection text, not TypeBox path errors.
  - Lines 1173-1197: `confirmMetadataBeforeApply` wraps verifier rejection in `AgentError: Small-model verifier rejected metadata: ...`.
  - Lines 1247-1294: tool TypeBox schemas. Most relevant paths:
    - `search_similar_documents`: `query: string`, optional `limit: number`.
    - `get_document`: `docId: number`.
    - `request_human_decision`: required `entityKind`, `candidateName`, `evidence`, `userQuestion`, `action`; optional `candidateId`, `alternatives`.
    - `finish_document_metadata`: optional `title`, `summary`, `correspondentId`, `correspondentName`, `documentTypeId`, `documentTypeName`, `tagIdsToAdd`, `tagNamesToAdd`, `tagIdsToRemove`, `customFieldsJson`, `linkedDocumentsJson`, `extractedFactsJson`, `reasoning`, `confidence`.
  - Lines 1488-1510: `finish_document_metadata` uses `executionMode: "sequential"` and `prepareArguments: normalizeFinishMetadataArguments`; the execute body also normalizes raw params before semantic verification/application.
  - Lines 1990-2022: system prompt contains final-tool, ID/name mismatch, broad type/tag, and secret-value guardrails.
  - Lines 2389-2403: `getFailedFinalToolError()` currently returns the latest failed final-tool result text, truncated to 1000 chars, excluding duplicate-final-tool blocker errors.
  - Lines 2411-2433: separate retry loop for prose/no-tool-call failures.
  - Lines 2436-2449: final-tool retry loop runs up to `settings.confirmationMaxRetries`, gets `finalToolError`, and sends a generic prompt:
    - “Your previous final metadata tool call was rejected.”
    - `Verifier feedback: ${finalToolError}`
    - asks for exactly one final tool again.

### Pi runtime validation behavior

- `apps/backend/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js`
  - Lines 317-328: if a tool has `prepareArguments`, Pi applies it before validation.
  - Lines 330-370: validation/prepare errors become immediate failed tool results (`isError: true`) without running the tool execute function.
  - Lines 364-368: error message text is used as the tool result content.
- `apps/backend/node_modules/@earendil-works/pi-ai/dist/utils/validation.js`
  - Lines 220-230: formats TypeBox instance paths as dot paths (`/tagIdsToAdd/0` -> `tagIdsToAdd.0`; root -> `root`; required properties use the missing property name).
  - Lines 253-279: validation error message shape is exactly:
    ```text
    Validation failed for tool "<toolName>":
      - <path>: <message>
      - <path>: <message>

    Received arguments:
    { ...original args... }
    ```
  - Lines 254-256: uses `Value.Convert` before validation, so many primitive strings may be coerced to numbers. The final metadata `prepareArguments` also normalizes aliases before this.
- `apps/backend/node_modules/@earendil-works/pi-agent-core/dist/types.d.ts`
  - Lines 295-304: `AgentTool.prepareArguments?: (args: unknown) => Static<TParameters>`; execute receives validated params.

### Tests

- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
  - Lines 1-15: imports exported helper functions from `PiDocumentAgent.ts`; adding exported pure helpers fits the current test pattern.
  - Lines 67-86: existing tests for `normalizeFinishMetadataArguments` aliases/coercion.
  - Lines 89-141: verifier helper tests.
  - Lines 183-220: `normalizeHumanDecisionArguments` tests.
  - Lines 223-245: `classifyFinalMetadataOutcome` tests.

## Important patterns / constraints

- Do not reintroduce prompt-file or PromptService paths; all Pi agent instructions/tools/schemas are TypeScript-defined.
- Prefer pure exported helper functions in `PiDocumentAgent.ts` with unit tests in `PiDocumentAgent.test.ts`; existing tests already import helpers from this file.
- Validation errors from Pi are tool-result errors, not thrown process-level errors. For final tools they are visible to `getFailedFinalToolError()` and trigger the existing final-tool retry loop as long as `confirmationMaxRetries > 0`.
- `finalToolRef.current` is only set after successful `request_human_decision`/`finish_document_metadata`; validation failures do not set it, so retries are allowed.
- Do not depend on internals of `node_modules` at runtime beyond parsing the documented/current error string. If possible, make parsing tolerant and fall back to the raw error text.
- The existing retry loop labels every final tool failure as `Verifier feedback`; this is inaccurate for TypeBox/schema errors and runtime semantic errors like missing catalog IDs. Rename/adjust the generated text to avoid implying the small-model verifier produced schema feedback.

## Suggested implementation design

Add small exported pure helpers near existing message/tool-result helpers in `PiDocumentAgent.ts`, then use them at lines 2440-2449.

Recommended helper shape:

```ts
export interface ToolValidationIssue {
  path: string;
  message: string;
}

export interface ToolValidationFeedback {
  toolName: string;
  issues: ToolValidationIssue[];
}

export const parseToolValidationFeedback = (text: string): ToolValidationFeedback | null => { ... };
export const buildRetryCorrectionFromFinalToolError = (errorText: string): string => { ... };
```

Parsing rules:
- Match `Validation failed for tool "...":`.
- Parse lines that match `  - <path>: <message>` until `Received arguments:`.
- Return `null` if shape does not match or no issues parse.
- Keep `path` exactly as Pi formats it (`root`, `tagIdsToAdd.0`, etc.) so tests are stable.

Correction generation:
- Always preserve the raw error or at least include concise “Tool validation feedback:” lines so no diagnostic detail is lost.
- For validation errors, add targeted field guidance derived from paths.
- Suggested path-to-guidance map:
  - `request_human_decision.candidateName` / `candidateName`: provide a concrete candidate name; do not put it only in `userQuestion`.
  - `request_human_decision.entityKind` / `entityKind`: must be one of `correspondent`, `document_type`, `tag`.
  - `request_human_decision.action` / `action`: must be one of `create`, `map`, `edit`, `skip`, `reject`.
  - `request_human_decision.evidence` / `evidence`: provide source evidence from the current document.
  - `request_human_decision.userQuestion` / `userQuestion`: provide the user-facing question.
  - `finish_document_metadata.tagIdsToAdd.*` and `tagIdsToRemove.*`: use arrays of numeric existing Paperless tag IDs, not names/objects.
  - `finish_document_metadata.tagNamesToAdd.*`: use strings only; prefer existing tag IDs when known; unknown names may pause for human review.
  - `finish_document_metadata.correspondentId` / `documentTypeId` / `candidateId` / `docId` / `limit` / `confidence`: use numbers, not labels/objects; confidence must be 0.0-1.0.
  - `finish_document_metadata.correspondentName` / `documentTypeName` / `title` / `summary` / `reasoning`: use strings.
  - `customFieldsJson`, `linkedDocumentsJson`, `extractedFactsJson`: pass a JSON string (or a JSON-compatible object only if normalize shim accepts it before validation; safer prompt wording: “valid JSON string”).
  - `root`: call the real final tool with an object matching its schema, not prose/pseudo-tool JSON.
- For non-validation final-tool errors (verifier, semantic catalog checks), keep current semantic retry instructions but change wording to `Tool/verifier feedback:` or `Final tool feedback:`.

Minimal integration change:

```ts
const correction = buildRetryCorrectionFromFinalToolError(finalToolError);
yield* runPrompt(correction);
```

where the helper returns the existing generic content plus validation-specific lines when parse succeeds.

Example desired validation correction text:

```text
Your previous final metadata tool call was rejected.
Tool validation feedback:
- tagIdsToAdd.0: Expected number
- candidateName: Expected required property
Correction requirements:
- tagIdsToAdd must be an array of numeric existing Paperless tag IDs. Do not put tag names or objects there.
- request_human_decision requires candidateName as a concrete string; do not put the candidate only in userQuestion.
Revise the arguments and call exactly one final tool again.
If a human must decide, call request_human_decision with a concrete candidateName, evidence, and userQuestion.
Otherwise call finish_document_metadata with corrected metadata and confidence.
Do not write prose.
```

## Test plan

Add unit tests to `apps/backend/tests/agents/PiDocumentAgent.test.ts` importing the new helpers.

Recommended tests:
1. `parseToolValidationFeedback` parses Pi validation message:
   - Input:
     ```text
     Validation failed for tool "finish_document_metadata":
       - tagIdsToAdd.0: Expected number
       - confidence: Expected number

     Received arguments:
     {"tagIdsToAdd":["Finance"],"confidence":"high"}
     ```
   - Expect `{ toolName: "finish_document_metadata", issues: [...] }`.
2. `buildRetryCorrectionFromFinalToolError` for `tagIdsToAdd.0` includes “numeric existing Paperless tag IDs” and “call exactly one final tool again”.
3. Required field path for `request_human_decision` (`candidateName: Expected required property`) includes “concrete candidateName”.
4. Non-validation error fallback (e.g. `Small-model verifier rejected metadata: ...`) includes the raw feedback and generic final-tool retry instructions, without schema-specific guidance.
5. Optional: dedupes guidance when multiple paths map to the same rule.

Validation commands:
- Targeted: `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`
- Typecheck: `pnpm --filter @repo/backend typecheck`
- If time: `pnpm --filter @repo/backend lint`

## Risks / edge cases

- Validation format is from `@earendil-works/pi-ai@^0.74.0`; future package changes could alter text. Parser must fall back safely.
- `Value.Convert` and `normalizeFinishMetadataArguments` may prevent some type errors from surfacing; tests should focus on parsing/generation helpers, not on causing live Pi validation failures.
- The retry loop uses `confirmationMaxRetries`; if configured to 0, validation failures will not get a retry. This task likely does not require changing that setting semantics.
- Avoid over-instructing the model to use JSON strings for fields where the normalize shim can accept objects; however, the actual TypeBox schema at validation time requires strings after preparation, so “valid JSON string” is safe.

## Compact worker prompt

Implement Todo #28 in `apps/backend/src/agents/PiDocumentAgent.ts`: add exported pure helpers that parse Pi TypeBox validation error text (`Validation failed for tool "...":` with `- path: message` lines) and build targeted retry correction text from validation paths. Use the helper in the existing final-tool retry loop around lines 2436-2449 so validation failures for `request_human_decision` and `finish_document_metadata` get field-specific correction guidance while non-validation verifier/tool errors still get generic retry guidance with raw feedback preserved. Add unit tests in `apps/backend/tests/agents/PiDocumentAgent.test.ts` for parsing, path-specific guidance (`tagIdsToAdd.0`, `confidence`, `candidateName`), fallback behavior, and deduping. Do not edit prompt files or add PromptService paths. Validate with `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts` and `pnpm --filter @repo/backend typecheck`.
