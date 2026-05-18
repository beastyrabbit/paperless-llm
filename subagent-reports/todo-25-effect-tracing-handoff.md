# Todo #25 / W3-S16 Effect tracing handoff

Scope: implementation-ready context for wiring Effect tracing to OTLP or a compatible local sink. No source files were edited while gathering this context.

## Requirement

`docs/plans/audit-rework-tasks.md:303-317` defines W3-S16. Tracing-specific bullet: **“Wire Effect tracing to OTLP or a compatible local sink.”** Related W3-S16 bullets are metrics/health/API docs, but this handoff focuses on tracing and calls out touchpoints that overlap metrics.

## Current dependency state

- Backend package: `apps/backend/package.json:16-27`
  - Current runtime deps include `effect ^3.19.14`, `@effect/platform ^0.94.1`, `@effect/platform-node ^0.104.0`, Pi agent packages, Qdrant client, TinyBase, Zod/YAML.
  - No direct OpenTelemetry, OTLP exporter, or `@effect/opentelemetry` dependency is declared.
- Root `pnpm-lock.yaml` contains transitive `@opentelemetry/api` from unrelated deps, but no backend OTLP exporter / SDK direct dependency. Add direct deps and lockfile updates if choosing OTLP.
- Local Effect 3.19.14 APIs available from installed type definitions:
  - `Effect.withSpan(name, options?)`, `Effect.annotateCurrentSpan`, `Effect.currentSpan`, `Effect.makeSpan`, `Effect.withTracer`, `Effect.withTracerEnabled`, `Effect.withTracerTiming` in `node_modules/.pnpm/effect@3.19.14/node_modules/effect/dist/dts/Effect.d.ts:25707-26093`.
  - `Layer.setTracer(tracer)` in `.../Layer.d.ts:1261-1266`.
  - `Tracer.make` / `Tracer.Tracer` interface in `.../Tracer.d.ts:21-124`; span options support `attributes`, `links`, `parent`, `root`, `kind` (`internal|server|client|producer|consumer`).
- `@effect/opentelemetry` is not installed locally. If using it, verify the compatible version for `effect@3.19.14`/ESM. If avoiding a new bridge, Effect’s native `Tracer.make` supports a local sink implementation.

## High-value files and touchpoints

### Application runtime/layer wiring

- `apps/backend/src/index.ts:1-67`
  - Entrypoint builds `main` and runs `Effect.runPromise(pipe(main, Effect.provide(AppLayer)))`.
  - Good place for process-level observability init/shutdown if it must wrap all effects, but prefer layer composition in `layers/index.ts` so tests can opt in/out.
- `apps/backend/src/layers/index.ts:1-104`
  - Central layer graph. `AppLayer` composes Config, TinyBase, services, agents, jobs, pipeline, auto-processing.
  - Suggested tracing layer can be merged/provided here (for all runtime effects) or supplied around `AppLayer` in `index.ts`.
  - `TestLayer` is only Config+TinyBase; keep tracing optional/no-op by default to avoid changing unit tests.

### HTTP server and request boundary

- `apps/backend/src/server.ts:7` imports `Effect, Layer, pipe, Runtime, Scope, Stream`.
- `server.ts:363-364` creates `runWithRuntime` from the cached runtime: every request ultimately uses this runtime.
- `server.ts:653-667` creates a `requestId`, parses URL, creates `requestLogger`, sets `X-Request-Id`, and logs completion duration on `res.finish`.
- `server.ts:674-713` handles preflight/rate limit/auth/read-only before generic API route execution.
- `server.ts:718-817` handles three direct SSE routes outside `api/index.ts`:
  - `/api/processing/:docId/stream`
  - `/api/cases/document/:docId/stream`
  - `/api/catalog/runs/:runId/stream`
- `server.ts:818-824` builds the normal route Effect: `handleRequest(req, res, body).pipe(Effect.catchAll(...))`, then `runWithRuntime(effect)`.
- `server.ts:851-889` logs parse/unhandled failures with sanitized headers.

