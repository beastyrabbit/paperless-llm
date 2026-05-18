# Todo #32 / W4-S17 final implementation handoff: editable tag-language aliases

Prepared against the latest checked-out settings/API state. No source files were edited; only this handoff file was written.

## Goal / requested outcome

Implement editable German tag-language aliases backed by settings, preserving current default behavior. Move hardcoded-only aliases from `apps/backend/src/utils/tagLanguage.ts` into TypeScript defaults plus TinyBase-backed overrides; expose/edit them through the settings API and Language settings UI; use them in Pi prompt guidance/runtime paths. Also replace the hardcoded document-type `catalog_guidance.aliases` in `PiDocumentAgent` with separate default/settings-backed guidance if included in scope.

## Latest current state and evidence

### Backend tag-language utility

- `apps/backend/src/utils/tagLanguage.ts:1-8` has the alias key normalizer: trim, lowercase, NFKD accent stripping, `_`/`-` to spaces, collapse whitespace. Preserve this behavior and export it if tests/UI need matching normalization.
- `apps/backend/src/utils/tagLanguage.ts:10-50` still hardcodes `GERMAN_TAG_ALIASES` as a private `Map<string,string>` with defaults such as `invoice -> Rechnung`, `pet -> Haustier`, `order confirmation -> Bestellbestätigung`.
- `apps/backend/src/utils/tagLanguage.ts:65-73` has `localizeGeneratedTagName(s)` using that hardcoded map only for German prompt language and deduping localized names.
- `apps/backend/src/utils/tagLanguage.ts:76-88` has `localizeGeneratedTagQuestion` for review-question replacement.
- `apps/backend/src/utils/tagLanguage.ts:91-101` has hardcoded German prompt language guidance, including the generic English tag avoid-list.

Important latest observation: `localizeGeneratedTagName(s)` are currently not imported anywhere outside `tagLanguage.ts` (`grep` found only definitions). The active Pi usages are currently `buildPromptLanguageInstruction(...)` and `normalizePromptLanguage(...)`. Editable aliases therefore need to feed both future/pure localization helpers and prompt guidance if they are to affect current agent behavior.

### Pi agent call sites

- `apps/backend/src/agents/PiDocumentAgent.ts:1123-1169` resolves runtime settings from `tinybase.getAllSettings()`: Ollama models, confirmation settings, `promptLanguage`, history. No alias settings are read.
- `apps/backend/src/agents/PiDocumentAgent.ts:1636-1658` calls `tagExplorer.exploreTags({... promptLanguage })`; add alias settings to `TagExplorerInput` if tag explorer prompt guidance should use them.
- `apps/backend/src/agents/PiDocumentAgent.ts:2250-2282` builds the document system prompt. `2254` calls `buildPromptLanguageInstruction(promptLanguage)`. `2272` hardcodes document-type alias guidance: `Allgemeine Geschäftsbedingungen -> AGB; Festsetzungsbescheid/Rundfunkbeitragsbescheid -> Gebührenbescheid; order confirmation -> Bestellbestätigung; discount/marketing letters -> Werbung.`
- `apps/backend/src/agents/PiDocumentAgent.ts:2284-2399` builds the document user prompt. The JSON payload hardcodes `catalog_guidance.aliases` at `2354-2365` with AGB/Gebührenbescheid/Bestellbestätigung/Werbung mappings.
- `apps/backend/src/agents/PiDocumentAgent.ts:2504-2531` creates the Pi agent and passes `settings.promptLanguage` into `buildSystemPrompt`/tools; extend this settings object and prompt-builder signatures if aliases are used there.
- `apps/backend/src/agents/PiDocumentAgent.ts:2591-2605` calls `buildUserPrompt(..., settings.promptLanguage)`; pass resolved catalog-guidance aliases here if replacing hardcoded payload aliases.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:131-148` resolves runtime settings but no aliases.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:263-295` builds tag explorer prompt and calls `buildPromptLanguageInstruction(input.promptLanguage ?? promptLanguage)` at `270`.

Keep two alias concepts separate:

1. **Tag-language aliases**: generated/generic tag name -> localized tag name (currently `GERMAN_TAG_ALIASES` in `tagLanguage.ts`).
2. **Catalog/document-type guidance aliases**: synonym -> broad document type guidance (currently hardcoded in `PiDocumentAgent` system/user prompts). Do not apply document-type aliases as tag localizations.

### Backend settings API and current contract constraints

