/**
 * Settings API handlers tests.
 *
 * Tests for settings CRUD and connection testing endpoints.
 */

import { Effect, Layer, Schema } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsUpdateBodySchema } from "@repo/api-contracts";
import * as settingsHandlers from "../../src/api/settings/handlers.js";
import { ConfigService } from "../../src/config/index.js";
import { getDefaultTagLanguageAliasesDeJson } from "../../src/utils/tagLanguage.js";
import { MistralService } from "../../src/services/MistralService.js";
import { OllamaService } from "../../src/services/OllamaService.js";
import { QdrantService } from "../../src/services/QdrantService.js";
import { TinyBaseService } from "../../src/services/TinyBaseService.js";
import { mockFetchError, mockFetchResponse } from "../setup.js";

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockConfig = (overrides = {}) =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: {
        url: "http://localhost:8000",
        token: "test-token",
      },
      ollama: {
        url: "http://localhost:11434",
        model: "llama3:latest",
        embeddingModel: "nomic-embed-text",
      },
      mistral: {
        apiKey: "test-mistral-key",
        model: "mistral-large-latest",
      },
      qdrant: {
        url: "http://localhost:6333",
        collection: "paperless",
      },
      autoProcessing: {
        enabled: false,
        intervalMinutes: 10,
        includeUntagged: false,
        confirmationEnabled: true,
        confirmationMaxRetries: 3,
      },
      tags: {
        todo: "llm-todo",
        ocr: "llm-ocr",
        metadata: "llm-metadata",
        review: "llm-review",
        index: "llm-index",
        done: "llm-done",
        failed: "llm-failed",
        pending: "llm-pending",
        ocrDone: "llm-ocr-done",
        correspondentDone: "llm-correspondent-done",
        documentTypeDone: "llm-document-type-done",
        titleDone: "llm-title-done",
        tagsDone: "llm-tags-done",
        processed: "llm-processed",
      },
      pipeline: {
        enableOcr: true,
        enableSummary: false,
        enableTitle: true,
        enableCorrespondent: true,
        enableDocumentType: true,
        enableTags: true,
        enableCustomFields: false,
      },
      language: "en",
      debug: false,
      ...overrides,
    },
  } as unknown as ConfigService);

const createMockTinyBase = (overrides = {}) => {
  const defaultMocks = {
    getAllSettings: vi.fn(() => Effect.succeed({})),
    setSetting: vi.fn(() => Effect.succeed(undefined)),
    getSetting: vi.fn(() => Effect.succeed(null)),
    clearAllSettings: vi.fn(() => Effect.succeed(undefined)),
  };
  const mocks = { ...defaultMocks, ...overrides };
  return {
    layer: Layer.succeed(TinyBaseService, mocks as unknown as TinyBaseService),
    mocks,
  };
};

const createMockOllama = (
  connected = true,
  models: unknown[] = [],
  runningModels: unknown[] = [],
) =>
  Layer.succeed(OllamaService, {
    testConnection: vi.fn(() => Effect.succeed(connected)),
    listModels: vi.fn(() => Effect.succeed(models)),
    getRunningModels: vi.fn(() => Effect.succeed(runningModels)),
  } as unknown as OllamaService);

const createMockMistral = (connected = true, models: unknown[] = []) =>
  Layer.succeed(MistralService, {
    testConnection: vi.fn(() => Effect.succeed(connected)),
    listModels: vi.fn(() => Effect.succeed(models)),
  } as unknown as MistralService);

const createMockQdrant = () =>
  Layer.succeed(QdrantService, {
    ensureCollection: vi.fn(() => Effect.succeed(undefined)),
  } as unknown as QdrantService);

// ===========================================================================
// Test Suites
// ===========================================================================

