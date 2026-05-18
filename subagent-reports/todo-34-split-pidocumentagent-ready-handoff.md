# Todo #34 / W4-S18 — PiDocumentAgent concern split ready handoff

## Scope and current state

Task is a **final implementation handoff only**. Do not edit production/test code in this pass. The target file is `apps/backend/src/agents/PiDocumentAgent.ts`, currently a ~2.9k-line module mixing public service contracts, prompt construction, few-shot examples, prompt-budgeting, metadata verification, memory/resume audit helpers, tool schemas/executors, Paperless mutation logic, and the Pi orchestration loop.

Project invariant from `AGENTS.md`: Pi agent instructions, tools, schemas, and structured placeholders must remain TypeScript-defined. Do **not** reintroduce PromptService or prompt-file-driven processing.

## Relevant files and high-value evidence

### Main file: `apps/backend/src/agents/PiDocumentAgent.ts`

- Lines 7-41: imports. The file currently depends on `@earendil-works/pi-agent-core`, `effect`, `typebox`, models/services, prompt/tag-language utils, `runConfirmationLoop`, `PiTagExplorerAgentService`, and `piOllamaModel`.
- Lines 43-89: public service/input/result contracts and `PiDocumentAgentService` Context tag. Keep these stable for import compatibility.
- Lines 91-102: private `EntityKind`, `HumanDecisionAction`, `defaultMetadataPolicy`.
- Lines 110-266: JSON parsing, field assignment parsing, entity normalization, workflow-tag filtering, catalog-field assignment parsing. Some helpers are exported and covered by tests.
- Lines 302-327: document search/summarization prompt helpers.
- Lines 330-368: Pi message/tool-call inspection helpers.
- Lines 370-491: TypeBox validation feedback parsing and retry-correction prompt builder. Exported helpers are tested.
- Lines 493-624: applied-metadata audit, deterministic seed, stable metadata equality. Exported helpers are tested.
- Lines 626-667: final tool classification/policy helpers. `classifyFinalMetadataOutcome` is exported and tested.
- Lines 699-864: `normalizeHumanDecisionArguments` and `normalizeFinishMetadataArguments`. Both exported and tested.
- Lines 868-1005: metadata verifier context, verifier response parsing, verifier prompt construction, low-confidence gate. Exported verifier helpers are tested.
- Lines 1007-1091: sensitive metadata/tag guardrails and public title normalization. Exported guardrail helpers are tested.
- Lines 1093-1128: `buildDocumentAgentFewShotExamples`, compact TypeScript few-shot examples. Exported and tested.
- Lines 1130-1140: `PiDocumentAgentServiceLive` begins and captures dependencies (`ConfigService`, `PaperlessService`, `ConcurrencyLimitService`, `OllamaService`, `TinyBaseService`, `DocumentCaseService`, `PiTagExplorerAgentService`, `tagConfig`).
- Lines 1163-1225: runtime settings loader from TinyBase/config/env.
- Lines 1227-1360: `queueHumanDecision`; resolves candidate entities, creates case questions, logs, transitions workflow tags, appends summaries.
- Lines 1362-1500: small-model verifier runtime (`logVerificationResult`, `verifyMetadataProposal`, `confirmMetadataBeforeApply`). It uses `buildMetadataVerifierPrompt`, `OllamaService.chat`, `runConfirmationLoop`, and processing logs.
- Lines 1502-2288: `createTools` closure defines TypeBox schemas and five Pi tools: `search_similar_documents`, `get_document`, `explore_tags`, `request_human_decision`, `finish_document_metadata`. This is the largest concern and closes over services, `tagConfig`, `queueHumanDecision`, verifier functions, refs, dry-run policy, prompt language, etc.
- Lines 1799-2278: `finish_document_metadata` executor contains deterministic Paperless mutations and staged human-review behavior. Notable invariants: verify before apply; existing ID/name conflict queues review; unknown catalog entities queue review; workflow tags cannot be changed; custom fields/document links use catalog field IDs/names; resume protection skips overwrites; summary is added as note; extracted facts/final decisions are patched into memory/case.
- Lines 2290-2440: document-agent system/user prompt builders, including few-shot examples, required tool sequence, untrusted data delimiters, and content excerpt budgeting.
- Lines 2442-2918: `processDocument` orchestration: loads doc/settings/case+legacy memory, computes seeds, fetches catalogs, filters workflow tags, creates PiAgent, records events, builds prompt, runs prompt with timeout/metrics, persists run context/logs, retries missing final tool or failed final tool, classifies final outcome, persists messages/final decisions/run summary, returns `DocumentAgentResult`.

