# Todo #26 / W3-S16 — health checks handoff

## Current state

- `GET /health` is a shallow static route in `apps/backend/src/api/index.ts:221`:
  ```ts
  addRoute("GET", "/health", () => Effect.succeed({ status: "healthy" }));
  ```
- Root endpoint is nearby at `apps/backend/src/api/index.ts:213-219` and returns `{ name, version, status: "running" }`.
- Router matching returns plain objects; unmatched routes return `{ status: 404, ... }` from `apps/backend/src/api/index.ts:787-792`.
- The HTTP server derives the actual HTTP status code only from a numeric `result.status` field (`apps/backend/src/server.ts:835-844`). String `status` values always emit HTTP 200.
- `/health` is public and bypasses rate limiting:
  - `isPublicPath` includes `/health` at `apps/backend/src/server.ts:134`.
  - `shouldBypassRateLimit` bypasses `/health` at `apps/backend/src/server.ts:227-228`.
- Docker uses `GET /health` as the container health check (`apps/backend/Dockerfile:57-58`), so the HTTP status matters more than the body for deployment health.

## Existing service probes / connection checks

### Settings handlers: richer messages but not all safe for health
`apps/backend/src/api/settings/handlers.ts:373-535` contains user-facing connection tests that read TinyBase settings over config fallbacks.

- Paperless (`testPaperlessConnection`, lines 373-409):
  - Requires `paperless.url` and `paperless.token` (`381-383`).
  - Fetches `${url}/api/documents/?page_size=1` with `Authorization: Token ...` (`385-391`).
  - Returns `{ status: "success"|"error", message, details: null }`.
- Ollama (`testOllamaConnection`, lines 411-446):
  - Requires `ollama.url` (`416-420`).
  - Fetches `${url}/api/tags` (`422-428`).
- Mistral (`testMistralConnection`, lines 448-483):
  - Requires `mistral.api_key` (`453-457`).
  - Fetches `${normalizeBaseUrl(config.config.mistral.apiBaseUrl ?? "https://api.mistral.ai")}/v1/models` with bearer token (`459-464`).
  - Note: this handler does **not** read `mistral.api_base_url` / `mistral.apiBaseUrl` from TinyBase, while `MistralService` does.
- Qdrant (`testQdrantConnection`, lines 485-535+):
  - Requires `qdrant.url` (`491-503`).
  - Fetches `${url}/collections` (`506-512`).
  - Then calls `qdrant.ensureCollection()` (`533-535`), which can create a collection/indexes. This is not ideal for `/health` because health should be read-only.

### Service-level `testConnection()` probes: good fit for health, but boolean-only
Existing service probes are read-only and dynamically read TinyBase settings where applicable, but they swallow error details into `false`:

- `PaperlessService.testConnection()` (`apps/backend/src/services/PaperlessService.ts:1210-1215`): calls `GET /documents/?page_size=1` through the service request helper and returns boolean.
  - The request helper reads TinyBase settings with config fallback (`273-285`), normalizes Paperless URL, requires URL+token (`310-315`), and sends `Accept: application/json; version=10` plus token auth (`327-338`).
- `OllamaService.testConnection()` (`apps/backend/src/services/OllamaService.ts:521-526`): calls `GET /api/tags` through the service request helper and returns boolean.
  - Config comes from TinyBase/settings fallback at `145-160`.
- `MistralService.testConnection()` (`apps/backend/src/services/MistralService.ts:292-297`): calls `GET /v1/models` and returns boolean.
  - Config reads TinyBase `mistral.api_key`, `mistral.model`, `mistral.api_base_url` / `mistral.apiBaseUrl`, with default `https://api.mistral.ai` (`100-143`).
- `QdrantService.testConnection()` (`apps/backend/src/services/QdrantService.ts:252-258`, surrounding code): calls `client.getCollections()` and returns boolean; does not ensure/create a collection.
  - Qdrant config reads TinyBase URL/collection fallbacks at `103-118` and constructs a REST client from URL.
  - `ensureCollection()` (`260-297`) is mutating and should not be used by `/health`.

## Relevant contracts and tests

- API `ConnectionTest` contract is in `packages/api-contracts/src/types.ts:53-60` with `status: "success" | "warning" | "connected" | "error"`, `message`, `details`, etc. There is no health contract today.
- Router tests currently assert the shallow health shape:
  - `apps/backend/tests/api/router.test.ts:53-60`: `GET /health` returns `{ status: "healthy" }`.
  - `apps/backend/tests/api/router.test.ts:76-84`: `POST /health` is 404.
  - `apps/backend/tests/api/router.test.ts:145-153`: `/health/` is 404.
- Settings connection tests already mock fetch for Paperless/Ollama/Mistral/Qdrant in `apps/backend/tests/api/settings.test.ts:322-481`; these can be copied/adapted for health probes if direct fetch-style tests are used.
- Server behavior tests include:
  - Read-only mode allows `HEAD /health` (`apps/backend/tests/server.test.ts:212-215`), but the router only registers `GET /health`.
  - Rate limit bypass for `GET /health` (`apps/backend/tests/server.test.ts:326-329`).

## Recommended endpoint shape

Use a health-specific response shape rather than reusing `ConnectionTest` verbatim. Suggested body:

```ts
type HealthCheckStatus = "up" | "down";
type OverallHealth = "healthy" | "unhealthy";

interface HealthResponse {
  // Numeric to drive existing server HTTP status logic.
  status: 200 | 503;
  health: OverallHealth;
  timestamp: string;
  durationMs: number;
  services: {
    paperless: { status: HealthCheckStatus; required: true; durationMs: number; message?: string };
    ollama: { status: HealthCheckStatus; required: true; durationMs: number; message?: string };
    qdrant: { status: HealthCheckStatus; required: true; durationMs: number; message?: string };
    mistral: { status: HealthCheckStatus; required: true; durationMs: number; message?: string };
  };
}
```

