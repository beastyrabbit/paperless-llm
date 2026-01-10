/**
 * YAML configuration loader with Effect integration.
 */
import { Effect, pipe } from 'effect';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { AppConfig } from './schema.js';

export class ConfigLoadError {
  readonly _tag = 'ConfigLoadError';
  constructor(
    readonly message: string,
    readonly cause?: unknown
  ) {}
}

/**
 * Load configuration from YAML file.
 */
export const loadYamlConfig = (
  configPath: string
): Effect.Effect<AppConfig, ConfigLoadError> =>
  pipe(
    Effect.try({
      try: () => {
        const absolutePath = path.isAbsolute(configPath)
          ? configPath
          : path.join(process.cwd(), configPath);

        if (!fs.existsSync(absolutePath)) {
          return {};
        }

        const content = fs.readFileSync(absolutePath, 'utf-8');
        return parseYaml(content) as AppConfig;
      },
      catch: (error) =>
        new ConfigLoadError(`Failed to load config from ${configPath}`, error),
    })
  );

/**
 * Load configuration from environment variables.
 */
export const loadEnvConfig = (): Effect.Effect<Partial<AppConfig>, never> =>
  Effect.succeed({
    paperless: {
      url: process.env['PAPERLESS_URL'],
      token: process.env['PAPERLESS_TOKEN'],
    },
    ollama: {
      url: process.env['OLLAMA_URL'],
      modelLarge: process.env['OLLAMA_MODEL_LARGE'],
      modelSmall: process.env['OLLAMA_MODEL_SMALL'],
    },
    mistral: {
      apiKey: process.env['MISTRAL_API_KEY'],
      model: process.env['MISTRAL_MODEL'],
    },
    qdrant: {
      url: process.env['QDRANT_URL'],
      collectionName: process.env['QDRANT_COLLECTION'],
    },
    language: process.env['LANGUAGE'],
    debug: process.env['DEBUG'] === 'true',
  });

/**
 * Deep merge two objects, preferring non-undefined values from the second.
 */
const deepMerge = <T extends Record<string, unknown>>(
  base: T,
  override: Partial<T>
): T => {
  const result = { ...base } as T;

  for (const key in override) {
    const overrideValue = override[key];
    const baseValue = base[key];

    if (overrideValue === undefined) {
      continue;
    }

    if (
      typeof overrideValue === 'object' &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === 'object' &&
      baseValue !== null
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>
      ) as T[Extract<keyof T, string>];
    } else {
      result[key] = overrideValue as T[Extract<keyof T, string>];
    }
  }

  return result;
};

/**
 * Merge configurations with priority: env > yaml > defaults.
 */
export const mergeConfigs = (
  yamlConfig: AppConfig,
  envConfig: Partial<AppConfig>
): AppConfig => deepMerge(yamlConfig, envConfig);
