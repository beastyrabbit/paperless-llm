# Independent Audit: `paperless_local_llm`

Status: approved implementation backlog for branch `document-agent-overhaul`.

This audit covers backend code quality, frontend code quality, architecture,
infrastructure, tooling, CI, Docker, config, the document-processing pipeline, and
LLM prompt behavior. Evidence line numbers are from the audit snapshot and should
be rechecked before patching any item because this branch is actively changing.

The companion implementation tracker is
[`docs/plans/audit-rework-tasks.md`](plans/audit-rework-tasks.md).

## Verdict

The project has strong bones: Effect-TS, Turborepo, structured agent tools,
TypeBox schemas, and a tag-based state machine. It is also carrying real risk
from shortcuts: Promise/Effect boundary violations, swallowed errors,
optional-everywhere config, unvalidated type assertions, missing retries on
cloud APIs, no rate limiting, query-param auth, hardcoded localhost CORS, zero
frontend tests, no shared API contract between backend and frontend, very large
files, and a documented Large Model -> Small Model verification loop that is not
implemented. The rework is the right time to fix these structural issues before
they become the new foundation.

## Scope

Inspected areas:

- `apps/backend/`
- `apps/web/`
- Root config: `turbo.json`, `pnpm-workspace.yaml`, `biome.json`,
  `lefthook.yml`, `docker-compose.yml`
- Config: `config.example.yaml`, `apps/backend/src/config/`
- Pipeline: `ProcessingPipeline.ts`, `PiDocumentAgent.ts`,
  `PiConsolidationAgent.ts`, `PiTagExplorerAgent.ts`, `OCRAgent.ts`, `base.ts`
- Prompts: inline TypeScript instruction strings and `tagLanguage.ts`
- Tests: `apps/backend/tests/`; frontend currently has no tests

Some findings intentionally appear in more than one section because they are
both local defects and architectural problems. Keep the duplicated IDs for
tracking.

## Security

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| A1 | Critical | API token is accepted via `?api_key=` query param, which leaks into logs, browser history, referrers, and proxy caches. | `apps/backend/src/server.ts:153` | Remove query-param auth. Accept only `Authorization: Bearer ...` or `X-API-Key`. |
| A2 | Critical | No rate limiting or request throttling. | `apps/backend/src/server.ts` | Add token-bucket limits per IP/token and cap concurrent Ollama/Mistral calls with semaphores. |
| A3 | Critical | Prompt injection risk: OCR text is interpolated directly into LLM prompts without a clear instruction/data boundary. | `apps/backend/src/agents/PiDocumentAgent.ts:1579` | Wrap document content in explicit data delimiters and tell the model never to follow instructions inside them. |
| A4 | High | Hardcoded localhost CORS allow-list is unsafe for production. | `apps/backend/src/server.ts:28-36` | Read allowed origins from `PAPERLESS_LLM_TRUSTED_UI_ORIGINS`; do not hardcode dev origins. |
| A5 | High | Secret config fields are optional, so the server can start with empty Mistral/Paperless credentials and fail later. | `apps/backend/src/config/schema.ts:7-86`, `apps/backend/src/config/index.ts:12-14` | Mark required secrets as required and fail fast with precise startup errors. |
| A6 | High | Error logging can include full request headers, including auth headers. | `apps/backend/src/server.ts:656` | Sanitize headers before logging; replace auth values with `***`. |
| A7 | Medium | No per-document authorization; any token holder can stream/process any document. | `apps/backend/src/server.ts:145-155` | Add ownership/ACL checks after token validation. |
| A8 | Medium | Frontend proxy has no CSRF protection for backend mutations. | `apps/web/app/api/[...path]/route.ts` | Use Next server actions where suitable or add CSRF token middleware for mutating routes. |
| A9 | Medium | Sensitive-data redaction regex is keyword-only, German-biased, and permissive. | `apps/backend/src/agents/PiDocumentAgent.ts:582-603` | Expand patterns for OTP/passcode/activation code, add entropy/length heuristics, and document the policy. |
| A10 | Medium | User-supplied prompt/tool strings have no size caps. | `apps/backend/src/api/index.ts:83-86` | Add max-length validation to API schemas and explicitly cap document content passed to prompts. |

