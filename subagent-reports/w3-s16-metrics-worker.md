# W3-S16 metrics worker report

Implemented Todo #24 metrics support.

## Changes made
- Added `apps/backend/src/services/MetricsService.ts` with an in-repo Prometheus text registry supporting counters, histograms, deterministic rendering, label escaping, and `reset()` for tests.
- Exported metrics helpers from `apps/backend/src/services/index.ts`.
- Exposed public, rate-limit-bypassed `GET /metrics` in `apps/backend/src/server.ts` with Prometheus `text/plain; version=0.0.4` content type.
- Added HTTP request counter and duration histogram instrumentation with normalized low-cardinality paths.
- Added LLM/OCR latency and retry instrumentation in:
  - `apps/backend/src/services/MistralService.ts`
  - `apps/backend/src/services/OllamaService.ts`
  - `apps/backend/src/agents/OCRAgent.ts`
  - `apps/backend/src/agents/PiDocumentAgent.ts`
- Added pipeline phase/error instrumentation in `apps/backend/src/agents/ProcessingPipeline.ts` using bounded phase/mode/outcome/error-classification labels.
- Added tests for metrics rendering/escaping/reset and `/metrics` exposure; extended Mistral retry test to assert retry and LLM latency metric output.

## Validation
- `pnpm --filter @repo/backend test -- MetricsService server MistralService OllamaService` passed.
- `pnpm --filter @repo/backend typecheck` passed.
- `pnpm --filter @repo/backend lint` passed.
- `pnpm --filter @repo/backend test` was run; 253/254 tests passed, with one pre-existing/unrelated OpenAPI route documentation failure: `POST /api/processing/{docId}/cancel` missing from shared OpenAPI contracts in `tests/api/router.test.ts`.

## Notes / risks
- Metrics labels avoid document IDs, prompt text, document contents, error messages, API keys, and URLs.
- Model label is retained for LLM histograms as requested by the handoff metric schema; it is configuration-derived and expected to be low-cardinality.
- Stream-specific pipeline phase timing is not deeply per-chunk instrumented; HTTP metrics cover stream requests, and pipeline/service metrics cover invoked processing paths.
