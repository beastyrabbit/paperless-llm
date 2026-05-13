/**
 * OCR agent using Mistral OCR plus Paperless v3 document versions.
 */
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer, pipe, Stream } from "effect";
import { AgentError, MistralError } from "../errors/index.js";
import { ConfigService, PaperlessService, TinyBaseService } from "../services/index.js";
import {
  type Agent,
  emitAnalyzing,
  emitComplete,
  emitError,
  emitResult,
  emitStart,
  type StreamEvent,
} from "./base.js";

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
  skipped?: boolean;
  skipReason?: string;
  sourceVersionIds?: number[];
  ocrVersionId?: number | null;
  searchablePdfUploaded?: boolean;
  ocrPersisted?: boolean;
  error?: string;
}

interface MistralOCRPage {
  markdown: string;
  index: number;
}

interface MistralOCRResponse {
  pages: MistralOCRPage[];
}

export interface OCRAgentService extends Agent<OCRInput, OCRResult> {
  readonly name: "ocr";
  readonly process: (input: OCRInput) => Effect.Effect<OCRResult, AgentError>;
  readonly processStream: (input: OCRInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const OCRAgentService = Context.GenericTag<OCRAgentService>("OCRAgentService");

export const OCRAgentServiceLive = Layer.effect(
  OCRAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const { mistral: mistralConfig, tags: tagConfig } = config.config;

    const getConfig = (): Effect.Effect<{ apiKey: string; model: string }, never> =>
      pipe(
        tinybase.getAllSettings(),
        Effect.map((dbSettings) => {
          const configuredModel =
            dbSettings["mistral.ocr_model"] ??
            dbSettings["mistral.ocrModel"] ??
            dbSettings["mistral.model"] ??
            mistralConfig.model ??
            "mistral-ocr-latest";
          return {
            apiKey: dbSettings["mistral.api_key"] ?? mistralConfig.apiKey,
            model: configuredModel.includes("ocr") ? configuredModel : "mistral-ocr-latest",
          };
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            apiKey: mistralConfig.apiKey,
            model: mistralConfig.model?.includes("ocr")
              ? mistralConfig.model
              : "mistral-ocr-latest",
          }),
        ),
      );

    const runMistralOCR = (
      pdfBytes: Uint8Array,
    ): Effect.Effect<{ text: string; pages: number }, MistralError> =>
      Effect.gen(function* () {
        const { apiKey, model } = yield* getConfig();

        if (!apiKey) {
          return yield* Effect.fail(
            new MistralError({ message: "Mistral API key not configured" }),
          );
        }

        const pdfBase64 = Buffer.from(pdfBytes).toString("base64");

        return yield* Effect.tryPromise({
          try: async () => {
            const response = await fetch("https://api.mistral.ai/v1/ocr", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                document: {
                  type: "document_url",
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
            const pages = Array.isArray(result.pages) ? result.pages : [];
            return {
              text: pages.map((page) => page.markdown).join("\n\n"),
              pages: pages.length,
            };
          },
          catch: (error) =>
            new MistralError({
              message: `Mistral OCR failed: ${String(error)}`,
              cause: error,
            }),
        });
      });

    const generateSearchablePdf = (
      docId: number,
      pdfBytes: Uint8Array,
    ): Effect.Effect<Uint8Array | null, never> =>
      Effect.tryPromise({
        try: async () => {
          const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `paperless-llm-ocr-${docId}-`));
          const inputPath = path.join(tempDir, "input.pdf");
          const outputPath = path.join(tempDir, "output.pdf");

          try {
            await fs.writeFile(inputPath, pdfBytes);
            await new Promise<void>((resolve, reject) => {
              const child = spawn("ocrmypdf", [
                "--skip-text",
                "--deskew",
                "--rotate-pages",
                inputPath,
                outputPath,
              ]);
              let stderr = "";
              child.stderr.on("data", (chunk) => {
                stderr += String(chunk);
              });
              child.on("error", reject);
              child.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(stderr.trim() || `ocrmypdf exited with code ${code}`));
              });
            });
            return new Uint8Array(await fs.readFile(outputPath));
          } finally {
            await fs.rm(tempDir, { recursive: true, force: true });
          }
        },
        catch: (error) => error,
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            console.warn(
              `[OCR] Searchable PDF generation skipped for document ${docId}: ${String(error)}`,
            );
            return null;
          }),
        ),
      );

    const isTextDocument = (doc: {
      mime_type?: string;
      original_file_name?: string | null;
      archived_file_name?: string | null;
    }): boolean => {
      const mimeType = doc.mime_type?.toLowerCase() ?? "";
      if (mimeType.startsWith("text/")) return true;

      const fileName = (doc.original_file_name ?? doc.archived_file_name ?? "").toLowerCase();
      return [".txt", ".md", ".csv", ".json", ".html", ".htm", ".xml"].some((extension) =>
        fileName.endsWith(extension),
      );
    };

    const persistOcrResult = (
      docId: number,
      pdfBytes: Uint8Array,
      text: string,
      pages: number,
    ): Effect.Effect<
      {
        sourceVersionIds: number[];
        ocrVersionId: number | null;
        searchablePdfUploaded: boolean;
        ocrPersisted: boolean;
      },
      never
    > =>
      Effect.gen(function* () {
        const existingVersions = yield* paperless
          .getDocumentVersions(docId)
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        const sourceVersionIds = existingVersions.map((version) => version.id);

        if (text.length > 0) {
          yield* tinybase
            .setDocumentOcrContent(docId, text, pages, "mistral")
            .pipe(Effect.catchAll(() => Effect.void));
        }

        const searchablePdf = yield* generateSearchablePdf(docId, pdfBytes);
        let ocrVersionId: number | null = null;
        let searchablePdfUploaded = false;
        let ocrPersisted = false;

        if (text.length > 0) {
          const versionBytes = searchablePdf ?? pdfBytes;
          const versionLabel = searchablePdf
            ? `Mistral OCR searchable PDF ${new Date().toISOString()}`
            : `Mistral OCR text ${new Date().toISOString()}`;
          const uploadResult = yield* paperless
            .uploadOcrPdfVersion(docId, versionBytes, versionLabel)
            .pipe(
              Effect.catchAll((error) => {
                console.warn(`[OCR] Failed to upload OCR version for ${docId}: ${String(error)}`);
                return Effect.succeed(null);
              }),
            );

          ocrVersionId = uploadResult?.id ?? uploadResult?.version_id ?? null;
          if (!ocrVersionId) {
            const createdVersion = yield* paperless
              .pollVersionCreation(docId, { knownVersionIds: sourceVersionIds })
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            ocrVersionId = createdVersion?.id ?? null;
          }

          if (ocrVersionId && text.length > 0) {
            yield* paperless.patchVersionContent(docId, ocrVersionId, text).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  ocrPersisted = true;
                }),
              ),
              Effect.catchAll((error) =>
                Effect.sync(() => {
                  console.warn(
                    `[OCR] Failed to patch OCR version content for ${docId}: ${String(error)}`,
                  );
                }),
              ),
            );
          }
          searchablePdfUploaded = searchablePdf !== null && ocrVersionId !== null;
        }

        const nextVersionIds = [...sourceVersionIds];
        if (ocrVersionId && !nextVersionIds.includes(ocrVersionId))
          nextVersionIds.push(ocrVersionId);

        yield* tinybase
          .patchDocumentMemory(docId, {
            ocrVersionIds: nextVersionIds,
            extractedFacts: {
              ocr: {
                textLength: text.length,
                pages,
                source: "mistral",
                updatedAt: new Date().toISOString(),
              },
            },
          })
          .pipe(Effect.catchAll(() => Effect.void));

        yield* tinybase
          .appendRunSummary(docId, {
            id: `ocr-${Date.now()}`,
            agent: "ocr_agent",
            status: ocrPersisted ? "completed" : "failed",
            summary: ocrPersisted
              ? `OCR extracted ${text.length} characters from ${pages} page(s) and created version ${ocrVersionId}.`
              : `OCR extracted ${text.length} characters from ${pages} page(s), but no OCR version could be created. Existing content was left unchanged.`,
            createdAt: new Date().toISOString(),
          })
          .pipe(Effect.catchAll(() => Effect.void));

        return { sourceVersionIds, ocrVersionId, searchablePdfUploaded, ocrPersisted };
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            sourceVersionIds: [],
            ocrVersionId: null,
            searchablePdfUploaded: false,
            ocrPersisted: false,
          }),
        ),
      );

    const process = (input: OCRInput): Effect.Effect<OCRResult, AgentError> =>
      Effect.gen(function* () {
        const { docId, mockMode = false } = input;

        if (mockMode) {
          const doc = yield* paperless.getDocument(docId);
          const existingContent = doc.content ?? "";
          yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);
          yield* tinybase
            .appendRunSummary(docId, {
              id: `ocr-${Date.now()}`,
              agent: "ocr_agent",
              status: "mocked",
              summary: `Mock OCR reused ${existingContent.length} existing characters.`,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "ocr",
            eventType: "result",
            data: { success: true, textLength: existingContent.length, pages: 1, mock: true },
          });
          return {
            success: true,
            docId,
            textLength: existingContent.length,
            pages: 1,
            mock: true,
          };
        }

        const doc = yield* paperless.getDocument(docId);
        if (isTextDocument(doc)) {
          const existingContent = doc.content ?? "";
          yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);
          yield* tinybase
            .appendRunSummary(docId, {
              id: `ocr-${Date.now()}`,
              agent: "ocr_agent",
              status: "skipped",
              summary: `OCR skipped because the source file is already text (${doc.mime_type ?? doc.original_file_name ?? "text document"}).`,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "ocr",
            eventType: "result",
            data: {
              success: true,
              skipped: true,
              skipReason: "text_document",
              textLength: existingContent.length,
              pages: 1,
              sourceMimeType: doc.mime_type,
              sourceFileName: doc.original_file_name ?? doc.archived_file_name,
            },
          });
          return {
            success: true,
            docId,
            textLength: existingContent.length,
            pages: 1,
            skipped: true,
            skipReason: "text_document",
          };
        }

        const pdfBytes = yield* paperless.downloadPdf(docId);
        const ocrResult = yield* runMistralOCR(pdfBytes);
        const extractedText = ocrResult.text.trim();
        if (extractedText.length === 0 || ocrResult.pages <= 0) {
          const error = "Mistral OCR returned no text or pages.";
          yield* tinybase
            .appendRunSummary(docId, {
              id: `ocr-${Date.now()}`,
              agent: "ocr_agent",
              status: "failed",
              summary: error,
              createdAt: new Date().toISOString(),
            })
            .pipe(Effect.catchAll(() => Effect.void));
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "ocr",
            eventType: "error",
            data: {
              success: false,
              error,
              textLength: ocrResult.text.length,
              pages: ocrResult.pages,
            },
          });
          return {
            success: false,
            docId,
            textLength: ocrResult.text.length,
            pages: ocrResult.pages,
            ocrPersisted: false,
            error,
          };
        }
        const versionResult = yield* persistOcrResult(
          docId,
          pdfBytes,
          ocrResult.text,
          ocrResult.pages,
        );

        if (ocrResult.text.length > 0 && !versionResult.ocrPersisted) {
          const error =
            "OCR text was extracted, but no new Paperless OCR version could be created. Existing content was left unchanged.";
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "ocr",
            eventType: "result",
            data: {
              success: false,
              error,
              textLength: ocrResult.text.length,
              pages: ocrResult.pages,
              sourceVersionIds: versionResult.sourceVersionIds,
              ocrVersionId: versionResult.ocrVersionId,
              searchablePdfUploaded: versionResult.searchablePdfUploaded,
              ocrPersisted: versionResult.ocrPersisted,
            },
          });
          return {
            success: false,
            docId,
            textLength: ocrResult.text.length,
            pages: ocrResult.pages,
            sourceVersionIds: versionResult.sourceVersionIds,
            ocrVersionId: versionResult.ocrVersionId,
            searchablePdfUploaded: versionResult.searchablePdfUploaded,
            ocrPersisted: versionResult.ocrPersisted,
            error,
          };
        }

        yield* paperless.transitionDocumentTag(docId, tagConfig.pending, tagConfig.ocrDone);
        yield* tinybase.addProcessingLog({
          docId,
          timestamp: new Date().toISOString(),
          step: "ocr",
          eventType: "result",
          data: {
            success: true,
            textLength: ocrResult.text.length,
            pages: ocrResult.pages,
            sourceVersionIds: versionResult.sourceVersionIds,
            ocrVersionId: versionResult.ocrVersionId,
            searchablePdfUploaded: versionResult.searchablePdfUploaded,
            ocrPersisted: versionResult.ocrPersisted,
          },
        });

        return {
          success: true,
          docId,
          textLength: ocrResult.text.length,
          pages: ocrResult.pages,
          sourceVersionIds: versionResult.sourceVersionIds,
          ocrVersionId: versionResult.ocrVersionId,
          searchablePdfUploaded: versionResult.searchablePdfUploaded,
          ocrPersisted: versionResult.ocrPersisted,
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `OCR processing failed: ${String(error)}`,
              agent: "ocr",
              cause: error,
            }),
        ),
      );

    return {
      name: "ocr" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart("ocr")));
            yield* Effect.sync(() =>
              emit.single(
                emitAnalyzing("ocr", input.mockMode ? "Using existing content" : "Running OCR"),
              ),
            );
            const result = yield* process(input);
            yield* Effect.sync(() => {
              emit.single(emitResult("ocr", result));
              emit.single(emitComplete("ocr"));
              emit.end();
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("ocr", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
