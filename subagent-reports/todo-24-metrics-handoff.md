# Todo #24 / W3-S16 metrics handoff

## Requirement
Prepare implementation for W3-S16 item: “Expose metrics for pipeline phases, retries, errors, and LLM latency.” Acceptance in `docs/plans/audit-rework-tasks.md:305-318`: `/metrics` exposes useful counters/histograms.

No code edits were made during this investigation.

## Current state
- No backend metrics or Prometheus/OpenTelemetry dependency exists. `apps/backend/package.json:16-27` has Effect, TinyBase, Qdrant, Pi libs, etc., but no `prom-client`/OTel.
- HTTP server already has central request handling in `apps/backend/src/server.ts`; `/health` is public and rate-limit-bypassed through `isPublicPath`/`shouldBypassRateLimit` (`server.ts:289-296`, `server.ts:678-700`). Add `/metrics` here rather than the API router because Prometheus text is not JSON.
- Pipeline instrumentation points exist in `apps/backend/src/agents/ProcessingPipeline.ts`:
  - stream events/types: `ProcessingPipeline.ts:57-78`
  - failure classification: `ProcessingPipeline.ts:178-220`
  - full document flow invokes OCR, metadata, index: `ProcessingPipeline.ts:935-1035`
  - step flow invokes each phase: `ProcessingPipeline.ts:1052-1130`
  - stream wrappers emit start/complete/error: `ProcessingPipeline.ts:1133-1200`
- Retry and latency points:
  - Mistral generic API retry loop: `apps/backend/src/services/MistralService.ts:145-214`, calls at `MistralService.ts:221-278`.
  - OCR Mistral `/v1/ocr` retry loop: `apps/backend/src/agents/OCRAgent.ts:137-214`.
  - Pi document agent calls `agent.prompt` directly, not via `OllamaService`: `apps/backend/src/agents/PiDocumentAgent.ts:2552-2572`; correction retry loops are at `PiDocumentAgent.ts:2630-2659`.
  - Ollama service direct HTTP calls: non-stream `request` at `apps/backend/src/services/OllamaService.ts:174-215`, `chat` at `OllamaService.ts:230-244`, streams at `OllamaService.ts:246+` and `382+`, embed at `OllamaService.ts:487-518`.
- Tests already use direct server helpers and injectable mocked layers:
  - `apps/backend/tests/server.test.ts:1-21`, request helpers at `server.test.ts:43-90`, existing rate-limit/SSE tests at `server.test.ts:327-431`.
  - `apps/backend/tests/services/MistralService.test.ts:34-99` already verifies retry and timeout behavior.
  - `apps/backend/tests/services/OllamaService.test.ts:33-95` verifies stream failures and timeouts.
  - `apps/backend/tests/agents/ProcessingPipeline.test.ts:287-386` verifies qdrant/OCR failures and log data; useful pattern for metrics assertions.

## Recommended exact files
Create:
1. `apps/backend/src/services/MetricsService.ts`
2. `apps/backend/tests/services/MetricsService.test.ts`

Modify:
1. `apps/backend/src/server.ts`
2. `apps/backend/src/services/index.ts` (export metrics module if service barrel is used)
3. `apps/backend/src/agents/ProcessingPipeline.ts`
4. `apps/backend/src/agents/OCRAgent.ts`
5. `apps/backend/src/services/MistralService.ts`
6. `apps/backend/src/services/OllamaService.ts`
7. `apps/backend/src/agents/PiDocumentAgent.ts`
8. Tests: `apps/backend/tests/server.test.ts`, `apps/backend/tests/services/MistralService.test.ts`, `apps/backend/tests/services/OllamaService.test.ts`, `apps/backend/tests/agents/ProcessingPipeline.test.ts` as needed.

## Design
Implement a small in-repo Prometheus text registry (no new dependency required): counters, histograms, label escaping, deterministic render order, and `reset()` for tests. Export a singleton plus helpers from `MetricsService.ts`.

Expose `GET /metrics` from `server.ts` before JSON route handling. Recommended: treat `/metrics` like `/health` for auth/rate-limit bypass by updating `isPublicPath` and `shouldBypassRateLimit`. Return `Content-Type: text/plain; version=0.0.4; charset=utf-8`.

Do not label by `docId`, title, prompt, error message, URL, or API key. Use bounded labels only.

