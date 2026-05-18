# Todo #10 / W3-S14 — Request rate limiting implementation handoff

## Scope / goal
Add backend request rate limiting to the TypeScript HTTP server. The implementation should be small, dependency-light (prefer no new dependency), configurable via existing config/env patterns, and covered by focused unit tests. This report is implementation-ready; no code was edited during this inspection.

## High-value code context

### Backend HTTP entrypoint: `apps/backend/src/server.ts`
- Imports Node `http` and creates the server directly; no Express/Fastify middleware stack exists (`server.ts:5-7`, `server.ts:535`).
- Current request pipeline in `createServer`:
  1. Generate request ID and logger (`server.ts:535-544`).
  2. Set `X-Request-Id`; completion logging on `finish` (`server.ts:544-550`).
  3. Set CORS headers (`server.ts:552`).
  4. Short-circuit OPTIONS preflight with 204 (`server.ts:554-559`).
  5. Auth check; unauthorized returns JSON 401 (`server.ts:561-567`).
  6. Prod read-only check; blocked requests return JSON 403 (`server.ts:569-575`).
  7. SSE route handling for processing/cases/catalog streams (`server.ts:577-680`).
  8. Parse request body, run `handleRequest`, serialize JSON/binary (`server.ts:682-716`).
  9. Request parsing/error handling for 413/400/500 (`server.ts:717-760`).
- Existing security helpers are exported and unit-tested: `getTrustedUiOrigins`, `isAuthorized`, `isProdReadOnlyMode`, `isReadOnlyRequestAllowed`, `sanitizeHeadersForLog` (`server.ts:30-36`, `server.ts:139-178`, `server.ts:180+`).
- Request body size limit already exists as in-memory constant `MAX_BODY_SIZE = 10 * 1024 * 1024` (`server.ts:26-27`). Rate limiting can follow the same lightweight/server-local pattern.
- SSE endpoints are handled before body parsing and can hold long-lived sockets (`server.ts:580-591`, `server.ts:594-638`, `server.ts:640-679`). Rate limiting needs an explicit decision for these paths.

### API router: `apps/backend/src/api/index.ts`
- Router is Effect-based and receives already-parsed body (`api/index.ts:773-777`).
- Route matching starts inside `handleRequest` (`api/index.ts:785-793`).
- Rate limiting should be outside `handleRequest`, in `server.ts`, because it needs IP/client identity, headers, and must short-circuit before expensive body parsing/Effect runtime work.

### Backend config: `apps/backend/src/config/*`
- HTTP/runtime safety config is already a section in the schema:
  - `HttpConfigSchema` contains `requestTimeoutMs`, `agentPromptTimeoutMs`, `mistralRetryAttempts`, `mistralRetryBaseDelayMs` (`config/schema.ts:79-85`).
  - `ResolvedConfig.http` mirrors those fields (`config/schema.ts:173-178`).
- Defaults are in `apps/backend/src/config/index.ts`:
  - `defaultConfig.http` currently sets request/agent timeouts and Mistral retry settings (`config/index.ts:74-79`).
  - Defaults are merged with partial config at `applyDefaults` (`config/index.ts:136-139`).
- YAML normalization supports snake_case -> camelCase for `http` fields (`config/yaml-loader.ts:91-102`). Add new rate limit snake_case mappings here if config-driven.
- Env config uses `parseEnvNumber` and reads `PAPERLESS_LLM_HTTP_TIMEOUT_MS`, etc. into `http` (`config/yaml-loader.ts:268-275`). Add rate-limit env variables here.
- Existing config tests are in `apps/backend/tests/config/config.test.ts`; they create temp YAML files, adjust env, and assert `makeConfigService()` output (`config.test.ts:22-147`).

### Existing tests
- `apps/backend/tests/server.test.ts` unit-tests exported server helpers and env behavior (`server.test.ts:1-92`). This is the best home for rate-limiter helper tests.
- No existing tests instantiate `createHttpServer` or issue real HTTP requests (`grep` found no `createHttpServer`, `listen(`, `fetch(` in backend tests). Keep tests helper-level unless a later agent wants a heavier integration test.
- Backend package scripts: `pnpm --filter @repo/backend test`, `typecheck`, `lint`, `build` are available (`apps/backend/package.json:6-15`).

### Docs/examples to update if implementation includes config knobs
- `config.example.yaml` has a `http:` section under Runtime Safety (`config.example.yaml:120-124`). Add commented/default rate limiting knobs there.
- `.env.example` currently has no rate limit vars. If adding env knobs, add a small optional section.
- Web proxy exists at `apps/web/app/api/[...path]/route.ts` and forwards all `/api/*` to the backend (`route.ts:55-98`). Backend rate limiting will see the proxy/server IP unless the frontend preserves/sets forwarded headers. The proxy currently clones request headers and removes only `connection`, `content-length`, `host` (`route.ts:64-70`), so incoming `x-forwarded-for` may pass through if supplied by deployment. Do not rely on user-supplied forwarded headers unless trust is explicit.

