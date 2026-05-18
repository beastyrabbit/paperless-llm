# W3-S14 Rate Limiting CORS Fix Worker Handoff

## Changed files

- `apps/backend/src/server.ts`
- `apps/backend/tests/server.test.ts`
- `.env.example`
- `config.example.yaml`
- `subagent-reports/w3-s14-rate-limiting-cors-fix-worker.md`

## Exact fix

- Restored default local-development CORS origins outside `NODE_ENV=production`:
  - `https://paperless-llm-web.localhost:1355`
  - `http://localhost:3765`
  - `http://127.0.0.1:3765`
- Kept production security tightened: when `NODE_ENV=production`, no built-in local defaults are trusted unless explicitly configured.
- Preserved configured allow-list semantics and added legacy compatibility:
  - `PAPERLESS_LLM_TRUSTED_UI_ORIGINS` remains the documented/current env var.
  - `CORS_ORIGINS` is still accepted as a legacy alias so existing `.env` files do not silently lose CORS access.
  - If both are set, their origins are combined.
- Left rate limiting behavior intact; the limiter still runs after CORS/preflight handling and before route dispatch.
- Aligned docs/examples:
  - `.env.example` now documents `PAPERLESS_LLM_TRUSTED_UI_ORIGINS`, includes Portless + fallback frontend origins, and notes the legacy `CORS_ORIGINS` alias.
  - `config.example.yaml` no longer advertises unused `server.cors_origins`; it points CORS origin configuration to the env allow-list.

## Tests added/updated

- Updated server security helper tests to cover:
  - default local/Portless origins in non-production mode;
  - configured origins through both `PAPERLESS_LLM_TRUSTED_UI_ORIGINS` and legacy `CORS_ORIGINS`;
  - no default local origins in production.
- Added an HTTP preflight test proving `Access-Control-Allow-Origin` is emitted for a default Portless origin and for a configured origin.

## Validation

- `pnpm --filter @repo/backend test -- tests/server.test.ts tests/config/config.test.ts` — passed, 27 tests.
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/backend lint` — passed.

Note: the targeted server test run still emits an existing Qdrant compatibility warning in one test, but all tests pass.

## Ready for re-review

Yes. The CORS regression is fixed without weakening production defaults, and rate limiter behavior was not changed.
