# Document Agent Overhaul

Branch: `document-agent-overhaul`

## Intent

Rework the app from a pipeline with separate pending-review and search pages into a document case system. Each document gets a durable case containing the document preview context, agent transcript, structured questions, human answers, decisions, run summaries, logs, and memory.

The default runtime remains local Pi/Ollama. OpenAI support, when enabled, is limited to a logged-in local CLI command so it can use an existing ChatGPT/Codex subscription session; no OpenAI API key is stored or used.

## Assumptions

- A durable `DocumentCase` is the organizing unit for document automation and human review.
- Pi/Ollama remains the default runtime and existing Pi prompt/tool discipline must be preserved.
- Human intervention is modeled as a structured case question plus chat guidance, not a detached pending item.
- Paperless workflow tags should carry coarse status only: `ai-processing`, `ai-needs-input`, `ai-done`, `ai-failed`.
- Detailed phase/stage state belongs in case records and logs.
- Catalog cleanup must propose changes first and require explicit approval/application.

## Reference Index

- `.ref/openclaw`: agent loop, serialized session execution, stream event boundaries, and lock patterns.
- `.ref/pi`: Pi agent package, tool loop behavior, event emission, and transcript conventions.
- `.ref/paperless-gpt`: provider/model configuration and document-processing workflow examples.
- `.ref/paperless-ngx`: Paperless API/document metadata semantics and workflow/custom-field behavior.
- OpenAI connector note: the implementation uses a local logged-in CLI command only, with a Pi-style `openai-codex` subscription model id; the previous API-key/SDK connector assumption is intentionally not implemented.
- OpenClaw agent loop docs: one serialized run per session, lifecycle/tool/assistant event streams, and transcript write locks keep state consistent.

## Implementation Checklist

- [x] Add durable case, question, answer, lock, catalog run, proposal, and unified log storage.
- [x] Migrate pending reviews/document memory into cases.
- [x] Add lock acquisition before auto/manual/SSE/full-pipeline processing and catalog runs.
- [x] Simplify Ollama settings to one generation model and one embedding model.
- [x] Add OpenAI subscription CLI connector settings for command, model, and allowed scopes with no API-key field.
- [x] Move workflow tags to coarse status tags.
- [x] Add case APIs for listing, fetching, answering, running/resuming, streaming, and logs.
- [x] Add catalog APIs for runs, proposals, decisions, application, streaming, and logs.
- [x] Rework document process/detail UI into a case page.
- [x] Replace Pending navigation with Cases/Needs Input and remove Search navigation.
- [x] Add Catalog Agent page.
- [x] Redirect `/pending` and `/search` into the case/chat flow.
- [x] Update chat sources to link to document case pages.
- [ ] Add backend and frontend tests for locks, migration, settings, cases, catalog proposals, and navigation.

## Acceptance Checklist

- [ ] Full pipeline can run on one document through the case page.
- [ ] Repeated triggers for the same document start at most one run.
- [x] Rejecting or answering a question stores durable guidance/memory on the case.
- [x] Catalog agent creates useful proposals without mutating Paperless until approved/applied.
- [ ] Search is represented through chat, with document links opening cases.
- [x] Local typecheck, lint, and backend tests pass.
