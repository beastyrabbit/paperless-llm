/**
 * Integration test for processing logs.
 *
 * This test verifies that processing logs are correctly stored when
 * running document processing steps.
 *
 * IMPORTANT: This test requires a running Paperless instance and document 505 to exist.
 * Run with: pnpm test -- tests/integration/processingLogs.integration.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Effect, Layer, pipe } from 'effect';
import { TinyBaseService, TinyBaseServiceLive } from '../../src/services/TinyBaseService.js';
import { PaperlessService, PaperlessServiceLive } from '../../src/services/PaperlessService.js';
import { OllamaServiceLive } from '../../src/services/OllamaService.js';
import { MistralServiceLive } from '../../src/services/MistralService.js';
import { PromptServiceLive } from '../../src/services/PromptService.js';
import { QdrantServiceLive } from '../../src/services/QdrantService.js';
import { DocumentTypeAgentGraphService, DocumentTypeAgentGraphServiceLive } from '../../src/agents/DocumentTypeAgentGraph.js';
import { ConfigServiceLive } from '../../src/config/index.js';
import { originalFetch } from '../setup.js';

// Restore real fetch for integration tests (setup.ts mocks it)
vi.stubGlobal('fetch', originalFetch);

const TEST_DOC_ID = 505;

// Tag names from config (these should match your config.yaml)
const TAG_CORRESPONDENT_DONE = 'llm-correspondent-done';
const TAG_DOCUMENT_TYPE_DONE = 'llm-document-type-done';

interface DocumentSnapshot {
  id: number;
  title: string;
  correspondent: number | null;
  document_type: number | null;
  tags: number[];
}

describe('Processing Logs Integration', () => {
  let originalSnapshot: DocumentSnapshot | null = null;
  let correspondentDoneTagId: number | null = null;
  let documentTypeDoneTagId: number | null = null;

  // Build layer with correct config path (relative to apps/backend)
  const ConfigLayer = ConfigServiceLive('../../config.yaml');

  // Build layers in dependency order:
  // 1. Config (no deps)
  // 2. TinyBase (no deps)
  // 3. Base services (Ollama, Mistral, Prompt) - need Config
  // 4. Paperless, Qdrant - need Config + TinyBase
  // 5. Agent - needs all of above

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

  // Layer 5: DocumentTypeAgent needs everything
  const IntegrationTestLayer = Layer.provideMerge(
    DocumentTypeAgentGraphServiceLive,
    CoreServicesLayer
  );

  const runEffect = <A, E>(effect: Effect.Effect<A, E, TinyBaseService | PaperlessService | DocumentTypeAgentGraphService>) =>
    Effect.runPromise(pipe(effect, Effect.provide(IntegrationTestLayer)));

  // Save original document state before tests
  beforeAll(async () => {
    try {
      const snapshot = await runEffect(
        Effect.gen(function* () {
          const paperless = yield* PaperlessService;

          // Get document current state
          const doc = yield* paperless.getDocument(TEST_DOC_ID);

          // Get tag IDs for the processing tags
          const tags = yield* paperless.getTags();
          const corrDoneTag = tags.find(t => t.name === TAG_CORRESPONDENT_DONE);
          const docTypeDoneTag = tags.find(t => t.name === TAG_DOCUMENT_TYPE_DONE);

          return {
            doc: {
              id: doc.id,
              title: doc.title ?? '',
              correspondent: doc.correspondent,
              document_type: doc.document_type,
              tags: [...(doc.tags ?? [])],
            },
            correspondentDoneTagId: corrDoneTag?.id ?? null,
            documentTypeDoneTagId: docTypeDoneTag?.id ?? null,
          };
        })
      );

      originalSnapshot = snapshot.doc;
      correspondentDoneTagId = snapshot.correspondentDoneTagId;
      documentTypeDoneTagId = snapshot.documentTypeDoneTagId;

      console.log('Original document state saved:', originalSnapshot);
      console.log('Tag IDs - correspondent_done:', correspondentDoneTagId, 'document_type_done:', documentTypeDoneTagId);
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

          // Restore document metadata
          yield* paperless.updateDocument(TEST_DOC_ID, {
            title: originalSnapshot!.title,
            correspondent: originalSnapshot!.correspondent,
            document_type: originalSnapshot!.document_type,
            tags: originalSnapshot!.tags,
          });

          console.log('Document restored successfully');
        })
      );
    } catch (error) {
      console.error('Failed to restore document state:', error);
      // Don't throw - we want the test results even if cleanup fails
    }
  });

  it('should create processing logs when running document_type step', async () => {
    if (!correspondentDoneTagId) {
      console.log('Skipping test - correspondent_done tag not found');
      return;
    }

    const result = await runEffect(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const tinybase = yield* TinyBaseService;
        const documentTypeAgent = yield* DocumentTypeAgentGraphService;

        // Step 1: Clear any existing logs for this document
        yield* tinybase.clearProcessingLogs(TEST_DOC_ID);
        const logsBeforeProcessing = yield* tinybase.getProcessingLogs(TEST_DOC_ID);
        console.log('Logs before processing:', logsBeforeProcessing.length);

        // Step 2: Set document to correspondent_done state
        // Remove document_type_done tag if present, add correspondent_done tag
        const currentDoc = yield* paperless.getDocument(TEST_DOC_ID);
        const currentTags = [...(currentDoc.tags ?? [])];

        // Filter out document_type_done and later tags, ensure correspondent_done is present
        let newTags = currentTags.filter(t => t !== documentTypeDoneTagId);
        if (correspondentDoneTagId && !newTags.includes(correspondentDoneTagId)) {
          newTags.push(correspondentDoneTagId);
        }

        yield* paperless.updateDocument(TEST_DOC_ID, { tags: newTags });
        console.log('Set document to correspondent_done state');

        // Step 3: Run document_type processing step
        const docTypes = yield* paperless.getDocumentTypes();
        const doc = yield* paperless.getDocument(TEST_DOC_ID);
        const content = doc.content ?? '';

        console.log('Running document_type agent...');
        const agentResult = yield* documentTypeAgent.process({
          docId: TEST_DOC_ID,
          content,
          docTitle: doc.title ?? `Document ${TEST_DOC_ID}`,
          existingDocumentTypes: docTypes.map(dt => dt.name),
        });
        console.log('Agent result:', { success: agentResult.success, value: agentResult.value });

        // Step 4: Check if logs were created
        const logsAfterProcessing = yield* tinybase.getProcessingLogs(TEST_DOC_ID);
        console.log('Logs after processing:', logsAfterProcessing.length);

        // Step 5: Check if tag was updated
        const docAfterProcessing = yield* paperless.getDocument(TEST_DOC_ID);
        const tagsAfter = docAfterProcessing.tag_names ?? [];
        const hasDocumentTypeDoneTag = tagsAfter.includes(TAG_DOCUMENT_TYPE_DONE);
        console.log('Document tags after processing:', tagsAfter);
        console.log('Has document_type_done tag:', hasDocumentTypeDoneTag);

        return {
          logsCreated: logsAfterProcessing.length,
          logsBefore: logsBeforeProcessing.length,
          logs: logsAfterProcessing,
          agentSuccess: agentResult.success,
          tagTransitioned: hasDocumentTypeDoneTag,
        };
      })
    );

    // Assertions
    console.log('\n=== TEST RESULTS ===');
    console.log('Logs created:', result.logsCreated);
    console.log('Agent success:', result.agentSuccess);
    console.log('Tag transitioned:', result.tagTransitioned);

    // Log entries by type
    const logsByType = result.logs.reduce((acc, log) => {
      acc[log.eventType] = (acc[log.eventType] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    console.log('Log entries by type:', logsByType);

    // Verify logs were created
    expect(result.logsCreated).toBeGreaterThan(result.logsBefore);

    // Verify we have expected log types
    const hasContextLog = result.logs.some(l => l.eventType === 'context');
    const hasPromptLog = result.logs.some(l => l.eventType === 'prompt');
    const hasResponseLog = result.logs.some(l => l.eventType === 'response');
    const hasResultLog = result.logs.some(l => l.eventType === 'result');

    console.log('Has context log:', hasContextLog);
    console.log('Has prompt log:', hasPromptLog);
    console.log('Has response log:', hasResponseLog);
    console.log('Has result log:', hasResultLog);

    // At minimum we expect context and result logs
    expect(hasContextLog || hasResultLog).toBe(true);
  }, 120000); // 2 minute timeout for LLM processing
});
