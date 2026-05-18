# Audit Rework Task Backlog

This is the implementation task list for
[`docs/AUDIT.md`](../AUDIT.md). Each task maps to audit finding IDs and has a
concrete acceptance target. Keep tasks small enough to review independently.

Status legend:

- `[ ]` not started
- `[~]` in progress
- `[x]` done
- `[!]` blocked

## Execution Rules

- Do not batch unrelated waves into one pull request.
- Recheck evidence line numbers before editing because the branch is active.
- Preserve user changes already present in the working tree.
- For backend changes, keep `pnpm run typecheck`, `pnpm run lint`, and
  `pnpm run test` green.
- For frontend changes, add tests before or with behavior changes, not after.

## Wave 1: Stop The Bleeding

### W1-S1: Enforce Build And Review Gates

Status: `[x]`

Findings: `L1`, `L2`, `L4`

- [x] Set backend TypeScript to stop emitting when type errors exist.
- [x] Enable unused function parameter checks in Biome, keeping the `_name`
  convention for intentional unused parameters.
- [x] Add a PR CI workflow that installs dependencies and runs typecheck, tests,
  and lint.
- [x] Run the same commands locally and document any failures that must be fixed
  before merge.

Acceptance:

- `pnpm typecheck`, `pnpm lint`, and `pnpm test` run in CI on pull requests.
- A deliberate backend type error fails build output.
- A deliberate unused function parameter fails lint unless prefixed with `_`.

### W1-S2: Close Immediate Security Gaps

Status: `[x]`

Findings: `A1`, `A4`, `A5`, `A6`, `I1`

- [x] Remove `?api_key=` authentication support from the backend.
- [x] Keep only `Authorization: Bearer ...` and `X-API-Key` auth paths.
- [x] Replace hardcoded CORS origins with an env/config allow-list.
- [x] Require production secrets at startup and fail fast with clear validation
  errors.
- [x] Sanitize request headers before error logging.

Acceptance:

- Requests using `?api_key=` return `401`.
- Missing required secrets fail during startup validation.
- Logs never include raw `Authorization`, `X-API-Key`, Paperless token, or Mistral
  API key values.

### W1-S3: Restore Effect And Error-Channel Discipline

Status: `[x]`

Findings: `B1`, `B4`, `D1`

- [x] Replace nested `Effect.runPromise` calls inside Pi tool callbacks with a
  cleaner Effect/Pi boundary.
- [x] Guard agent JSON parsing and return tagged agent errors.
- [x] Stop returning silent zeroed queue stats when Paperless is unreachable.
- [x] Add tests for JSON parse failure and Paperless unreachable behavior.

Acceptance:

- No `Effect.runPromise` remains inside Effect generators for agent sub-effects.
- Malformed model/tool JSON produces a structured agent error.
- UI/API can distinguish empty queue from Paperless unavailable.

### W1-S4: Add External Call Retries And Timeouts

Status: `[x]`

Findings: `E2`, `E3`, `E4`, `Q3`

- [x] Add retry policy for transient Mistral OCR/API failures.
- [x] Add fetch timeout config for Mistral, Paperless, and Ollama calls.
- [x] Wrap `agent.prompt()` with a configured timeout.
- [x] Ensure timeout/failure state is visible in case logs and API responses.
- [x] Add tests/mocks for Mistral 5xx retry and hanging Ollama/Paperless/Mistral
  endpoint timeouts.

Acceptance:

- Mistral 5xx is retried with bounded backoff.
- Hanging Ollama/Paperless/Mistral endpoints fail within configured timeout.
- A timed-out document lands in a recoverable failed/transient state.

### W1-S5: Add Prompt Injection Data Boundaries

Status: `[x]`

Findings: `A3`, `Q1`

- [x] Wrap OCR/document text in explicit data delimiters.
- [x] Update system instructions to say delimited document content is data only.
- [x] Apply the same pattern to consolidation prompts that ingest
  user/archive content.
- [x] Add red-team tests with malicious OCR text.

Acceptance:

- Prompt construction consistently separates instructions from document data.
- A fixture containing `IGNORE PREVIOUS INSTRUCTIONS` does not alter tool or
  metadata behavior.

## Wave 2: Structural Correctness