## Minimal recommended design

### Algorithm
Use an in-process fixed-window or token-bucket limiter keyed by client identity. For this app, a fixed window is sufficient and simpler:

- Store `Map<string, { windowStartMs: number; count: number }>`.
- Config: `enabled`, `windowMs`, `maxRequests`, and optionally `trustProxy` / forwarded-header behavior.
- On each request:
  - If disabled, allow.
  - If public preflight `OPTIONS`, allow without counting (recommended; avoids breaking browser CORS preflight).
  - Build a key from client IP (see below).
  - If current time moved past the window, reset count/window.
  - Increment count; allow if `count <= maxRequests`.
  - If exceeded, return HTTP `429` JSON with `status: 429`, `error: "Too Many Requests"`, `message`, and `requestId`.
  - Set `Retry-After` seconds (ceil remaining window / 1000), and ideally `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Add opportunistic cleanup to prevent unbounded Map growth (e.g. delete entries whose window ended more than one window ago every N checks or when size grows above threshold).

### Placement in `server.ts`
Place the check after request ID/CORS/preflight and before auth/read-only/SSE/body parsing:

- Keep OPTIONS preflight before rate limit (`server.ts:554-559`).
- Then check rate limit before auth (`server.ts:561-567`) so unauthorized brute-force/API probing is limited too.
- This means `/` and `/health` can be rate-limited unless explicitly exempted. Safer minimal approach: exempt `isPublicPath(url.pathname)` or at least `/health` so orchestrators/health checks do not consume quota.
- Rate-limit SSE connection attempts. Do not count periodic SSE writes; only the initial GET is counted because the check occurs before stream handling. This protects expensive stream setup without cutting off active streams mid-flight.

### Client identity / proxy edge
Minimal safe identity function:

- Default: use `req.socket.remoteAddress ?? "unknown"`.
- If an explicit config/env flag like `trustProxy` is true, use `x-forwarded-for` first IP or `x-real-ip`, falling back to socket address.
- Do **not** trust forwarded headers by default because clients can spoof them when the backend is directly reachable.
- Normalize IPv6-mapped IPv4 if desired (`::ffff:127.0.0.1` -> `127.0.0.1`) for stable tests/logs.

### Config shape
Prefer extending existing `http` section rather than a new top-level section:

```ts
http: {
  requestTimeoutMs: number;
  agentPromptTimeoutMs: number;
  mistralRetryAttempts: number;
  mistralRetryBaseDelayMs: number;
  rateLimitEnabled: boolean;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  rateLimitTrustProxy: boolean;
}
```

Suggested conservative defaults:
- `rateLimitEnabled: true`
- `rateLimitWindowMs: 60_000`
- `rateLimitMaxRequests: 120` (or 300 if UI polling/SSE traffic is heavy; choose one and document it)
- `rateLimitTrustProxy: false`

Env names to add in `yaml-loader.ts`:
- `PAPERLESS_LLM_RATE_LIMIT_ENABLED` -> boolean parser (add helper similar to existing truthy handling; current env booleans are exact `=== "true"` in places)
- `PAPERLESS_LLM_RATE_LIMIT_WINDOW_MS`
- `PAPERLESS_LLM_RATE_LIMIT_MAX_REQUESTS`
- `PAPERLESS_LLM_RATE_LIMIT_TRUST_PROXY`

YAML snake_case names to normalize in `normalizeYamlConfig`:
- `rate_limit_enabled`
- `rate_limit_window_ms`
- `rate_limit_max_requests`
- `rate_limit_trust_proxy`

Consider validation/refinement for positive numbers. Current schema uses plain `Schema.Number.pipe(Schema.optional)` and does not reject negatives, so minimal change can match existing style; better change can clamp/validate in limiter construction.

### Exports for testing
Export pure helpers from `server.ts` rather than trying to start the full server:

- `createRateLimiter(config, now?)` or `checkRateLimit(state, request, config, now)`.
- `getClientIp(req, trustProxy)`.
- Possibly `rateLimitRejection(requestId, result)` if testing response shape.

Keep state local to `createHttpServer` so tests can create isolated limiter instances and runtime behavior does not leak across servers.

## Edge cases to handle
- Disabled limiter must always allow and should not mutate state.
- `OPTIONS` preflight should bypass and return current 204 behavior.
- `/health` should be exempt or given separate high limit; otherwise health checks can cause self-inflicted 429s.
- Multiple clients should have independent counters.
- Boundary behavior: exactly `maxRequests` allowed; `maxRequests + 1` rejected.
- Window reset after `windowMs` should allow again and reset remaining count.
- `Retry-After` must be at least `1` while blocked; avoid `0` due to rounding.
- Invalid/zero/negative env values: decide whether config validation fails fast or limiter falls back to safe defaults. Document and test whichever approach is chosen.
- Trust-proxy disabled: ignore spoofed `x-forwarded-for`.
- Trust-proxy enabled: choose first address in comma-separated `x-forwarded-for` and trim whitespace; handle array header values defensively.
- SSE: rate limit initial stream request only. Do not terminate already-open streams.
- Memory cleanup: stale client entries should eventually be removed.
- Auth failures should be rate-limited too if limiter is before auth.

## Tests to add/update

### `apps/backend/tests/server.test.ts`
Add tests alongside existing server security helper tests:
- Allows first `maxRequests` and rejects the next with metadata/status.
- Resets after the configured window.
- Tracks separate clients independently.
- Disabled limiter allows unlimited requests.
- `getClientIp` ignores `x-forwarded-for` unless `trustProxy` is true.
- When `trustProxy` is true, uses first forwarded IP.
- If implementing exemptions as a helper, test `OPTIONS` and `/health` bypass.

Use simple mock request objects like existing `makeRequest`; include `socket: { remoteAddress: "1.2.3.4" }` if needed.

### `apps/backend/tests/config/config.test.ts`
Add a config test that writes YAML:

```yaml
http:
  rate_limit_enabled: false
  rate_limit_window_ms: 30000
  rate_limit_max_requests: 10
  rate_limit_trust_proxy: true
