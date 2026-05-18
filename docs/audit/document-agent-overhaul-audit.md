# Independent Code & Architecture Audit — `document-agent-overhaul`

## Context

The `document-agent-overhaul` branch is a substantial in-flight rework (51 modified files, 16 untracked paths including new `cases/`, `catalog/`, `utils/`, `LockService`, `DocumentCaseService`, `CatalogAgentService` modules). You suspect that code quality and best practices were not consistently applied and that shortcuts were taken. This document is an independent, harsh-but-fair audit of what currently sits in the working tree. **Your stated intent is to fix all findings before merging**, so nothing below is filtered for "ship-blocker vs nice-to-have" — every finding is reported with severity and a concrete remediation suggestion. You decide the order.

The audit was produced by three parallel exploration passes (backend, frontend, infrastructure) and then verified against the live working tree by reading specific files and running counts directly. Where the exploration agents got something wrong, that is called out under **Corrections to initial findings**.

---

## Corrections to initial findings (read first)

Before the audit proper, two items reported by the exploration agents were **incorrect** and must not be acted on:

1. **"Live API tokens committed in `config.yaml`" — FALSE.** `config.yaml` is correctly listed in `.gitignore` and `git ls-files config.yaml` returns nothing. The file exists locally with real values, but it has never been committed. No key rotation is required on the basis of git history. (You may still want to rotate them if the dev machine isn't trusted, but that's a separate decision.)
2. **"611 `@ts-ignore` / 815 `TODO`/`FIXME`" — INFLATED.** Those counts came from including `node_modules/`. In application source (`apps/backend/src`, `apps/web/{app,lib,components}`) there are **0** `@ts-ignore` comments and **0** `TODO`/`FIXME`/`HACK` markers. That's actually a good signal — don't waste effort hunting them.

Everything else below was verified.

---

## Verified facts (snapshot)

| Metric | Value | Source |
|---|---|---|
| `Effect.catchAll(() => Effect.void)` occurrences | **152** in `apps/backend/src` | grep |
| `body as any` in `apps/backend/src/api` | **26** | grep |
| `console.*` calls in `apps/{backend/src,web/{app,lib,components}}` | **86** | grep |
| `any` type usages in backend src | **26** | grep |
| `PiDocumentAgent.ts` line count | **2538** | wc -l |
| `TinyBaseService.ts` line count | **1991** | wc -l |
| `ProcessingPipeline.ts` line count | **1074** | wc -l |
| `MaintenanceTab.tsx` line count | **1139** | wc -l |
| `api.ts` (frontend) line count | **1119** | wc -l |
| `apps/backend/prompts/` (source) | **does not exist** | find |
| biome `recommended` rules | **false (disabled)** | biome.json |
| `.ref/` directory size (gitignored) | **1.9 GB** | du -sh |
| Untracked source dirs | `api/cases/`, `api/catalog/`, `services/{CatalogAgentService,DocumentCaseService,LockService}.ts`, `utils/`, `web/app/{cases,catalog}/`, `web/app/documents/[id]/log/`, `tests/{api/cases.test.ts,api/chat.test.ts,config/,services/...}.ts`, `docs/plans/` | git status |

---

## BACKEND FINDINGS

### CRITICAL

#### B-C1. Silent-failure epidemic via `Effect.catchAll(() => Effect.void)`
- **Where:** 152 occurrences in `apps/backend/src/`, concentrated in `agents/ProcessingPipeline.ts` (lines 276, 301, 311, 335, 379, 381, …), case handlers, and TinyBase logging paths.
- **What's wrong:** Errors from lock release, heartbeat, case-state writes, processing logs, and Paperless calls are silently swallowed. The pipeline keeps moving as though the operation succeeded.
- **Why it matters:** A document can be marked "done" while its case state, locks, or audit log writes failed silently. The next run retries from scratch, potentially duplicating work or applying conflicting decisions. There is no audit trail to diagnose the divergence.
- **Suggested fix:**
  - Replace blanket `catchAll(() => Effect.void)` with either `Effect.tap` (fire-and-forget logging that does not change the outcome) or targeted `catchTag` that logs the specific failure and decides explicitly to continue.
  - For lock release / heartbeat / case-state writes: do **not** silence. Propagate, retry with bounded backoff, or fail the run.
  - As a quick triage pass, grep the codebase and audit each call site individually: which are truly "best-effort", which are masking real bugs.

