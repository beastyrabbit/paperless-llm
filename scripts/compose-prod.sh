#!/bin/sh
set -eu

node scripts/check-required-env.mjs \
  APP_VERSION \
  PAPERLESS_URL \
  PAPERLESS_TOKEN \
  MISTRAL_API_KEY \
  OLLAMA_URL \
  QDRANT_URL \
  PAPERLESS_LLM_API_TOKEN

if [ "${1:-}" = "--" ]; then
  shift
fi

exec docker compose "$@"
