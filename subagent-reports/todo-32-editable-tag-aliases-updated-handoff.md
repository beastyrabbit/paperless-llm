# Todo #32 / W4-S17 updated handoff: editable tag-language aliases

Scope inspected: existing Todo #32 handoff, backend tag-language utility, Pi document/tag-explorer prompt call sites, current settings handlers/schemas/API-contracts, TinyBase persistence/migration behavior, frontend TinyBase sync/provider, Language settings UI, messages, and nearby tests. No source files were edited.

## Current state and high-value files

### Hardcoded tag-language aliases

- `apps/backend/src/utils/tagLanguage.ts:1-8` has the key normalization currently used for aliases: trim, lowercase, NFKD accent stripping, `_`/`-` to spaces, whitespace collapse.
- `apps/backend/src/utils/tagLanguage.ts:10-50` still hardcodes `GERMAN_TAG_ALIASES` as a `Map<string,string>` (`invoice -> Rechnung`, `pet -> Haustier`, `order confirmation -> Bestellbestätigung`, etc.).
- `apps/backend/src/utils/tagLanguage.ts:65-73` localizes generated tag names only for German prompt language and dedupes localized names.
- `apps/backend/src/utils/tagLanguage.ts:76-88` localizes review questions if the suggested tag name changed.
- `apps/backend/src/utils/tagLanguage.ts:91-101` hardcodes the German prompt instruction and generic English tags to avoid.

Implementation implication: keep these helpers pure and synchronous. Do not make `tagLanguage.ts` read TinyBase directly; pass resolved alias rows/options in from agent runtime settings while retaining default behavior for fallback/tests.

### Agent call sites that must consume settings-backed aliases