#### B-C2. API handlers accept `body as any` with no validation (26 occurrences)
- **Where:** `apps/backend/src/api/index.ts` (e.g. line 92 `settingsHandlers.updateSettings(body as any)`), and across 19+ other routes.
- **What's wrong:** No schema validation at the HTTP boundary. Handlers blindly index into `body.x`, `body.answer`, etc. Malformed JSON crashes handlers; invalid types cause silent misbehavior.
- **Why it matters:** External (and internal frontend) callers can drive handlers into states the type system claims are impossible. Combined with the silent-failure pattern, bad inputs propagate deep into the pipeline before anything blows up.
- **Suggested fix:**
  - Adopt `@effect/schema` (you're already on Effect — use it natively) or Zod, define a schema per route, validate in a middleware before the handler runs.
  - Return `400 + structured validation errors` on parse failure.
  - Then change the handler signatures from `(_, body) => h(body as any)` to `(_, body) => h(MySchema.parse(body))`.

#### B-C3. Race condition in `activeDocumentIds` in-memory set
- **Where:** `apps/backend/src/agents/ProcessingPipeline.ts:136` (declaration), `:248` (check), `:284` (add), `:380` (delete).
- **What's wrong:** The set check + add are not atomic. Between `activeDocumentIds.has(docId)` and `activeDocumentIds.add(docId)`, another fiber can pass the check. The durable `LockService` is the real lock; the in-memory set adds nothing but a false sense of security and a class of bugs that only appear under load.
- **Why it matters:** Two concurrent requests can both pass the in-memory check, both attempt the durable lock, and a small window can let both processes start work on the same doc.
- **Suggested fix:** Delete `activeDocumentIds` entirely. Rely solely on `LockService`. If you genuinely need an in-process fast path, use a `Semaphore` / `Ref<Set<...>>` updated via `Ref.modify` (atomic) — but for this workload the durable lock is fine.

#### B-C4. Heartbeat fiber uses `Effect.fork` (not `forkDaemon`) and silences failures
- **Where:** `apps/backend/src/agents/ProcessingPipeline.ts:332-339`.
- **What's wrong:**
  ```ts
  const heartbeatFiber = yield* Effect.fork(
    Effect.forever(
      locks.heartbeat("document", docId, lock.runId).pipe(
        Effect.catchAll(() => Effect.void),
        Effect.zipRight(Effect.sleep(Duration.minutes(5))),
      ),
    ),
  );
  ```
  Two problems: (1) `Effect.fork` ties the heartbeat lifetime to the parent scope — your own `CLAUDE.md` explicitly says long-running fibers need `forkDaemon`; (2) silencing `heartbeat` errors means a DB-down condition causes the heartbeat to spin forever doing nothing, the server-side lock TTL expires, another worker can acquire it, and you now have two workers convinced they own the lock.
- **Why it matters:** Direct violation of the project's documented Effect convention, plus a real "lost mutex" hazard.
- **Suggested fix:**
  - Use `Effect.forkDaemon` (or, if you want the heartbeat to die with the run, keep `fork` — but then you must also `Fiber.interrupt` it in every failure path; verify all paths).
  - Do not silence heartbeat failures. After N consecutive heartbeat failures, interrupt the main effect and fail the run.
  - Heartbeat interval should be < (lock TTL / 3) so two missed beats don't lose the lock.

#### B-C5. Dry-run snapshot/restore is non-transactional and can corrupt case state
- **Where:** `apps/backend/src/agents/ProcessingPipeline.ts:176-228`.
- **What's wrong:** `snapshotCaseRows` reads TinyBase rows synchronously; `restoreCaseRows` deletes-then-reinserts row-by-row in an `Effect.sync`. If any intermediate write fails (or persistence is mid-flush and the process crashes), the store is left half-restored.
- **Why it matters:** A failed dry-run can permanently corrupt the case that was being previewed — opposite of the user's intent.
- **Suggested fix:**
  - Strongly prefer: do dry-runs against a *cloned* store (TinyBase supports `createStore().setTables(otherStore.getTables())`), apply changes to the clone, throw the clone away. Never touch live state during dry-run.
  - If that's impractical, at minimum wrap the snapshot/restore in TinyBase's `store.transaction(() => { … })` so persistence treats it as one unit.

#### B-C6. `JSON.parse` on Ollama stream chunks without try/catch
- **Where:** `apps/backend/src/services/OllamaService.ts:262, :353`.
- **What's wrong:** Malformed JSON throws synchronously inside an `async` IIFE that lives outside the Effect runtime. The error is uncaught (or caught only by the IIFE's bare try, depending on path), the consumer hangs, and the client sees a timeout instead of an actionable error.
- **Suggested fix:** Wrap the parse in try/catch, on parse error call `emit.fail(new OllamaError({ … }))` and return — let the stream surface the failure.

#### B-C7. `apps/backend/prompts/` source directory does not exist
- **Where:** `CLAUDE.md` mandates prompts live at `apps/backend/prompts/{lang}/` and are loaded via `PromptService`. The Dockerfile copies it. But `find apps/backend -type d -name prompts` returns only `apps/backend/dist/api/prompts` (a build artifact) — there is **no source `prompts/` directory**.
- **What's wrong:** Either (a) prompts have been moved/inlined somewhere else in the overhaul (which would directly violate "NEVER hardcode prompts in code"), or (b) the source prompts are committed-but-deleted-in-this-branch / never tracked, in which case Docker builds will fail.
- **Why it matters:** This is a project-level invariant called out explicitly in CLAUDE.md. Whichever explanation is true, it needs to be resolved before merge.
- **Suggested fix:** Determine what happened. Either restore the `prompts/` dir from `main`, or — if the rework moved them — update CLAUDE.md, the Dockerfile, and the loader path together. Audit the new agent code for hardcoded prompt strings.

