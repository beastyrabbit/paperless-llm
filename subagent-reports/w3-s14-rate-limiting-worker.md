# W3-S14 Request Rate Limiting Worker Handoff

## Implemented
- Added an in-process fixed-window backend request rate limiter in `apps/backend/src/server.ts`.
- The limiter is created per HTTP server instance and runs after CORS/preflight handling but before auth, read-only checks, SSE setup, body parsing, and route dispatch.
- Added structured HTTP 429 responses with `status`, `error`, `message`, and `requestId`.
- Added `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on rate-limited requests.
- Exempted `OPTIONS` preflight and `/health`; SSE connection attempts are counted once at initial request setup.
- Added proxy-aware client identity only when explicitly enabled.

## Changed files
- `apps/backend/src/server.ts`
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `apps/backend/src/config/yaml-loader.ts`
- `apps/backend/tests/server.test.ts`
- `apps/backend/tests/config/config.test.ts`
- `config.example.yaml`
- `.env.example`
- `progress.md`

## Config
New `http` config fields:
- `rateLimitEnabled` / YAML `rate_limit_enabled` / env `PAPERLESS_LLM_RATE_LIMIT_ENABLED`
- `rateLimitWindowMs` / YAML `rate_limit_window_ms` / env `PAPERLESS_LLM_RATE_LIMIT_WINDOW_MS`
- `rateLimitMaxRequests` / YAML `rate_limit_max_requests` / env `PAPERLESS_LLM_RATE_LIMIT_MAX_REQUESTS`
- `rateLimitTrustProxy` / YAML `rate_limit_trust_proxy` / env `PAPERLESS_LLM_RATE_LIMIT_TRUST_PROXY`

Defaults:
- enabled: `true`
- window: `60000` ms
- max requests: `300`
- trust proxy headers: `false`

## Tests
Added focused tests for:
- max-request boundary and rejection
- window reset
- separate client counters
- disabled limiter
- proxy header trust behavior
- `OPTIONS` and `/health` bypass behavior
- structured HTTP 429 response before route dispatch
- YAML/env config loading for rate limit fields

## Validation
Passed:
- `pnpm --filter @repo/backend test -- tests/server.test.ts tests/config/config.test.ts`
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`

Note: the targeted test run emits an existing stderr line about failing to obtain server version during one server test, but all tests pass.

## Remaining risks
- Limiting is per backend process and in-memory; quotas are not shared across multiple backend instances.
- If the backend is behind the Next.js proxy or another reverse proxy, default socket-IP limiting may group users by proxy IP. Enable `rateLimitTrustProxy` only when trusted infrastructure sets forwarded headers.
- Invalid non-positive numeric config values are normalized at limiter construction to safe defaults rather than failing config validation.
