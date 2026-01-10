/**
 * Pending API handlers tests.
 *
 * Tests for pending review management endpoints.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect, Layer } from 'effect';
import * as pendingHandlers from '../../src/api/pending/handlers.js';
import { TinyBaseService } from '../../src/services/TinyBaseService.js';
import { PaperlessService } from '../../src/services/PaperlessService.js';
import { ConfigService } from '../../src/config/index.js';
import { samplePendingReviews, samplePendingCounts } from '../setup.js';

// ===========================================================================
// Mock Services
// ===========================================================================

const createMockConfig = () =>
  Layer.succeed(ConfigService, {
    config: {
      tags: {
        correspondentDone: 'llm-correspondent-done',
        documentTypeDone: 'llm-document-type-done',
        titleDone: 'llm-title-done',
        tagsDone: 'llm-tags-done',
        manualReview: 'llm-manual-review',
      },
    },
  } as unknown as ConfigService);

const createMockTinyBase = (overrides = {}) => {
  const defaultMocks = {
    getPendingReviews: vi.fn(() => Effect.succeed(samplePendingReviews())),
    getPendingCounts: vi.fn(() => Effect.succeed(samplePendingCounts())),
    getPendingReview: vi.fn((id: string) =>
      Effect.succeed(samplePendingReviews().find((r) => r.id === id) ?? null)
    ),
    addPendingReview: vi.fn(() => Effect.succeed(undefined)),
    updatePendingReview: vi.fn(() => Effect.succeed(undefined)),
    removePendingReview: vi.fn(() => Effect.succeed(undefined)),
  };

  const mocks = { ...defaultMocks, ...overrides };

  return {
    layer: Layer.succeed(TinyBaseService, mocks as unknown as TinyBaseService),
    mocks,
  };
};

const createMockPaperless = (overrides = {}) => {
  const defaultMocks = {
    getOrCreateCorrespondent: vi.fn(() => Effect.succeed(1)),
    getOrCreateDocumentType: vi.fn(() => Effect.succeed(1)),
    updateDocument: vi.fn(() => Effect.succeed(undefined)),
    addTagToDocument: vi.fn(() => Effect.succeed(undefined)),
    removeTagFromDocument: vi.fn(() => Effect.succeed(undefined)),
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

describe('Pending Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listPendingItems', () => {
    it('should return all pending items', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();

      const result = await Effect.runPromise(
        pendingHandlers.listPendingItems().pipe(Effect.provide(mockTinyBase))
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'review-1',
        docId: 1,
        type: 'correspondent',
      });
    });

    it('should filter by type when specified', async () => {
      const { layer: mockTinyBase, mocks } = createMockTinyBase({
        getPendingReviews: vi.fn((type?: string) =>
          Effect.succeed(
            type
              ? samplePendingReviews().filter((r) => r.type === type)
              : samplePendingReviews()
          )
        ),
      });

      await Effect.runPromise(
        pendingHandlers.listPendingItems('correspondent').pipe(
          Effect.provide(mockTinyBase)
        )
      );

      expect(mocks.getPendingReviews).toHaveBeenCalledWith('correspondent');
    });

    it('should map items to PendingItem format', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();

      const result = await Effect.runPromise(
        pendingHandlers.listPendingItems().pipe(Effect.provide(mockTinyBase))
      );

      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('docId');
      expect(result[0]).toHaveProperty('docTitle');
      expect(result[0]).toHaveProperty('type');
      expect(result[0]).toHaveProperty('suggestion');
      expect(result[0]).toHaveProperty('reasoning');
      expect(result[0]).toHaveProperty('alternatives');
      expect(result[0]).toHaveProperty('attempts');
      expect(result[0]).toHaveProperty('lastFeedback');
      expect(result[0]).toHaveProperty('createdAt');
    });
  });

  describe('getPendingCounts', () => {
    it('should return counts by type', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();

      const result = await Effect.runPromise(
        pendingHandlers.getPendingCounts.pipe(Effect.provide(mockTinyBase))
      );

      expect(result).toMatchObject({
        correspondent: 3,
        document_type: 2,
        tag: 1,
        total: 6,
      });
    });
  });

  describe('getPendingItem', () => {
    it('should return single pending item', async () => {
      const { layer: mockTinyBase } = createMockTinyBase();

      const result = await Effect.runPromise(
        pendingHandlers.getPendingItem('review-1').pipe(
          Effect.provide(mockTinyBase)
        )
      );

      expect(result).toMatchObject({
        id: 'review-1',
        docId: 1,
        type: 'correspondent',
      });
    });

    it('should fail with NotFoundError for unknown id', async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(null)),
      });

      const result = await Effect.runPromise(
        pendingHandlers.getPendingItem('unknown-id').pipe(
          Effect.provide(mockTinyBase),
          Effect.catchAll((e) => Effect.succeed({ error: e }))
        )
      );

      expect(result).toHaveProperty('error');
      expect((result as any).error._tag).toBe('NotFoundError');
    });
  });

  describe('approvePendingItem', () => {
    it('should approve correspondent suggestion', async () => {
      const review = {
        id: 'review-1',
        docId: 1,
        type: 'correspondent' as const,
        suggestion: 'Test Corp',
        nextTag: 'llm-correspondent-done',
      };

      const { layer: mockTinyBase, mocks: tinyMocks } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-1', {}).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(result).toEqual({ success: true });
      expect(paperlessMocks.getOrCreateCorrespondent).toHaveBeenCalledWith('Test Corp');
      expect(paperlessMocks.updateDocument).toHaveBeenCalled();
      expect(tinyMocks.removePendingReview).toHaveBeenCalledWith('review-1');
    });

    it('should use custom value if provided', async () => {
      const review = {
        id: 'review-1',
        docId: 1,
        type: 'correspondent' as const,
        suggestion: 'Original Corp',
        nextTag: 'llm-correspondent-done',
      };

      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-1', { value: 'Custom Corp' }).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(paperlessMocks.getOrCreateCorrespondent).toHaveBeenCalledWith('Custom Corp');
    });

    it('should approve document_type suggestion', async () => {
      const review = {
        id: 'review-2',
        docId: 2,
        type: 'document_type' as const,
        suggestion: 'Invoice',
        nextTag: 'llm-document-type-done',
      };

      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-2', {}).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(paperlessMocks.getOrCreateDocumentType).toHaveBeenCalledWith('Invoice');
    });

    it('should approve title suggestion', async () => {
      const review = {
        id: 'review-3',
        docId: 3,
        type: 'title' as const,
        suggestion: 'New Title',
        nextTag: 'llm-title-done',
      };

      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-3', {}).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(3, { title: 'New Title' });
    });

    it('should approve tag suggestion', async () => {
      const review = {
        id: 'review-4',
        docId: 4,
        type: 'tag' as const,
        suggestion: 'important',
        nextTag: 'llm-tags-done',
      };

      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-4', {}).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(paperlessMocks.addTagToDocument).toHaveBeenCalledWith(4, 'important');
    });

    it('should add next tag after approval', async () => {
      const review = {
        id: 'review-1',
        docId: 1,
        type: 'correspondent' as const,
        suggestion: 'Test',
        nextTag: 'llm-next-step',
      };

      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      await Effect.runPromise(
        pendingHandlers.approvePendingItem('review-1', {}).pipe(
          Effect.provide(TestLayer)
        )
      );

      expect(paperlessMocks.addTagToDocument).toHaveBeenCalledWith(1, 'llm-next-step');
    });

    it('should fail with NotFoundError for unknown id', async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(null)),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.approvePendingItem('unknown', {}).pipe(
          Effect.provide(TestLayer),
          Effect.catchAll((e) => Effect.succeed({ error: e }))
        )
      );

      expect((result as any).error._tag).toBe('NotFoundError');
    });
  });

  describe('rejectPendingItem', () => {
    it('should reject and remove pending item', async () => {
      const review = {
        id: 'review-1',
        docId: 1,
        type: 'correspondent' as const,
        suggestion: 'Test',
        attempts: 1,
      };

      const { layer: mockTinyBase, mocks: tinyMocks } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(review)),
      });
      const { layer: mockPaperless, mocks: paperlessMocks } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.rejectPendingItem('review-1', {
          feedback: 'Try a different approach',
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result).toEqual({ success: true });
      expect(paperlessMocks.addTagToDocument).toHaveBeenCalledWith(1, 'llm-manual-review');
      expect(tinyMocks.removePendingReview).toHaveBeenCalledWith('review-1');
    });

    it('should fail with NotFoundError for unknown id', async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(null)),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.rejectPendingItem('unknown', { feedback: 'test' }).pipe(
          Effect.provide(TestLayer),
          Effect.catchAll((e) => Effect.succeed({ error: e }))
        )
      );

      expect((result as any).error._tag).toBe('NotFoundError');
    });
  });

  describe('getSimilarItems', () => {
    it('should return empty array when no similar groups', async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getSimilarGroups: vi.fn(() => Effect.succeed([])),
      });

      const result = await Effect.runPromise(
        pendingHandlers.getSimilarItems.pipe(Effect.provide(mockTinyBase))
      );

      expect(result).toEqual([]);
    });
  });

  describe('bulkAction', () => {
    it('should process multiple approvals', async () => {
      const reviews = [
        {
          id: '1',
          docId: 1,
          type: 'correspondent' as const,
          suggestion: 'Corp A',
          nextTag: 'llm-done',
        },
        {
          id: '2',
          docId: 2,
          type: 'correspondent' as const,
          suggestion: 'Corp B',
          nextTag: 'llm-done',
        },
      ];

      const { layer: mockTinyBase, mocks: tinyMocks } = createMockTinyBase({
        getPendingReview: vi.fn((id: string) =>
          Effect.succeed(reviews.find((r) => r.id === id) ?? null)
        ),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.bulkAction({
          ids: ['1', '2'],
          action: 'approve',
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.processed).toBe(2);
      expect(tinyMocks.removePendingReview).toHaveBeenCalledTimes(2);
    });

    it('should process multiple rejections', async () => {
      const reviews = [
        { id: '1', docId: 1, type: 'correspondent' as const, suggestion: 'Test' },
        { id: '2', docId: 2, type: 'correspondent' as const, suggestion: 'Test' },
      ];

      const { layer: mockTinyBase, mocks: tinyMocks } = createMockTinyBase({
        getPendingReview: vi.fn((id: string) =>
          Effect.succeed(reviews.find((r) => r.id === id) ?? null)
        ),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.bulkAction({
          ids: ['1', '2'],
          action: 'reject',
          feedback: 'Rejected all',
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.processed).toBe(2);
    });

    it('should count failures', async () => {
      const { layer: mockTinyBase } = createMockTinyBase({
        getPendingReview: vi.fn(() => Effect.succeed(null)),
      });
      const { layer: mockPaperless } = createMockPaperless();
      const mockConfig = createMockConfig();

      const TestLayer = Layer.mergeAll(mockTinyBase, mockPaperless, mockConfig);

      const result = await Effect.runPromise(
        pendingHandlers.bulkAction({
          ids: ['unknown-1', 'unknown-2'],
          action: 'approve',
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result.failed).toBe(2);
    });
  });
});
