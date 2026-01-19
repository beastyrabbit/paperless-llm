/**
 * Bulk Ingest job - processes documents through OCR and adds them to the vector database.
 *
 * This job combines OCR (via Mistral) with vector database indexing (via Qdrant):
 * 1. Downloads PDF from Paperless
 * 2. Runs Mistral OCR (or uses existing content)
 * 3. Stores OCR content in TinyBase
 * 4. Embeds content via Ollama
 * 5. Upserts to Qdrant vector DB
 * 6. Optionally transitions document tag
 */
import { Effect, Context, Layer, Ref, Fiber } from 'effect';
import { ConfigService, PaperlessService, MistralService, TinyBaseService, QdrantService, OllamaService } from '../services/index.js';
import { JobError } from '../errors/index.js';
import type { DocumentVector } from '../services/QdrantService.js';

// ===========================================================================
// Types
// ===========================================================================

export interface BulkIngestProgress {
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error';
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  ocrProcessed: number;
  vectorIndexed: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
  currentPhase: 'ocr' | 'embedding' | 'indexing' | null;
  docsPerSecond: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
}

export interface BulkIngestOptions {
  docsPerSecond?: number;
  skipExistingOcr?: boolean;
  skipExistingVector?: boolean;
  runOcr?: boolean;
  transitionTag?: boolean;
  sourceTag?: string; // Tag to filter documents (default: processed or all)
  targetTag?: string; // Tag to add after processing
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface BulkIngestJobService {
  readonly start: (options?: BulkIngestOptions) => Effect.Effect<void, JobError>;
  readonly getProgress: () => Effect.Effect<BulkIngestProgress, never>;
  readonly cancel: () => Effect.Effect<void, never>;
}

export const BulkIngestJobService = Context.GenericTag<BulkIngestJobService>('BulkIngestJobService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const BulkIngestJobServiceLive = Layer.effect(
  BulkIngestJobService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const mistral = yield* MistralService;
    const tinybase = yield* TinyBaseService;
    const qdrant = yield* QdrantService;
    const ollama = yield* OllamaService;

    const { tags: tagConfig } = config.config;

    const progressRef = yield* Ref.make<BulkIngestProgress>({
      status: 'idle',
      total: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      ocrProcessed: 0,
      vectorIndexed: 0,
      currentDocId: null,
      currentDocTitle: null,
      currentPhase: null,
      docsPerSecond: 1,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
    });

    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, JobError> | null>(null);
    const cancelledRef = yield* Ref.make(false);

    const sleep = (ms: number) =>
      Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)));

    return {
      start: (options) =>
        Effect.gen(function* () {
          const currentFiber = yield* Ref.get(fiberRef);
          if (currentFiber) {
            return yield* Effect.fail(
              new JobError({ message: 'Bulk ingest job already running', jobName: 'bulk_ingest' })
            );
          }

          // Validate and clamp docsPerSecond to a safe positive value (min 0.1, max 10)
          const rawDocsPerSecond = options?.docsPerSecond ?? 0.5;
          const docsPerSecond = Math.max(0.1, Math.min(10, Number.isFinite(rawDocsPerSecond) ? rawDocsPerSecond : 0.5));
          const skipExistingOcr = options?.skipExistingOcr ?? true;
          const skipExistingVector = options?.skipExistingVector ?? false;
          const runOcr = options?.runOcr ?? true;
          const transitionTag = options?.transitionTag ?? false;
          const sourceTag = options?.sourceTag; // undefined = all documents
          const targetTag = options?.targetTag;
          const delayMs = Math.floor(1000 / docsPerSecond);

          yield* Ref.set(cancelledRef, false);
          yield* Ref.set(progressRef, {
            status: 'running',
            total: 0,
            processed: 0,
            skipped: 0,
            errors: 0,
            ocrProcessed: 0,
            vectorIndexed: 0,
            currentDocId: null,
            currentDocTitle: null,
            currentPhase: null,
            docsPerSecond,
            startedAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: null,
          });

          // Ensure Qdrant collection exists
          yield* qdrant.ensureCollection().pipe(
            Effect.catchAll((e) =>
              Effect.gen(function* () {
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  status: 'error' as const,
                  errorMessage: `Failed to ensure Qdrant collection: ${e.message}`,
                  completedAt: new Date().toISOString(),
                }));
                return yield* Effect.fail(
                  new JobError({ message: `Failed to ensure Qdrant collection: ${e.message}`, jobName: 'bulk_ingest' })
                );
              })
            )
          );

          const runIngest = Effect.gen(function* () {
            // Get documents to process
            let documents: Array<{ id: number; title: string; content: string | null; correspondent: number | null; document_type: number | null; tags: readonly number[] }>;

            if (sourceTag) {
              documents = yield* paperless.getDocumentsByTag(sourceTag, 10000);
            } else {
              // Get all documents (or limit to a reasonable number)
              documents = yield* paperless.getDocuments({ pageSize: 10000 });
            }

            yield* Ref.update(progressRef, (p) => ({
              ...p,
              total: documents.length,
            }));

            // Get all tags, correspondents, and document types for metadata
            const [allTags, allCorrespondents, allDocTypes] = yield* Effect.all([
              paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
              paperless.getCorrespondents().pipe(Effect.catchAll(() => Effect.succeed([]))),
              paperless.getDocumentTypes().pipe(Effect.catchAll(() => Effect.succeed([]))),
            ]);

            const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
            const corrMap = new Map(allCorrespondents.map((c) => [c.id, c.name]));
            const typeMap = new Map(allDocTypes.map((dt) => [dt.id, dt.name]));

            for (const doc of documents) {
              const cancelled = yield* Ref.get(cancelledRef);
              if (cancelled) break;

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                currentDocId: doc.id,
                currentDocTitle: doc.title,
              }));

              let documentContent = doc.content ?? '';

              // Phase 1: OCR if needed
              if (runOcr) {
                yield* Ref.update(progressRef, (p) => ({ ...p, currentPhase: 'ocr' as const }));

                // Check if we already have OCR content in TinyBase
                const existingOcr = yield* tinybase.getDocumentOcrContent(doc.id);

                if (existingOcr && skipExistingOcr) {
                  // Use existing OCR content
                  documentContent = existingOcr.content;
                } else if (doc.content && doc.content.length > 100 && skipExistingOcr) {
                  // Use existing Paperless content
                  documentContent = doc.content;
                  // Store it in TinyBase for future use
                  yield* tinybase.setDocumentOcrContent(doc.id, doc.content, 1, 'paperless');
                } else {
                  // Run OCR
                  const ocrResult = yield* Effect.gen(function* () {
                    const pdfBytes = yield* paperless.downloadPdf(doc.id);
                    const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

                    const ocrPrompt = `Extract all text from this document. Preserve the structure and formatting as much as possible. Return only the extracted text, no explanations.`;
                    return yield* mistral.processDocument(pdfBase64, ocrPrompt);
                  }).pipe(
                    Effect.catchAll((e) => {
                      console.error(`OCR failed for doc ${doc.id}: ${e}`);
                      return Effect.succeed(doc.content ?? '');
                    })
                  );

                  documentContent = ocrResult;

                  // Store OCR content in TinyBase
                  if (documentContent.length > 0) {
                    yield* tinybase.setDocumentOcrContent(doc.id, documentContent, 1, 'mistral');
                    yield* Ref.update(progressRef, (p) => ({
                      ...p,
                      ocrProcessed: p.ocrProcessed + 1,
                    }));
                  }
                }
              } else {
                // No OCR, use existing content
                const existingOcr = yield* tinybase.getDocumentOcrContent(doc.id);
                documentContent = existingOcr?.content ?? doc.content ?? '';
              }

              // Skip if no content to index
              if (!documentContent || documentContent.length < 50) {
                yield* Ref.update(progressRef, (p) => ({
                  ...p,
                  skipped: p.skipped + 1,
                  processed: p.processed + 1,
                }));
                yield* sleep(delayMs);
                continue;
              }

              // Phase 2: Embedding
              yield* Ref.update(progressRef, (p) => ({ ...p, currentPhase: 'embedding' as const }));

              // Phase 3: Vector indexing
              yield* Ref.update(progressRef, (p) => ({ ...p, currentPhase: 'indexing' as const }));

              const tagNames = doc.tags
                .map((id) => tagMap.get(id))
                .filter((name): name is string => name !== undefined);

              const correspondent = doc.correspondent ? corrMap.get(doc.correspondent) : undefined;
              const documentType = doc.document_type ? typeMap.get(doc.document_type) : undefined;

              const vectorDoc: DocumentVector = {
                docId: doc.id,
                title: doc.title,
                content: documentContent,
                tags: tagNames,
                correspondent,
                documentType,
              };

              yield* qdrant.upsertDocument(vectorDoc).pipe(
                Effect.tap(() =>
                  Ref.update(progressRef, (p) => ({
                    ...p,
                    vectorIndexed: p.vectorIndexed + 1,
                  }))
                ),
                Effect.catchAll((e) => {
                  console.error(`Vector indexing failed for doc ${doc.id}: ${e.message}`);
                  return Ref.update(progressRef, (p) => ({
                    ...p,
                    errors: p.errors + 1,
                  }));
                })
              );

              // Transition tag if requested
              if (transitionTag && sourceTag && targetTag) {
                yield* paperless.transitionDocumentTag(doc.id, sourceTag, targetTag).pipe(
                  Effect.catchAll((e) => {
                    console.error(`Tag transition failed for doc ${doc.id}: ${e}`);
                    return Effect.succeed(undefined);
                  })
                );
              }

              yield* Ref.update(progressRef, (p) => ({
                ...p,
                processed: p.processed + 1,
              }));

              // Rate limiting
              yield* sleep(delayMs);
            }

            const cancelled = yield* Ref.get(cancelledRef);
            yield* Ref.update(progressRef, (p) => ({
              ...p,
              status: (cancelled ? 'cancelled' : 'completed') as BulkIngestProgress['status'],
              completedAt: new Date().toISOString(),
              currentDocId: null,
              currentDocTitle: null,
              currentPhase: null,
            }));
          }).pipe(
            Effect.catchAll((error) =>
              Ref.update(progressRef, (p) => ({
                ...p,
                status: 'error' as const,
                errorMessage: error instanceof Error ? error.message : String(error),
                completedAt: new Date().toISOString(),
                currentPhase: null,
              }))
            )
          );

          const fiber = yield* Effect.fork(
            runIngest.pipe(
              Effect.mapError((e) =>
                new JobError({
                  message: `Bulk ingest failed: ${e}`,
                  jobName: 'bulk_ingest',
                  cause: e,
                })
              )
            )
          );

          yield* Ref.set(fiberRef, fiber);

          // Wait for completion and clean up fiber ref
          yield* Effect.fork(
            Effect.gen(function* () {
              yield* Fiber.await(fiber);
              yield* Ref.set(fiberRef, null);
            })
          );
        }),

      getProgress: () => Ref.get(progressRef),

      cancel: () =>
        Effect.gen(function* () {
          yield* Ref.set(cancelledRef, true);
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
          }
          yield* Ref.update(progressRef, (p) => ({
            ...p,
            status: 'cancelled' as const,
            completedAt: new Date().toISOString(),
          }));
        }),
    };
  })
);
