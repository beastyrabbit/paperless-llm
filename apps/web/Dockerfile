# Build stage
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy workspace configuration
COPY package.json bun.lock turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/ui/package.json ./packages/ui/

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source files
COPY packages/ui ./packages/ui
COPY apps/web ./apps/web

# Build the frontend
WORKDIR /app/apps/web
RUN bun run build

# Production stage with nginx
FROM nginx:alpine AS runner

# Copy nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from builder
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Expose port
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
