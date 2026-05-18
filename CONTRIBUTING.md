# Contributing to Paperless Local LLM

Thanks for helping with Paperless Local LLM. This repository is a pnpm/Turbo monorepo with a Next.js web app, a TypeScript/Effect backend, and shared workspace packages.

## Prerequisites

- Node.js 22
- pnpm 9.15.0 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Docker and Docker Compose when working on container builds or local service stacks
- Local Paperless, Ollama, Qdrant, and Mistral-compatible credentials/services as needed for the area you are testing

## Install and run locally

```bash
pnpm install
```

Preferred full-stack development uses Portless HTTPS hostnames:

```bash
pnpm run dev
```

Portless exposes:

- Web: `https://paperless-llm-web.localhost:1355`
- API: `https://paperless-llm-api.localhost:1355`

Fallback local ports are available when Portless is not in use:

```bash
pnpm run dev:parallel   # backend on 8765, web on 3765
pnpm run dev:backend    # backend only on 8765
pnpm run dev:web        # web only on 3765
```

## Configuration and secrets

- Start from `config.example.yaml` and `.env.example` for local development.
- Do not commit real tokens, API keys, Paperless credentials, model service keys, or local data files.
- Production/read-only examples live in `config.prod.readonly.example.yaml` and `.env.prod.readonly.example`.
- Prefer environment variables for secrets and machine-specific paths. Keep committed config examples safe and generic.
- If you add a new config field, update the schema, examples, and docs in the same change.

## Workspace layout

- `apps/web` — Next.js frontend.
- `apps/backend` — TypeScript backend using Effect patterns and services.
- `packages/ui` — shared UI components.
- `packages/typescript-config` — shared TypeScript configuration.

Keep Pi agent instructions, tools, schemas, and structured placeholders in TypeScript. Do not add prompt-file or `PromptService` processing paths.

## Common commands

Run from the repository root unless noted:

```bash
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run build
pnpm run precommit
```

Targeted commands are useful while developing:

```bash
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend test
pnpm --filter @repo/web typecheck
pnpm --filter @repo/web test
pnpm --filter @repo/web exec playwright test
```

The root Turbo tasks are the source of truth for CI-quality validation. Run the narrowest relevant tests while iterating, then run the broader checks before opening a PR when feasible.

## Testing expectations

- Backend behavior changes should include Vitest coverage for services, API handlers, agents, or pipeline behavior as appropriate.
- Frontend behavior changes should include component/unit tests and Playwright coverage for user-critical flows when applicable.
- Config, Docker, and dependency changes should be validated with syntax checks and the relevant build/test command where feasible.
- Document any checks you could not run and why.

## Dependency updates

Renovate is configured for pnpm workspaces, GitHub Actions, Dockerfiles (including the nonstandard root `Dockerfile.frontend`), and Docker Compose.

Routine dependency PRs should:

1. Keep lockfile changes focused on the dependency update.
2. Pass `pnpm run typecheck`, `pnpm run lint`, and relevant tests.
3. Call out migrations, breaking changes, or manual verification steps in the PR description.

### Proprietary Pi dependencies

`@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` are treated as guarded runtime dependencies because they can alter agent/tool behavior. Renovate groups them separately as `pi-agent-runtime`.

Pi dependency PRs require:

- Review by a maintainer familiar with the Pi agent integration.
- Release-note review for tool-calling, payload, structured-output, and model-provider behavior changes.
- Backend agent test coverage at minimum, including targeted Pi document/tag/consolidation tests when touched by the update.
- A documented local smoke test against the configured Ollama/Pi path, or an explicit note explaining why it was not possible.

Do not batch Pi dependency updates with unrelated dependency churn.

## Versioning and publishing policy

This monorepo is currently a private application workspace. Workspace package versions are informational and packages are not published to npm. The root package is private, and workspace packages should remain `private: true` unless the maintainers explicitly approve a publishing plan.

Because there is no package publishing workflow today, Changesets are intentionally not used. If a package becomes public or independently released, add a Changesets-based release plan before removing `private: true`.

## Pull request expectations

- Keep PRs focused and avoid batching unrelated waves or refactors.
- Preserve existing user/worktree changes when working in an active branch.
- Update docs and examples with behavior or config changes.
- Include validation commands and results in the PR description.
- Use clear commit messages; conventional prefixes such as `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, and `chore:` are preferred.
- Never include secrets, local data, generated build artifacts, or large unrelated files.

## Reporting issues

Please include a clear description, reproduction steps, expected vs. actual behavior, relevant environment details, and sanitized logs or screenshots.
