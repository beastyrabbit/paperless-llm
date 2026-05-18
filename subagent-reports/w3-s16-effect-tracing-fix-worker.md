# W3-S16 Effect Tracing Fix Worker

## Implemented
- Added sanitized tracing for direct processing SSE, case SSE polling snapshots, and catalog SSE polling snapshots.
- Annotated HTTP request spans with response status code, duration, and success/error outcome after handler conversion.
- Added root/internal pipeline spans and outcome annotations for process/step phase spans.
- Added Ollama streaming client spans for chat and generate streams.
- Added OCR process and direct Mistral OCR client spans with safe page/text-length/outcome attributes.
- Added Pi document-agent process, prompt, and event spans without recording prompt/document text/secrets.
- Added server test coverage for traced HTTP response status/outcome after a handler returns an error status.

## Changed Files
- `apps/backend/src/server.ts`
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/services/OllamaService.ts`
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/tests/server.test.ts`
- `progress.md`

## Validation
- `pnpm --filter @repo/backend typecheck` ✅
- `pnpm --filter @repo/backend lint` ✅
- `pnpm --filter @repo/backend test -- tests/observability/tracing.test.ts tests/server.test.ts tests/agents/ProcessingPipeline.test.ts tests/services/OllamaService.test.ts tests/agents/OCRAgent.test.ts tests/agents/PiDocumentAgent.test.ts` ✅

## Notes / Risks
- Requested `context.md` and `plan.md` were not present in the workspace, so implementation was based on the task text and actual code.
- Direct case/catalog SSE tracing is emitted per polling snapshot; processing SSE wraps the stream handler.
- Attributes avoid prompts, OCR/document content, request bodies, secrets, embeddings, and raw run IDs; catalog run IDs are represented by length only.
