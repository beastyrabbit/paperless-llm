# Todo #32 / W4-S17 handoff: editable tag-language aliases

Scope inspected: backend tag language utility, Pi agent prompt usage, settings API/schema/handlers, TinyBase persistence/sync, settings UI, and existing tests. No source files were edited for this handoff.

## Current behavior and relevant files

### Hardcoded tag-language aliases

- `apps/backend/src/utils/tagLanguage.ts:1-10` normalizes alias keys by trimming, lowercasing, NFKD accent stripping, `_`/`-` to spaces, and whitespace collapsing.
- `apps/backend/src/utils/tagLanguage.ts:10-50` contains `GERMAN_TAG_ALIASES`, a hardcoded `Map<string,string>` of English/generic aliases to German tag names, e.g. `invoice -> Rechnung`, `pet -> Haustier`, `order confirmation -> Bestellbestätigung`.
- `apps/backend/src/utils/tagLanguage.ts:65-73` localizes only when `promptLanguage` normalizes to German; it maps via `GERMAN_TAG_ALIASES.get(normalizeAliasKey(trimmed)) ?? trimmed`, then dedupes localized names in `localizeGeneratedTagNames`.
- `apps/backend/src/utils/tagLanguage.ts:76-88` localizes the human-review question if the suggested tag was changed.
- `apps/backend/src/utils/tagLanguage.ts:91-100` also hardcodes German prompt guidance with a list of generic English tags to avoid.

Current direct users:

- `apps/backend/src/agents/PiDocumentAgent.ts` imports `buildPromptLanguageInstruction` and `normalizePromptLanguage`; it also uses `localizeGeneratedTagName(s)` later in tag decision/review flow (grep confirms imports and usage in this file).
- `apps/backend/src/agents/PiTagExplorerAgent.ts:256-260` injects `buildPromptLanguageInstruction(input.promptLanguage ?? promptLanguage)` into the tag explorer prompt.

Important implementation implication: current `localizeGeneratedTagName(s)` is synchronous and does not read services. To use TinyBase settings, either pass a resolved alias map/list into the localization call sites or add helper functions that accept settings/aliases while keeping pure defaults available for tests/fallbacks.

### Separate hardcoded catalog aliases in document prompt

- `apps/backend/src/agents/PiDocumentAgent.ts:2138-2170` builds the system prompt inline in TypeScript. Line `2160` hardcodes document-type alias guidance: `Allgemeine Geschäftsbedingungen -> AGB; Festsetzungsbescheid/Rundfunkbeitragsbescheid -> Gebührenbescheid; order confirmation -> Bestellbestätigung; discount/marketing letters -> Werbung.`
- `apps/backend/src/agents/PiDocumentAgent.ts:2172-2257` builds the user prompt payload. `catalog_guidance.aliases` is hardcoded at `2241-2252` with the same five-ish document-type alias mappings.
- `apps/backend/src/agents/PiDocumentAgent.ts:1012-1058` resolves runtime settings from `tinybase.getAllSettings()`, currently including models, confirmation settings, prompt language, and save history, but no alias settings.

The user task says "moving tag-language aliases into editable settings" and mentions `catalog_guidance.aliases`. Treat this as two alias surfaces:
1. Tag localization aliases (`tagLanguage.ts`) must be editable and defaulted.
2. Prompt catalog alias guidance should also come from settings/defaults instead of being hardcoded, if included in scope. Name it distinctly from tag aliases to avoid confusing tag names with document-type mappings.

### Settings API/schema/handler pattern