## Effect-TS Discipline

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| B1 | Critical | `Effect.runPromise` is called inside Effect code to invoke other Effects, breaking composability, cancellation, and error channels. | `apps/backend/src/agents/PiDocumentAgent.ts:882,908,925,1028,1072` | Keep `Effect.gen` discipline and `yield*` the effects instead of awaiting `Effect.runPromise`. |
| B2 | High | Error channel is type-laundered with casts like `Effect.Effect<A, never, never>`. | `apps/backend/src/server.ts:198` | Handle errors with `Effect.catchAll`/`catchTag`; never cast `E` to `never`. |
| B3 | High | Service interfaces claim `Effect<..., never>` even when implementations can fail. | `apps/backend/src/services/AutoProcessingService.ts:36-39` | Propagate real error unions, or use `orDie` only for truly unrecoverable defects. |
| B4 | High | `JSON.parse` inside agents can throw outside the Effect error channel. | `apps/backend/src/agents/PiDocumentAgent.ts:96,135,209` | Wrap parsing in `Effect.try` and convert failures into tagged agent errors. |
| B5 | High | Errors are asserted as `ValidationError` without safe narrowing. | `apps/backend/src/server.ts:164,173` | Use tagged errors and `Effect.catchTag` or pattern matching. |
| B6 | Medium | Qdrant and auto-processing init promises are only `.catch(...)`ed, allowing silent half-up state. | `apps/backend/src/server.ts:699-733` | Fork managed daemon effects and expose startup status in `/health`. |
| B7 | Medium | OCR temp directory lifecycle is outside Effect resource management. | `apps/backend/src/agents/OCRAgent.ts:144-176` | Use `Effect.acquireRelease` so cleanup runs on success, failure, and interruption. |

## Type Safety

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| C1 | High | `as unknown as ResolvedConfig` bypasses the schema. | `apps/backend/src/config/index.ts:114-116` | Decode merged config with `Schema.decodeSync(AppConfigSchema)`. |
| C2 | High | `AppConfigSchema` is defined but not used to validate loaded config. | `apps/backend/src/config/schema.ts`, `apps/backend/src/config/index.ts` | Validate at startup and fail with structured errors. |
| C3 | Medium | TinyBase memory blobs are read as untyped `unknown[]`. | `apps/backend/src/services/DocumentCaseService.ts:980,1033,1039` | Define, version, and validate a memory schema. |
| C4 | High | Frontend duplicates backend API types in `lib/api.ts`, causing guaranteed drift. | `apps/web/lib/api.ts:391-500`, `apps/backend/src/api/index.ts` | Create `packages/api-contracts` for shared schemas/types. |
| C5 | Low | Domain IDs use raw `number`/`string` primitives. | `apps/backend/src/models/index.ts` | Introduce branded types for `DocumentId`, `TagId`, `CorrespondentId`, etc. |
| C6 | Medium | TinyBase stores JSON as strings and callers cast without runtime validation. | `apps/backend/src/services/TinyBaseService.ts:111-150` | Centralize `parseStoredJson<T>(value, schema, fallback)`. |
| C7 | Medium | Coerced numeric IDs have no domain bounds and invalid paths are unlogged. | `apps/backend/src/api/index.ts:83-84`, `apps/backend/src/server.ts:519-525` | Reject invalid IDs early and return one consistent `400` response shape. |

## Error Handling

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| D1 | High | Queue stats swallow Paperless failures and return zeroed data. | `apps/backend/src/api/documents/handlers.ts:24-46` | Log the cause and return a status flag so the UI can show Paperless is unreachable. |
| D2 | Medium | Frontend logs errors to the console but does not surface recoverable failures to the user. | `apps/web/app/page.tsx:101,117`, `apps/web/app/settings/components/AiTagsTab.tsx:100` | Standardize error state and render retryable error banners. |
| D3 | Medium | Error response shapes vary across handlers. | `apps/backend/src/api/` | Define a shared `ApiError` schema and reuse it for all handlers. |
| D4 | Medium | No process-level `unhandledRejection` / `uncaughtException` handlers. | `apps/backend/src/index.ts` | Log structured fatal errors and exit predictably in production. |

