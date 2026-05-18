# Todo #26 / W3-S16 final handoff — dependency-aware health checks

No source files were edited for this handoff.

## Requirement

`docs/plans/audit-rework-tasks.md:305-318` defines W3-S16. Remaining health-specific acceptance: `/health` reports upstream dependency status for Paperless, Ollama, Qdrant, and Mistral.

OpenAPI work has landed; metrics source work has not landed in the current tree.

- OpenAPI/docs implemented in `subagent-reports/w3-s16-openapi-docs-worker.md` and coverage fixed in `subagent-reports/w3-s16-openapi-coverage-fix-worker.md`.
- Current code has `GET /openapi.json` and dev-gated `/api/docs`.
- `grep` found no `MetricsService`, `/metrics`, or `paperless_llm_` implementation under `apps/backend/src` as of this handoff, so health should not assume a metrics registry exists. If metrics lands first, health can optionally set dependency gauges, but this is not required for Todo #26.

## Current endpoint shape and behavior

### Current `/health`

`apps/backend/src/api/index.ts:214-227`:

```ts
// Health & Root
addRoute("GET", "/", () =>
  Effect.succeed({
    name: "Paperless Local LLM (TypeScript)",
    version: "0.1.0",
    status: "running",
  }),
);

addRoute("GET", "/health", () => Effect.succeed({ status: "healthy" }));

addRoute("GET", "/openapi.json", () => Effect.succeed(generateOpenApiDocument()));
```

HTTP status is controlled by a numeric `status` property in the JSON result. `apps/backend/src/server.ts:958-970` writes a non-200 only when `result.status` is a number from 100-599; string `status` values always produce HTTP 200.

```ts
if (typeof result === "object" && result !== null && "status" in result) {
  const status = (result as { status: unknown }).status;
  if (typeof status === "number" && status >= 100 && status < 600) {
    res.writeHead(status);
  } else {
    res.writeHead(200);
  }
} else {
  res.writeHead(200);
}
```

`/health` is public and bypasses rate limiting:

- `apps/backend/src/server.ts:208-209`: `isPublicPath` includes `/health` and dev-enabled docs paths.
- `apps/backend/src/server.ts:297-298`: `shouldBypassRateLimit` bypasses `/health` and OPTIONS.

Docker depends on HTTP status: `apps/backend/Dockerfile:57-58` runs `wget -qO- http://127.0.0.1:8765/health || exit 1`.

### Recommended final `/health` response

Use a health-specific response rather than `ConnectionTest`. Recommended shape:

```ts
type HealthDependencyStatus = "up" | "down";
type OverallHealth = "healthy" | "unhealthy";

interface HealthDependency {
  status: HealthDependencyStatus;
  required: true;
  durationMs: number;
  message?: string;
}

interface HealthResponse {
  // Numeric so existing server code emits the desired HTTP status.
  status: 200 | 503;
  health: OverallHealth;
  timestamp: string;
  durationMs: number;
  services: {
    paperless: HealthDependency;
    ollama: HealthDependency;
    qdrant: HealthDependency;
    mistral: HealthDependency;
  };
}
```

Semantics:

- HTTP 200 and `health: "healthy"` only when all four required dependencies are up.
- HTTP 503 and `health: "unhealthy"` if any dependency is down, missing config makes a probe fail, or a probe defects.
- Return all dependency statuses; do not short-circuit after the first failure.
- Keep `POST /health` and `/health/` as 404 unless explicitly changed.
- Do not include secrets, tokens, credential-bearing URLs, stack traces, raw errors, prompts, or raw response bodies.

Alternative shape if preserving `status: "healthy" | "unhealthy"` is required: add/teach server a separate `httpStatus` convention, then return `status` as the string and `httpStatus: 200 | 503`. This is cleaner externally but requires broader server/test changes. Lowest-friction path is numeric `status` plus human-readable `health`.

## OpenAPI impact after docs work

