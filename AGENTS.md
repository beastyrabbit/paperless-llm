# paperless_local_llm

## Project Overview
OCR + document-processing platform with Next.js frontend and TypeScript/Effect backend.

## Mandatory Rules
- Do not hardcode prompts in code; use `PromptService` and structured placeholders.
- Keep local test/build commands passing before changes.

## Tooling
- Frontend: `pnpm install`, `pnpm run dev:web` (3765), `pnpm run build`, `pnpm run lint`, `pnpm run typecheck`
- Backend: `pnpm run dev` (8765), `pnpm run build`, `pnpm run test`, `pnpm run typecheck`
- Hooks: `pnpm run precommit`

## Ports
- Frontend: `http://paperless-web.localhost:1355` (portless)
- Backend: `http://paperless-api.localhost:1355` (portless)
- Fallback: frontend `3765`, backend `8765`