- `apps/backend/src/agents/PiDocumentAgent.ts:1123-1169` reads runtime settings from `tinybase.getAllSettings()`. It currently resolves models, confirmation settings, `language.prompt`/aliases, and history only; no alias settings.
- `apps/backend/src/agents/PiDocumentAgent.ts:1652-1659` calls `tagExplorer.exploreTags(...)` with `promptLanguage`; if tag-explorer prompt guidance should include aliases, pass settings there too.
- `apps/backend/src/agents/PiDocumentAgent.ts:2250-2282` builds the document system prompt. `2254` calls `buildPromptLanguageInstruction(promptLanguage)`, and `2272` hardcodes catalog/document-type alias guidance.
- `apps/backend/src/agents/PiDocumentAgent.ts:2284-2368` builds the JSON user prompt. `2354-2365` hardcodes `catalog_guidance.aliases`.
- `apps/backend/src/agents/PiDocumentAgent.ts:2504-2608` constructs the Pi agent and calls `buildUserPrompt(..., settings.promptLanguage)`; extend this path to carry resolved alias settings to prompt builders/tools.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:131-148` resolves runtime settings and prompt language only.
- `apps/backend/src/agents/PiTagExplorerAgent.ts:263-281` includes `buildPromptLanguageInstruction(input.promptLanguage ?? promptLanguage)` in the tag-explorer prompt.

There are two alias concepts. Keep them separate:
1. **Tag-language aliases**: English/generic generated tag name -> localized tag name, currently `GERMAN_TAG_ALIASES` in `tagLanguage.ts`.
2. **Catalog/document-type guidance aliases**: document type synonym -> existing broad document type, currently hardcoded at `PiDocumentAgent.ts:2272` and `2358-2364`.

### Current backend settings/API contracts after recent changes

- `apps/backend/src/api/index.ts:231-234` routes `GET /api/settings` to `getSettings`; `PATCH /api/settings` validates with `SettingsUpdateBodySchema` then calls `updateSettings`.
- `packages/api-contracts/src/request-schemas.ts:16-18` now makes `SettingsUpdateBodySchema = LooseObjectSchema`, so PATCH accepts arbitrary keys at the route boundary.
- `apps/backend/src/api/settings/api.ts:33-79` still defines the backend `Settings` schema/type used by handlers. Add response fields here.
- `apps/backend/src/api/settings/api.ts:81-132` defines `SettingsUpdate`; although route validation is loose, `updateSettings` is typed with this schema, so add update fields here for compile-time safety.
- `packages/api-contracts/src/types.ts:1-51` defines the frontend/shared `Settings` interface consumed by `apps/web/lib/api.ts`. Add any response fields here too if exposed through `settingsApi.get()` / `settingsApi.update()`.
- `apps/backend/src/api/settings/handlers.ts:28-214` builds the settings response. Current helper patterns: `get`, `getFirstNonEmpty`, `getBool`, `getNum`; language response uses `language.prompt` / `prompt_language` / `language` at line `181`.
- `apps/backend/src/api/settings/handlers.ts:221-315` maps frontend/API field names to TinyBase keys. Add alias setting keys here.
- `apps/backend/src/api/settings/handlers.ts:324-356` stringifies all update values and stores them in TinyBase. Special handling exists only for nested `tags` objects and masked secrets. If alias fields are arrays/objects, either handle them specially or expose/store JSON strings.

Contract recommendation after inspecting current sync paths: expose tag aliases as a **top-level JSON string field** rather than nested objects:

- API field: `tag_language_aliases_de` (string containing JSON array of rows).
- TinyBase key: `tag_language.aliases.de`.
- Optional separate API/store field for document-type guidance if included: `catalog_guidance_aliases` -> `catalog_guidance.aliases` as JSON string.

Reason: frontend `API_TO_STORE_KEY_MAP` and provider sync already map top-level scalar fields cleanly; nested objects require provider special cases like `settings.tags`.

### TinyBase persistence/defaults/migration

- `apps/backend/src/services/TinyBaseService.ts:186-190` defines settings rows as `{ key: string, value: string, updatedAt: string }`.
- `apps/backend/src/services/TinyBaseService.ts:745-889` migrates known canonical setting keys from persisted/config aliases. There is no existing alias setting to migrate, so avoid adding a migration unless supporting a new config alias path deliberately.
- `apps/backend/src/services/TinyBaseService.ts:1710-1755` `getSetting`, `setSetting`, `getAllSettings` are string-only.

Recommended default/migration strategy:

1. Export code-owned defaults from TypeScript, e.g. `DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE: Array<{ source: string; target: string }>` and maybe `DEFAULT_CATALOG_GUIDANCE_ALIASES`.
2. Do **not** eagerly write default aliases into TinyBase. Return defaults from `getSettings` when no user setting exists. This keeps DB stores small and enables reset-to-default by clearing/storing empty string.
3. Store only user-edited aliases as JSON strings under `tag_language.aliases.de` (and optional `catalog_guidance.aliases`). TinyBase only stores strings.
4. Parse and normalize JSON tolerantly: accept arrays of `{source,target}`; trim; drop empty/invalid rows; use normalized source keys for lookup; last row may win on duplicate sources or duplicates can be rejected by UI, but backend should remain safe.
5. If stored JSON is malformed/invalid, do not break processing. Log/fallback to code defaults in `getSettings` and agent runtime.
6. No mandatory migration exists because aliases were hardcoded, not persisted. Only add `migrateCanonicalSettings` entries if a config/YAML alias path is explicitly added.

### Frontend TinyBase/schema/provider

- `apps/web/lib/tinybase/schemas.ts:10-96` defines all settings as TinyBase Values. Add a string setting like `"tag_language.aliases.de": { type: "string", default: "" }`.
- `apps/web/lib/tinybase/schemas.ts:117-164` maps top-level API fields to store keys. Add `tag_language_aliases_de: "tag_language.aliases.de"` (and optional catalog guidance mapping).
- `apps/web/lib/tinybase/provider.tsx:65-66` limits setting values to `string | number | boolean`; JSON-string storage fits this without widening.
- `apps/web/lib/tinybase/provider.tsx:119-139` syncs top-level API fields through `API_TO_STORE_KEY_MAP` and type-converts by schema.
- `apps/web/lib/tinybase/provider.tsx:141-149` only special-cases nested `tags`; avoid nested alias API response unless you add similar handling.
- `apps/web/lib/tinybase/provider.tsx:240-257` `updateSetting` maps store key to API key and PATCHes a scalar value.
- `apps/web/lib/tinybase/provider.tsx:287-350` `updateSettings` supports mapped store/API keys with optimistic rollback.
- `apps/web/lib/tinybase/provider.tsx:358-390` `saveSettings` serializes all mapped store values and separately handles tags.

### Frontend UI

- `apps/web/app/settings/components/LanguageTab.tsx:23-97` is the right place for a compact editor. It currently manages UI language and prompt language only.
- Existing hooks: `useStringSetting("language")` and `updateSetting("language", value)` at `LanguageTab.tsx:26-37`.
- Existing message keys live at `apps/web/messages/en.json:495-511` and `apps/web/messages/de.json:495-511`. Add alias-editor labels/descriptions/placeholders/errors in both.
- `apps/web/tests/settings-page.test.tsx:43-54` mocks `LanguageTab`, so settings page tests will not exercise a real alias editor unless a new focused test imports `LanguageTab` directly.

Suggested UI behavior:

- Put a third card or full-width section in `LanguageTab` for German tag aliases.
- Rows: source alias, target localized tag, remove. Buttons: add alias, reset to defaults/save defaults.
- Use a frontend default constant matching backend defaults or import/share a small constant if package boundaries permit. If store value is empty/invalid, display defaults but only persist when the user changes/saves.
- Normalize before saving: trim, drop rows where source or target is empty, stringify array rows, call `updateSetting("tag_language.aliases.de", json)`.

## Tests to add/update

Backend:

- Add unit tests for `apps/backend/src/utils/tagLanguage.ts` (new test file is fine):
  - default German behavior remains (`invoice` -> `Rechnung`, non-German unchanged);
  - custom alias rows override/add aliases;
  - normalization still handles case, accents, `_`/`-`, whitespace;
  - invalid/empty rows are ignored and malformed JSON falls back to defaults.
- Extend `apps/backend/tests/api/settings.test.ts`:
  - `getSettings` returns default `tag_language_aliases_de` JSON string when TinyBase has no setting;
  - DB value at `tag_language.aliases.de` is returned when valid;
  - malformed DB value falls back safely to default JSON;
  - `updateSettings({ tag_language_aliases_de: json })` writes `tag_language.aliases.de`;
  - optionally test invalid update normalization/rejection, depending on chosen behavior.
- If agent call sites change materially, extend `apps/backend/tests/agents/PiDocumentAgent.test.ts` to prove runtime alias settings affect generated tag localization/review question behavior. At minimum, helper-level tests should cover pure localization.

Frontend:

- Extend `apps/web/tests/tinybase-provider.test.tsx`: current probe only checks `paperless.url`; add a probe for `useStringSetting("tag_language.aliases.de")` to verify GET mapping and PATCH rollback/update behavior.
- Add a focused `LanguageTab` test for parsing/default rows, editing a row, add/remove/reset, and `updateSetting` payload. Do not rely on `settings-page.test.tsx` because `LanguageTab` is mocked there.
- If `packages/api-contracts/src/types.ts` `Settings` is updated, run web typecheck to catch all consumers.

## Validation commands

Targeted first:

- `pnpm --filter @repo/backend test -- tests/api/settings.test.ts`
- `pnpm --filter @repo/backend test -- tests/agents/PiDocumentAgent.test.ts` (if agent integration changed)
- `pnpm --filter @repo/backend typecheck`
- `pnpm --filter @repo/web test -- tests/tinybase-provider.test.tsx`
- New `LanguageTab` test command, or `pnpm --filter @repo/web test -- tests/settings-page.test.tsx` if page coverage is intentionally changed
- `pnpm --filter @repo/web typecheck`

Final smoke:

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run test`

