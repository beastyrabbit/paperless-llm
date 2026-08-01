# Deployment

This deployment path keeps the existing backend and frontend services intact while adding container runtime guardrails.

## Backend Image

The backend image:

- runs as the non-root `backend` user;
- installs `OCRmyPDF`, `Tesseract`, English and German Tesseract data;
- installs the Codex CLI as `@openai/codex@0.145.0`;
- persists `/app/data` and `/app/codex-home`;
- checks required binaries at startup without calling external providers;
- takes an atomic writer lock under `/app/data/backend-writer.lock` before starting Node.

The writer lock is intentionally strict. If a container is killed without cleanup, remove the stale `backend-writer.lock` directory from the shared backend data volume only after confirming no backend container is running.

## Required Secrets

Provider credentials are environment-only startup configuration and are never
read from YAML or persisted by the settings API or TinyBase. Inject them with
Infisical in local and deployed environments. The settings GUI is read-only for
these values and changes require a backend restart.

- `PAPERLESS_URL`: reachable Paperless API base URL.
- `PAPERLESS_TOKEN`: Paperless API token.
- `MISTRAL_API_KEY`: Mistral OCR API key.
- `OLLAMA_URL`: reachable Ollama API base URL.
- `QDRANT_URL`: reachable Qdrant API base URL.
- `PAPERLESS_LLM_API_TOKEN`: shared backend auth token for direct clients or the web proxy.
- `CODEX_HOME/auth.json`: Codex CLI auth material when Codex runtime is enabled.

The application Infisical project has matching `dev` and `prod` variable
contracts. `pnpm dev` injects `dev`; every production Compose command must use
the wrapper below so `prod` is injected before Compose interpolation:

```sh
pnpm run compose:config:prod
pnpm run deploy:prod
pnpm run compose:prod -- logs -f
```

Direct `docker compose up` is intentionally unsupported because Compose no
longer supplies localhost or `host.docker.internal` defaults for Paperless,
Ollama, or Qdrant.

Compose passes `PAPERLESS_LLM_API_TOKEN` to both backend and frontend containers. In the frontend it is server-only for the Next.js API proxy; never expose it as a `NEXT_PUBLIC_*` value.

The container does not call Mistral, Codex, Paperless, Ollama, or Qdrant during startup checks. When `NODE_ENV=production` or `PAPERLESS_LLM_REQUIRE_SECRETS=true`, startup fails before Node if the Paperless token or backend API token is missing; Mistral and Codex auth fail fast only when those providers are explicitly enabled or required.

Do not copy host `~/.codex` into the container. Create Codex auth once as the container user in the dedicated Compose volume:

```sh
pnpm run compose:prod -- run --rm --no-deps \
  --entrypoint codex \
  -e PAPERLESS_LLM_REQUIRE_SECRETS=false \
  backend login --device-auth
```

Leave `PAPERLESS_LLM_CODEX_ENABLED=false` until that volume contains a valid `auth.json`.

## Safe Defaults

Compose defaults to one backend container through a fixed `container_name` plus the shared writer lock. Run only one backend writer against a given `/app/data` volume; the lock must be a direct child of `/app/data`, is not allowed to be a symlink, and is removed by deleting only its `pid` and `created_at` files before `rmdir`.

Mutation mode defaults to `disabled`, which starts neither the legacy mutation worker nor the Paperless-first scanner and blocks mutating endpoints from both writer families. The only valid mutation modes are `disabled`, `legacy`, and `paperless_first`; `legacy` blocks new Paperless-first mutation commands, while `paperless_first` blocks legacy mutation endpoints and workers. The ai-analyse scanner has an independent `disabled`, `canary`, or `all` scope, defaults to `disabled`, and may only run in `paperless_first` mutation mode.

