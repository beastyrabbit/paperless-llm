# Todo #11 / W3-S14 handoff: global LLM/OCR concurrency caps

## Scope inspected

High-value paths that can issue LLM/OCR work or start jobs:

- Mistral generic service: `apps/backend/src/services/MistralService.ts`
- Ollama generic service and streams/embeddings: `apps/backend/src/services/OllamaService.ts`
- Direct Mistral OCR + local `ocrmypdf`: `apps/backend/src/agents/OCRAgent.ts`
- Pi metadata pipeline/job orchestration: `apps/backend/src/agents/ProcessingPipeline.ts`, `apps/backend/src/agents/PiDocumentAgent.ts`, `apps/backend/src/services/AutoProcessingService.ts`
- Legacy bulk jobs: `apps/backend/src/jobs/BulkOcrJob.ts`, `apps/backend/src/jobs/BulkIngestJob.ts`, `apps/backend/src/jobs/BootstrapJob.ts`, `apps/backend/src/jobs/SchemaCleanupJob.ts`
- Config/tests: `apps/backend/src/config/{schema,index,yaml-loader}.ts`, `config.example.yaml`, service/agent/job tests under `apps/backend/tests/**`

No existing semaphore/concurrency-limit utility was found (`Semaphore`, `makeSemaphore`, `withPermit`, `concurrencyLimit` all absent in `apps/backend/src`). Existing `Effect.all(..., { concurrency: "unbounded" })` is used for independent Paperless/catalog reads, not LLM/OCR throttling.

## Exact file evidence and important call sites

### MistralService: all generic Mistral calls go through one helper

`apps/backend/src/services/MistralService.ts`

- Dynamic config and retry settings: lines 120-143.
- Central `request<T>` helper: lines 148-218. It builds `requestOnce` at lines 166-199, retries in a loop at lines 201-213, and currently has no global cap.
- Public methods all route through `request`: `listModels` lines 221-225, `chat` lines 227-240, `processImage` lines 242-265, `processDocument` starts lines 267-280.

Implication: adding a Mistral limiter around `requestOnce` in this service covers legacy bulk OCR/ingest uses of `MistralService.processDocument`, settings model listing, generic chat/image/document requests. Prefer gating each request attempt, not the whole retry loop, so sleeping backoff does not consume a permit.

### OllamaService: generic Ollama calls, streams, embeddings

`apps/backend/src/services/OllamaService.ts`

- Dynamic config includes timeout only: lines 150-167.
- Central non-stream `request<T>` helper: lines 171-212.
- Non-stream calls: `chat` lines 227-240, `generate` lines 352-368, `embed` lines 480-512, `listModels`/`getRunningModels`/`testConnection` also use `request`.
- Stream calls bypass `request` and do their own `fetchWithTimeout`: `chatStream` lines 241-350 (shown in inspection around 263-348) and `generateStream` lines 370-478.

Implication: a limiter in `request` covers non-stream chat/generate/embed and status/model calls, including Qdrant embeddings. Streams need explicit lifetime gating; the permit must be held until `emit.end`/`emit.fail`/abort finalizer, not just around the initial `fetch`.

### OCRAgent: direct Mistral OCR bypasses MistralService

`apps/backend/src/agents/OCRAgent.ts`

- Direct `/v1/ocr` request in `runMistralOCR`: lines 140-219. It has its own retry loop and no shared `MistralService` dependency.
- Local searchable PDF generation spawns `ocrmypdf`: lines 221-230 and surrounding function.
- Persistence calls local OCR PDF generation before uploading: `generateSearchablePdf` at line 356, upload/patch follows lines 361-390.
- Actual OCR runs at line 596 after cache/skip checks; cached OCR path lines 540-593 avoids remote OCR but still may call `persistOcrResult` and therefore local `ocrmypdf`.

