# Stage 1: Base with pnpm
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Stage 2: Dependencies
FROM base AS deps
WORKDIR /app

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy backend package.json for workspace resolution
COPY apps/backend/package.json ./apps/backend/

# Install dependencies with cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter=@repo/backend

# Stage 3: Builder
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./

# Copy backend source
COPY apps/backend ./apps/backend

# Build TypeScript
RUN pnpm --filter=@repo/backend build

# Stage 4: Production Runner
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8765

# Security: non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 backend

# Copy built artifacts
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/package.json ./
COPY --from=builder /app/apps/backend/node_modules ./node_modules

# Create data directory with proper permissions
RUN mkdir -p /app/data && chown -R backend:nodejs /app/data

USER backend

EXPOSE 8765

CMD ["node", "dist/index.js"]
