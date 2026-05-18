# W3-S16 Observability/API Docs Context

## Task source and dependency

- `docs/plans/audit-rework-tasks.md:303-317` defines W3-S16: generate OpenAPI from shared schemas, serve API docs in development, expose `/metrics` for pipeline phases/retries/errors/LLM latency, wire Effect tracing to OTLP/local sink, and extend `/health` to Paperless/Ollama/Qdrant/Mistral. Acceptance: `/health` reports upstream status, `/metrics` exposes useful counters/histograms, API shape is inspectable from generated docs.
- This depends on W2-S6 (`docs/plans/audit-rework-tasks.md:122-134`): create `packages/api-contracts`, move schemas/types there, update backend/frontend to consume them, and prepare OpenAPI from the same schema source. Current repo has no `packages/api-contracts` (`packages/` only contains eslint-config, typescript-config, ui) and backend route schemas are local in `apps/backend/src/api/index.ts`; frontend duplicates types in `apps/web/lib/api.ts`.
- Audit evidence: J2/J3 are “No Prometheus/OpenTelemetry metrics/tracing” (`docs/AUDIT.md:149-156`), R2 is “No OpenAPI/Swagger spec” (`docs/AUDIT.md:234-240`), O2 is backend health lacking dependency probes (`docs/AUDIT.md:206-208`).

## Current architecture and high-value files

### Router and route/schema registry

- `apps/backend/src/api/index.ts:26-50` has private `HttpMethod`, `Route`, `routes` definitions.
- `apps/backend/src/api/index.ts:61-88` provides local Zod parsing helpers and primitive schemas.
- `apps/backend/src/api/index.ts:90-230` defines request body schemas inline (settings, pending, jobs, processing, cases, catalog, metadata, schema, translation, chat). These are the current source to migrate/reuse for OpenAPI after W2-S6.
- `apps/backend/src/api/index.ts:236-256` defines private `addRoute(method, path, handler)` which only stores method/pattern/handler; it does not store request/response schemas, summaries, tags, auth/public metadata, or docs metadata.
- `apps/backend/src/api/index.ts:262-270` current health/root endpoints are simple static JSON; `/health` is `{ status: "healthy" }` only.
- `apps/backend/src/api/index.ts:830-890` `handleRequest()` parses URL and does special query-param dispatch for `/api/pending`, `/api/documents/pending`, `/api/search`, `/api/cases`, `/api/catalog/proposals`, `/api/catalog/logs`, and `/api/schema/blocked*`. OpenAPI generation must account for these query params; they are not represented in route metadata today.

### HTTP server, auth, CORS, request IDs

- `apps/backend/src/server.ts:229-240` builds one Effect runtime from `AppLayer` and reuses it for requests via `runWithRuntime`.
- `apps/backend/src/server.ts:535-550` creates a request ID, logs `http_request_completed` with status and duration, and sets `X-Request-Id`. Good insertion point for HTTP metrics and server spans.
- `apps/backend/src/server.ts:552-575` applies CORS, handles OPTIONS, checks API auth, and read-only policy before routing.
- `apps/backend/src/server.ts:129-137` makes only `/` and `/health` public when an API token is configured. Decide whether `/metrics`, `/openapi.json`, and dev docs should be public; likely `/metrics` should be protected unless explicitly intended for local/dev. Docs should be dev-only per task.
- `apps/backend/src/server.ts:242-533` handles `/api/processing/:docId/stream`; `server.ts:594-674` handles case/catalog SSE loops directly. W3-S14 later owns SSE interruption discipline, but if adding metrics/traces, these direct server paths need instrumentation too.

### Existing health probes/gaps

- There is no dependency-aware health route. Static `/health` is in `api/index.ts:270` and public-path handling is in `server.ts:135`.
- Existing connection test handlers can be reused or factored:
  - `apps/backend/src/api/settings/handlers.ts:373-409` Paperless probe: GET `${url}/api/documents/?page_size=1` with token and configured timeout.
  - `settings/handlers.ts:411-446` Ollama probe: GET `${url}/api/tags`.
  - `settings/handlers.ts:448-483` Mistral probe: GET `${mistralApiBaseUrl}/v1/models` with bearer token.
  - `settings/handlers.ts:485-535` Qdrant probe: GET `${url}/collections`, then `qdrant.ensureCollection()` (note: health should probably avoid mutating/creating collections; use `QdrantService.testConnection()` instead or a non-mutating GET).