---

### HIGH

#### B-H1. `PiDocumentAgent.ts` is 2538 lines; `createTools` alone defines ~10 tools with shared mutable refs
- **Where:** `apps/backend/src/agents/PiDocumentAgent.ts`.
- **What's wrong:** A single file with one giant `createTools` factory whose nested tool closures share `pausedRef`, `appliedRef`, `finalToolRef` mutable refs. Refactoring or even reading the file end-to-end is dangerous because any reader has to hold ~2500 lines of context simultaneously.
- **Why it matters:** This is the centerpiece of the rework. If it's unmaintainable on day one of the rework, it will only decay.
- **Suggested fix:** Split into `agents/document-agent/{index.ts, tools/*.ts, state.ts, events.ts}`. One file per tool. The state refs become an explicit `AgentState` object/service with typed accessors (`applyDecision`, `markPaused`, `recordFinalTool`) — eliminates the "anyone can mutate the ref anywhere" hazard.

#### B-H2. `TinyBaseService.ts` is 1991 lines and exposes its raw `store` to callers
- **Where:** `apps/backend/src/services/TinyBaseService.ts`; direct `tinybase.store.getRow(...)` access from `ProcessingPipeline.ts:461` and elsewhere.
- **What's wrong:** Two problems compounding: (1) the service is too large to comprehend; (2) exposing `store` means callers bypass the service abstraction entirely, so the service's claimed encapsulation is fictional. Migrating to a different store later means touching every caller.
- **Suggested fix:**
  - Stop exporting `.store`. Expose typed methods (`getCasePhase(docId)`, `setCasePhase(...)`, `appendProcessingLog(...)`) and force callers through them.
  - Split TinyBaseService by concern: persistence/lifecycle in one file, table-specific accessors per feature (cases, queue, logs) in separate modules.

#### B-H3. No runtime validation that TinyBase rows match the declared schema
- **Where:** `apps/backend/src/services/TinyBaseService.ts` schema; consumers like `DocumentCaseService.ts:358-365`.
- **What's wrong:** TinyBase schemas are advisory, not enforcing. Code routinely does `(row?.questionIds as string[]) ?? []` — if persisted data is a number or a single string, `.map` blows up at runtime.
- **Suggested fix:** Either (a) add a thin `validateRow(table, row)` that runs on every read at boundaries and logs/coerces on mismatch, or (b) move case/queue state to `@effect/schema` types with `Schema.decode` at the persistence boundary so all internal code can trust the shape.

#### B-H4. `normalizeStep` silently maps unknown steps to "metadata"
- **Where:** `apps/backend/src/agents/ProcessingPipeline.ts:700-704`.
- **What's wrong:** `if (step === "ocr") return "ocr"; if (...) return "index"; return "metadata";` — any unknown string is "metadata". No log, no fail. Combined with B-C2 (no input validation), bad client input can quietly trigger metadata reprocessing on documents that should be in a different phase.
- **Suggested fix:** Whitelist explicitly and throw on unknown values. Or model `step` as a tagged union with `Schema.decode` and let the type system reject anything else.

#### B-H5. Lock recovery logic is duplicated and divergent
- **Where:** `apps/backend/src/api/cases/handlers.ts` — `recoverStaleActiveWorkflowTag` (line 93) and `reconcileRunningCase` (line 192).
- **What's wrong:** Two functions implement near-identical stale-lock + workflow-tag reconciliation, but with subtly different conditions and transitions. Bugfixes to one will silently miss the other.
- **Suggested fix:** Extract a single `reconcileCase(caseId, opts)` used by both call sites. Add a test that fixes the shape of reconciliation.

#### B-H6. Cases/catalog code is brand-new and barely tested
- **Where:** `apps/backend/src/api/cases/`, `apps/backend/src/api/catalog/`, `apps/backend/src/services/{DocumentCaseService,CatalogAgentService,LockService}.ts`. Tests exist (`tests/api/cases.test.ts`, `tests/services/{DocumentCaseService,CatalogAgentService,LockService}.test.ts`) but they are unstaged and brand-new.
- **What's wrong:** Core new infrastructure (cases, catalog, durable locking, agent orchestration) with minimal coverage. No tests for: lock race recovery, dry-run rollback correctness, case state transitions under failure, concurrent agent runs.
- **Suggested fix:** Before merge, write integration tests that:
  - Acquire a lock, kill the holder, prove another worker can recover it after TTL.
  - Run a dry-run that fails partway, prove case state is unchanged.
  - Drive a case through every state transition + every failure path.
  - Drive two concurrent runs on the same docId and assert one is rejected.

