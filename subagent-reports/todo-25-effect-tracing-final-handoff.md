# Todo #25 / W3-S16 — final Effect tracing handoff

No source files were edited for this handoff. This refresh reflects the current tree after the OpenAPI/API-docs work. I did **not** find an implemented metrics module or `/metrics` endpoint in the current code (`grep` for `paperless_llm_`, `/metrics`, `MetricsService`, `withSpan`, `setTracer`, and `tracing` under `apps/backend/src` returned no matches), so treat metrics as either still pending or unlanded in this worktree.

## Requirement

`docs/plans/audit-rework-tasks.md:305-318` W3-S16 includes:

- Generate OpenAPI from shared schemas.
- Serve API docs in development.
- Expose metrics for pipeline phases, retries, errors, and LLM latency.
- **Wire Effect tracing to OTLP or a compatible local sink.**
- Extend health checks to Paperless, Ollama, Qdrant, and Mistral.

This worker should implement only the tracing bullet, while avoiding conflicts with OpenAPI/docs and any metrics work.

## Current state and dependencies

### Already landed / current W3-S16 context

- OpenAPI/docs are implemented:
  - `packages/api-contracts/src/openapi.ts` generates OpenAPI 3.1 from shared route contracts.
  - `apps/backend/src/api/index.ts:33-34` imports `generateOpenApiDocument`; `apps/backend/src/api/index.ts:221-223` registers `GET /openapi.json`.
  - `apps/backend/src/server.ts:197-209` gates docs with `isApiDocsEnabled()` and public access for `/openapi.json` + `/api/docs` only when docs are enabled.
  - `apps/backend/src/server.ts:374-402` contains the static dev docs HTML response.
  - `apps/backend/src/api/index.ts:195` exports `getRegisteredRoutes()` for OpenAPI drift tests.
- Health is still static: `apps/backend/src/api/index.ts:221` returns `{ status: "healthy" }`.
- Metrics are not present in current source; if another worker lands metrics before tracing, reuse its registry/helpers instead of adding duplicate timing/sanitization utilities.

### Backend dependency state

- `apps/backend/package.json:16-29` currently has `effect ^3.19.14`, `@effect/platform ^0.94.1`, `@effect/platform-node ^0.104.0`, `@repo/api-contracts`, Qdrant/TinyBase/YAML/Zod/Pi deps.
- No direct `@effect/opentelemetry`, OpenTelemetry SDK/exporter, or tracing dependency is declared.
- Local Effect APIs available:
  - `node_modules/.pnpm/effect@3.19.14/.../Effect.d.ts:25917` `Effect.annotateCurrentSpan`.
  - `Effect.d.ts:26079` `Effect.withSpan`.
  - `Layer.d.ts:1266` `Layer.setTracer`; also `Layer.setTracerEnabled` and `Layer.setTracerTiming` at `:1271`/`:1276`.
  - `Tracer.d.ts:21-124` defines native `Tracer.Tracer`, `SpanOptions.attributes`, span `kind` (`internal|server|client|producer|consumer`), links, parent/root options.
- External package check via `npm view`:
  - Latest `@effect/opentelemetry@0.63.0` peers on `effect ^3.21.0` and `@effect/platform ^0.96.0`, so it does **not** match current deps.
  - `@effect/opentelemetry@0.60.0` peers on `effect ^3.19.13` and `@effect/platform ^0.94.0`, matching current `effect 3.19.14` / platform `0.94.1` best.
  - `@effect/opentelemetry@0.60.0` exposes `Otlp.layer({ baseUrl, resource, ... })`, `OtlpTracer.layer({ url, resource, ... })`, `Tracer.layer`, and `NodeSdk.layer(...)` in its package types. `Otlp.layer` requires an `HttpClient.HttpClient` layer; current `@effect/platform-node` provides `NodeHttpClient.layer`.

## Recommended dependency/options decision

### Preferred option: Effect OTLP using compatible `@effect/opentelemetry@0.60.0`

Add backend deps and update lockfile:

- `@effect/opentelemetry@0.60.0`
- Usually no separate exporter dependency is needed if using the package’s lightweight `Otlp.layer`/`OtlpTracer.layer`; verify during implementation.
- Use existing `@effect/platform-node/NodeHttpClient` to satisfy `HttpClient` for OTLP export.

Likely layer shape:

- Create `apps/backend/src/observability/tracing.ts`.
- Parse env/config into a small tracing config:
  - `PAPERLESS_LLM_TRACING_ENABLED=true|false` (default false, especially in tests).
  - `PAPERLESS_LLM_TRACE_SINK=otlp|console|none` if supporting local sink fallback.
  - `OTEL_EXPORTER_OTLP_ENDPOINT` or `PAPERLESS_LLM_OTLP_ENDPOINT` for collector base URL (HTTP OTLP, e.g. `http://localhost:4318`).
  - `PAPERLESS_LLM_OTLP_HEADERS` only if needed; never log it.
  - service name default `paperless-local-llm-backend`.
- Export a `TracingLayer`/`makeTracingLayer()` that is no-op/disabled unless explicitly enabled.
- Compose with `AppLayer` in `apps/backend/src/layers/index.ts` or wrap `AppLayer` in `apps/backend/src/index.ts`; prefer layer composition so tests can opt out cleanly.
- If using `Otlp.layer`, merge/provide `NodeHttpClient.layer` and ensure scoped runtime shutdown flushes spans. Current server already creates a scoped runtime in `apps/backend/src/server.ts:455-463`; process cleanup in `apps/backend/src/index.ts:11-26` should close server and allow scope finalizers to run if you wire scope cleanup correctly.

### Acceptable fallback: compatible local Effect tracer sink

If `@effect/opentelemetry@0.60.0` fails compatibility/typecheck, implement native local sink with `Tracer.make` + `Layer.setTracer`:

- Sink options: `none`, `console`, `jsonl` file, and a test-only in-memory sink.
- Emit JSON with trace id/span id/parent id/name/kind/start/end/duration/status/attributes.
- This satisfies W3-S16’s “or a compatible local sink” wording but should be documented as non-OTLP.

Avoid Option C (manual OpenTelemetry API spans separate from Effect spans) unless forced; it risks two disconnected trace systems.

## Files to create/modify

Create:

1. `apps/backend/src/observability/tracing.ts`
   - tracing config parsing, sink selection, redaction/sanitization helpers, `TracingLayer` or `makeTracingLayer()`, `withInternalSpan`/`withClientSpan` helpers.
2. `apps/backend/tests/observability/tracing.test.ts` (or `tests/services` if following existing layout)
   - config parsing, disabled-by-default behavior, sanitizer, local/memory sink if implemented.

Modify:

1. `apps/backend/package.json` and `pnpm-lock.yaml` if using OTLP deps.
2. `apps/backend/src/layers/index.ts`
   - compose tracing layer with `AppLayer`, or export a traced app layer while leaving `TestLayer` no-op.
3. `apps/backend/src/index.ts`
   - if OTLP SDK/layer needs lifecycle hooks, flush/shutdown on SIGINT/SIGTERM and fatal cleanup.
4. `apps/backend/src/server.ts`
   - normal route request span around `handleRequest` path at `server.ts:943-948`.
   - direct SSE spans for processing/case/catalog streams (`server.ts:718-817`, `:840-929` area in current file).
   - add `request.id`, method, route/path, status code, duration/status attributes without headers/bodies.
5. `apps/backend/src/api/index.ts`
   - optionally expose matched route template in `RouteMatch` so `server.ts` can use bounded `http.route` rather than raw paths. Current `RouteMatch` lacks method/path metadata (`api/index.ts:58-66`) even though `Route` has `method/path` (`:68-77`).
6. `apps/backend/src/agents/ProcessingPipeline.ts`
   - wrap `processDocument` (`:868-1049`), `processStep` (`:1052-1130`), stream wrappers (`:1133-1224`), `processMetadata` (`:785-824`), `processIndex` (`:827-843`), and `recordStageFailure` (`:213-244` failure classification) with logical spans/annotations.
7. `apps/backend/src/agents/OCRAgent.ts`
   - `runMistralOCR` direct Mistral request/retry loop at `:146-225`.
   - `generateSearchablePdf` at `:227+`.
   - main `process` flow around PDF download (`:524`) and OCR call (`:602`).
8. `apps/backend/src/services/MistralService.ts`
   - generic `request<T>` and retry loop at `:151-215`; public calls at `:223-298`.
9. `apps/backend/src/services/OllamaService.ts`
   - generic request helper at `:177-215`, `chatStream` at `:248+`, `generateStream` at `:392+`, `embed` at `:517-549`.