- `apps/backend/src/api/settings/api.ts:10-29` defines nested workflow `tags` config schema.
- `apps/backend/src/api/settings/api.ts:33-77` defines the `Settings` response schema. Add any new settings response field here if this schema remains authoritative for backend types.
- `apps/backend/src/api/settings/api.ts:81-125` defines `SettingsUpdateSchema`, but the actual route body validation uses `@repo/api-contracts` loose object schema (see below), so backend compile-time types matter more than strict request validation.
- `packages/api-contracts/src/request-schemas.ts:14-18` defines `LooseObjectSchema` and `SettingsUpdateBodySchema = LooseObjectSchema`; the PATCH route accepts arbitrary keys.
- `apps/backend/src/api/index.ts:227-230` routes `PATCH /api/settings` through `SettingsUpdateBodySchema` then `settingsHandlers.updateSettings`.
- `apps/backend/src/api/settings/handlers.ts:28-63` has helpers for merging TinyBase strings with config defaults.
- `apps/backend/src/api/settings/handlers.ts:124-214` builds the settings response. Add alias defaults/DB merge here.
- `apps/backend/src/api/settings/handlers.ts:221-315` maps API keys to TinyBase keys in `SETTINGS_KEY_MAP`. Add alias keys here if using explicit API names.
- `apps/backend/src/api/settings/handlers.ts:324-350` writes every update to TinyBase as strings; special handling currently exists only for nested `tags` objects and masked secrets. For nested alias objects/arrays, add analogous special handling or store a single JSON string under a canonical key.

Recommended backend setting shape:

- Store JSON strings in TinyBase, because settings table values are strings (`TinyBaseService` schema below). Suggested canonical keys:
  - `tag_language.aliases.de` for tag localization aliases.
  - Optional: `catalog_guidance.aliases` for document-type/prompt alias guidance.
- API response could expose parsed objects:
  - `tag_language_aliases: { de: Array<{ source: string; target: string }> }` or `{ de: Record<string,string> }`.
  - Optional `catalog_guidance_aliases: Record<string,string>`.
- For UI editing, arrays of `{ source, target }` are easier to render/reorder and avoid duplicate object-key loss. Internally convert to normalized `Map` for lookup.
- If using a single JSON setting, add robust parsing and fallback to defaults on invalid JSON; never let malformed settings break document processing.

### TinyBase persistence and migration/defaults

- `apps/backend/src/services/TinyBaseService.ts:186-190` defines `settings` rows as `{ key: string, value: string, updatedAt: string }`.
- `apps/backend/src/services/TinyBaseService.ts:745-889` migrates legacy/canonical settings by reading persisted settings plus flattened `config.yaml`; it writes canonical keys if empty and synchronizes selected legacy aliases. New alias keys can be added here if supporting legacy/config names.
- `apps/backend/src/services/TinyBaseService.ts:1710-1750` exposes `getSetting`, `setSetting`, and `getAllSettings`; all values are strings.
- `apps/backend/src/api/settings/handlers.ts:624-735` imports `config.yaml` by flattening nested config. If aliases are represented in `config.yaml` as arrays/objects, current `flattenObject` serializes arrays as JSON but flattens objects to dot keys. A simple TinyBase default strategy is safer than relying on config import for initial alias defaults.

Recommended default/migration strategy:

1. Move the hardcoded German tag aliases into an exported default constant, e.g. `DEFAULT_TAG_LANGUAGE_ALIASES = { de: [{ source: "invoice", target: "Rechnung" }, ...] }`, in TypeScript (not prompt files).
2. Keep defaults code-owned and do **not** eagerly write defaults to TinyBase unless you need UI to show explicit rows; `getSettings` can return defaults when the setting is absent.
3. On save, write only user-edited aliases as JSON to `tag_language.aliases.de` (or one `tag_language.aliases` JSON object). This prevents migrations from polluting stores and keeps reset-to-default possible by clearing the setting.
4. For malformed JSON, log/drop and return defaults. UI should be able to overwrite malformed state.
5. Optional migration: add `migrateCanonicalSettings` entries only if there are likely legacy keys. This codebase has no current persisted alias key, so no required migration from old key names.
6. If supporting `config.yaml`, prefer a single YAML path that becomes one JSON string via array serialization, e.g. `tagLanguage.aliases.de: [{source,target}]`; otherwise document that aliases are UI/TinyBase settings only.

### Frontend TinyBase schema/sync pattern