Implication: limiting only `MistralService` leaves the main Pi OCR path uncapped. Add limiter directly in `OCRAgent` around the direct Mistral OCR attempt, and consider the local `ocrmypdf` spawn as part of an OCR cap as well. If there are separate caps, the direct Mistral OCR call should consume both the Mistral/API cap and OCR cap, while `ocrmypdf` should consume OCR only.

### ProcessingPipeline and AutoProcessing: document locks are per-document, not global

`apps/backend/src/agents/ProcessingPipeline.ts`

- Per-document lock acquired/released in `withDocumentLock` (read around lines 620-740 earlier; lock acquisition/release is before the shown section in the file). This prevents concurrent processing of the same document only.
- State transitions use unbounded Paperless catalog calls, e.g. `transition` lines 620-622 and `indexDocument` lines 719-727. These are not LLM/OCR calls.
- Main document processing calls OCR at lines 935-950 and metadata at lines 986-999 (metadata call starts earlier at `processMetadata`, line 795 in the file). Indexing happens at lines 1016-1033.
- Manual single-step OCR calls `ocrAgent.process` at lines 1052-1103.

`apps/backend/src/services/AutoProcessingService.ts`

- Background auto-processing processes only one selected doc at a time: lines 292-325 call `pipeline.processDocument({ docId })` synchronously before continuing.

Implication: auto-processing itself is serial, but manual API routes, pending/cases actions, bulk jobs, chat, metadata helpers, and multiple HTTP requests can overlap. Global caps must live at service/resource level, not just in AutoProcessing or per-document locks.

### PiDocumentAgent: primary Pi LLM path bypasses OllamaService

`apps/backend/src/agents/PiDocumentAgent.ts`

- Small verifier uses `OllamaService.chat`: lines 1125-1140. This will be covered by an OllamaService limiter.
- Primary Pi agent builds a model with direct Ollama OpenAI-compatible URL: lines 2230-2236 use `buildOllamaModel(settings.ollamaUrl, ...)`.
- Pi agent uses `streamSimple` and `getApiKey: () => "ollama"`: lines 2265-2268. This bypasses `OllamaService` entirely.
- `agent.prompt` is executed in `runPrompt`: lines 2337-2355, with timeout/abort on timeout.

`apps/backend/src/agents/piOllamaModel.ts`

- `buildOllamaModel` points at `${url}/v1` and returns a Pi model; no limiter hook exists there.

Implication: if only `OllamaService` is capped, the main document metadata agent can still run unlimited concurrent Ollama calls. The pragmatic implementation is to wrap the `agent.prompt(message)` effect in `PiDocumentAgent` with the global Ollama limiter. This holds one permit for the whole Pi prompt/agent run, which is conservative but closes the bypass. If finer-grained per-request Pi transport hooks are available in `@earendil-works/pi-ai`, worker may use them, but local evidence does not show such a hook.

### Legacy/bulk jobs

`apps/backend/src/jobs/BulkOcrJob.ts`

- Sequential for-loop; Mistral OCR via `mistral.processDocument` at lines 141-148; sleeps after each doc. Once `MistralService` is capped this path is covered.

`apps/backend/src/jobs/BulkIngestJob.ts`

- Sequential for-loop; Mistral OCR via `mistral.processDocument` at lines 226-233; Qdrant indexing at lines 272-290 eventually calls Ollama embeddings through `QdrantService` -> `OllamaService.embed`.

`apps/backend/src/jobs/BootstrapJob.ts`

- Compatibility shell; no LLM calls, only Paperless/TinyBase logging.

`apps/backend/src/jobs/SchemaCleanupJob.ts`

- Calls `PiConsolidationAgentService.generateReport()`; inspect if implementation proceeds to edits because consolidation/tag explorer may use Pi/Ollama. Grep did not find direct `OllamaService` in this file, but `PiConsolidationAgent` should be checked by implementation worker if adding global Pi wrapper beyond document agent.

### Other Ollama direct/indirect API paths

Grep evidence:

- `apps/backend/src/api/chat/handlers.ts` uses `QdrantService.searchSimilar` then `OllamaService.chat` (grep lines around 54-130). Covered by OllamaService limiter for chat and embeddings.
- `apps/backend/src/api/metadata/handlers.ts` uses `OllamaService.generate` for field description/name suggestions (grep around lines 157-205). Covered.
- `apps/backend/src/services/QdrantService.ts` uses `OllamaService.embed`: lines 98-100 inject service, line 136 defines `embed`, search embeds query and upsert embeds document content (read lines 134-177 and 178 onward). Covered by OllamaService limiter.
- Settings handlers list Ollama/Mistral models and status via services. Covered if service request helper is capped.

## Recommended design

### Add a single global resource limiter service/layer

Create a new backend service, e.g. `apps/backend/src/services/ConcurrencyLimitService.ts` (or `ResourceLimiterService.ts`), exported from `apps/backend/src/services/index.ts` and provided in `apps/backend/src/layers/index.ts` before services/agents that need it.

Suggested interface:

```ts
export interface ConcurrencyLimitService {
  readonly withOllama: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly withMistral: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly withOcr: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}
```

Implementation should use Effect semaphores (Effect v3 provides semaphore primitives; import from `effect`). Clamp each cap to an integer >= 1. Defaults should be conservative and backwards-safe; suggested defaults:

- `ollamaMaxConcurrent: 1`
- `mistralMaxConcurrent: 1`
- `ocrMaxConcurrent: 1`

If maintainers prefer preserving current behavior by default, use a high default. But the todo asks for global caps, so default `1` is safer for local GPU/OCR stability.

### Config shape

Add a new top-level config section instead of overloading `http`:

```yaml
concurrency:
  ollama_max_concurrent: 1
  mistral_max_concurrent: 1
  ocr_max_concurrent: 1
```

Files to update:

- `apps/backend/src/config/schema.ts`: add `ConcurrencyConfigSchema`, `ConcurrencyConfig` type, `concurrency` in `AppConfigSchema`, and `ResolvedConfig.concurrency`.
- `apps/backend/src/config/index.ts`: add defaults and merge in `applyDefaults`.
- `apps/backend/src/config/yaml-loader.ts`: normalize snake_case to camelCase (`ollamaMaxConcurrent`, `mistralMaxConcurrent`, `ocrMaxConcurrent`) and load env vars. Suggested env names:
  - `PAPERLESS_LLM_OLLAMA_MAX_CONCURRENT`
  - `PAPERLESS_LLM_MISTRAL_MAX_CONCURRENT`
  - `PAPERLESS_LLM_OCR_MAX_CONCURRENT`
- `config.example.yaml` and production/readonly examples if applicable.

Avoid dynamic TinyBase-backed cap resizing for this ticket unless explicitly required. Current services read TinyBase settings dynamically for model URLs, but semaphore resizing at runtime is easy to get wrong; fixed process-level caps from resolved config are implementation-ready and testable.

### Where to apply the caps

1. `MistralService.ts`
   - Inject `ConcurrencyLimitService` in `MistralServiceLive`.
   - Wrap `requestOnce` per attempt inside retry loop, e.g. `yield* limiter.withMistral(requestOnce)` before `Effect.either`.
   - Do not hold permits during `Effect.sleep` backoff.

2. `OllamaService.ts`
   - Inject limiter.
   - Wrap central non-stream `request<T>` `Effect.tryPromise` in `withOllama`.
   - For `chatStream` and `generateStream`, hold an Ollama permit for the entire stream lifetime. Current implementation uses `Stream.asyncEffect` with an async IIFE and a finalizer that aborts. The worker should be careful to release the permit on all paths: normal `emit.end`, `emit.fail`, parse error, fetch error, and stream interruption. A scoped/finalizer style is preferable to manually calling release in many branches.
   - `embed` can use `withOllama` around its `Effect.tryPromise` (it bypasses central `request`).