- Service-level probes also exist:
  - `PaperlessService.testConnection()` uses `/documents/?page_size=1` and returns boolean (`PaperlessService.ts:1210-1214`).
  - `OllamaService.testConnection()` uses `/api/tags` and returns boolean (`OllamaService.ts:514-518` from grep evidence).
  - `QdrantService.testConnection()` calls `client.getCollections()` and returns boolean (`QdrantService.ts:237-246`).
  - MistralService has `listModels()` but no explicit `testConnection`; health can call `listModels().pipe(Effect.as(true), catchAll(false))` or add a service method.

### Pipeline/LLM instrumentation points

- Pipeline service types are in `apps/backend/src/agents/ProcessingPipeline.ts:29-95`; `PipelineStreamEvent.type` includes `pipeline_start`, `step_start`, `step_complete`, `step_error`, `needs_review`, `pipeline_paused`, `pipeline_complete`, etc.
- `ProcessingPipeline.ts:170-173` wraps TinyBase processing logs; `ProcessingPipeline.ts:342-394` records lock/run start, `:449-515` records run completion/failure and lock release.
- `ProcessingPipeline.ts:705-783` indexes into Qdrant and records success/failure logs.
- `ProcessingPipeline.ts:785-825` processes metadata; `:827-839` processes index; `:868-1049` full document processing; `:1052-1130` individual step processing; `:1133+` stream conversion. Best metrics targets: counters by phase/result (`pipeline_step_total{step,result}`), phase duration histogram, failures by kind/retryable from `recordStageFailure`, active runs gauge via lock/run paths.
- OCR/Mistral retry loops:
  - `apps/backend/src/agents/OCRAgent.ts:89-120` reads Mistral OCR timeout/retry config.
  - `OCRAgent.ts:140-219` calls Mistral `/v1/ocr`; `:202-213` loops over retry attempts and sleeps. Add retry counter and OCR latency histogram here.
  - `MistralService.ts:145-215` wraps Mistral chat/model requests; `:201-212` loops over retry attempts. Add retry counter and LLM latency histogram here.
- Ollama LLM calls are in `apps/backend/src/services/OllamaService.ts` (grep evidence): `chat` around lines 227-240, `chatStream` 242-350, `generate` 352-368, `generateStream` 370-477, `embed` 480-512. Instrument both latency and errors; streaming latency may need time-to-first-byte and total duration if feasible.
- `apps/backend/src/utils/http.ts:26-63` is central `fetchWithTimeout`; `:65-83` retry-after/transient helpers. If adding generic upstream HTTP metrics, beware labels/cardinality (service name only, not full URL with IDs/secrets).

### Logging/tracing libraries and gaps

- `apps/backend/src/utils/logger.ts` is a custom structured JSON logger with redaction, child contexts, levels, and process sinks; no pino/prom-client/OTel exporter currently.
- Backend deps (`apps/backend/package.json:16-27`) include Effect, `@effect/platform`, `@effect/platform-node`, zod, typebox, qdrant; **no** `prom-client`, Swagger UI, OpenAPI generator, or OpenTelemetry exporter packages are declared. `pnpm-lock.yaml` contains transitive `@opentelemetry/api` entries, but no backend direct dependency/exporter.
- Effect includes tracing/metrics APIs locally (`effect/dist/dts/Tracer.d.ts` and `Effect.withSpan`/`Effect.annotateCurrentSpan` in `Effect.d.ts`), but no Effect OpenTelemetry bridge package is installed. Implementer will likely need to add direct deps such as `prom-client` and an OpenTelemetry/Effect bridge/exporter, or implement a simple in-process Prometheus exposition while using Effect spans with a local logging tracer. Direct dependency additions require lockfile updates.

### Frontend/API contract duplication

- `apps/web/lib/api.ts:7-21` defines duplicated `ApiValidationIssue`/`ApiResponse` types; `:65+` hand-codes API methods with response/request types in the same file. W2-S6 should replace these with `packages/api-contracts` imports.
- Until W2-S6 lands, W3-S16 should not make `apps/backend/src/api/index.ts` inline schemas a second OpenAPI source long-term. If W2-S6 is not implemented first, sequence W3-S16 behind it or do only non-OpenAPI observability pieces.

### Tests and validation hooks

- `apps/backend/tests/api/router.test.ts:38-60` asserts `/` and `/health` static responses; will need updates for richer health shape or a separate shallow route test.
- `apps/backend/tests/server.test.ts` covers auth/read-only helpers, including public path behavior and read-only allowances. Add tests if `/metrics`/docs/OpenAPI are made public/protected or read-only-safe.
- Current Docker healthcheck is `docker-compose.yml:15-20`: `wget -qO- http://127.0.0.1:8765/health || exit 1`. If `/health` returns HTTP 200 with degraded JSON, compose still passes. To make compose wait on dependencies, either return non-2xx for unhealthy required deps or add a stricter endpoint/flag; this is a product decision/risk.

