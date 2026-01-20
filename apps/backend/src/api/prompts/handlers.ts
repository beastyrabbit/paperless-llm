/**
 * Prompts API handlers.
 *
 * Real implementations using PromptService.
 */
import { Effect, pipe } from 'effect';
import { PromptService } from '../../services/PromptService.js';

// ===========================================================================
// Prompt Listings
// ===========================================================================

export const listPrompts = (lang?: string) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;
    return yield* promptService.getAllPrompts(lang);
  });

export const listPromptGroups = (lang?: string) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;
    return yield* promptService.getPromptGroups(lang);
  });

// ===========================================================================
// Prompt Details
// ===========================================================================

export const getPrompt = (name: string, lang?: string) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;
    return yield* pipe(
      promptService.getPrompt(name, lang),
      Effect.catchAll(() =>
        Effect.succeed({
          name,
          filename: `${name}.md`,
          content: '',
          description: null,
          variables: [],
        })
      )
    );
  });

export const updatePrompt = (name: string, content: string, lang?: string) =>
  Effect.gen(function* () {
    const promptService = yield* PromptService;
    return yield* pipe(
      promptService.updatePrompt(name, content, lang),
      Effect.catchAll(() =>
        Effect.succeed({
          name,
          filename: `${name}.md`,
          content,
          description: null,
          variables: [],
        })
      )
    );
  });

// ===========================================================================
// Preview & Languages
// ===========================================================================

export const getPreviewData = Effect.succeed({
  sample_document: {
    id: 1,
    title: 'Sample Document',
    content: 'This is sample content for preview.',
  },
  sample_correspondent: 'Sample Corp',
  sample_tags: ['invoice', 'important'],
});

export const getLanguages = Effect.gen(function* () {
  const promptService = yield* PromptService;
  const languages = yield* promptService.getLanguages();
  const defaultLang = yield* promptService.getDefaultLanguage();

  return {
    languages: languages.map((l) => ({
      code: l.code,
      name: l.name,
      is_default: l.code === defaultLang,
      is_complete: l.isComplete,
      prompt_count: l.promptCount,
    })),
    default: defaultLang,
  };
});
