# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Paperless Local LLM is an AI-powered document analysis system for Paperless-ngx. It uses Mistral AI for OCR and local Ollama models for automatic metadata extraction (title, correspondent, tags).

## Monorepo Structure

This project uses Turborepo with Bun as the package manager.

```
paperless_local_llm/
├── apps/
│   ├── web/                    # Next.js frontend
│   └── backend/                # FastAPI Python backend
├── packages/
│   ├── ui/                     # @repo/ui - Shared UI components
│   ├── typescript-config/      # @repo/typescript-config
│   └── eslint-config/          # @repo/eslint-config
├── turbo.json
├── package.json                # Root workspace config
└── docker-compose.yml
```

## Development Commands

### Root (Turborepo)
```bash
bun install          # Install all dependencies
bun run build        # Build all packages and apps
bun run dev          # Start all dev servers
bun run lint         # Lint all packages
bun run typecheck    # TypeScript check all packages
bun run dev:web      # Start frontend only
bun run dev:backend  # Start backend only
```

### Frontend (apps/web)
```bash
cd apps/web
bun run dev          # Development server (port 3000)
bun run build        # Production build
bun run lint         # ESLint
```

### Backend (apps/backend)
```bash
cd apps/backend
uv sync              # Install dependencies
uv run uvicorn main:app --reload --port 8000  # Development server

# Testing
uv run pytest
uv run pytest -k test_name  # Single test

# Linting
uv run ruff check .
uv run ruff format .
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
cd apps/backend && uv sync --all-extras
uv run pre-commit install

# Run manually
uv run pre-commit run --all-files

# Or via bun
bun run precommit
```

**Active Checks:**
- **gitleaks**: Detects accidentally committed secrets/API keys
- **ruff**: Python Linting & Formatting
- **mypy**: Python Type Checking
- **TypeScript**: `tsc --noEmit` Type Checking
- **ESLint**: JavaScript/TypeScript Linting

## Architecture

**Two-service architecture:**
- **Frontend**: Next.js 16 + React 19 + TailwindCSS 4 + shadcn/ui
- **Backend**: FastAPI + LangGraph + LangChain

**External dependencies:**
- Paperless-ngx (document management)
- Ollama (local LLM inference - large model for analysis, small model for confirmation)
- Mistral AI (OCR)
- Qdrant (vector similarity search for context)

### Backend Structure (`apps/backend/`)
- `main.py` - FastAPI app with CORS and router setup
- `config.py` - Pydantic Settings loading from `config.yaml` + env vars
- `routers/` - API endpoints (settings, documents, processing, prompts)
- `services/` - External service clients (paperless.py, qdrant.py)
- `agents/` - LangGraph agents for each processing step (ocr, title, correspondent, tags)
- `prompts/` - Markdown prompt templates with variable placeholders

### Frontend Structure (`apps/web/`)
- `app/` - Next.js app router pages
  - `page.tsx` - Dashboard
  - `settings/` - Configuration UI
  - `documents/` - Document browser
  - `pending/` - Manual review queue
  - `prompts/` - Prompt template viewer
- `components/` - App-specific components (sidebar, model-combobox)
- `lib/api.ts` - Typed API client

### UI Package (`packages/ui/`)
- Shared shadcn/ui components used by apps/web
- Import with: `import { Button, Card, ... } from "@repo/ui"`

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