### Tests: `apps/backend/tests/agents/PiDocumentAgent.test.ts`

Current tests import helpers directly from `../../src/agents/PiDocumentAgent.js` (lines 1-19). Preserve these exports either by re-exporting from `PiDocumentAgent.ts` or by updating tests/imports in a focused way.

Covered concerns:
- `buildOllamaPiPayload` deterministic seed/temperature/JSON-format behavior (lines 26-56).
- `parseFieldAssignmentsJson` object/array JSON and malformed JSON behavior (lines 58-91).
- Few-shot compactness/safety (lines 93-105).
- Prompt data boundaries via `formatUntrustedDocumentText` (lines 107-115).
- Final metadata argument normalization (lines 117-137).
- Retry correction feedback parsing/building (lines 139-203).
- Metadata verifier parsing, low-confidence gate, prompt delimiter and excerpt shrink behavior (lines 205-291).
- Resume audit/overwrite protection and deterministic seed (lines 293-330).
- Human decision argument normalization (lines 332-370).
- Final outcome classification (lines 372-395).
- Secret/tag guardrails and redaction (lines 397-463).

### Import consumers to preserve

- `apps/backend/src/agents/index.ts` lines 69-75 re-export `DocumentAgentInput`, `DocumentAgentResult`, `PiDocumentAgentService`, `PiDocumentAgentServiceLive` from `./PiDocumentAgent.js`.
- `apps/backend/src/layers/index.ts` lines 5-11 import `PiDocumentAgentServiceLive` from agents index, and lines 76-79 merge it with OCR/consolidation plus `DocumentCaseServiceLive`/`PiTagExplorerAgentServiceLive`.
- `apps/backend/src/agents/ProcessingPipeline.ts` lines 25-29 import `DocumentAgentRuntimeEvent`, `MetadataPolicy`, and `PiDocumentAgentService`; line 185 consumes the service.
- Tests and pipeline currently assume `PiDocumentAgent.ts` remains the public module path.

### Adjacent patterns/dependencies

