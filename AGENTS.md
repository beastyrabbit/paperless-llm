# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Paperless Local LLM is an AI-powered document analysis system for Paperless-ngx. It uses Mistral AI for OCR and local Ollama models for automatic metadata extraction (title, correspondent, tags).

## Development Commands

### Frontend (Next.js)
```bash
pnpm install         # Install dependencies (from root)
pnpm run dev:web     # Development server (port 3765)
pnpm run build       # Production build
pnpm run lint        # ESLint
pnpm run typecheck   # TypeScript check
```

### Backend (TypeScript/Effect)
```bash
cd apps/backend
pnpm run dev         # Development server (port 8765)
pnpm run build       # Production build
pnpm run test        # Run tests with Vitest
pnpm run typecheck   # TypeScript check
```

### Docker
```bash
docker compose up -d           # Start all services
docker compose logs -f         # View logs
docker compose down            # Stop services
```

### Pre-Commit Hooks

Git hooks are automatically active (located in `.git/hooks/pre-commit`).

```bash
# Run checks manually
pnpm run precommit
```

**Active Checks:**
- **gitleaks**: Detects accidentally committed secrets/API keys
- **TypeScript**: `tsc --noEmit` type checking
- **ESLint**: JavaScript/TypeScript linting
- **Large files**: Blocks files >1MB
- **Merge conflicts**: Detects conflict markers
- **Private keys**: Detects private key content

On errors, the commit is aborted.

**Note:** Pre-commit hooks run typecheck + lint via turborepo and can take 5-10s (cached) or 30s+ (uncached). Use 600s timeout for `git commit` in automation.

## Architecture

**Two-service architecture:**
- **Frontend**: Next.js 16 + React 19 + TailwindCSS 4 + shadcn/ui (port 3765)
- **Backend**: TypeScript + Effect-TS + Hono HTTP server (port 8765)

**External dependencies:**
- Paperless-ngx (document management)
- Ollama (local LLM inference - large model for analysis, small model for confirmation)
- Mistral AI (OCR)
- Qdrant (vector similarity search for context)

### Backend Structure (`apps/backend/`)
- `src/index.ts` - Application entry point
- `src/server.ts` - HTTP server with CORS and request handling
- `src/api/` - API route handlers (settings, documents, processing, prompts, pending, jobs)
- `src/services/` - External service clients (PaperlessService, OllamaService, MistralService, TinyBaseService)
- `src/agents/` - Document processing agents (TitleAgent, CorrespondentAgent, TagAgent, etc.)
- `src/config/` - Configuration management with Effect layers
- `src/layers/` - Effect dependency injection layers
- `tests/` - Vitest test suites

### Frontend Structure (`apps/web/`)
- `app/page.tsx` - Dashboard
- `app/settings/` - Configuration UI
- `app/documents/` - Document browser
- `app/pending/` - Manual review queue
- `app/prompts/` - Prompt template viewer
- `components/` - App-specific components (sidebar, model-combobox)
- `lib/api.ts` - Typed API client

### Shared UI Package (`packages/ui/`)
- Shared shadcn/ui components used across the frontend
- Import from `@repo/ui` in frontend code

## Processing Pipeline

Documents flow through tag-based states:
1. `llm-pending` → OCR (Mistral) → `llm-ocr-done`
2. → Title generation (Ollama large) → `llm-title-done`
3. → Correspondent assignment → `llm-correspondent-done`
4. → Tag assignment → `llm-tags-done`
5. → `llm-processed` (complete)

The confirmation loop uses: Large Model analysis → Small Model verification → retry or user queue.

## Configuration

Copy `config.example.yaml` to `config.yaml` (gitignored). Settings are loaded with priority: environment variables > config.yaml > defaults.

Key config sections: `paperless`, `mistral`, `ollama`, `qdrant`, `auto_processing`, `tags`, `pipeline`, `vector_search`.

## Ports

Frontend dev server on port 3765, backend on port 8765 (registered in `/home/beasty/projects/.ports`).

## Development Guidelines

### Prompts and Localization

**NEVER hardcode prompts in code.** Always use `PromptService` to load prompts:

```typescript
const promptService = yield* PromptService;
const promptInfo = yield* promptService.getPrompt('prompt_name');
const prompt = promptInfo.content;
```

- Prompts are stored in `apps/backend/prompts/{lang}/` (e.g., `en/`, `de/`)
- PromptService automatically loads the correct language based on settings
- Falls back to English if the target language prompt doesn't exist
- Use placeholder syntax like `{document_content}`, `{existing_tags}` in prompts
- PromptService strips Markdown formatting before sending to LLM (plain text only)

**When adding a new prompt:**

1. **Create both language versions** - Always provide `en/` AND `de/` translations
2. **Update expectedPrompts** - Add the prompt name to the `expectedPrompts` array in `PromptService.ts` (around line 216) so language completeness is tracked correctly
3. **Use consistent placeholders** - Follow existing patterns like `{document_content}`, `{existing_correspondents}`

```typescript
// In PromptService.ts - add your new prompt to this list
const expectedPrompts = [
  'title',
  'correspondent',
  // ... existing prompts
  'your_new_prompt',  // <-- Add here
];
```

### Pipeline Steps

When adding a new pipeline step in `ProcessingPipeline.ts`:

1. **Add an enable flag** in the pipeline config (e.g., `enableNewStep`)
2. **Add skip handling** - When the step is disabled, advance the state:
   ```typescript
   if (currentState === 'previous_done' && pipelineConfig.enableNewStep) {
     // ... run the step
     currentState = 'new_step_done';
   } else if (currentState === 'previous_done' && !pipelineConfig.enableNewStep) {
     // Skip disabled step but advance state
     currentState = 'new_step_done';
   }
   ```
3. **Add settings UI** in the Pipeline tab for users to enable/disable

### Mistral OCR Code Paths

Two separate OCR implementations exist (pre-existing architectural divergence):
- `OCRAgent.runMistralOCR()` → dedicated `/v1/ocr` endpoint → returns `{ text: string, pages: number }`
- `MistralService.processDocument()` → chat completions API with extraction prompt → returns `string`

`BulkOcrJob` uses `MistralService`, while `OCRAgent` uses the dedicated OCR API. Watch the return types when passing to `updateDocument`.

### Paperless-ngx API Notes

- `PATCH /api/documents/{id}/` accepts `content` field to overwrite document text (replaces Tesseract output with Mistral OCR)
- The `DocumentUpdateSchema` in `models/index.ts` defines the allowed PATCH fields

### Background Jobs

When creating jobs that run in the background (e.g., Bootstrap, BulkIngest, BulkOcr):

- Use `Effect.forkDaemon` instead of `Effect.fork` for fibers that need to survive after the HTTP request completes
- Child fibers created with `Effect.fork` are terminated when the parent scope closes
- Daemon fibers run independently and survive after the parent effect completes

```typescript
// CORRECT - fiber survives after HTTP request completes
const fiber = yield* Effect.forkDaemon(runAnalysis);

// WRONG - fiber is killed when HTTP request finishes
const fiber = yield* Effect.fork(runAnalysis);
```
