# W3-S16 Effect tracing worker report

## Implemented
- Added `apps/backend/src/observability/tracing.ts` with:
  - env parsing (`PAPERLESS_LLM_TRACING_ENABLED`, `PAPERLESS_LLM_TRACE_SINK`, `PAPERLESS_LLM_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_ENDPOINT`, service name, export interval)
  - disabled/no-op default tracing layer
  - native Effect tracer local sinks: `none`, `console`, `jsonl`, `memory`, plus OTLP-compatible local console output mode
  - sanitizer for secrets, tokens, prompts/messages, body/content/OCR/PDF/base64/image, embeddings/vectors, args/results/payloads
  - span helper functions for server/client/internal spans
- Composed `TracingLayer` into `AppLayer` without enabling exporters unless env explicitly enables tracing.
- Added spans around:
  - normal HTTP route dispatch (`http.request`) with request id, method, normalized route/path only
  - processing pipeline phase wrapper (`pipeline.phase.*`) with bounded phase/mode attributes
  - central Paperless helpers (`paperless.request`, `paperless.binary_request`, `paperless.multipart_request`)
  - central Ollama request helper (`ollama.request`)
  - central Mistral request helper (`mistral.request`)
  - Qdrant operations (`qdrant.search`, `qdrant.upsert`, `qdrant.delete`, `qdrant.ensure_collection`)
- Added `apps/backend/tests/observability/tracing.test.ts` covering disabled defaults, config parsing, sanitizer behavior, and memory-sink span recording.

## Changed files
- `apps/backend/src/observability/tracing.ts`
- `apps/backend/tests/observability/tracing.test.ts`
- `apps/backend/src/layers/index.ts`
- `apps/backend/src/server.ts`
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/services/MistralService.ts`
- `apps/backend/src/services/OllamaService.ts`
- `apps/backend/src/services/PaperlessService.ts`
- `apps/backend/src/services/QdrantService.ts`
- `progress.md`

## Validation
- Passed: `pnpm --filter @repo/backend typecheck`
- Passed: `pnpm --filter @repo/backend test -- tracing MistralService OllamaService PaperlessService ProcessingPipeline`
- Attempted: `pnpm --filter @repo/backend lint`
  - Blocked by unrelated existing lint error in `apps/backend/src/services/DocumentAuthorizationService.ts:62` (`action` unused parameter).
- Attempted broader targeted test including `server`; most passed, but two existing processing SSE server tests failed with HTTP 500 instead of 200. I did not change SSE stream logic; this appears unrelated to the tracing edits.

## Notes / risks
- This implementation uses Effect native tracing with compatible local sinks, not the `@effect/opentelemetry` OTLP exporter dependency. No network exporter runs by default.
- The `otlp` sink value currently emits sanitized OTLP-compatible span records locally to console with endpoint metadata; it is not a real OTLP HTTP exporter.
- HTTP spans currently cover normal Effect route dispatch. Early-return paths such as auth/rate-limit/metrics and direct SSE streams are not fully wrapped as long-lived server spans.
- Pi document-agent prompt/event and direct OCR-specific spans were not added beyond service/pipeline boundaries to minimize risk of prompt/OCR-content leakage.