### Exact metric names
Required metrics:
- `paperless_llm_pipeline_phase_started_total{phase,mode}` counter. `phase`: `pipeline|ocr|metadata|index`; `mode`: `document|step|stream|dry_run`.
- `paperless_llm_pipeline_phase_completed_total{phase,outcome,mode}` counter. `outcome`: `success|failure|needs_review|skipped`.
- `paperless_llm_pipeline_phase_duration_seconds{phase,outcome,mode}` histogram. Buckets: `[0.1,0.5,1,2.5,5,10,30,60,120,300,600]`.
- `paperless_llm_pipeline_errors_total{phase,kind,retryable}` counter, using existing failure classification where possible (`timeout|transient|permanent|unknown`, retryable `true|false`).
- `paperless_llm_retries_total{component,operation,reason}` counter. Examples: `{component="mistral",operation="chat",reason="http_500"}`, `{component="mistral",operation="ocr",reason="timeout"}`, `{component="document_agent",operation="final_tool_correction",reason="validation"}`.
- `paperless_llm_llm_request_duration_seconds{provider,operation,model,outcome}` histogram. `provider`: `mistral|ollama|pi_ollama`; `operation`: `chat|ocr|image|document|list_models|generate|embed|stream_chat|stream_generate|agent_prompt`; `outcome`: `success|error|timeout`.

Optional but useful for validating `/metrics` and future dashboards:
- `paperless_llm_http_requests_total{method,path,status}` counter.
- `paperless_llm_http_request_duration_seconds{method,path,status}` histogram.

## Implementation notes / risks
- PiDocumentAgent is the main metadata LLM path and bypasses `OllamaService`; LLM latency will be incomplete unless `runPrompt` around `agent.prompt` is instrumented.
- Mistral retry loops count an “attempt” starting at 0. Increment retry counter only when a failed attempt will actually sleep/retry, not for final failure.
- For stream metrics, observe duration on `emit.end()` and on `emit.fail()` paths; do not try to observe per chunk.
- If using global singleton registry, tests must call `metricsRegistry.reset()` in `beforeEach/afterEach` to prevent cross-test leakage.
- Metrics endpoint should not call Effect runtime; a simple synchronous render is safer and cannot fail due to missing app layers.

## Test plan
Add/extend tests:
1. `MetricsService.test.ts`: counter increment, histogram bucket/sum/count output, label escaping, stable render, reset.
2. `server.test.ts`: start `createHttpServerWithLayer`, `GET /metrics` returns 200 text/plain and includes a known metric after exercising a request; with `PAPERLESS_LLM_API_TOKEN` set, `/metrics` is still accessible if implementing public endpoint.
3. `MistralService.test.ts`: existing transient retry test should assert `paperless_llm_retries_total{component="mistral",operation="list_models",reason="http_500"} 1` and LLM duration count for outcome success.
4. `OllamaService.test.ts`: assert duration count on successful `chat` or failed timeout; stream malformed JSON should produce an error outcome if instrumented.
5. `ProcessingPipeline.test.ts`: qdrant/OCR failure tests should assert phase completed failure and `paperless_llm_pipeline_errors_total` with classified kind/retryable.
6. `PiDocumentAgent.test.ts` if practical: assert `agent_prompt` duration and retry counter for final-tool correction. If this is too heavy, cover `buildRetryCorrection...` unchanged and document manual validation.

## Validation commands
- Targeted: `pnpm --filter @repo/backend test -- MetricsService MistralService OllamaService ProcessingPipeline server`
- Full backend: `pnpm --filter @repo/backend test`
- Typecheck: `pnpm --filter @repo/backend typecheck`
- Optional lint: `pnpm --filter @repo/backend lint`

Manual smoke:
```bash
pnpm run dev:backend
curl -s http://127.0.0.1:8765/metrics | grep 'paperless_llm_'
```

## Compact worker prompt
Implement Todo #24 metrics. Create an in-repo Prometheus text metrics registry in `apps/backend/src/services/MetricsService.ts` (counter + histogram + render + reset). Expose `GET /metrics` as text/plain from `apps/backend/src/server.ts`, public and rate-limit-bypassed like `/health`. Instrument pipeline phases in `ProcessingPipeline.ts`, errors using existing failure classification, retries in `MistralService.ts`, `OCRAgent.ts`, and PiDocumentAgent correction loops, and LLM latency in Mistral/OCR/Ollama/Pi prompt paths. Use the exact metric names/labels listed in `subagent-reports/todo-24-metrics-handoff.md`; never label with docId/title/prompt/error message/API key. Add tests for registry rendering, `/metrics`, retry counters, LLM latency, and pipeline phase/error metrics. Run targeted backend tests and typecheck before finishing.