Recommended HTTP span boundary:
- Wrap the entire per-request async handler in a root/server span if using an OTel API wrapper, or wrap the `handleRequest` Effect at `server.ts:818-824` with `Effect.withSpan("http.request", { kind: "server", attributes: { "http.request.method", "url.path", "http.route"/path, "http.response.status_code", "request.id" }})`.
- For direct SSE loops, create spans inside each `runWithRuntime(Effect.gen(...))` block and annotate `stream.type`, `doc.id`/`run.id`, `fullPipeline`, `dryRun`. Long-running SSE polling spans may become very long; use a short request span plus child spans per polling iteration or per pipeline run.
- Status code is only known after response writing; use `Effect.tapBoth` for Effect results and/or the existing `res.on("finish")` hook to record final status in a custom tracer/local sink. Avoid logging headers except existing sanitized path.

### API router

- `apps/backend/src/api/index.ts:1-47` imports shared schemas and sub-handler modules.
- `api/index.ts:58-74` defines `Route`/`RouteMatch` and a private `routes` array.
- `api/index.ts:178-194` `addRoute` compiles path patterns to regex and records handlers.
- `api/index.ts:221` static health route currently returns `{ status: "healthy" }`.
- `api/index.ts:790-831` `handleRequest` does route matching and query-param special cases before `return match.handler(match.params, body)`.

Tracing opportunity:
- Add route metadata (`method`, template path) to spans if the router exposes the matched path/template. Without this, HTTP spans can only use raw `url.pathname`; that is acceptable initially but higher-cardinality.

### Pipeline/agent spans

- `apps/backend/src/agents/ProcessingPipeline.ts:80-95` service interface exposes `processDocument`, `processDocumentStream`, `processStep`, `processStepStream`.
- `ProcessingPipeline.ts:144-166` live layer captures config/services and defines `bestEffort` logging helper.
- `ProcessingPipeline.ts:218-244` `recordStageFailure` logs stage failures to TinyBase; good place to annotate failures without duplicating classification logic.
- `ProcessingPipeline.ts:791-826` `processMetadata` wraps Pi document agent and transitions workflow state.
- `ProcessingPipeline.ts:828-843` `processIndex` wraps Qdrant indexing.
- `ProcessingPipeline.ts:868-1050` `processDocument` orchestrates full OCR -> metadata -> index flow under `withDocumentLock`.
- `ProcessingPipeline.ts:1052-1131` `processStep` runs an individual step.
- `ProcessingPipeline.ts:1133-1224` stream variants emit SSE events.

Recommended pipeline spans:
- Root internal span `pipeline.process_document` with attributes: `doc.id`, `dry_run`, `auto`, `resume`, maybe `pipeline.mode=full`.
- Child spans for `pipeline.step.ocr`, `pipeline.step.metadata`, `pipeline.step.index`, and lock operations (`pipeline.lock.acquire`, `pipeline.lock.release`) if useful.
- Annotate result attributes only: `success`, `needs_review`, `error.kind`, `retryable`, `step`; do **not** include OCR text, prompts, generated metadata, or raw document content.
- For `processDocumentStream`/`processStepStream`, spans should wrap the underlying `service.processDocument`/`processStep` call; do not create a span per SSE event unless the sink is designed for high volume.

### External client call points

#### Paperless

- `apps/backend/src/services/PaperlessService.ts:301-366` `request<T>(method, path, body?, params?)` handles JSON API calls with `fetchWithTimeout`, token auth, error mapping.
- `PaperlessService.ts:376-431` `binaryRequest` handles PDF/version downloads.
- `PaperlessService.ts:439-480` `multipartRequest` handles uploads.
- Public methods are mostly thin wrappers around those helpers (`getDocument` at `:574`, `updateDocument` at `:635`, `downloadPdf` at `:637`, `getTags` at `:749`, `getQueueStats` at `:1013`, `testConnection` at `:1210`).

Recommended spans:
- Add client spans in the three request helpers, not every method. Attributes: `peer.service=paperless`, `http.request.method`, sanitized `url.path` (`/api/documents/:id/` optional if easy), `http.response.status_code`, `paperless.api.version=10`; avoid token, query values that might contain names/search text, body, document content.

#### Ollama

- `apps/backend/src/services/OllamaService.ts:176-216` `request<T>(method,path,body?)` wraps JSON fetches.
- `OllamaService.ts:218-244` `listModels`/`getRunningModels`/`chat` call the helper.
- `OllamaService.ts:246-354` `chatStream` does its own streaming fetch.
- `OllamaService.ts:357-373` `generate`; `:376-484` `generateStream`; `:487-519` `embed`; `:521-526` `testConnection`.