- `apps/backend/src/api/index.ts:231-234` routes `PATCH /api/settings` through `SettingsUpdateBodySchema` before `settingsHandlers.updateSettings`.
- **Latest important change vs older handoffs:** `packages/api-contracts/src/request-schemas.ts:32-39` defines allowed settings values as `ShortTextSchema` strings (max 512), numbers, booleans, null, arrays, or records. `SettingsUpdateBodySchema` is not loose anymore; it is `Schema.Record({ key: ShortTextSchema, value: SettingsValueSchema })` at `request-schemas.ts:49-52`.
  - A JSON string containing all default aliases will likely exceed 512 chars, so a plain `tag_language_aliases_de: "[...]"` PATCH may fail route validation unless the schema is widened for this key/value shape.
  - Sending arrays is allowed by the route schema, but current `updateSettings` stringifies non-boolean values with `String(value)`, so arrays of row objects would store as `[object Object]` unless special-cased.
  - Recommended: add an explicit alias-row schema to `SettingsValueSchema`/settings route handling or safely widen settings strings for selected keys; then special-case alias values in `updateSettings` to validate/normalize and JSON.stringify rows before storing.
- `apps/backend/src/api/settings/api.ts:33-77` defines backend `Settings` response; add alias fields here.
- `apps/backend/src/api/settings/api.ts:81-130` defines `SettingsUpdate`; route validation is from api-contracts, but this type still matters for handler compile-time safety. Add alias update fields here too.
- `apps/backend/src/api/settings/handlers.ts:124-214` builds the settings response. Add DB/default alias resolution here.
- `apps/backend/src/api/settings/handlers.ts:221-315` maps frontend/API keys to TinyBase keys. Add alias key mappings here.
- `apps/backend/src/api/settings/handlers.ts:324-356` persists updates. It only special-cases nested `tags`; everything else becomes `String(value)`. Alias arrays/objects require special handling here.
- `packages/api-contracts/src/types.ts:1-51` defines the shared/frontend `Settings` interface. Add response fields here if consumed by `apps/web/lib/api.ts` or typed web callers.

### TinyBase persistence / migration/default strategy

- `apps/backend/src/services/TinyBaseService.ts:186-190` settings table values are strings: `{ key, value, updatedAt }`.
- `apps/backend/src/services/TinyBaseService.ts:745-889` migrates known canonical settings from persisted/config aliases. There is no existing alias setting key to migrate from.
- `apps/backend/src/services/TinyBaseService.ts:1710-1755` `getSetting`, `setSetting`, and `getAllSettings` are string-only.

Recommended final default/migration strategy:

1. Put defaults in TypeScript, not prompt files. Example exports from `tagLanguage.ts` or a small adjacent module:
   - `TagLanguageAliasRow = { source: string; target: string }`
   - `DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE` containing the current `GERMAN_TAG_ALIASES` entries as rows.
   - `DEFAULT_CATALOG_GUIDANCE_ALIASES` separately if implementing catalog guidance settings.
2. Store user-edited aliases as JSON strings in TinyBase, e.g. `tag_language.aliases.de` and optionally `catalog_guidance.aliases`.
3. Do **not** eagerly write defaults to TinyBase. `getSettings` and agent runtime should return/use defaults when the DB setting is absent, empty, malformed, or normalizes to no valid rows. This keeps reset-to-default possible by clearing/storing empty string and avoids unnecessary migrations.
4. `getSettings` should expose either:
   - preferred with current provider simplicity: top-level scalar-ish field `tag_language_aliases_de`, but ensure route schema can accept values larger than 512 if this is a JSON string; or
   - top-level array field `tag_language_aliases_de: AliasRow[]`, with backend `updateSettings` special-casing arrays to validated JSON string storage and frontend provider/UI adjusted accordingly.
5. Parse/normalize tolerantly: accept arrays of `{source,target}`; trim; drop empty/invalid rows; dedupe on normalized source (document whether first or last wins; last-wins is common for overrides); fall back to defaults if JSON parse fails.
6. No TinyBase migration is required because previous aliases were hardcoded only. Only add migration entries if a deliberate config/YAML path is introduced.

### Frontend settings/TinyBase/UI