## Sequencing recommendation

1. **W2-S6 first (blocking for OpenAPI):** create `packages/api-contracts` with shared Zod schemas/types and route contract metadata, update backend validation and frontend API client, and expose a contract registry usable by OpenAPI generation. Without this, W3-S16 cannot satisfy “Generate OpenAPI from shared schemas” cleanly.
2. **OpenAPI/docs:** after shared contracts exist, generate `/openapi.json` from the contract registry and serve Swagger UI/Scalar/ReDoc only in development (`NODE_ENV !== "production"` or explicit config). Add metadata to routes for path/query params, bodies, response schemas, tags, and auth. Ensure direct SSE routes in `server.ts` are represented if external API shape includes them.
3. **Health:** replace static `/health` with an Effect handler that checks process/self plus Paperless, Ollama, Qdrant, Mistral using non-mutating service probes with timeout. Consider response shape like `{ status: "healthy"|"degraded"|"unhealthy", dependencies: { paperless: {status, latencyMs, error?}, ... } }`. Decide HTTP status semantics for Docker.
4. **Metrics:** add a backend `MetricsService` (new file likely `apps/backend/src/services/MetricsService.ts` or `apps/backend/src/observability/metrics.ts`) and `/metrics` route/server fast path returning `text/plain; version=0.0.4`. Instrument HTTP request counts/durations in `server.ts`, pipeline phase counters/durations in `ProcessingPipeline.ts`, retry counters in `OCRAgent.ts` and `MistralService.ts`, LLM latency/errors in Mistral/Ollama services, and upstream dependency health gauges.
5. **Tracing:** add an observability init/layer that installs an Effect tracer/exporter or local compatible sink. Wrap HTTP handling in server spans (`Effect.withSpan`/attributes requestId/method/path/status), pipeline steps in spans, and external calls (Paperless/Ollama/Mistral/Qdrant) as client spans. Propagate request ID in span attributes; avoid putting secrets/OCR text/prompt payloads in spans.
6. **Docs/config:** update README or relevant docs for endpoints, dev docs URL, metrics scrape path, OTLP env/config (if added), auth expectations.

## Likely files to edit for implementation

- `packages/api-contracts/**` (new, from W2-S6): shared schemas, route registry, OpenAPI generation utilities.
- `pnpm-workspace.yaml` probably already includes `packages/*`, no change needed for package discovery.
- `apps/backend/package.json` / `pnpm-lock.yaml`: add OpenAPI/docs/metrics/tracing dependencies if chosen.
- `apps/backend/src/api/index.ts`: consume shared schemas, expose route metadata/contract registry, add `/health`, `/openapi.json`, maybe docs route if JSON route handled here.
- `apps/backend/src/server.ts`: content negotiation for `/metrics` text, docs static HTML if not routed through JSON handler, HTTP metrics/tracing, public-path/read-only policy updates.
- `apps/backend/src/services/index.ts` and new observability/health service files: health probes, metrics singleton/layer, tracing init.
- `apps/backend/src/agents/ProcessingPipeline.ts`, `apps/backend/src/agents/OCRAgent.ts`, `apps/backend/src/services/MistralService.ts`, `apps/backend/src/services/OllamaService.ts`, possibly `PaperlessService.ts`/`QdrantService.ts`: metric/span instrumentation.
- `apps/web/lib/api.ts`: after W2-S6, import shared types instead of duplicates.
- Tests: `apps/backend/tests/api/router.test.ts`, `apps/backend/tests/server.test.ts`, new tests for health aggregation, metrics exposition, OpenAPI route/docs dev gating, and instrumentation edge cases.
- `docker-compose.yml`: maybe update healthcheck to assert dependency status if W3-S16 is intended to gate frontend on upstreams.

## Risks / decisions needed

