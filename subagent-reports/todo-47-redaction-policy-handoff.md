# Todo #47 / W4-S20 Redaction Policy Handoff

Scope: implementation-ready context for improving sensitive-data redaction policy. I inspected backend redaction utilities, PiDocumentAgent tests, logging/error sanitization, and the audit task docs. No source files were edited.

## Requirement source

- `docs/AUDIT.md:55`: A9 says current sensitive-data redaction is “keyword-only, German-biased, and permissive” and asks to “Expand patterns for OTP/passcode/activation code, add entropy/length heuristics, and document the policy.”
- `docs/plans/audit-rework-tasks.md:373-384`: W4-S20 includes unchecked item “Improve sensitive-data redaction policy.”
- `subagent-reports/w4-polish-context.md:221-223`: confirms backend redaction is narrow and warns not to print local runtime secrets from ignored `apps/backend/data/`.

## Current behavior and high-value evidence

### PiDocumentAgent metadata redaction and guardrails

File: `apps/backend/src/agents/PiDocumentAgent.ts`

- Verifier prompt already tells the small model to reject secrets in title/summary:
  - `914-955` builds `buildMetadataVerifierPrompt`; rule at `935`: reject title/summary containing activation codes, PINs, TANs, passwords, or one-time codes.
- Current actual redaction is only:
  - `957-958`: keyword regex `/freischaltcode|\bpin\b|\btan\b|passwort|kennwort|aktivierungscode|activation code|login code|security code/i`
  - `966-967`: value regex `/\b[A-Z0-9]{6,}\b/` and global replacement variant.
  - `969-971`: `redactSensitiveMetadataText(value)` redacts only if a keyword matches and then replaces only uppercase alnum runs of length >= 6.
  - `974-975`: titles use `normalizePublicTitle`, which calls `redactSensitiveMetadataText(normalizeName(value))` and then strips dangling redacted suffixes.
- Tag protection uses the same narrow policy:
  - `960-964`: `isUnsafeGeneratedTagName` returns true for empty normalized names or keyword + sensitive value.
  - `1599-1600`: `request_human_decision` blocks unsafe tag candidate names.
  - `1896-1897`: `finish_document_metadata` blocks unsafe `tagNamesToAdd`.
- Summary path:
  - `2024-2026`: summary note text is normalized and redacted with `redactSensitiveMetadataText` before note creation.
  - `2046-2058`: if note creation fails, processing logs `String(noteResult.left)`; this should stay sanitized or at least should not include note body after any policy changes.
- Prompt instruction already forbids secrets in public metadata:
  - `2166`: “Do not put secret activation codes, PINs, TANs, passwords, or one-time codes in titles or summaries; store them only in extracted facts if needed.”
- Processing event persistence can store tool args/results verbatim:
  - `2434-2454`: `recordPiEvent` saves `args` for tool calls and `result` for tool results.
  - `2619-2626`: those events are persisted to TinyBase processing logs when not dry-run.
  - `2626-2687`: `agentMessages` can be persisted if `debug.save_processing_history` is enabled. This is expected for processing history, but expanded redaction should avoid putting secrets into public metadata; do not globally scrub document content/transcripts unless product explicitly wants lossy debug history.

### Tests that currently lock the narrow behavior

File: `apps/backend/tests/agents/PiDocumentAgent.test.ts`

- `316-328`: tag guardrails block `Freischaltcode ABC123456` and `PIN 987654`, but allow broad/non-secret archive tags like `Freischaltcode`, `TK-App`, `PIN-Brief`, `Versicherung`, `SKYWAY`.
- `331-343`: redaction tests ensure `pin`/`tan` are not matched inside unrelated words (`Spinning`, `Kontostand REF202405`) and uppercase codes are redacted when standalone `PIN`/`TAN` keywords are present.

These tests are the right place to add cases for expanded policy while preserving important false-positive protections.

### Structured logger / header sanitization already exists, but is key-name based

File: `apps/backend/src/utils/logger.ts`

- `28-29`: logger redacts object fields whose keys match `/authorization|api[-_]?key|token|secret|password|passwd|cookie|set-cookie|credential/i`.
- `53-72`: recursive `redactValue` serializes BigInt/Date/circular values and redacts by key name only. It does **not** scan arbitrary string values for OTP/passcode/document secrets.
- `74+`: `serializeError` serializes `Error.message`, stack, and causes. If an error message itself contains a secret-like string under a non-secret key, current logger will preserve it.

