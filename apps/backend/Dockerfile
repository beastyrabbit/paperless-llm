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

# Copy backend package.json
COPY apps/backend/package.json ./apps/backend/

# Install all dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Copy backend source
COPY apps/backend ./apps/backend

# Build TypeScript
RUN pnpm --filter=@repo/backend build

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

CMD ["node", "dist/index.js"]
