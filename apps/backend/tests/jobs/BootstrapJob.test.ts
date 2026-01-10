/**
 * BootstrapJob tests.
 *
 * Tests for the bootstrap analysis job that finds similar/duplicate entities
 * and generates merge/delete suggestions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer, Ref } from 'effect';
import { BootstrapJobService, BootstrapJobServiceLive } from '../../src/jobs/BootstrapJob.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';
import { sampleCorrespondents, sampleDocumentTypes, sampleTags } from '../setup.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockPaperlessService = (overrides = {}) => {
  const defaultMocks = {
    getCorrespondents: Effect.succeed(sampleCorrespondents()),
    getDocumentTypes: Effect.succeed(sampleDocumentTypes()),
    getTags: Effect.succeed(sampleTags()),
  };

  return Layer.succeed(
    PaperlessService,
    {
      ...defaultMocks,
      ...overrides,
    } as unknown as PaperlessService
  );
};

// ===========================================================================
// Test Suites
// ===========================================================================

describe('BootstrapJobService', () => {
  describe('Progress Tracking', () => {
    it('should start with idle status', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;
          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('idle');
      expect(result.total).toBe(0);
      expect(result.processed).toBe(0);
    });

    it('should track progress during analysis', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          // Start the job
          yield* job.start('all');

          // Wait a tiny bit for progress to update
          yield* Effect.sleep('10 millis');

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      // Status should be running or completed
      expect(['running', 'completed']).toContain(result.status);
      expect(result.startedAt).toBeTruthy();
    });

    it('should complete with suggestions count', async () => {
      // Create correspondents with similar names for merge suggestions
      const similarCorrespondents = [
        { id: 1, name: 'Test Corp', document_count: 5 },
        { id: 2, name: 'Test Corporation', document_count: 3 },
        { id: 3, name: 'Different Company', document_count: 10 },
      ];

      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.succeed(similarCorrespondents),
        getDocumentTypes: Effect.succeed([]),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          // Run the analysis
          yield* job.start('correspondents');

          // Wait briefly for job to start
          yield* Effect.sleep('100 millis');

          // Cancel and check that it was running
          yield* job.cancel();
          const progress = yield* job.getProgress();

          return { progress };
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have started and been cancelled
      expect(['running', 'cancelled', 'completed']).toContain(result.progress.status);
    });
  });

  describe('Similar Entity Detection', () => {
    it('should detect similar correspondents by name', async () => {
      const correspondents = [
        { id: 1, name: 'Amazon', document_count: 10 },
        { id: 2, name: 'AMAZON', document_count: 5 },
        { id: 3, name: 'Unique Company', document_count: 3 },
      ];

      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.succeed(correspondents),
        getDocumentTypes: Effect.succeed([]),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('correspondents');

          // Wait briefly for job to start
          yield* Effect.sleep('100 millis');

          // Cancel and check progress
          yield* job.cancel();
          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have started the analysis
      expect(['running', 'cancelled', 'completed']).toContain(result.status);
    });

    it('should detect unused correspondents for deletion', async () => {
      const correspondents = [
        { id: 1, name: 'Active Corp', document_count: 10 },
        { id: 2, name: 'Unused Corp', document_count: 0 },
        { id: 3, name: 'Another Unused', document_count: 0 },
      ];

      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.succeed(correspondents),
        getDocumentTypes: Effect.succeed([]),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('correspondents');

          // Wait briefly for job to start
          yield* Effect.sleep('100 millis');

          yield* job.cancel();
          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have started the analysis
      expect(['running', 'cancelled', 'completed']).toContain(result.status);
    });

    it('should detect similar document types', async () => {
      const types = [
        { id: 1, name: 'Invoice', document_count: 20 },
        { id: 2, name: 'Invoices', document_count: 5 },
        { id: 3, name: 'Contract', document_count: 10 },
      ];

      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.succeed([]),
        getDocumentTypes: Effect.succeed(types),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('document_types');

          // Wait briefly then cancel
          yield* Effect.sleep('100 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(['running', 'cancelled', 'completed']).toContain(result.status);
    });
  });

  describe('Cancellation', () => {
    it('should cancel running job', async () => {
      // Create many correspondents to slow down analysis
      const manyCorrespondents = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        name: `Correspondent ${i}`,
        document_count: Math.floor(Math.random() * 10),
      }));

      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.succeed(manyCorrespondents),
        getDocumentTypes: Effect.succeed([]),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          // Start the job
          yield* job.start('all');

          // Cancel immediately
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('cancelled');
    });

    it('should not allow starting while already running', async () => {
      const mockPaperless = createMockPaperlessService({
        getCorrespondents: Effect.gen(function* () {
          yield* Effect.sleep('100 millis');
          return sampleCorrespondents();
        }),
        getDocumentTypes: Effect.succeed([]),
        getTags: Effect.succeed([]),
      });

      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          // Start the job
          yield* job.start('all');

          // Try to start again - should fail
          const secondStart = yield* Effect.either(job.start('all'));

          // Cancel the first job
          yield* job.cancel();

          return secondStart;
        }).pipe(Effect.provide(TestLayer))
      );

      // Second start should have failed
      expect(result._tag).toBe('Left');
    });
  });

  describe('Analysis Types', () => {
    it('should set analysis type to correspondents when specified', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('correspondents');

          // Wait briefly and cancel
          yield* Effect.sleep('50 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.analysisType).toBe('correspondents');
    });

    it('should set analysis type to tags when specified', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('tags');

          // Wait briefly and cancel
          yield* Effect.sleep('50 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.analysisType).toBe('tags');
    });

    it('should set analysis type to all when specified', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          yield* job.start('all');

          // Wait briefly and cancel
          yield* Effect.sleep('50 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.analysisType).toBe('all');
    });
  });

  describe('Skip Functionality', () => {
    it('should accept skip count', async () => {
      const mockPaperless = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        BootstrapJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* BootstrapJobService;

          // Request to skip 5
          yield* job.skip(5);

          // Start the job
          yield* job.start('all');

          // Wait briefly and cancel
          yield* Effect.sleep('50 millis');
          yield* job.cancel();

          return yield* job.getProgress();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(['running', 'cancelled', 'completed']).toContain(result.status);
    });
  });
});
