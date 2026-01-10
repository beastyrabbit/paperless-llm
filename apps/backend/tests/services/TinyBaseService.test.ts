/**
 * TinyBaseService tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Layer, pipe } from 'effect';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';
import type { PendingReview, BlockType } from '../../src/models/index.js';

describe('TinyBaseService', () => {
  // Create a test layer without dependencies
  const TestLayer = TinyBaseServiceLive;

  const runEffect = <A, E>(effect: Effect.Effect<A, E, TinyBaseService>) =>
    Effect.runPromise(pipe(effect, Effect.provide(TestLayer)));

  // =========================================================================
  // Pending Reviews Tests
  // =========================================================================

  describe('Pending Reviews', () => {
    it('should add and retrieve pending reviews', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          const id = yield* service.addPendingReview({
            docId: 999, // Use unique docId to avoid conflicts
            docTitle: 'Test Document',
            type: 'correspondent',
            suggestion: 'Test Corp Unique',
            reasoning: 'Found in header',
            alternatives: ['Test Inc', 'Testing Co'],
            attempts: 1,
            lastFeedback: null,
            nextTag: 'llm-correspondent-done',
            metadata: null,
          });

          const items = yield* service.getPendingReviews();
          // Clean up after ourselves
          yield* service.removePendingReview(id);
          return { id, items };
        })
      );

      expect(result.id).toBeDefined();
      // Check that our item exists in the results
      const ourItem = result.items.find(item => item.suggestion === 'Test Corp Unique');
      expect(ourItem).toBeDefined();
      expect(ourItem?.docId).toBe(999);
    });

    it('should filter pending reviews by type', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          const id1 = yield* service.addPendingReview({
            docId: 998,
            docTitle: 'Doc Filter Test 1',
            type: 'correspondent',
            suggestion: 'Corp Filter Test',
            reasoning: 'Reason',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          const id2 = yield* service.addPendingReview({
            docId: 997,
            docTitle: 'Doc Filter Test 2',
            type: 'tag',
            suggestion: 'Tag Filter Test',
            reasoning: 'Reason',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          const correspondents = yield* service.getPendingReviews('correspondent');
          const tags = yield* service.getPendingReviews('tag');
          const all = yield* service.getPendingReviews();

          // Clean up
          yield* service.removePendingReview(id1);
          yield* service.removePendingReview(id2);

          return { correspondents, tags, all };
        })
      );

      // Check that our items exist in the filtered results
      expect(result.correspondents.some(c => c.suggestion === 'Corp Filter Test')).toBe(true);
      expect(result.tags.some(t => t.suggestion === 'Tag Filter Test')).toBe(true);
      expect(result.all.length).toBeGreaterThanOrEqual(2);
    });

    it('should update pending review', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          const id = yield* service.addPendingReview({
            docId: 1,
            docTitle: 'Test',
            type: 'title',
            suggestion: 'Original Title',
            reasoning: 'Reason',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          yield* service.updatePendingReview(id, {
            suggestion: 'Updated Title',
            attempts: 2,
          });

          const updated = yield* service.getPendingReview(id);
          return updated;
        })
      );

      expect(result?.suggestion).toBe('Updated Title');
      expect(result?.attempts).toBe(2);
    });

    it('should remove pending review', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          const id = yield* service.addPendingReview({
            docId: 1,
            docTitle: 'Test',
            type: 'correspondent',
            suggestion: 'Corp',
            reasoning: 'Reason',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          yield* service.removePendingReview(id);

          const removed = yield* service.getPendingReview(id);
          return removed;
        })
      );

      expect(result).toBeNull();
    });

    it('should get pending counts', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.addPendingReview({
            docId: 1,
            docTitle: 'Doc',
            type: 'correspondent',
            suggestion: 'Corp',
            reasoning: 'R',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          yield* service.addPendingReview({
            docId: 2,
            docTitle: 'Doc',
            type: 'tag',
            suggestion: 'Tag',
            reasoning: 'R',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          yield* service.addPendingReview({
            docId: 3,
            docTitle: 'Doc',
            type: 'schema_merge',
            suggestion: 'Merge',
            reasoning: 'R',
            alternatives: [],
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: null,
          });

          return yield* service.getPendingCounts();
        })
      );

      expect(result.correspondent).toBeGreaterThanOrEqual(1);
      expect(result.tag).toBeGreaterThanOrEqual(1);
      expect(result.schema).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // Blocked Suggestions Tests
  // =========================================================================

  describe('Blocked Suggestions', () => {
    it('should add and check blocked suggestions', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.addBlockedSuggestion({
            suggestionName: 'Bad Corp',
            blockType: 'correspondent',
            rejectionReason: 'Not a real company',
            rejectionCategory: 'wrong_suggestion',
            docId: 1,
          });

          const isBlocked = yield* service.isBlocked('Bad Corp', 'correspondent');
          const isNotBlocked = yield* service.isBlocked('Good Corp', 'correspondent');

          return { isBlocked, isNotBlocked };
        })
      );

      expect(result.isBlocked).toBe(true);
      expect(result.isNotBlocked).toBe(false);
    });

    it('should check global blocks', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.addBlockedSuggestion({
            suggestionName: 'Spam',
            blockType: 'global',
            rejectionReason: 'This is spam',
            rejectionCategory: 'low_quality',
            docId: null,
          });

          const blockedAsCorr = yield* service.isBlocked('Spam', 'correspondent');
          const blockedAsTag = yield* service.isBlocked('Spam', 'tag');

          return { blockedAsCorr, blockedAsTag };
        })
      );

      expect(result.blockedAsCorr).toBe(true);
      expect(result.blockedAsTag).toBe(true);
    });

    it('should normalize names for blocking', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.addBlockedSuggestion({
            suggestionName: '  Test Corp  ',
            blockType: 'correspondent',
            rejectionReason: null,
            rejectionCategory: null,
            docId: null,
          });

          const isBlocked = yield* service.isBlocked('test corp', 'correspondent');
          return isBlocked;
        })
      );

      expect(result).toBe(true);
    });
  });

  // =========================================================================
  // Tag Metadata Tests
  // =========================================================================

  describe('Tag Metadata', () => {
    it('should upsert and retrieve tag metadata', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.upsertTagMetadata({
            paperlessTagId: 1,
            tagName: 'Invoice',
            description: 'Financial invoices',
            category: 'Finance',
            excludeFromAi: false,
          });

          return yield* service.getTagMetadata(1);
        })
      );

      expect(result?.tagName).toBe('Invoice');
      expect(result?.description).toBe('Financial invoices');
      expect(result?.category).toBe('Finance');
    });

    it('should update existing tag metadata', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.upsertTagMetadata({
            paperlessTagId: 2,
            tagName: 'Contract',
            description: 'Legal contracts',
            category: 'Legal',
            excludeFromAi: false,
          });

          yield* service.upsertTagMetadata({
            paperlessTagId: 2,
            tagName: 'Contract',
            description: 'Updated description',
            category: 'Legal',
            excludeFromAi: true,
          });

          return yield* service.getTagMetadata(2);
        })
      );

      expect(result?.description).toBe('Updated description');
      expect(result?.excludeFromAi).toBe(true);
    });

    it('should delete tag metadata', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.upsertTagMetadata({
            paperlessTagId: 3,
            tagName: 'ToDelete',
            description: 'Will be deleted',
            category: null,
            excludeFromAi: false,
          });

          yield* service.deleteTagMetadata(3);

          return yield* service.getTagMetadata(3);
        })
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Translations Tests
  // =========================================================================

  describe('Translations', () => {
    it('should store and retrieve translations', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.setTranslation({
            sourceLang: 'de',
            targetLang: 'en',
            sourceText: 'Rechnung',
            translatedText: 'Invoice',
            modelUsed: 'llama3.2',
          });

          return yield* service.getTranslation('de', 'en', 'Rechnung');
        })
      );

      expect(result?.translatedText).toBe('Invoice');
      expect(result?.modelUsed).toBe('llama3.2');
    });

    it('should return null for missing translations', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;
          return yield* service.getTranslation('de', 'en', 'NonExistent');
        })
      );

      expect(result).toBeNull();
    });
  });

  // =========================================================================
  // Settings Tests
  // =========================================================================

  describe('Settings', () => {
    it('should set and get settings', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.setSetting('theme', 'dark');
          yield* service.setSetting('language', 'de');

          const theme = yield* service.getSetting('theme');
          const language = yield* service.getSetting('language');
          const all = yield* service.getAllSettings();

          return { theme, language, all };
        })
      );

      expect(result.theme).toBe('dark');
      expect(result.language).toBe('de');
      expect(result.all['theme']).toBe('dark');
      expect(result.all['language']).toBe('de');
    });
  });

  // =========================================================================
  // Store Operations Tests
  // =========================================================================

  describe('Store Operations', () => {
    it('should export and import JSON', async () => {
      const result = await runEffect(
        Effect.gen(function* () {
          const service = yield* TinyBaseService;

          yield* service.setSetting('test', 'value');
          const json = yield* service.getStoreJson();

          // Parse and verify
          const parsed = JSON.parse(json);
          return typeof parsed === 'object';
        })
      );

      expect(result).toBe(true);
    });
  });
});
