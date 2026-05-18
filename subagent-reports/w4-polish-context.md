# Wave 4 Polish Implementation Context (W4-S17 through W4-S20)

Scope: `docs/plans/audit-rework-tasks.md` Wave 4 items W4-S17-W4-S20. No source files were edited while gathering this context. The working tree is active with many modified/untracked files; implementation workers must recheck line numbers and preserve existing user changes.

## Cross-cutting constraints and current state

- Project rule from `AGENTS.md`: Pi agent instructions/tools/schemas/structured placeholders live in TypeScript; do **not** reintroduce prompt files or `PromptService` paths.
- Current PR/worktree already includes Wave 1-3-ish changes (Pi agents, frontend tests, read-only proxy, logging/config updates). Do not assume audit line numbers are still exact.
- Root validation commands available:
  - `pnpm run typecheck`
  - `pnpm run lint`
  - `pnpm run test`
  - frontend targeted: `pnpm --filter @repo/web test`, `pnpm --filter @repo/web typecheck`, `pnpm --filter @repo/web exec playwright test`
  - backend targeted: `pnpm --filter @repo/backend test`, `pnpm --filter @repo/backend typecheck`
- CI is already present in `.github/workflows/pr.yml` and runs install, typecheck, lint, unit tests, and Playwright e2e.

---

## W4-S17: Improve Prompt Reliability

### Recommended decomposition

1. **Structured-output / JSON mode support**
   - Add a typed way to request JSON output for Ollama calls used by Pi agents/verifiers.
   - For direct `/api/chat`/`/api/generate` service calls, extend `OllamaChatOptions` with `format?: "json" | object` or similar and include it in request bodies.
   - For Pi OpenAI-compatible `/v1` calls, investigate what `@earendil-works/pi-ai`/`pi-agent-core` supports. If `response_format` can be injected via `onPayload`, add it there; otherwise document the limitation and at least cover direct verifier/service calls.
2. **Field-specific correction text**
   - Current retry messages are generic. Build correction messages from actual failed tool result text and/or typebox validation issues so retries name invalid paths (for example `finish_document_metadata.tagIdsToAdd[0]`).
   - Add unit tests for one rejected final tool call that produces a path-specific correction.
3. **Dynamic prompt budget**
   - Replace hard-coded `formatUntrustedDocumentText(content, 12_000)`, `10_000`, and `4_000` with a shared prompt budget helper that accounts for system prompt, JSON catalog size, tool instructions, and model context window.
   - Start with character budgeting unless tokenization is already available; keep a conservative reserve for tool schemas and model output.
4. **Few-shot examples in TypeScript prompts**
   - Add compact German/English examples inline in `buildSystemPrompt`/`buildUserPrompt` for `PiDocumentAgent`, `PiTagExplorerAgent`, and consolidation if in scope.
   - Keep examples short; they count against context budget.
5. **Validate memory before injection**
   - Current memory fields from TinyBase/case memory are treated mostly as arrays/unknown. Add schema-backed decoders for `humanDecisions`, `reviewFeedback`, `agentMessages`, and `appliedMetadata` before including them in prompts.
6. **Editable tag-language aliases**
   - Move hardcoded aliases from `apps/backend/src/utils/tagLanguage.ts` and `catalog_guidance.aliases` into settings/TinyBase with defaults.
   - Add backend settings schema/API support and a small settings UI to edit aliases.

### Likely files and evidence

- `apps/backend/src/agents/piOllamaModel.ts:3-22`
  - Pi model is configured as Ollama OpenAI-compatible `/v1` with fixed `contextWindow: 32_000` and `maxTokens: 4_096`; no JSON/response format support is declared here.
- `apps/backend/src/services/OllamaService.ts:26-33`, `227-240`, `352-367`
  - `OllamaChatOptions` has temperature/top_p/top_k/num_predict/seed/stop only.
  - `/api/chat` and `/api/generate` request bodies pass `model`, messages/prompt, `stream`, and `options`; no top-level `format`/`response_format` is sent.
- `apps/backend/src/agents/PiDocumentAgent.ts:2230-2269`
  - Pi agent is created with `buildOllamaModel(...)`; `onPayload` currently injects only `{ temperature: 0, seed: modelSeed }`.
- `apps/backend/src/agents/PiDocumentAgent.ts:2405-2449`
  - Prompt retry correction is generic: no final tool, no search, or verifier feedback string. It does not parse/schema-report invalid fields.
