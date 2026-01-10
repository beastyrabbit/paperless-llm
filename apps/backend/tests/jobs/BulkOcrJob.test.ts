/**
 * BulkOcrJob tests.
 *
 * Tests for the bulk OCR job that processes documents through Mistral OCR.
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { BulkOcrJobService, BulkOcrJobServiceLive } from '../../src/jobs/BulkOcrJob.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { MistralService } from '../../src/services/MistralService.js';
import { TinyBaseService } from '../../src/services/TinyBaseService.js';
import { ConfigService } from '../../src/config/index.js';
import { sampleDocument } from '../setup.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockConfig = () =>
  Layer.succeed(ConfigService, {
    config: {
      tags: {
        pending: 'llm-pending',
        ocrDone: 'llm-ocr-done',
        failed: 'llm-failed',
      },
    },
  } as unknown as ConfigService);

const createMockPaperlessService = (overrides = {}) => {
  const defaultMocks = {
    getDocumentsByTag: vi.fn(() =>
      Effect.succeed([
        { ...sampleDocument(1), content: '' },
        { ...sampleDocument(2), content: '' },
        { ...sampleDocument(3), content: 'Existing OCR content that is more than 100 characters long so it passes the skip check...' },
      ])
    ),
    downloadPdf: vi.fn(() => Effect.succeed(new Uint8Array([0x25, 0x50, 0x44, 0x46]))),
    addTagToDocument: vi.fn(() => Effect.succeed(undefined)),
    removeTagFromDocument: vi.fn(() => Effect.succeed(undefined)),
    transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
    updateDocument: vi.fn(() => Effect.succeed(sampleDocument(1))),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

const createMockMistralService = (overrides = {}) => {
  const defaultMocks = {
    processDocument: vi.fn(() => Effect.succeed('Extracted text from document...')),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(MistralService, mocks as unknown as MistralService),
    mocks,
  };
};

const createMockTinyBase = (overrides = {}) => {
  const defaultMocks = {
    getAllSettings: vi.fn(() => Effect.succeed({})),
    getSetting: vi.fn(() => Effect.succeed(null)),
    setSetting: vi.fn(() => Effect.succeed(undefined)),
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

describe('BulkOcrJobService', () => {
  describe('Progress Tracking', () => {
    it('should start with idle status', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;
          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('idle');
      expect(result.total).toBe(0);
      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it('should update progress during processing', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          // Start the job
          yield* job.start({ docsPerSecond: 100 }); // Fast for testing

          // Wait a bit and check progress
          yield* Effect.sleep('50 millis');
          const progress = yield* job.getProgress();

          // Cancel to clean up
          yield* job.cancel();

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(['running', 'completed', 'cancelled']).toContain(result.status);
      expect(result.startedAt).toBeTruthy();
    });

    it('should track documents per second setting', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 5 });
          const progress = yield* job.getProgress();

          yield* job.cancel();

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.docsPerSecond).toBe(5);
    });
  });

  describe('OCR Processing', () => {
    it('should process documents without OCR content', async () => {
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: '' },
          ])
        ),
      });
      const { layer: mockMistral, mocks: mistralMocks } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100 });

          // Wait for completion
          let progress = yield* job.getProgress();
          let attempts = 0;
          while (progress.status === 'running' && attempts < 100) {
            yield* Effect.sleep('50 millis');
            progress = yield* job.getProgress();
            attempts++;
          }

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(mistralMocks.processDocument).toHaveBeenCalled();
      expect(paperlessMocks.downloadPdf).toHaveBeenCalled();
    });

    it('should skip documents with existing OCR content when skipExisting is true', async () => {
      const existingContent = 'This is existing OCR content that is long enough to be considered valid. It needs to be more than 100 characters for the skip logic to work properly.';
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: existingContent },
          ])
        ),
      });
      const { layer: mockMistral, mocks: mistralMocks } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100, skipExisting: true });

          // Wait for completion
          let progress = yield* job.getProgress();
          let attempts = 0;
          while (progress.status === 'running' && attempts < 100) {
            yield* Effect.sleep('50 millis');
            progress = yield* job.getProgress();
            attempts++;
          }

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have skipped the document
      expect(result.skipped).toBe(1);
      expect(mistralMocks.processDocument).not.toHaveBeenCalled();
    });

    it('should process documents with existing content when skipExisting is false', async () => {
      const existingContent = 'This is existing OCR content that is long enough to be considered valid. It needs to be more than 100 characters for the skip logic to work properly.';
      const { layer: mockPaperless } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: existingContent },
          ])
        ),
      });
      const { layer: mockMistral, mocks: mistralMocks } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100, skipExisting: false });

          // Wait for completion
          let progress = yield* job.getProgress();
          let attempts = 0;
          while (progress.status === 'running' && attempts < 100) {
            yield* Effect.sleep('50 millis');
            progress = yield* job.getProgress();
            attempts++;
          }

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have processed, not skipped
      expect(result.processed).toBe(1);
      expect(mistralMocks.processDocument).toHaveBeenCalled();
    });
  });

  describe('Tag Management', () => {
    it('should update tags after successful OCR', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: '' },
          ])
        ),
      });
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100 });

          // Wait for completion
          let progress = yield* job.getProgress();
          let attempts = 0;
          while (progress.status === 'running' && attempts < 100) {
            yield* Effect.sleep('50 millis');
            progress = yield* job.getProgress();
            attempts++;
          }
        }).pipe(Effect.provide(TestLayer))
      );

      // Should use atomic tag transition (pending -> ocr-done)
      expect(mocks.transitionDocumentTag).toHaveBeenCalled();
    });

    it('should handle OCR errors in progress', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: '' },
          ])
        ),
      });
      const { layer: mockMistral } = createMockMistralService({
        processDocument: vi.fn(() => Effect.fail(new Error('OCR failed'))),
      });
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100 });

          // Wait briefly and cancel
          yield* Effect.sleep('100 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have started processing
      expect(['running', 'cancelled', 'completed', 'error']).toContain(result.status);
    });
  });

  describe('Cancellation', () => {
    it('should cancel running job', async () => {
      const { layer: mockPaperless } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed(
            Array.from({ length: 100 }, (_, i) => ({
              ...sampleDocument(i + 1),
              content: '',
            }))
          )
        ),
      });
      const { layer: mockMistral } = createMockMistralService({
        processDocument: vi.fn(() =>
          Effect.gen(function* () {
            yield* Effect.sleep('100 millis');
            return 'Extracted text';
          })
        ),
      });
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 1 });

          // Wait a bit then cancel
          yield* Effect.sleep('50 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('cancelled');
      expect(result.completedAt).toBeTruthy();
    });

    it('should not allow starting while already running', async () => {
      const { layer: mockPaperless } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.gen(function* () {
            yield* Effect.sleep('200 millis');
            return [{ ...sampleDocument(1), content: '' }];
          })
        ),
      });
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          // Start the job
          yield* job.start();

          // Try to start again
          const secondStart = yield* Effect.either(job.start());

          // Cancel to clean up
          yield* job.cancel();

          return secondStart;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Left');
    });
  });

  describe('Completion', () => {
    it('should complete with correct counts', async () => {
      const { layer: mockPaperless } = createMockPaperlessService({
        getDocumentsByTag: vi.fn(() =>
          Effect.succeed([
            { ...sampleDocument(1), content: '' },
            { ...sampleDocument(2), content: '' },
            { ...sampleDocument(3), content: 'Existing content that is definitely more than 100 characters long to trigger the skip existing logic properly.' },
          ])
        ),
      });
      const { layer: mockMistral } = createMockMistralService();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.provideMerge(
        BulkOcrJobServiceLive,
        Layer.mergeAll(mockPaperless, mockMistral, mockConfig, createMockTinyBase().layer)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BulkOcrJobService;

          yield* job.start({ docsPerSecond: 100, skipExisting: true });

          // Wait for completion
          let progress = yield* job.getProgress();
          let attempts = 0;
          while (progress.status === 'running' && attempts < 100) {
            yield* Effect.sleep('50 millis');
            progress = yield* job.getProgress();
            attempts++;
          }

          return progress;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('completed');
      expect(result.total).toBe(3);
      expect(result.processed).toBe(2);
      expect(result.skipped).toBe(1);
      expect(result.completedAt).toBeTruthy();
    });
  });
});