- `apps/web/lib/tinybase/schemas.ts:10-96` defines all settings values. Add a setting such as `"tag_language.aliases.de"` (string default `""` if storing JSON locally) or a compatible value shape if provider is widened.
- `apps/web/lib/tinybase/schemas.ts:117-164` maps top-level API fields to store keys. Add `tag_language_aliases_de -> "tag_language.aliases.de"` if using a top-level API field.
- `apps/web/lib/tinybase/provider.tsx:65-75` limits `updateSetting` values to `string | number | boolean`; this currently fits JSON-string local storage but not direct row arrays.
- `apps/web/lib/tinybase/provider.tsx:119-139` syncs top-level API fields and converts by schema type; nested aliases would need a special block like `tags` at `141-149`.
- `apps/web/lib/tinybase/provider.tsx:240-257` `updateSetting` maps store key to API key and PATCHes one scalar.
- `apps/web/lib/tinybase/provider.tsx:287-350` `updateSettings` supports mapped keys and optimistic rollback.
- `apps/web/lib/tinybase/provider.tsx:358-390` `saveSettings` serializes all mapped store values and special-cases workflow `tags`.
- `apps/web/app/settings/components/LanguageTab.tsx:23-98` is the natural UI location. It currently has only UI language and prompt language cards, using `useStringSetting("language")` and `updateSetting("language", value)`.
- Existing language message keys are in `apps/web/messages/en.json:495-511` and `apps/web/messages/de.json:495-511`; add alias editor labels/descriptions/placeholders/errors in both.
- `apps/web/tests/settings-page.test.tsx` mocks `LanguageTab`, so add a focused `LanguageTab` test rather than relying on settings page coverage.

Recommended UI behavior:

- Add a third card/full-width section in `LanguageTab` for German tag aliases.
- Display default rows when the stored setting is empty/invalid; only persist when the user edits/saves/resets.
- Inputs per row: source alias and target localized tag; remove button; add alias; reset to defaults.
- Client validation: trim values, drop empty rows on save, show duplicate normalized source warning if feasible. Backend must still be tolerant/safe.
- If keeping current provider scalar approach, persist normalized rows as a JSON string through `updateSetting("tag_language.aliases.de", json)`, but first fix backend route schema max-length issue.

## Suggested implementation approach

1. **Backend alias utility**
   - Refactor `tagLanguage.ts` to export default rows and helper functions:
     - `normalizeAliasKey` (currently private).
     - `parseTagLanguageAliasRows(value, fallbackRows?)` / `serializeTagLanguageAliasRows(rows)`.
     - `buildTagLanguageAliasMap(rows)`.
     - `localizeGeneratedTagName(name, promptLanguage, rowsOrOptions?)` and `localizeGeneratedTagNames(...)` backward-compatible with defaults.
     - `buildPromptLanguageInstruction(promptLanguage, rowsOrOptions?)` so current Pi prompts can include a dynamic avoid/prefer mapping (or at least derive the avoid-list from alias sources rather than hardcoded text).
   - Keep this module pure/synchronous; do not inject/read TinyBase from utilities.
2. **Backend settings contract**
   - Add fields to `apps/backend/src/api/settings/api.ts`, `packages/api-contracts/src/types.ts`, `apps/backend/src/api/settings/handlers.ts` response, and `SETTINGS_KEY_MAP`.
   - Decide/fix PATCH shape before UI work:
     - If JSON string field: update `SettingsUpdateBodySchema` to allow longer strings for alias settings or generally a larger settings string max. Test that full default alias JSON passes route validation.
     - If array field: add/update schema for alias rows and special-case array serialization in `updateSettings`.
   - In `getSettings`, return stored valid JSON/rows or default serialization. Malformed DB values should not throw.
3. **Agent runtime**
   - In `PiDocumentAgent.getRuntimeSettings`, read `settings["tag_language.aliases.de"]` and parse to rows/defaults.
   - Pass rows/options to `buildSystemPrompt`, `buildUserPrompt` if language prompt guidance or payload needs it.
   - For `PiTagExplorerAgent`, either read the same setting in its own runtime settings or add `tagLanguageAliases` to `TagExplorerInput` from `PiDocumentAgent`; avoid duplicate behavior drift if both agents independently parse.
   - Replace the hardcoded `catalog_guidance.aliases` only with a separate `catalog_guidance_aliases` setting/default, not with tag alias rows.
4. **Frontend**
   - Add TinyBase schema and maps.
   - Add alias editor in `LanguageTab` with translations.
   - Keep frontend defaults in sync with backend. If sharing from backend is impractical due package boundaries, duplicate a small constant with tests; do not import backend source directly into web.
5. **Tests**
   - Add helper tests first, then settings API/provider/UI tests.

## Tests to add/update

