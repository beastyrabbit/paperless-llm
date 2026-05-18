# Todo #34 / W4-S18 — PiDocumentAgent split handoff

Scope: inspected current structure, exports, imports, tests, and adjacent consumers for an implementation-ready, staged extraction plan. No production/test files were edited.

## Current shape

- `apps/backend/src/agents/PiDocumentAgent.ts` is a single 2,792-line module containing public contracts, pure helper exports, prompt construction, Pi tool definitions, metadata verification, event recording, and the live `Effect` layer.
- Public imports consumed outside the file are currently from `./PiDocumentAgent.js`; preserving that module path is the safest compatibility strategy.
- Backend TypeScript uses `module/moduleResolution: NodeNext`; relative TS imports must keep `.js` specifiers.

## Public API and imports to preserve

### `apps/backend/src/agents/PiDocumentAgent.ts`
High-value symbols and line regions:

- Imports/dependencies: lines 7-33
  - Pi: `AgentEvent`, `AgentMessage`, `AgentTool`, `Agent as PiAgent` from `@earendil-works/pi-agent-core`; `streamSimple` from `@earendil-works/pi-ai`.
  - Runtime: `Context`, `Effect`, `Layer`, `pipe`; `Type` from `typebox`.
  - Services: `ConfigService`, `DocumentCaseService`, `OllamaService`, `PaperlessService`, `TinyBaseService`.
  - Agents: `runConfirmationLoop`, `PiTagExplorerAgentService`, `buildOllamaModel`.
- Public service contracts: lines 39-85
  - `DocumentAgentInput`, `MetadataPolicy`, `DocumentAgentRuntimeEvent`, `DocumentAgentResult`, `PiDocumentAgentService`, `PiDocumentAgentService` tag.
- Pure/public test-covered helpers:
  - `parseFieldAssignmentsJson` line 151
  - `normalizeEntityKey` line 196
  - validation retry helpers: `parseToolValidationFeedback` line 376, `buildRetryCorrectionFromFinalToolError` line 459
  - audit/resume/model helpers: `buildOllamaPiPayload` line 506, `metadataValuesEqual` line 540, `readAppliedMetadataAudit` line 543, `mergeAppliedMetadataAudit` line 565, `getResumeProtectedMetadataKeys` line 579, `computeDeterministicModelSeed` line 613, `classifyFinalMetadataOutcome` line 630
  - tool argument normalizers: `normalizeHumanDecisionArguments` line 695, `normalizeFinishMetadataArguments` line 798
  - verifier/prompt guardrail helpers: `parseMetadataVerificationResponse` line 890, `getLowConfidenceFeedback` line 917, `buildMetadataVerifierPrompt` line 923, `isUnsafeGeneratedTagName` line 1023, `redactSensitiveMetadataText` line 1036
- Live layer/effectful orchestration: `PiDocumentAgentServiceLive` starts line 1052.
- Internal functions inside live layer are major extraction seams:
  - `getRuntimeSettings` line 1084
  - `queueHumanDecision` line 1148
  - `verifyMetadataProposal` line 1310
  - `confirmMetadataBeforeApply` line 1393
  - `createTools` line 1422
  - `buildSystemPrompt` line 2210
  - `buildUserPrompt` line 2244
  - `processDocument` implementation line 2350
  - `new PiAgent` line 2450; `beforeToolCall` line 2490; `agent.subscribe` line 2506

### Re-export barrel

`apps/backend/src/agents/index.ts` re-exports only the service-facing subset from `./PiDocumentAgent.js` at lines 66-73:

```ts
export {
  type DocumentAgentInput,
  type DocumentAgentResult,
  PiDocumentAgentService,
  type PiDocumentAgentService as PiDocumentAgentServiceInterface,
  PiDocumentAgentServiceLive,
} from "./PiDocumentAgent.js";
```

Do not remove these exports. Consider adding `DocumentAgentRuntimeEvent` and `MetadataPolicy` only if external consumers need the barrel; current direct consumer imports them from `./PiDocumentAgent.js`.

### Processing pipeline consumer

`apps/backend/src/agents/ProcessingPipeline.ts` imports `DocumentAgentRuntimeEvent`, `MetadataPolicy`, and `PiDocumentAgentService` from `./PiDocumentAgent.js` at lines 23-27. It maps document-agent runtime events into pipeline stream events in `toPipelineAgentEvent` lines 107-127. It passes `metadataPolicy` and `onEvent` into `documentAgent.processDocument` in `processMetadata` lines 785-803.