## Pipeline Soundness

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| E1 | High | The documented Large Model -> Small Model verification loop is not implemented. | `README.md:27`, `CLAUDE.md:78`, `PiDocumentAgent.ts` | Implement a real small-model verifier or remove the docs claim. |
| E2 | High | Mistral OCR has no retry on 5xx or timeout. | `apps/backend/src/agents/OCRAgent.ts:106-141` | Add bounded exponential retry and respect `Retry-After`. |
| E3 | High | Mistral, Paperless, and Ollama fetches have no timeout. | `apps/backend/src/services/MistralService.ts:127-143`, `apps/backend/src/services/OllamaService.ts` | Use `AbortController` with per-call timeouts from config. |
| E4 | High | `agent.prompt()` has no timeout, so slow Ollama can stall a document. | `apps/backend/src/agents/PiDocumentAgent.ts:1812-1852` | Wrap prompt calls with `Effect.timeout`. |
| E5 | Medium | Dual state in Paperless tags and TinyBase phase can diverge after partial writes. | `apps/backend/src/agents/ProcessingPipeline.ts:514-565` | Choose one source of truth and project workflow tags from a transactional state change. |
| E6 | Medium | Resume is nondeterministic because old transcript is reused with nonzero temperature and no seed. | `apps/backend/src/agents/PiDocumentAgent.ts:1700-1810`, `apps/backend/src/services/OllamaService.ts:208` | Pin seed and replay accepted decisions as authoritative ground truth. |
| E7 | Medium | Resume uses a stale system prompt/catalog snapshot. | `apps/backend/src/agents/PiDocumentAgent.ts:1700-1810` | Rebuild system prompt and catalog payload on every resume. |
| E8 | Medium | All failed documents get the same tag, hiding transient vs permanent failures. | `apps/backend/src/agents/ProcessingPipeline.ts:682,705,830` | Add `failure_kind` to case rows and surface it in UI. |
| E9 | Medium | Stuck-doc recovery waits for the 15-minute lock TTL or manual TinyBase edits. | `apps/backend/src/services/LockService.ts:60` | Add an admin endpoint/UI action to release stale locks and emit a metric. |
| E10 | Medium | No user-facing cancellation for in-flight runs. | `apps/backend/src/agents/ProcessingPipeline.ts:329-363` | Expose a cancel endpoint and interrupt the running Effect. |
| E11 | Low | Model generation settings are not per-step and no seed is logged. | `apps/backend/src/services/OllamaService.ts:202-214` | Allow per-step model config and log seed/temperature per case. |
| E12 | Medium | No token/page/cost budget tracking for Mistral OCR. | `apps/backend/src/services/MistralService.ts`, `apps/backend/src/jobs/BulkOcrJob.ts` | Track usage per run/day and enforce a hard cap. |

## Pipeline Dry-Runs

1. Happy path: works correctly. Lock -> OCR -> `llm-ocr-done` -> metadata Pi run
   -> index -> `llm-processed`. Tag and case phase end consistent.
2. Mistral 5xx then success: currently fails immediately, tags `llm-failed`, and
   requires manual retrigger. It can also redundantly rerun Mistral when content
   is missing.
3. Ambiguous correspondent: human decision is stored, but resume can re-propose a
   different value because no seed is pinned and prior human choices are not
   authoritative in the prompt.
4. Concurrent auto + manual run: `LockService` blocks the second caller. If the
   first run crashes, the lock is held until TTL.
5. Crash between correspondent-done and title-done: in-flight Ollama state is
   lost. After TTL, metadata can restart and overwrite already-applied fields
   because there is no per-field idempotency marker.

## Idempotency And Determinism

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| G1 | Medium | OCR is not idempotent at the call level. | `apps/backend/src/agents/OCRAgent.ts:207` | Persist OCR result hash and skip if the same PDF SHA was already OCR'd. |
| G2 | Medium | `finish_document_metadata` overwrites existing applied fields on resume. | `apps/backend/src/agents/PiDocumentAgent.ts:1339-1455` | Track per-field `appliedAt` and treat the case row as authoritative on resume. |