3. `OCRAgent.ts`
   - Inject limiter.
   - Wrap direct `/v1/ocr` request attempts with `withMistral` and `withOcr`. Because this direct fetch bypasses `MistralService`, both caps are needed if the project wants both vendor/API and OCR-stage caps to reflect it.
   - Wrap local `ocrmypdf` spawn (`generateSearchablePdf`) with `withOcr` as well. If this is considered too broad, at minimum cap `runMistralOCR`; but the user request names OCR caps, and local `ocrmypdf` is an OCR CPU process.
   - Avoid wrapping skip/cache checks so no permit is consumed for no-op documents. Note: cached OCR still calls `persistOcrResult`, which may run `ocrmypdf`; that should consume only OCR cap.

4. `PiDocumentAgent.ts`
   - Inject limiter.
   - Wrap `agent.prompt(message)` in `runPrompt` with `withOllama`, because the main Pi path uses `streamSimple` + direct OpenAI-compatible Ollama URL and bypasses `OllamaService`.
   - Small verifier already uses `OllamaService.chat`, so it will be covered. Because the verifier can run inside the agent prompt/tool loop, holding a Pi prompt Ollama permit while the verifier asks `OllamaService.chat` can deadlock if `ollamaMaxConcurrent` is `1` and semaphores are not reentrant. To avoid this, do **not** blindly hold the same Ollama permit across the whole `agent.prompt` if verifier calls can nest. Options:
     - Preferred: do not wrap entire `agent.prompt`; instead find/inject a Pi transport hook to apply limiter per model request. Local code did not expose this, so investigate Pi docs/source in `node_modules/@earendil-works/pi-ai` if needed.
     - Practical fallback: introduce a separate `withPiOllama` cap or count Pi agent prompt under a separate cap; however the requirement is “global Ollama” caps, so this is less ideal.
     - Another practical fallback: wrap `agent.prompt` only when confirmation is disabled, or release before tool verifier runs if Pi exposes hooks. This needs implementation care.
   - This is the highest-risk area. The next worker must avoid self-deadlock between main Pi prompt and small-model verifier.

5. `PiConsolidationAgent` / `PiTagExplorerAgent` / other Pi agents
   - Grep showed `PiDocumentAgent` and `PiTagExplorerAgent` are involved. Before final implementation, search `new PiAgent`, `streamSimple`, and `buildOllamaModel` in all `apps/backend/src/agents/*.ts`. Any direct Pi/Ollama model call needs the same bypass mitigation as document agent.

## Bypass risks to explicitly close

- **OCRAgent direct Mistral `/v1/ocr`**: not covered by `MistralService` limiter.
- **Pi main agent via `streamSimple`**: not covered by `OllamaService` limiter; also nested verifier deadlock risk if naively wrapping whole prompt.
- **Ollama streams**: not covered by non-stream `request` helper; permit must cover stream lifetime and release on interruption.
- **Ollama embeddings**: `embed` bypasses `request`; must be wrapped separately.
- **Local `ocrmypdf`**: not an HTTP request; only OCR cap in `OCRAgent` can limit it.
- **Multiple service instances/layers**: ensure one limiter layer instance is shared across the whole app layer. If each service creates its own semaphore, caps are not global.
- **Retry sleeps**: holding a permit during Mistral backoff can starve work under errors. Gate attempts, not sleeps, unless the desired semantics are “in-flight job” caps.
- **Tests with mocked layers**: service tests will need updated mock `ConfigService.config.concurrency` or casts already `unknown as ConfigService` may hide it; new limiter dependency must be provided in tests.

## Tests to add/update

Targeted tests should prove both queuing and bypass closure.

1. New limiter service unit tests (new `apps/backend/tests/services/ConcurrencyLimitService.test.ts`)
   - Cap clamps invalid values to >= 1.
   - With cap 1, two `withOllama` effects do not overlap. Use `Deferred`/`Ref` or delayed promises to assert max active count is 1.
   - Same for `withMistral` and `withOcr` if not too repetitive.