### W2-S6: Introduce Shared API Contracts

Status: `[x]`

Findings: `C4`, `R1`, `D3`, `R2`

- [x] Create `packages/api-contracts`.
- [x] Move shared schemas/types for API requests, responses, and errors into the
  package.
- [x] Update backend route handlers to validate through shared schemas.
- [x] Update frontend API client to import shared response/request types.
- [x] Prepare OpenAPI generation from the same schema source.

Acceptance:

- Backend and frontend no longer duplicate contract types.
- Invalid request bodies return consistent structured `400` responses.
- Contract changes fail both apps at compile time when consumers drift.

### W2-S7: Make Config Validation Real

Status: `[x]`

Findings: `C1`, `C2`, `A5`, `I1`, `I2`, `I3`, `I4`

- [x] Decode merged config through `AppConfigSchema`.
- [x] Remove double-casts such as `as unknown as ResolvedConfig`.
- [x] Require absolute/env-driven config path in production.
- [x] Make Mistral endpoint configurable.
- [x] Document Portless and localhost fallback behavior.

Acceptance:

- Invalid config fails startup with field-level errors.
- No config path parent-walk surprise in production mode.
- Mistral base URL can be set without editing source.

### W2-S8: Decide And Implement Verification Loop

Findings: `E1`, `Q2`, `Q9`

- [x] Keep the Large Model -> Small Model verification claim and implement it.
- [x] Implement a small-model verifier with structured
  `{ confirmed, feedback }` output.
- [x] Wire verifier into `runConfirmationLoop`.
- [x] Add confidence output to metadata completion and apply threshold behavior.
- [x] Update README/CLAUDE/config docs consistently with the retained verifier.

Acceptance:

- Docs and code agree.
- Metadata auto-apply is gated by verifier/threshold when enabled.
- Verifier failure produces actionable case feedback, not silent retry churn.

### W2-S9: Make Pipeline State Deterministic

Findings: `E5`, `E6`, `E7`, `G1`, `G2`

- [x] Choose the authoritative state store for case phase and applied fields.
- [x] Project Paperless workflow tags from that state in one transaction-like
  operation.
- [x] Pin/log model seed for resumable runs.
- [x] Rebuild prompt/catalog context on every resume.
- [x] Persist OCR result hash and skip duplicate OCR work.
- [x] Track per-field applied timestamps and prevent resume overwrites.

Acceptance:

- Crash/restart dry-runs resume to the same decisions or a clearly recoverable
  state.
- Already-applied metadata is not overwritten by a resumed run unless explicitly
  requested.
- Paperless tags and case phase do not diverge after partial failure.

### W2-S10: Add Structured Logging

Findings: `J1`, `B6`, `D4`

- [x] Adopt one structured backend logger.
- [x] Add request IDs and propagate document/case/run IDs through logs.
- [x] Replace ad-hoc `console.*` calls in backend runtime paths.
- [x] Add startup status logging for Qdrant/auto-processing initialization.
- [x] Add process-level fatal error handlers.

Acceptance:

- Backend logs are structured and redact secrets.
- A single document run can be followed by correlation IDs.
- Unhandled fatal failures are logged and exit predictably.

### W2-S11: Version TinyBase Persistence

Findings: `N1`, `C3`, `C6`, `N2`

- [x] Add TinyBase schema version metadata.
- [x] Add migration registry and startup migration flow.
- [x] Validate typed JSON blobs on read.
- [x] Add idempotency guard and post-write verification to the migration script.
- [x] Add tests for corrupt file backup, version mismatch, and migration replay.

Acceptance:

- Startup either migrates known versions or refuses unknown versions clearly.
- Corrupt or invalid rows do not enter agent prompts unvalidated.
- Running the migration twice is safe.

## Wave 3: Hardening And UX

### W3-S12: Add Frontend Test Coverage

Status: `[x]`

Findings: `P1`, `D2`, `J4`

- [x] Add frontend unit/component test setup if missing.
- [x] Add tests for dashboard load and recoverable error banners.
- [x] Add tests for settings save.
- [x] Add Playwright E2E coverage for queue drill-down and manual review flow.
- [x] Ensure frontend tests run in CI.

Acceptance:

- Frontend has nonzero automated coverage on critical workflows.
- User-visible error states are tested.
- Playwright catches broken manual review navigation.

### W3-S13: Refactor Major Frontend Flows

Status: `[x]`

Findings: `K1`, `K2`, `K3`, `K4`, `K5`, `K6`, `K8`, `K9`, `K10`

- [x] Split dashboard into focused components and a data hook.
- [x] Replace direct settings fetches with the typed API/settings flow.
- [x] Rewrite document search fetch chain with cancellation and validation.
- [x] Complete i18n pass for cases, documents, settings, and dashboard.
- [x] Unify settings state around one source of truth.
- [x] Remove double-fetch search behavior.
- [x] Convert suitable settings mutations to React 19 form/action patterns.
- [x] Add route loading/error boundaries.
- [x] Add confirmations for bulk/destructive actions.

Acceptance:

- Dashboard component size is materially reduced.
- No hardcoded user-facing strings remain in audited routes.
- Settings mutation UX has pending/error states and does not drift between stores.

### W3-S14: Add Backpressure And Live Update Discipline

Findings: `A2`, `H1`, `H2`, `H3`, `H4`, `E9`, `E10`, `E12`

- [ ] Add request rate limiting.
- [ ] Add global LLM/OCR concurrency caps.
- [ ] Replace mutable tag cache with Effect-managed cache/ref.
- [ ] Rework SSE loops to interrupt on client close.
- [x] Centralize frontend polling or move to EventSource.
- [ ] Add admin lock release endpoint/UI action.
- [ ] Add user-facing cancel endpoint for in-flight runs.
- [ ] Track OCR usage and enforce budget caps.

Acceptance:

- Multiple tabs do not multiply backend polling unnecessarily.
- In-flight processing can be cancelled or lock-released through supported paths.
- Bulk OCR cannot exceed configured daily/run budget.

### W3-S15: Clean Repository Weight

Findings: `M1`, `M2`, `L3`, `O3`

- [x] Keep `.ref/` as an ignored local-only reference tree; exclude it from Git
  and Docker contexts and prevent build artifacts from referencing it.
- [ ] Move root PNGs to `docs/images/` or outside the repo.
- [ ] Ignore/remove `tsconfig.tsbuildinfo`.
- [ ] Audit `.dockerignore` for `.ref/`, screenshots, build info, secrets, and
  other large paths.

Note:

- `.ref/` may exist locally for upstream reference only. It must remain ignored
  by `.gitignore` and `.dockerignore`, and committed/build artifacts must not
  import or reference `.ref/` paths. CI builds artifacts before running
  `pnpm run check:ref-artifacts`; local validation should run it after a build
  when artifact directories are present, plus `git check-ignore -v .ref`.

Acceptance:

- Git checkout and Docker build context are not carrying avoidable large
  artifacts.
- Documentation images live under `docs/images/`.

### W3-S16: Add API Docs, Metrics, And Tracing

Findings: `R2`, `J2`, `J3`, `O2`

- [ ] Generate OpenAPI from shared schemas.
- [ ] Serve API docs in development.
- [ ] Expose metrics for pipeline phases, retries, errors, and LLM latency.
- [ ] Wire Effect tracing to OTLP or a compatible local sink.
- [ ] Extend health checks to include Paperless, Ollama, Qdrant, and Mistral.

Acceptance:

- `/health` reports upstream dependency status.
- `/metrics` exposes useful counters/histograms.
- External callers can inspect current API shape from generated docs.

## Wave 4: Polish

### W4-S17: Improve Prompt Reliability

Findings: `Q4`, `Q5`, `Q6`, `Q7`, `Q8`, `Q10`

- [ ] Enable Ollama JSON mode/response format where supported.
- [ ] Generate retry correction text from validation error paths.
- [ ] Compute prompt content budget dynamically from context size.
- [ ] Add few-shot examples to each agent.
- [ ] Validate memory blobs before prompt injection.
- [ ] Move tag-language aliases into editable settings.

Acceptance:

- Schema retry messages name the invalid field.
- Prompt context sizing accounts for system prompt and catalog payload.
- Tag alias behavior is archive/user configurable.

### W4-S18: Reduce Large-File And State Duplication