- `apps/backend/src/agents/piOllamaModel.ts` lines 14-35 define Ollama context/max tokens and model compatibility; lines 56-80 define gated stream helper using `ConcurrencyLimitService`. `PiDocumentAgent.ts` imports these and should continue to use them from this module.
- `apps/backend/src/agents/base.ts` defines `ConfirmationResult` and `runConfirmationLoop`; verifier runtime uses this shared confirmation pattern.
- Root `package.json` scripts: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test`; backend package has `pnpm --filter @repo/backend typecheck`, `lint`, `test`.

## Safe staged extraction plan

Recommended approach is a **behavior-preserving, staged extraction** where `PiDocumentAgent.ts` remains the facade/public entry point until all imports settle. Avoid changing logic and tests in the same step where possible.

### Stage 0 — Baseline and guardrail check

1. Run a focused baseline if time allows:
   - `pnpm --filter @repo/backend test -- PiDocumentAgent.test.ts`
   - `pnpm --filter @repo/backend typecheck`
2. Note any existing failures separately; do not conflate with extraction.

### Stage 1 — Extract pure types/helpers with re-exports

Create modules under `apps/backend/src/agents/document/` or similar. Suggested files:

- `types.ts`
  - Move/export `DocumentAgentInput`, `MetadataPolicy`, `DocumentAgentRuntimeEvent`, `DocumentAgentResult`, `EntityKind`, `HumanDecisionAction`, `AppliedMetadataFieldAudit`, `AppliedMetadataAudit`, `ToolValidationIssue`, `ToolValidationFeedback`, and `FinishMetadataArguments` if needed.
  - If `EntityKind`/`HumanDecisionAction` remain internal, still centralize if shared by tools/review modules.

- `metadataParsing.ts`
  - Move JSON/field/catalog parsing and argument normalization: `parseFieldAssignmentsJson`, `normalizeEntityKey`, `normalizeHumanDecisionArguments`, `normalizeFinishMetadataArguments`, plus private helpers (`parseJsonValue`, `parseJsonObject`, `pickRecordValue`, `parseFieldId`, `normalizeName`, `findByNormalizedName`, etc.) as needed.
  - Export only functions currently tested or required by other extracted modules. Keep private helper exports minimal.

- `memoryAudit.ts`
  - Move `metadataValuesEqual`, `readAppliedMetadataAudit`, `mergeAppliedMetadataAudit`, `getResumeProtectedMetadataKeys`, `updateKeyForAppliedMetadataKey`.

- `piPayload.ts` or `runtimePayload.ts`
  - Move `buildOllamaPiPayload`, `computeDeterministicModelSeed`, Pi message helpers (`hasToolCall`, `getToolCallNames`, `getAssistantPreview`, `getToolResultText`, final tool helpers/classifier), and retry correction helpers if not placed separately.

Important: keep `PiDocumentAgent.ts` re-exporting all helpers that tests currently import. This avoids a broad test-import churn during extraction.

### Stage 2 — Extract prompt/few-shot/budget concern

Suggested file: `documentPrompts.ts`.

Move:
- `buildDocumentAgentFewShotExamples`.
- `buildSystemPrompt` and `buildUserPrompt` from inside `PiDocumentAgentServiceLive`.
- Document prompt helpers: `getSourceFileName`, `getContentHeading`, `buildDocumentSearchQuery`, `summarizeDocumentForAgent` if shared with tools; otherwise place summarization in tools module and keep search-query in prompts.

Inputs needed for exported prompt builders:
- `Document`, `MetadataPolicy`, `AppliedMetadataAudit`, catalogs, resume flag, document tags, prompt language.
- Constants from `piOllamaModel.ts`: `DEFAULT_OLLAMA_CONTEXT_WINDOW`, `DEFAULT_OLLAMA_MAX_TOKENS`.
- Prompt utilities: `computeContentExcerptCharBudget`, `formatUntrustedDocumentText`, `UNTRUSTED_DOCUMENT_DATA_INSTRUCTION`.
- `buildPromptLanguageInstruction`.

Constraint: few-shot/prompt-budget/memory changes are recent; do not regress compact examples, untrusted-data boundaries, required tool sequence, or dynamic content excerpt budgeting.

### Stage 3 — Extract metadata verifier concern

Suggested file: `metadataVerifier.ts`.

Move:
- `MetadataVerifierContext`, `parseMetadataVerificationResponse`, `getLowConfidenceFeedback`, `METADATA_VERIFIER_SYSTEM_PROMPT`, `METADATA_VERIFIER_RESERVED_OUTPUT_TOKENS`, `buildMetadataVerifierPrompt`, prompt-with-excerpt helper.
- Runtime functions currently inside live layer: `logVerificationResult`, `verifyMetadataProposal`, `confirmMetadataBeforeApply`.

Make a factory to avoid module-level service globals, e.g. `makeMetadataVerifier({ ollama, tinybase })` returning `confirmMetadataBeforeApply`, or export functions that accept dependencies explicitly. Keep `AgentError` wrapping and logging behavior unchanged.

Do not move verifier prompt strings to files. Keep TypeScript constants.

### Stage 4 — Extract sensitive metadata guardrails

Suggested file: `metadataSafety.ts`.

Move:
- `isUnsafeGeneratedTagName`, `redactSensitiveMetadataText`, `normalizePublicTitle`, keyword regex constants, `isSecretLikeMetadataValue`.

Keep `normalizePublicTitle` exported if needed by tools module. Tests currently import `isUnsafeGeneratedTagName` and `redactSensitiveMetadataText` via `PiDocumentAgent.ts` facade.

### Stage 5 — Extract tool schemas/executors

Suggested files:
- `documentTools.ts`: TypeBox schemas and `createDocumentAgentTools`.
- `metadataApply.ts` (optional but strongly recommended): deterministic mutation logic from `finish_document_metadata` executor.
- `humanDecisionQueue.ts`: `queueHumanDecision` and candidate resolution/review logging/tag transition behavior.

Safer minimal split:
1. Move `queueHumanDecision` to `humanDecisionQueue.ts` with explicit deps: `paperless`, `tinybase`, `cases`, `tagConfig`, `dryRun` as function parameters/context.
2. Move `createTools` to `documentTools.ts`; keep finish executor logic inside initially if reducing risk, but pass explicit deps object:
   - `paperless`, `tinybase`, `cases`, `tagExplorer`, `tagConfig`
   - `confirmMetadataBeforeApply`
   - refs: `pausedRef`, `appliedRef`, `finalToolRef`
   - `doc`, `sessionId`, `dryRun`, `metadataPolicy`, `promptLanguage`, `verifierContext`
3. Then optionally extract apply logic to `metadataApply.ts` after tests pass, with a return type representing `{ applied, paused, error? }` and any staged-review result.

Critical invariants in tools/apply logic:
- TypeBox schemas must stay TypeScript-defined.
- `request_human_decision` requires concrete candidate/evidence/userQuestion and blocks open-ended tag questions.
- Unknown/mismatched catalog entities queue human review instead of creating entities.
- Workflow tags (`llm-*` and configured workflow tag names) cannot be changed.
- `finish_document_metadata` verifies before applying.
- Summary note failures are logged as warnings without rolling back already applied metadata.
- Resume protection prevents overwriting prior decisions.
- `finalToolRef` prevents multiple final actions; final tools terminate.

### Stage 6 — Slim `PiDocumentAgent.ts` facade/service

After extraction, `PiDocumentAgent.ts` should ideally contain:
- Public service interfaces/tag and `PiDocumentAgentServiceLive` implementation.
- Imports of extracted helpers/factories.
- Re-exports for test/public compatibility:
  - `buildDocumentAgentFewShotExamples`, `buildMetadataVerifierPrompt`, `buildOllamaPiPayload`, `buildRetryCorrectionFromFinalToolError`, `classifyFinalMetadataOutcome`, `computeDeterministicModelSeed`, `getLowConfidenceFeedback`, `getResumeProtectedMetadataKeys`, `isUnsafeGeneratedTagName`, `mergeAppliedMetadataAudit`, `normalizeFinishMetadataArguments`, `normalizeHumanDecisionArguments`, `parseFieldAssignmentsJson`, `parseMetadataVerificationResponse`, `parseToolValidationFeedback`, `redactSensitiveMetadataText`.

Do not change `apps/backend/src/agents/index.ts` or layer imports unless absolutely necessary; the facade path should remain stable.

## Imports/tests update strategy

- Prefer adding new module imports into `PiDocumentAgent.ts` and preserving existing external imports from `./PiDocumentAgent.js`.
- If tests are split by concern, create new test files later (`metadataVerifier.test.ts`, `metadataSafety.test.ts`, etc.), but for this implementation handoff the safest validation is to keep current `PiDocumentAgent.test.ts` passing through facade re-exports.
- Watch for TypeScript `type` imports after extraction; many extracted modules can import model/service types only.
- Avoid circular imports. Extracted modules should not import from `PiDocumentAgent.ts`; `PiDocumentAgent.ts` imports/re-exports from them. Use `types.ts` as the shared type source.

## Validation plan

Run after each major stage, at minimum:

```bash
pnpm --filter @repo/backend test -- PiDocumentAgent.test.ts
pnpm --filter @repo/backend typecheck
```

Before final handoff:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend lint
pnpm run typecheck
```

