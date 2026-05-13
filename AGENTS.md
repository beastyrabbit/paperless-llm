# paperless_local_llm

## Project Overview
OCR + document-processing platform with Next.js frontend and TypeScript/Effect backend.

## Mandatory Rules
- Define Pi agent instructions, tools, schemas, and structured placeholders in TypeScript; do not reintroduce PromptService or prompt-file driven processing paths.
- Keep local test/build commands passing before changes.

## Tooling
- Full stack dev: `pnpm run dev` (Portless frontend + backend)
- Frontend: `pnpm install`, `pnpm run dev:web` (3765), `pnpm run build`, `pnpm run lint`, `pnpm run typecheck`
- Backend: `pnpm run dev:backend` (8765), `pnpm run build`, `pnpm run test`, `pnpm run typecheck`
- Lint/format: Biome via `pnpm run lint` and `pnpm run format`
- Hooks: `pnpm run precommit`

## Ports
- Frontend: `https://paperless-llm-web.localhost:1355` (portless)
- Backend: `https://paperless-llm-api.localhost:1355` (portless)
- Fallback: frontend `3765`, backend `8765`