- `apps/web/lib/tinybase/schemas.ts:1-96` defines all settings as TinyBase Values. Add new string defaults here, e.g. `"tag_language.aliases.de": { type: "string", default: "[...]" }` or empty string plus UI default fallback.
- `apps/web/lib/tinybase/schemas.ts:116-164` maps API response keys to store keys. Add mappings for any top-level API fields (`tag_language_aliases_de`, etc.).
- `apps/web/lib/tinybase/provider.tsx:45-64` has a fixed `WORKFLOW_TAG_KEYS` list and special nested `tags` sync.
- `apps/web/lib/tinybase/provider.tsx:120-149` maps top-level API response fields to store values, then special-cases nested `settings.tags`.
- `apps/web/lib/tinybase/provider.tsx:241-258` single-setting update maps store key to API key and PATCHes `{ [apiKey]: value }`.
- `apps/web/lib/tinybase/provider.tsx:288-326` multi-setting update builds an API payload and optimistically updates mapped store keys.
- `apps/web/lib/tinybase/provider.tsx:359+` `saveSettings` serializes all mapped store values and special-cases workflow `tags`.

Recommended frontend storage approach:

- Add `"tag_language.aliases.de"` as a string SettingKey containing JSON for alias rows. This fits current hooks (`useStringSetting`, `updateSetting`) without widening `SettingValue` beyond string/number/boolean.
- Map API key `tag_language_aliases_de` (or similar) to store key `tag_language.aliases.de` in `API_TO_STORE_KEY_MAP`/`STORE_TO_API_KEY_MAP`.
- If backend response uses nested `tag_language_aliases: { de: [...] }`, provider needs a special nested sync block like `settings.tags`. Simpler: backend response returns a string or parsed field mapped one-to-one.
- UI component can parse `useStringSetting("tag_language.aliases.de")`; if empty or invalid, display default rows from a frontend default constant matching backend. On change, stringify normalized rows and call `updateSetting` or `updateSettings`.

### Settings UI pattern

- Existing language settings live in `apps/web/app/settings/components/LanguageTab.tsx:23-97`: two cards for UI language and prompt language, using `useStringSetting("language")` and `updateSetting("language", value)`.
- `apps/web/app/settings/page.tsx:34-45` lists valid tabs; `language` already exists.
- `apps/web/app/settings/page.tsx:128-170` renders tab triggers; line `158-160` is the Language tab trigger.
- `apps/web/app/settings/page.tsx:172+` renders tab content; `LanguageTab` already owns language-related settings.
- Existing editable setting inputs pattern: `WorkflowTagsTab.tsx` has `TagNameInput` that uses `useStringSetting(settingKey)` and `updateSetting(settingKey, e.target.value)`. It also uses cards, labels, buttons, and local UI state for status messages.
- Translation messages for Language tab exist in `apps/web/messages/en.json:495-510` and `apps/web/messages/de.json:495-505`; add labels/descriptions/placeholders for alias editor in both.

Recommended UI placement:

- Put a compact alias editor in `LanguageTab`, below/next to prompt language, because aliases are prompt-language behavior and a new tab is unnecessary.
- UI rows: Source alias input, Target localized tag input, remove button, Add alias button, Reset to defaults button.
- Validate minimally on the client: trim source/target, drop empty rows on save/stringify, indicate duplicate normalized sources (same normalization as backend if feasible).
- Persist immediately through `updateSetting` on row changes or keep local state and persist on blur/Add/Remove. Existing settings save button calls `saveSettings`, but many current controls PATCH immediately; following `updateSetting` is consistent.

## Likely implementation plan

1. Refactor `tagLanguage.ts`:
   - Export default alias rows and key normalization.
   - Add helpers: parse/validate alias rows from JSON/unknown, build normalized alias map, localize with optional aliases.
   - Keep existing functions backward-compatible by using defaults when no aliases are supplied.
2. Backend settings:
   - Add settings response/update types for alias JSON string(s) or parsed arrays.
   - In `getSettings`, return DB alias setting if present/valid, else defaults.
   - In `updateSettings`, map API/store alias keys to `tag_language.aliases.de` and store JSON string after validation/normalization.
3. Agent runtime:
   - Extend `PiDocumentAgent` runtime settings to read alias setting(s). Pass alias rows/map into tag localization call sites and into prompt construction if replacing `catalog_guidance.aliases`.
   - Extend `PiTagExplorerAgent` runtime settings if its prompt language instruction should include dynamic avoid-list or aliases. At minimum, no hardcoded tag alias map should remain as the sole behavior.
   - Replace hardcoded `catalog_guidance.aliases` with defaults/settings if in scope.