Canary scope requires `PAPERLESS_LLM_AI_ANALYSE_CANARY_DOCUMENT_IDS` to be an explicit allowlist of positive Paperless document IDs. Both `canary` and `all` also require `PAPERLESS_LLM_AI_ANALYSE_TAG_ID` to be set explicitly to the positive ID of the verified `ai-analyse` tag; there is deliberately no default tag ID. Canary selection does not use first-N ordering, and tagged documents outside the allowlist are skipped. Full scope may scan every document with the configured tag, so keep it disabled until the canary has been inspected.

Concurrency defaults are `1` for Ollama, Mistral, and OCR, rate limiting is enabled, OCR budgets are unlimited unless explicitly capped, and Codex auth is checked only when `PAPERLESS_LLM_CODEX_ENABLED=true` or `PAPERLESS_LLM_CODEX_AUTH_REQUIRED=true`.

For read-only production checks, start from `.env.prod.readonly.example` and `config.prod.readonly.example.yaml`.

## C1 Cutover Readiness

The cutover CLI runs inside the backend production image and never contacts Paperless, Mistral, Codex, Ollama, Qdrant, or other providers. It reads the legacy TinyBase JSON file, writes a redacted disposition report, copies a legacy backup without printing row data, archives excluded legacy tables offline, and initializes the isolated operational ledger when no compact provider-usage facts are safely compatible. Config and settings remain config-owned; the cutover does not import settings or config rows into `operational-ledger.json`.

Maintenance dry run:

```sh
pnpm run compose:prod -- run --rm --no-deps \
  -e PAPERLESS_LLM_REQUIRE_SECRETS=false \
  backend node dist/cli/cutover.js --dry-run \
  --tinybase-file /app/data/tinybase/tinybase.json \
  --ledger-file /app/data/operational-ledger/operational-ledger.json \
  --backup-dir /app/data/cutover/backups \
  --archive-dir /app/data/cutover/offline-archives \
  --report-file /app/data/cutover/cutover-report.json
```

Maintenance migrate:

```sh
pnpm run compose:prod -- run --rm --no-deps \
  -e PAPERLESS_LLM_REQUIRE_SECRETS=false \
  backend node dist/cli/cutover.js --migrate \
  --tinybase-file /app/data/tinybase/tinybase.json \
  --ledger-file /app/data/operational-ledger/operational-ledger.json \
  --backup-dir /app/data/cutover/backups \
  --archive-dir /app/data/cutover/offline-archives \
  --report-file /app/data/cutover/cutover-report.json
```

The CLI output is limited to redacted table/category row and byte counts, unknown/malformed/unmappable counts, and artifact paths. Legacy document/OCR mirrors, memory, transcripts, questions, old proposals, and other content-bearing rows are reported and archived offline, never imported. Existing newer ledger versions are refused; rerunning the migrate command is idempotent and leaves the same backup, archive, report, and ledger facts.

Startup order:

1. Stop all backend containers and other mutation workers.
2. Confirm the backend writer lock is clear, then run the dry-run command and inspect only the redacted report.
3. Run the migrate command to create the backup, offline archive, redacted report, and empty or compact operational ledger.
4. Verify the report contains no secrets, titles, OCR, prompts, transcripts, raw rows, or Paperless response bodies.
5. Start exactly one backend with `PAPERLESS_LLM_MUTATION_MODE=disabled` and keep the scanner disabled.
6. Compare read-only API responses against the legacy state; GET requests must not mutate Paperless or the ledger.
7. Later, switch to `paperless_first` only with an explicit canary document ID allowlist; move to `all` only after canary review.

Rollback uses the previous image, the legacy TinyBase backup under `/app/data/cutover/backups`, and Paperless document history for any Paperless-side mutations made after cutover. Keep the offline archive intact for audit and do not import its raw content back into the operational ledger.

## Provider-Free Validation

Run compose config validation:

```sh
sh scripts/deployment-smoke.sh
```

Run the backend Docker build, container capability check, OCRmyPDF flag smoke, writer-lock smoke, and negative secret checks without starting the API:

```sh
PAPERLESS_LLM_DEPLOYMENT_SMOKE_BUILD=true sh scripts/deployment-smoke.sh
```
