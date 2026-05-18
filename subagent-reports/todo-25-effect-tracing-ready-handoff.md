# Todo #25 / W3-S16 — Effect tracing ready handoff

Scope: final implementation handoff for **“Wire Effect tracing to OTLP or a compatible local sink”** after refreshing against the latest tree. I did not edit source files. Metrics have now landed; upstream health remains static in this worktree.

## Requirement and current status

Source requirement: `docs/plans/audit-rework-tasks.md:305-318` W3-S16:

- Generate OpenAPI from shared schemas.
- Serve API docs in development.
- Expose metrics for pipeline phases, retries, errors, and LLM latency.
- **Wire Effect tracing to OTLP or a compatible local sink.**
- Extend health checks to include Paperless, Ollama, Qdrant, and Mistral.
- Acceptance includes `/health` dependency status, `/metrics`, and generated docs.

Latest code observations:

- Metrics are implemented and should be reused for naming/sanitization patterns:
  - `apps/backend/src/services/MetricsService.ts:55-162` defines `MetricsRegistry` and Prometheus renderer.
  - `apps/backend/src/services/MetricsService.ts:164-191` normalizes route paths from shared API contracts.
  - `apps/backend/src/services/MetricsService.ts:193-206` classifies timeout/error outcomes and retry reasons.
  - `apps/backend/src/services/MetricsService.ts:208-217` exposes counters/histograms for HTTP, pipeline phases/errors/retries, and LLM/OCR latency.
  - `apps/backend/src/server.ts:779-790` records HTTP request metrics in the existing `res.on("finish")` hook.
  - `apps/backend/src/server.ts:818-823` serves public `GET /metrics` before auth.
  - Tests: `apps/backend/tests/services/MetricsService.test.ts`, `apps/backend/tests/server.test.ts:191-211`.
- Health is still static in router: `apps/backend/src/api/index.ts:219` registers `GET /health` as `Effect.succeed({ status: "healthy" })`. No dependency health implementation was found.
- Tracing is absent: no `@effect/opentelemetry`, OTLP exporter, `Layer.setTracer`, or `Effect.withSpan` instrumentation in `apps/backend/src`.

## Dependency/options decision

### Preferred: Effect OTLP bridge, pinned to compatible version

Current backend deps in `apps/backend/package.json:16-29`:

- `effect ^3.19.14`
- `@effect/platform ^0.94.1`
- `@effect/platform-node ^0.104.0`
- no OpenTelemetry/OTLP dependency.

External package check performed with `npm view`:

- `@effect/opentelemetry@0.60.0` peers on `effect ^3.19.13` and `@effect/platform ^0.94.0`, matching this backend.
- `@effect/opentelemetry@0.63.0` peers on `effect ^3.21.0` and `@effect/platform ^0.96.0`, so do **not** use latest without upgrading Effect/platform.
- `@effect/opentelemetry@0.60.0` peer dependencies also include OpenTelemetry packages (`@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node`, `@opentelemetry/resources`, etc.). Add whatever pnpm requires explicitly if peer warnings/typecheck demand it.
- Packed type evidence for `@effect/opentelemetry@0.60.0`:
  - `Otlp.layer({ baseUrl, resource, headers, tracerExportInterval, shutdownTimeout, ... }) => Layer<never, never, HttpClient.HttpClient>`.
  - `OtlpTracer.layer({ url, resource, headers, exportInterval, shutdownTimeout }) => Layer<never, never, HttpClient.HttpClient>`.
  - These require an `HttpClient.HttpClient` layer; use current `@effect/platform-node` `NodeHttpClient.layer`.

Recommended dependency change:

```bash
pnpm --filter @repo/backend add @effect/opentelemetry@0.60.0
# add OTel peer packages only if pnpm/typecheck requires explicit direct deps
```

### Acceptable fallback: local Effect tracer sink

If OTLP bridge integration fails, implement a compatible local sink using Effect native tracing:

