# W3-S16 OpenAPI/API Docs Worker Handoff

## Implemented

- Added OpenAPI 3.1 generation to `@repo/api-contracts` from the existing shared `apiRouteContracts` and Effect schemas.
- Added `GET /openapi.json` in the backend router, returning the generated document.
- Added a simple static `GET /api/docs` HTML page linking to `/openapi.json`.
- Gated docs UI to development by default, with explicit production opt-in via `PAPERLESS_LLM_ENABLE_API_DOCS=true`.
- Kept metrics, tracing, and dependency-aware health out of scope as requested.

## Changed files

- `packages/api-contracts/src/openapi.ts`
- `apps/backend/src/api/index.ts`
- `apps/backend/src/server.ts`
- `apps/backend/tests/api/router.test.ts`
- `apps/backend/tests/server.test.ts`
- `progress.md`
- `subagent-reports/w3-s16-openapi-docs-worker.md`

## Validation

Passed:

```bash
pnpm --filter @repo/api-contracts build
pnpm --filter @repo/api-contracts typecheck
pnpm --filter @repo/api-contracts lint
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
pnpm --filter @repo/backend test -- tests/api/router.test.ts tests/server.test.ts
node -e "import('./packages/api-contracts/dist/index.js').then(({generateOpenApiDocument})=>{const doc=generateOpenApiDocument(); if(doc.openapi!=='3.1.0'||!doc.paths['/api/pending/bulk']) process.exit(1); console.log(doc.openapi, Object.keys(doc.paths).length)})"
```

## Notes / risks

- `/openapi.json` is served by the normal JSON router. It is public when API docs are enabled so the docs page can load it; otherwise it follows existing auth behavior when an API token is configured.
- The OpenAPI document reflects the current shared route contract metadata. Some existing GET/query routes still have sparse response/query metadata because those details are not yet present in the shared contracts.