Backend:

- New `apps/backend/tests/utils/tagLanguage.test.ts` (or similar):
  - default German behavior remains (`invoice` -> `Rechnung`; non-German unchanged);
  - custom alias rows override/add aliases;
  - normalization handles case, accents, `_`/`-`, whitespace;
  - invalid/empty rows are ignored; malformed JSON falls back to defaults;
  - `buildPromptLanguageInstruction("de", customRows)` reflects custom alias sources/targets if implemented.
- Extend `apps/backend/tests/api/settings.test.ts`:
  - `getSettings` returns default alias value when TinyBase has no alias setting;
  - valid DB value at `tag_language.aliases.de` is returned;
  - malformed DB value falls back safely to default;
  - `updateSettings({ tag_language_aliases_de: ... })` writes `tag_language.aliases.de` as normalized JSON;
  - route/schema-level test if available, or at least ensure full default alias payload is accepted by `SettingsUpdateBodySchema` (critical because current string max is 512).
- Agent tests if prompt/runtime signatures change materially:
  - `apps/backend/tests/agents/PiDocumentAgent.test.ts` already covers prompt constraints; add a check that custom tag alias settings affect prompt language guidance/tag explorer prompt input if exposed.

Frontend:

- Extend `apps/web/tests/tinybase-provider.test.tsx`: current probe only checks `paperless.url`; add `useStringSetting("tag_language.aliases.de")` to verify GET mapping and PATCH rollback/update behavior.
- Add focused `LanguageTab` test for default rows, editing, add/remove/reset, and `updateSetting` payload. Do not rely on `settings-page.test.tsx` because `LanguageTab` is mocked there.

## Validation commands

Targeted:

- `pnpm --filter @repo/backend test -- tests/api/settings.test.ts`
- `pnpm --filter @repo/backend test -- tests/utils/tagLanguage.test.ts` (new path if added)
- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts` (if agent prompts/runtime changed)
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/web test -- tests/tinybase-provider.test.tsx`
- `pnpm --filter @repo/web test -- <new LanguageTab test path>`
- `pnpm --filter @repo/web typecheck`

Final smoke if time permits:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`

## Risks / constraints

- Mandatory project rule: Pi agent instructions/tools/schemas/placeholders must remain TypeScript-defined. Do not add prompt files or reintroduce `PromptService`.
- TinyBase settings values are strings; arrays/objects need validated JSON serialization at persistence boundaries.
- Current API-contract settings PATCH schema has a 512-char string limit. Full alias JSON likely exceeds it; fix/validate this explicitly.
- Current frontend provider scalar value type makes JSON-string storage easiest, but backend route validation must support it. Nested/array response shapes require provider changes.
- Do not make pure tag-language helpers read services. Resolve settings in agent/API layers and pass rows/options in.
- Keep tag-language aliases and catalog/document-type guidance aliases distinct.
- Preserve backward-compatible defaults whenever settings are absent, empty, or malformed.

## Final worker prompt

Implement Todo #32 / W4-S17 editable German tag-language aliases using the latest settings/API state. Refactor `apps/backend/src/utils/tagLanguage.ts` to export TypeScript default alias rows plus pure parse/normalize/serialize/localize/prompt-instruction helpers that accept optional alias rows and fall back to defaults. Add settings support for `tag_language.aliases.de` exposed as `tag_language_aliases_de` (or an explicitly chosen equivalent), updating backend `Settings`/`SettingsUpdate`, shared API-contract `Settings`, settings handlers, TinyBase key mapping, frontend TinyBase schema/maps/provider, and Language settings UI. Because current `SettingsUpdateBodySchema` limits strings to 512 chars and arrays would currently persist as `[object Object]`, explicitly fix the PATCH schema/handler boundary so full alias payloads validate and are stored as normalized JSON strings. `getSettings` and agent runtime must use valid stored aliases or defaults; malformed/empty values must not break processing. Extend `PiDocumentAgent`/`PiTagExplorerAgent` prompt-language guidance to use resolved aliases without service reads in utility code. If replacing hardcoded `catalog_guidance.aliases`, implement a separate default/settings-backed `catalog_guidance_aliases` path, not mixed with tag aliases. Add a compact German tag alias editor to `LanguageTab` with en/de messages. Add backend tagLanguage/settings tests, include a schema/payload-size acceptance test, and add frontend provider/LanguageTab tests. Validate targeted backend/web tests and typechecks, then lint/full tests if feasible.