- Effect APIs are available in installed `effect@3.19.14`:
  - `Effect.withSpan` in `node_modules/.pnpm/effect@3.19.14/.../Effect.d.ts:26079`.
  - `Effect.annotateCurrentSpan` in the same types.
  - `Layer.setTracer`, `Layer.setTracerEnabled`, `Layer.setTracerTiming` in `Layer.d.ts:1266-1276`.
  - `Tracer.make` in `Tracer.d.ts:124`.
- Sink modes: `none`, `console`, `jsonl`, and test-only/memory sink.
- Emit JSON fields: trace id, span id, parent id, name, kind, start/end/duration, status/error, sanitized attributes/events.
- This satisfies “or a compatible local sink,” but document that it is not OTLP.

Avoid a separate manual OpenTelemetry API span system disconnected from Effect spans unless forced.

## Exact files to create/modify

Create:

1. `apps/backend/src/observability/tracing.ts`
   - Env/config parsing.
   - OTLP/local sink layer builder.
   - No-op/default disabled behavior.
   - Attribute/event sanitizer.
   - Helpers such as `withInternalSpan`, `withClientSpan`, `annotateSpan`, and `spanEvent` if needed.
2. `apps/backend/tests/observability/tracing.test.ts`
   - Config parsing.
   - Disabled-by-default behavior under tests.
   - Sanitizer coverage.
   - Local/memory sink assertions if fallback/local sink is implemented.

Modify:

1. `apps/backend/package.json` and `pnpm-lock.yaml` for OTLP dependency if choosing OTLP.
2. `apps/backend/src/layers/index.ts`
   - Compose tracing layer into `AppLayer` or export a traced app layer.
   - Keep `TestLayer` and default tests no-op unless explicitly opted in.
3. `apps/backend/src/index.ts`
   - If using OTLP/Sdk lifecycle, ensure graceful shutdown flushes/closes finalizers. Current `runCleanup()` only calls server cleanup synchronously.
4. `apps/backend/src/server.ts`
   - Add server spans at HTTP request boundaries.
   - Instrument direct SSE routes outside the router.
   - Reuse `normalizeMetricPath(url.pathname)` for bounded `http.route`/route-like path.
5. Optional but useful: `apps/backend/src/api/index.ts`
   - Current `RouteMatch` (`api/index.ts:58-66`) lacks method/path metadata while `Route` has `method`/`path` (`api/index.ts:68-77`). Expose matched route template if the worker wants exact `http.route` for normal API routes.
6. Pipeline/agent/service files listed below.
7. Config/docs examples once env names are final: `.env.example`, `config.example.yaml`, README or docs note.

## Runtime and instrumentation touchpoints

### App runtime/layers

- `apps/backend/src/index.ts:38-64` runs `Effect.runPromise(pipe(main, Effect.provide(AppLayer)))`.
- `apps/backend/src/server.ts:456-473` builds a scoped runtime once per server with `Layer.toRuntime(appLayer).pipe(Scope.extend(scope), Effect.cached, Effect.flatten)` and reuses it via `runWithRuntime`.
- `apps/backend/src/layers/index.ts:116-123` defines `AppLayer`; this is the cleanest place to merge/provide tracing so all request/background effects share the tracer.
- Test setup (`apps/backend/tests/setup.ts:21-35`) mocks fetch, sets silent logging, and sets temp TinyBase env. Tracing must default disabled and must not attempt network export in tests.

### HTTP server

High-value lines:

- `server.ts:779-790`: finish hook logs completion and records metrics. Good place to ensure span status attributes are known, but the active Effect span may not be alive here unless the tracer helper supports finish callbacks.
- `server.ts:818-823`: public `/metrics` path.
- `server.ts:845-941`: direct SSE stream routes for processing, case, and catalog run snapshots.
- `server.ts:961-972`: normal API route effect construction and `runWithRuntime(effect)`.
- `server.ts:996-1039`: request parsing/unhandled error response.

Recommended HTTP spans:

- Span name `http.request`, kind `server`.
- Attributes: `request.id`, `http.request.method`, `http.route` or normalized path, `url.path`, `http.response.status_code`, `error.type` on failure.
- Reuse `requestId` from `createRequestId()` and `X-Request-Id` header.
- Reuse `normalizeMetricPath(url.pathname)` from metrics for bounded route-ish path.
- Do not attach raw headers/bodies. Existing header sanitizer in `server.ts` redacts `authorization`, `x-api-key`, `cookie` in tests.