#### B-H7. Effect/async mixing in `OllamaService` streams
- **Where:** `apps/backend/src/services/OllamaService.ts:222-282, :313-373`.
- **What's wrong:** `Stream.asyncEffect` wraps an `Effect.gen` that fires an async IIFE for the actual streaming. The IIFE isn't tracked by Effect — if the outer Effect completes/cleans up, the IIFE may still be mid-read.
- **Suggested fix:** Replace with `Stream.async` (or `Effect.async` for non-stream cases) and wire the `AbortController.abort` into the interruption callback. That way Effect's interruption model actually cancels the inner I/O.

#### B-H8. Unbounded integer parsing of URL params
- **Where:** `apps/backend/src/api/index.ts:184, :300, :304, :308, :313, :322, :327, :334, :338, :353, …` — 20+ sites.
- **What's wrong:** `parseInt(params.x!, 10)` without `Number.isFinite` check. NaN, negative, or huge values flow through.
- **Suggested fix:** Build a small helper `parseId(s: string): Effect.Effect<number, ValidationError>` and use it uniformly. Or fold it into the schema-validation work in B-C2.

#### B-H9. No request/response logging middleware
- **Where:** `apps/backend/src/server.ts`, `apps/backend/src/api/index.ts`.
- **What's wrong:** When a user reports "my request hung", you have nothing to look at. Combined with the silent-failure pattern, you're flying blind in production.
- **Suggested fix:** Minimal middleware: log `method path → status duration` per request, with a request-id propagated through Effect context. If using Hono, this is `app.use(logger())`.

#### B-H10. No TinyBase schema versioning / migration path
- **Where:** `apps/backend/src/services/TinyBaseService.ts`.
- **What's wrong:** No version stamp on persisted data. Schema changes between deployments will either silently corrupt reads or crash on startup.
- **Suggested fix:** Stamp `schemaVersion` in a `meta` table. On startup, compare to current; run registered migrations or refuse to start with a clear error.

---

### MEDIUM

#### B-M1. ~63 `console.log/warn/error` calls in backend src
- **Where:** `apps/backend/src/{index.ts, server.ts, services/AutoProcessingService.ts, services/TinyBaseService.ts, …}`.
- **Suggested fix:** Adopt a structured logger (`pino` or `@effect/platform` `Console` service). Levels, JSON output, single sink. Replace ad-hoc `console.*` mechanically. (Note: the system logger probably overlaps with the request-logging middleware in B-H9 — design them together.)

#### B-M2. Defaults are duplicated across `OllamaService`, `config/index.ts`, `api/settings/handlers.ts`
- **Suggested fix:** Single `DEFAULTS` constant exported from `config/`. Every fallback (`?? "neural-chat"` etc.) reads from it.

#### B-M3. `.catchAll(() => Effect.succeed(null))` swallows distinguishable failures
- **Where:** e.g. `apps/backend/src/api/cases/handlers.ts:104-111, :152, :165`.
- **What's wrong:** Caller cannot distinguish "row doesn't exist" from "network broke / DB error". UI shows the same empty state for both.
- **Suggested fix:** Catch specific tags. `catchTag("NotFound", () => succeed(null))` is fine; everything else should bubble up or at least log.

#### B-M4. OCR subprocess has no timeout
- **Where:** `apps/backend/src/agents/OCRAgent.ts` (around the searchable-PDF spawn).
- **Suggested fix:** Wrap with `Effect.timeout(Duration.seconds(N))` — N tunable via config. Same applies to any other long-running external call.

#### B-M5. Hardcoded magic durations (heartbeat 5min, debounce 500ms, lock TTL 15min)
- **Suggested fix:** Move to config schema with defaults; don't sprinkle through code.

#### B-M6. Hand-rolled HTTP router with regex path patterns
- **Where:** `apps/backend/src/api/index.ts:50-70`.
- **What's wrong:** Custom router doesn't handle wildcards or constrained params; regex assembly is brittle. The project already has `hono` as a stated dependency.
- **Suggested fix:** Use Hono's router directly. Removes the custom code entirely.

#### B-M7. Case phase / automation status are loose unions, not branded
- **Where:** `apps/backend/src/services/DocumentCaseService.ts:17-25`.
- **Suggested fix:** Either `enum` with `Object.values(...)` for the validation list, or `Schema.literal(...)` so the schema is the single source of truth.

#### B-M8. `Effect.sync` blocks doing TinyBase writes inside `Effect.ensuring`
- **Where:** `ProcessingPipeline.ts:195-220`.
- **Suggested fix:** Wrap writes in `store.transaction`, surface errors instead of swallowing them inside `Effect.sync`.

