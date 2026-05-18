# W4-S17 editable tag aliases worker handoff

## Summary
Implemented editable German tag-language aliases backed by settings while preserving the previous default alias behavior.

## Changes
- Refactored `apps/backend/src/utils/tagLanguage.ts` to export:
  - `TagLanguageAliasRow`
  - `DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE`
  - normalization/parse/serialize/map helpers
  - alias-aware localization helpers
  - alias-aware German prompt-language guidance
- Added settings/API support for `tag_language.aliases.de`, exposed as `tag_language_aliases_de`:
  - backend settings schema/update types
  - backend settings response/update handlers
  - shared API-contract `Settings` type
  - settings PATCH schema widened from short strings to user-text strings so full alias JSON passes validation
- TinyBase persistence stores normalized alias rows as JSON strings and settings GET returns defaults if the DB value is absent/malformed/empty.
- Wired aliases into Pi runtime prompts:
  - `PiDocumentAgent` reads aliases from TinyBase settings and passes them into system prompt guidance and tag explorer input
  - `PiTagExplorerAgent` reads aliases for standalone runs and uses input/runtime aliases in prompt guidance
- Added frontend support:
  - TinyBase schema/key mapping for `tag_language.aliases.de`
  - `LanguageTab` German tag alias editor with add/remove/save/reset and duplicate-source warning
  - en/de translations
  - frontend duplicate default alias constant/helpers in `apps/web/lib/tag-language-aliases.ts`
- Added/updated tests:
  - backend tag language utility tests
  - backend settings tests for defaults, stored/malformed values, update serialization, request-schema payload size
  - web TinyBase provider alias mapping tests
  - web LanguageTab editor tests

## Validation
Passed:
- `pnpm --filter @repo/backend test -- tests/utils/tagLanguage.test.ts tests/api/settings.test.ts`
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/backend lint`
- `pnpm --filter @repo/web test -- tests/tinybase-provider.test.tsx tests/language-tab.test.tsx`
- `pnpm --filter @repo/web typecheck`
- `pnpm --filter @repo/web lint`
- `pnpm --filter @repo/api-contracts typecheck`
- `pnpm --filter @repo/api-contracts lint`

## Risks / notes
- Catalog/document-type guidance aliases remain separate and unchanged; tag-language aliases were not mixed into `catalog_guidance.aliases`.
- The settings PATCH string limit was widened generally for settings values to 4,000 chars to support full alias JSON payloads.
- The worktree contains many unrelated pre-existing dirty/untracked files; edits were limited to the files listed above plus `progress.md` and this report.