## Concurrency And Backpressure

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| H1 | Medium | Tag cache is shared mutable global state with no lock. | `apps/backend/src/server.ts:130-131,259-286` | Replace with `Effect.Ref` plus `Effect.cached` or `Cache.make`. |
| H2 | Medium | SSE loops poll every 2s without max iterations or disconnect handling. | `apps/backend/src/server.ts:548-576` | Use Stream-based SSE with interruption on client close and a duration cap. |
| H3 | Medium | Auto-processing has no global concurrency cap. | `apps/backend/src/services/AutoProcessingService.ts:204-249` | Put a semaphore around `pipeline.processDocument`. |
| H4 | Medium | Dashboard and Sidebar both poll every 5s; multiple tabs multiply load. | `apps/web/app/page.tsx:202-209`, `apps/web/components/sidebar.tsx:50` | Centralize polling in one provider or use SSE/EventSource. |

## Configuration And Secrets

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| I1 | High | Config schema is all-optional with empty-string defaults. | `apps/backend/src/config/schema.ts`, `apps/backend/src/config/index.ts` | Validate with `Schema.decodeSync`; require secrets. |
| I2 | Medium | `resolveConfigPath` walks parent dirs and may load the wrong config in a worktree. | `apps/backend/src/config/yaml-loader.ts:118-135` | Prefer absolute path/env var and warn or fail on parent walking. |
| I3 | Medium | Mistral URL is hardcoded with no proxy/region/fallback option. | `apps/backend/src/agents/OCRAgent.ts:108` | Make the endpoint configurable. |
| I4 | Low | Dev scripts hardcode Portless URLs/ports without fallback docs. | `package.json:7-13` | Document fallback behavior and degrade to plain localhost when Portless is unavailable. |

## Observability

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| J1 | High | Backend has many `console.*` calls and no structured logging, levels, or correlation IDs. | `apps/backend/src` | Adopt pino or Effect platform logging; include requestId/docId/caseId. |
| J2 | Medium | No Prometheus/OpenTelemetry metrics. | Absent | Expose `/metrics` with phase/error/retry counters and LLM latency histograms. |
| J3 | Medium | No tracing across HTTP -> Effect -> Mistral/Ollama. | Absent | Wire Effect tracing to OTLP. |
| J4 | Low | Dashboard error UI hides details behind a generic banner. | `apps/web/app/documents/page.tsx:274-281` | Show structured cause and retry actions. |

## Frontend / Next.js / React

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| K1 | High | Dashboard is a monolithic client component. | `apps/web/app/page.tsx` | Split into dashboard subcomponents and extract `useDashboardData`. |
| K2 | Medium | Dashboard fetches `/api/settings` directly instead of using typed settings API. | `apps/web/app/page.tsx:72-103` | Use `settingsApi.get()` and remove ad-hoc mapping. |
| K3 | Medium | Documents search has race-prone fetch chains, unsafe casts, and silent null state. | `apps/web/app/documents/page.tsx:176-216` | Rewrite with `async`/`await`, cancellation, and runtime validation. |
| K4 | High | i18n is inconsistent; many hardcoded English strings remain. | `apps/web/app/cases/page.tsx:71-135`, `apps/web/app/documents/[id]/page.tsx:102-107` | Audit all pages and add lint coverage for bare text. |
| K5 | Medium | Settings have two sources of truth: TinyBase and ad-hoc fetch state. | `apps/web/app/settings/components/*` | Route settings through one TinyBase-backed flow. |
| K6 | Medium | Filtered documents also fetch the full list to enable search. | `apps/web/app/documents/page.tsx:132-174` | Add backend search-with-filter support or fetch once and filter client-side. |
| K7 | Low | Repeated constants and gradient class strings. | `apps/web/lib/api.ts:5`, `apps/web/lib/tinybase/provider.tsx:31`, `AiTagsTab.tsx:38` | Extract constants and reusable Tailwind utilities. |
| K8 | Medium | Settings forms do not use React 19 form actions/status/optimistic patterns. | `apps/web/app/settings/components/ProcessingTab.tsx` | Convert mutations to actions and show inline pending state. |
| K9 | Medium | Missing Suspense/loading boundaries despite App Router features. | `apps/web/app/layout.tsx` | Add `loading.tsx` per route and suitable Suspense boundaries. |
| K10 | Medium | Destructive/bulk actions lack confirmation dialogs. | `apps/web/app/tags/page.tsx:75-114` | Add explicit confirmation with action count. |
| K11 | Medium | Accessibility gaps: unlabeled status dots, motion preferences ignored, custom combobox issues. | `apps/web/app/page.tsx:525-532`, `apps/web/components/sidebar.tsx:108-116`, `apps/web/components/model-combobox.tsx` | Add ARIA labels/status roles, respect reduced motion, and prefer Radix primitives. |
| K12 | Low | Unused state placeholders remain. | `apps/web/app/settings/components/AiTagsTab.tsx:50,59` | Delete dead state. |
| K13 | Low | Translation functions in callback deps cause unnecessary recreations. | `apps/web/app/page.tsx:72-103,142-163` | Separate data fetching from i18n view-model mapping. |

