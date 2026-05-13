import type { Model } from "@earendil-works/pi-ai";

export const buildOllamaModel = (url: string, modelId: string): Model<"openai-completions"> => ({
  id: modelId,
  name: modelId,
  provider: "ollama",
  api: "openai-completions",
  baseUrl: `${url.replace(/\/$/, "")}/v1`,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
});