OpenAPI generation is now from `packages/api-contracts/src/openapi.ts` and the backend has a drift test.

Relevant facts:

- `packages/api-contracts/src/openapi.ts:103-106` includes `{ method: "GET", path: "/health", summary: "Backend health status", tags: ["system"] }`.
- `packages/api-contracts/src/openapi.ts:882-918` generates default `200`, `400`, and `404` responses with empty JSON schema for routes unless metadata is expanded.
- `apps/backend/tests/api/router.test.ts:88-101` checks every registered route is represented in `apiRouteContracts`.

Recommended for Todo #26: update shared API contracts to document the concrete health response. A minimal acceptable implementation can leave the route listed as-is, but W3-S16 acceptance says external callers can inspect current API shape, so the better finish is:

1. Add/export shared health types/schemas in `packages/api-contracts` (for example `HealthResponseSchema` and related dependency schemas).
2. Add that schema to `apiContractSchemas` and extend `ApiRouteContract`/OpenAPI generation so response schemas can reference components, or special-case `/health` with a component reference and 503 response.
3. Update `/health` route metadata to document 200 healthy and 503 unhealthy responses.

If response-schema support is out of scope, at minimum set `response: "Dependency health status"` for `/health` and add a focused contract test/smoke assertion that `/health` remains in OpenAPI. But this leaves the inspectable response shape weak.

## Existing safe probes to reuse

Prefer service-level `testConnection()` methods. They are read-only and read TinyBase settings with config fallback, but return boolean only.

- `apps/backend/src/services/PaperlessService.ts:195` declares `testConnection`; implementation at `:1210-1215` calls `GET /documents/?page_size=1` via service request helper and maps success to `true`, failures to `false`.
  - Config helper at `:274-285` reads TinyBase settings with config fallback; request helper checks missing URL/token at `:308-315`.
- `apps/backend/src/services/OllamaService.ts:100` declares `testConnection`; implementation at `:551-556` calls `GET /api/tags` via request helper.
  - Config helper starts at `:137`; request helper uses dynamic config at `:183-186`.
- `apps/backend/src/services/MistralService.ts:81` declares `testConnection`; implementation at `:294-299` calls `GET /v1/models`.
  - Config helper at `:103-143` reads `mistral.api_key`, `mistral.model`, `mistral.api_base_url` / `mistral.apiBaseUrl`, config fallback, and default `https://api.mistral.ai`.
- `apps/backend/src/services/QdrantService.ts:77` declares `testConnection`; implementation at `:244-255` calls `client.getCollections()` and catches failures to `false`.

Do **not** use `settingsHandlers.testQdrantConnection` for `/health`: `apps/backend/src/api/settings/handlers.ts:485-535` first checks `/collections` but then calls `qdrant.ensureCollection()`, which can create a collection. Health checks must be read-only.

Settings handlers can still serve as behavior references for human-friendly messages:

- Paperless settings probe: `apps/backend/src/api/settings/handlers.ts:373-409`
- Ollama settings probe: `:411-446`
- Mistral settings probe: `:448-483` (note it does not currently read TinyBase `mistral.api_base_url`, while `MistralService` does)
- Qdrant settings probe: `:485-535` (mutating; avoid for health)

## Recommended files to change

Create:

- `apps/backend/src/api/health/handlers.ts` — aggregate health handler and helper(s). Keeping it outside `api/index.ts` prevents the route file from growing more.
- Optional but recommended: `apps/backend/tests/api/health.test.ts` or focused tests inside `apps/backend/tests/api/router.test.ts`.

Modify:

- `apps/backend/src/api/index.ts`
  - Import the health handler.
  - Replace `addRoute("GET", "/health", () => Effect.succeed({ status: "healthy" }))` with the new effect.
- `packages/api-contracts/src/types.ts` and/or a new response-schema file
  - Export `HealthResponse`/dependency status types if frontend/docs should consume them.
