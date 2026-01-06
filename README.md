# Paperless Local LLM

KI-gestütztes Dokumentenanalyse-System für Paperless-ngx mit Mistral OCR und lokalen Ollama-Modellen.

## Features

- 🔍 **OCR Processing**: Mistral AI für hochwertige Texterkennung
- 🏷️ **Automatische Metadaten**: Titel, Korrespondenten, Tags via LLM
- 🔄 **Bestätigungs-Loop**: Large Model Analyse → Small Model Bestätigung → Retry/User-Queue
- 📊 **Vektor-Suche**: Ähnliche Dokumente für Kontext via Qdrant
- 🎯 **Tag-basierter Workflow**: Unabhängige Verarbeitungsschritte
- 🖥️ **Live-Streaming**: LLM-Antworten in Echtzeit im Frontend

## Architektur

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Vite + React   │────▶│  FastAPI        │────▶│  Paperless-ngx  │
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

## Quick Start

### Voraussetzungen

- [Bun](https://bun.sh/) für das Frontend
- [uv](https://github.com/astral-sh/uv) für das Python Backend
- Docker & Docker Compose (optional)
- Laufende Instanzen von:
  - Paperless-ngx
  - Ollama mit deinen bevorzugten Modellen
  - Qdrant (oder via Docker Compose)

### Installation

```bash
# Repository klonen
git clone https://github.com/beastyrabbit/paperless-llm.git
cd paperless-llm

# Alle Dependencies installieren (TurboRepo)
bun install

# Backend Dependencies
cd apps/api/backend
uv sync
```

### Konfiguration

1. Kopiere die Beispiel-Konfiguration:
```bash
cp config.example.yaml config.yaml
```

2. Bearbeite `config.yaml` mit deinen Einstellungen:
```yaml
paperless:
  url: "http://your-paperless-server:8000"
  token: "your-paperless-api-token"

mistral:
  api_key: "your-mistral-api-key"

ollama:
  url: "http://your-ollama-server:11434"
  model_large: "your-large-model"
  model_small: "your-small-model"

qdrant:
  url: "http://your-qdrant-server:6333"
  collection: "paperless-documents"
```

> ⚠️ **Wichtig**: `config.yaml` ist in `.gitignore` und wird nicht committed. Deine Secrets bleiben lokal.

### Entwicklung

**Option 1 - TurboRepo (alle Apps):**
```bash
bun dev  # Startet Frontend und Backend parallel
```

**Option 2 - Einzeln:**

*Backend:*
```bash
cd apps/api/backend
uv run uvicorn main:app --reload --port 8000
```

*Frontend:*
```bash
cd apps/web
bun dev
```

### Mit Docker Compose

```bash
# Umgebungsvariablen setzen (oder in .env Datei)
export PAPERLESS_URL=http://your-paperless:8000
export PAPERLESS_TOKEN=your-token
export MISTRAL_API_KEY=your-key
export OLLAMA_URL=http://host.docker.internal:11434

# Alle Services starten
docker compose up -d

# Logs anzeigen
docker compose logs -f
```

> 💡 **Hinweis**: Für den Zugriff auf Ollama auf dem Host-System verwende `host.docker.internal`. Dies funktioniert auf allen Plattformen (Linux, macOS, Windows) dank der `extra_hosts` Konfiguration in docker-compose.yml.

## Workflow

Der Verarbeitungs-Workflow wird über Tags gesteuert:

| Phase | Input-Tag | Output-Tag | Beschreibung |
|-------|-----------|------------|--------------|
| OCR | `llm-pending` | `llm-ocr-done` | Mistral AI OCR |
| Titel | `llm-ocr-done` | `llm-title-done` | Titel generieren |
| Korrespondent | `llm-title-done` | `llm-correspondent-done` | Korrespondent zuweisen |
| Tags | `llm-correspondent-done` | `llm-tags-done` | Tags zuweisen |
| Complete | `llm-tags-done` | `llm-processed` | Fertig |

## API Endpoints

### Settings
- `GET /api/settings` - Aktuelle Einstellungen
- `PATCH /api/settings` - Einstellungen aktualisieren
- `POST /api/settings/test-connection/{service}` - Verbindung testen

### Documents
- `GET /api/documents/queue` - Queue-Statistiken
- `GET /api/documents/pending` - Wartende Dokumente
- `GET /api/documents/{id}` - Dokument-Details

### Processing
- `POST /api/processing/{id}/start` - Verarbeitung starten
- `GET /api/processing/{id}/stream` - SSE-Stream der LLM-Antworten
- `POST /api/processing/{id}/confirm` - Ergebnis bestätigen

### Prompts
- `GET /api/prompts` - Alle Prompts auflisten
- `GET /api/prompts/{name}` - Einzelner Prompt

## Projektstruktur

```
paperless_local_llm/
├── apps/
│   ├── web/                  # Vite + React Frontend
│   │   ├── src/
│   │   │   ├── routes/       # Seiten (Dashboard, Documents, etc.)
│   │   │   ├── components/   # App-spezifische Komponenten
│   │   │   ├── lib/          # API Client, i18n, Utilities
│   │   │   └── locales/      # Übersetzungen (en.json, de.json)
│   │   └── public/           # Statische Dateien
│   │
│   └── api/                  # Python FastAPI Backend
│       └── backend/
│           ├── main.py       # FastAPI App
│           ├── config.py     # Konfiguration (liest config.yaml)
│           ├── routers/      # API Routes
│           ├── services/     # Paperless, Qdrant Clients
│           ├── agents/       # LangGraph Agents
│           ├── models/       # Pydantic Models
│           ├── prompts/      # Prompt Templates
│           └── worker.py     # Background Worker
│
├── packages/
│   └── ui/                   # Shared shadcn/ui Komponenten
│       ├── src/              # Button, Dialog, Card, etc.
│       └── lib/utils.ts      # cn() Helper
│
├── turbo.json                # TurboRepo Konfiguration
├── config.example.yaml       # Beispiel-Konfiguration
├── docker-compose.yml        # Docker Setup
└── README.md
```

## Tech Stack

**Frontend:**
- Vite 7
- React 19
- React Router
- TailwindCSS 4
- shadcn/ui + Hugeicons
- react-i18next

**Backend:**
- Python 3.12
- FastAPI
- LangGraph + LangChain
- Pydantic

**Build System:**
- TurboRepo (Monorepo)
- Bun (Package Manager)

**External:**
- Paperless-ngx
- Ollama (beliebige Modelle)
- Mistral AI (OCR)
- Qdrant Vector DB

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
