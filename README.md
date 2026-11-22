# Paperless Local LLM

Document OCR and metadata processing for Paperless-ngx 3.5.1. One Node process
serves the review UI, runs the polling worker, and journals work in SQLite.

Mistral OCR handles PDFs after an explicit date cutoff. TypeSafe Jev classifies
closed-set metadata. An OpenAI-compatible cloud or local endpoint extracts only
the applicable open fields. A bounded gate checks source quotes, types, catalog
duplicates, and selected semantic claims before applying changes.

## Run

Use Node 24 LTS and pnpm 9.15:

```sh
pnpm install --frozen-lockfile
cp config.example.yaml config.yaml
# Edit URLs, document schemas, and the cutoff. Inject secrets into the environment.
pnpm dev
```

The application listens on port 3765. Review documents at `/`, merge candidates
at `/consolidation`, jobs at `/activity`, and read-only configuration at `/config`.
Create the configured `ai:requested` tag in Paperless and add it to a document to
request metadata processing. Configure service tags with native matching disabled.

Production deployments should run behind an authenticated reverse proxy. The UI
has no built-in login. Docker Compose publishes port 3765 on `127.0.0.1` only.
An empty `server.allowedHosts` accepts only loopback `Host` headers (`localhost`,
`127.0.0.1`, `[::1]`) across GET and POST regardless of `server.host` (exempting
`GET /health` for kubelet probes). Configure `server.allowedHosts`, for example
`["paperless-llm.example.org", "paperless-local-llm.documents.svc.cluster.local"]`,
when deploying behind a reverse proxy or cluster Service. Entries can include a
port for an exact host-and-port match. Same-origin checks apply to every POST.

TypeSafe Jev can be called directly (`https://api.typesafe.ai/v1/systemone`,
model `jev-latest`) or through OpenRouter (`https://openrouter.ai/api/v1/systemone`,
model `typesafe/jev-latest`, with `JEV_API_KEY` set to your OpenRouter key).

OCR requests default to a 60-second timeout plus 15 seconds per reserved page,
with a maximum of 10 minutes. Adjust `ocr.timeoutMs` and `ocr.perPageTimeoutMs`
for your document sizes. Daily page-budget exhaustion waits until midnight UTC
without consuming a retry attempt.

Polling and OCR are disabled in the example. Its future cutoff prevents historical
documents from being sent for paid OCR accidentally. Set both deliberately before
starting unattended work. Existing non-empty metadata is preserved for review.

Environment secrets are `PAPERLESS_TOKEN`, `MISTRAL_API_KEY`, `JEV_API_KEY`,
`LLM_API_KEY`, and optional `LOCAL_LLM_API_KEY`. Configuration comes from
`PAPERLESS_LLM_CONFIG` or `./config.yaml`; the database path comes from
`PAPERLESS_LLM_DB` or `./data/paperless.db`.

```sh
pnpm build
pnpm start
# Or, with config.yaml and an environment file prepared:
docker compose up --build
```

See [operation](docs/user/operation.md) for spend controls and review actions,
and [development](docs/dev/development.md) for architecture and verification.

## Commands

```sh
pnpm cli serve
pnpm cli reconcile
pnpm cli calibrate
pnpm cli consolidate
pnpm cli undo <batchId>
```

`calibrate` reads existing document metadata as a comparison baseline. It calls
Jev, never Mistral, and does not write Paperless metadata. `consolidate` creates
review proposals; it does not merge automatically. `consolidate --suggest` adds
an optional L3 catalog suggestion pass before direct Jev checks.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
node --experimental-strip-types --test scripts/release/*.test.mts
pnpm check:ref-artifacts
pnpm check:artifact
```

All automated tests use mocked providers. `/health` checks the database;
`/version` and `/api/version` return `{version, revision}` from the image build.
The four bilingual legal routes retain the standalone renderer.