```

Then assert resolved `service.config.http.rateLimitEnabled === false`, etc. Add an env override test if env variables are included.

### Optional integration test
Given no current server integration tests exist, do not require this for minimal implementation. If added, it will need a way to avoid full `AppLayer` external startup side effects; helper-level tests are likely enough.

## Files likely to edit
1. `apps/backend/src/config/schema.ts`
   - Add rate limit fields to `HttpConfigSchema` and `ResolvedConfig.http`.
2. `apps/backend/src/config/index.ts`
   - Add defaults under `defaultConfig.http`.
3. `apps/backend/src/config/yaml-loader.ts`
   - Normalize snake_case YAML fields.
   - Parse env vars for rate limiting.
   - Possibly add a reusable env boolean parser.
4. `apps/backend/src/server.ts`
   - Add rate limiter helpers and response shape.
   - Instantiate limiter inside `createHttpServer` using `ConfigService` from the runtime (or load config once via runtime) before serving requests.
   - Insert check after preflight and before auth/read-only/SSE/body parsing.
5. `apps/backend/tests/server.test.ts`
   - Helper tests.
6. `apps/backend/tests/config/config.test.ts`
   - YAML/env mapping tests.
7. `config.example.yaml`
   - Document default knobs in `http:` section.
8. `.env.example`
   - Optional env var docs.

## Implementation risk / design notes
- `createHttpServer` builds an Effect runtime (`server.ts:196-203`) but the request callback is async Node-style. To read config for rate limiting, simplest is to resolve config once during server creation with `yield* ConfigService` (it is already imported in `server.ts:14`) before `createServer(...)`, then create the limiter from `configService.config.http`. This avoids per-request Effect calls.
- Be careful not to instantiate global limiter state at module scope; tests and multiple server instances need isolation.
- If `rateLimitEnabled` defaults true, tests that call helpers only are unaffected. Real dev server behavior changes; choose a generous default to avoid breaking UI polling.
- The frontend proxy may hide the real user IP. If deploying behind Next.js proxy, rate limiting by backend socket may group all UI users together unless trust-proxy is enabled and infrastructure sets `X-Forwarded-For` reliably.
- Biome may enforce formatting; run lint after edits.

## Validation commands
Run from repo root:

```bash
pnpm --filter @repo/backend test -- tests/server.test.ts tests/config/config.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend build
```

If command filtering by test path does not work with pnpm/vitest in this workspace, run:

```bash
pnpm --filter @repo/backend test
```

## Compact worker prompt
Implement backend request rate limiting. Use the existing Node HTTP server in `apps/backend/src/server.ts` (no Express middleware) and existing config system under `apps/backend/src/config`. Add configurable `http.rateLimitEnabled`, `rateLimitWindowMs`, `rateLimitMaxRequests`, and `rateLimitTrustProxy` with defaults, YAML snake_case normalization, and env vars (`PAPERLESS_LLM_RATE_LIMIT_*`). Add an in-process per-client fixed-window limiter keyed by `req.socket.remoteAddress` unless `rateLimitTrustProxy` is true, in which case use first `x-forwarded-for`/`x-real-ip`. Exempt OPTIONS preflight and preferably `/health`; rate-limit before auth/read-only/body parsing so expensive/unauthorized requests are limited. Return JSON 429 with `requestId`, `Retry-After`, and rate-limit headers. Export pure helpers for tests; keep limiter state per server instance. Add focused tests in `apps/backend/tests/server.test.ts` and config tests in `apps/backend/tests/config/config.test.ts`; update `config.example.yaml` and `.env.example`. Validate with backend test/typecheck/lint/build commands above.