If full backend tests are too slow, document that only the focused `PiDocumentAgent.test.ts` and backend typecheck were run.

## Implementation risks

- **Closure dependency risk:** `createTools`, verifier runtime, and `queueHumanDecision` currently close over many services and mutable refs. Use explicit dependency objects to avoid accidental behavior changes.
- **Circular import risk:** keep `PiDocumentAgent.ts` as facade only; extracted modules must import shared `types.ts`, not the facade.
- **Export compatibility risk:** current tests and possibly downstream code import helper exports from `PiDocumentAgent.ts`; preserve re-exports.
- **Recent prompt-budget/few-shot/memory changes risk:** tests cover prompt excerpt shrink, untrusted boundaries, few-shot safety, resume audit. Do not alter prompt strings except due to unavoidable import formatting.
- **Behavioral mutation risk:** finish tool logic is stateful and side-effectful. Extract by copy/move with identical code first; refactor internals only after tests/typecheck pass.

## Final worker prompt

Use this prompt for the implementation worker:

> Implement a behavior-preserving split of `apps/backend/src/agents/PiDocumentAgent.ts` by concern. Keep `PiDocumentAgent.ts` as the public facade exporting `PiDocumentAgentService`, `PiDocumentAgentServiceLive`, public types, and all helper exports currently imported by `apps/backend/tests/agents/PiDocumentAgent.test.ts`. Do not introduce PromptService or prompt-file-driven processing; Pi instructions, tools, schemas, few-shot examples, and structured placeholders must remain TypeScript-defined.
>
> Suggested staged extraction: create shared `types.ts`; extract pure parsing/normalization, memory audit, Pi payload/final-tool helpers, metadata safety, metadata verifier/prompt-budget helpers, document prompt builders, human decision queueing, and document tool creation into concern-specific modules under `apps/backend/src/agents/document/` (or a similarly scoped directory). Make extracted modules import shared types directly and avoid importing from `PiDocumentAgent.ts` to prevent cycles. Pass services/refs via explicit dependency objects for verifier, human-decision queue, and tools.
>
> Preserve behavior from current line ranges: public contracts lines 43-89; parsing/normalization lines 110-266 and 699-864; retry/final outcome helpers lines 370-491 and 626-660; memory audit lines 493-624; verifier lines 868-1005 and 1362-1500; safety/few-shot lines 1007-1128; tools/apply logic lines 1502-2288; prompts lines 2290-2440; orchestration/persistence/retry loop lines 2442-2918. Keep facade re-exports for `buildDocumentAgentFewShotExamples`, `buildMetadataVerifierPrompt`, `buildOllamaPiPayload`, `buildRetryCorrectionFromFinalToolError`, `classifyFinalMetadataOutcome`, `computeDeterministicModelSeed`, `getLowConfidenceFeedback`, `getResumeProtectedMetadataKeys`, `isUnsafeGeneratedTagName`, `mergeAppliedMetadataAudit`, `normalizeFinishMetadataArguments`, `normalizeHumanDecisionArguments`, `parseFieldAssignmentsJson`, `parseMetadataVerificationResponse`, `parseToolValidationFeedback`, and `redactSensitiveMetadataText`.
>
> Success criteria: no behavior changes intended; no circular imports; `PiDocumentAgent.ts` substantially slimmer; existing imports from `./PiDocumentAgent.js` continue working; focused tests pass; backend typecheck passes. Validate with `pnpm --filter @repo/backend test -- PiDocumentAgent.test.ts` and `pnpm --filter @repo/backend typecheck`; run backend lint/full tests if feasible and report any skipped validation.
