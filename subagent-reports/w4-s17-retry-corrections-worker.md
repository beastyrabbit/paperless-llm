# W4-S17 Todo #28 Retry Corrections Worker Handoff

## Changed files

- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
- `subagent-reports/w4-s17-retry-corrections-worker.md`

## Implemented behavior

- Added exported pure helper types/functions:
  - `ToolValidationIssue`
  - `ToolValidationFeedback`
  - `parseToolValidationFeedback(text)`
  - `buildRetryCorrectionFromFinalToolError(errorText)`
- `parseToolValidationFeedback` recognizes Pi/TypeBox validation text of the form `Validation failed for tool "...":` and parses `- path: message` issue lines until `Received arguments:`.
- `buildRetryCorrectionFromFinalToolError` now:
  - preserves non-validation feedback with generic final-tool retry instructions under `Final tool feedback:`;
  - converts validation paths into targeted correction requirements for `request_human_decision` and `finish_document_metadata` fields;
  - includes guidance for `tagIdsToAdd`/`tagIdsToRemove`, `tagNamesToAdd`, numeric ID fields, `confidence`, required human-decision fields, JSON-string fields, string fields, and root schema errors;
  - dedupes repeated correction requirements for multiple issues in the same field class.
- Integrated the helper into the existing final-tool retry loop. Instead of always saying `Verifier feedback`, validation failures now get field-specific correction text and semantic/tool verifier errors still keep raw feedback with generic retry guidance.
- Added unit tests covering:
  - parsing TypeBox validation feedback;
  - path-specific guidance for `tagIdsToAdd.0` and `confidence`;
  - path-specific guidance for `candidateName`;
  - fallback behavior for non-validation verifier/tool errors;
  - deduping repeated correction requirements.

## Validation

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts` — exit 0; 25 tests passed.
- `pnpm --filter @repo/backend typecheck` — exit 0.
- `pnpm --filter @repo/backend lint` — exit 0.

## Remaining risks

- The parser depends on the current Pi validation message format. It is intentionally tolerant and falls back to generic guidance when the format does not match.
- Retry behavior still depends on `settings.confirmationMaxRetries`; if configured to 0, no retry prompt is issued.