---

### LOW

- **B-L1.** Inconsistent error class hierarchy (`AgentError`, `OllamaError`, `DatabaseError`, `NotFoundError` — no common ancestor / shape).
- **B-L2.** Inconsistent naming (`docId` vs `documentId`) — pick one and grep-rename.
- **B-L3.** Public service functions lack JSDoc describing what they do, what errors they raise, what side effects they have.
- **B-L4.** Tag config keeps deprecated aliases (`todo`/`pending`, `done`/`processed`, `ocr`/`ocrDone`) with no migration plan.
- **B-L5.** Some files import from `services/X.js` directly; others go through `services/index.js`. Pick one.

---

## FRONTEND FINDINGS

### CRITICAL

#### F-C1. `CaseQuestionChoice` is referenced but not exported; `QuestionComposer` reads fields that don't exist on the API type
- **Where:** `apps/web/app/documents/[id]/page.tsx:110-111, :132, :134`.
- **What's wrong:** `QuestionComposer` types `savingChoice: CaseQuestionChoice | null` but no such type is exported from `lib/api.ts`. The component then reads `question.choices` and `question.question` which aren't fields on the API `CaseQuestion` type either. This is a half-finished refactor.
- **Why it matters:** TypeScript only catches this if strict mode is enforced cleanly. At runtime, this component will read `undefined` and either render empty UI or throw on access.
- **Suggested fix:** Decide the canonical shape (`candidate` / `alternatives` from the proposal model vs. `choices` from the legacy model), update both `api.ts` and the component, delete the dead code path.

#### F-C2. UI strings hardcoded despite i18n being set up
- **Where:** `apps/web/app/documents/[id]/page.tsx:102-107` (`ENTITY_LABELS = { correspondent: "Correspondent", … }`), `:180, :210, :266, :306, :486, :502, :513`. Same pattern in dashboard and settings.
- **What's wrong:** `next-intl` is wired in (`messages/{en,de}.json` exist) but a large fraction of strings bypass it. German users see English text inline with translated labels.
- **Suggested fix:** Run through each large client component, replace string literals with `t("…")`, fill keys in both `en.json` and `de.json`. Add an ESLint rule (or a Biome custom rule) to catch new hardcoded strings in JSX.

#### F-C3. No `error.tsx` boundaries at route level; uncaught client errors crash whole subtrees
- **Where:** Missing from `apps/web/app/documents/`, `apps/web/app/settings/`, `apps/web/app/cases/`, `apps/web/app/catalog/`.
- **What's wrong:** A single API failure or stale-shape mismatch will crash the whole route. App Router gives you `error.tsx` per segment for exactly this — it's unused.
- **Suggested fix:** Add `app/<segment>/error.tsx` for each top-level segment. Minimum: render the error message + a "retry" button (`reset()` from the error boundary props).

#### F-C4. Secrets pass through TinyBase store
- **Where:** `apps/web/lib/tinybase/provider.tsx:236-250` (sync of `paperless.token`, `mistral.api_key` into the local store).
- **What's wrong:** Even though `SecretInput` masks the *display*, the underlying store row holds plaintext. Anything that serializes the store (devtools dumps, future "export settings" features, error reporters) will leak.
- **Why it matters:** Defense-in-depth; users don't expect secrets entered in a settings form to land in client-side state with the same lifecycle as everything else.
- **Suggested fix:**
  - Never write secrets back into the synced store after the initial save.
  - For input, hold the value in component-local `useState`, send on submit, then zero it.
  - On read-back from backend, return a `"********"` placeholder + an `isSet: boolean`; never round-trip the real value.

#### F-C5. No runtime schema validation of backend responses
- **Where:** `apps/web/lib/api.ts` (entire file, ~1119 lines of hand-written types).
- **What's wrong:** Types are manually mirrored from the backend, with `fetchApi<T>` casting JSON to `T`. Any backend shape drift produces silent runtime UI breakage with no error surface.
- **Suggested fix:**
  - Adopt `zod` (or `@effect/schema` shared with the backend) for response shapes.
  - Or generate types + parsers from an OpenAPI/JSON-schema export of backend handlers. (Pairs naturally with B-C2 — once the backend has request schemas, the response schemas are a small step.)

---

### HIGH

#### F-H1. Monolithic client components
- **Where:** `settings/components/MaintenanceTab.tsx` (1139 lines), `settings/components/ConnectionsTab.tsx` (715), `documents/[id]/log/page.tsx` (683), `documents/[id]/page.tsx` (901), `app/page.tsx` (561).
- **What's wrong:** Single components manage many `useState`s, multiple polling intervals, multiple API loaders, rendering, error handling. Untestable, unrefactorable.
- **Suggested fix:** Extract: per-section subcomponents; polling logic into `usePolling(fn, intervalMs)`; loaders into `useAsyncResource`; per-feature contexts to kill prop drilling. Target: no client component over ~250 lines.