- `apps/backend/src/agents/PiDocumentAgent.ts:1990-2022`, `2024-2124`
  - System/user prompts are TypeScript strings; user prompt hardcodes `content_excerpt: formatUntrustedDocumentText(content, 12_000)` and embeds full `catalogs`, `human_decisions`, `review_feedback`, `already_applied_metadata`.
  - `catalog_guidance.aliases` hardcodes document-type aliases at `2097-2103`.
- `apps/backend/src/agents/PiDocumentAgent.ts:2140-2168`
  - Memory is assembled from case/TinyBase with `Array.isArray` checks and casts. No runtime validation of item shape before prompt injection.
- `apps/backend/src/agents/PiDocumentAgent.ts:766-807`
  - Verifier prompt uses `formatUntrustedDocumentText(input.content, 4_000)`.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:256-284`
  - Tag explorer prompt hardcodes `formatUntrustedDocumentText(input.content, 10_000)` and embeds all `catalogTags`/`similarDocuments`; no examples or dynamic budget.
- `apps/backend/src/utils/tagLanguage.ts:1-87`
  - German alias map is hardcoded (`GERMAN_TAG_ALIASES`) and used by `localizeGeneratedTagName(s)`; not user/archive configurable.
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
  - Existing tests cover prompt data boundaries, confidence threshold feedback, verifier prompt delimiters, resume-protected metadata, and current redaction behavior. Good place to add W4-S17 unit tests.

### Risks

- JSON-mode support differs between Ollama native `/api/*` and OpenAI-compatible `/v1`; the current Pi stack uses `/v1`, so worker must verify library payload shape before changing it. If unsupported, avoid false claims and add a targeted fallback.
- Adding examples and full catalogs can worsen context pressure unless budget work lands first or together.
- Memory validation may reject existing persisted rows; implement tolerant decode + log/drop invalid entries rather than crashing normal processing, unless data is security-sensitive.
- Editable aliases affect model behavior and UI/settings persistence; keep defaults backward-compatible.

### Validation commands

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts`
- `pnpm --filter @repo/backend test -- tests/services/OllamaService.test.ts`
- `pnpm --filter @repo/backend typecheck`
- `pnpm run lint`

### Compact worker meta-prompt

Implement W4-S17 prompt reliability without prompt files. Add typed JSON-output support where the Ollama/Pi call path supports it, field-path-aware retry correction, dynamic prompt budgeting for document/verifier/tag explorer prompts, compact in-code few-shot examples, schema/tolerant validation for memory injected into prompts, and editable defaulted tag-language aliases via settings. Preserve existing Pi TypeScript agent pattern. Add/adjust backend tests for JSON payload options, invalid-field correction text, prompt budget behavior, memory validation dropping bad rows, and alias defaults/settings override. Stop and ask if `@earendil-works/pi-*` cannot support response format injection through Pi payloads.

---

## W4-S18: Reduce Large-File And State Duplication

### Recommended decomposition

1. **Shared workflow/tag state utility**
   - Extract one backend utility for workflow tag config, workflow tag name detection, `stateFromTags`, `nextStepForState`, and `workflowTagForState`.
   - Replace copies in `server.ts`, `ProcessingPipeline.ts`, and agent helpers.
2. **Move `MAX_PIPELINE_STEPS` to config**
   - Add `pipeline.maxSteps` (or `http/pipeline` if preferred) with default 10 and a comment that it is a safety bound against infinite workflow loops.
   - Use it in SSE full-pipeline loop.
3. **Split `PiDocumentAgent.ts` by concern**
   - Candidate modules: `documentAgent/prompts.ts`, `documentAgent/tools.ts`, `documentAgent/memory.ts`, `documentAgent/validation.ts`, `documentAgent/redaction.ts`, `documentAgent/types.ts`.
   - Keep public exports used by tests stable or update tests intentionally.
4. **Split persistence/services by domain**
   - `TinyBaseService.ts` is 2197 lines; split table schemas/JSON parsing/migrations/cases/settings/logs into helpers while keeping service interface stable.
   - `PaperlessService.ts` is 1218 lines; split API client primitives vs document/tag/catalog methods.
   - `ProcessingPipeline.ts` is 1244 lines; split state transitions, OCR/metadata/index steps, stream event helpers.
5. **Clarify orphan/stub agents**
   - `SchemaAnalysisAgentGraph.ts` is currently a compatibility stub that says manual consolidation owns cleanup. Decide whether to keep documented compatibility, feature-flag, or delete after checking imports.
   - Legacy graph files appear deleted in worktree (`CorrespondentAgentGraph.ts`, `DocumentTypeAgentGraph.ts`, `SummaryAgentGraph.ts`, `TagsAgentGraph.ts`, `TitleAgentGraph.ts`) but line up imports before finalizing.

### Likely files and evidence

- File sizes from `wc -l`:
  - `apps/backend/src/agents/PiDocumentAgent.ts`: 2582 lines.
  - `apps/backend/src/services/TinyBaseService.ts`: 2197 lines.
  - `apps/backend/src/services/PaperlessService.ts`: 1218 lines.
  - `apps/backend/src/agents/ProcessingPipeline.ts`: 1244 lines.
- `apps/backend/src/server.ts:344-394`, `416-480`
  - Inline `getNextStepForState`, `getStateFromTags`, and local `const MAX_PIPELINE_STEPS = 10` inside full-pipeline SSE loop.
- `apps/backend/src/agents/ProcessingPipeline.ts:564-611`, `613-653`
  - Another implementation of case/tag state and `workflowTagForState`.
- `apps/backend/src/agents/PiDocumentAgent.ts:211-216`, `1216`, `1693-1785`, `2188-2204`
  - Local workflow tag set/name filtering in the document agent.
- `apps/backend/src/agents/PiConsolidationAgent.ts:91-101`
  - Another local `getWorkflowTagNames`/`isWorkflowTagName` implementation.
- `apps/backend/src/agents/SchemaAnalysisAgentGraph.ts:1-77`
  - Compatibility stub; always returns no suggestions and says manual consolidation owns catalog cleanup.
- `apps/backend/src/layers/index.ts:70-72`
  - Agents layer includes `PiConsolidationAgentServiceLive`; check whether schema-analysis layer is still included elsewhere before deleting.
- `apps/backend/src/config/schema.ts:55-69`, `apps/backend/src/config/index.ts:53-64`
  - Pipeline config currently has booleans only; no `maxSteps`.

### Risks

- Refactors can create review noise. Keep interface-preserving extraction first; behavior changes (config max steps) should be tiny and tested.
- Tag state already has deterministic case-state behavior from W2; do not regress source-of-truth semantics. Shared utility should accept both case state and tag names when needed.
- Large service splits can break tests through import cycles; prefer internal helper modules and keep public service tags/interfaces unchanged.
- Existing worktree marks several legacy agent files deleted; workers must not resurrect them inadvertently.

### Validation commands

- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend test -- tests/agents/ProcessingPipeline.test.ts tests/server.test.ts`
- `pnpm --filter @repo/backend test -- tests/services/TinyBaseService.test.ts tests/services/PaperlessService.test.ts`
- `pnpm run lint`

### Compact worker meta-prompt

Implement W4-S18 as small mechanical refactors. First extract one workflow/tag state utility and use it in `server.ts`, `ProcessingPipeline.ts`, `PiDocumentAgent.ts`, and `PiConsolidationAgent.ts`. Move full-pipeline max iteration count into config with default 10 and a safety-bound comment. Then split obvious helper modules from `PiDocumentAgent.ts`, `TinyBaseService.ts`, `PaperlessService.ts`, and `ProcessingPipeline.ts` without changing service interfaces. Clarify `SchemaAnalysisAgentGraph.ts` as kept compatibility or remove only after imports/tests prove it is unused. Add/update focused tests for state mapping and max-steps config. Avoid broad behavior changes.

---

## W4-S19: Add Dependency And Contributor Policy

### Recommended decomposition

1. **Automated dependency updates**
   - Add Dependabot or Renovate. Dependabot is simplest in GitHub-only repos; Renovate gives stronger grouping/rules.
   - Include pnpm workspace, GitHub Actions, Docker if applicable.
   - Group routine dev deps, keep security updates immediate.
2. **Proprietary Pi dependency policy**
   - Document how to update `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`, compatibility testing required, and who approves breaking changes.
3. **Rewrite `CONTRIBUTING.md`**
   - Current guide is for Bun/Python/uv/FastAPI and is wrong for this repo.
   - Replace with pnpm 9, Turbo, Next.js web app, Effect backend, Portless/fallback ports, config/secrets, test/lint/typecheck commands, PR expectations.
4. **Workspace versioning strategy**
   - Current packages are private and versions are mixed/root `0.1.0` vs workspaces `0.0.0`.
   - Decide/document either “private app workspace, no publishing; versions are informational” or adopt Changesets if package publishing/release notes are required.

### Likely files and evidence

- `CONTRIBUTING.md:1-80`
  - References Bun, uv, Python backend, uvicorn, ruff, mypy, pre-commit; none match current pnpm/Turbo/Effect stack.
- `package.json:1-35`
  - Root uses `pnpm@9.15.0`, Turbo scripts, Portless dev (`pnpm run dev`), fallback frontend/backend dev scripts.
- `pnpm-workspace.yaml`
  - Workspaces are `apps/*` and `packages/*`.
- `turbo.json`
  - Defines `build`, `lint`, `typecheck`, `test`, `test:e2e`, `precommit` tasks and inputs/outputs.
- `.github/workflows/pr.yml`
  - Existing PR quality gate; dependency automation should complement it.
- Package versions:
  - Root `package.json` version `0.1.0`.
  - `apps/backend/package.json`, `apps/web/package.json`, `packages/ui/package.json`, `packages/typescript-config/package.json` use `0.0.0` and are private.
- `apps/backend/package.json`
  - Proprietary/critical Pi deps: `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`, both `^0.74.0`.
- No `.github/dependabot.yml`, no `renovate.json`, no `.changeset/` found.

### Risks

- Automated major updates for Pi dependencies can silently alter agent behavior. Policy should pin/group these separately and require backend agent tests plus a smoke run.
- If all workspaces remain private, Changesets may be unnecessary overhead; acceptance only requires intentional documented strategy.
- Dependabot support for pnpm monorepos is adequate for many cases, but Renovate may better group workspace deps. Pick one, not both.

### Validation commands

- Docs/config-only likely validation:
  - `pnpm run lint` (Biome may lint JSON/Markdown depending config)
  - `pnpm run typecheck` if package/config changes are made
- For Dependabot config, rely on GitHub validation after push; locally ensure YAML parses if using a YAML-aware command/tool available.

### Compact worker meta-prompt

Implement W4-S19 by adding one dependency automation policy (Dependabot or Renovate) for pnpm workspaces, GitHub Actions, and Docker where applicable. Treat `@earendil-works/pi-*` as a separate guarded group with documented approval and validation requirements. Rewrite `CONTRIBUTING.md` for pnpm 9/Turbo/Next.js/Effect backend, Portless and fallback ports, config/secrets, validation commands, testing, and PR expectations. Decide and document workspace versioning: private/no publish with informational versions, or Changesets if release management is desired. Keep this as docs/config work; do not change app runtime code.

---

## W4-S20: Finish Frontend Small Fixes / Security / Accessibility

### Recommended decomposition

1. **Repeated constants and class utilities**
   - Extract shared frontend constants such as `API_BASE = ""`, polling intervals, common gradient/card/status classes.
   - Avoid over-abstracting one-off Tailwind strings.
2. **Accessibility and reduced motion**
   - Add ARIA labels/status roles for status dots and badges.
   - Add reduced-motion CSS for custom animations and Tailwind animation-heavy areas.
   - Ensure `ModelCombobox` has accessible label/name contract; it uses button `role="combobox"`, `aria-controls`, `aria-expanded`, but no explicit label prop.
3. **Separate data fetching from i18n view-model mapping**
   - Dashboard has already been split into `useDashboardData`; continue pattern in pages where callbacks depend on translation functions.
4. **CSRF protection for frontend mutation proxy**
   - `apps/web/app/api/[...path]/route.ts` forwards POST/PATCH/PUT/DELETE to backend with server-side bearer token and currently has read-only mode but no CSRF/origin/token check.
   - Add same-origin/origin validation and/or CSRF token double-submit for mutating methods. Add tests.
5. **Sensitive-data redaction policy**
   - Backend redaction is still narrow: keyword + uppercase code pattern. Expand/document policy for OTP/passcode/activation/TAN/PIN and entropy/length heuristics.
   - Be careful: local runtime data under `apps/backend/data/` is ignored but contains secret-like values; do not print secrets in tests/logs/docs.
6. **Prompt/input size limits**
   - Add max-length validation in backend API schemas for user strings/tool inputs (`SettingsUpdateBodySchema`, chat/search/pending bodies, prompt-like fields) and document content passed to prompts via W4-S17 budget helper.
7. **Per-document authorization model**
   - Current backend auth is token-only. Product may be single-user/local; if no multi-user model exists, document the decision and add hooks/placeholders rather than fake ACLs. If required, enforce after token validation before document stream/process/update endpoints.
8. **Branded/bounded IDs**
   - Introduce central bounded ID parsing/schema helpers for positive safe ints; frontend route IDs and backend params should reject invalid IDs consistently.

### Likely files and evidence

- `apps/web/app/api/[...path]/route.ts:55-104`
  - Proxy forwards all methods, strips hop-by-hop headers, injects backend bearer token, and streams body. No CSRF/origin/header token validation before mutations.
  - Read-only protection exists at `17-42`, `60-62`.
- `apps/web/tests/api-proxy-readonly.test.ts`
  - Existing tests cover read-only blocking and auth forwarding; good place to add CSRF tests.
- `apps/backend/src/server.ts:171-179`
  - `isAuthorized` checks only bearer/API-key token. No per-document ACL.
- `apps/backend/src/api/index.ts:77-90`
  - Uses Zod schemas; `PositiveIntSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER)` but no branded types. `OptionalStringSchema = z.string().optional()` and loose settings body have no max lengths.
- `apps/backend/src/api/index.ts:90-105`
  - Settings update body is `LooseObjectSchema`; pending body string fields have no length caps.
- `apps/backend/src/agents/PiDocumentAgent.ts:809-819`, tests at `apps/backend/tests/agents/PiDocumentAgent.test.ts:263-274`
  - Sensitive redaction currently matches a keyword pattern and `\b[A-Z0-9]{6,}\b` only.
- `apps/web/lib/api.ts:5` and `apps/web/lib/tinybase/provider.tsx:31`
  - Duplicate `API_BASE = ""`.
- `apps/web/components/sidebar.tsx:107-118`
  - Status dot is a plain `div` with color/animation only; should expose status text/role or be aria-hidden with adjacent live/status text.
- `apps/web/components/model-combobox.tsx:51-80`
  - Custom combobox uses `role="combobox"`, `aria-controls`, `aria-expanded`; needs label/name and possibly `aria-haspopup="listbox"`/`aria-activedescendant` depending UI primitives.
- `apps/web/app/globals.css:154-184`
  - Custom `animate-fade-in`, `animate-slide-up`, and `stagger-children` animations have no `prefers-reduced-motion` override.
- `apps/web/components/dashboard/*` and many pages use `animate-spin`, `animate-pulse`, `transition-all` per grep; prioritize global reduced-motion CSS and critical status indicators.
- `apps/web/app/settings/components/AiTagsTab.tsx:36-52`
  - Audit’s unused placeholders appear mostly removed; current state variables all look used later, so do not spend time deleting unless lint finds dead code.

### Risks

- CSRF implementation can break the server-side proxy if API client does not attach token/header. Coordinate frontend API helper changes and tests in the same story.
- Same-origin checks must account for Portless HTTPS host and localhost fallback. Prefer relative-origin token/header validation over hardcoded hosts.
- Reduced-motion should not hide necessary progress state; pair visual spinners with text/status roles.
- Per-document auth is a product decision. Do not invent multi-user ownership if the product remains single-token local; document/escalate instead.
- Branded ID changes can cascade through many backend/frontend types; start with central parse schemas and route boundaries.

### Validation commands

- `pnpm --filter @repo/web test -- tests/api-proxy-readonly.test.ts tests/dashboard.test.tsx`
- `pnpm --filter @repo/web typecheck`
- `pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/server.test.ts tests/agents/PiDocumentAgent.test.ts`
- `pnpm run lint`
- Accessibility manual/next-best: run the app and keyboard-test sidebar/model combobox/mutation forms; if Playwright can run, add/execute a simple accessibility-oriented interaction test.

### Compact worker meta-prompt

Implement W4-S20 in small security/accessibility slices. Extract only obvious repeated frontend constants/classes. Add accessible labels/status roles and global reduced-motion handling for custom animations and key status/spinner UI, especially sidebar and model combobox. Add CSRF protection to the Next API proxy for mutating methods with tests and ensure existing read-only tests still pass. Expand backend redaction and add documented max-length/size limits for prompt-like/user input schemas. Add central bounded ID parsing helpers; defer true per-document ACL to a documented product decision unless an ownership model already exists. Validate with frontend tests/typecheck, targeted backend API/redaction tests, and lint.
