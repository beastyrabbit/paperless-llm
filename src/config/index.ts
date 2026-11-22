import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { sha256 } from "../util.js";
import { type Config, configSchema } from "./schema.js";

export type { Config, OpenField, Route } from "./schema.js";
export interface Secrets {
  paperlessToken?: string;
  mistralApiKey?: string;
  jevApiKey?: string;
  llmApiKey?: string;
  localLlmApiKey?: string;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function parseConfig(value: unknown) {
  const config = configSchema.parse(value);
  return { config, configHash: sha256(canonical(config)) };
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const loaded = parseConfig(
    parse(readFileSync(env.PAPERLESS_LLM_CONFIG ?? "./config.yaml", "utf8")),
  );
  const secrets: Secrets = {
    paperlessToken: env.PAPERLESS_TOKEN,
    mistralApiKey: env.MISTRAL_API_KEY,
    jevApiKey: env.JEV_API_KEY,
    llmApiKey: env.LLM_API_KEY,
    localLlmApiKey: env.LOCAL_LLM_API_KEY,
  };
  if (!secrets.paperlessToken) throw new Error("PAPERLESS_TOKEN is required");
  if (loaded.config.ocr.enabled && !secrets.mistralApiKey)
    throw new Error("MISTRAL_API_KEY is required when OCR is enabled");
  if (loaded.config.polling.enabled && !secrets.jevApiKey)
    throw new Error("JEV_API_KEY is required when polling is enabled");
  return { ...loaded, secrets };
}
export function redactedConfig(config: Config, secrets: Secrets) {
  return {
    ...config,
    credentials: Object.fromEntries(
      Object.entries(secrets).map(([key, value]) => [key, value ? "configured" : "missing"]),
    ),
  };
}