10. `apps/backend/src/services/PaperlessService.ts`
    - central helpers: `request<T>` `:301-366`, `binaryRequest` `:372-431`, `multipartRequest` `:435-480`.
11. `apps/backend/src/services/QdrantService.ts`
    - client calls: `searchSimilar` `:139-191`, `upsertDocument` `:194-225`, `deleteDocument` `:228-242`, `testConnection` `:244-255`, `ensureCollection` `:257+`.
12. `apps/backend/src/agents/PiDocumentAgent.ts`
    - `processDocument` at `:2404+`, Pi `agent.prompt` wrapper at `:2610-2614`, event subscription at `:2560-2585`.
    - Be careful: `runToolEffect` uses `Effect.runPromise(effect, { signal })` at `:1478-1480`, potentially outside the app runtime/tracer context.
13. Config/docs examples:
    - `.env.example`, `config.example.yaml`, maybe README once behavior/env names are final.

## Instrumentation guidance

### HTTP spans

- Span name: `http.request`; kind `server`.
- Attributes: `request.id`, `http.request.method`, `url.path` or preferably `http.route`, `http.response.status_code`, `error.type` on failures.
- Use existing request ID from `apps/backend/src/server.ts:653-667` and `X-Request-Id` response header at `:661`.
- Do not attach headers except maybe sanitized user agent if explicitly approved; existing `sanitizeHeadersForLog` redacts sensitive headers at `server.ts:405-419` and should be mirrored.
- For status code, result status is known after `handleRequest` and response writing (`server.ts:950-972`); either annotate after result mapping or use `res.on("finish")` if your tracer can update the active span safely.

### Pipeline spans

- Root: `pipeline.process_document` with `doc.id`, `dry_run`, `auto`, `resume`, `pipeline.mode=full`.
- Child spans: `pipeline.step.ocr`, `pipeline.step.metadata`, `pipeline.step.index`; optional lock spans for `withDocumentLock` (`ProcessingPipeline.ts:432+`).
- Annotate only bounded result fields: `success`, `needs_review`, `step`, `error.kind`, `retryable`.

### External/client spans

- Paperless helpers: `paperless.request`, `paperless.binary_request`, `paperless.multipart_request`; kind `client`; attributes `peer.service=paperless`, method, sanitized path/template, status code. Never include token, query text, body, document content.
- Ollama: `ollama.request`, `ollama.chat_stream`, `ollama.generate_stream`, `ollama.embed`; attributes model, endpoint path, stream boolean, outcome. Never include prompts/messages/text/embeddings.
- Mistral: `mistral.request`; add retry attempt events/attributes for attempt number/status/retry delay only. Never include Authorization, prompts, OCR text, base64/PDFs.
- OCR direct call: `mistral.ocr.request`; annotate attempts/status/pages count only, not extracted markdown/text.
- Qdrant: `qdrant.search`, `qdrant.upsert`, `qdrant.delete`, `qdrant.ensure_collection`; attributes collection, limit, filter booleans. Never include query text/document content/vector values.
- Pi agent: `pi.document_agent.process`, `pi.agent_prompt`, and low-cardinality events for `message_end`, `tool_execution_start`, `tool_execution_end` with tool name/status only. Current subscription stores `args` and `result` in `PiDocumentAgent.ts:2573-2585`; do **not** put those in trace events.

## Hard constraints / risks

- Do not reintroduce prompt-file or PromptService processing paths; project rule says Pi agent instructions/tools/schemas stay in TypeScript.
- Tracing must default disabled/no-op in tests. `apps/backend/tests/setup.ts:21-35` globally sets silent logging and temp TinyBase env; do not add network exporters by default.
- Do not record secrets, API keys, tokens, Authorization/Cookie headers, prompts, OCR text, document content, PDFs/base64, embeddings, raw tool args/results, or raw request/response bodies.
- Avoid high-cardinality labels/attributes: prefer route templates and operation names over raw URLs with IDs/query strings. Document IDs/run IDs are acceptable for traces but not metrics.
- SSE and background jobs can be long-running. Prefer spans around actual work units/poll iterations or underlying pipeline calls rather than one idle span per open SSE connection.
- Pi tool execution may cross runtime/context boundaries via `Effect.runPromise`; validate trace context across this boundary or explicitly annotate child spans from safe parent data.
- If metrics lands concurrently, share sanitizer/operation naming where possible and do not duplicate endpoint behavior. Current `/metrics` is absent; prior metrics handoff suggested it belongs in `server.ts` as text/plain outside JSON router.

