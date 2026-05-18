# Todo #33 / W4-S18 ready handoff: extract duplicated tag-state logic

This is an implementation-ready handoff only. No code was edited.

## Current relevant changes to preserve

Recent work changed the exact integration points:

- Full-pipeline SSE in `apps/backend/src/server.ts` now uses `TagCacheService` instead of direct `paperless.getTags()`:
  - `server.ts:523` gets `TagCacheService`.
  - `server.ts:536-563` calls `tagCache.getTags()` with stale-cache warning/event behavior.
  - `server.ts:688-701` calls `tagCache.refresh()` after each successful step, logs stale fallback, rebuilds the tag map, refetches the document, then recomputes state.
- Full-pipeline SSE cancellation/close handling now wraps the Effect in `runEffectWithAbort(..., signal)` and suppresses writes/errors after abort:
  - `server.ts:504` creates the close signal.
  - `server.ts:512-513` sends events through `writeSseData(res, signal, event)`.
  - `server.ts:517-745` runs with the abort signal.
  - `server.ts:747-756` only logs/sends errors when `!signal.aborted`.
- Max full-pipeline steps is already configurable: `server.ts:564` reads `configService.config.pipeline.maxSteps`; default and comment are in `apps/backend/src/config/index.ts:64-74`. Do not reintroduce a local `MAX_PIPELINE_STEPS`.

## Exact duplicate / near-duplicate sites

### 1) Full-pipeline state from tags: `server.ts` duplicates `ProcessingPipeline.ts`

`apps/backend/src/server.ts:588-620` inline helper:

```ts
// Helper to get current state from document tags (accepts tagMap for refresh support)
const getStateFromTags = (
  docTags: readonly number[],
  currentTagMap: Map<number, string>,
): string => {
  const docTagNames = docTags
    .map((id) => currentTagMap.get(id))
    .filter((n): n is string => n !== undefined);
  if (docTagNames.includes(tagConfig.failed)) return "failed";
  if (docTagNames.includes(tagConfig.done) || docTagNames.includes(tagConfig.processed))
    return "done";
  if (
    docTagNames.includes(tagConfig.review) ||
    docTagNames.includes(tagConfig.manualReview) ||
    docTagNames.includes(tagConfig.schemaReview)
  )
    return "review";
  if (docTagNames.includes(tagConfig.index) || docTagNames.includes(tagConfig.tagsDone))
    return "index";
  if (
    docTagNames.includes(tagConfig.metadata) ||
    docTagNames.includes(tagConfig.summaryDone) ||
    docTagNames.includes(tagConfig.titleDone) ||
    docTagNames.includes(tagConfig.correspondentDone) ||
    docTagNames.includes(tagConfig.documentTypeDone)
  )
    return "metadata";
  if (docTagNames.includes(tagConfig.ocr) || docTagNames.includes(tagConfig.ocrDone))
    return "ocr";
  return "todo";
};

const currentState = getStateFromTags(doc.tags ?? [], tagMap);
```

Additional call after cache refresh/refetch: `server.ts:699-703`.

`apps/backend/src/agents/ProcessingPipeline.ts:678-731` has the broader version:

```ts
const getTagNames = (doc: Document): string[] => {
  if (doc.tag_names && doc.tag_names.length > 0) return [...doc.tag_names];
  return (doc.tags ?? [])
    .map((id) => tagMapRef.current.get(id))
    .filter((name): name is string => name !== undefined);
};

const getCurrentState = (doc: Document): ProcessingState => {
  const caseState = getCasePhaseState(doc.id);
  if (caseState) return caseState;
  const names = getTagNames(doc);
  if (names.includes(tagConfig.failed)) return "failed";
  if (names.includes(tagConfig.done) || names.includes(tagConfig.processed)) return "done";
  if (
    names.includes(tagConfig.review) ||
    names.includes(tagConfig.manualReview) ||
    names.includes(tagConfig.schemaReview)
  )
    return "review";
  if (
    tagConfig.ocr === tagConfig.metadata &&
    tagConfig.metadata === tagConfig.index &&
    names.includes(tagConfig.ocr)
  ) {
    return getCasePhaseState(doc.id) ?? "metadata";
  }
  if (names.includes(tagConfig.index) || names.includes(tagConfig.tagsDone)) return "index";
  if (...metadata aliases...) return "metadata";
  if (names.includes(tagConfig.ocr) || names.includes(tagConfig.ocrDone)) return "ocr";
  if (names.includes(tagConfig.todo) || names.includes(tagConfig.pending)) {
    return getCasePhaseState(doc.id) ?? "todo";
  }
  return "todo";
};
```

