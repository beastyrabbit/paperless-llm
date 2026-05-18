# W3-S14 milestone 1 handoff: backend rate limiting + global LLM/OCR gate foundation

Scope requested: **milestone 1 only** from `subagent-reports/w3-s14-backpressure-context.md`: configurable request rate limiting plus shared runtime primitives for global LLM/OCR concurrency gates. Do **not** implement OCR budget, lock release/cancel, SSE/tag-cache, or frontend polling in this slice.

## Source-backed requirement

- `docs/plans/audit-rework-tasks.md:270-281`: W3-S14 includes request rate limiting and global LLM/OCR concurrency caps, plus later items that are explicitly out of this milestone.
- `docs/AUDIT.md:48`: A2 says there is no rate limiting/request throttling and recommends token buckets per IP/token plus semaphores for Ollama/Mistral.
- `docs/AUDIT.md:137`: H3 says auto-processing has no global concurrency cap; recommendation is a semaphore around `pipeline.processDocument`, but for milestone 1 the better foundation is a shared service that can gate LLM/OCR calls and later pipeline/job paths.

## Current state / high-value code context

### HTTP server boundary

- `apps/backend/src/server.ts:229-240`: `createHttpServer` builds one `AppLayer` runtime and exposes a local `runWithRuntime`; this is the right place to obtain a backpressure service once per request.
- `apps/backend/src/server.ts:552-568`: CORS and `OPTIONS` are handled first, then auth. There is currently no limiter.
- `apps/backend/src/server.ts:682-690`: JSON request bodies are parsed before route dispatch. Rate limiting should run **before** `parseBody(req)` so oversized/expensive requests are rejected cheaply.
- `apps/backend/src/server.ts:163-169`, `562-565`, `717-759`: existing JSON errors use `{ status, error, message?, requestId }`; W2-S6 introduced shared `ApiErrorSchema` in `packages/api-contracts/src/errors.ts`, but this milestone does not need to touch API contracts unless adding a typed helper.
- `apps/backend/src/server.ts:143-160`: read-only allow/block checks remain independent. Rate limiting should apply to all non-OPTIONS requests, including read-only GET/SSE requests, after or before auth as a deliberate choice. Recommended: after auth so invalid token floods are still cheap but not tracked as authenticated token; use IP for unauthorized if limiting before auth.
- `apps/backend/src/server.ts:577-680`: SSE streams are handled before normal JSON routes. Milestone 1 request limiting should cover these paths too; do not fix SSE close/tag cache here.

### Config surface

- `apps/backend/src/config/schema.ts:79-85` and `113+`: `http` currently only has request/prompt timeouts and Mistral retry settings. No rate-limit or concurrency config exists.
- `apps/backend/src/config/index.ts:74-79`: defaults are currently `requestTimeoutMs`, `agentPromptTimeoutMs`, `mistralRetryAttempts`, `mistralRetryBaseDelayMs`.
- `apps/backend/src/config/yaml-loader.ts:92-103`: snake_case YAML keys are normalized for `http`; new keys need aliases here.
- `apps/backend/src/config/yaml-loader.ts:268-274`: env variables are mapped into `http`; add env names for new limits here if env-configurable.
- `config.example.yaml` has a `http:` runtime safety section; `.env.example` has no runtime-safety examples beyond prod read-only. Update examples when implementation happens.

### Effect service/layer composition

- `apps/backend/src/layers/index.ts:34-54`: `ConfigLayer`, `ExternalServicesLayer`, and `BaseServicesLayer` compose `OllamaServiceLive`/`MistralServiceLive` directly today.
- `apps/backend/src/layers/index.ts:62-115`: `CoreServicesLayer`, `AgentsLayer`, `JobsLayer`, `PipelineLayer`, and `AppLayer` depend on those base services. A new `BackpressureServiceLive` should be provided from `ConfigLayer` and made available to Mistral/Ollama/agents/jobs through the same shared runtime.
- Effect 3.19.14 has `Effect.makeSemaphore(permits)` and `Effect.Semaphore.withPermits(permits)` / `withPermitsIfAvailable(permits)` (`node_modules/.pnpm/effect@3.19.14/.../Effect.d.ts:24084-24157`). Use this rather than a homegrown queue for concurrency gates.
- Existing stateful services use `Ref` and `Layer.effect` (`AutoProcessingService.ts:45-62` creates refs/fiber refs). Follow that pattern.

### LLM/OCR call paths needing gates

