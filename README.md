<div align="center">

# Paperless Local LLM

**AI-powered document analysis system for Paperless-ngx**

*Automatic metadata extraction using Mistral AI for OCR and local Ollama models for intelligent title, correspondent, and tag assignment.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python 3.12+](https://img.shields.io/badge/Python-3.12+-green.svg)](https://python.org)
[![Bun](https://img.shields.io/badge/Bun-latest-f9f1e1.svg)](https://bun.sh)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg)](https://docker.com)

<br />

![Dashboard Preview](docs/images/dashboard.png)

</div>

---

## Features

- **OCR Processing** — Mistral AI for high-quality text recognition from scanned documents
- **Automatic Metadata** — Title, correspondent, and tag extraction via local LLM models
- **Confirmation Loop** — Large model analysis → Small model verification → Retry or manual review queue
- **Vector Search** — Find similar documents for context using Qdrant
- **Tag-based Workflow** — Independent processing steps with state tracking
- **Live Streaming** — Real-time LLM responses in the frontend
- **Multi-language UI** — English and German interface support
- **Docker Ready** — Full Docker Compose setup included

## Screenshots

<div align="center">
<table>
<tr>
<td width="50%">
<img src="docs/images/dashboard.png" alt="Dashboard" />
<p align="center"><strong>Dashboard</strong><br/>Pipeline visualization and queue statistics</p>
</td>
<td width="50%">
<img src="docs/images/settings.png" alt="Settings" />
<p align="center"><strong>Settings</strong><br/>Service configuration and model selection</p>
</td>
</tr>
</table>
</div>

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) — JavaScript runtime for the frontend
- [uv](https://github.com/astral-sh/uv) — Fast Python package manager for the backend
- Docker & Docker Compose (optional, for deployment)
- Running instances of:
  - [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx) — Document management system
  - [Ollama](https://ollama.ai/) — Local LLM inference with your preferred models
  - [Qdrant](https://qdrant.tech/) — Vector database (or use the included Docker Compose)

### Installation

```bash
# Clone the repository
git clone https://github.com/beastyrabbit/paperless-llm.git
cd paperless-llm

# Install frontend dependencies
bun install

# Install backend dependencies
cd apps/backend
uv sync
```

### Configuration

1. Copy the example configuration:
```bash
cp config.example.yaml config.yaml
```

2. Edit `config.yaml` with your settings:
```yaml
paperless:
  url: "http://your-paperless-server:8000"
  token: "your-paperless-api-token"

mistral:
  api_key: "your-mistral-api-key"

ollama:
  url: "http://your-ollama-server:11434"
  model_large: "your-large-model"    # e.g., llama3.1:70b
  model_small: "your-small-model"    # e.g., llama3.1:8b

qdrant:
  url: "http://your-qdrant-server:6333"
  collection: "paperless-documents"
```

> **Note:** `config.yaml` is gitignored — your secrets stay local.

### Running in Development

**Terminal 1 — Backend:**
```bash
cd apps/backend
uv run uvicorn main:app --reload --port 8000
```

**Terminal 2 — Frontend:**
```bash
bun run dev:web
```

The application will be available at `http://localhost:3000`.

## Docker Deployment

```bash
# Set environment variables (or create a .env file)
export PAPERLESS_URL=http://your-paperless:8000
export PAPERLESS_TOKEN=your-token
export MISTRAL_API_KEY=your-key
export OLLAMA_URL=http://host.docker.internal:11434

# Start all services
docker compose up -d

# View logs
docker compose logs -f
```

> **Tip:** Use `host.docker.internal` to access Ollama running on your host machine. This works on Linux, macOS, and Windows thanks to the `extra_hosts` configuration in `docker-compose.yml`.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Next.js        │────▶│  FastAPI        │────▶│  Paperless-ngx  │
│  Frontend       │     │  Backend        │     │                 │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────┐
              │  Ollama  │ │ Mistral  │ │  Qdrant  │
              │   LLMs   │ │   OCR    │ │ VectorDB │
              └──────────┘ └──────────┘ └──────────┘
```

## Processing Pipeline

Documents flow through tag-based states for independent, resumable processing:

| Phase | Input Tag | Output Tag | Description |
|-------|-----------|------------|-------------|
| OCR | `llm-pending` | `llm-ocr-done` | Mistral AI OCR extraction |
| Title | `llm-ocr-done` | `llm-title-done` | Generate document title |
| Correspondent | `llm-title-done` | `llm-correspondent-done` | Assign correspondent |
| Tags | `llm-correspondent-done` | `llm-tags-done` | Assign relevant tags |
| Complete | `llm-tags-done` | `llm-processed` | Processing finished |

## API Reference

### Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/settings` | Get current settings |
| PATCH | `/api/settings` | Update settings |
| POST | `/api/settings/test-connection/{service}` | Test service connection |

### Documents
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/documents/queue` | Queue statistics |
| GET | `/api/documents/pending` | Documents pending review |
| GET | `/api/documents/{id}` | Document details |

### Processing
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/processing/{id}/start` | Start processing |
| GET | `/api/processing/{id}/stream` | SSE stream of LLM responses |
| POST | `/api/processing/{id}/confirm` | Confirm result |

### Prompts
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/prompts` | List all prompts |
| GET | `/api/prompts/{name}` | Get specific prompt |

## Project Structure

```
paperless-local-llm/
├── apps/
│   ├── web/                  # Next.js Frontend
│   │   ├── app/              # App router pages
│   │   │   ├── page.tsx      # Dashboard
│   │   │   ├── settings/     # Configuration UI
│   │   │   ├── documents/    # Document browser
│   │   │   ├── pending/      # Review queue
│   │   │   └── prompts/      # Prompt viewer
│   │   ├── components/       # React components
│   │   └── lib/              # Utilities & API client
│   │
│   └── backend/              # Python FastAPI
│       ├── main.py           # FastAPI app
│       ├── config.py         # Settings (config.yaml + env)
│       ├── routers/          # API endpoints
│       ├── services/         # Paperless, Qdrant clients
│       ├── agents/           # LangGraph agents
│       └── prompts/          # Prompt templates
│
├── packages/
│   └── ui/                   # Shared shadcn/ui components
│
├── config.example.yaml       # Example configuration
├── docker-compose.yml        # Docker setup
└── README.md
```

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | Next.js 16, React 19, TailwindCSS 4, shadcn/ui |
| **Backend** | Python 3.12, FastAPI, LangGraph, LangChain, Pydantic |
| **AI/ML** | Ollama (local LLMs), Mistral AI (OCR), Qdrant (vector search) |
| **Infrastructure** | Docker, Turborepo (monorepo) |

## Development

### Frontend Commands
```bash
bun install          # Install dependencies
bun run dev:web      # Development server (port 3000)
bun run build        # Production build
bun run lint         # ESLint
bun run typecheck    # TypeScript check
```

### Backend Commands
```bash
cd apps/backend
uv sync                                        # Install dependencies
uv run uvicorn main:app --reload --port 8000   # Development server
uv run pytest                                  # Run tests
uv run ruff check .                            # Lint
uv run ruff format .                           # Format
```

### Pre-commit Hooks

```bash
cd apps/backend
uv sync --all-extras           # Install dev dependencies
uv run pre-commit install      # Enable hooks

# Manual run
uv run pre-commit run --all-files
```

Active checks: **gitleaks** (secrets), **ruff** (Python), **mypy** (types), **ESLint** (TypeScript)

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**[Documentation](docs/)** · **[Report Bug](https://github.com/beastyrabbit/paperless-llm/issues)** · **[Request Feature](https://github.com/beastyrabbit/paperless-llm/issues)**

</div>
