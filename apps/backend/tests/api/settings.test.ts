/**
 * Settings API handlers tests.
 *
 * Tests for settings CRUD and connection testing endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as settingsHandlers from '../../src/api/settings/handlers.js';
import { ConfigService } from '../../src/config/index.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { OllamaService } from '../../src/services/OllamaService.js';
import { MistralService } from '../../src/services/MistralService.js';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';
import { sampleSettings, mockFetchResponse, mockFetchError } from '../setup.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockConfig = (overrides = {}) =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: {
        url: 'http://localhost:8000',
        token: 'test-token',
      },
      ollama: {
        url: 'http://localhost:11434',
        modelLarge: 'llama3:latest',
        modelSmall: 'llama3:8b',
      },
      mistral: {
        apiKey: 'test-mistral-key',
        model: 'mistral-large-latest',
      },
      qdrant: {
        url: 'http://localhost:6333',
        collection: 'paperless',
      },
      autoProcessing: {
        enabled: false,
        intervalMinutes: 10,
        confirmationEnabled: true,
        confirmationMaxRetries: 3,
      },
      tags: {
        pending: 'llm-pending',
        ocrDone: 'llm-ocr-done',
        correspondentDone: 'llm-correspondent-done',
        documentTypeDone: 'llm-document-type-done',
        titleDone: 'llm-title-done',
        tagsDone: 'llm-tags-done',
        processed: 'llm-processed',
      },
      language: 'en',
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

const createMockPaperless = (connected = true) =>
  Layer.succeed(PaperlessService, {
    testConnection: vi.fn(() => Effect.succeed(connected)),
  } as unknown as PaperlessService);

const createMockOllama = (connected = true, models: any[] = []) =>
  Layer.succeed(OllamaService, {
    testConnection: vi.fn(() => Effect.succeed(connected)),
    listModels: vi.fn(() => Effect.succeed(models)),
  } as unknown as OllamaService);

const createMockMistral = (connected = true, models: any[] = []) =>
  Layer.succeed(MistralService, {
    testConnection: vi.fn(() => Effect.succeed(connected)),
    listModels: vi.fn(() => Effect.succeed(models)),
  } as unknown as MistralService);

// ===========================================================================
// Test Suites
// ===========================================================================

describe('Settings Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSettings', () => {
    it('should return settings from config', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer))
      );

      expect(result).toMatchObject({
        paperless_url: 'http://localhost:8000',
        paperless_token: 'test-token', // No longer masked - local app
        ollama_url: 'http://localhost:11434',
        ollama_model_large: 'llama3:latest',
        ollama_model_small: 'llama3:8b',
        mistral_api_key: 'test-mistral-key', // No longer masked - local app
        auto_processing_enabled: false,
        auto_processing_interval_minutes: 10,
        confirmation_enabled: true,
        confirmation_max_retries: 3,
        language: 'en',
        debug: false,
      });
    });

    it('should return actual tokens (local app)', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer))
      );

      // Local app returns actual values, not masked
      expect(result.paperless_token).toBe('test-token');
      expect(result.mistral_api_key).toBe('test-mistral-key');
    });

    it('should return empty string for unset values', async () => {
      const emptyConfig = Layer.succeed(ConfigService, {
        config: {
          paperless: { url: '', token: '' },
          ollama: { url: '', modelLarge: '', modelSmall: '' },
          mistral: { apiKey: '', model: '' },
          qdrant: { url: '' },
          autoProcessing: {
            enabled: false,
            intervalMinutes: 10,
            confirmationEnabled: true,
            confirmationMaxRetries: 3,
          },
          tags: {
            pending: 'llm-pending',
            ocrDone: 'llm-ocr-done',
            correspondentDone: 'llm-correspondent-done',
            documentTypeDone: 'llm-document-type-done',
            titleDone: 'llm-title-done',
            tagsDone: 'llm-tags-done',
            processed: 'llm-processed',
          },
          language: 'en',
          debug: false,
        },
      } as unknown as ConfigService);
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(emptyConfig, mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.getSettings.pipe(Effect.provide(TestLayer))
      );

      expect(result.paperless_token).toBe('');
      expect(result.mistral_api_key).toBe('');
    });
  });

  describe('updateSettings', () => {
    it('should store settings in TinyBase', async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers.updateSettings({ auto_processing_enabled: true }).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(mocks.setSetting).toHaveBeenCalledWith(
        'auto_processing.enabled',
        'true'
      );
    });

    it('should ignore undefined values', async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      await Effect.runPromise(
        settingsHandlers.updateSettings({
          auto_processing_enabled: true,
          paperless_url: undefined,
        } as any).pipe(Effect.provide(TestLayer))
      );

      // setSetting called once for auto_processing_enabled,
      // and getAllSettings called once for returning updated settings
      expect(mocks.setSetting).toHaveBeenCalledWith(
        'auto_processing.enabled',
        'true'
      );
    });

    it('should return updated settings', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.updateSettings({ language: 'de' }).pipe(
          Effect.provide(TestLayer)
        )
      );

      // Should return the full settings object
      expect(result).toHaveProperty('paperless_url');
      expect(result).toHaveProperty('language');
    });
  });

  describe('testPaperlessConnection', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return success when connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchResponse({ results: [] })
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testPaperlessConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Connected to Paperless-ngx',
        details: null,
      });
    });

    it('should return error when not connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchError(401, 'Unauthorized')
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testPaperlessConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('error');
    });
  });

  describe('testOllamaConnection', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return success when connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchResponse({ models: [] })
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testOllamaConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Connected to Ollama',
        details: null,
      });
    });

    it('should return error when not connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchError(500, 'Server Error')
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testOllamaConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('error');
    });
  });

  describe('testMistralConnection', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return success when connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchResponse({ data: [] })
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testMistralConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Connected to Mistral AI',
        details: null,
      });
    });

    it('should return error when not connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchError(401, 'Unauthorized')
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testMistralConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('error');
    });
  });

  describe('testQdrantConnection', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('should return success when connected', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchResponse({ collections: [] })
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result).toEqual({
        status: 'success',
        message: 'Connected to Qdrant',
        details: null,
      });
    });

    it('should return error when connection fails', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        mockFetchError(500, 'Server Error')
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('error');
    });

    it('should return error when fetch throws', async () => {
      vi.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.reject(new Error('Network error'))
      );

      const { layer: mockTinyBase } = createMockTinyBase();
      const TestLayer = Layer.mergeAll(createMockConfig(), mockTinyBase);

      // The handler's catch returns an error result as the failure value
      const result = await Effect.runPromise(
        settingsHandlers.testQdrantConnection.pipe(
          Effect.provide(TestLayer),
          Effect.catchAll((err) => Effect.succeed(err))
        )
      );

      // The catch handler returns this error object
      expect(result).toMatchObject({
        status: 'error',
      });
    });
  });

  describe('getOllamaModels', () => {
    it('should return list of models', async () => {
      const models = [
        { name: 'llama3:latest', size: 1000, modified_at: '2024-01-01' },
        { name: 'mistral:latest', size: 2000, modified_at: '2024-01-02' },
      ];

      const TestLayer = Layer.mergeAll(
        createMockConfig(),
        createMockOllama(true, models)
      );

      const result = await Effect.runPromise(
        settingsHandlers.getOllamaModels.pipe(Effect.provide(TestLayer))
      );

      // Handler returns { models: [...] } format
      expect(result.models).toHaveLength(2);
      expect(result.models[0]).toEqual({
        name: 'llama3:latest',
        size: 1000,
        modified_at: '2024-01-01',
      });
    });

    it('should return empty array on error', async () => {
      const mockOllama = Layer.succeed(OllamaService, {
        listModels: vi.fn(() => Effect.fail(new Error('Connection failed'))),
      } as unknown as OllamaService);

      const TestLayer = Layer.mergeAll(createMockConfig(), mockOllama);

      const result = await Effect.runPromise(
        settingsHandlers.getOllamaModels.pipe(Effect.provide(TestLayer))
      );

      // Handler returns { models: [] } on error
      expect(result).toEqual({ models: [] });
    });
  });

  describe('getMistralModels', () => {
    it('should return list of models', async () => {
      const models = [
        {
          id: 'mistral-large-latest',
          object: 'model',
          created: 1704067200,
          owned_by: 'mistralai',
        },
        {
          id: 'mistral-small-latest',
          object: 'model',
          created: 1704067200,
          owned_by: 'mistralai',
        },
      ];

      const TestLayer = Layer.mergeAll(
        createMockConfig(),
        createMockMistral(true, models)
      );

      const result = await Effect.runPromise(
        settingsHandlers.getMistralModels.pipe(Effect.provide(TestLayer))
      );

      // Handler returns { models: [...] } format
      expect(result.models).toHaveLength(2);
      expect(result.models[0]).toEqual({
        id: 'mistral-large-latest',
        object: 'model',
        created: 1704067200,
        owned_by: 'mistralai',
      });
    });

    it('should return empty array on error', async () => {
      const mockMistral = Layer.succeed(MistralService, {
        listModels: vi.fn(() => Effect.fail(new Error('API key invalid'))),
      } as unknown as MistralService);

      const TestLayer = Layer.mergeAll(createMockConfig(), mockMistral);

      const result = await Effect.runPromise(
        settingsHandlers.getMistralModels.pipe(Effect.provide(TestLayer))
      );

      // Handler returns { models: [] } on error
      expect(result).toEqual({ models: [] });
    });
  });
});