- `apps/backend/src/services/MistralService.ts:93-154`: one `request<T>()` helper is used by generic Mistral chat/image/document methods. Gate this helper with the **LLM/Mistral chat** semaphore.
- `apps/backend/src/services/MistralService.ts:227-290`: `chat`, `processImage`, and legacy `processDocument` all go through `request`. This covers `BulkOcrJob` and `BulkIngestJob` because they call `mistral.processDocument`.
- `apps/backend/src/agents/OCRAgent.ts:140-219`: OCRAgent calls Mistral `/v1/ocr` directly, bypassing `MistralService`. Gate `runMistralOCR` with the **OCR** semaphore. This is the primary OCR gate foundation; budget accounting is later.
- `apps/backend/src/jobs/BulkOcrJob.ts:146-149`: bulk OCR directly calls `MistralService.processDocument`; a MistralService-level gate catches it.
- `apps/backend/src/jobs/BulkIngestJob.ts:226-233`: bulk ingest directly calls `MistralService.processDocument`; a MistralService-level gate catches it.
- `apps/backend/src/services/OllamaService.ts:171-212`: one request helper covers `listModels`, `getRunningModels`, non-streaming `chat`, and `generate`. Gate only expensive generation/chat/embed calls, not health/list calls unless deliberately configured.
- `apps/backend/src/services/OllamaService.ts:227-240`: `chat` is expensive; gate with **LLM/Ollama** semaphore.
- `apps/backend/src/services/OllamaService.ts:242-349` and `370-478`: `chatStream`/`generateStream` do not use the helper; wrap the stream acquisition/drain so the permit is held until stream completion/finalizer.
- `apps/backend/src/services/OllamaService.ts:352-367`: `generate` should be gated.
- `apps/backend/src/services/OllamaService.ts:480-510`: embeddings also use Ollama; decide if they count against LLM gate. Recommendation for milestone 1: gate `embed` too unless a separate `embeddingConcurrency` is added, because Qdrant/search can otherwise overload Ollama.

### Pi-agent direct Ollama bypass risk

Pi document/catalog agents bypass `OllamaService` and use Pi's `streamSimple` directly:

