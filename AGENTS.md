# Paperless Local LLM

Single-package TypeScript ESM application on Node 22/24 LTS. Hono serves JSX pages
and form/htmx actions; better-sqlite3 stores the durable pipeline journal.

Project context: https://memex.eland-vega.ts.net/pages/projects/paperless-local-llm.md

## Commands

- `pnpm install --frozen-lockfile`
- `pnpm dev` starts the one-process application on port 3765.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
- `node --experimental-strip-types --test scripts/release/*.test.mts`
- `pnpm check:ref-artifacts`
- `pnpm precommit` runs the local hook checks.

## Constraints

- Keep configuration and schemas in TypeScript and GitOps YAML. Secrets come only
  from environment variables. Never log provider bodies or raw credentials.
- Tests mock HTTP and providers. Never call a live AI provider from a test.
- Preserve the OCR uncertain state and pre-call budget reservation. Never
  automatically repeat an ambiguous paid request unless explicitly configured.
- Mutate Paperless tags only through bulk modify_tags deltas.
- Preserve human edits and unrelated custom fields. Verify remote writes.
- Run smoke checks during implementation; full verification follows completion.
- Use pnpm commands for dependency changes. Preserve release-script tests and
  bilingual legal routes.
- No Effect, Next.js, TinyBase, Qdrant, Pi runtime, or heavy ORM.