Important deltas:

- Pipeline case state (`getCasePhaseState`, `ProcessingPipeline.ts:685-697`) must remain local/authoritative and should wrap the shared tag-only utility.
- Pipeline supports `doc.tag_names`; server currently only maps `doc.tags` through `TagCacheService`. The utility should support both by accepting `Pick<Document, "tags" | "tag_names">` and an optional id-to-name map.
- Pipeline has a coarse-tag special case (`ocr === metadata === index` -> `metadata`, `ProcessingPipeline.ts:711-717`) that server currently lacks. Extracting should intentionally make server and pipeline match.
- Pipeline checks `todo`/`pending` before defaulting to `todo`; server defaults directly. Same output today, but utility should include the explicit aliases.

### 2) Workflow tag set/classifier duplicates

`apps/backend/src/agents/PiDocumentAgent.ts:221-227`:

```ts
const getWorkflowTagNames = (tagConfig: Record<string, string | undefined>): Set<string> =>
  new Set(Object.values(tagConfig).filter((name): name is string => typeof name === "string"));

const isWorkflowTagName = (name: string, workflowTagNames: Set<string>): boolean => {
  const normalized = normalizeName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};
```

`apps/backend/src/agents/PiConsolidationAgent.ts:91-101`:

```ts
const getWorkflowTagNames = (tagConfig: Record<string, unknown>): Set<string> =>
  new Set(
    Object.values(tagConfig)
      .filter((name): name is string => typeof name === "string" && !!name.trim())
      .map((name) => name.trim().toLowerCase()),
  );

const isWorkflowTagName = (name: string, workflowTagNames: Set<string>): boolean => {
  const normalized = name.trim().toLowerCase();
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};
```

`apps/backend/src/agents/ProcessingPipeline.ts:734-745` creates a raw config-value set for workflow tag cleanup:

```ts
const workflowTagNames = new Set(
  Object.values(tagConfig).filter((name): name is string => typeof name === "string" && !!name),
);
...
const workflowTagIds = new Set(
  tags.filter((tag) => workflowTagNames.has(tag.name)).map((tag) => tag.id),
);
```

Optional adjacent duplicate: `apps/backend/src/api/cases/handlers.ts:58-59` defines `getWorkflowTagNames`, and `handlers.ts:150-152` uses raw `workflowTagNames.has(tag.name)` when recovering stale active workflow tags.

Behavior note: `PiDocumentAgent` normalizes whitespace but not case for candidate names, and its config set is raw; `PiConsolidationAgent` trims/lowercases both config and candidates. The shared helper should use the safer `trim().toLowerCase()` normalization, and tests should lock that in.

### 3) Auto-processing stage/tag classification is the other audit R6 site

`apps/backend/src/services/AutoProcessingService.ts:126-185` independently groups workflow aliases into queued/active/final/stage buckets:

- `processingStageTags`: `todo`, `pending`, `ocr`, `ocrDone`, `metadata`, `summaryDone`, `titleDone`, `correspondentDone`, `documentTypeDone`, `index`, `tagsDone` (`lines 131-143`).
- `allWorkflowStageTags`: processing tags plus `review`, `schemaReview`, `manualReview`, `done`, `processed`, `failed` (`lines 144-152`).
- `primaryProcessingTags`: `ocr`, `metadata`, `summaryDone`, `index` (`lines 153-158`).
- Coarse/queued-active detection and `pipelineStages` query plan (`lines 159-185`).

