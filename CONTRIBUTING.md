# Contributing to Paperless Local LLM

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) - JavaScript runtime for the frontend
- [uv](https://github.com/astral-sh/uv) - Python package manager for the backend
- Docker & Docker Compose (optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/paperless-local-llm.git
cd paperless-local-llm

# Frontend setup
bun install

# Backend setup
cd backend
uv sync

# Install pre-commit hooks
uv run pre-commit install
```

### Running Locally

```bash
# Terminal 1: Backend
cd backend
uv run uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
bun dev
```

## Code Style

This project uses pre-commit hooks to enforce code quality. The hooks run automatically on commit, but you can also run them manually:

```bash
cd backend
uv run pre-commit run --all-files
```

### Active Checks

- **gitleaks**: Detects accidentally committed secrets/API keys
- **ruff**: Python linting & formatting
- **mypy**: Python type checking
- **TypeScript**: `tsc --noEmit` for type safety
- **ESLint**: JavaScript/TypeScript linting

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. Make your changes
4. Ensure pre-commit hooks pass
5. Commit with a clear message:
   ```bash
   git commit -m "feat: add new feature"
   ```
6. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
7. Open a Pull Request against `main`

### Commit Message Format

We follow conventional commits:

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Reporting Issues

When reporting issues, please include:

1. A clear description of the problem
2. Steps to reproduce
3. Expected vs. actual behavior
4. Environment details (OS, Python version, Node version)
5. Relevant logs or error messages

## Questions?

Feel free to open an issue for questions or discussions about the project.