2. `MistralService.test.ts`
   - Existing tests are in `apps/backend/tests/services/MistralService.test.ts`.
   - Add/provide limiter layer.
   - Add test: with `mistralMaxConcurrent: 1`, two concurrent `mistral.listModels()` or `chat()` calls use fetch mock that blocks; assert second fetch does not start until first resolves.
   - Ensure retry test still passes and backoff does not hold permit unnecessarily if tested.

3. `OllamaService.test.ts`
   - Existing stream tests in `apps/backend/tests/services/OllamaService.test.ts`.
   - Add/provide limiter layer.
   - Non-stream: cap 1 serializes concurrent `chat`/`generate`/`embed` calls.
   - Stream: start one stream that holds response open; start second stream; assert second fetch waits until first stream ends or is interrupted. Also assert malformed stream releases permit so a following call can proceed.

4. `OCRAgent.test.ts`
   - Existing tests in `apps/backend/tests/agents/OCRAgent.test.ts`.
   - Add/provide limiter layer.
   - Test direct `/v1/ocr` path is capped: two `ocr.process({ docId })` calls for different mocked docs with no reusable/cached content should not overlap at the fetch call when `ocrMaxConcurrent`/`mistralMaxConcurrent` are 1.
   - If `ocrmypdf` is capped, mock `child_process.spawn` or isolate `generateSearchablePdf` behavior enough to assert only one spawn runs at a time.

5. `PiDocumentAgent` / Pi bypass tests
   - If implementation finds a Pi transport hook, unit-test that concurrent Pi model requests are gated without deadlocking verifier.
   - If wrapping prompt or using separate Pi limiter, add a regression test for `ollamaMaxConcurrent: 1` with confirmation/verifier enabled to ensure no deadlock. This may require mocking PiAgent/streamSimple.

6. Config tests
   - Existing `apps/backend/tests/config/config.test.ts` should get cases for YAML snake_case and env vars producing resolved `config.concurrency`.

## Validation commands

Run from repo root unless noted:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend build
pnpm --filter @repo/backend lint
```

For faster iteration during implementation:

```bash
pnpm --filter @repo/backend test -- apps/backend/tests/services/MistralService.test.ts apps/backend/tests/services/OllamaService.test.ts apps/backend/tests/agents/OCRAgent.test.ts apps/backend/tests/config/config.test.ts
```

If filter syntax is not accepted by the workspace runner, use from `apps/backend`:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm lint
```

## Compact worker prompt

Implement global LLM/OCR concurrency caps. Add a shared backend limiter service/layer backed by Effect semaphores with config/env/YAML keys `concurrency.ollama_max_concurrent`, `concurrency.mistral_max_concurrent`, `concurrency.ocr_max_concurrent` (defaults 1, clamp >=1). Wire it as a singleton through `services/index.ts` and `layers/index.ts`. Apply Mistral cap to `MistralService` request attempts; apply Ollama cap to `OllamaService` non-stream requests, embeddings, and full stream lifetimes; apply Mistral+OCR caps to `OCRAgent` direct `/v1/ocr` and OCR cap to local `ocrmypdf` spawn. Close direct Pi/Ollama bypasses (`new PiAgent` + `streamSimple`/`buildOllamaModel`) without deadlocking the small verifier that uses `OllamaService.chat`; inspect all Pi agents for similar direct model paths. Update config schema/defaults/yaml-loader/examples and add tests proving cap=1 serializes Mistral, Ollama non-stream/stream/embed, OCR direct calls, and config parsing. Run backend tests/typecheck/build/lint.

## Open question / caution for implementer

The only unresolved design risk is Pi main-agent gating. Local code shows Pi uses direct Ollama `/v1` and not `OllamaService`; however wrapping the whole `agent.prompt` with the same Ollama semaphore can deadlock when tools invoke the small verifier (`OllamaService.chat`) under cap 1. The worker should inspect Pi library hooks/source before choosing the final strategy. Do not ship a solution that caps `OllamaService` only and leaves Pi direct calls uncapped.