This is not the same function as `stateFromTags`, but it is the same tag-state vocabulary and should use shared alias helpers if the implementation scope includes “server, auto-processing, and pipeline” from `docs/AUDIT.md:R6`.

## Suggested utility shape

Create `apps/backend/src/utils/tagState.ts`. Keep it pure TypeScript: no `Effect`, no service imports. Type-only import from models is okay.

Recommended exports:

```ts
import type { Document } from "../models/index.js";

export type ProcessingState = "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed";

export type WorkflowTagsConfig = Partial<Record<
  | "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed"
  | "pending" | "ocrDone" | "summaryDone" | "schemaReview" | "titleDone"
  | "correspondentDone" | "documentTypeDone" | "tagsDone" | "processed" | "manualReview",
  string | undefined
>>;

export type PipelineStepName = "ocr" | "metadata" | "index" | "case";

export interface PipelineStageQuery {
  readonly tags: string[];
  readonly processingStep: PipelineStepName;
}

export const normalizeWorkflowTagName = (name: string): string => name.trim().toLowerCase();
export const uniqueConfiguredTagNames = (...names: Array<string | null | undefined>): string[] =>
  [...new Set(names.filter((n): n is string => typeof n === "string" && n.trim().length > 0))];

export const getWorkflowTagNames = (tagConfig: Record<string, unknown>): Set<string> =>
  new Set(
    Object.values(tagConfig)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map(normalizeWorkflowTagName),
  );

export const isWorkflowTagName = (name: string, workflowTagNames: ReadonlySet<string>): boolean => {
  const normalized = normalizeWorkflowTagName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};

export const getDocumentTagNames = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagNameById?: ReadonlyMap<number, string>,
): string[] => { /* prefer doc.tag_names when present, else map doc.tags */ };

export const getProcessingStateFromTagNames = (
  tagNames: readonly string[],
  tagConfig: WorkflowTagsConfig,
): ProcessingState => { /* priority listed below */ };

export const getProcessingStateFromDocumentTags = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagConfig: WorkflowTagsConfig,
  tagNameById?: ReadonlyMap<number, string>,
): ProcessingState => getProcessingStateFromTagNames(getDocumentTagNames(doc, tagNameById), tagConfig);

export const getWorkflowTagForState = (
  state: ProcessingState,
  tagConfig: WorkflowTagsConfig,
): string | null => { /* current ProcessingPipeline switch */ };

export const getActiveProcessingTagNames = (tagConfig: WorkflowTagsConfig): string[] => ...;
export const getFinalTagNames = (tagConfig: WorkflowTagsConfig): string[] => ...;
export const getAllWorkflowStageTagNames = (tagConfig: WorkflowTagsConfig): string[] => ...;
export const getAutoProcessingStageQueries = (tagConfig: WorkflowTagsConfig): PipelineStageQuery[] => ...;
```

`getProcessingStateFromTagNames` should preserve current priority:

1. `failed`
2. `done` or legacy `processed`
3. `review`, `manualReview`, or `schemaReview`
4. coarse config: if `ocr === metadata === index` and the shared tag is present, return `metadata`
5. `index` or `tagsDone`
6. `metadata`, `summaryDone`, `titleDone`, `correspondentDone`, or `documentTypeDone`
7. `ocr` or `ocrDone`
8. `todo`, `pending`, or default `todo`

Use a helper like `hasConfiguredTag(tagNames, tagConfig.failed)` rather than `includes(undefined)`.

State detection should probably remain exact/case-sensitive to minimize behavior changes. Workflow-tag filtering should normalize trim/lowercase.

## Integration plan by file

### `apps/backend/src/agents/ProcessingPipeline.ts`

- Import utility helpers.
- Move `ProcessingState` type to the utility and re-export it from `ProcessingPipeline.ts` if external imports rely on the current path.
- Replace `getTagNames` (`lines 678-683`) with `getDocumentTagNames(doc, tagMapRef.current)`.
- Keep `getCasePhaseState` (`lines 685-697`) local.
- Make `getCurrentState` (`lines 699-731`) a wrapper:

```ts
const getCurrentState = (doc: Document): ProcessingState => {
  const caseState = getCasePhaseState(doc.id);
  if (caseState) return caseState;
  return getProcessingStateFromDocumentTags(doc, tagConfig, tagMapRef.current);
};
```

- Replace raw `workflowTagNames` set (`lines 734-736`) with `getWorkflowTagNames(tagConfig)`.
- Because `getWorkflowTagNames` should return normalized names, replace `workflowTagNames.has(tag.name)` at `line 745` with `isWorkflowTagName(tag.name, workflowTagNames)` or compare `normalizeWorkflowTagName(tag.name)`.
- Replace local `workflowTagForState` (`lines 757-774`) with `getWorkflowTagForState(state, tagConfig)` if included in utility.

### `apps/backend/src/server.ts`

- Import `getProcessingStateFromDocumentTags`.
- Remove inline `getStateFromTags` (`lines 588-618`).
- Preserve tag-cache behavior exactly:

```ts
const currentState = getProcessingStateFromDocumentTags(doc, tagConfig, tagMap);
...
const updatedTagResult = yield* tagCache.refresh();
currentTagMap = new Map(updatedTagResult.tags.map((t) => [t.id, t.name]));
const updatedDoc = yield* paperless.getDocument(docId);
const updatedState = getProcessingStateFromDocumentTags(updatedDoc, tagConfig, currentTagMap);
```

- Do not replace `TagCacheService` with `paperless.getTags()`.
- Do not change SSE abort/cancellation flow.
- `getNextStepForState` can stay local unless the task owner wants transition routing centralized too.

### `apps/backend/src/services/AutoProcessingService.ts`

If fully addressing audit R6, replace local tag grouping (`lines 126-185`) with utility helpers:

- `getAllWorkflowStageTagNames(tagConfig)` for untagged filtering workflow IDs (`lines 199-204`).
- `getFinalTagNames(tagConfig)` for final IDs (`lines 191-197`).
- `getAutoProcessingStageQueries(tagConfig)` for `pipelineStages` (`lines 163-185`).

Keep the current behavior:

- Coarse config (`todo`, `ocr`, `metadata`, `summaryDone`, `index` all one tag) yields one `{ processingStep: "case" }` query.
- Queued/active two-tag config yields two `case` queries.
- Default config yields queued->`ocr`, ocr aliases->`metadata`, metadata aliases->`metadata`, index aliases->`index`.

### `apps/backend/src/agents/PiDocumentAgent.ts`

- Remove local helpers at `lines 221-227`.
- Import `getWorkflowTagNames` and `isWorkflowTagName`.
- Existing call sites should continue to work:
  - `lines 1517, 1536-1538`
  - `lines 1664-1688`
  - `lines 2002-2007`
  - `lines 2041-2070`
  - `lines 2504-2533`

### `apps/backend/src/agents/PiConsolidationAgent.ts`

- Remove local helpers at `lines 91-101`.
- Import utility helpers.
- Use remains at `lines 247-248`.

### Optional: `apps/backend/src/api/cases/handlers.ts`

- Replace `getWorkflowTagNames` at `lines 58-59`.
- At `lines 150-152`, use `isWorkflowTagName(tag.name, workflowTagNames)` because the shared set is normalized.

## Tests to add/update

### New unit test: `apps/backend/tests/utils/tagState.test.ts`

Cover the pure utility comprehensively:

- `getProcessingStateFromTagNames` priority:
  - failed wins over done/review.
  - done recognizes `done` and legacy `processed`.
  - review recognizes `review`, `manualReview`, `schemaReview`.
  - coarse `ocr === metadata === index` returns `metadata` for the shared tag.
  - index recognizes `index`, `tagsDone`.
  - metadata recognizes `metadata`, `summaryDone`, `titleDone`, `correspondentDone`, `documentTypeDone`.
  - ocr recognizes `ocr`, `ocrDone`.
  - todo recognizes `todo`, `pending`; empty/unknown defaults to `todo`.