#### F-H2. Overlapping polling intervals with no cancellation
- **Where:** `MaintenanceTab.tsx:162-184` — three separate `setInterval`s for bootstrap / bulk OCR / bulk ingest.
- **What's wrong:** Intervals not coordinated; no `AbortController`; navigating away leaks intervals; three parallel responses can race-overwrite shared state.
- **Suggested fix:** One `useInterval` driving `Promise.all` of the three loaders. `AbortController` per fetch, aborted in the effect cleanup. Discard responses for stale `loadId` if user clicked refresh manually.

#### F-H3. `useEffect` dependency cycles re-creating callbacks
- **Where:** `ConnectionsTab.tsx:235-243` (testConnection in deps), `documents/page.tsx:132-168` (`fetchDocuments` depends on `tagMap` which is set by a separate effect).
- **What's wrong:** Each render redefines the callback → effect fires → state changes → callback redefined → effect fires again. Either a render loop or a hidden N+1.
- **Suggested fix:** Move `tagMap` into a memoized derivation (`useMemo`), stabilize callbacks with `useCallback` + the minimum dep set, or move the data into a real cache layer (SWR/TanStack Query) that does this for you.

#### F-H4. Local state in editable forms is desynced by parent re-fetches
- **Where:** `MaintenanceTab.tsx:1025-1034` (`ScheduledJobSection` local copies of `jobInfo` fields).
- **What's wrong:** Parent re-fetch → new `jobInfo` prop → `useEffect` resets `localEnabled` / `localSchedule` / `localCron` → user's unsaved edits vanish.
- **Suggested fix:** Either (a) make the form fully uncontrolled (commit on submit), or (b) track a dirty flag and only re-sync from props when the form is clean.

#### F-H5. Every page independently fetches `/api/settings`
- **Where:** `app/page.tsx`, `app/documents/page.tsx`, `app/documents/[id]/page.tsx`, and most settings tabs.
- **What's wrong:** No shared cache. N concurrent requests per app load. Stale settings if one page has them cached and another refetches.
- **Suggested fix:** TinyBase is already the local cache layer — bind settings into the provider once, expose a `useSettings()` hook, fetch on mount, refresh on save. Eliminate the per-page `fetch`.

#### F-H6. Inconsistent error handling: some throw, some `result.error`, some swallow
- **Where:** `app/documents/page.tsx:190-215` (try/catch), `settings/components/AiTagsTab.tsx:109-111` (silent catch), `lib/api.ts` (returns `{error}` shape).
- **What's wrong:** Three patterns mean every consumer reinvents the wheel and most do it wrong.
- **Suggested fix:** Pick one. Recommendation: standardize on `fetchApi` returning a discriminated union (`{ ok: true, data } | { ok: false, error }`); wire a global toast for `!ok` results at the page/layout level.

#### F-H7. Layout metadata is hardcoded German-only; no per-route `generateMetadata`
- **Where:** `apps/web/app/layout.tsx:8-11`.
- **Suggested fix:** Switch `metadata` to a `generateMetadata` that pulls locale from the request. Provide per-route metadata for `documents/[id]`, `cases`, etc.

#### F-H8. Cascading loaders fail silently (e.g. tag metadata)
- **Where:** `settings/components/AiTagsTab.tsx:79-118` — loops tags fetching metadata one by one, swallows per-tag failures.
- **Suggested fix:** Track per-tag `loading/error` state; show partial errors with retry; consider a single backend endpoint that returns all tag metadata in one round trip (also reduces N+1).

---

### MEDIUM

#### F-M1. ~1916 `console.*` calls reported repo-wide; verify and prune
- **Note:** This count includes `.next/` build artifacts. Real source-only number is much lower but still meaningful. Run `grep -rn "console\." apps/web/{app,lib,components}` for an accurate baseline. Replace dev-only logs with a `debug(...)` wrapper that no-ops in production.

#### F-M2. Inline functions in render
- **Where:** `documents/[id]/page.tsx:381-416` and similar. Hand-pick the hot ones (long lists, frequent re-renders) and stabilize.

#### F-M3. Semantic HTML / accessibility gaps
- **Where:** `<div role="link">` in document tables; missing aria-labels on icon buttons; no aria-live regions on async status updates.
- **Suggested fix:** Use real `<a>` / `<button>` elements; add `aria-label` on icon-only buttons; mark live status regions with `role="status"` or `aria-live="polite"`.

#### F-M4. TinyBase ↔ API key mismatch via manual `API_TO_STORE_KEY_MAP`
- **Where:** `apps/web/lib/tinybase/provider.tsx:115`.
- **What's wrong:** Hand-maintained two-way map between dotted store keys and flat API keys. Adding a backend field silently drops on the floor unless you remember to update this map.
- **Suggested fix:** Either align the conventions (backend emits dotted keys directly) or generate the map from a shared schema definition.

