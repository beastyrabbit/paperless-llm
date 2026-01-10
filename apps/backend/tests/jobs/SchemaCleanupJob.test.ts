/**
 * SchemaCleanupJob tests.
 *
 * Tests for the schema cleanup job that applies approved schema changes
 * (merges, deletes) for correspondents, document types, and tags.
 */
import { describe, it, expect, vi } from 'vitest';
import { Effect, Layer } from 'effect';
import { SchemaCleanupJobService, SchemaCleanupJobServiceLive } from '../../src/jobs/SchemaCleanupJob.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockPaperlessService = (overrides = {}) => {
  const defaultMocks = {
    mergeCorrespondents: vi.fn(() => Effect.succeed(undefined)),
    mergeDocumentTypes: vi.fn(() => Effect.succeed(undefined)),
    mergeTags: vi.fn(() => Effect.succeed(undefined)),
    deleteCorrespondent: vi.fn(() => Effect.succeed(undefined)),
    deleteDocumentType: vi.fn(() => Effect.succeed(undefined)),
    deleteTag: vi.fn(() => Effect.succeed(undefined)),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

// ===========================================================================
// Test Suites
// ===========================================================================

describe('SchemaCleanupJobService', () => {
  describe('Status Tracking', () => {
    it('should start with idle status', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          return yield* job.getStatus();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status).toBe('idle');
      expect(result.total).toBe(0);
      expect(result.processed).toBe(0);
    });

    it('should track progress during cleanup', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a schema merge pending review
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Merge Corp A into Corp B',
            type: 'schema_merge',
            suggestion: 'Merge Corp A into Corp B',
            reasoning: 'Similar names',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'correspondent',
              sourceId: 1,
              targetId: 2,
            }),
          });

          // Run the cleanup
          const jobResult = yield* job.run();
          const status = yield* job.getStatus();

          return { jobResult, status };
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.status.status).toBe('completed');
      expect(result.status.startedAt).toBeTruthy();
      expect(result.status.completedAt).toBeTruthy();
    });
  });

  describe('Merge Operations', () => {
    it('should merge correspondents', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a correspondent merge request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Merge Corp A into Corp B',
            type: 'schema_merge',
            suggestion: 'Merge Corp A into Corp B',
            reasoning: 'Similar names',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'correspondent',
              sourceId: 1,
              targetId: 2,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.merged).toBe(1);
      expect(mocks.mergeCorrespondents).toHaveBeenCalledWith(1, 2);
    });

    it('should merge document types', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a document type merge request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Merge Invoice into Invoices',
            type: 'schema_merge',
            suggestion: 'Merge Invoice into Invoices',
            reasoning: 'Duplicate types',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'document_type',
              sourceId: 5,
              targetId: 6,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.merged).toBe(1);
      expect(mocks.mergeDocumentTypes).toHaveBeenCalledWith(5, 6);
    });

    it('should merge tags', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a tag merge request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Merge urgent into important',
            type: 'schema_merge',
            suggestion: 'Merge urgent into important',
            reasoning: 'Same meaning',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'tag',
              sourceId: 10,
              targetId: 20,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.merged).toBe(1);
      expect(mocks.mergeTags).toHaveBeenCalledWith(10, 20);
    });
  });

  describe('Delete Operations', () => {
    it('should delete correspondent', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a correspondent delete request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Delete Unused Corp',
            type: 'schema_delete',
            suggestion: 'Delete Unused Corp',
            reasoning: 'No documents',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'correspondent',
              sourceId: 99,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.deleted).toBe(1);
      expect(mocks.deleteCorrespondent).toHaveBeenCalledWith(99);
    });

    it('should delete document type', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a document type delete request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Delete Unused Type',
            type: 'schema_delete',
            suggestion: 'Delete Unused Type',
            reasoning: 'No documents',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'document_type',
              sourceId: 50,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.deleted).toBe(1);
      expect(mocks.deleteDocumentType).toHaveBeenCalledWith(50);
    });

    it('should delete tag', async () => {
      const { layer: mockPaperless, mocks } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a tag delete request
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Delete unused tag',
            type: 'schema_delete',
            suggestion: 'Delete unused tag',
            reasoning: 'No documents',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'tag',
              sourceId: 30,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.deleted).toBe(1);
      expect(mocks.deleteTag).toHaveBeenCalledWith(30);
    });
  });

  describe('Error Handling', () => {
    it('should track errors in progress', async () => {
      // Note: Error handling behavior depends on implementation details
      // This test verifies the basic structure is maintained
      const { layer: mockPaperless } = createMockPaperlessService();

      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add an item with invalid metadata (missing entityType)
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Invalid metadata',
            type: 'schema_merge',
            suggestion: 'Invalid metadata',
            reasoning: 'Test',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              // Missing entityType - should cause error
              sourceId: 1,
              targetId: 2,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      // Should have counted errors for missing entity type
      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it('should skip items with missing metadata', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add an item without metadata
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'No metadata',
            type: 'schema_merge',
            suggestion: 'No metadata',
            reasoning: 'Test',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.errors).toBeGreaterThanOrEqual(1);
    });

    it('should skip items with unknown entity type', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add an item with unknown entity type
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Unknown type',
            type: 'schema_merge',
            suggestion: 'Unknown type',
            reasoning: 'Test',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'unknown_type',
              sourceId: 1,
              targetId: 2,
            }),
          });

          return yield* job.run();
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.errors).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Pending Review Cleanup', () => {
    it('should remove processed items from pending reviews', async () => {
      const { layer: mockPaperless } = createMockPaperlessService();
      const TestLayer = Layer.provideMerge(
        SchemaCleanupJobServiceLive,
        Layer.merge(mockPaperless, TinyBaseServiceLive)
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const job = yield* SchemaCleanupJobService;
          const tinybase = yield* TinyBaseService;

          // Add a merge request
          const id = yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Merge Corp A into Corp B',
            type: 'schema_merge',
            suggestion: 'Merge Corp A into Corp B',
            reasoning: 'Similar names',
            alternatives: [],
            attempts: 0,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              entityType: 'correspondent',
              sourceId: 1,
              targetId: 2,
            }),
          });

          // Run cleanup
          yield* job.run();

          // Check if item was removed
          const remaining = yield* tinybase.getPendingReview(id);
          return remaining;
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result).toBeNull();
    });
  });
});
