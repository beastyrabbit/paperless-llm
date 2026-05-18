# Production Read-Only Runs

Use this mode when pointing the app at production Paperless data for auditing, smoke tests, or UI checks.

## Safety Contract

When `PAPERLESS_LLM_PROD_READ_ONLY=true` is set:

- Backend and web proxy allow `GET`, `HEAD`, and `OPTIONS`.
- Backend and web proxy allow only `POST /api/settings/test-connection/:service` for connection probes.
- Backend and web proxy reject state-changing `GET` routes such as processing streams and config auto-import.
- Backend and web proxy reject other `POST`, `PATCH`, `PUT`, and `DELETE` requests with `403`.
- Backend startup skips Qdrant collection creation and skips auto-processing startup.

This protects production documents from processing, tag edits, metadata updates, bulk jobs, pending-item approvals, and settings writes through this app.

## Local Secret Files

Real keys must stay in ignored local files.

1. Copy `.env.prod.readonly.example` to `.env.prod.local`.
2. Copy `config.prod.readonly.example.yaml` to `config.yaml`, or to another ignored absolute path.
3. Fill `.env.prod.local` and `config.yaml` with real production values.
4. Verify both local secret files are ignored:

```sh
git check-ignore -v .env.prod.local config.yaml
```

## Run Against Production Safely

Load the ignored env file in your shell, then start through Portless:

```sh
set -a
source .env.prod.local
set +a
pnpm run dev
```

Open `https://paperless-llm-web.localhost:1355`.

## Extra Guardrails

- Use the least-privileged Paperless token available for the production account.
- Keep `auto_processing.enabled: false` in production read-only configs.
- Keep all `pipeline.*` values `false` in production read-only configs.
- Keep `PAPERLESS_ALLOWED_HOSTS` set to the exact production Paperless hostname.
- Do not commit `.env.prod.local`, `config.yaml`, or any file containing real keys.