### Metrics patterns now available

- `MetricsService.normalizeMetricPath(path)` uses shared `apiRouteContracts` to convert paths like `/api/documents/123` to templates. Use or extract similar logic for trace `http.route`.
- `MetricsService.classifyMetricsErrorOutcome` and `metricReasonFromError` provide bounded timeout/error classification. Use the same bounded vocabulary for span `error.type`/retry events.
- `ProcessingPipeline.ts:207-239` has an `instrumentPhase` helper wrapping Effect success/error to observe phase counters/durations. If adding spans here, extend/wrap this helper rather than duplicating phase instrumentation.

### Processing pipeline

High-value lines:

- `apps/backend/src/agents/ProcessingPipeline.ts:207-239`: metrics `instrumentPhase` helper.
- `ProcessingPipeline.ts:292-299`: `recordStageFailure` increments `paperless_llm_pipeline_errors_total` with bounded phase/kind/retryable.
- `ProcessingPipeline.ts:785-824`: `processMetadata` calls Pi document agent and transitions review/index/failed states.
- `ProcessingPipeline.ts:827-843`: `processIndex` wraps Qdrant indexing and failure transition.
- `ProcessingPipeline.ts:868+`: `processDocument` orchestrates full OCR -> metadata -> index flow under `withDocumentLock`.
- `ProcessingPipeline.ts:1052+`: `processStep` individual step path.
- `ProcessingPipeline.ts:1133+`: stream variants emit SSE events.

Recommended spans:

- Root internal span `pipeline.process_document` with attributes `doc.id`, `dry_run`, `auto`, `resume`, `pipeline.mode=full`.
- Child spans `pipeline.step.ocr`, `pipeline.step.metadata`, `pipeline.step.index`.
- Optional lock spans around `withDocumentLock` if easy.
- Annotate only bounded results: `success`, `needs_review`, `step`, `error.kind`, `retryable`; never document content/OCR text/generated metadata.

### OCR/Mistral direct OCR

High-value lines:

- `apps/backend/src/agents/OCRAgent.ts:155-257`: direct `runMistralOCR` builds a base64 PDF payload and retry loop; metrics are already recorded on success/error/retry.
- `OCRAgent.ts:258+`: `generateSearchablePdf` child-process helper.
- `OCRAgent.ts:457-718`: main OCR `process` flow, Paperless download/cached OCR/Mistral OCR/persist.

Recommended spans:

- `ocr.process` internal span with `doc.id`, `mock_mode`, `force`.
- `mistral.ocr.request` client span around direct OCR fetch/retry loop.
- Retry events: attempt number, status code, retry delay only.
- Never include PDF/base64, OCR markdown/text, Authorization, or full error response text if it may contain payload.

### External service helpers

Instrument centralized helpers, not every public method.

Paperless (`apps/backend/src/services/PaperlessService.ts`):

- `request<T>` at `:301-366` for JSON API calls.
- `binaryRequest` at `:376-431` for downloads.
- `multipartRequest` at `:439-480` for uploads.
- Span names `paperless.request`, `paperless.binary_request`, `paperless.multipart_request`, kind `client`.
- Attributes: `peer.service=paperless`, method, sanitized path/template, status code, `paperless.api.version=10` where applicable. Never token/query values/body/document content.

Ollama (`apps/backend/src/services/OllamaService.ts`):

- JSON helper `request<T>` at `:176-216` now records LLM metrics.
- `chatStream` at `:246-354`, `generateStream` at `:376-484`, `embed` at `:550-611` use custom fetch/stream paths and metrics.
- Span names: `ollama.request`, `ollama.chat_stream`, `ollama.generate_stream`, `ollama.embed`, kind `client`.
- Attributes: `peer.service=ollama`, endpoint path, model, stream boolean, outcome. Never prompts/messages/text/embeddings.
- Risk: `chatStream`/`generateStream`/`piOllamaModel.ts` use `Effect.runPromise` inside stream callbacks and may lose runtime tracer context; validate.

