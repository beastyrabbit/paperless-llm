# W4-S20 Todo #47 Redaction Worker Handoff

## Changed files

- `apps/backend/src/agents/PiDocumentAgent.ts`
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
- `subagent-reports/w4-s20-redaction-worker.md`

## Behavior implemented

- Expanded the public metadata redaction policy used by generated Paperless titles, summaries, and generated tag-name guardrails.
- Added broader sensitive keyword coverage for German and English OTP/passcode/activation/access/security/login/verification/recovery/backup code variants, while keeping standalone `pin`/`tan` boundaries to avoid false positives such as `Spinning`.
- Added contextual secret-like value detection that only redacts/blocks values near sensitive keywords:
  - 4-12 digit numeric codes, including separated forms such as `123-456`.
  - Mixed letter/digit access-code values such as `ab12-cd34` and `ZXCV-BN987`.
  - Separated uppercase recovery/backup-code shapes such as `ABCD-EFGH-IJKL`.
  - Conservative long token-like values when keyword context is present.
- Preserved `[redacted]` as the replacement token.
- Preserved broad non-secret archive labels such as `PIN-Brief`, `TAN Brief`, `Freischaltcode`, `OTP Setup`, `Zugangsdaten`, and `Activation Code Letter`.
- Added an implementation comment documenting that this policy is intentionally contextual and scoped to public metadata/tag names, not broad document-content scrubbing.

## Tests added/updated

- Extended `tag guardrails` tests for:
  - `OTP 987654`
  - `Passcode ab12cd34`
  - `Activation code ABCD-EFGH`
  - false-positive labels such as `TAN Brief`, `OTP Setup`, `Zugangsdaten`, and `Activation Code Letter`
- Extended `redactSensitiveMetadataText` tests for:
  - numeric PIN/TAN/OTP values
  - mixed-case/separated activation/passcodes
  - recovery-code values
  - ordinary references and broad labels remaining unchanged
- Existing logger tests were run unchanged to confirm no regression in key/header-style redaction behavior.

## Validation

- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts tests/utils/logger.test.ts` — passed, 33 tests.
- `pnpm --filter @repo/backend typecheck` — passed.
- `pnpm --filter @repo/backend lint` — passed.

## Remaining risks

- The policy intentionally avoids broad string scanning outside keyword context to reduce false positives in metadata and archive taxonomy labels.
- Generic structured logger behavior remains key-name based; this worker did not add document-content scanning to logger serialization to avoid noisy over-redaction.
- Debug processing history may still persist raw model/tool event content when enabled; this task only prevents secret-like values from being exposed through public metadata/tag outputs handled by the existing PiDocumentAgent helpers.