File: `apps/backend/tests/utils/logger.test.ts`

- `30-60`: verifies authorization/x-api-key/cookie/paperlessToken fields become `***`, BigInt becomes string, circular refs become `[Circular]`.

Recommendation: do not mix document metadata redaction into generic logger unless the task explicitly broadens logging sanitization. Generic value scanning can create high false-positive logs. If touched, prefer a small exported reusable string redactor and apply only to error messages known to carry user/tool metadata, with tests.

### HTTP request header sanitization

File: `apps/backend/src/server.ts`

- `288-304`: `SENSITIVE_HEADERS` masks authorization, x-api-key, cookie, set-cookie, proxy-authorization.
- `838-840`: `http_request_failed` logs sanitized headers plus raw `error` through structured logger.
- `845-856`: request-too-large responses omit message body, good.
- Later 500 responses include `error.message`; avoid adding secret-bearing messages in new redaction code.

File: `apps/backend/tests/server.test.ts`

- `143-153`: verifies sensitive headers are masked.

### Error types and third-party service errors

- `apps/backend/src/errors/index.ts:17-40`: service error types carry messages/status/cause; no centralized sanitization.
- `apps/backend/src/services/MistralService.ts:181-185`: Mistral error message includes raw response text. This is outside the specific metadata-redaction utility, but if any new redaction errors include model/provider responses, be careful not to log secret-bearing document snippets.

## Proposed policy for implementation

Implement a focused **public metadata redaction policy** for generated Paperless public metadata fields and generated tag names:

1. **Scope of redaction**
   - Apply to generated `title` and `summary` via existing `normalizePublicTitle`/`redactSensitiveMetadataText` paths.
   - Apply to generated tag name safety via existing `isUnsafeGeneratedTagName` path.
   - Keep broad archive labels valid: e.g. `Freischaltcode`, `PIN-Brief`, `TAN Brief`, `OTP Setup`, `Zugangsdaten` without an actual secret value should not be blocked/redacted.

2. **Keyword set**
   Expand beyond current German-biased keywords to include variants such as:
   - German: `freischaltcode`, `aktivierungscode`, `zugangscode`, `sicherheitscode`, `einmalcode`, `einmalpasswort`, `passwort`, `kennwort`, standalone `pin`, standalone `tan`.
   - English: `activation code`, `access code`, `security code`, `login code`, `verification code`, `one-time code`, `one time code`, `otp`, `passcode`, `password`, standalone `pin`, standalone `tan`, `recovery code`, `backup code`.
   - Prefer word boundaries/lookarounds so `Spinning`, `Kontostand`, `Important`, etc. do not trip `pin`/`tan`.

3. **Value detectors**
   Redact secret-like values near those keywords, not just uppercase alnum:
   - Numeric codes: 4-12 digits with optional separators (`123456`, `123 456`, `123-456`), especially after keyword separators like `:`, `-`, `=`, `ist`, `is`.
   - Alphanumeric access codes: 6-32 chars, case-insensitive, allowing separators (`ABc12345`, `ABCD-EFGH-1234`, `ab12 cd34`).
   - High-entropy long tokens: alnum/base32/base64url-like strings length >= ~16 even if lowercase/mixed-case, when a sensitive keyword is present.
   - Do **not** redact ordinary invoice/reference IDs unless keyword context is present. Existing `Kontostand REF202405` should remain unchanged.

4. **Heuristic shape**
   - Best implementation target: replace the current two regex constants with named helpers, e.g. `containsSensitiveMetadataKeyword`, `redactSensitiveMetadataText`, `isSecretLikeMetadataValue`, `isUnsafeGeneratedTagName`.
   - For text redaction, prefer targeted regexes that preserve label text: `PIN 123456` -> `PIN [redacted]`, `activation code: ab12-cd34` -> `activation code: [redacted]`.
   - For tag names, return unsafe only when both keyword and actual secret-like value are present. Empty names should remain unsafe.
   - Keep replacement token `[redacted]` because existing tests expect it.

5. **Documentation**
   - Add a short policy note near the helper or in an existing docs file (likely `docs/AUDIT.md` if marking A9 status, or a new small backend comment near helpers). Keep it implementation-oriented and do not include real secrets.

## Exact files likely to edit

Primary:
- `apps/backend/src/agents/PiDocumentAgent.ts`
  - Replace/expand helpers at `957-971`.
  - Ensure `normalizePublicTitle` still strips trailing redaction at `974-977`.
  - No PromptService; keep Pi agent TypeScript-defined instructions/tools only.