Rationale:
- Existing server already emits non-200 only when `result.status` is numeric (`server.ts:837-843`), so `status: 503` is the lowest-friction way to make Docker and orchestrators see an unhealthy app.
- Preserve a human-readable `health` field because `status` can no longer be the old string if it is used for HTTP status.
- Avoid returning secrets, URLs with tokens, stack traces, or raw error objects.

Alternative if backward compatibility of `status: "healthy"` is mandatory: add server support for an `httpStatus` field or special-case `/health`, then return `{ status: "healthy" | "unhealthy", httpStatus: 200 | 503, ... }`. This is cleaner API design but requires touching `server.ts` and tests beyond the route/handler.

## HTTP status decision points

Implementation-ready recommendation:

- HTTP 200 / `health: "healthy"` only when all four required probes are `up`.
- HTTP 503 / `health: "unhealthy"` when any required service is `down`, missing config makes the service probe false, or a probe defects/fails.
- Do not let one failed probe short-circuit the rest; return all per-service statuses to aid operations.
- Keep `POST /health` and `/health/` as 404 unless explicitly required otherwise.
- Keep `/health` public and rate-limit-bypassed.
- Health should be read-only: do **not** call `settingsHandlers.testQdrantConnection` because it can call `ensureCollection()` and create resources.

## Suggested implementation approach

1. Add a small health handler near the route or as `apps/backend/src/api/health/handlers.ts`.
2. In the handler, acquire `PaperlessService`, `OllamaService`, `QdrantService`, `MistralService` from Effect context.
3. Run the four service `testConnection()` effects, preferably concurrently with Effect utilities. Wrap each with `Effect.either`/`catchAll` so all checks complete and failures become `{ status: "down" }`.
4. Measure per-check duration and total duration with `Date.now()` or `Effect.Clock` if preferred.
5. Return numeric `status: 200 | 503` plus `health` and `services` as above.
6. Update `addRoute("GET", "/health", ...)` in `apps/backend/src/api/index.ts:221` to call the new handler.
7. Update tests that call `handleRequest` for `/health` to provide mock service layers, since `/health` will no longer be dependency-free.

Potential service mock shape for tests:
```ts
Layer.succeed(PaperlessService, { testConnection: () => Effect.succeed(true) } as PaperlessService)
Layer.succeed(OllamaService, { testConnection: () => Effect.succeed(true) } as OllamaService)
Layer.succeed(QdrantService, { testConnection: () => Effect.succeed(true) } as QdrantService)
Layer.succeed(MistralService, { testConnection: () => Effect.succeed(true) } as MistralService)
```

## Risks / constraints

- **HTTP status vs body `status` conflict:** current server only uses numeric `result.status` for HTTP code. Decide whether to accept `status: 200|503` in `/health` or add a new server convention such as `httpStatus`.
- **Qdrant mutation risk:** avoid settings handler for Qdrant; use `QdrantService.testConnection()` or direct `getCollections()` only.
- **Mistral external call latency/cost:** `GET /v1/models` is read-only but external. It uses the configured request timeout, currently defaulting to 120s; consider a shorter health timeout if the task scope permits. No current per-probe timeout helper exists besides `fetchWithTimeout` in service requests.
- **Tests needing Effect layers:** existing router `/health` test has no service dependencies. Once health probes use services, tests must provide layers or test the handler directly.
- **Public endpoint:** do not expose token, URL with credentials, raw error details, or stack traces.

## Validation plan

Targeted checks after implementation:

```bash
pnpm --filter @repo/backend test -- tests/api/router.test.ts
pnpm --filter @repo/backend test -- tests/api/settings.test.ts
pnpm --filter @repo/backend test -- tests/server.test.ts
pnpm --filter @repo/backend typecheck
```

If filter names differ, run from repo root with the project’s backend test command:
```bash
pnpm run test -- --run apps/backend/tests/api/router.test.ts apps/backend/tests/server.test.ts
pnpm run typecheck
```

Manual smoke checks with real services configured:
```bash
curl -i http://127.0.0.1:8765/health
# expect HTTP/1.1 200 when all four services are reachable
# stop one required service, then expect HTTP/1.1 503 and that service marked down
```

## Compact worker prompt

Implement `/health` as a real dependency health check for Paperless, Ollama, Qdrant, and Mistral. Current route is `apps/backend/src/api/index.ts:221` and returns `{ status: "healthy" }`; server HTTP status is controlled only by numeric `result.status` (`apps/backend/src/server.ts:837-843`). Use read-only service probes: `PaperlessService.testConnection()`, `OllamaService.testConnection()`, `QdrantService.testConnection()`, and `MistralService.testConnection()`. Do not call `settingsHandlers.testQdrantConnection` because it can create/ensure a collection. Return all service statuses in one response; do not short-circuit. Recommended response is `{ status: 200|503, health: "healthy"|"unhealthy", timestamp, durationMs, services: { paperless, ollama, qdrant, mistral } }`, with per-service `{ status: "up"|"down", required: true, durationMs, message? }`. Emit HTTP 200 only if all four are up; otherwise HTTP 503 via numeric `status`. Keep `/health` public/rate-limit-bypassed and keep wrong method/trailing slash behavior unchanged. Update router/server tests to provide mock service layers for `/health` and cover all-up and one-down cases; ensure no secrets/raw errors leak. Validate with backend router/server tests and typecheck.