- **OpenAPI dependency on W2-S6 is real.** Current route schemas are inline and incomplete for responses/query params; generating from them now would create a throwaway source and violate W3-S16 wording.
- **Health HTTP status semantics:** Docker healthcheck currently passes on any 2xx. Decide whether missing external services should return 503 (compose waits/fails) or 200 with degraded JSON (UI can show but compose starts). Audit O2 says compose healthcheck should wait on it, suggesting 503 for required deps, but local dev may want degraded.
- **Qdrant health must be non-mutating.** Existing settings test calls `ensureCollection()` after connect; health should not create collections or change state.
- **Metrics endpoint auth:** `/health` is public today. `/metrics` may expose operational metadata and should likely be protected unless scraping locally; if protected, document how Prometheus passes token.
- **Label cardinality/secrets:** Do not label metrics/spans with document text, prompts, OCR content, full URLs with IDs/query strings, or tokens. Use route patterns/service names/step names/status classes.
- **Tracing dependency choice:** No current OTLP exporter. If adding an OTel bridge, verify compatibility with Effect 3.19 and ESM. Alternative acceptable per task is “compatible local sink,” but acceptance may expect OTLP; clarify if necessary.
- **Docs in production:** Task says serve API docs in development. Gate docs UI by env/config; `/openapi.json` may be okay in all envs if authenticated, but decide explicitly.
- **SSE routes bypass router.** If OpenAPI/metrics only inspect `api/index.ts`, `/api/processing/:docId/stream`, `/api/cases/document/:docId/stream`, and `/api/catalog/runs/:runId/stream` will be missed.

## Validation commands

Targeted backend checks after implementation:

```bash
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test
pnpm run typecheck
pnpm run lint
pnpm run test
```

Manual/runtime checks (with backend running):

```bash
curl -sS http://127.0.0.1:8765/health | jq .
curl -sS http://127.0.0.1:8765/metrics | head -50
curl -sS http://127.0.0.1:8765/openapi.json | jq '.openapi, (.paths | keys | length)'
NODE_ENV=development pnpm run dev:backend  # then open docs route if added
```

If Docker health semantics are changed:

```bash
docker compose up --build
# verify backend healthcheck reflects intended dependency behavior
```

## Compact worker meta-prompt

**Goal:** Implement W3-S16 observability/API docs after W2-S6 shared contracts are available: generated OpenAPI from shared schemas, dev-only API docs, dependency-aware `/health`, Prometheus-compatible `/metrics`, and Effect tracing to OTLP or an approved local sink.

**Context/evidence:** W3-S16 acceptance is in `docs/plans/audit-rework-tasks.md:303-317`; W2-S6 prerequisite is `:122-134`. Current `/health` is static in `apps/backend/src/api/index.ts:262-270`; routes/schemas are inline/private in `api/index.ts:50-256` and query params are special-cased in `:830-890`. Server request IDs/log duration are in `apps/backend/src/server.ts:535-550`; auth public paths only include `/` and `/health` at `server.ts:129-137`. Existing probes live in `apps/backend/src/api/settings/handlers.ts:373-535`; use non-mutating service probes for health. Metrics/tracing deps are absent from `apps/backend/package.json:16-27`. Pipeline/LLM instrumentation points are `ProcessingPipeline.ts:868-1130`, `OCRAgent.ts:140-219`, `MistralService.ts:145-215`, and Ollama chat/generate/embed in `OllamaService.ts`.

**Success criteria:** `/health` returns overall and per-dependency statuses for Paperless, Ollama, Qdrant, and Mistral with sensible HTTP status semantics; `/metrics` emits useful counters/histograms for HTTP, pipeline phases, retries/errors, and LLM/OCR latency; OpenAPI JSON is generated from shared contracts and docs UI is served only in development; HTTP->Effect->external calls have spans exported to OTLP or an agreed local sink; tests and type/lint pass.

**Hard constraints:** Do not create a second long-term schema source; OpenAPI must use W2-S6 shared schemas/contracts. Do not expose secrets, prompts, OCR text, or raw docs in metrics/spans/logs. Avoid mutating operations in health checks. Respect existing auth/read-only behavior unless intentionally changed and tested.

**Suggested approach:** First verify/finish W2-S6 shared contract registry. Add OpenAPI generation/docs routes from that registry, including direct SSE routes. Add HealthService with concurrent, timed probes. Add MetricsService and server `/metrics` text response, then instrument server, pipeline, OCR/Mistral/Ollama. Add tracing layer/init and span wrappers around HTTP route handling, pipeline steps, and external clients. Update docs/config and tests.

**Validation:** Run backend typecheck/lint/test plus root `pnpm run typecheck && pnpm run lint && pnpm run test`. Manually curl `/health`, `/metrics`, `/openapi.json`, and dev docs. If Docker health behavior changes, run `docker compose up --build` and confirm expected health gating.

**Stop/escalation rules:** Ask for a decision if W2-S6 is not present, if choosing OTLP dependency/exporter vs local sink changes scope, if `/metrics` public/protected behavior is ambiguous, or if health should return 503 on degraded upstreams. Stop when acceptance criteria are met and validation passes.