- `apps/backend/src/agents/piOllamaModel.ts:4-20`: builds an OpenAI-compatible Ollama model.
- `apps/backend/src/agents/PiDocumentAgent.ts:2230-2266`: creates `PiAgent` with `streamFn: streamSimple` and a direct Ollama model.
- `apps/backend/src/agents/PiDocumentAgent.ts:2337-2355`: the actual `agent.prompt(...)` is wrapped only in timeout logic. Gate this prompt call with the LLM semaphore.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:292-305`: direct `agent.prompt(...)`; gate it.
- `apps/backend/src/agents/PiConsolidationAgent.ts:473-485`: direct `streamSimple`; find the `agent.prompt(...)` call later in that file and gate it.

This is the main reason a service-level `OllamaService` gate alone is insufficient for W3-S14.

### W2-S6 coordination / avoid conflict

- W2-S6 has already moved API schemas to `packages/api-contracts` and changed `apps/backend/src/api/index.ts`. Avoid modifying `apps/backend/src/api/index.ts` or `packages/api-contracts/*` for milestone 1 unless W2-S6 is fully merged and a shared `ApiError` helper is explicitly desired.
- Milestone 1 can be implemented almost entirely outside the W2-S6 hot path: config, new backend service, layers, server, Mistral/Ollama/OCR/Pi agent call sites, tests.

## Minimal implementation design

### 1) Config keys

Recommended names under `http` to avoid adding a new top-level schema:

```yaml
http:
  request_timeout_ms: 120000
  agent_prompt_timeout_ms: 120000
  mistral_retry_attempts: 3
  mistral_retry_base_delay_ms: 5000
  rate_limit_window_ms: 60000
  rate_limit_max_requests: 120
  rate_limit_enabled: true
  llm_concurrency: 2
  ocr_concurrency: 1
```

Possible env vars:

- `PAPERLESS_LLM_RATE_LIMIT_ENABLED`
- `PAPERLESS_LLM_RATE_LIMIT_WINDOW_MS`
- `PAPERLESS_LLM_RATE_LIMIT_MAX_REQUESTS`
- `PAPERLESS_LLM_LLM_CONCURRENCY`
- `PAPERLESS_LLM_OCR_CONCURRENCY`

Defaults should be conservative but not disruptive for local dev. Suggested defaults: enabled true, 120 requests / 60s, `llmConcurrency: 2`, `ocrConcurrency: 1`. If worried about test/dev flakiness, allow `rateLimitEnabled: false` via env/config.

### 2) New runtime service

Likely file: `apps/backend/src/services/BackpressureService.ts`.

Suggested interface:

```ts
export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly key: string;
  readonly remaining: number;
  readonly retryAfterMs?: number;
  readonly resetAt: number;
}

export interface BackpressureService {
  readonly checkRequest: (input: { key: string; now?: number }) => Effect.Effect<RateLimitDecision, never>;
  readonly withLlmPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly withOcrPermit: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  readonly snapshot?: () => Effect.Effect<{ llmPermits?: number; ocrPermits?: number; buckets: number }, never>;
}
```

Implementation notes:

- Use `Ref<Map<string, Bucket>>` for a fixed-window or token-bucket limiter. Audit asks token bucket; implement token bucket if feasible: store `tokens`, `updatedAt`, refill based on `maxRequests/windowMs`, cap at `maxRequests`.
- Prune stale bucket entries opportunistically during checks to prevent unbounded growth. A simple `if now - updatedAt > windowMs * 2 delete` is enough.
- Use `Effect.makeSemaphore(Math.max(1, config.config.http.llmConcurrency))` and same for OCR. Wrap via `semaphore.withPermits(1)(effect)`.
- Consider `withPermitsIfAvailable` only if the desired behavior is fast failure. For milestone 1, queued waiting is safer for internal jobs; request rate limit returns 429 externally.
- Add a small `BackpressureRejectedError` only if internal fast-fail gates are introduced; otherwise gates do not add new errors.

### 3) Rate-limit key extraction and 429 response

Add exported helpers in `server.ts` for testability without starting the server:

- `getRequestRateLimitKey(req: IncomingMessage, url: URL): string`
  - Prefer authenticated identity if present: bearer token fingerprint or `x-api-key` fingerprint, not the raw token in logs/maps. Use `crypto.createHash('sha256').update(token).digest('hex').slice(0, 16)`.
  - Else IP from `req.socket.remoteAddress`; only consider `x-forwarded-for` if there is an explicit trusted proxy setting. Safer default: ignore spoofable forwarding headers.
- `rateLimitRejection(decision, requestId)` returns `{ status: 429, error: 'Too Many Requests', message, requestId }`.

Wire in `createHttpServer` after CORS/OPTIONS and near auth/read-only, before SSE and before `parseBody`. Response headers should include at least:

- `Content-Type: application/json`
- `Retry-After: Math.ceil(retryAfterMs / 1000)` when rejected
- Optional `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`.

### 4) Gate call sites

- Inject `BackpressureService` into `MistralServiceLive`; wrap `request` or each expensive method. If wrapping `request`, list/test calls are also gated. Better minimal design: helper `withMistralGate` around `chat`, `processImage`, `processDocument`; keep `listModels/testConnection` ungated.
- Inject into `OCRAgentServiceLive`; wrap `runMistralOCR(pdfBytes)` actual request/retry loop in `withOcrPermit` so the permit covers retries and HTTP time.
- Inject into `OllamaServiceLive`; wrap `chat`, `generate`, `embed`, and stream methods. For `Stream.asyncEffect`, easiest robust approach is to acquire/release via `Effect.acquireUseRelease` or convert gate helper for streams so permit is released on stream finalization. Do not release immediately after creating the stream.
- Inject into Pi agents and wrap `agent.prompt(...)` effects: `backpressure.withLlmPermit(Effect.tryPromise(...).pipe(timeout...))` or wrap inside timeout depending on desired semantics. Recommended: acquire permit **inside** timeout if the timeout should include queue wait; outside if timeout should only measure model time. Current timeout is user-facing agent prompt timeout; include queue wait only if acceptable. Prefer outside timeout for less surprising model-time behavior, but document decision in code/tests.

## Exact likely files

Modify:

- `apps/backend/src/config/schema.ts` — add `http` fields and `ResolvedConfig.http` fields.
- `apps/backend/src/config/index.ts` — defaults for new fields.
- `apps/backend/src/config/yaml-loader.ts` — snake_case aliases + env vars.
- `config.example.yaml` — document runtime safety keys.
- `.env.example` — optional env var docs.
- `apps/backend/src/services/BackpressureService.ts` — new service.
- `apps/backend/src/services/index.ts` — export service/tag/live layer.
- `apps/backend/src/layers/index.ts` — provide `BackpressureServiceLive` from `ConfigLayer`; provide it to `MistralServiceLive`, `OllamaServiceLive`, OCR/Pi agents, and `AppLayer`.
- `apps/backend/src/server.ts` — request limiter check before body parsing/SSE dispatch; exported helper(s) for tests.
- `apps/backend/src/services/MistralService.ts` — inject/use LLM gate for chat/image/document.
- `apps/backend/src/services/OllamaService.ts` — inject/use LLM gate for chat/generate/embed/streams.
- `apps/backend/src/agents/OCRAgent.ts` — inject/use OCR gate for direct `/v1/ocr` call.
- `apps/backend/src/agents/PiDocumentAgent.ts` — inject/use LLM gate around `agent.prompt`.
- `apps/backend/src/agents/PiTagExplorerAgent.ts` — inject/use LLM gate around `agent.prompt`.
- `apps/backend/src/agents/PiConsolidationAgent.ts` — inject/use LLM gate around `agent.prompt`.

Tests to add/modify:

- `apps/backend/tests/services/BackpressureService.test.ts` — new unit tests for token bucket allowed/rejected/refill/prune and semaphore queue behavior.
- `apps/backend/tests/server.test.ts` — helper tests for rate-limit key extraction, no token leakage, 429 response shape helper. Existing file already tests auth/read-only helpers (`server.test.ts:1-92`).
- `apps/backend/tests/config/config.test.ts` — YAML/env parsing for new keys.
- `apps/backend/tests/services/MistralService.test.ts` — prove two concurrent expensive calls are serialized when `llmConcurrency=1`; existing tests already mock `fetch` and layer `ConfigService`/`TinyBaseService` (`MistralService.test.ts:1-27`).
- `apps/backend/tests/services/OllamaService.test.ts` — same for `generate` or `chat`; existing tests already mock fetch/layers (`OllamaService.test.ts:1-26`).
- `apps/backend/tests/agents/OCRAgent.test.ts` — if feasible, prove direct OCR calls are gated. If heavy to wire, service-level BackpressureService tests + Mistral/Ollama tests are acceptable for milestone 1, but note OCRAgent call-site review.

Avoid in milestone 1:

- `apps/backend/src/api/index.ts` unless necessary after W2-S6 merge.
- `packages/api-contracts/*` unless centralizing `ApiError` response construction after W2-S6.
- OCR budget tables/usage accounting.
- Lock release/cancel endpoints.
- Tag cache/SSE interruption changes.
- Frontend polling/UI changes.

## Implementation risks / decisions

- **Pi agents bypass OllamaService.** Missing these `agent.prompt` gates would leave the main metadata path unconstrained.
- **Stream gates must hold permits until stream end.** Wrapping only stream construction is a bug.
- **Layer dependency cycles are possible.** Keep `BackpressureServiceLive` dependent only on `ConfigService`. Then services/agents can depend on Backpressure without circular service dependencies.
- **Rate limiter is per backend process.** This is acceptable for this local app; document if needed.
- **Authenticated key storage must not store raw secrets.** Use a short hash/fingerprint for token-derived bucket keys.
- **W2-S6 changed API contracts.** Keep milestone 1 on backend runtime files; if adding a 429 typed schema becomes contentious, skip it and match existing error shape.
- **Tests with semaphores can be flaky if they rely on wall clock.** Use Deferred/Promise controls in mocked fetch to assert second call does not enter until first resolves.

## Validation commands

Targeted during implementation:

```bash
pnpm --filter @repo/backend test -- tests/services/BackpressureService.test.ts
pnpm --filter @repo/backend test -- tests/server.test.ts
pnpm --filter @repo/backend test -- tests/config/config.test.ts
pnpm --filter @repo/backend test -- tests/services/MistralService.test.ts tests/services/OllamaService.test.ts
```

Backend safety net:

```bash
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test
```

Full repo if time permits:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
```

## Compact worker prompt for after W2-S6 finishes

Implement W3-S14 milestone 1 only: backend request rate limiting and shared LLM/OCR concurrency gate foundation. Use the current W2-S6 branch as base. Add configurable `http` keys for request token-bucket limits and `llmConcurrency`/`ocrConcurrency`; normalize YAML snake_case and env vars; document in examples. Create an Effect-managed `BackpressureService` using `Ref` for per-IP/token token buckets and `Effect.makeSemaphore` for shared LLM/OCR gates, provide it from `AppLayer`, and export it from services. In `server.ts`, apply the limiter to all non-OPTIONS requests before `parseBody` and before SSE/route dispatch; return structured JSON 429 with `Retry-After`, request id, and no token leakage. Gate expensive Mistral chat/image/document calls, direct OCRAgent `/v1/ocr`, Ollama chat/generate/embed/streams, and Pi-agent direct `agent.prompt` calls (`PiDocumentAgent`, `PiTagExplorerAgent`, `PiConsolidationAgent`) through the shared service. Do not implement OCR budget, lock release/cancel, SSE/tag-cache, or frontend polling. Avoid `apps/backend/src/api/index.ts` and `packages/api-contracts/*` unless absolutely necessary after W2-S6 merge. Add tests for token-bucket 429 decisions, semaphore serialization, config parsing, server helper behavior, and at least Mistral/Ollama gated calls. Validate with backend typecheck/lint/test and targeted Backpressure/server/config/service tests. Stop and ask if changing externally visible API contracts, if choosing a schema/config layout other than `http`, or if a call-site requires broad Pi agent refactoring beyond wrapping `agent.prompt`.