#### F-M5. Race condition on document detail load
- **Where:** `documents/[id]/page.tsx:181-209` — `Promise.all` of `documentsApi.get` + `casesApi.getForDocument`. Navigation while inflight can overwrite newer state.
- **Suggested fix:** `AbortController` cancelled on unmount or route change; or use a query library.

#### F-M6. No optimistic updates in settings forms
- **Suggested fix:** Update local state immediately on save; revert if API returns error. Mostly UX, but on slow LLM/Paperless tests it's perceptible.

#### F-M7. `QuestionComposer` vs `ProposalQuestion` naming hides the discriminator
- **Where:** `documents/[id]/page.tsx:102, :126`.
- **Suggested fix:** Tag the question type with a discriminated union (`type: "legacy" | "proposal"`), let TypeScript narrow.

#### F-M8. Hardcoded `API_BASE = ""` duplicated in three files
- **Where:** `lib/api.ts:5`, `ConnectionsTab.tsx:34`, `AiTagsTab.tsx:38`.
- **Suggested fix:** Single export from `lib/api.ts`, read once from `process.env.NEXT_PUBLIC_API_URL` with `""` fallback.

---

### LOW

- **F-L1.** Unused state declared with `_` prefix (e.g. `_hasChanges` in `AiTagsTab.tsx:50, :59`) — remove or use.
- **F-L2.** Magic dimensions (`h-[1000px]`, `calc(100vh-280px)`, `30000`) — collect into `lib/constants.ts`.
- **F-L3.** Date formatting mixed (`toLocaleDateString` vs `toLocaleString`); no locale-aware util.
- **F-L4.** No `loading.tsx` at segment level alongside the new `error.tsx` work (F-C3).
- **F-L5.** Duplicate type definitions: e.g. `QueueStats` defined in `app/page.tsx:29-39` and again in `api.ts`.

---

## INFRASTRUCTURE / PROJECT FINDINGS

### CRITICAL

