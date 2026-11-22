# Development

`src/config` validates strict YAML and computes a canonical SHA-256 config hash.
`src/db` owns five core tables and numbered transactional SQL migrations.
SQLite uses WAL, FULL synchronous writes, and foreign-key enforcement.

`src/paperless` implements the 3.5.1 document/version API, delta tag mutations,
catalogs, task polling, and conservative reference checks. `src/providers` has
isolated Mistral, Jev, and OpenAI-compatible clients. Provider errors never include
response bodies, which can contain document text.

`src/pipeline` separates OCR, closed-set classification, open-field extraction,
the linear validation gate, write application, and worker leases. The worker
persists proposals before remote changes and reads them back for verification.
Polling uses transactional claims, lease heartbeats, and bounded backoff.

`src/consolidation` records batch changes and precondition-checked undo.
`src/web/views` contains server-rendered Hono JSX views with ordinary POST forms
and htmx partial swaps (`HX-Request`, out-of-band updates, and in-place error
alerts). Every non-`/health` request checks `Host` against `server.allowedHosts`
(loopback-only when empty), and POST mutations require matching Origin or
Referer. No secret values appear in the configuration view. The view layer has no
provider or database side effects.

## Checks

Use Node 24 as pinned in `.node-version`; better-sqlite3 is a native dependency.
The build copies SQL migrations and static assets into dist. Run tests against
the compiled artifact or container whenever the build path changes.

Tests inject mocked fetch handlers. A global test guard rejects accidental live
network requests. Add stateful mocks for cross-request behavior, particularly
Paperless read-back verification and interrupted writes. Release-script tests
run directly with Node's TypeScript stripping.
The check:artifact command starts the built CLI with polling disabled, checks
every page and static asset through loopback HTTP, and verifies graceful SIGTERM.

Provider contracts:

- Paperless 3.5.1 source: https://github.com/paperless-ngx/paperless-ngx/tree/v3.5.1/src/documents
- Jev request/answer schemas: https://api.typesafe.ai/openapi.json
- Mistral OCR: https://docs.mistral.ai/capabilities/document_ai/basic_ocr

Jev reports token counts; cost is recorded when supplied by the provider.
Never fabricate dollar estimates when the API does not report a cost.
