# W4-S20 Todo #47 German redaction fix handoff

## Changed files

- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
- `subagent-reports/w4-s20-redaction-german-fix-worker.md`

## Exact fix

- Added German contextual keyword coverage for recovery/backup/passcode-style code values in the existing public metadata redaction and generated tag guardrail policy:
  - `wiederherstellungs?[-\\s]?code` for `Wiederherstellungscode` / spaced or hyphenated variants.
  - `backup[-\\s]?code` for `Backup-Code` / `Backup Code`.
  - `zugangs[-\\s]?code` for `Zugangscode` / spaced or hyphenated variants.
  - Also broadened related German code keywords to tolerate hyphen/space variants (`sicherheits`, `einmal`, `sicherungs`, `ersatz`).
- Kept matching contextual: values are only redacted/blocked when a sensitive keyword is followed by a secret-like value.
- Preserved broad archive-label false-positive protection: labels such as `Wiederherstellungscode`, `Backup-Code`, and `Zugangscode Brief` remain unchanged when no secret-like value is present.
- No PromptService or prompt-file paths were added.
- Did not touch rate-limit/server/API/frontend files.

## Tests added/updated

- Added positive generated-tag guardrail tests for German secret-bearing labels:
  - `Wiederherstellungscode ABCD-EFGH-IJKL`
  - `Backup-Code 123-456`
  - `Zugangscode ZXCV-BN987`
- Added positive redaction tests for German secret-bearing metadata text:
  - `Wiederherstellungscode ABCD-EFGH-IJKL`
  - `Backup-Code: 123-456`
  - `Zugangscode ist ZXCV-BN987`
- Added false-positive tests proving broad labels remain allowed/unchanged:
  - `Wiederherstellungscode`
  - `Backup-Code`
  - `Zugangscode Brief`

## Validation

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts tests/utils/logger.test.ts` — passed; 2 files / 33 tests.
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/backend lint` — passed.

## Ready for re-review

Yes. The reviewer-identified German recovery/backup/passcode coverage gap is fixed with focused tests and no unrelated scope changes.
