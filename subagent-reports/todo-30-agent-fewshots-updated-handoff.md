# Todo #30 / W4-S17 updated handoff: agent few-shot examples after prompt-budget changes

Scope: refresh the implementation handoff for adding few-shot examples to TypeScript-defined Pi agent prompts after dynamic prompt content budgeting landed. No source files were edited while gathering this context.

## Requirement / source of truth

- `docs/plans/audit-rework-tasks.md:323-330`: W4-S17 includes “Add few-shot examples to each agent.”
- `docs/AUDIT.md:229`: Q7 says prompts have no few-shot examples; add 2-3 German/English examples per agent.
- `AGENTS.md`: Pi agent instructions, tools, schemas, and structured placeholders must stay in TypeScript. Do **not** add prompt files or reintroduce `PromptService`.
- Previous handoff: `subagent-reports/todo-30-agent-fewshots-handoff.md` remains mostly valid, but line numbers and budget behavior changed.
- Prompt-budget worker: `subagent-reports/w4-s17-prompt-budget-worker.md` says dynamic content budgeting is now implemented for document/verifier/tag prompts, using shared helpers and Ollama defaults.

## Budgeting changes now in the codebase

### Shared helpers

`apps/backend/src/utils/promptData.ts:15-68`

- `PromptContentBudgetInput` includes `contextWindowTokens`, `reservedOutputTokens`, `staticPromptText`, `maxExcerptChars`, optional `minExcerptChars`, `safetyMarginTokens`, `charsPerToken`.
- Defaults: `DEFAULT_CHARS_PER_TOKEN = 3`, `DEFAULT_SAFETY_MARGIN_TOKENS = 1_024` (`promptData.ts:25-26`).
- `computeContentExcerptCharBudget(...)` estimates static prompt tokens from `staticPromptText`, subtracts reserved output + safety margin, and clamps the excerpt to `[minExcerptChars, maxExcerptChars]` (`promptData.ts:33-63`).
- `formatUntrustedDocumentText(...)` still wraps excerpts with `<<<UNTRUSTED_DOCUMENT_DATA_START>>>` / `<<<UNTRUSTED_DOCUMENT_DATA_END>>>` (`promptData.ts:1-13`).

`apps/backend/src/agents/piOllamaModel.ts:14-35`

- `DEFAULT_OLLAMA_CONTEXT_WINDOW = 32_000`.
- `DEFAULT_OLLAMA_MAX_TOKENS = 4_096`.
- `buildOllamaModel` uses those defaults for local Ollama OpenAI-compatible Pi agents.

### Current tests for budgeting

- `apps/backend/tests/utils/promptData.test.ts:9-63`: verifies budget shrinks with larger static prompt, clamps to max, never returns negative, and preserves untrusted delimiters.
- `apps/backend/tests/agents/PiDocumentAgent.test.ts:244-270+`: verifier prompt test confirms excerpts shrink under constrained context.

## Exact insertion points and constraints by agent

### 1) `PiDocumentAgent`

Relevant current code:

- Imports budget helpers at `apps/backend/src/agents/PiDocumentAgent.ts:25-37`.
- Existing exported pure helpers end before `PiDocumentAgentServiceLive` starts at `PiDocumentAgent.ts:1090`.
- `buildSystemPrompt(promptLanguage)` is currently nested inside the live layer at `PiDocumentAgent.ts:2250-2282`.
- `buildUserPrompt(...)` is at `PiDocumentAgent.ts:2284-2399`.
- User prompt payload already includes `required_tool_sequence` at `PiDocumentAgent.ts:2312-2329` and live document JSON at `PiDocumentAgent.ts:2332-2369`.
- Dynamic document excerpt budget is computed at `PiDocumentAgent.ts:2387-2396` using `staticPromptText = [buildSystemPrompt(promptLanguage), buildPromptForExcerpt(emptyExcerpt)].join("\n")`; final excerpt is inserted at `PiDocumentAgent.ts:2398`.
- Pi agent receives `initialState.systemPrompt: buildSystemPrompt(settings.promptLanguage)` at `PiDocumentAgent.ts:2506`.