## Build, Lint, Tooling

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| L1 | Critical | Backend emits JS even when TypeScript has errors. | `apps/backend/tsconfig.json:18` | Set `noEmitOnError` to `true` or remove the override. |
| L2 | High | Biome disables unused function parameter checks. | `biome.json:40` | Set `noUnusedFunctionParameters` to `error` and allow `_` prefix convention. |
| L3 | Low | `tsconfig.tsbuildinfo` is committed at repo root. | Repo root | Add to `.gitignore` and remove from git. |
| L4 | High | No PR CI for typecheck/tests/lint. | `.github/workflows/` | Add `pr.yml` running install, typecheck, test, and lint. |
| L5 | Medium | No coverage threshold. | `apps/backend/vitest.config.ts:8-12` | Enforce a realistic threshold on critical directories. |
| L6 | Low | `CONTRIBUTING.md` references the wrong stack. | `CONTRIBUTING.md` | Rewrite for pnpm/Turbo/Effect. |
| L7 | Medium | No Dependabot/Renovate policy. | `apps/backend/package.json` | Add Renovate or Dependabot for security and routine updates. |

## Repo Hygiene

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| M1 | High | `.ref/` contains 1.9GB of vendored upstream code. | `.ref/*` | Convert to submodules or remove and reference upstream URLs. |
| M2 | Medium | Two large PNGs are committed at repo root. | `documents-741-after-wait.png`, `documents-741-structured-case.png` | Move to `docs/images/` or keep outside repo. |
| M3 | Low | Workspace package versions are inconsistent. | Root and workspace `package.json` files | Adopt Changesets or another explicit release strategy. |

## Persistence And Data

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| N1 | High | TinyBase corrupt-file backup has no schema versioning or migration path. | `apps/backend/src/services/TinyBaseService.ts:50-74` | Add a schema version row and startup migration registry. |
| N2 | Medium | TinyBase migration script has no idempotency guard. | `scripts/migrate-to-tinybase.ts` | Record migrated state and add post-write verification. |

## Docker / Deploy

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| O1 | Medium | Backend image copies dist as root before switching user. | `apps/backend/Dockerfile:38-49` | Use `COPY --from=builder --chown=backend:nodejs ...`. |
| O2 | Medium | Backend health does not probe Ollama/Qdrant/Paperless dependencies. | `docker-compose.yml:15-20`, `apps/backend/src/server.ts:698-717` | Extend `/health` and make compose healthcheck wait on it. |
| O3 | Medium | `.dockerignore` may not exclude `.ref/`, demo PNGs, and build info. | `.dockerignore` | Audit build context and exclude large/sensitive paths. |

