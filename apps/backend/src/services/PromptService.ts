/**
 * Prompt template management service.
 */
import { Effect, Context, Layer, pipe } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ConfigService } from '../config/index.js';
import { NotFoundError } from '../errors/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface PromptInfo {
  name: string;
  filename: string;
  content: string;
  description: string | null;
  variables: string[];
}

export interface PromptGroup {
  name: string;
  category: 'document' | 'system';
  main: PromptInfo;
  confirmation: PromptInfo | null;
}

export interface LanguageInfo {
  code: string;
  name: string;
  promptCount: number;
  isComplete: boolean;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface PromptService {
  readonly getPrompt: (name: string, lang?: string) => Effect.Effect<PromptInfo, NotFoundError>;
  readonly getAllPrompts: (lang?: string) => Effect.Effect<PromptInfo[], never>;
  readonly getPromptGroups: (lang?: string) => Effect.Effect<PromptGroup[], never>;
  readonly getLanguages: () => Effect.Effect<LanguageInfo[], never>;
  readonly getCurrentLanguage: () => Effect.Effect<string, never>;
  readonly getDefaultLanguage: () => Effect.Effect<string, never>;
  readonly updatePrompt: (name: string, content: string, lang?: string) => Effect.Effect<PromptInfo, NotFoundError>;
  readonly renderPrompt: (name: string, variables: Record<string, string>, lang?: string) => Effect.Effect<string, NotFoundError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const PromptService = Context.GenericTag<PromptService>('PromptService');

// ===========================================================================
// Helper Functions
// ===========================================================================

const extractVariables = (content: string): string[] => {
  const regex = /\{(\w+)\}/g;
  const variables: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match[1] && !variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }
  return variables;
};

const extractDescription = (content: string): string | null => {
  const lines = content.split('\n');
  const firstLine = lines[0]?.trim() ?? '';
  if (firstLine.startsWith('# ')) {
    return firstLine.slice(2).trim();
  }
  return null;
};

/**
 * Strip markdown formatting from prompt text.
 * Converts markdown to plain text for cleaner LLM input.
 */
const stripMarkdown = (content: string): string => {
  return (
    content
      // Remove headers (# ## ### etc.) but keep the text
      .replace(/^#{1,6}\s+/gm, '')
      // Remove bold **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      // Remove italic *text* or _text_ (but not in middle of words)
      .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
      .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
      // Remove inline code backticks
      .replace(/`([^`]+)`/g, '$1')
      // Remove links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, '')
      // Clean up multiple blank lines
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const PromptServiceLive = Layer.effect(
  PromptService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const { language } = configService.config;

    // Base prompts directory (relative to apps/backend)
    const promptsBaseDir = path.join(process.cwd(), 'prompts');

    const getPromptsDir = (lang: string): string =>
      path.join(promptsBaseDir, lang);

    const promptExists = (name: string, lang: string): boolean => {
      const filename = `${name}.md`;
      const filePath = path.join(getPromptsDir(lang), filename);
      return fs.existsSync(filePath);
    };

    const readPromptFile = (name: string, lang: string): string | null => {
      const filename = `${name}.md`;
      const filePath = path.join(getPromptsDir(lang), filename);
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return null;
    };

    const loadPrompt = (name: string, lang: string): PromptInfo | null => {
      const content = readPromptFile(name, lang);
      if (!content) return null;

      return {
        name,
        filename: `${name}.md`,
        content,
        description: extractDescription(content),
        variables: extractVariables(content),
      };
    };

    return {
      getPrompt: (name, lang) =>
        Effect.gen(function* () {
          const targetLang = lang ?? language;

          // Try target language first
          let prompt = loadPrompt(name, targetLang);

          // Fall back to English if not found
          if (!prompt && targetLang !== 'en') {
            prompt = loadPrompt(name, 'en');
          }

          if (!prompt) {
            return yield* Effect.fail(
              new NotFoundError({
                message: `Prompt '${name}' not found`,
                resource: 'prompt',
                id: name,
              })
            );
          }

          return prompt;
        }),

      getAllPrompts: (lang) =>
        Effect.sync(() => {
          const targetLang = lang ?? language;
          const dir = getPromptsDir(targetLang);

          if (!fs.existsSync(dir)) {
            // Fall back to English
            const enDir = getPromptsDir('en');
            if (!fs.existsSync(enDir)) return [];

            const files = fs.readdirSync(enDir).filter((f) => f.endsWith('.md'));
            return files
              .map((f) => loadPrompt(f.replace('.md', ''), 'en'))
              .filter((p): p is PromptInfo => p !== null);
          }

          const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
          return files
            .map((f) => loadPrompt(f.replace('.md', ''), targetLang))
            .filter((p): p is PromptInfo => p !== null);
        }),

      getPromptGroups: (lang) =>
        Effect.sync(() => {
          const targetLang = lang ?? language;
          // Prompts that have main + confirmation pairs (document prompts)
          const pairedPrompts = ['title', 'correspondent', 'document_type', 'tags', 'custom_fields'];
          // Standalone prompts without confirmation (system prompts)
          const standalonePrompts = ['schema_analysis', 'schema_cleanup', 'metadata_description', 'confirmation'];
          const groups: PromptGroup[] = [];

          // Add paired prompts (main + confirmation) - Document prompts
          for (const name of pairedPrompts) {
            const main = loadPrompt(name, targetLang) ?? loadPrompt(name, 'en');
            if (!main) continue;

            const confirmationName = `${name}_confirmation`;
            const confirmation =
              loadPrompt(confirmationName, targetLang) ?? loadPrompt(confirmationName, 'en');

            groups.push({ name, category: 'document', main, confirmation });
          }

          // Add standalone prompts (no confirmation) - System prompts
          for (const name of standalonePrompts) {
            const main = loadPrompt(name, targetLang) ?? loadPrompt(name, 'en');
            if (!main) continue;

            groups.push({ name, category: 'system', main, confirmation: null });
          }

          return groups;
        }),

      getLanguages: () =>
        Effect.sync(() => {
          if (!fs.existsSync(promptsBaseDir)) {
            return [{ code: 'en', name: 'English', promptCount: 0, isComplete: false }];
          }

          const dirs = fs.readdirSync(promptsBaseDir, { withFileTypes: true });
          const languages: LanguageInfo[] = [];

          // Expected prompts for completeness check (all prompts that should exist)
          const expectedPrompts = [
            'title',
            'title_confirmation',
            'correspondent',
            'correspondent_confirmation',
            'document_type',
            'document_type_confirmation',
            'tags',
            'tags_confirmation',
            'custom_fields',
            'custom_fields_confirmation',
            'document_links',
            'document_links_confirmation',
            'summary',
            'confirmation',
            'schema_analysis',
            'schema_cleanup',
            'metadata_description',
          ];

          for (const dir of dirs) {
            if (!dir.isDirectory()) continue;

            const langDir = path.join(promptsBaseDir, dir.name);
            const files = fs.readdirSync(langDir).filter((f) => f.endsWith('.md'));
            const promptNames = files.map((f) => f.replace('.md', ''));

            const isComplete = expectedPrompts.every((p) => promptNames.includes(p));

            // Language name mapping
            const languageNames: Record<string, string> = {
              en: 'English',
              de: 'German',
              fr: 'French',
              es: 'Spanish',
              it: 'Italian',
              nl: 'Dutch',
              pt: 'Portuguese',
              pl: 'Polish',
              ru: 'Russian',
              zh: 'Chinese',
              ja: 'Japanese',
              ko: 'Korean',
            };

            languages.push({
              code: dir.name,
              name: languageNames[dir.name] ?? dir.name,
              promptCount: files.length,
              isComplete,
            });
          }

          return languages;
        }),

      getCurrentLanguage: () => Effect.succeed(language),

      getDefaultLanguage: () => Effect.succeed('en'),

      updatePrompt: (name, content, lang) =>
        Effect.gen(function* () {
          const targetLang = lang ?? language;
          const filename = `${name}.md`;
          const filePath = path.join(getPromptsDir(targetLang), filename);

          // Check if prompt exists (in target lang or English)
          if (!promptExists(name, targetLang) && !promptExists(name, 'en')) {
            return yield* Effect.fail(
              new NotFoundError({
                message: `Prompt '${name}' not found`,
                resource: 'prompt',
                id: name,
              })
            );
          }

          // Create language directory if needed
          const dir = getPromptsDir(targetLang);
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          // Write the updated content
          fs.writeFileSync(filePath, content, 'utf-8');

          return {
            name,
            filename,
            content,
            description: extractDescription(content),
            variables: extractVariables(content),
          };
        }),

      renderPrompt: (name, variables, lang) =>
        Effect.gen(function* () {
          const prompt = yield* pipe(
            Effect.sync(() => loadPrompt(name, lang ?? language)),
            Effect.flatMap((p) =>
              p
                ? Effect.succeed(p)
                : Effect.sync(() => loadPrompt(name, 'en')).pipe(
                    Effect.flatMap((fallback) =>
                      fallback
                        ? Effect.succeed(fallback)
                        : Effect.fail(
                            new NotFoundError({
                              message: `Prompt '${name}' not found`,
                              resource: 'prompt',
                              id: name,
                            })
                          )
                    )
                  )
            )
          );

          let rendered = prompt.content;
          for (const [key, value] of Object.entries(variables)) {
            rendered = rendered.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
          }

          // Strip markdown formatting for cleaner LLM input
          rendered = stripMarkdown(rendered);

          return rendered;
        }),
    };
  })
);