Exact insertion recommendation:

1. Add exported pure helper(s) **before** `export const PiDocumentAgentServiceLive = Layer.effect(` at `PiDocumentAgent.ts:1090`, e.g. `export const buildDocumentAgentFewShotExamples = (promptLanguage: string): string => ...` or a typed `ReadonlyArray` plus `JSON.stringify` helper.
2. Include the helper in the `buildSystemPrompt` array between `buildPromptLanguageInstruction(promptLanguage)` (`PiDocumentAgent.ts:2254`) and `"A text-only answer is invalid."` (`PiDocumentAgent.ts:2255`), or immediately before the final untrusted instruction (`PiDocumentAgent.ts:2280`). Prefer after language so the examples can be localized/labelled and before hard constraints so constraints remain close to the final tool rules.
3. Do **not** put long examples inside `document.content_excerpt`; that field is for current untrusted input only.

Recommended examples, compact and tool-shaped (2-3 total):

- Existing catalog apply: current document evidence matches existing correspondent/type/tag IDs; final call is `finish_document_metadata` with matching ID/name pairs and confidence.
- Current document beats similar docs: similar docs suggest stale/wrong type/tag, current filename/header/letterhead wins; final call still uses existing IDs from current catalog.
- New catalog entity needed: no exact existing broad entity; final call is `request_human_decision` with concrete `entityKind`, `candidateName`, `evidence`, `userQuestion`, `action`; do not emit a new tag/type/correspondent directly.

Budget consideration after budget changes:

- Because insertion into `buildSystemPrompt` is included in `staticPromptText` (`PiDocumentAgent.ts:2387-2390`), the dynamic excerpt budget automatically accounts for the added examples.
- Added static text reduces available excerpt budget by roughly its character length when the prompt is context-constrained (3 chars/token estimate); when there is still room, the max remains 12,000 chars (`PiDocumentAgent.ts:2395`).
- Keep the document-agent few-shot block around **1.5 KB max**. Do not add sample full documents. Use one-line synthetic snippets.
- Clearly label example IDs as synthetic and only valid within examples, otherwise the local model may copy them.

### 2) `PiTagExplorerAgent`

Relevant current code:

- `buildPromptWithExcerpt(input, promptLanguage, contentExcerpt)` is nested at `apps/backend/src/agents/PiTagExplorerAgent.ts:263-295`.
- Rules require exactly one `finish_tag_exploration` call, existing broad tags, no secret-code tags, no direct user questions (`PiTagExplorerAgent.ts:269-279`).
- `Input JSON:` starts at `PiTagExplorerAgent.ts:280`; live document/catalog/similar-doc JSON is at `PiTagExplorerAgent.ts:281-294`.
- Dynamic tag excerpt budget is computed at `PiTagExplorerAgent.ts:297-307` using `staticPromptText = [systemPrompt, buildPromptWithExcerpt(emptyExcerpt)]`; final excerpt is inserted at `PiTagExplorerAgent.ts:309-313`.
- System prompt is minimal at runtime: `"You are a read-only tag exploration micro-agent."` (`PiTagExplorerAgent.ts:326`).

Exact insertion recommendation:

1. Add exported pure helper(s) near the top-level utility functions before `PiTagExplorerAgentServiceLive`, e.g. before `export const PiTagExplorerAgentServiceLive = Layer.effect(` around `PiTagExplorerAgent.ts:104`.
2. Include a `Few-shot examples:` / `few_shot_examples` block in the array inside `buildPromptWithExcerpt`, immediately **before** `"Input JSON:"` at `PiTagExplorerAgent.ts:280`.
3. Keep examples read-only; never include `request_human_decision` here because this micro-agent only has `finish_tag_exploration`.

Recommended examples (2-3 total):