Recommended spans:
- Client spans around JSON helper and the three custom paths: `chatStream`, `generateStream`, `embed`.
- Attributes: `peer.service=ollama`, endpoint path, model name, stream boolean, maybe token counts/durations if returned (`total_duration`, `prompt_eval_count`, `eval_count`) as attributes/events. Do not record prompts/messages/embedding text.

#### Mistral

- `apps/backend/src/services/MistralService.ts:150-218` `request<T>` performs fetch with retry loop.
- `MistralService.ts:202-212` retry loop; span events/attributes should capture attempt count and retry delay, not payloads.
- `MistralService.ts:221-295` `listModels`, `chat`, `processImage`, `processDocument`, `testConnection`.
- OCR agent also calls Mistral OCR endpoint directly rather than through `MistralService`.

Recommended spans:
- Wrap `request<T>` with a client span `mistral.request` and child/event per attempt (`attempt`, `status_code`, `retry_after_ms`/`delay_ms`).
- Attributes: `peer.service=mistral`, endpoint path, model, retry attempts. Never include `Authorization`, base64 images/PDFs, prompts, OCR text.

#### OCRAgent direct Mistral OCR + Paperless

- `apps/backend/src/agents/OCRAgent.ts:155-214` direct Mistral OCR request with retry logic using `fetchWithTimeout`.
- `OCRAgent.ts:518-520` downloads PDF through `paperless.downloadPdf`, hashes it.
- `OCRAgent.ts:457-718` `process` is the OCR workflow; generates searchable PDF in a child-process helper at `:225-260`; uploads/patches Paperless version around `:350-415`.

Recommended spans:
- `ocr.process` internal span with `doc.id`, `mock_mode`, `force`.
- `mistral.ocr.request` client span around direct OCR fetch, with attempts/status/delay only.
- `ocr.searchable_pdf` internal span around child process if keeping this observable.

#### Qdrant

- `apps/backend/src/services/QdrantService.ts:95-119` creates client and embeds text through `ollamaService.embed`.
- `QdrantService.ts:121-176` `searchSimilar`; `:178-219` `upsertDocument`; `:221+` delete/test/ensure collection.

Recommended spans:
- `qdrant.search`, `qdrant.upsert`, `qdrant.delete`, `qdrant.ensure_collection` client spans around client calls.
- Attributes: `peer.service=qdrant`, `collection`, `limit`, filter booleans; do not include query text or document content.

#### Pi document agent / Pi library boundary

- `apps/backend/src/agents/PiDocumentAgent.ts:1047-1055` live layer captures `PaperlessService`, `OllamaService`, TinyBase, cases, tag explorer.
- `PiDocumentAgent.ts:1341` uses `ollama.chat` for metadata verifier.
- `PiDocumentAgent.ts:1435` has `Effect.runPromise(effect, { signal })` helper inside tool execution integration. This may run effects outside the app runtime/tracer unless spans are already in the effect context or the service layer tracer is global; verify during implementation.
- `PiDocumentAgent.ts:2445-2494` constructs `new PiAgent` with `streamFn: streamSimple`, `model: buildOllamaModel(...)`, `getApiKey: () => "ollama"`.
- `PiDocumentAgent.ts:2496-2524` records Pi message/tool events; these are good places for span events with tool name/result/error but not arguments/payload.
- `PiDocumentAgent.ts:2345-2660` `processDocument` is the main metadata-agent Effect.

Recommended spans:
- `pi.document_agent.process` around `processDocument`, attributes `doc.id`, `dry_run`, `auto`, `resume`, selected model names if non-sensitive.
- Add events for `message_end`, `tool_execution_start`, `tool_execution_end` using tool names/status only. Do not attach full messages, prompts, tool args/results, or document content.
- Investigate whether `buildOllamaModel`/Pi `streamSimple` uses global fetch outside `OllamaService`; if yes, OTel auto-instrumentation or a wrapper in `piOllamaModel.ts` may be needed for those LLM calls.

### Existing logging and request IDs

