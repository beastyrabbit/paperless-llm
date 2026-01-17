# Makefile for Paperless Local LLM

# Auto-detect version from git tags
VERSION := $(shell git describe --tags --always 2>/dev/null || echo "dev")

.PHONY: build build-frontend build-backend up down logs clean

# Build all services with version tag
build:
	docker compose build --build-arg APP_VERSION=$(VERSION)

# Build only frontend with version tag
build-frontend:
	docker compose build --build-arg APP_VERSION=$(VERSION) frontend

# Build only backend
build-backend:
	docker compose build backend

# Start all services
up:
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

# Show current version
version:
	@echo "Version: $(VERSION)"
