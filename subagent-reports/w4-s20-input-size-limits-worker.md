# W4-S20 Input Size Limits Worker Report

Implemented prompt/input size limits for shared backend API contracts and router query validation.

## Changes
- Added shared request-schema limits in `packages/api-contracts/src/request-schemas.ts`:
  - short text fields: 512 chars
  - user/prompt text fields: 4,000 chars
  - chat message content: 16,000 chars
  - chat messages: 50 items
  - string arrays: 200 items, with 512-char string elements
- Applied limits to high-risk prompt/user text schemas: chat, search query, pending feedback/rejection fields, case guidance/metadata strings, tag/translation text, blocked suggestions, workflow tag arrays, cleanup/merge values, and top-level settings string values.
- Added `SearchQuerySchema` and used it in `apps/backend/src/api/index.ts` for `/api/search?q=...` so oversized queries fail with the existing structured `ValidationError` path.
- Added router regression tests for oversized chat content, too many chat messages, oversized pending feedback, oversized settings strings, and oversized search queries.

## Validation
- `pnpm --filter @repo/api-contracts typecheck`
- `pnpm --filter @repo/api-contracts build`
- `pnpm --filter backend typecheck`
- `pnpm --filter backend test -- tests/api/router.test.ts`
- `pnpm --filter @repo/api-contracts lint`
- `pnpm --filter backend lint`

## Notes / Risks
- `context.md` and `plan.md` were not present at the project root when read was attempted.
- Settings validation limits top-level string values and nested setting object keys; nested object values remain `unknown` to avoid a recursive schema that breaks current OpenAPI generation.
- Existing request body parser already enforces the broader 10MB body cap.