Findings: `R6`, `R7`, `B7`, `R3`, `R4`, `R5`

- [ ] Extract duplicated tag-state logic into one utility.
- [ ] Split `PiDocumentAgent.ts` by tool/state/event concern.
- [ ] Split `TinyBaseService.ts` by persistence/table/domain concern.
- [ ] Split `PaperlessService.ts` and `ProcessingPipeline.ts` where boundaries are
  clear.
- [ ] Clarify or remove orphan/stub agent files.
- [ ] Move `MAX_PIPELINE_STEPS` into config with a comment.

Acceptance:

- Core files are smaller and reviewable by concern.
- Tag state has one implementation.
- Stub/orphan agents are either documented, feature-flagged, or removed.

### W4-S19: Add Dependency And Contributor Policy

Findings: `L6`, `L7`, `M3`

- [ ] Add Renovate or Dependabot.
- [ ] Define update policy for proprietary Pi dependencies.
- [ ] Rewrite `CONTRIBUTING.md` for pnpm/Turbo/Effect.
- [ ] Decide workspace versioning strategy, such as Changesets.

Acceptance:

- Security updates are automated.
- New contributors get accurate local setup/test instructions.
- Package versioning is intentional and documented.

### W4-S20: Finish Frontend Small Fixes

Findings: `K7`, `K11`, `K12`, `K13`, `A8`, `A9`, `A10`, `A7`, `C5`, `C7`

- [x] Extract repeated frontend constants and class utilities.
- [ ] Add ARIA labels/status roles and reduced-motion handling.
- [x] Remove unused state placeholders.
- [x] Separate data fetching from i18n view-model mapping.
- [ ] Add CSRF protection for frontend mutation paths.
- [ ] Improve sensitive-data redaction policy.
- [ ] Add prompt/input size limits.
- [ ] Add per-document authorization checks where the product model requires it.
- [ ] Add branded ID/domain types and bounded ID parsing.

Acceptance:

- Accessibility issues from the audit are fixed.
- Mutation paths have CSRF protection.
- Invalid IDs and oversized inputs fail early with structured errors.

## Finding Coverage Matrix

| Findings | Primary task |
|---|---|
| `A1`, `A4`, `A5`, `A6`, `I1` | `W1-S2` |
| `A2`, `H1`, `H2`, `H3`, `H4`, `E9`, `E10`, `E12` | `W3-S14` |
| `A3`, `Q1` | `W1-S5` |
| `A7`, `A8`, `A9`, `A10`, `C5`, `C7` | `W4-S20` |
| `B1`, `B4`, `D1` | `W1-S3` |
| `B2`, `B3`, `B5` | `W2-S10` after the logging/error taxonomy pass |
| `B6`, `D4`, `J1` | `W2-S10` |
| `B7`, `R3`, `R4`, `R5`, `R6`, `R7` | `W4-S18` |
| `C1`, `C2`, `I2`, `I3`, `I4` | `W2-S7` |
| `C3`, `C6`, `N1`, `N2` | `W2-S11` |
| `C4`, `D3`, `R1`, `R2` | `W2-S6` and `W3-S16` |
| `D2`, `J4`, `P1` | `W3-S12` |
| `E1`, `Q2`, `Q9` | `W2-S8` |
| `E2`, `E3`, `E4`, `Q3` | `W1-S4` |
| `E5`, `E6`, `E7`, `G1`, `G2` | `W2-S9` |
| `J2`, `J3`, `O2` | `W3-S16` |
| `K1`, `K2`, `K3`, `K4`, `K5`, `K6`, `K8`, `K9`, `K10` | `W3-S13` |
| `K7`, `K11`, `K12`, `K13` | `W4-S20` |
| `L1`, `L2`, `L4` | `W1-S1` |
| `L3`, `M1`, `M2`, `O3` | `W3-S15` |
| `L5`, `P2`, `P3` | Add to the test work in `W1-S3`, `W1-S4`, `W1-S5`, and `W3-S12` |
| `L6`, `L7`, `M3` | `W4-S19` |
| `O1` | Do with Docker health/context work in `W3-S16`/`W3-S15` |
| `Q4`, `Q5`, `Q6`, `Q7`, `Q8`, `Q10` | `W4-S17` |