## Tests

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| P1 | High | Frontend has zero tests despite Playwright being available. | `apps/web` test search returns 0 | Add Vitest/RTL and Playwright for settings save, queue drill-down, manual review, and dashboard load. |
| P2 | Medium | Backend tests do not cover key error paths. | `apps/backend/tests/services/OllamaService.test.ts` and related tests | Add table-driven tests for timeouts, 5xx, malformed JSON, and concurrency. |
| P3 | Medium | No tests for prompt-injection resistance or schema-violation retry logic. | `apps/backend/tests/agents/PiDocumentAgent.test.ts` | Add red-team fixtures and schema retry tests. |

## Prompts / LLM Behavior

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| Q1 | Critical | Prompt-injection data boundary is missing. | `apps/backend/src/agents/PiDocumentAgent.ts:1579` | Wrap OCR content in data delimiters and add explicit system instruction. |
| Q2 | High | Large Model -> Small Model confirmation loop is missing. | `README.md:27`, `CLAUDE.md:78`, use of only `settings["ollama.model"]` | Implement verifier prompt returning `{ confirmed, feedback }` and wire it into `runConfirmationLoop`. |
| Q3 | High | `agent.prompt()` has no timeout. | `apps/backend/src/agents/PiDocumentAgent.ts:1812-1852` | Add `Effect.timeout`. |
| Q4 | Medium | Retry loop gives generic correction text instead of field-specific schema errors. | `apps/backend/src/agents/PiDocumentAgent.ts:1829-1852` | Generate correction text from validation error paths. |
| Q5 | Medium | Ollama JSON mode is not enabled. | `apps/backend/src/services/OllamaService.ts:202-214`, `piOllamaModel.ts` | Use `format: "json"` or response_format where supported. |
| Q6 | Medium | Static content truncation ignores prompt/catalog size. | `apps/backend/src/agents/PiDocumentAgent.ts:1579`, `PiTagExplorerAgent.ts:272` | Compute remaining context budget dynamically. |
| Q7 | Medium | Prompts have no few-shot examples. | All agents | Add 2-3 German/English examples per agent. |
| Q8 | Medium | Untyped TinyBase memory blobs are injected into prompts. | `apps/backend/src/agents/PiDocumentAgent.ts:1638-1651` | Validate memory shape before prompt injection. |
| Q9 | Low | `confidence` exists in base type but is not emitted by `PiDocumentAgent`. | `apps/backend/src/agents/base.ts`, `PiDocumentAgent.ts` | Add confidence to metadata finish tool and gate auto-apply by threshold. |
| Q10 | Low | `tagLanguage.ts` aliases are hardcoded rather than archive-specific. | `apps/backend/src/agents/tagLanguage.ts:10-50` | Move aliases to TinyBase settings and expose UI editing. |

## API / Architecture

| ID | Severity | Issue | Evidence | Fix |
|---|---|---|---|---|
| R1 | High | No shared `packages/api-contracts` package. | Absent | Create shared schemas/types consumed by backend and frontend. |
| R2 | Medium | No OpenAPI/Swagger spec for the route surface. | `apps/backend/src/api/index.ts` | Generate OpenAPI from schemas and serve docs. |
| R3 | Low | `PiConsolidationAgent` is advertised but not part of the main pipeline. | `apps/backend/src/agents/PiConsolidationAgent.ts` | Document the trigger or remove the orphan. |
| R4 | Medium | `SchemaAnalysisAgentGraph.ts` returns dummy/stubbed results. | `apps/backend/src/agents/SchemaAnalysisAgentGraph.ts:57-83` | Implement, delete, or hide behind a feature flag. |
| R5 | Low | `MAX_PIPELINE_STEPS = 10` is an undocumented magic number. | `apps/backend/src/server.ts:365` | Move to config and document the safety bound. |
| R6 | Medium | Tag-state logic is duplicated across server, auto-processing, and pipeline. | `server.ts:292-341` and counterparts | Extract one `stateFromTags` utility. |
| R7 | Medium | File-size hotspots make core logic hard to review. | `TinyBaseService.ts`, `PiDocumentAgent.ts`, `PaperlessService.ts`, `ProcessingPipeline.ts` | Split by schema, persistence, API, and domain concerns. |

