FROM node:22-alpine AS build
WORKDIR /app
ENV CI=true LEFTHOOK=0
RUN apk add --no-cache python3 make g++ && corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY scripts/build.mjs scripts/build.mjs
COPY src src
RUN pnpm build && pnpm prune --prod --ignore-scripts

FROM node:22-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG APP_REVISION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION APP_REVISION=$APP_REVISION \
    PAPERLESS_LLM_CONFIG=/app/config.yaml PAPERLESS_LLM_DB=/app/data/paperless.db
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
VOLUME ["/app/data"]
EXPOSE 3765
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:${PORT:-3765}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/cli.js", "serve"]