## Tests to add/update

Minimum automated tests:

1. `tracing.test.ts`
   - default config is disabled/no-op under test env.
   - OTLP env parses endpoint/service name when enabled.
   - local sink config parses if implemented.
   - sanitizer drops/redacts `authorization`, `x-api-key`, `token`, `secret`, `password`, `cookie`, `prompt`, `content`, `base64`, `pdf`, `embedding`, `messages`, `args`, `result` fields.
2. If local/memory sink exists:
   - one unit test asserts `Effect.withSpan` emits a span with sanitized attributes and correct parent/child relationship.
   - `apps/backend/tests/server.test.ts`: start `createHttpServerWithLayer`, call a harmless route, assert `http.request` span contains `request.id`, method, bounded route/path, status.
   - `apps/backend/tests/services/OllamaService.test.ts` or `MistralService.test.ts`: assert a client span is emitted and prompts/API keys are absent.
3. If OTLP only:
   - mock exporter/HTTP collector if practical; otherwise config/sanitizer tests plus typecheck are the automated floor, with manual collector validation required.
4. Regression tests should not require a real Paperless/Ollama/Mistral/Qdrant instance.

Useful existing test files/patterns:

- `apps/backend/tests/server.test.ts` starts real server via `createHttpServerWithLayer`.
- `apps/backend/tests/services/MistralService.test.ts` and `OllamaService.test.ts` stub `global.fetch`.
- `apps/backend/tests/agents/ProcessingPipeline.test.ts` uses mock layers for pipeline behavior.

## Validation commands

After dependency changes:

```bash
pnpm install
```

Targeted validation:

```bash
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend test -- tracing server MistralService OllamaService ProcessingPipeline
pnpm --filter @repo/backend lint
```

Full backend validation:

```bash
pnpm --filter @repo/backend test
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

If OpenAPI contracts are touched indirectly, also run:

```bash
pnpm --filter @repo/api-contracts build
pnpm --filter @repo/api-contracts typecheck
pnpm --filter @repo/api-contracts lint
pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/server.test.ts
```

Manual OTLP smoke:

```bash
# start a local collector/Jaeger/Tempo that accepts OTLP HTTP on 4318
PAPERLESS_LLM_TRACING_ENABLED=true \
PAPERLESS_LLM_TRACE_SINK=otlp \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
pnpm run dev:backend

curl -sS http://127.0.0.1:8765/health
curl -sS http://127.0.0.1:8765/openapi.json >/dev/null
```

Verify traces show HTTP request spans and, for a safe route that calls an upstream, child client spans. Confirm shutdown flushes and no secrets/prompts/document text appear.

Manual local-sink smoke, if fallback implemented:

```bash
PAPERLESS_LLM_TRACING_ENABLED=true \
PAPERLESS_LLM_TRACE_SINK=console \
pnpm run dev:backend

curl -sS http://127.0.0.1:8765/health
```

## Final worker prompt

Implement Todo #25 / W3-S16 Effect tracing for the backend. OpenAPI/docs are already present; metrics and dependency-aware health are separate unless already landed by another worker. Add an `apps/backend/src/observability/tracing.ts` module that parses tracing env/config, defaults to disabled/no-op in tests, provides sanitized span helpers, and wires Effect tracing either to OTLP using a compatible `@effect/opentelemetry@0.60.0` + `NodeHttpClient.layer` setup or to a documented native Effect local sink if OTLP compatibility fails. Compose the tracing layer with the backend runtime without causing test network exports. Instrument `server.ts` HTTP normal routes and direct SSE work, `ProcessingPipeline.ts` document/step flows, OCR direct Mistral calls, Paperless/Ollama/Mistral/Qdrant client helpers, and safe Pi document-agent prompt/tool lifecycle events. Use bounded attributes such as requestId, route/method/status, docId/runId, operation, model, retry attempt/delay/status, outcome, and error class only. Never include tokens, headers, prompts, OCR/document content, PDFs/base64, embeddings, raw bodies, or Pi tool args/results. Add focused tests for config parsing, redaction/sanitization, no-op default behavior, and span emission via memory/local sink or mocked exporter when available. Validate with backend typecheck/test/lint, update env/docs examples, and include manual OTLP/local-sink smoke instructions in the completion report.
