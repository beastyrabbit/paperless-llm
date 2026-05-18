# W4-S17 memory validation worker report

Implemented Todo #31 / W4-S17: validate memory blobs before PiDocumentAgent prompt/resume injection.

## Changes

- Added exported prompt-safe memory types and sanitizers in `apps/backend/src/agents/PiDocumentAgent.ts`:
  - `sanitizeHumanDecisionsForPrompt`
  - `sanitizeReviewFeedbackForPrompt`
  - `sanitizeAppliedMetadataForPrompt`
  - `sanitizeAgentMessagesForResume`
  - `readPromptSafeDocumentAgentMemory`
- Sanitizers are tolerant and non-throwing:
  - invalid entries are dropped and logged with `console.warn`
  - case memory is preferred only when sanitized entries survive; otherwise legacy TinyBase memory is used
  - fallback session IDs remain deterministic by doc/time
- Added count/string/depth/JSON-size caps for prompt-visible memory.
- Redacts prompt-visible sensitive strings via `redactSensitiveMetadataText`.
- Resume transcript now allows only sanitized assistant and tool-result messages; persisted system/user messages are dropped.
- Wired sanitized memory into:
  - PiDocumentAgent prompt JSON (`human_decisions`, `review_feedback`, `already_applied_metadata`)
  - PiAgent resume `initialState.messages`
  - case memory writeback for human decisions/review feedback on successful final update path

## Tests added

Focused tests in `apps/backend/tests/agents/PiDocumentAgent.test.ts` cover:

- invalid case memory not surviving prompt/resume sanitization
- valid human decision/review feedback allowlist preservation, unknown-key dropping, truncation, redaction
- legacy TinyBase fallback with transcript item validation
- resume transcript filtering of invalid/system/user messages
- applied metadata projection with malformed entries ignored and final decision fallback
- memory count/string/value caps independent of prompt budgeting

## Validation

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts tests/utils/promptData.test.ts tests/services/TinyBaseService.test.ts` — passed (62 tests)
- `pnpm --filter @repo/backend typecheck` — passed
- `pnpm --filter @repo/backend lint` — passed

Note: the originally requested workspace-prefixed Vitest paths produced “No test files found” from the backend package cwd, so I reran with backend-relative test paths.

## Risks / notes

- The repository had many pre-existing unrelated dirty/untracked files. I preserved them and only edited `PiDocumentAgent.ts`, `PiDocumentAgent.test.ts`, `progress.md`, and this report.
- Invalid drops are logged with `console.warn`; this is intentionally lightweight to avoid making corrupt memory fatal.
