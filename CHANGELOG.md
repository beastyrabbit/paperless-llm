# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-06

### Added

- **OCR Processing**: Mistral AI integration for high-quality text recognition
- **Automatic Metadata Extraction**: LLM-powered title, correspondent, and tag assignment
- **Confirmation Loop**: Large model analysis → small model verification → retry or user queue
- **Vector Search**: Similar document context via Qdrant for improved accuracy
- **Tag-based Workflow**: Independent processing steps with state tracking
- **Live Streaming**: Real-time LLM responses in the frontend
- **Multi-language Support**: English and German UI with next-intl
- **Auto-processing Worker**: Background processing of pending documents
- **Manual Review Queue**: UI for reviewing and correcting LLM suggestions
- **Prompt Templates**: Customizable markdown prompts for each processing step
- **Docker Support**: Full Docker Compose setup with Qdrant included
- **Pre-commit Hooks**: Code quality enforcement with ruff, mypy, eslint, gitleaks

### Technical Stack

- Frontend: Next.js 16, React 19, TailwindCSS 4, shadcn/ui
- Backend: FastAPI, LangGraph, LangChain
- External: Paperless-ngx, Ollama, Mistral AI, Qdrant
