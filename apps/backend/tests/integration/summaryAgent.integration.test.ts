/**
 * Integration test for Summary Agent.
 *
 * This test verifies that the summary agent:
 * 1. Generates a summary from document content
 * 2. Adds the summary as a note to the document
 * 3. Transitions the document tag from ocr-done to summary-done
 *
 * IMPORTANT: This test requires:
 * - A running Paperless instance
 * - A running Ollama instance with a large model configured
 * - Document 505 to exist with content
 *
 * Run with: pnpm test -- tests/integration/summaryAgent.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Effect, Layer, pipe } from 'effect';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';
import { PaperlessService, PaperlessServiceLive } from '../../src/services/PaperlessService.js';
import { OllamaServiceLive } from '../../src/services/OllamaService.js';
import { MistralServiceLive } from '../../src/services/MistralService.js';
import { PromptServiceLive } from '../../src/services/PromptService.js';
import { QdrantServiceLive } from '../../src/services/QdrantService.js';
import { SummaryAgentService, SummaryAgentServiceLive } from '../../src/agents/SummaryAgentGraph.js';
import { ConfigServiceLive } from '../../src/config/index.js';
import { originalFetch } from '../setup.js';

// Restore real fetch for integration tests (setup.ts mocks it)
vi.stubGlobal('fetch', originalFetch);

const TEST_DOC_ID = 505;

// Tag names from config (these should match your config.yaml)
const TAG_OCR_DONE = 'llm-ocr-done';
const TAG_SUMMARY_DONE = 'llm-summary-done';

interface DocumentSnapshot {
  id: number;
  title: string;
  tags: number[];
  notes: Array<{ id: number; note: string; created: string }>;
}

describe('Summary Agent Integration', () => {
  let originalSnapshot: DocumentSnapshot | null = null;
  let ocrDoneTagId: number | null = null;
  let summaryDoneTagId: number | null = null;

  // Build layer with correct config path (relative to apps/backend)
  const ConfigLayer = ConfigServiceLive('../../config.yaml');

  // Layer 1+2: Config + TinyBase
  const FoundationLayer = Layer.provideMerge(TinyBaseServiceLive, ConfigLayer);

  // Layer 3: Base services on top of foundation
  const BaseServicesLayer = Layer.provideMerge(
    Layer.mergeAll(
      OllamaServiceLive,
      MistralServiceLive,
      PromptServiceLive
    ),
    FoundationLayer
  );

  // Layer 4: Paperless + Qdrant need TinyBase + Config (and Qdrant needs Ollama)
  const CoreServicesLayer = Layer.provideMerge(
    Layer.mergeAll(
      PaperlessServiceLive,
      QdrantServiceLive
    ),
    BaseServicesLayer
  );

  // Layer 5: SummaryAgent needs everything
  const IntegrationTestLayer = Layer.provideMerge(
    SummaryAgentServiceLive,
    CoreServicesLayer
  );

  const runEffect = <A, E>(effect: Effect.Effect<A, E, TinyBaseService | PaperlessService | SummaryAgentService>) =>
    Effect.runPromise(pipe(effect, Effect.provide(IntegrationTestLayer)));

  // Save original document state before tests
  beforeAll(async () => {
    try {
      const snapshot = await runEffect(
        Effect.gen(function* () {
          const paperless = yield* PaperlessService;

          // Get document current state
          const doc = yield* paperless.getDocument(TEST_DOC_ID);

          // Get existing notes
          const notes = yield* paperless.getNotes(TEST_DOC_ID);

          // Get tag IDs for the processing tags
          const tags = yield* paperless.getTags();
          const ocrTag = tags.find(t => t.name === TAG_OCR_DONE);
          const summaryTag = tags.find(t => t.name === TAG_SUMMARY_DONE);

          return {
            doc: {
              id: doc.id,
              title: doc.title ?? '',
              tags: [...(doc.tags ?? [])],
              notes,
            },
            ocrDoneTagId: ocrTag?.id ?? null,
            summaryDoneTagId: summaryTag?.id ?? null,
          };
        })
      );

      originalSnapshot = snapshot.doc;
      ocrDoneTagId = snapshot.ocrDoneTagId;
      summaryDoneTagId = snapshot.summaryDoneTagId;

      console.log('Original document state saved:', {
        ...originalSnapshot,
        notesCount: originalSnapshot.notes.length,
      });
      console.log('Tag IDs - ocr_done:', ocrDoneTagId, 'summary_done:', summaryDoneTagId);
    } catch (error) {
      console.error('Failed to save original document state:', error);
      throw error;
    }
  });

  // Restore document state after tests
  afterAll(async () => {
    if (!originalSnapshot) {
      console.log('No snapshot to restore');
      return;
    }

    try {
      await runEffect(
        Effect.gen(function* () {
          const paperless = yield* PaperlessService;

          console.log('Restoring document to original state...');

          // Restore document tags
          yield* paperless.updateDocument(TEST_DOC_ID, {
            tags: originalSnapshot!.tags,
          });

          // Note: We can't easily delete notes via API, so we just log it
          console.log('Document tags restored. Notes may need manual cleanup if needed.');
        })
      );
    } catch (error) {
      console.error('Failed to restore document state:', error);
      // Don't throw - we want the test results even if cleanup fails
    }
  });

  it('should generate summary and add it as a note to document 505', async () => {
    if (!ocrDoneTagId) {
      console.log('Skipping test - ocr_done tag not found');
      return;
    }

    const result = await runEffect(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const tinybase = yield* TinyBaseService;
        const summaryAgent = yield* SummaryAgentService;

        // Step 1: Get initial state
        const notesBefore = yield* paperless.getNotes(TEST_DOC_ID);
        console.log('Notes before processing:', notesBefore.length);

        // Step 2: Set document to ocr_done state for the test
        const currentDoc = yield* paperless.getDocument(TEST_DOC_ID);
        const currentTags = [...(currentDoc.tags ?? [])];

        // Remove summary_done tag if present, add ocr_done tag
        let newTags = currentTags.filter(t => t !== summaryDoneTagId);
        if (ocrDoneTagId && !newTags.includes(ocrDoneTagId)) {
          newTags.push(ocrDoneTagId);
        }

        yield* paperless.updateDocument(TEST_DOC_ID, { tags: newTags });
        console.log('Set document to ocr_done state');

        // Step 3: Get document content
        const doc = yield* paperless.getDocument(TEST_DOC_ID);
        const content = doc.content ?? '';
        console.log('Document content length:', content.length);

        if (content.length === 0) {
          console.warn('WARNING: Document has no content. Summary may fail.');
        }

        // Step 4: Run summary agent
        console.log('Running summary agent...');
        const agentResult = yield* summaryAgent.process({
          docId: TEST_DOC_ID,
          content,
        });
        console.log('Agent result:', {
          success: agentResult.success,
          summaryLength: agentResult.summaryLength,
          summary: agentResult.summary?.slice(0, 200) + (agentResult.summary?.length > 200 ? '...' : ''),
        });

        // Step 5: Verify notes were added
        const notesAfter = yield* paperless.getNotes(TEST_DOC_ID);
        console.log('Notes after processing:', notesAfter.length);

        // Find new notes (notes created after the test started)
        const newNotes = notesAfter.filter(n => !notesBefore.some(b => b.id === n.id));
        console.log('New notes added:', newNotes.length);

        if (newNotes.length > 0) {
          console.log('New note content preview:', newNotes[0].note.slice(0, 200));
        }

        // Step 6: Check if tag was updated (check by tag ID)
        const docAfterProcessing = yield* paperless.getDocument(TEST_DOC_ID);
        const tagsAfterIds = docAfterProcessing.tags ?? [];
        const hasSummaryDoneTag = summaryDoneTagId ? tagsAfterIds.includes(summaryDoneTagId) : false;
        console.log('Document tag IDs after processing:', tagsAfterIds);
        console.log('Has summary_done tag (ID:', summaryDoneTagId, '):', hasSummaryDoneTag);

        // Step 7: Check processing logs
        const logs = yield* tinybase.getProcessingLogs(TEST_DOC_ID);
        const summaryLogs = logs.filter(l => l.step === 'summary');
        console.log('Summary processing logs:', summaryLogs.length);

        return {
          agentSuccess: agentResult.success,
          summary: agentResult.summary,
          summaryLength: agentResult.summaryLength,
          notesBefore: notesBefore.length,
          notesAfter: notesAfter.length,
          newNotesCount: newNotes.length,
          newNoteContent: newNotes.length > 0 ? newNotes[0].note : null,
          tagTransitioned: hasSummaryDoneTag,
          logsCreated: summaryLogs.length,
        };
      })
    );

    // Assertions
    console.log('\n=== TEST RESULTS ===');
    console.log('Agent success:', result.agentSuccess);
    console.log('Summary length:', result.summaryLength);
    console.log('Notes before:', result.notesBefore);
    console.log('Notes after:', result.notesAfter);
    console.log('New notes count:', result.newNotesCount);
    console.log('Tag transitioned:', result.tagTransitioned);
    console.log('Logs created:', result.logsCreated);

    // Verify agent succeeded
    expect(result.agentSuccess).toBe(true);

    // Verify summary was generated
    expect(result.summary).toBeTruthy();
    expect(result.summaryLength).toBeGreaterThan(0);

    // Verify a new note was added
    expect(result.newNotesCount).toBeGreaterThan(0);

    // Verify note content matches the summary
    if (result.newNoteContent) {
      expect(result.newNoteContent).toContain(result.summary?.slice(0, 50));
    }

    // Verify tag was transitioned
    expect(result.tagTransitioned).toBe(true);

    // Verify processing logs were created
    expect(result.logsCreated).toBeGreaterThan(0);
  }, 180000); // 3 minute timeout for LLM processing
});