- `packages/api-contracts/src/openapi.ts`
  - Add health schema to components and document `/health` response shape, including 503.
  - Preserve `/health` in `apiRouteContracts`; the drift test depends on it.
- `apps/backend/tests/api/router.test.ts`
  - Update old assertion from `{ status: "healthy" }` to the new all-up response.
  - Provide mock service layers or test the handler directly.
  - Keep wrong method and trailing slash 404 tests.
  - Keep OpenAPI route drift test passing.
- `apps/backend/tests/server.test.ts`
  - Add an HTTP-level test that a one-down dependency yields HTTP 503 if using numeric `status`.
  - Existing tests around docs, read-only HEAD `/health`, and rate-limit bypass should continue to pass.

No `server.ts` source change is required if using numeric `status: 200 | 503`. Change `server.ts` only if choosing a separate `httpStatus` convention or adding metrics-gauge integration.

## Implementation notes

Suggested handler structure:

```ts
import { Effect } from "effect";
import { MistralService, OllamaService, PaperlessService, QdrantService } from "../../services/index.js";

const check = (name, run) =>
  Effect.gen(function* () {
    const started = Date.now();
    const ok = yield* run.pipe(Effect.catchAll(() => Effect.succeed(false)));
    return {
      status: ok ? "up" : "down",
      required: true,
      durationMs: Date.now() - started,
      ...(ok ? {} : { message: `${name} health check failed` }),
    } as const;
  });

export const getHealth = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const ollama = yield* OllamaService;
  const qdrant = yield* QdrantService;
  const mistral = yield* MistralService;
  const started = Date.now();

  const [paperlessResult, ollamaResult, qdrantResult, mistralResult] = yield* Effect.all(
    [
      check("paperless", paperless.testConnection()),
      check("ollama", ollama.testConnection()),
      check("qdrant", qdrant.testConnection()),
      check("mistral", mistral.testConnection()),
    ],
    { concurrency: "unbounded" },
  );

  const services = { paperless: paperlessResult, ollama: ollamaResult, qdrant: qdrantResult, mistral: mistralResult };
  const healthy = Object.values(services).every((service) => service.status === "up");

  return {
    status: healthy ? 200 : 503,
    health: healthy ? "healthy" : "unhealthy",
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - started,
    services,
  };
});
```

Adjust syntax to current Effect typings if necessary. The important invariants are: concurrent or non-short-circuit checks, each failure caught into `down`, and no raw error leakage.

Potential test mock layer shape:

```ts
const healthLayer = Layer.mergeAll(
  Layer.succeed(PaperlessService, { testConnection: () => Effect.succeed(true) } as PaperlessService),
  Layer.succeed(OllamaService, { testConnection: () => Effect.succeed(true) } as OllamaService),
  Layer.succeed(QdrantService, { testConnection: () => Effect.succeed(true) } as QdrantService),
  Layer.succeed(MistralService, { testConnection: () => Effect.succeed(true) } as MistralService),
);
```

For one-down tests, make one service return `Effect.succeed(false)` or `Effect.fail(new Error("boom"))` and assert that all four keys are still present.

## Tests to add/update

1. Router/handler all-up case:
   - `GET /health` returns status `200`, `health: "healthy"`, ISO-ish `timestamp`, numeric `durationMs`, and four services with `status: "up"`, `required: true`, numeric `durationMs`.
2. Router/handler degraded/unhealthy case:
   - One service false/failed returns status `503`, `health: "unhealthy"`, that service `down`, other services still present.
3. Failure isolation:
   - If one `testConnection()` defects/fails, response does not fail the whole Effect and does not include raw error/stack/secrets.
4. Route matching compatibility:
   - `POST /health` remains 404.
   - `GET /health/` remains 404.
5. Server HTTP status:
   - With mock layer, `GET /health` all-up returns HTTP 200.
   - One-down returns HTTP 503. This proves Docker health semantics.
