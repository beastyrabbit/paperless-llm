# Todo #33 / W4-S18 tag-state utility handoff

## Scope inspected
- `apps/backend/src/server.ts` SSE full-pipeline state detection/step selection.
- `apps/backend/src/agents/ProcessingPipeline.ts` canonical pipeline state detection and transitions.
- `apps/backend/src/agents/PiDocumentAgent.ts` workflow-tag filtering/protection in document metadata tools and prompts.
- `apps/backend/src/agents/PiConsolidationAgent.ts` workflow-tag filtering for consolidation snapshots.
- Adjacent duplicate found in `apps/backend/src/api/cases/handlers.ts` (not requested, but same helper shape).

## Exact duplicate / near-duplicate sites

### 1) State from tag names/ids: `server.ts` vs `ProcessingPipeline.ts`

`apps/backend/src/server.ts:462-491` defines an inline `getStateFromTags(docTags, currentTagMap)` for SSE full pipeline:

```ts
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
```

Used at:
- `server.ts:494` initial state: `const currentState = getStateFromTags(doc.tags ?? [], tagMap);`
- `server.ts:572-576` after `tagCache.refresh()` + document refetch in full-pipeline loop.

`apps/backend/src/agents/ProcessingPipeline.ts:557-610` has the broader equivalent:

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
  if (
    names.includes(tagConfig.metadata) ||
    names.includes(tagConfig.summaryDone) ||
    names.includes(tagConfig.titleDone) ||
    names.includes(tagConfig.correspondentDone) ||
    names.includes(tagConfig.documentTypeDone)
  )
    return "metadata";
  if (names.includes(tagConfig.ocr) || names.includes(tagConfig.ocrDone)) return "ocr";
  if (names.includes(tagConfig.todo) || names.includes(tagConfig.pending)) {
    return getCasePhaseState(doc.id) ?? "todo";
  }
  return "todo";
};
```

Important deltas to preserve/resolve:
- Pipeline checks local case state first (`getCasePhaseState`, `ProcessingPipeline.ts:564-575`). Server cannot currently do that unless it calls `pipeline.getCurrentState` or shares only tag-level utility. For this task, extract tag-state logic, not case-state authority.
- Pipeline supports `doc.tag_names`; server only maps ids through `TagCacheService` tags.
- Pipeline handles coarse tag configs where `ocr === metadata === index` by returning `metadata` for the shared tag (`ProcessingPipeline.ts:590-596`). Server lacks this; utility should centralize it so SSE behavior matches pipeline.
- Pipeline explicitly checks `todo`/`pending` before defaulting to `todo`; server defaults directly. Outcome is same for current callers, but utility should include it for completeness.

### 2) Workflow tag set + classifier: `PiDocumentAgent.ts` vs `PiConsolidationAgent.ts` (+ pipeline/cases)

`apps/backend/src/agents/PiDocumentAgent.ts:211-217`:

```ts
const getWorkflowTagNames = (tagConfig: Record<string, string | undefined>): Set<string> =>
  new Set(Object.values(tagConfig).filter((name): name is string => typeof name === "string"));

const isWorkflowTagName = (name: string, workflowTagNames: Set<string>): boolean => {
  const normalized = normalizeName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};