- `apps/backend/tests/agents/PiDocumentAgent.test.ts`
  - Extend `tag guardrails` at `316-328`.
  - Extend `redactSensitiveMetadataText` at `331-343`.

Optional if implementation chooses to centralize/document:
- `docs/AUDIT.md` or a nearby code comment in `PiDocumentAgent.ts` documenting the policy. If updating docs, do not mark A9 complete unless the project’s task workflow expects that.
- `apps/backend/src/utils/logger.ts` and `apps/backend/tests/utils/logger.test.ts` only if deliberately adding string-level sanitization for error messages. Otherwise leave generic logger as-is to avoid over-redacting arbitrary values.
- `apps/backend/src/server.ts` and `apps/backend/tests/server.test.ts` likely do not need edits; header sanitization already covers A6.

## Tests to add

Add deterministic unit tests with fake/example values only:

- Redaction positives:
  - `PIN 123456` -> `PIN [redacted]`
  - `TAN 123-456` -> `TAN [redacted]` or equivalent normalized replacement.
  - `Activation code: ab12-cd34` -> `Activation code: [redacted]`
  - `OTP 987654` -> `OTP [redacted]`
  - `Passcode ZXCV-BN987` -> `Passcode [redacted]`
  - `Recovery code ABCD-EFGH-IJKL` -> `Recovery code [redacted]`
- Redaction negatives / false positives:
  - Existing `Spinning Studio INVOICE2024` unchanged.
  - Existing `Kontostand REF202405` unchanged.
  - `PIN-Brief`, `TAN Brief`, `Freischaltcode` broad labels unchanged.
  - Ordinary references like `Invoice INV-2024-001` unchanged without sensitive keyword.
- Tag guardrail positives:
  - `OTP 987654`, `Passcode ab12cd34`, `Activation code ABCD-EFGH` unsafe.
- Tag guardrail negatives:
  - `OTP Setup`, `PIN-Brief`, `Zugangsdaten`, `Activation Code Letter` safe unless they include an actual value.

If logger/error sanitization is touched, add tests for a serialized error whose message contains `authorization` field names vs arbitrary document-like codes, but avoid broad value scans unless explicitly required.

## Validation commands

Run targeted backend checks from repo root:

```bash
pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts tests/utils/logger.test.ts tests/server.test.ts
pnpm --filter @repo/backend typecheck
pnpm --filter @repo/backend lint
```

If docs-only plus Pi tests are changed, at minimum run:

```bash
pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts
```

Full project safety if time allows:

```bash
pnpm run test
pnpm run typecheck
pnpm run lint
```

## Risks and constraints

- Avoid false positives: `pin` and `tan` must stay standalone; current tests explicitly protect words like `Spinning` and normal references like `REF202405`.
- Avoid over-redacting broad taxonomy terms: tags/document types about code letters are valid when no actual code value appears.
- Do not print or inspect ignored runtime data under `apps/backend/data/`; it may contain real secret-like values.
- Do not reintroduce prompt files or `PromptService`; Pi agent instructions/tools/schemas remain TypeScript-defined per `AGENTS.md`.
- Generic logger is key-name based by design; expanding it to scan all string values may be noisy and is not required unless the implementation owner chooses it deliberately.

## Compact worker prompt

Implement Todo #47 / W4-S20 sensitive-data redaction policy. Focus on `apps/backend/src/agents/PiDocumentAgent.ts` helpers around `sensitiveMetadataKeywordPattern`, `isUnsafeGeneratedTagName`, and `redactSensitiveMetadataText`: expand keyword coverage for OTP/passcode/activation/access/security/login/verification/recovery/backup codes plus German variants, add numeric/alphanumeric/long-token heuristics with keyword context, preserve `[redacted]`, and keep broad non-secret archive labels valid. Add/extend tests in `apps/backend/tests/agents/PiDocumentAgent.test.ts` for numeric PIN/TAN/OTP, mixed-case/separated activation/passcodes, high-entropy recovery/backup codes, and false positives (`Spinning`, `Kontostand REF202405`, `PIN-Brief`, `Freischaltcode`, ordinary invoice refs). Do not edit unrelated frontend work or reintroduce PromptService. Only touch logger/server tests if you intentionally change logging sanitization; current header/key-name sanitization already exists. Validate with targeted backend tests, typecheck, and lint.
