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
```bash
# Install hooks
pnpm exec pre-commit install

# Run manually
pnpm exec pre-commit run --all-files

# Or via pnpm
pnpm run precommit
```

**Active Checks:**
- **gitleaks**: Detects accidentally committed secrets/API keys
- **TypeScript**: `tsc --noEmit` Type Checking
- **ESLint**: JavaScript/TypeScript Linting
- **Turbo**: Unified pre-commit checks

On errors, the commit is aborted.

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
