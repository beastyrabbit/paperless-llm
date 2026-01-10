/**
 * TitleAgent tests.
 *
 * Tests for the title generation agent that suggests document titles
 * using LLM analysis with confirmation loop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { TitleAgentService, TitleAgentServiceLive } from '../../src/agents/TitleAgent.js';
import { ConfigService } from '../../src/config/index.js';
import { OllamaService } from '../../src/services/OllamaService.js';
import { PromptService } from '../../src/services/PromptService.js';
import { TinyBaseService } from '../../src/services/TinyBaseService.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { sampleDocument, sampleLlmResponse } from '../setup.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockConfig = () =>
  Layer.succeed(ConfigService, {
    config: {
      autoProcessing: {
        confirmationMaxRetries: 3,
      },
      tags: {
        ocrDone: 'llm-ocr-done',
        titleDone: 'llm-title-done',
        manualReview: 'llm-manual-review',
      },
    },
  } as unknown as ConfigService);

const createMockOllama = (overrides = {}) => {
  const defaultMocks = {
    getModel: vi.fn((type: string) => `test-${type}-model`),
    generate: vi.fn(() =>
      Effect.succeed(
        JSON.stringify({
          suggested_title: 'Test Generated Title',
          reasoning: 'Based on document content analysis',
          confidence: 0.85,
          based_on_similar: ['Similar Title 1', 'Similar Title 2'],
        })
      )
    ),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(OllamaService, mocks as unknown as OllamaService),
    mocks,
  };
};

const createMockPrompts = () =>
  Layer.succeed(PromptService, {
    renderPrompt: vi.fn(() => Effect.succeed('Rendered prompt for title analysis')),
  } as unknown as PromptService);

const createMockPaperless = (overrides = {}) => {
  const defaultMocks = {
    updateDocument: vi.fn(() => Effect.succeed(sampleDocument(1))),
    addTagToDocument: vi.fn(() => Effect.succeed(undefined)),
    removeTagFromDocument: vi.fn(() => Effect.succeed(undefined)),
    transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

const createMockTinyBase = (overrides = {}) => {
  const defaultMocks = {
    getSimilarTitles: vi.fn(() => Effect.succeed([])),
    addPendingReview: vi.fn(() => Effect.succeed(undefined)),
    getPendingReview: vi.fn(() => Effect.succeed(null)),
    getPendingReviews: vi.fn(() => Effect.succeed([])),
    removePendingReview: vi.fn(() => Effect.succeed(undefined)),
    isBlocked: vi.fn(() => Effect.succeed(false)),
    getAllSettings: vi.fn(() => Effect.succeed({})),
  };
  const mocks = { ...defaultMocks, ...overrides };
  return {
    layer: Layer.succeed(TinyBaseService, mocks as unknown as TinyBaseService),
    mocks,
  };
};

// ===========================================================================
// Test Suites
// ===========================================================================

describe('TitleAgentService', () => {
  describe('Process Method', () => {
    it('should generate title successfully on first attempt', async () => {
      const { layer: mockOllama, mocks: ollamaMocks } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                suggested_title: 'Invoice from ACME Corp',
                reasoning: 'Document header indicates this is an invoice from ACME Corp',
                confidence: 0.9,
                based_on_similar: [],
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('Yes, the title is appropriate.')),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Invoice #12345 from ACME Corp...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('Invoice from ACME Corp');
      expect(result.needsReview).toBe(false);
      expect(paperlessMocks.updateDocument).toHaveBeenCalled();
    });

    it('should retry when confirmation fails', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          // First analysis
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                suggested_title: 'Bad Title',
                reasoning: 'Initial attempt',
                confidence: 0.5,
              })
            )
          )
          // First confirmation - rejected
          .mockReturnValueOnce(Effect.succeed('No, title is too generic'))
          // Second analysis (with feedback)
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                suggested_title: 'Better Title for Invoice',
                reasoning: 'Improved based on feedback',
                confidence: 0.8,
              })
            )
          )
          // Second confirmation - accepted
          .mockReturnValueOnce(Effect.succeed('Yes, confirmed')),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Document content...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('Better Title for Invoice');
      expect(paperlessMocks.updateDocument).toHaveBeenCalled();
    });

    it('should queue for review after max retries', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Bad1', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Bad2', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Bad3', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no')),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          const tinybase = yield* TinyBaseService;

          const processResult = yield* agent.process({
            docId: 1,
            content: 'Document content...',
            existingTitle: 'Original Title',
          });

          const pendingReviews = yield* tinybase.getPendingReviews('title');

          return { processResult, pendingReviews };
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.processResult.success).toBe(false);
      expect(result.processResult.needsReview).toBe(true);
      expect(paperlessMocks.addTagToDocument).toHaveBeenCalled();
    });

    it('should use similar titles for context', async () => {
      const mockPromptFn = vi.fn(() => Effect.succeed('Rendered prompt'));
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                suggested_title: 'Invoice 2024-001',
                reasoning: 'Based on similar documents',
                confidence: 0.9,
                based_on_similar: ['Invoice 2023-100'],
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('Yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = Layer.succeed(PromptService, {
        renderPrompt: mockPromptFn,
      } as unknown as PromptService);

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Invoice content...',
            similarTitles: ['Invoice 2023-100', 'Invoice 2023-099'],
          });
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have included similar titles in prompt
      expect(mockPromptFn).toHaveBeenCalled();
    });
  });

  describe('Response Parsing', () => {
    it('should parse JSON response correctly', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(`
            Here's my analysis:
            {
              "suggested_title": "Parsed JSON Title",
              "reasoning": "From JSON",
              "confidence": 0.95,
              "based_on_similar": ["Sim 1"]
            }
          `)
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Content...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.value).toBe('Parsed JSON Title');
    });

    it('should handle snake_case JSON response', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                suggested_title: 'Snake Case Title',
                reasoning: 'Test',
                confidence: 0.8,
                based_on_similar: [],
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('confirmed')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Content...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.value).toBe('Snake Case Title');
    });

    it('should fall back to text extraction on invalid JSON', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed('Title: Extracted Text Title\nThis is the reasoning.')
          )
          .mockReturnValueOnce(Effect.succeed('accept')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({
            docId: 1,
            content: 'Content...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.value).toBe('Extracted Text Title');
    });
  });

  describe('Confirmation Parsing', () => {
    it('should recognize "yes" as confirmed', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Test', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('Yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({ docId: 1, content: 'Content' });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
    });

    it('should recognize "confirmed" as confirmed', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Test', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('The title is confirmed.')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({ docId: 1, content: 'Content' });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
    });

    it('should recognize "no" as rejected with feedback', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Bad', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('No, the title should include the date'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Good', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({ docId: 1, content: 'Content' });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('Good');
    });
  });

  describe('Tag Updates', () => {
    it('should update tags on successful processing', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Test', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless, mocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({ docId: 1, content: 'Content' });
        }).pipe(Effect.provide(TestLayer))
      );

      // Code now uses atomic transitionDocumentTag instead of separate remove/add
      expect(mocks.transitionDocumentTag).toHaveBeenCalledWith(1, 'llm-ocr-done', 'llm-title-done');
    });

    it('should add manual review tag when queued for review', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn(() =>
          Effect.succeed(JSON.stringify({ suggested_title: 'Bad', reasoning: 'R' }))
        ).mockReturnValue(Effect.succeed('no')),
      });
      const { layer: mockPaperless, mocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          return yield* agent.process({ docId: 1, content: 'Content' });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(mocks.addTagToDocument).toHaveBeenCalledWith(1, 'llm-manual-review');
    });
  });

  describe('Stream Processing', () => {
    it('should emit stream events during processing', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Stream Title', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          const stream = agent.processStream({ docId: 1, content: 'Content' });
          return yield* Stream.runCollect(stream);
        }).pipe(Effect.provide(TestLayer))
      );

      const eventArray = Array.from(events);
      const eventTypes = eventArray.map((e) => e.type);

      expect(eventTypes).toContain('start');
      expect(eventTypes).toContain('complete');
    });

    it('should emit result event with success status', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ suggested_title: 'Success Title', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        TitleAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* TitleAgentService;
          const stream = agent.processStream({ docId: 1, content: 'Content' });
          return yield* Stream.runCollect(stream);
        }).pipe(Effect.provide(TestLayer))
      );

      const eventArray = Array.from(events);
      const resultEvent = eventArray.find((e) => e.type === 'result');

      expect(resultEvent).toBeDefined();
      expect(resultEvent?.data?.success).toBe(true);
    });
  });
});
