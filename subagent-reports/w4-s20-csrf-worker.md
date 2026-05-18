# W4-S20 CSRF Worker Report

## Changed files
- `apps/web/app/api/[...path]/route.ts`
- `apps/web/tests/api-proxy-readonly.test.ts`
- `progress.md`
- `subagent-reports/w4-s20-csrf-worker.md`

## Behavior
- Added CSRF protection for mutating API proxy requests (`POST`, `PATCH`, `PUT`, `DELETE`, etc.).
- Safe/read-only methods (`GET`, `HEAD`, `OPTIONS`) continue through existing behavior.
- Mutating requests are allowed when the `Origin` header exactly matches the frontend request origin.
- Reverse-proxy deployments are supported by deriving the public origin from `x-forwarded-host` and `x-forwarded-proto` when present, avoiding hardcoded Portless or localhost host lists.
- Mutating requests with `sec-fetch-site: cross-site` are rejected even if no `Origin` header is present.
- Existing production read-only blocking and backend bearer-token forwarding are preserved.

## Validation
- `pnpm --filter @repo/web test -- api-proxy-readonly.test.ts` ✅
- `pnpm --filter @repo/web typecheck` ✅
- `pnpm --filter @repo/web lint` ✅

## Remaining risks
- Mutating requests without `Origin` and without cross-site Fetch Metadata are still allowed to preserve compatibility with non-browser clients and older clients.
- Requested `context.md` and `plan.md` were not present at the repository root when read.
