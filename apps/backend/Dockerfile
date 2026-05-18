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

ENV NODE_ENV=production
ENV PORT=8765

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

# Copy deployed bundle (includes all dependencies flattened)
COPY --from=builder /app/deploy/node_modules ./node_modules
COPY --from=builder /app/deploy/package.json ./
COPY --from=builder /app/apps/backend/dist ./dist

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R backend:nodejs /app/data

USER backend

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8765/health || exit 1

CMD ["node", "dist/index.js"]
