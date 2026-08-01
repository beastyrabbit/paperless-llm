# Stage 1: Base with pnpm
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Stage 2: Dependencies and Build
FROM base AS builder
WORKDIR /app

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy backend and internal package manifests
COPY apps/backend/package.json ./apps/backend/
COPY packages/api-contracts/package.json ./packages/api-contracts/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install all dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy backend and internal package source
COPY packages/api-contracts ./packages/api-contracts
COPY packages/typescript-config ./packages/typescript-config
COPY apps/backend ./apps/backend

# Build TypeScript, including workspace dependencies that backend imports at runtime
RUN pnpm --filter=@repo/api-contracts build && pnpm --filter=@repo/backend build

# Use pnpm deploy to create isolated production bundle
RUN pnpm --filter=@repo/backend deploy --prod /app/deploy

# Stage 3: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ARG CODEX_CLI_VERSION=0.145.0

ENV NODE_ENV=production
ENV PORT=8765
ENV CODEX_HOME=/app/codex-home
ENV TMPDIR=/app/data/tmp
ENV PAPERLESS_LLM_TINYBASE_DATA_DIR=/app/data/tinybase
ENV PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR=/app/data/operational-ledger
ENV PAPERLESS_LLM_BACKEND_WRITER_LOCK_DIR=/app/data/backend-writer.lock

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend && \
    mkdir -p \
      /app/codex-home \
      /app/data \
      /app/data/tinybase \
      /app/data/operational-ledger \
      /app/data/tmp && \
    chown -R backend:nodejs /app/data /app/codex-home && \
    chmod 0700 /app/data /app/codex-home /app/data/tinybase /app/data/operational-ledger /app/data/tmp

# Runtime tools: OCRmyPDF/Tesseract for local OCR capability checks and
# pinned Codex CLI for isolated structured-output runs.
RUN apk add --no-cache \
      ghostscript \
      ocrmypdf \
      qpdf \
      tesseract-ocr \
      tesseract-ocr-data-deu \
      tesseract-ocr-data-eng \
    && npm install --global "@openai/codex@${CODEX_CLI_VERSION}" \
    && codex --version \
    && ocrmypdf --version \
    && tesseract --version

# Copy deployed bundle (includes all dependencies flattened)
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./
COPY --from=builder /app/apps/backend/dist ./dist
COPY apps/backend/docker-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

# Create data directory with proper permissions
RUN chmod 0755 /usr/local/bin/backend-entrypoint.sh && \
    chown -R backend:nodejs /app/data /app/codex-home && \
    chmod 0700 /app/data /app/codex-home /app/data/tinybase /app/data/operational-ledger /app/data/tmp

USER backend

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8765/health || exit 1

ENTRYPOINT ["backend-entrypoint.sh"]
CMD ["node", "dist/index.js"]