describe("Settings Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsHandlers.clearOllamaStatusCacheForTests();
  });

  describe("getSettings", () => {
    it("should return settings from config", async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toMatchObject({
        paperless_url: "http://localhost:8000",
        paperless_token: "********",
        paperless_token_configured: true,
        ollama_url: "http://localhost:11434",
        ollama_model: "llama3:latest",
        ollama_embedding_model: "nomic-embed-text",
        openai_cli_enabled: false,
        openai_cli_command: "codex",
        openai_cli_model: "gpt-5.5",
        openai_cli_scope: "chat",
        mistral_api_key: "********",
        mistral_api_key_configured: true,
        auto_processing_enabled: false,
        auto_processing_interval_minutes: 10,
        auto_processing_include_untagged: false,
        confirmation_enabled: true,
        confirmation_max_retries: 3,
        confirmation_min_confidence: 0.7,
        language: "en",
        debug: false,
      });
    });

    it("should mask configured tokens", async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(result.paperless_token).toBe("********");
      expect(result.paperless_token_configured).toBe(true);
      expect(result.mistral_api_key).toBe("********");
      expect(result.mistral_api_key_configured).toBe(true);
    });

    it("should not expose OpenAI API key settings", async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toHaveProperty("openai_cli_enabled", false);
      expect(result).toHaveProperty("openai_cli_command", "codex");
      expect(result).toHaveProperty("openai_cli_model", "gpt-5.5");
      expect(result).toHaveProperty("openai_cli_scope", "chat");
      expect(result).not.toHaveProperty("openai_api_key");
      expect(result).not.toHaveProperty("openai_api_key_configured");
    });

    it("should treat legacy enabled vector search as enabled during settings drift", async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getAllSettings: vi.fn(() =>
          Effect.succeed({
            "vector_search.enabled": "false",
            vector_search_enabled: "true",
          }),
        ),
      });
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(result.vector_search_enabled).toBe(true);
    });

    it("should return default German tag-language aliases when unset", async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(JSON.parse(result.tag_language_aliases_de)).toContainEqual({
        source: "invoice",
        target: "Rechnung",
      });
    });

    it("should return stored German tag-language aliases and fall back from malformed values", async () => {
      const storedAliases = JSON.stringify([{ source: "invoice", target: "Faktura" }]);
      const { layer: mockTinyBase } = createMockTinyBase({
        getAllSettings: vi
          .fn()
          .mockReturnValueOnce(Effect.succeed({ "tag_language.aliases.de": storedAliases }))
          .mockReturnValueOnce(Effect.succeed({ "tag_language.aliases.de": "not-json" })),
      });
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const stored = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );
      const malformed = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(JSON.parse(stored.tag_language_aliases_de)).toEqual([
        { source: "invoice", target: "Faktura" },
      ]);
      expect(JSON.parse(malformed.tag_language_aliases_de)).toContainEqual({
        source: "invoice",
        target: "Rechnung",
      });
    });

    it("should return empty string for unset values", async () => {
      const emptyConfig = Layer.succeed(ConfigService, {
        config: {
          paperless: { url: "", token: "" },
          ollama: { url: "", model: "", embeddingModel: "" },
          mistral: { apiKey: "", model: "" },
          qdrant: { url: "" },
          autoProcessing: {
            enabled: false,
            intervalMinutes: 10,
            includeUntagged: false,
            confirmationEnabled: true,
            confirmationMaxRetries: 3,
          },
          tags: {
            pending: "llm-pending",
            ocrDone: "llm-ocr-done",
            correspondentDone: "llm-correspondent-done",
            documentTypeDone: "llm-document-type-done",
            titleDone: "llm-title-done",
            tagsDone: "llm-tags-done",
            processed: "llm-processed",
          },
          language: "en",
          debug: false,
        },
      } as unknown as ConfigService);
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(emptyConfig, mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer)),
      );

      expect(result.paperless_token).toBe("");
      expect(result.mistral_api_key).toBe("");
    });
  });

  describe("updateSettings", () => {
    it("should store settings in TinyBase", async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers
          .updateSettings({ auto_processing_enabled: true })
          .pipe(Effect.provide(TestLayer)),
      );

      expect(mocks.setSetting).toHaveBeenCalledWith("auto_processing.enabled", "true");
    });

    it("should mirror selected canonical settings to legacy aliases", async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers
          .updateSettings({ vector_search_enabled: false, auto_processing_include_untagged: true })
          .pipe(Effect.provide(TestLayer)),
      );

      expect(mocks.setSetting).toHaveBeenCalledWith("vector_search.enabled", "false");
      expect(mocks.setSetting).toHaveBeenCalledWith("vector_search_enabled", "false");
      expect(mocks.setSetting).toHaveBeenCalledWith("auto_processing.include_untagged", "true");
      expect(mocks.setSetting).toHaveBeenCalledWith("auto_processing_include_untagged", "true");
    });

    it("should ignore undefined values", async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers
          .updateSettings({
            auto_processing_enabled: true,
            paperless_url: undefined,
          } as Parameters<typeof settingsHandlers.updateSettings>[0])
          .pipe(Effect.provide(TestLayer)),
      );

      // setSetting called once for auto_processing_enabled,
      // and getAllSettings called once for returning updated settings
      expect(mocks.setSetting).toHaveBeenCalledWith("auto_processing.enabled", "true");
    });

    it("should not store masked secrets as token values", async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers
          .updateSettings({
            paperless_token: "********",
            mistral_api_key: "********",
            "paperless.token": "********",
            "mistral.api_key": "********",
            ollama_url: "http://ollama:11434",
          } as Parameters<typeof settingsHandlers.updateSettings>[0])
          .pipe(Effect.provide(TestLayer)),
      );

      expect(mocks.setSetting).toHaveBeenCalledWith("ollama.url", "http://ollama:11434");
      expect(mocks.setSetting).not.toHaveBeenCalledWith("paperless.token", "********");
      expect(mocks.setSetting).not.toHaveBeenCalledWith("mistral.api_key", "********");
    });

    it("should store normalized German tag-language aliases", async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers
          .updateSettings({
            tag_language_aliases_de: [
              { source: " invoice ", target: " Faktura " },
              { source: "invoice", target: "Rechnung" },
              { source: "", target: "ignored" },
            ],
          })
          .pipe(Effect.provide(TestLayer)),
      );

      expect(mocks.setSetting).toHaveBeenCalledWith(
        "tag_language.aliases.de",
        JSON.stringify([{ source: "invoice", target: "Rechnung" }]),
      );
    });

    it("should accept the full default alias payload in the settings request schema", () => {
      const payload = { tag_language_aliases_de: getDefaultTagLanguageAliasesDeJson() };

      expect(() => Schema.decodeUnknownSync(SettingsUpdateBodySchema)(payload)).not.toThrow();
    });

    it("should return updated settings", async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.updateSettings({ language: "de" }).pipe(Effect.provide(TestLayer)),
      );

      // Should return the full settings object
      expect(result).toHaveProperty("paperless_url");
      expect(result).toHaveProperty("language");
    });
  });

  describe("testPaperlessConnection", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should return success when connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchResponse({ results: [] }));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.testPaperlessConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toEqual({
        status: "success",
        message: "Connected to Paperless-ngx",
        details: null,
      });
    });

    it("should return error when not connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchError(401, "Unauthorized"));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testPaperlessConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result.status).toBe("error");
    });
  });

  describe("testOllamaConnection", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should return success when connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchResponse({ models: [] }));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testOllamaConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toEqual({
        status: "success",
        message: "Connected to Ollama",
        details: null,
      });
    });

    it("should return error when not connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchError(500, "Server Error"));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testOllamaConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result.status).toBe("error");
    });
  });

  describe("testMistralConnection", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should return success when connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchResponse({ data: [] }));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testMistralConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toEqual({
        status: "success",
        message: "Connected to Mistral AI",
        details: null,
      });
    });

    it("should return error when not connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchError(401, "Unauthorized"));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testMistralConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result.status).toBe("error");
    });
  });

  describe("testQdrantConnection", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("should return success when connected", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchResponse({ collections: [] }));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result).toMatchObject({
        status: "success",
      });
    });

    it("should return error when connection fails", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() => mockFetchError(500, "Server Error"));

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(Effect.provide(TestLayer)),
      );

      expect(result.status).toBe("error");
    });

    it("should return error when fetch throws", async () => {
      vi.spyOn(global, "fetch").mockImplementation(() =>
        Promise.reject(new Error("Network error")),
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase, createMockQdrant());

      // The handler's catch returns an error result as the failure value
      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(
          Effect.provide(TestLayer),
          Effect.catchAll((err) => Effect.succeed(err)),
        ),
      );

      // The catch handler returns this error object
      expect(result).toMatchObject({
        status: "error",
      });
    });
  });

  describe("getOllamaModels", () => {
    it("should return list of models", async () => {
      const models = [
        { name: "llama3:latest", size: 1000, modified_at: "2024-01-01" },
        { name: "mistral:latest", size: 2000, modified_at: "2024-01-02" },
      ];

      const TestLayer = Layer.mergeAll(createMockConfig(), createMockOllama(true, models));

      const result = await Effect.runPromise(
        settingsHandlers.getOllamaModels.pipe(Effect.provide(TestLayer)),
      );

      // Handler returns { models: [...] } format
      expect(result.models).toHaveLength(2);
      expect(result.models[0]).toEqual({
        name: "llama3:latest",
        size: 1000,
        modified_at: "2024-01-01",
      });
    });

    it("should return empty array on error", async () => {
      const mockOllama = Layer.succeed(OllamaService, {
        listModels: vi.fn(() => Effect.fail(new Error("Connection failed"))),
      } as unknown as OllamaService);

      const TestLayer = Layer.mergeAll(createMockConfig(), mockOllama);

      const result = await Effect.runPromise(
        settingsHandlers.getOllamaModels.pipe(Effect.provide(TestLayer)),
      );

      // Handler returns { models: [] } on error
      expect(result).toEqual({ models: [] });
    });
  });

  describe("getOllamaStatus", () => {
    const runningModel = {
      name: "llama3:latest",
      model: "llama3:latest",
      size: 1000,
      digest: "abc123",
      details: {
        parent_model: "",
        format: "gguf",
        family: "llama",
        families: ["llama"],
        parameter_size: "8B",
        quantization_level: "Q4_K_M",
      },
      expires_at: "2026-05-16T10:45:00.000Z",
      size_vram: 900,
    };

    it("should cache immediate status checks", async () => {
      const getRunningModels = vi.fn(() => Effect.succeed([runningModel]));
      const mockOllama = Layer.succeed(OllamaService, {
        getRunningModels,
      } as unknown as OllamaService);
      const TestLayer = Layer.mergeAll(createMockConfig(), mockOllama);

      const first = await Effect.runPromise(
        settingsHandlers.getOllamaStatus.pipe(Effect.provide(TestLayer)),
      );
      const second = await Effect.runPromise(
        settingsHandlers.getOllamaStatus.pipe(Effect.provide(TestLayer)),
      );

      expect(getRunningModels).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(first).toEqual({
        running: true,
        models: [
          {
            name: "llama3:latest",
            model: "llama3:latest",
            size: 1000,
            size_vram: 900,
            expires_at: "2026-05-16T10:45:00.000Z",
            parameter_size: "8B",
            quantization: "Q4_K_M",
          },
        ],
      });
    });

    it("should share an in-flight status check", async () => {
      let resolveRunningModels: (models: unknown[]) => void = () => {};
      const runningModelsPromise = new Promise<unknown[]>((resolve) => {
        resolveRunningModels = resolve;
      });
      const getRunningModels = vi.fn(() => Effect.promise(() => runningModelsPromise));
      const mockOllama = Layer.succeed(OllamaService, {
        getRunningModels,
      } as unknown as OllamaService);
      const TestLayer = Layer.mergeAll(createMockConfig(), mockOllama);

      const firstPromise = Effect.runPromise(
        settingsHandlers.getOllamaStatus.pipe(Effect.provide(TestLayer)),
      );
      const secondPromise = Effect.runPromise(
        settingsHandlers.getOllamaStatus.pipe(Effect.provide(TestLayer)),
      );

      resolveRunningModels([runningModel]);
      const [first, second] = await Promise.all([firstPromise, secondPromise]);

      expect(getRunningModels).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
      expect(first.running).toBe(true);
    });
  });

  describe("getMistralModels", () => {
    it("should return list of models", async () => {
      const models = [
        {
          id: "mistral-large-latest",
          object: "model",
          created: 1704067200,
          owned_by: "mistralai",
        },
        {
          id: "mistral-small-latest",
          object: "model",
          created: 1704067200,
          owned_by: "mistralai",
        },
      ];

      const TestLayer = Layer.mergeAll(createMockConfig(), createMockMistral(true, models));

      const result = await Effect.runPromise(
        settingsHandlers.getMistralModels.pipe(Effect.provide(TestLayer)),
      );

      // Handler returns { models: [...] } format
      expect(result.models).toHaveLength(2);
      expect(result.models[0]).toEqual({
        id: "mistral-large-latest",
        object: "model",
        created: 1704067200,
        owned_by: "mistralai",
      });
    });

    it("should return empty array on error", async () => {
      const mockMistral = Layer.succeed(MistralService, {
        listModels: vi.fn(() => Effect.fail(new Error("API key invalid"))),
      } as unknown as MistralService);

      const TestLayer = Layer.mergeAll(createMockConfig(), mockMistral);

      const result = await Effect.runPromise(
        settingsHandlers.getMistralModels.pipe(Effect.provide(TestLayer)),
      );

      // Handler returns { models: [] } on error
      expect(result).toEqual({ models: [] });
    });
  });
});