Risk: if `DocumentAgentRuntimeEvent` moves, keep a re-export from `PiDocumentAgent.ts`; otherwise pipeline imports break.

### Live layer registration

`apps/backend/src/layers/index.ts` imports and merges `PiDocumentAgentServiceLive`; grep found usage at lines 8 and 74. Keep `PiDocumentAgentServiceLive` exported from the same module path.

## Test coverage and update needs

### `apps/backend/tests/agents/PiDocumentAgent.test.ts`
This 415-line unit test imports many pure helpers directly from `../../src/agents/PiDocumentAgent.js` lines 2-18. Current describe blocks cover:

- `buildOllamaPiPayload` lines 25-55
- `parseFieldAssignmentsJson` lines 57-90
- prompt-data delimiter safety lines 92-100
- `normalizeFinishMetadataArguments` lines 102-122
- retry correction helpers lines 124-180
- metadata verifier parsing/prompt/low confidence lines 182-244
- seed/audit/resume helpers lines 246-282
- `normalizeHumanDecisionArguments` lines 284-322
- `classifyFinalMetadataOutcome` lines 324-347
- tag guardrails lines 349-375
- sensitive text redaction lines 377-415

Safest first implementation keeps all these exports re-exported from `PiDocumentAgent.ts`, so the test import does not need to change. After extraction is stable, tests may be split by concern and import directly from new modules, but that is optional and higher-churn.

### Other tests

`apps/backend/tests/agents/ProcessingPipeline.test.ts` imports `PiDocumentAgentService` directly from `../../src/agents/PiDocumentAgent.js` and mocks it (grep lines 8, 241-244). It should remain unaffected if the public service tag path is preserved.

## Dependency/concurrency constraints

- Mandatory project rule: Pi agent instructions/tools/schemas/placeholders must remain TypeScript-defined. Do not reintroduce prompt files or `PromptService`.
- `createTools` depends on closure state and services from the live layer: `paperless`, `tinybase`, `cases`, `tagExplorer`, `tagConfig`, metadata policy, prompt language, `queueHumanDecision`, `confirmMetadataBeforeApply`, refs (`pausedRef`, `appliedRef`, `finalToolRef`), dry-run, verifier context.
- `queueHumanDecision` is effectful and mutates Paperless workflow tags, TinyBase logs, and cases. Extracting it requires explicit dependency injection rather than hidden imports.
- Final tool execution is guarded in two places and must stay consistent:
  - tool implementations set `finalToolRef.current` when final tools succeed/pause.
  - Pi agent `beforeToolCall` blocks duplicate final metadata actions (line 2490).
- Event recording currently has two layers:
  - `PiDocumentAgent.ts` subscribes to Pi events and emits `DocumentAgentRuntimeEvent` via `input.onEvent` lines 2506+.
  - `ProcessingPipeline.ts` maps those events to pipeline stream event types lines 107-127.
- Several helpers are both internal and exported for tests; moving them without re-exporting will cause immediate breakage.
- `Type` schemas for tools are currently local to `createTools`; when extracting, keep schemas in TypeScript and close to the tool definitions.
- `normalizeName`, `parseJsonValue`, `parseFieldId`, `findByNormalizedName`, `getWorkflowTagNames`, `isWorkflowTagName`, `parseCatalogFieldAssignmentsJson`, `normalizePublicTitle`, and message helpers are private but shared across likely extraction files. Decide deliberately whether to export internally from concern modules or consolidate in a `shared.ts`/`metadata.ts` module.

## Safe staged extraction plan

Recommended strategy: leave `apps/backend/src/agents/PiDocumentAgent.ts` as the public facade and live service entry point until the end. Extract pure helpers first, then event helpers, then tool factories. Each stage should compile/test independently.

### Stage 0 — Baseline/no-op safety

- Run targeted tests before editing: `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`.
- Run typecheck if time allows: `pnpm --filter @repo/backend typecheck`.
- Do not alter behavior; this gives a checkpoint before moving symbols.

### Stage 1 — Extract public contracts and pure state helpers

Suggested files:

- `apps/backend/src/agents/document-agent/types.ts`
  - `DocumentAgentInput`, `MetadataPolicy`, `DocumentAgentRuntimeEvent`, `DocumentAgentResult`, `PiDocumentAgentService` interface-only type if desired, `EntityKind`, `HumanDecisionAction`, ref types.
  - Be careful: the `Context.GenericTag` value should probably remain in `PiDocumentAgent.ts` initially to avoid circular imports; later it can move if imported/re-exported cleanly.
- `apps/backend/src/agents/document-agent/state.ts`
  - `defaultMetadataPolicy`
  - `buildOllamaPiPayload`, `computeDeterministicModelSeed`
  - `AppliedMetadataAudit` types, `metadataValuesEqual`, `readAppliedMetadataAudit`, `mergeAppliedMetadataAudit`, `getResumeProtectedMetadataKeys`, `classifyFinalMetadataOutcome`
  - private helpers: `isRecord`, `stableStringify`, `updateKeyForAppliedMetadataKey` if only used by tools may move later.

Compatibility move: after extraction, re-export the same public helpers from `PiDocumentAgent.ts` so existing tests and consumers still import from `PiDocumentAgent.js`.

### Stage 2 — Extract metadata/parsing/guardrail helpers

Suggested file:

- `apps/backend/src/agents/document-agent/metadata.ts`
  - JSON parsing helpers: `parseJsonValue`, `parseJsonObject`, `pickRecordValue`, `parseFieldId`, `parseFieldAssignmentsJson`, `parseCatalogFieldAssignmentsJson`
  - catalog/name helpers: `normalizeName`, `normalizeEntityKey`, `findByNormalizedName`, `getWorkflowTagNames`, `isWorkflowTagName`
  - tool arg normalizers: `normalizeHumanDecisionArguments`, `normalizeFinishMetadataArguments`, `FinishMetadataArguments`
  - sensitive guardrails: `isUnsafeGeneratedTagName`, `redactSensitiveMetadataText`, `normalizePublicTitle`

Rationale: `tools.ts`, `prompts.ts`, `verifier.ts`, and tests all need these helpers. This avoids coupling tool extraction to the large live layer.

### Stage 3 — Extract validation retry and event/message helpers

Suggested files:

- `apps/backend/src/agents/document-agent/events.ts`
  - `isFinalToolName`, `isFinalToolResultMessage`
  - `hasToolCall`, `getToolCallNames`, `getAssistantPreview`, `getToolResultText`
  - optional `mapPiEventToDocumentRuntimeEvent(event: AgentEvent): DocumentAgentRuntimeEvent | null` so `agent.subscribe` becomes a small call site.
- `apps/backend/src/agents/document-agent/retry.ts`
  - `ToolValidationIssue`, `ToolValidationFeedback`, `parseToolValidationFeedback`, `buildRetryCorrectionFromFinalToolError` and private path guidance helpers.

Rationale: event/message helpers are state/event concern and used in orchestration retry/final outcome logic. Retry helpers are pure and heavily tested.

### Stage 4 — Extract prompt builders and document summarizers

Suggested file:

- `apps/backend/src/agents/document-agent/prompts.ts`
  - `getSourceFileName`, `getContentHeading`, `buildDocumentSearchQuery`, `summarizeDocumentForAgent`
  - `buildSystemPrompt`, `buildUserPrompt`

Inputs should be explicit: `doc`, `content`, catalogs, memory, policy, resume flag, document tags, prompt language. Keep `UNTRUSTED_DOCUMENT_DATA_INSTRUCTION`, `formatUntrustedDocumentText`, and `buildPromptLanguageInstruction` imports in this module.

### Stage 5 — Extract verifier concern

Suggested file:

- `apps/backend/src/agents/document-agent/verifier.ts`
  - Pure exports: `parseMetadataVerificationResponse`, `getLowConfidenceFeedback`, `buildMetadataVerifierPrompt`, `MetadataVerifierContext`
  - Effectful factories: prefer `createMetadataVerifier({ ollama, tinybase })` returning `verifyMetadataProposal`, `confirmMetadataBeforeApply`, `logVerificationResult`, or pass these functions into `tools.ts`.

Risk: `verifyMetadataProposal` currently closes over `ollama` and `tinybase`; extracting as top-level functions without dependency parameters will create hidden service coupling or Effect environment changes. Use explicit dependencies to minimize churn.

### Stage 6 — Extract tools concern

