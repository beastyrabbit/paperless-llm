# W3-S14 / todo #11 concurrency caps worker report

## Implemented
- Added `ConcurrencyLimitService` backed by shared Effect semaphores for Ollama, Mistral, and OCR caps.
- Added `concurrency` config section with defaults of `1` for:
  - `ollamaMaxConcurrent`
  - `mistralMaxConcurrent`
  - `ocrMaxConcurrent`
- Added YAML snake_case normalization and env overrides:
  - `PAPERLESS_LLM_OLLAMA_MAX_CONCURRENT`
  - `PAPERLESS_LLM_MISTRAL_MAX_CONCURRENT`
  - `PAPERLESS_LLM_OCR_MAX_CONCURRENT`
- Wired the limiter as a shared backend layer.
- Applied caps to:
  - `MistralService` request attempts, without holding permits during retry backoff sleeps.
  - `OllamaService` non-stream requests, embeddings, and stream lifetimes.
  - `OCRAgent` direct Mistral `/v1/ocr` attempts with both Mistral and OCR caps.
  - `OCRAgent` local `ocrmypdf` searchable PDF generation with the OCR cap.
  - Direct Pi/Ollama `streamSimple` paths in document, consolidation, and tag explorer agents via a gated Pi stream wrapper.
- Updated `config.example.yaml` with the new concurrency section.
- Added/updated focused tests for config parsing, limiter serialization/clamping, Mistral service gating, Ollama service gating, and OCRAgent layer wiring.

## Changed files
- `apps/backend/src/services/ConcurrencyLimitService.ts`
- `apps/backend/src/services/MistralService.ts`
- `apps/backend/src/services/OllamaService.ts`
- `apps/backend/src/services/index.ts`
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/agents/piOllamaModel.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/src/agents/PiConsolidationAgent.ts`
- `apps/backend/src/agents/PiTagExplorerAgent.ts`
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `apps/backend/src/config/yaml-loader.ts`
- `apps/backend/src/layers/index.ts`
- `apps/backend/tests/services/ConcurrencyLimitService.test.ts`
- `apps/backend/tests/services/MistralService.test.ts`
- `apps/backend/tests/services/OllamaService.test.ts`
- `apps/backend/tests/agents/OCRAgent.test.ts`
- `apps/backend/tests/config/config.test.ts`
- `config.example.yaml`
- `progress.md`

## Validation
Passed:
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`
- `pnpm --filter @repo/backend test -- tests/agents/OCRAgent.test.ts tests/services/ConcurrencyLimitService.test.ts tests/config/config.test.ts tests/services/MistralService.test.ts tests/services/OllamaService.test.ts`

Note: the requested `context.md` and `plan.md` were not present in the repo root; implementation used `subagent-reports/todo-11-concurrency-caps-handoff.md` plus actual code inspection.

## Open risks / notes
- The Pi direct Ollama bypass is closed with a gated `streamSimple` proxy rather than a lower-level provider transport hook. This avoids wrapping the entire `agent.prompt` and therefore avoids the known small-verifier self-deadlock risk, but it should still be watched in longer integration runs.
- Full backend test suite/build were not run; targeted tests, typecheck, and lint passed.
