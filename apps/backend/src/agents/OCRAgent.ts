/**
 * OCR Agent using Mistral AI.
 *
 * This agent handles ONLY the OCR step:
 * 1. Download PDF from Paperless
 * 2. Send to Mistral OCR API
 * 3. Update document tags
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { AgentError, MistralError } from '../errors/index.js';
import {
  type Agent,
  type StreamEvent,
  emitStart,
  emitAnalyzing,
  emitResult,
  emitError,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface OCRInput {
  docId: number;
  mockMode?: boolean;
}

export interface OCRResult {
  success: boolean;
  docId: number;
  textLength: number;
  pages: number;
  mock?: boolean;
  error?: string;
}

interface MistralOCRPage {
  markdown: string;
  index: number;
}

interface MistralOCRResponse {
  pages: MistralOCRPage[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface OCRAgentService extends Agent<OCRInput, OCRResult> {
  readonly name: 'ocr';
  readonly process: (input: OCRInput) => Effect.Effect<OCRResult, AgentError>;
  readonly processStream: (input: OCRInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const OCRAgentService = Context.GenericTag<OCRAgentService>('OCRAgentService');

// ===========================================================================
// Constants
// ===========================================================================

const MAX_PAGES_FOR_BASE64 = 60;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const OCRAgentServiceLive = Layer.effect(
  OCRAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;

    const { mistral: mistralConfig, tags: tagConfig } = config.config;

    // Helper to get current config from TinyBase with fallback
    const getConfig = (): Effect.Effect<{ apiKey: string; model: string }, never> =>
      pipe(
        tinybase.getAllSettings(),
        Effect.map((dbSettings) => ({
          apiKey: dbSettings['mistral.api_key'] ?? mistralConfig.apiKey,
          model: dbSettings['mistral.model'] ?? mistralConfig.model,
        })),
        Effect.catchAll(() =>
          Effect.succeed({
            apiKey: mistralConfig.apiKey,
            model: mistralConfig.model,
          })
        )
      );

    // Run Mistral OCR on PDF bytes
    const runMistralOCR = (pdfBytes: Uint8Array): Effect.Effect<{ text: string; pages: number }, MistralError> =>
      Effect.gen(function* () {
        const { apiKey, model } = yield* getConfig();

        if (!apiKey) {
          return yield* Effect.fail(
            new MistralError({ message: 'Mistral API key not configured' })
          );
        }

        const pdfBase64 = Buffer.from(pdfBytes).toString('base64');

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch('https://api.mistral.ai/v1/ocr', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                document: {
                  type: 'document_url',
                  document_url: `data:application/pdf;base64,${pdfBase64}`,
                },
                include_image_base64: false,
              }),
            });

            if (!response.ok) {
              const text = await response.text();
              throw new Error(`Mistral OCR error: ${response.status} ${text}`);
            }

            const result = (await response.json()) as MistralOCRResponse;

            // Extract text from OCR response
            let extractedText = '';
            let pages = 0;

            for (const page of result.pages) {
              extractedText += page.markdown + '\n\n';
              pages++;
            }

            return {
              text: extractedText.trim(),
              pages,
            };
          },
          catch: (error) =>
            new MistralError({
              message: `Mistral OCR failed: ${String(error)}`,
              cause: error,
            }),
        });
      });

    return {
      name: 'ocr' as const,

      process: (input: OCRInput) =>
        Effect.gen(function* () {
          const { docId, mockMode = false } = input;

          // Mock mode: use existing content, skip Mistral API
          if (mockMode) {
            const doc = yield* paperless.getDocument(docId);
            const existingContent = doc.content ?? '';

            // Update tags: remove pending, add ocr-done
            yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);

            // Log processing result
            yield* tinybase.addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: 'ocr',
              eventType: 'result',
              data: {
                success: true,
                textLength: existingContent.length,
                pages: 1,
                mock: true,
              },
            });

            return {
              success: true,
              docId,
              textLength: existingContent.length,
              pages: 1,
              mock: true,
            };
          }

          // Download PDF from Paperless
          const pdfBytes = yield* paperless.downloadPdf(docId);

          // Run Mistral OCR
          const ocrResult = yield* runMistralOCR(pdfBytes);

          // Update tags: remove pending, add ocr-done
          yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);

          // Log processing result
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: 'ocr',
            eventType: 'result',
            data: {
              success: true,
              textLength: ocrResult.text.length,
              pages: ocrResult.pages,
            },
          });

          return {
            success: true,
            docId,
            textLength: ocrResult.text.length,
            pages: ocrResult.pages,
          };
        }).pipe(
          Effect.mapError((e) =>
            new AgentError({
              message: `OCR processing failed: ${e}`,
              agent: 'ocr',
              cause: e,
            })
          )
        ),

      processStream: (input: OCRInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const { docId, mockMode = false } = input;

            yield* Effect.sync(() => emit.single(emitStart('ocr')));

            if (mockMode) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('ocr', 'Using existing content (mock mode)'))
              );

              const doc = yield* paperless.getDocument(docId);
              const existingContent = doc.content ?? '';

              yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);

              // Log processing result
              yield* tinybase.addProcessingLog({
                docId,
                timestamp: new Date().toISOString(),
                step: 'ocr',
                eventType: 'result',
                data: {
                  success: true,
                  textLength: existingContent.length,
                  pages: 1,
                  mock: true,
                },
              });

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('ocr', {
                    success: true,
                    docId,
                    textLength: existingContent.length,
                    pages: 1,
                    mock: true,
                  })
                )
              );
            } else {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('ocr', 'Downloading PDF from Paperless'))
              );

              const pdfBytes = yield* paperless.downloadPdf(docId);

              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('ocr', 'Running Mistral OCR'))
              );

              const ocrResult = yield* runMistralOCR(pdfBytes);

              yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);

              // Log processing result
              yield* tinybase.addProcessingLog({
                docId,
                timestamp: new Date().toISOString(),
                step: 'ocr',
                eventType: 'result',
                data: {
                  success: true,
                  textLength: ocrResult.text.length,
                  pages: ocrResult.pages,
                },
              });

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('ocr', {
                    success: true,
                    docId,
                    textLength: ocrResult.text.length,
                    pages: ocrResult.pages,
                  })
                )
              );
            }

            yield* Effect.sync(() => emit.single(emitComplete('ocr')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.sync(() =>
                  emit.single(emitError('ocr', String(error)))
                );
                yield* Effect.sync(() => emit.end());
              })
            ),
            Effect.mapError((e) =>
              new AgentError({
                message: `OCR stream failed: ${e}`,
                agent: 'ocr',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