4. Frontend:
   - Add TinyBase schema/mapping for alias JSON string(s).
   - Add alias editor UI to `LanguageTab` and messages in `en.json`/`de.json`.
5. Tests:
   - Backend unit tests for default aliases, settings override, malformed JSON fallback, and API persistence.
   - Frontend tests for provider sync/update or LanguageTab editor behavior.

## Tests to add/update

Backend:

- New or existing test file for `apps/backend/src/utils/tagLanguage.ts`:
  - Defaults preserve existing behavior (`invoice` -> `Rechnung` for German, unchanged for English).
  - Custom aliases override/add (`receipt` -> custom target) and normalize case/diacritics/hyphen/underscore consistently.
  - Invalid/empty rows are ignored and dedupe behavior remains stable.
- `apps/backend/tests/api/settings.test.ts` already has `createMockConfig`/`createMockTinyBase` scaffolding (`lines 21-80`) and settings assertions (`lines 119-149`) plus update tests (`lines 239-306`). Add cases:
  - `getSettings` returns default alias JSON/rows when TinyBase has no alias setting.
  - `getSettings` returns custom DB alias setting when present.
  - `updateSettings({ tag_language_aliases_de: <json> })` writes `tag_language.aliases.de`.
  - malformed alias update either rejects/normalizes (if implemented) or stores but `getSettings` falls back safely; choose one behavior and test it.
- If `PiDocumentAgent` call sites change, add/adjust `apps/backend/tests/agents/PiDocumentAgent.test.ts` to verify runtime setting aliases affect localized tag suggestions/review questions.

Frontend:

- `apps/web/tests/tinybase-provider.test.tsx:20-51` is the existing provider sync/rollback test. Add a probe for the alias string setting to ensure `/api/settings` response populates it and PATCH rollback works.
- Add a focused `LanguageTab` test if the component is not mocked, or extend settings page tests if practical. `apps/web/tests/settings-page.test.tsx:51-61` currently mocks all tab components, so it will not exercise the actual LanguageTab unless changed or a new test imports it directly.

## Validation commands

Targeted:

- `pnpm --filter @repo/backend test -- tests/api/settings.test.ts`
- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts` (if agent call sites changed)
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/web test -- tests/tinybase-provider.test.tsx`
- `pnpm --filter @repo/web test -- tests/settings-page.test.tsx` or new LanguageTab test
- `pnpm --filter @repo/web typecheck`

Final smoke:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`

## Risks and constraints

- Project rule: Pi prompts/instructions/settings remain in TypeScript; do not add prompt files or `PromptService`.
- TinyBase settings values are strings; storing alias arrays requires JSON serialization and tolerant parsing.
- Avoid service reads inside pure tag-language utility functions unless all callers are updated; explicit alias parameters are lower-risk.
- There are two alias concepts: tag-language aliases and document-type/catalog guidance aliases. Keep names/storage separate to avoid applying document-type aliases as tag localizations.
- Existing UI settings usually PATCH immediately; ensure alias editor does not surprise users with partial malformed JSON. Prefer local row state plus normalized JSON writes.

## Compact worker prompt

Implement editable tag-language aliases in settings. Move the German tag alias defaults out of the hardcoded-only `GERMAN_TAG_ALIASES` path into exported TypeScript defaults plus TinyBase-backed settings override. Add backend settings API support, tolerant JSON parse/validation, and runtime use in Pi document/tag localization without introducing prompt files. Also replace `PiDocumentAgent` hardcoded `catalog_guidance.aliases` with default/settings-backed guidance if in scope, using a distinct setting from tag aliases. Add a compact alias editor to the Language settings tab, wire it through frontend TinyBase schema/provider mappings, and add en/de messages. Preserve current default behavior when no setting exists or JSON is invalid. Add targeted backend settings/tagLanguage tests and frontend provider/LanguageTab tests. Validate with backend/web targeted tests, typecheck, then lint.