## Implementation risks/constraints

- Project invariant: Pi agent instructions/tools/schemas/placeholders stay in TypeScript. Do not add prompt files or reintroduce `PromptService`.
- TinyBase settings are strings; arrays/objects need JSON serialization and tolerant parsing.
- Settings PATCH validation is loose at the route boundary, but backend `Settings`/`SettingsUpdate`, shared `packages/api-contracts/src/types.ts`, frontend `valuesSchema`, and provider mapping must all be kept in sync.
- Avoid nested alias response shapes unless you intentionally add frontend provider special handling.
- Keep tag-language aliases distinct from catalog/document-type guidance aliases.
- Keep defaults backward-compatible: if no alias setting exists or stored JSON is invalid, current hardcoded behavior should be preserved.

## Compact worker prompt

Implement editable German tag-language aliases backed by settings. Refactor `apps/backend/src/utils/tagLanguage.ts` to export TypeScript default alias rows plus pure parse/normalize/localize helpers that accept optional alias settings and fall back to defaults. Add settings API fields `tag_language_aliases_de` -> TinyBase key `tag_language.aliases.de` as a JSON string, updating backend `Settings`/`SettingsUpdate`, shared API-contract `Settings`, frontend TinyBase schema/maps, and provider sync/update paths. `getSettings` should return valid stored JSON or default JSON; malformed/empty values must not break processing. Extend Pi document/tag-explorer runtime paths to use resolved alias rows for tag localization/prompt language guidance without service reads in utilities. If replacing hardcoded `catalog_guidance.aliases`, use a separate `catalog_guidance_aliases` setting/default. Add a compact alias editor to `LanguageTab` with en/de messages. Add backend tagLanguage/settings tests and frontend provider/LanguageTab tests. Validate targeted backend/web tests and typechecks, then lint/full tests if feasible.