# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Paperless Local LLM is an AI-powered document analysis system for Paperless-ngx. It uses Mistral AI for OCR and local Ollama models for automatic metadata extraction (title, correspondent, tags).

## TurboRepo Monorepo Structure

```
paperless_local_llm/
├── apps/
│   ├── web/          # Vite + React frontend
│   └── api/          # Python FastAPI backend
├── packages/
│   └── ui/           # Shared shadcn/ui components
├── turbo.json        # TurboRepo configuration
└── package.json      # Root workspace configuration
```

## Development Commands

### Root (TurboRepo)
```bash
bun install          # Install all workspace dependencies
bun dev              # Start all apps in development mode
bun build            # Build all apps
bun lint             # Lint all apps
bun typecheck        # Type check all apps
```

### Frontend (apps/web - Vite)
```bash
cd apps/web
bun dev              # Development server (port 3000)
bun build            # Production build
bun lint             # ESLint
bun typecheck        # TypeScript type checking
```

### Backend (apps/api - FastAPI/Python)
```bash
cd apps/api/backend
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
cd apps/api/backend && uv sync --all-extras
uv run pre-commit install

# Run manually
uv run pre-commit run --all-files
```

**Active Checks:**
- **gitleaks**: Detects accidentally committed secrets/API keys
- **ruff**: Python Linting & Formatting
- **mypy**: Python Type Checking
- **TypeScript**: Type checking
- **ESLint**: JavaScript/TypeScript Linting

## Architecture

**TurboRepo monorepo with two apps:**
- **apps/web**: Vite + React 19 + TailwindCSS 4 + React Router
- **apps/api**: FastAPI + LangGraph + LangChain

**Shared packages:**
- **packages/ui**: shadcn/ui components with Hugeicons

**External dependencies:**
- Paperless-ngx (document management)
- Ollama (local LLM inference - large model for analysis, small model for confirmation)
- Mistral AI (OCR)
- Qdrant (vector similarity search for context)

### Backend Structure (`apps/api/backend/`)
- `main.py` - FastAPI app with CORS and router setup
- `config.py` - Pydantic Settings loading from `config.yaml` + env vars
- `routers/` - API endpoints (settings, documents, processing, prompts)
- `services/` - External service clients (paperless.py, qdrant.py)
- `agents/` - LangGraph agents for each processing step (ocr, title, correspondent, tags)
- `prompts/` - Markdown prompt templates with variable placeholders

### Frontend Structure (`apps/web/src/`)
- `main.tsx` - App entry point
- `App.tsx` - React Router setup
- `routes/` - Page components (dashboard, documents, settings, etc.)
- `components/` - App-specific components (sidebar, layout)
- `lib/` - API client, i18n configuration, utilities
- `locales/` - Translation files (en.json, de.json)

### Shared UI (`packages/ui/`)
- `src/` - All shadcn/ui components with Hugeicons
- `lib/utils.ts` - cn() helper function
- `components.json` - shadcn/ui configuration (radix-mira style)

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