Mistral service (`apps/backend/src/services/MistralService.ts`):

- Generic `request<T>` at `:151-215` has retry loop and metrics.
- Public calls `listModels`, `chat`, `processImage`, `processDocument`, `testConnection` use it.
- Span name `mistral.request`, kind `client`, attributes `peer.service=mistral`, endpoint path, model, operation, retry attempts.
- Retry events only: attempt/status/delay/reason. Never Authorization/prompts/images/PDF/base64/OCR text.

Qdrant (`apps/backend/src/services/QdrantService.ts`):

- `searchSimilar` at `:121-176` embeds query and calls `client.search`.
- `upsertDocument` at `:178-219` embeds document content and calls `client.upsert`.
- `deleteDocument`, `testConnection`, `ensureCollection` at `:221+`.
- Span names `qdrant.search`, `qdrant.upsert`, `qdrant.delete`, `qdrant.ensure_collection`, kind `client`.
- Attributes: `peer.service=qdrant`, collection, limit, filter booleans. Never query text, content, payload, vectors.

### Pi document agent / Pi library boundary

High-value lines:

- `apps/backend/src/agents/PiDocumentAgent.ts:1478-1480`: tool helper runs `Effect.runPromise(effect, { signal })`, potentially outside the app runtime/tracer context.
- `PiDocumentAgent.ts:2445-2494`: builds `PiAgent` with model and tools.
- `PiDocumentAgent.ts:2496-2524`: subscription captures assistant responses/tool start/tool end; currently includes `args` and `result` in internal events.
- `PiDocumentAgent.ts:2610-2699`: `runPrompt` wraps `agent.prompt`, timeout, and LLM metrics.
- `apps/backend/src/agents/piOllamaModel.ts:57-74`: `makeGatedOllamaStreamSimple` also uses `Effect.runPromise(concurrency.withOllama(...streamSimple...))` outside the app runtime.

Recommended spans/events:

- `pi.document_agent.process` around `processDocument` with `doc.id`, `dry_run`, `auto`, `resume`, selected model names.
- `pi.agent_prompt` around `runPrompt` with model and outcome.
- Low-cardinality events for `message_end`, `tool_execution_start`, `tool_execution_end` with tool name/status only.
- Do **not** attach `event.args`, `event.result`, prompts, message content, tool payloads, or document content.
- Validate trace context across `Effect.runPromise` boundaries; if context is lost, explicitly pass/restore safe parent context or accept spans as new roots with clear naming.

## Sanitization and cardinality constraints

Hard no-trace data:

- Authorization/Cookie/X-API-Key/tokens/secrets/passwords/credentials.
- Prompts, chat messages, document content, OCR text/markdown, PDFs/base64, images, embeddings/vectors.
- Raw request/response bodies, tool args/results, Paperless metadata payloads, Qdrant payload/vector values.
- Raw headers except explicitly sanitized low-risk headers if approved.

Low-cardinality rules:

- Prefer route templates/operation names over raw URLs with IDs/query strings.
- `doc.id`, `run.id`, and `request.id` are acceptable trace attributes but should not be used as metrics labels.
- For retry/error attributes use bounded classification (`timeout`, `error`, `http_429`, etc.) from metrics helpers.

Project invariant: do not reintroduce prompt-file or PromptService-driven processing; Pi agent instructions/tools/schemas remain TypeScript-defined.

## Tests to add/update

Minimum automated tests:

1. `apps/backend/tests/observability/tracing.test.ts`
   - tracing disabled by default under test env;
   - OTLP env parses endpoint/service name/export interval when enabled;
   - local sink env parses if implemented;
   - sanitizer redacts/drops keys matching authorization, x-api-key, token, secret, password, cookie, prompt, content, base64, pdf, embedding(s), messages, args, result, body.
2. If local/memory sink exists:
   - `Effect.withSpan` emits a sanitized span with parent/child relationship;
   - HTTP server test starts `createHttpServerWithLayer`, calls a harmless route, and asserts `http.request` span has request id/method/route/status and no headers/body;
   - one client service test (Ollama or Mistral with mocked `global.fetch`) asserts client span appears and prompt/API key is absent.
