# Makefile for Paperless Local LLM

# Auto-detect version from git tags
VERSION := $(shell git describe --tags --always 2>/dev/null || echo "dev")

.PHONY: build build-frontend build-backend up down logs clean version refresh-version

# Generate .env file with version (used by docker-compose automatically)
.env:
	@echo "APP_VERSION=$(VERSION)" > .env
	@echo "Generated .env with APP_VERSION=$(VERSION)"

# Build all services with version tag (auto-generates .env)
build: .env
	docker compose build

# Build only frontend with version tag
build-frontend: .env
	docker compose build frontend

# Build only backend
build-backend:
	docker compose build backend

# Start all services (auto-generates .env)
up: .env
	docker compose up -d

# Stop all services
down:
	docker compose down

# View logs
logs:
	docker compose logs -f

# Clean up containers and volumes
clean:
	docker compose down -v
	rm -f .env

# Show current version
version:
	@echo "Version: $(VERSION)"

# Force regenerate .env
refresh-version:
	@echo "APP_VERSION=$(VERSION)" > .env
	@echo "Refreshed .env with APP_VERSION=$(VERSION)"