## Recommended Rework Sequencing

### Wave 1: Stop The Bleeding

1. Fix `L1`, `L4`, and `L2`: no emit on type errors, PR CI, and stricter Biome.
2. Fix `A1`, `A6`, `A5`/`I1`, and `A4`: remove query-param auth, sanitize logged
   headers, require secrets, and make CORS env-driven.
3. Fix `B1`, `B4`, and `D1`: remove Effect escapes, guard JSON parsing, and stop
   swallowing Paperless errors.
4. Fix `E2`, `E3`, and `E4`: add retries and timeouts for Mistral/Paperless/Ollama
   and agent prompts.
5. Fix `Q1`: add instruction/data delimiters for OCR text.

### Wave 2: Structural Correctness

6. Fix `C4`/`R1`: create shared API contracts.
7. Fix `C1`/`C2`: validate config through the schema.
8. Fix `E1`/`Q2`: implement the small-model verifier or remove the claim.
9. Fix `E5`-`E7`: single source of truth and deterministic resume.
10. Fix `J1`: structured logging with correlation IDs.
11. Fix `N1`: TinyBase schema versioning and migrations.

### Wave 3: Hardening And UX

12. Fix `P1`: frontend unit/component/E2E tests.
13. Fix `K1`, `K4`, and `K8`: dashboard split, i18n pass, React 19 forms.
14. Fix `A2`, `H3`, `H1`, and `H2`: rate limiting, LLM concurrency caps, cache, and SSE.
15. Fix `M1` and `M2`: clean up `.ref/` and root PNGs.
16. Fix `R2`, `J2`, and `J3`: OpenAPI, metrics, and tracing.

### Wave 4: Polish

17. Fix `Q5`-`Q10`: prompt quality, JSON mode, examples, confidence, and editable aliases.
18. Fix `R7` and `R6`: split large files and dedupe state logic.
19. Fix `L7` and `L6`: dependency policy and contributing guide.
20. Fix `K7`, `K11`, `K12`, and `K13`: frontend constants, accessibility, dead code, and callback churn.

## Critical Files To Touch

- `apps/backend/src/server.ts`
- `apps/backend/src/config/schema.ts`
- `apps/backend/src/config/index.ts`
- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/src/agents/PiTagExplorerAgent.ts`
- `apps/backend/src/agents/PiConsolidationAgent.ts`
- `apps/backend/src/agents/SchemaAnalysisAgentGraph.ts`
- `apps/backend/src/agents/OCRAgent.ts`
- `apps/backend/src/agents/ProcessingPipeline.ts`
- `apps/backend/src/agents/base.ts`
- `apps/backend/src/services/OllamaService.ts`
- `apps/backend/src/services/MistralService.ts`
- `apps/backend/src/services/TinyBaseService.ts`
- `apps/backend/src/services/AutoProcessingService.ts`
- `apps/backend/src/api/documents/handlers.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/page.tsx`
- `apps/web/components/sidebar.tsx`
- `biome.json`
- `apps/backend/tsconfig.json`
- `.github/workflows/`
- `lefthook.yml`

## Verification Plan

After Wave 1 lands:

1. Run `pnpm typecheck`, `pnpm lint`, and `pnpm test` locally and in CI.
2. Attempt the old `?api_key=` auth path against a fresh build and expect `401`.
3. Point Mistral config at a mock that returns `500`; confirm bounded retries,
   then a transient failure state.
4. Process a synthetic document containing `IGNORE PREVIOUS INSTRUCTIONS`; confirm
   the agent treats it as data.
5. Set `OLLAMA_URL` to a hanging endpoint; confirm prompt timeout and recoverable
   failure within the configured deadline.
6. Kill the backend mid-metadata phase; restart and confirm deterministic resume
   or clear recoverability.
7. Open two dashboard tabs and confirm polling load does not multiply unexpectedly.
8. Run new Playwright E2E coverage for settings save, queue drill-down, and manual
   review.
9. Run `pnpm exec biome check` and confirm unused function parameters fail.
10. Run `docker compose up --build`; confirm backend `/health` reports upstream
    service status.
