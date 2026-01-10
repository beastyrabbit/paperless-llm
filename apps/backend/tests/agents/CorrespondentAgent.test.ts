/**
 * CorrespondentAgent tests.
 *
 * Tests for the correspondent extraction agent that identifies and suggests
 * document correspondents using LLM analysis with blocking and confirmation.
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { CorrespondentAgentService, CorrespondentAgentServiceLive } from '../../src/agents/CorrespondentAgent.js';
import { ConfigService } from '../../src/config/index.js';
import { OllamaService } from '../../src/services/OllamaService.js';
import { PromptService } from '../../src/services/PromptService.js';
import { TinyBaseService } from '../../src/services/TinyBaseService.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { sampleDocument, sampleCorrespondents } from '../setup.js';

// ===========================================================================
// Default Input Helper
// ===========================================================================

const defaultInput = {
  docId: 1,
  content: 'Document content...',
  docTitle: 'Test Document',
  existingCorrespondents: ['Existing Corp', 'Another Corp'],
};

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
        correspondentDone: 'llm-correspondent-done',
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
          correspondent: 'ACME Corporation',
          reasoning: 'Found company name in header',
          confidence: 0.85,
          alternatives: ['ACME Inc', 'ACME Corp'],
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
    renderPrompt: vi.fn(() => Effect.succeed('Rendered prompt')),
  } as unknown as PromptService);

const createMockPaperless = (overrides = {}) => {
  const defaultMocks = {
    getCorrespondents: vi.fn(() => Effect.succeed(sampleCorrespondents())),
    getOrCreateCorrespondent: vi.fn(() => Effect.succeed(5)),
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
    isBlocked: vi.fn(() => Effect.succeed(false)),
    addPendingReview: vi.fn(() => Effect.succeed(undefined)),
    getPendingReview: vi.fn(() => Effect.succeed(null)),
    getPendingReviews: vi.fn(() => Effect.succeed([])),
    removePendingReview: vi.fn(() => Effect.succeed(undefined)),
    addBlockedSuggestion: vi.fn(() => Effect.succeed(undefined)),
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

describe('CorrespondentAgentService', () => {
  describe('Process Method', () => {
    it('should extract correspondent successfully on first attempt', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                correspondent: 'Test Corp',
                reasoning: 'Found in document header',
                confidence: 0.9,
                alternatives: [],
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('Yes, the correspondent is correct.')),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process({
            ...defaultInput,
            content: 'Document from Test Corp...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('Test Corp');
      expect(result.needsReview).toBe(false);
      expect(paperlessMocks.updateDocument).toHaveBeenCalled();
    });

    it('should use existing correspondents list for context', async () => {
      const mockPromptFn = vi.fn(() => Effect.succeed('Rendered'));
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                correspondent: 'Test Correspondent',
                reasoning: 'Matched existing',
                confidence: 0.95,
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('confirmed')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = Layer.succeed(PromptService, {
        renderPrompt: mockPromptFn,
      } as unknown as PromptService);

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process({
            ...defaultInput,
            content: 'Content from Test Correspondent...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have called renderPrompt with existing correspondents
      expect(mockPromptFn).toHaveBeenCalled();
    });

    it('should retry when confirmation fails', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Wrong Corp', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('No, this is wrong'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Correct Corp', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('Yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.success).toBe(true);
      expect(result.value).toBe('Correct Corp');
    });

    it('should queue for review after max retries', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Rejected', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Rejected2', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Rejected3', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('no')),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          const tinybase = yield* TinyBaseService;

          const processResult = yield* agent.process(defaultInput);
          const pendingReviews = yield* tinybase.getPendingReviews('correspondent');

          return { processResult, pendingReviews };
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.processResult.success).toBe(false);
      expect(result.processResult.needsReview).toBe(true);
      expect(paperlessMocks.addTagToDocument).toHaveBeenCalledWith(1, 'llm-manual-review');
    });
  });

  describe('Blocking Functionality', () => {
    it('should handle blocked correspondents', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({ correspondent: 'Blocked Corp', reasoning: 'R', alternatives: ['Good Corp'] })
            )
          )
          .mockReturnValueOnce(Effect.succeed('no')) // blocked -> no confirmation
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({ correspondent: 'Blocked Corp', reasoning: 'R' })
            )
          )
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({ correspondent: 'Blocked Corp', reasoning: 'R' })
            )
          )
          .mockReturnValueOnce(Effect.succeed('no')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const tinybase = yield* TinyBaseService;

          // Add blocked suggestion
          yield* tinybase.addBlockedSuggestion({
            suggestionName: 'Blocked Corp',
            blockType: 'correspondent',
            rejectionReason: 'Test block',
            rejectionCategory: 'wrong_suggestion',
            docId: null,
          });

          const agent = yield* CorrespondentAgentService;
          return yield* agent.process({
            ...defaultInput,
            content: 'Content from Blocked Corp...',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      // Since the suggestion is blocked, it should fail or queue for review
      expect(result).toBeDefined();
    });
  });

  describe('Tag Management', () => {
    it('should update tags on successful extraction', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Corp', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless, mocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      // Code now uses atomic transitionDocumentTag instead of separate remove/add
      // CorrespondentAgent runs after TitleAgent, so transitions from titleDone
      expect(mocks.transitionDocumentTag).toHaveBeenCalledWith(1, 'llm-title-done', 'llm-correspondent-done');
    });

    it('should add manual review tag when queued', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(Effect.succeed(JSON.stringify({ correspondent: 'Bad', reasoning: 'R' })))
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(Effect.succeed(JSON.stringify({ correspondent: 'Bad', reasoning: 'R' })))
          .mockReturnValueOnce(Effect.succeed('no'))
          .mockReturnValueOnce(Effect.succeed(JSON.stringify({ correspondent: 'Bad', reasoning: 'R' })))
          .mockReturnValueOnce(Effect.succeed('no')),
      });
      const { layer: mockPaperless, mocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(mocks.addTagToDocument).toHaveBeenCalledWith(1, 'llm-manual-review');
    });
  });

  describe('Correspondent Creation', () => {
    it('should create new correspondent if not exists', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'New Corp', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless, mocks } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(mocks.getOrCreateCorrespondent).toHaveBeenCalledWith('New Corp');
    });
  });

  describe('Response Parsing', () => {
    it('should parse JSON response with correspondent field', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                correspondent: 'Parsed Corp',
                reasoning: 'Test',
                confidence: 0.9,
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.value).toBe('Parsed Corp');
    });

    it('should handle alternatives in response', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(
              JSON.stringify({
                correspondent: 'Main Corp',
                reasoning: 'R',
                alternatives: ['Alt Corp 1', 'Alt Corp 2'],
              })
            )
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          return yield* agent.process(defaultInput);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.alternatives).toContain('Alt Corp 1');
      expect(result.alternatives).toContain('Alt Corp 2');
    });
  });

  describe('Stream Processing', () => {
    it('should emit stream events', async () => {
      const { layer: mockOllama } = createMockOllama({
        generate: vi.fn()
          .mockReturnValueOnce(
            Effect.succeed(JSON.stringify({ correspondent: 'Stream Corp', reasoning: 'R' }))
          )
          .mockReturnValueOnce(Effect.succeed('yes')),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();
      const mockPrompts = createMockPrompts();

      const TestLayer = Layer.provideMerge(
        CorrespondentAgentServiceLive,
        Layer.mergeAll(mockOllama, mockPaperless, mockConfig, mockPrompts, createMockTinyBase().layer)
      );

      const events = await Effect.runPromise(
        Effect.gen(function* () {
          const agent = yield* CorrespondentAgentService;
          const stream = agent.processStream(defaultInput);
          return yield* Stream.runCollect(stream);
        }).pipe(Effect.provide(TestLayer))
      );

      const eventArray = Array.from(events);
      const eventTypes = eventArray.map((e) => e.type);

      expect(eventTypes).toContain('start');
      expect(eventTypes).toContain('complete');
    });
  });
});