3. If OTLP only:
   - add config/sanitizer tests and, if practical, a mocked OTLP HTTP collector test;
   - otherwise typecheck + manual collector validation is the automated floor.
4. Regression tests must not require real Paperless/Ollama/Mistral/Qdrant.

Useful existing test patterns:

- `apps/backend/tests/server.test.ts` starts real HTTP server via `createHttpServerWithLayer` and already tests public `/metrics`.
- `apps/backend/tests/services/MistralService.test.ts` and `OllamaService.test.ts` mock `global.fetch` and assert metrics.
- `apps/backend/tests/services/MetricsService.test.ts` covers rendering/path normalization.
- `apps/backend/tests/agents/ProcessingPipeline.test.ts` uses mock layers for pipeline behavior.

## Validation commands

After dependency changes:

```bash
pnpm install
```

Targeted checks:

```bash
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend test -- tracing server MetricsService MistralService OllamaService ProcessingPipeline
pnpm --filter @repo/backend lint
```

Full backend checks:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

Manual OTLP/local sink validation:

1. Start a local collector/sink, e.g. OTLP HTTP collector on `http://localhost:4318` or JSONL sink.
2. Enable tracing with final env names, e.g. `PAPERLESS_LLM_TRACING_ENABLED=true`, `PAPERLESS_LLM_TRACE_SINK=otlp`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`.
3. Run backend and call `/health`, `/api/settings`, a mocked/real test-connection endpoint, and one processing path in dev.
4. Confirm spans appear with hierarchy `http.request -> pipeline/client spans` where applicable and no forbidden data.

## Final worker prompt

Implement Todo #25 / W3-S16 tracing only: wire Effect tracing to OTLP or a compatible local sink in the backend. Metrics are already present; reuse their path normalization and bounded error/retry classification. Do not alter prompt-file/Pi-agent architecture.

Required outcome:

- Tracing is configurable and **disabled/no-op by default**, especially in tests.
- Preferred implementation uses `@effect/opentelemetry@0.60.0` with current `effect@3.19.14` / `@effect/platform@0.94.1`, plus `NodeHttpClient.layer`; fallback may be native `Tracer.make` local JSON/console/memory sink if OTLP integration blocks.
- Add `apps/backend/src/observability/tracing.ts` with config parsing, tracing layer/sink selection, sanitizer, and small span helpers.
- Compose tracing with `AppLayer` (or entrypoint) without exporting during tests unless explicitly enabled.
- Instrument: HTTP normal routes and direct SSE routes; ProcessingPipeline document/step/metadata/index phases; Paperless/Ollama/Mistral/Qdrant client helpers; OCR direct Mistral OCR; Pi document agent prompt/events where safe.
- Add tests for config/sanitizer/no-op and local/memory/OTLP behavior as practical.

Hard constraints:

- Never trace secrets, tokens, Authorization/Cookie/API-key headers, prompts/messages, OCR text, document content, PDFs/base64/images, embeddings/vectors, raw bodies, tool args/results.
- Use route templates/normalized paths and bounded operation names; avoid raw query strings and high-cardinality payload data.
- Network exporters must not run unless explicitly enabled.
- Keep backend `typecheck`, targeted tests, and lint passing.

Suggested implementation order:

1. Add tracing module/config/sanitizer/tests.
2. Add dependency/layer composition; verify typecheck with tracing disabled.
3. Add HTTP spans and server test/local sink assertion.
4. Add pipeline and external helper spans; add one mocked client test.
5. Add manual OTLP validation notes/env examples.

Stop/escalate if:

- `@effect/opentelemetry@0.60.0` cannot typecheck with current deps after reasonable fixes; switch to native local sink and document the decision.
- You must choose env names that conflict with existing config conventions; prefer `PAPERLESS_LLM_TRACING_ENABLED`, `PAPERLESS_LLM_TRACE_SINK`, `PAPERLESS_LLM_OTLP_ENDPOINT` plus standard `OTEL_EXPORTER_OTLP_ENDPOINT` fallback.
