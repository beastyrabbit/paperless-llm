# Contributing

Use Node 24 LTS and the pinned pnpm version. Copy `config.example.yaml` to an
intentional local configuration and inject environment secrets. The example
disables polling and OCR; do not enable them while testing against real documents.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, the release-script
tests, and `pnpm check:ref-artifacts` before proposing a change. Automated tests
must mock AI providers. Dependency updates use pnpm commands.

T3 actions install dependencies, start the one-process app, and run checks.
Use the machine's DevShare workflow if sharing a development server.