Suggested file:

- `apps/backend/src/agents/document-agent/tools.ts`
  - `textResult`
  - `createDocumentAgentTools(...)` (renamed from `createTools`)
  - TypeBox schemas currently inside `createTools`

Recommended signature shape:

```ts
createDocumentAgentTools({
  doc,
  sessionId,
  refs: { pausedRef, appliedRef, finalToolRef },
  dryRun,
  metadataPolicy,
  promptLanguage,
  workflow: { tagConfig },
  services: { paperless, tinybase, cases, tagExplorer },
  queueHumanDecision,
  confirmMetadataBeforeApply,
  verifierContext,
}): AgentTool[]
```

Keep the final tool names unchanged: `search_similar_documents`, `get_document`, `explore_tags`, `request_human_decision`, `finish_document_metadata`.

### Stage 7 — Slim live service file

`PiDocumentAgent.ts` should then contain primarily:

- public re-exports from concern modules;
- `PiDocumentAgentService` tag and `PiDocumentAgentServiceLive` layer;
- service setup (`yield* ConfigService`, etc.), runtime settings, case/memory/catalog preparation;
- Pi agent creation, `onPayload`, duplicate-final guard, subscription, retry loops, persistence, and result mapping.

Optionally move remaining orchestration into `document-agent/service.ts`, but keep `PiDocumentAgent.ts` as the public facade exporting `PiDocumentAgentServiceLive`.

## Risks and mitigations

- **Circular imports:** likely if `types.ts` imports `PiDocumentAgentService` value or if `tools.ts` imports from the facade. Mitigation: concern modules should import each other directly, never import `../PiDocumentAgent.js`.
- **Lost public exports:** tests rely on helper exports from `PiDocumentAgent.ts`. Mitigation: after each move, add explicit re-exports from the facade.
- **NodeNext import suffixes:** use `.js` in all new relative imports.
- **Closure behavior drift in tools:** `createTools` mutates refs and uses local effect helpers. Mitigation: pass refs/dependencies explicitly and keep tool implementation code mechanically identical in the first extraction.
- **Final outcome behavior drift:** duplicate-final guard, retry correction, and `classifyFinalMetadataOutcome` jointly determine success/failure. Mitigation: extract event/message helpers before altering orchestration; keep final tool names centralized.
- **Dry-run side effects:** dry-run branches avoid Paperless/TinyBase/Case mutations in several places. Tool extraction must preserve every `if (dryRun)` branch.
- **Workflow tags:** `llm-*` and configured workflow tags must not be altered by tools. Preserve `getWorkflowTagNames`/`isWorkflowTagName` behavior and tag filtering.
- **Sensitive metadata redaction:** titles, summaries, and tag names use shared guardrails. Avoid duplicating regexes across modules.
- **Type-only imports:** `AgentMessage`, `AgentTool`, `Document`, `CustomField`, `CustomFieldValue`, and `ConfirmationResult` can mostly be type imports; keeping value imports minimal helps avoid cycles.

## Validation plan

Targeted checks after each stage:

1. `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`
2. `pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts`
3. `pnpm --filter @repo/backend typecheck`
4. If large tool/orchestration movement happened: `pnpm --filter @repo/backend test`
5. Final repository-level confidence if requested/time permits: `pnpm run typecheck && pnpm run lint`

If a compile error appears after moving modules, first check: missing `.js` suffix, missing facade re-export, or accidental value import causing a cycle.

## Compact worker prompt

Implement the split of `apps/backend/src/agents/PiDocumentAgent.ts` by concern without behavior changes. Keep `PiDocumentAgent.ts` as the public facade/live service entry point and preserve all current imports from `./PiDocumentAgent.js`. Extract in small compile-safe stages: contracts/state helpers, metadata parsing/normalization/guardrails, event/message and retry helpers, prompt builders, verifier helpers, then `createTools` into a tool concern module with explicit dependency injection. Use `.js` suffixes for new relative imports. Do not reintroduce prompt files or `PromptService`; all Pi tool schemas/prompts stay in TypeScript. After each stage, run at least `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`; before finishing run backend typecheck and the ProcessingPipeline test. Success means public exports and tests remain compatible, tool names/behavior/final-action guards/dry-run semantics are unchanged, and `PiDocumentAgent.ts` is substantially reduced to facade + orchestration.