- Structured logger in `apps/backend/src/utils/logger.ts`; server logs request completion with `requestId`, method, path, status, duration.
- `server.ts:661` sets `X-Request-Id`; use the same value in span attributes (`request.id`).
- Existing log sanitizer `sanitizeHeadersForLog` is tested; mirror its redaction discipline for tracing attributes.

## Design options

### Option A — Preferred if dependency/version check passes: Effect/OpenTelemetry bridge + OTLP exporter

Add direct backend deps such as:
- `@effect/opentelemetry` (verify version compatible with `effect@3.19.14` and ESM)
- OpenTelemetry SDK/exporter packages as required by the bridge, likely `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http` or `@opentelemetry/exporter-trace-otlp-grpc`, and semantic-conventions/resources packages depending on API.

Implementation shape:
- New `apps/backend/src/observability/tracing.ts` that builds a tracing layer/initializer from env/config.
- Configure service name like `paperless-local-llm-backend`, environment, optional endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT` or `PAPERLESS_LLM_OTLP_ENDPOINT`), sampling/enabled flags.
- Merge/provide tracing layer with `AppLayer` in `layers/index.ts` or `index.ts` so all app runtime effects use the tracer.
- Ensure graceful shutdown flushes SDK on SIGINT/SIGTERM or cleanup.
- Use `Effect.withSpan` throughout server/pipeline/service helpers.

Pros: standard OTLP-compatible; works with Jaeger/Tempo/otel-collector; future-proof.
Cons/risks: exact package API/version must be checked; SDK lifecycle/shutdown in current entrypoint needs care; tests should avoid network exports.

### Option B — Compatible local sink using native Effect `Tracer.make`

No OTel deps required. Implement a local tracer layer using Effect’s `Tracer.make`, `Layer.setTracer`, and a simple in-memory/JSONL/structured-log sink:
- On span end, emit JSON to logger or a file/endpoint configured by env (e.g. `PAPERLESS_LLM_TRACE_SINK=jsonl|console|none`, `PAPERLESS_LLM_TRACE_FILE`).
- Include W3-compatible-ish fields: traceId, spanId, parentSpanId, name, kind, start/end/duration, attributes, status/error type.

Pros: minimal dependency risk; satisfies “compatible local sink” if accepted; easy to unit test by injecting a memory sink.
Cons: not OTLP; no distributed context propagation; collector integrations require conversion; custom tracer must be correct enough.

### Option C — Native OpenTelemetry SDK only, manual OTel spans + Effect annotations

Use OTel SDK/exporter directly and wrap request/external calls with OTel API spans, while also adding `Effect.withSpan` for logical Effect spans separately.

Pros: avoids `@effect/opentelemetry` bridge uncertainty.
Cons: two span systems can diverge; manual context propagation across Effect fibers can be fragile; less idiomatic for this codebase.

## Suggested implementation plan

1. Choose and document sink mode. Prefer Option A unless dependency compatibility is problematic; otherwise Option B is acceptable per task wording.
2. Add `observability/tracing.ts` with:
   - config/env parsing (`enabled`, sink type, OTLP endpoint, service name, sampling if needed);
   - `TracingLayer` or `makeTracingLayer` returning no-op when disabled/test;
   - flush/shutdown hook if using OTel SDK.
3. Compose tracing with `AppLayer` without forcing tests to export traces. A no-op/default disabled mode should preserve current tests.
4. Add span helpers to reduce repetition, e.g. `withInternalSpan(name, attrs)`, `withClientSpan(service, operation, attrs)`, plus attribute sanitization. Keep helper pure and testable.
5. Instrument boundaries in this order:
   - HTTP normal routes and direct SSE paths in `server.ts`.
   - `ProcessingPipeline.processDocument`, `processStep`, `processMetadata`, `processIndex`, OCR step.
   - External client helpers: Paperless `request`/`binaryRequest`/`multipartRequest`, Ollama JSON+stream+embed paths, Mistral request+retry, OCR direct Mistral OCR, Qdrant operations.
   - Pi agent events as span events only if easy and safe.
6. Add docs/env examples for running with local collector or local sink. If adding OTLP, include a minimal `otel-collector`/Jaeger/Tempo local command or endpoint example.

## Tests and validation targets

Existing test patterns:
- `apps/backend/tests/server.test.ts` already starts real HTTP server via `createHttpServerWithLayer`; add tests here for trace attributes only if a test/memory sink exists.
- `apps/backend/tests/agents/ProcessingPipeline.test.ts` uses mock layers for pipeline; good place to assert spans are emitted for `processStep`/`processDocument` if tracing sink injectable.
- `apps/backend/tests/services/OllamaService.test.ts` and `MistralService.test.ts` stub global fetch; useful to assert client spans record success/error/retry without recording prompts/API keys.
- `apps/backend/tests/setup.ts` globally sets `PAPERLESS_LLM_LOG_LEVEL=silent` and stubs fetch. Keep tracing default off in tests unless explicitly enabled.

Add/adjust tests depending on chosen design:
- Unit test tracing config parsing: default disabled/no-op in test; OTLP env creates enabled config; local sink file/console accepted.
- Unit test sanitizer: attributes do not include `authorization`, `token`, prompt/content/base64 fields.
- If local sink/memory sink: assert span names/attributes for one HTTP route and one external service request.
- If OTLP bridge only: mock exporter and assert spans are exported, or at minimum typecheck/build and a local manual validation command.

Commands:
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend test`
- `pnpm --filter @repo/backend lint`
- If dependencies added: `pnpm install` / lockfile update and `pnpm run typecheck` may be needed.