```

`apps/backend/src/agents/PiConsolidationAgent.ts:91-100`:

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

Other related sites:
- `ProcessingPipeline.ts:613-615` creates `workflowTagNames` from raw config values for transition cleanup.
- `apps/backend/src/api/cases/handlers.ts:58-59` has another `getWorkflowTagNames`, then uses it to remove workflow tags when queueing a case (`handlers.ts:148-155`). Include only if the implementer wants to fully de-duplicate all workflow-tag helper copies.

Behavioral risk: `PiDocumentAgent` normalizes the candidate tag name but stores raw config names in the set, so config values with surrounding whitespace or different case do not match. `PiConsolidationAgent` lowercases/trims both sides. A shared utility should choose one consistent normalization. Recommended: trim + lowercase for `getWorkflowTagNames` and `isWorkflowTagName`, while returning only normalized values from `getWorkflowTagNames`.

### 3) PiDocumentAgent call sites that should import the shared workflow helpers

In `PiDocumentAgent.ts`, workflow helper usages are spread through the metadata tool path:
- `PiDocumentAgent.ts:1339` creates `workflowTagNames` in `createTools`.
- `PiDocumentAgent.ts:1359` filters catalog item names for `list_catalog_entries`.
- `PiDocumentAgent.ts:1487-1510` filters current tags and catalog tags for `explore_tags`.
- `PiDocumentAgent.ts:1827-1828` rejects workflow tag IDs in `validateTagId`.
- `PiDocumentAgent.ts:1868-1894` rejects workflow tag names proposed in `tagNamesToAdd`; also filters options for the human review prompt.
- `PiDocumentAgent.ts:2336-2341` derives `documentUserTagIds` by excluding workflow tags.
- `PiDocumentAgent.ts:2317-2327` derives `documentUserTagNames` and `documentWorkflowTagNames`.
- `PiDocumentAgent.ts:2339-2341` filters tags catalog passed to prompt.

### 4) PiConsolidationAgent call sites

- `PiConsolidationAgent.ts:168-169`: `const workflowTagNames = getWorkflowTagNames(config.config.tags); const userTags = tags.filter((tag) => !isWorkflowTagName(tag.name, workflowTagNames));`

## Suggested utility shape

Create `apps/backend/src/utils/tagState.ts` (or similarly named; `tagLanguage.ts` is language-specific and not a good fit). Keep it pure, no Effect dependencies.

Recommended exports:

```ts
import type { Document, Tag } from "../models/index.js";

export type ProcessingState = "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed";

export type WorkflowTagsConfig = Partial<Record<
  | "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed"
  | "pending" | "ocrDone" | "summaryDone" | "schemaReview" | "titleDone"
  | "correspondentDone" | "documentTypeDone" | "tagsDone" | "processed" | "manualReview",
  string | undefined
>>;

export const normalizeWorkflowTagName = (name: string): string =>
  name.trim().toLowerCase();

export const getWorkflowTagNames = (tagConfig: Record<string, unknown>): Set<string> =>
  new Set(
    Object.values(tagConfig)
      .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
      .map(normalizeWorkflowTagName),
  );

export const isWorkflowTagName = (name: string, workflowTagNames: Set<string>): boolean => {
  const normalized = normalizeWorkflowTagName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};

export const getDocumentTagNames = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagNameById?: ReadonlyMap<number, string>,
): string[] => {
  if (doc.tag_names && doc.tag_names.length > 0) return [...doc.tag_names];
  if (!tagNameById) return [];
  return (doc.tags ?? [])
    .map((id) => tagNameById.get(id))
    .filter((name): name is string => name !== undefined);
};

export const getProcessingStateFromTagNames = (
  tagNames: readonly string[],
  tagConfig: WorkflowTagsConfig,
): ProcessingState => { /* extracted priority order */ };