- Use existing broad tag by ID: catalog has broad stable tag (e.g. synthetic `{id: 12, name: "Versicherung"}`); final tool `finish_tag_exploration({ tagIdsToAdd: [12], newTagProposal: null, ... })`.
- Reject narrow/secret code tag: document contains an activation/PIN/access code; do not propose a tag containing the actual code; use `rejectedTagIdeas` and `newTagProposal: null`.
- No fitting broad tag: weak evidence/no broad existing tag; return no additions rather than inventing a narrow label.

Budget consideration after budget changes:

- Insertion before `Input JSON` is included in `staticPromptText` through `buildPromptWithExcerpt(emptyExcerpt)` (`PiTagExplorerAgent.ts:298-301`), so the document content excerpt is dynamically reduced when necessary.
- Max tag content excerpt remains 10,000 chars (`PiTagExplorerAgent.ts:306`).
- Keep tag explorer examples **≤1 KB total** because this agent runs inside document processing when tags are enabled, multiplying latency/cost.

### 3) `PiConsolidationAgent`

Relevant current code:

- Tool `get_catalog_snapshot` returns a formatted untrusted snapshot capped at 40,000 chars (`apps/backend/src/agents/PiConsolidationAgent.ts:315-322`).
- `finish_consolidation_report` returns human-reviewable report only; it never applies changes (`PiConsolidationAgent.ts:325-349`).
- `buildPrompt(snapshot)` starts at `PiConsolidationAgent.ts:354`.
- Initial prompt JSON contains `agent`, `instructions`, `untrusted_catalog_payload`, and `required_final_tool` (`PiConsolidationAgent.ts:368-382`).
- Initial `untrusted_catalog_payload` is capped at 12,000 chars (`PiConsolidationAgent.ts:380`).
- Runtime system prompt reinforces review-only behavior (`PiConsolidationAgent.ts:473-483` in current file; recheck before editing).

Exact insertion recommendation:

1. Add exported pure helper(s) before `PiConsolidationAgentServiceLive`, e.g. near type/helper definitions before the live layer begins around `PiConsolidationAgent.ts:119`.
2. Add a `few_shot_examples` property to the JSON object returned by `buildPrompt`, **between** `instructions` (`PiConsolidationAgent.ts:371-379`) and `untrusted_catalog_payload` (`PiConsolidationAgent.ts:380`). This preserves the current JSON prompt shape and keeps examples before live untrusted catalog data.
3. Add a reminder in or near examples: examples are synthetic; real proposals must use only IDs from the actual snapshot.

Recommended examples (2-3 total):

- Merge near-duplicate tags/correspondents: `action: "merge"`, source IDs into target ID, includes confidence/reasoning/affected count.
- Rename: `action: "rename"`, one actual attribute ID and `proposedName`. Risk: sanitizer has non-obvious rename handling; see below.
- Weak evidence: `action: "needs_review"` or `"keep_separate"`, showing that similar names alone are not enough for merge/delete; never include workflow tags.

Budget consideration after budget changes:

- Consolidation initial prompt does **not** use `computeContentExcerptCharBudget`; it still uses fixed `formatUntrustedDataBlock(catalogPayload, 12_000)` and `get_catalog_snapshot` can return 40,000 chars.
- Keep consolidation examples **≤1.2-1.5 KB**. If examples grow beyond that, reduce the initial `untrusted_catalog_payload` cap from 12,000 to roughly 11,000 to keep initial prompt size stable, but prefer compact examples instead.
- Since this is manual/scheduled, latency is less sensitive than document/tag explorer, but local 32k context still applies.

## Testing plan

Add/export minimal pure helpers rather than testing through live Pi/Ollama.

Suggested test files:

- Existing: `apps/backend/tests/agents/PiDocumentAgent.test.ts` already imports many pure helpers from `PiDocumentAgent.ts`; add document few-shot tests there.
- New: `apps/backend/tests/agents/PiTagExplorerAgent.test.ts` for tag explorer few-shot helper/prompt helper.
- New: `apps/backend/tests/agents/PiConsolidationAgent.test.ts` for consolidation few-shot helper/prompt JSON helper.

Assertions to include:

- Document examples include `finish_document_metadata`, `request_human_decision`, `search_similar_documents`/tool-order reminder, confidence, and no secret-like concrete code values.
- Tag examples include `finish_tag_exploration`, `newTagProposal: null`, rejected narrow/secret idea pattern, and no user-question/request-human-decision wording.
- Consolidation examples include `finish_consolidation_report` or proposal-shaped objects with `merge`, `rename`, and `needs_review`/`keep_separate`; reinforce review-only and real snapshot IDs.
- Bounded length checks: document ≤ ~1,500 chars, tag ≤ ~1,000 chars, consolidation ≤ ~1,500 chars (or agreed constants).
- Budget regression: for document/tag prompt helper if exported, build a constrained-context prompt or directly call `computeContentExcerptCharBudget` with static text before/after examples to prove added static text shrinks excerpts and delimiters remain. At minimum, assert examples are part of the same static prompt passed to budget computation by testing exported prompt builders.
- JSON validity: if consolidation examples are inserted into `JSON.stringify` output, parse the prompt and assert `few_shot_examples` exists and `untrusted_catalog_payload` remains delimited.

Note: `sanitizeProposal` for rename excludes `targetId` from `sourceIds` before rename fallback (`PiConsolidationAgent.ts:208-218`). For a rename example, prefer a shape that survives sanitization, or add/adjust tests once helper export permits invoking the sanitizer or report finish path.

## Validation commands

Targeted:

```bash
pnpm --filter @repo/backend test -- tests/utils/promptData.test.ts tests/agents/PiDocumentAgent.test.ts tests/agents/PiTagExplorerAgent.test.ts tests/agents/PiConsolidationAgent.test.ts
pnpm --filter @repo/backend lint
```

If test files differ:

```bash
pnpm --filter @repo/backend test -- tests/agents
```

Typecheck should be attempted, but the prompt-budget worker reported an unrelated current failure:

```text
src/api/index.ts(42,3): error TS2305: Module '"@repo/api-contracts"' has no exported member 'generateOpenApiDocument'.
```

So run and report status:

```bash
pnpm --filter @repo/backend typecheck
```

## Risks / implementation notes

- Working tree is very active; many files are modified/untracked. Recheck line numbers before editing and preserve existing changes.
- Do not add external prompt files, markdown prompts, or `PromptService`.
- Do not let examples duplicate or weaken untrusted-data instructions. Synthetic snippets should be clearly labeled trusted examples/patterns; live document/catalog payloads remain untrusted.
- Avoid actual production IDs or user data in examples. Use synthetic IDs and explicitly state they are valid only inside the example.
- Keep examples tool-call-shaped, not prose-only, because all three agents require final tool calls.

## Compact worker prompt

Implement W4-S17 Todo #30 only: add compact TypeScript-defined few-shot examples for `PiDocumentAgent`, `PiTagExplorerAgent`, and `PiConsolidationAgent`. Do not add prompt files or PromptService paths. Insert examples before live dynamic/untrusted input: document examples in/near `buildSystemPrompt`, tag examples before `Input JSON`, consolidation examples as `few_shot_examples` in the JSON prompt before `untrusted_catalog_payload`. Keep examples synthetic, tool-call/proposal-shaped, and bounded (doc ~1.5KB, tag ~1KB, consolidation ~1.5KB). Preserve all guardrails: required final tools, current document beats similar docs, no workflow tags, no secret values, existing broad catalog entities preferred, new entities require review/proposal, consolidation is review-only. Export minimal pure helpers only as needed for Vitest coverage. Validate with targeted agent/prompt-budget tests, lint, and typecheck (report known unrelated typecheck failure if still present).