6. Public/rate-limit behavior:
   - Existing `shouldBypassRateLimit("GET", "/health")` test remains true.
   - If API token is set, `/health` remains authorized via `isPublicPath` behavior.
7. OpenAPI:
   - Existing registered-route drift test passes.
   - Add/adjust assertion that `/health` in `generateOpenApiDocument()` documents health response and ideally 503.

## Validation commands

Targeted:

```bash
pnpm --filter @repo/api-contracts typecheck
pnpm --filter @repo/api-contracts build
pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/server.test.ts
pnpm --filter @repo/backend typecheck
```

If adding a standalone health test:

```bash
pnpm --filter @repo/backend test -- tests/api/health.test.ts tests/api/router.test.ts tests/server.test.ts
```

Optional broader checks:

```bash
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test
pnpm --filter @repo/api-contracts lint
```

Manual smoke with real configured services:

```bash
pnpm run dev:backend
curl -i http://127.0.0.1:8765/health
# expect HTTP 200 and all dependencies up when Paperless, Ollama, Qdrant, and Mistral are reachable
# stop one required dependency and repeat; expect HTTP 503 and that dependency down while other statuses are present
```

If metrics work lands before health implementation, also smoke `/metrics`; do not make `/health` depend on `/metrics` being available.

## Risks / decisions

- **HTTP body field name:** numeric `status` is operationally simplest but differs from old `{ status: "healthy" }`. Use separate `health` for readability.
- **Docker impact:** returning 503 when Mistral or other external services are unavailable may mark the backend container unhealthy. This matches the W3-S16 dependency-aware requirement, but local dev may experience degraded containers if credentials are absent.
- **Timeouts:** service probes currently use the configured HTTP request timeout, defaulting to 120s. A shorter health timeout would be operationally better but requires extra timeout wrapping/design. If not implemented now, call it out in worker notes.
- **Qdrant mutation:** never call `ensureCollection()` from `/health`.
- **OpenAPI response schemas:** current generator uses empty response schemas by default. To make the health response inspectable, add response schema support or a narrow special-case.
- **Metrics overlap:** no metrics source implementation currently exists. If metrics is implemented first, use only bounded labels (`service`, `status`) and avoid sensitive labels.

## Final worker prompt

Implement Todo #26 / W3-S16 dependency-aware `/health`. Current route is `apps/backend/src/api/index.ts:225` and returns `{ status: "healthy" }`; HTTP status is emitted from numeric `result.status` in `apps/backend/src/server.ts:958-970`, and Docker healthcheck depends on `/health` HTTP status. Add a health handler (prefer `apps/backend/src/api/health/handlers.ts`) that checks Paperless, Ollama, Qdrant, and Mistral using read-only service probes: `PaperlessService.testConnection()`, `OllamaService.testConnection()`, `QdrantService.testConnection()`, and `MistralService.testConnection()`. Do not use settings `testQdrantConnection` because it can call `ensureCollection()`. Return all dependency statuses without short-circuiting; catch defects/failures into per-service `down` results and do not leak raw errors/secrets. Recommended response: `{ status: 200|503, health: "healthy"|"unhealthy", timestamp, durationMs, services: { paperless, ollama, qdrant, mistral } }`, with each service `{ status: "up"|"down", required: true, durationMs, message? }`. HTTP 200 only when all four are up; otherwise 503 via numeric `status`. Keep `/health` public/rate-limit-bypassed and preserve wrong-method/trailing-slash 404 behavior. Because OpenAPI docs now exist, update `packages/api-contracts`/`openapi.ts` to document the health response shape and ideally the 503 response, while keeping the registered-route drift test passing. Add/update router or health tests for all-up, one-down, thrown failure isolation, no raw error leakage, HTTP-level 503, and OpenAPI health documentation. Validate with `pnpm --filter @repo/api-contracts build && pnpm --filter @repo/api-contracts typecheck`, targeted backend router/server/health tests, and `pnpm --filter @repo/backend typecheck`.