*(No genuinely critical infra issues after the `config.yaml` false alarm was retracted. The closest is B-C7 — missing `prompts/` directory — but that's been folded into the backend section.)*

### HIGH

#### I-H1. Biome linter is effectively off (`"recommended": false`)
- **Where:** `biome.json:36-43`.
- **What's wrong:** Setting `recommended: false` disables every recommended rule. The only rules left are three `correctness` rules, two as `warn` (which CI/devs ignore) and one as `off`. Combined with the recent ESLint→Biome migration commit, this means lint quality regressed in the same change that "switched to biome".
- **Suggested fix:**
  ```jsonc
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "error",
        "noUnusedVariables": "error",
        "noUnusedFunctionParameters": "warn"
      },
      "suspicious": { /* enable explicit-any guard once codebase is clean */ },
      "style": { /* curate */ }
    }
  }
  ```
  Expect a one-time large auto-fix + manual cleanup pass. After it lands, the linter actually starts pulling weight.

#### I-H2. No Docker `healthcheck` defined on backend or frontend
- **Where:** `docker-compose.yml`.
- **Suggested fix:** Backend: add `GET /api/health` (you already have `/health` at line 84 of `api/index.ts` — verify the path your healthcheck hits matches). Frontend: hit `/`. Define in compose with `interval`/`retries`/`start_period`.

#### I-H3. CI uses an undocumented self-hosted ARC runner with no fallback
- **Where:** `.github/workflows/docker-publish.yml:20, :65` — `runs-on: arc-paperless-local-llm`.
- **Suggested fix:** Document the runner in `README.md` (where it lives, how to set it up). Either pin to that runner for the canonical repo and fall through to `ubuntu-latest` for forks, or move the slow steps to a self-hosted runner only when needed.

#### I-H4. Massive uncommitted change set on `document-agent-overhaul`
- **Where:** `git status` — 51 modified, 16 untracked paths.
- **What's wrong:** All this work is currently un-versioned. Power loss = total loss. Reviewers can't see it.
- **Suggested fix:** Commit in logical chunks now, even if you'll squash later. At minimum: (a) the new services (`LockService`, `DocumentCaseService`, `CatalogAgentService`), (b) the new API routes (`cases/`, `catalog/`), (c) the agent rework (`Pi*Agent`, `ProcessingPipeline` changes), (d) the frontend additions (`app/cases/`, `app/catalog/`), (e) tests, (f) config schema changes. Keeps history reviewable.

### MEDIUM

#### I-M1. TypeScript strictness is partial
- **Where:** `apps/backend/tsconfig.json` (`strict: true`, `noUncheckedIndexedAccess: true`, but missing `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`).
- **Suggested fix:** Turn on `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`. Expect compile errors; fix them as they appear (most will be at TinyBase row reads — overlaps nicely with B-H3).

#### I-M2. Dead `packages/eslint-config/` still referenced in `Dockerfile.frontend`
- **Where:** `Dockerfile.frontend` lines copying `packages/eslint-config/`. The directory contains only `node_modules` after the Biome switch.
- **Suggested fix:** Delete the directory; remove the COPY lines.

#### I-M3. Turbo `inputs` not specified — any file change invalidates the cache
- **Where:** `turbo.json` build/test tasks.
- **Suggested fix:** Add `"inputs": ["src/**", "package.json", "tsconfig.json", "biome.json"]` etc. so doc/readme edits don't bust the cache.

#### I-M4. `gitleaks` is required by lefthook but not a managed dependency
- **Where:** `lefthook.yml`, `package.json`.
- **Suggested fix:** Either bundle via a Node wrapper, or document the install in `README.md` setup section. Verify CI runs it too as a second gate.

#### I-M5. `.ref/` reference clones consume 1.9 GB locally
- **Where:** `.ref/{openclaw,paperless-ngx,paperless-gpt,pi}/`. Gitignored, so not a repo issue, but a dev-env one.
- **Suggested fix:** Replace with submodules (versioned, sparse-checkout-able) or a `scripts/fetch-refs.sh` you run on demand. Add a guard to fail the build if `apps/backend/dist` accidentally references files under `.ref/`.

#### I-M6. `apps/backend/prompts/` source dir missing (also B-C7)
- See backend section.

### LOW

- **I-L1.** Biome line width 100 — fine, just unusual; note in `CONTRIBUTING.md`.
- **I-L2.** Required env vars not tabulated in `README.md` (only buried in Docker examples).
- **I-L3.** Commit messages in the branch could be cleaner — `feat:` / `fix:` / `chore:` prefixes are inconsistent; nothing references issues.
- **I-L4.** No PR/issue templates in `.github/`.

---

## CROSS-CUTTING THEMES

Reading across all three buckets, three patterns explain most of the individual findings:

1. **Errors are systemically silenced.** `Effect.catchAll(() => Effect.void)` on the backend; bare try/catch and `console.error(e)` on the frontend; `result.error && return null` everywhere. This is the single biggest quality risk and most of the CRITICAL findings reduce to it. Fixing this *first* will surface other bugs you can't currently see — be ready for that.
2. **Boundaries are unvalidated.** No request schemas, no response schemas, no TinyBase row validation, no LLM output validation. The type system claims invariants the runtime never enforces. Half of the HIGH findings reduce to "add a schema here".
3. **Files have grown past the point of comprehension.** `PiDocumentAgent` (2538), `TinyBaseService` (1991), `ProcessingPipeline` (1074), `MaintenanceTab` (1139), `api.ts` (1119). These were each "one more feature" away from being too big to safely change. They are now there.

Everything else is a local symptom of one of those three.

---

## Critical files to read end-to-end before deciding fix order

Even though you asked for no roadmap, you'll want to read these in full before sequencing the work — they touch everything else:

- `apps/backend/src/agents/ProcessingPipeline.ts` (1074 lines) — central control flow + most of the silent-failure and race-condition findings.
- `apps/backend/src/agents/PiDocumentAgent.ts` (2538 lines) — the rework's centerpiece.
- `apps/backend/src/services/TinyBaseService.ts` (1991 lines) — the data layer; touched by almost every backend issue.
- `apps/backend/src/api/index.ts` (full file) — the `body as any` and routing surface.
- `apps/backend/src/services/{LockService,DocumentCaseService,CatalogAgentService}.ts` — new, untracked, central to the rework.
- `apps/web/lib/api.ts` (1119) and `apps/web/lib/tinybase/provider.tsx` — the frontend's only contract with the backend.
- `apps/web/app/settings/components/MaintenanceTab.tsx` (1139) — worst offender among client components.
- `biome.json` (already corrected above) and `apps/backend/tsconfig.json` (strictness gaps).

---

## How to verify the audit once you start fixing

Reading the audit isn't enough — keep a way to confirm the fixes actually land:

- **Re-run the grep counts** in the "Verified facts" table after each pass. Track `Effect.catchAll(() => Effect.void)` and `body as any` toward zero (or toward a known whitelist).
- **`pnpm --filter backend test`** must stay green; expand `tests/agents/ProcessingPipeline.test.ts` with the race / failure scenarios from B-H6.
- **`pnpm --filter backend typecheck`** under tightened `tsconfig.json` (I-M1).
- **`pnpm lint`** under restored Biome rules (I-H1) — expect a flood the first time.
- **End-to-end:** start the stack (`pnpm dev:portless`), drive a full document through the pipeline (OCR → metadata → index → done), then re-drive one with a forced lock contention and another with a forced upstream error; assert state isn't corrupted.

---

*Audit complete. No fix order is recommended per your request — every finding above includes the location, the problem, why it matters, and a concrete suggestion, so you can sequence the work however suits the rework's other constraints.*