Manual validation:
- Local sink: run `PAPERLESS_LLM_TRACING_ENABLED=true PAPERLESS_LLM_TRACE_SINK=console pnpm run dev:backend`, call `/health` and a harmless settings/model endpoint, verify spans include HTTP and external service names without secrets or document text.
- OTLP: run an OTel collector/Jaeger/Tempo locally, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` (or chosen env), call routes, verify traces show `http.request -> pipeline/process -> external client` hierarchy and shutdown flushes.

## Risks / decisions to make before coding

- **Dependency choice:** Confirm whether `@effect/opentelemetry` version is available/compatible with Effect 3.19.14. If not, choose native local sink or native OTel manual instrumentation.
- **Default behavior:** Tracing should default off or local/no-op in tests/dev unless endpoint/sink env is configured, to avoid noisy logs/network calls.
- **Long-running spans:** SSE and background auto-processing can create very long spans. Prefer spans around actual work units, not idle polling loops.
- **Sensitive data:** High risk in this app because documents, OCR text, prompts, metadata suggestions, tokens, PDFs/base64 images flow through services. Only record IDs, paths, models, status, counts, durations, booleans, and error classes/messages after review.
- **Pi runtime boundary:** `PiDocumentAgent.ts:1435` uses `Effect.runPromise(effect, { signal })` inside tool integration. Verify tracer context survives this boundary; otherwise use the cached runtime or explicit parent span/context where needed.
- **Cardinality:** Raw paths like `/api/documents/123` and Paperless query params can increase cardinality. Prefer route templates/sanitized paths where practical.

## Compact worker prompt

Implement Effect tracing for the backend for Todo #25 / W3-S16. Use the current Effect 3.19 APIs (`Effect.withSpan`, `Effect.annotateCurrentSpan`, `Layer.setTracer`) and wire traces either to OTLP via a compatible `@effect/opentelemetry`/OpenTelemetry SDK setup or to a clearly documented compatible local sink if OTLP bridge compatibility is not viable. Add an `observability/tracing` module/layer, compose it with `AppLayer` without breaking tests, and instrument HTTP request handling (`server.ts` normal routes + direct SSE work), processing pipeline steps (`ProcessingPipeline.ts` full and single-step flows), and external calls (Paperless request helpers, Ollama JSON/stream/embed calls, Mistral request/retry and OCR direct request, Qdrant operations, safe Pi agent events). Use requestId/docId/runId/model/status/duration/retry attributes only; never include secrets, prompts, OCR text, document content, PDFs/base64, headers, or request bodies. Keep tracing disabled/no-op by default in tests. Add focused tests for config/sanitization and, if using a local/memory sink or mocked exporter, span emission for one HTTP route and one external call. Validate with `pnpm --filter @repo/backend typecheck`, `pnpm --filter @repo/backend test`, and `pnpm --filter @repo/backend lint`; document env/config and local validation steps.