export const getProcessingStateFromDocumentTags = (
  doc: Pick<Document, "tags" | "tag_names">,
  tagConfig: WorkflowTagsConfig,
  tagNameById?: ReadonlyMap<number, string>,
): ProcessingState => getProcessingStateFromTagNames(getDocumentTagNames(doc, tagNameById), tagConfig);
```

Implementation details for `getProcessingStateFromTagNames`:
- Preserve current priority order:
  1. failed (`failed`)
  2. done (`done` or legacy `processed`)
  3. review (`review`, `manualReview`, `schemaReview`)
  4. coarse config special case: if `ocr === metadata === index` and the shared tag is present, return `metadata`
  5. index (`index`, `tagsDone`)
  6. metadata (`metadata`, `summaryDone`, `titleDone`, `correspondentDone`, `documentTypeDone`)
  7. ocr (`ocr`, `ocrDone`)
  8. todo (`todo`, `pending`) or default `todo`
- To avoid `includes(undefined)` surprises if any tag config value is undefined, use helper predicates like `hasConfiguredTag(names, tagConfig.failed)`.
- Current state checks are case-sensitive. Workflow-tag filtering should normalize; for state detection, safest low-risk path is to keep exact matching to preserve behavior. If normalizing state detection, explicitly add tests and call out behavior change.

Alternative naming if avoiding type relocation: keep `ProcessingState` exported from `ProcessingPipeline.ts` and define an identical `TagProcessingState` in utility, but that creates duplication. Better: move/export `ProcessingState` from utility and re-export from `ProcessingPipeline.ts` (`export type { ProcessingState } from "../utils/tagState.js";`) to preserve public import path.

## Integration plan by file

### `ProcessingPipeline.ts`
- Import from utility: `getDocumentTagNames`, `getProcessingStateFromTagNames` or `getProcessingStateFromDocumentTags`, `getWorkflowTagNames`.
- Replace local `getTagNames` with utility call using `tagMapRef.current`.
- Keep `getCasePhaseState` local; it is service-specific authority over TinyBase case rows.
- Keep `getCurrentState` local wrapper:
  ```ts
  const getCurrentState = (doc: Document): ProcessingState => {
    const caseState = getCasePhaseState(doc.id);
    if (caseState) return caseState;
    return getProcessingStateFromDocumentTags(doc, tagConfig, tagMapRef.current);
  };
  ```
- Replace raw `workflowTagNames` construction at `ProcessingPipeline.ts:613-615` with `getWorkflowTagNames(tagConfig)`.
- Because utility returns normalized workflow names, transition cleanup must compare normalized tag names:
  ```ts
  tags.filter((tag) => workflowTagNames.has(normalizeWorkflowTagName(tag.name)))
  ```
  or use `isWorkflowTagName(tag.name, workflowTagNames)`.

### `server.ts`
- Import `getProcessingStateFromDocumentTags` or `getProcessingStateFromTagNames`.
- Remove inline `getStateFromTags` (`server.ts:462-491`).
- Replace calls:
  ```ts
  const currentState = getProcessingStateFromDocumentTags(doc, tagConfig, tagMap);
  ...
  const updatedState = getProcessingStateFromDocumentTags(updatedDoc, tagConfig, currentTagMap);
  ```
  If `Document` typing is inconvenient, utility can accept `Pick<Document, "tags" | "tag_names">` and the current object works.
- Keep `getNextStepForState` in server unless the task expands to step-routing de-duplication.

### `PiDocumentAgent.ts`
- Remove local `getWorkflowTagNames`/`isWorkflowTagName` definitions at `PiDocumentAgent.ts:211-217`.
- Import shared `getWorkflowTagNames` and `isWorkflowTagName`.
- Watch for behavior change: shared utility should normalize config set; existing call sites should not need changes if `isWorkflowTagName` handles normalization.

### `PiConsolidationAgent.ts`
- Remove local `getWorkflowTagNames`/`isWorkflowTagName` at `PiConsolidationAgent.ts:91-100`.
- Import shared helpers. This should be behavior-equivalent if utility uses trim+lowercase.

### Optional adjacent cleanup
- `apps/backend/src/api/cases/handlers.ts:58-59` has a duplicate `getWorkflowTagNames`; can switch to shared helper, but it uses raw case-sensitive `workflowTagNames.has(tag.name)` at `handlers.ts:152`. If converting, use `isWorkflowTagName(tag.name, workflowTagNames)` to preserve normalized matching.

## Tests to add/update

1. New unit test file: `apps/backend/tests/utils/tagState.test.ts`
   - `getProcessingStateFromTagNames` priority:
     - failed wins over done/review.
     - done recognizes both `done` and legacy `processed`.
     - review recognizes `review`, `manualReview`, `schemaReview`.
     - index recognizes `index` and `tagsDone`.
     - metadata recognizes `metadata`, `summaryDone`, `titleDone`, `correspondentDone`, `documentTypeDone`.
     - ocr recognizes `ocr` and `ocrDone`.
     - todo recognizes `todo`/`pending`, and unknown/empty defaults to `todo`.
   - Coarse tag config: when `ocr`, `metadata`, and `index` are the same string and that tag is present, state is `metadata`.
   - `getDocumentTagNames` prefers `tag_names` over id map and otherwise resolves ids from `Map<number,string>`.
   - `getWorkflowTagNames` + `isWorkflowTagName` trims/lowercases config names, ignores empty values, and treats any `llm-*` tag as workflow.

2. Existing `apps/backend/tests/agents/ProcessingPipeline.test.ts`
   - Existing `uses the case phase as authoritative` test should still pass; it verifies the local wrapper still honors case state before tag state.
   - Add/adjust a test for `getCurrentState` with no case row and legacy alias/coarse tags if not already covered.

3. Existing `apps/backend/tests/server.test.ts`
   - Current SSE test should still pass.
   - Add a small case if desired: config with `ocr === metadata === index` and first doc tagged with that shared tag should call `processStepStream` with `metadata` (not `ocr`) after server adopts shared utility. This locks in parity with `ProcessingPipeline`.

4. Existing Pi agent tests
   - If `PiDocumentAgent` tests assert workflow tags are rejected/filtered, run them. If none specifically cover normalization, add a focused utility test rather than large agent test; the utility is pure.

## Validation commands

Targeted:
```bash
pnpm --filter backend test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts tests/server.test.ts
```

If filter syntax is not accepted in this workspace, use:
```bash
cd apps/backend && pnpm test -- tests/utils/tagState.test.ts tests/agents/ProcessingPipeline.test.ts tests/server.test.ts
```

Then run broader checks if time permits:
```bash
pnpm --filter backend typecheck
pnpm --filter backend test
```

## Compact worker prompt

Implement Todo #33 / W4-S18: extract duplicated tag-state/workflow-tag logic into one pure TypeScript utility. Add `apps/backend/src/utils/tagState.ts` exporting `ProcessingState`, tag-config type/helpers, `getWorkflowTagNames`, `isWorkflowTagName`, `getDocumentTagNames`, and `getProcessingStateFromTagNames`/`getProcessingStateFromDocumentTags`. Preserve current state priority: failed > done/processed > review/manualReview/schemaReview > coarse `ocr===metadata===index` => metadata > index/tagsDone > metadata + metadata aliases > ocr/ocrDone > todo/pending/default. Keep `ProcessingPipeline` case-state authority local, but delegate tag-state detection to the utility. Replace duplicate helpers in `server.ts`, `ProcessingPipeline.ts`, `PiDocumentAgent.ts`, and `PiConsolidationAgent.ts`; optional adjacent cleanup in `api/cases/handlers.ts` is okay if safe. Workflow tag helpers should trim/lowercase config/name comparisons and still classify any `llm-*` tag as workflow. Add focused unit tests for the utility plus update existing pipeline/server tests as needed. Validate with backend targeted tests and typecheck.

## Assumptions / risks

- The requested “tag-state logic” includes both pipeline state-from-tags and workflow-tag classification because the specified Pi agents only duplicate the workflow-tag helpers, not pipeline state detection.
- Do not import `ProcessingPipeline` from server just to reuse `getCurrentState`; that would entangle SSE state detection with TinyBase case authority and runtime service behavior. Use a pure utility instead.
- Normalizing workflow helper comparisons is a small behavior improvement vs `PiDocumentAgent` raw-set behavior. It matches `PiConsolidationAgent` and is safer for user-configured tag names.
- State detection should likely remain exact/case-sensitive to minimize behavior changes, unless the implementer explicitly decides to normalize and adds tests.