- `getDocumentTagNames` prefers `tag_names` over ID map and otherwise resolves `tags` through `ReadonlyMap<number, string>`.
- Workflow helpers trim/lowercase config names, ignore empty values, and classify any `llm-*` tag as workflow.
- If adding auto-processing helpers: assert default/coarse/queued-active stage query shapes and all/final tag-name lists.

### Existing tests to update/run

- `apps/backend/tests/agents/ProcessingPipeline.test.ts`
  - Existing test at `lines 250-285`, “uses the case phase as the authoritative workflow state when present”, should continue passing and proves case state remains local authority.
  - Add a small no-case-row state test if utility coverage alone is not enough for integration.
- `apps/backend/tests/server.test.ts`
  - Existing `processing SSE` tests at `lines 523-666` should continue passing and protect TagCache + max-step behavior.
  - Add a focused SSE test for coarse tag parity if practical: config has `ocr`, `metadata`, `index` all equal and document has that tag; full stream should call `processStepStream(docId, "metadata", false)` rather than `"ocr"`.
- `apps/backend/tests/services/TagCacheService.test.ts` should not need changes, but run if server/tag cache behavior is touched.
- Existing Pi agent tests if imports or workflow filtering change: `apps/backend/tests/agents/PiDocumentAgent.test.ts`, `apps/backend/tests/agents/PiConsolidationAgent.test.ts`.

## Validation commands

Targeted backend validation:

```bash
pnpm --filter @repo/backend test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts tests/server.test.ts tests/services/TagCacheService.test.ts
pnpm --filter @repo/backend typecheck
```

If workspace filter syntax is not accepted:

```bash
cd apps/backend
pnpm test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts tests/server.test.ts tests/services/TagCacheService.test.ts
pnpm typecheck
```

Broader confidence if time permits:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend lint
```

## Final worker prompt

Implement Todo #33 / W4-S18: extract duplicated workflow tag-state logic into one pure utility without changing SSE tag-cache/cancellation behavior. Add `apps/backend/src/utils/tagState.ts` exporting `ProcessingState`, `WorkflowTagsConfig`, workflow tag normalization/classification helpers, `getDocumentTagNames`, `getProcessingStateFromTagNames`, `getProcessingStateFromDocumentTags`, and (if useful) workflow-state/tag grouping helpers for pipeline transitions and auto-processing. Preserve state priority: failed > done/processed > review/manualReview/schemaReview > coarse `ocr===metadata===index` => metadata > index/tagsDone > metadata aliases > ocr/ocrDone > todo/pending/default. In `ProcessingPipeline.ts`, keep TinyBase case phase as the local authority, but delegate tag-only state detection and workflow tag filtering to the utility; re-export `ProcessingState` from the old module path if needed. In `server.ts`, remove only the inline state-from-tags helper and call the utility with the `TagCacheService` maps from `getTags()`/`refresh()`; do not replace `TagCacheService`, `runEffectWithAbort`, or abort-safe SSE writes. Replace duplicated workflow helper logic in `PiDocumentAgent.ts` and `PiConsolidationAgent.ts`; optional adjacent cleanup in `api/cases/handlers.ts` and `AutoProcessingService.ts` is okay if it is mechanical and tested. Add focused unit tests for the utility and run targeted backend tests plus typecheck.

## Risks / stop rules

- Do not import `ProcessingPipelineService` into `server.ts` just to reuse `getCurrentState`; that would couple SSE state detection to TinyBase/service runtime semantics. Use the pure utility.
- Do not normalize processing state tag comparisons unless explicitly intended and tested; current state matching is exact/case-sensitive.
- Workflow-tag normalization (`trim().toLowerCase()`) is an intentional small behavior improvement matching `PiConsolidationAgent`; mention it in the implementation summary.
- If TypeScript reveals config tag types are wider/narrower than expected, adjust the utility type to accept the current config object rather than casting everywhere.
