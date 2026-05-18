/**
 * OCR agent using Mistral OCR plus Paperless v3 document versions.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Context, Effect, Layer, pipe, Stream } from "effect";
import { AgentError, MistralError } from "../errors/index.js";
import {
  ConcurrencyLimitService,
  ConfigService,
  PaperlessService,
  classifyMetricsErrorOutcome,
  metricReasonFromError,
  metrics,
  observeDuration,
  TinyBaseService,
  OcrUsageService,
} from "../services/index.js";
import {
  fetchWithTimeout,
  getRetryAfterMs,
  isTransientHttpStatus,
  normalizeBaseUrl,
} from "../utils/http.js";
import { logger } from "../utils/logger.js";
import { annotateSpan, withClientSpan, withInternalSpan } from "../observability/tracing.js";
import type { PaperlessDocumentVersion } from "../services/paperless/types.js";
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
  force?: boolean;
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
  sourcePdfSha256?: string;
  textSha256?: string;
  error?: string;
}

interface MistralOCRPage {
  markdown: string;
  index: number;
}

interface MistralOCRResponse {
  pages: MistralOCRPage[];
  usage_info?: {
    pages_processed?: number;
    doc_size_bytes?: number;
  };
}

const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const sha256Text = (value: string): string => createHash("sha256").update(value).digest("hex");

const MIN_REUSABLE_OCR_CONTENT_LENGTH = 50;
const MISTRAL_OCR_VERSION_LABEL_PATTERN = /\bmistral\s+ocr\b/i;

const readStoredOcrHash = (value: unknown): string | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const hash = (value as Record<string, unknown>)["sourcePdfSha256"];
  return typeof hash === "string" && hash.length > 0 ? hash : null;
};

const getVersionLabel = (version: PaperlessDocumentVersion): string =>
  (version.label ?? version.version_label ?? "").trim();

const getVersionTimestamp = (version: PaperlessDocumentVersion): number => {
  const parsed = Date.parse(version.created ?? version.added ?? "");
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortVersionsNewestFirst = (
  versions: readonly PaperlessDocumentVersion[],
): PaperlessDocumentVersion[] =>
  [...versions].sort((left, right) => {
    const timestampDiff = getVersionTimestamp(right) - getVersionTimestamp(left);
    return timestampDiff !== 0 ? timestampDiff : right.id - left.id;
  });

const findCurrentMistralOcrVersion = (
  versions: readonly PaperlessDocumentVersion[],
): PaperlessDocumentVersion | null => {
  const [latest] = sortVersionsNewestFirst(versions);
  if (!latest) return null;
  return MISTRAL_OCR_VERSION_LABEL_PATTERN.test(getVersionLabel(latest)) ? latest : null;
};

export interface OCRAgentService extends Agent<OCRInput, OCRResult> {
  readonly name: "ocr";
  readonly process: (input: OCRInput) => Effect.Effect<OCRResult, AgentError>;
  readonly processStream: (input: OCRInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const OCRAgentService = Context.GenericTag<OCRAgentService>("OCRAgentService");
const ocrLogger = logger.child({ component: "ocr_agent" });

export const OCRAgentServiceLive = Layer.effect(
  OCRAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const concurrency = yield* ConcurrencyLimitService;
    const ocrUsage = yield* OcrUsageService;
    const { mistral: mistralConfig } = config.config;

    const getConfig = (): Effect.Effect<
      {
        apiKey: string;
        model: string;
        apiBaseUrl: string;
        requestTimeoutMs: number;
        retryAttempts: number;
        retryBaseDelayMs: number;
      },
      never
    > =>
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
            apiBaseUrl: normalizeBaseUrl(
              dbSettings["mistral.api_base_url"] ??
                dbSettings["mistral.apiBaseUrl"] ??
                mistralConfig.apiBaseUrl ??
                "https://api.mistral.ai",
            ),
            requestTimeoutMs: config.config.http?.requestTimeoutMs ?? 120_000,
            retryAttempts: Math.max(1, config.config.http?.mistralRetryAttempts ?? 3),
            retryBaseDelayMs: Math.max(1, config.config.http?.mistralRetryBaseDelayMs ?? 5_000),
          };
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            apiKey: mistralConfig.apiKey,
            model: mistralConfig.model?.includes("ocr")
              ? mistralConfig.model
              : "mistral-ocr-latest",
            apiBaseUrl: normalizeBaseUrl(mistralConfig.apiBaseUrl ?? "https://api.mistral.ai"),
            requestTimeoutMs: config.config.http?.requestTimeoutMs ?? 120_000,
            retryAttempts: Math.max(1, config.config.http?.mistralRetryAttempts ?? 3),
            retryBaseDelayMs: Math.max(1, config.config.http?.mistralRetryBaseDelayMs ?? 5_000),
          }),
        ),
      );

    const isRetryableMistralError = (error: MistralError): boolean =>
      error.statusCode === undefined || isTransientHttpStatus(error.statusCode);

    const runMistralOCR = (
      pdfBytes: Uint8Array,
      docId: number,
      runId: string,
    ): Effect.Effect<
      { text: string; pages: number },
      MistralError | import("../services/OcrUsageService.js").OcrBudgetExceededError
    > =>
      Effect.gen(function* () {
        const startedAt = Date.now();
        const { apiKey, model, apiBaseUrl, requestTimeoutMs, retryAttempts, retryBaseDelayMs } =
          yield* getConfig();

        if (!apiKey) {
          return yield* Effect.fail(
            new MistralError({ message: "Mistral API key not configured" }),
          );
        }

        const pdfBase64 = Buffer.from(pdfBytes).toString("base64");
        const estimatedPages = ocrUsage.estimatePdfPages(pdfBytes);
        const estimatedTokens = ocrUsage.estimateOcrTokens(pdfBytes);
        const reservation = yield* ocrUsage.reserve({
          runId,
          docId,
          source: "ocr_agent",
          estimatedPages,
          estimatedTokens,
          model,
        });

        const requestOnce = Effect.tryPromise({
          try: async () => {
            const response = await fetchWithTimeout(
              `${apiBaseUrl}/v1/ocr`,
              {
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
              },
              requestTimeoutMs,
            );

            if (!response.ok) {
              const text = await response.text();
              throw new MistralError({
                message: `Mistral OCR error: ${response.status} ${text}`,
                statusCode: response.status,
                retryAfterMs: getRetryAfterMs(response) ?? undefined,
              });
            }

            const result = (await response.json()) as MistralOCRResponse;
            const pages = Array.isArray(result.pages) ? result.pages : [];
            return {
              text: pages.map((page) => page.markdown).join("\n\n"),
              pages: pages.length,
            };
          },
          catch: (error) =>
            error instanceof MistralError
              ? error
              : new MistralError({
                  message: `Mistral OCR failed: ${String(error)}`,
                  cause: error,
                }),
        });

        let lastError: MistralError | null = null;
        for (let attempt = 0; attempt < retryAttempts; attempt++) {
          const result = yield* Effect.either(
            concurrency.withOcr(concurrency.withMistral(requestOnce)),
          );
          if (result._tag === "Right") {
            metrics.llmRequestDuration.observe(
              { provider: "mistral", operation: "ocr", model, outcome: "success" },
              observeDuration(startedAt),
            );
            yield* ocrUsage.commit(reservation, { pages: Math.max(1, result.right.pages), model });
            return result.right;
          }

          lastError = result.left;
          if (!isRetryableMistralError(result.left) || attempt === retryAttempts - 1) {
            metrics.llmRequestDuration.observe(
              {
                provider: "mistral",
                operation: "ocr",
                model,
                outcome: classifyMetricsErrorOutcome(result.left),
              },
              observeDuration(startedAt),
            );
            yield* ocrUsage.release(reservation, "mistral_error");
            return yield* Effect.fail(result.left);
          }

          metrics.retries.inc({
            component: "mistral",
            operation: "ocr",
            reason: metricReasonFromError(result.left),
          });
          const delayMs = result.left.retryAfterMs ?? retryBaseDelayMs * 2 ** attempt;
          yield* Effect.sleep(`${delayMs} millis`);
        }

        const error =
          lastError ?? new MistralError({ message: "Mistral OCR failed without a cause" });
        metrics.llmRequestDuration.observe(
          {
            provider: "mistral",
            operation: "ocr",
            model,
            outcome: classifyMetricsErrorOutcome(error),
          },
          observeDuration(startedAt),
        );
        yield* ocrUsage.release(reservation, "mistral_error");
        return yield* Effect.fail(error);
      }).pipe(
        Effect.tap((result) =>
          annotateSpan({
            "ocr.pages": result.pages,
            "ocr.text_length": result.text.length,
            "ocr.outcome": "success",
          }),
        ),
        Effect.tapError((error) =>
          annotateSpan({
            "ocr.outcome": "error",
            "error.type": error instanceof Error ? error.name : "unknown",
          }),
        ),
        withClientSpan("mistral.ocr", {
          "peer.service": "mistral",
          "http.request.method": "POST",
          "url.path": "/v1/ocr",
          "mistral.operation": "ocr",
          "paperless.document.id": docId,
        }),
      );

    const generateSearchablePdf = (
      docId: number,
      pdfBytes: Uint8Array,
    ): Effect.Effect<Uint8Array | null, never> =>
      concurrency
        .withOcr(
          Effect.tryPromise({
            try: async () => {
              const tempDir = await fs.mkdtemp(
                path.join(os.tmpdir(), `paperless-llm-ocr-${docId}-`),
              );
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
          }),
        )
        .pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              ocrLogger.warn("searchable_pdf_generation_skipped", { docId, error });
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

    const getReusableContent = (doc: { content?: string | null }): string => {
      const content = doc.content?.trim() ?? "";
      return content.length >= MIN_REUSABLE_OCR_CONTENT_LENGTH ? content : "";
    };

    const skipWithExistingContent = (
      docId: number,
      existingContent: string,
      skipReason: string,
      summary: string,
      extraData: Record<string, unknown> = {},
    ) =>
      Effect.gen(function* () {
        yield* tinybase
          .appendRunSummary(docId, {
            id: `ocr-${Date.now()}`,
            agent: "ocr_agent",
            status: "skipped",
            summary,
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
            skipReason,
            textLength: existingContent.length,
            pages: 1,
            ...extraData,
          },
        });
        return {
          success: true,
          docId,
          textLength: existingContent.length,
          pages: 1,
          skipped: true,
          skipReason,
        };
      });

    const persistOcrResult = (
      docId: number,
      pdfBytes: Uint8Array,
      text: string,
      pages: number,
      sourcePdfSha256: string,
      knownVersions?: readonly PaperlessDocumentVersion[],
    ): Effect.Effect<
      {
        sourceVersionIds: number[];
        ocrVersionId: number | null;
        searchablePdfUploaded: boolean;
        ocrPersisted: boolean;
        sourcePdfSha256: string;
        textSha256: string;
      },
      never
    > =>
      Effect.gen(function* () {
        const textSha256 = sha256Text(text);
        const existingVersions =
          knownVersions ??
          (yield* paperless
            .getDocumentVersions(docId)
            .pipe(Effect.catchAll(() => Effect.succeed([]))));
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
                ocrLogger.warn("ocr_version_upload_failed", { docId, error });
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
                  ocrLogger.warn("ocr_version_content_patch_failed", {
                    docId,
                    ocrVersionId,
                    error,
                  });
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
                sourcePdfSha256,
                textSha256,
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

        return {
          sourceVersionIds,
          ocrVersionId,
          searchablePdfUploaded,
          ocrPersisted,
          sourcePdfSha256,
          textSha256,
        };
      }).pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            sourceVersionIds: [],
            ocrVersionId: null,
            searchablePdfUploaded: false,
            ocrPersisted: false,
            sourcePdfSha256,
            textSha256: sha256Text(text),
          }),
        ),
      );

    const process = (input: OCRInput): Effect.Effect<OCRResult, AgentError> =>
      Effect.gen(function* () {
        const { docId, mockMode = false, force = false } = input;
        const runId = `ocr-agent-${docId}-${Date.now()}`;

        if (mockMode) {
          const doc = yield* paperless.getDocument(docId);
          const existingContent = doc.content ?? "";
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
          return yield* skipWithExistingContent(
            docId,
            existingContent,
            "text_document",
            `OCR skipped because the source file is already text (${doc.mime_type ?? doc.original_file_name ?? "text document"}).`,
            {
              sourceMimeType: doc.mime_type,
              sourceFileName: doc.original_file_name ?? doc.archived_file_name,
            },
          );
        }

        const existingVersions = yield* paperless
          .getDocumentVersions(docId)
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        const reusableContent = force ? "" : getReusableContent(doc);
        const currentMistralVersion = force ? null : findCurrentMistralOcrVersion(existingVersions);
        if (reusableContent && currentMistralVersion) {
          return yield* skipWithExistingContent(
            docId,
            reusableContent,
            "existing_mistral_ocr_version",
            `OCR skipped because the current Paperless version is already labeled as Mistral OCR and has ${reusableContent.length} characters of extracted text.`,
            {
              sourceMimeType: doc.mime_type,
              sourceFileName: doc.original_file_name ?? doc.archived_file_name,
              ocrVersionId: currentMistralVersion.id,
              ocrVersionLabel: getVersionLabel(currentMistralVersion),
            },
          );
        }

        const pdfBytes = yield* paperless.downloadPdf(docId);
        const sourcePdfSha256 = sha256Bytes(pdfBytes);
        if (!force) {
          const [memory, cachedOcr] = yield* Effect.all(
            [
              tinybase.getDocumentMemory(docId).pipe(Effect.catchAll(() => Effect.succeed(null))),
              tinybase
                .getDocumentOcrContent(docId)
                .pipe(Effect.catchAll(() => Effect.succeed(null))),
            ],
            { concurrency: "unbounded" },
          );
          const storedHash = readStoredOcrHash(memory?.extractedFacts?.["ocr"]);
          const cachedText = cachedOcr?.content?.trim() ?? "";
          const cachedPages =
            typeof cachedOcr?.pages === "number" && cachedOcr.pages > 0 ? cachedOcr.pages : 1;
          if (storedHash === sourcePdfSha256 && cachedText.length > 0) {
            const versionResult = yield* persistOcrResult(
              docId,
              pdfBytes,
              cachedText,
              cachedPages,
              sourcePdfSha256,
              existingVersions,
            );
            yield* tinybase.addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: "ocr",
              eventType: "result",
              data: {
                success: versionResult.ocrPersisted,
                skipped: true,
                skipReason: "cached_ocr_result",
                textLength: cachedText.length,
                pages: cachedPages,
                sourcePdfSha256,
                textSha256: versionResult.textSha256,
                sourceVersionIds: versionResult.sourceVersionIds,
                ocrVersionId: versionResult.ocrVersionId,
                searchablePdfUploaded: versionResult.searchablePdfUploaded,
                ocrPersisted: versionResult.ocrPersisted,
              },
            });
            if (!versionResult.ocrPersisted) {
              return {
                success: false,
                docId,
                textLength: cachedText.length,
                pages: cachedPages,
                skipped: true,
                skipReason: "cached_ocr_result",
                sourceVersionIds: versionResult.sourceVersionIds,
                ocrVersionId: versionResult.ocrVersionId,
                searchablePdfUploaded: versionResult.searchablePdfUploaded,
                ocrPersisted: versionResult.ocrPersisted,
                sourcePdfSha256,
                textSha256: versionResult.textSha256,
                error:
                  "Cached OCR text matched the current PDF, but no new Paperless OCR version could be created.",
              };
            }
            return {
              success: true,
              docId,
              textLength: cachedText.length,
              pages: cachedPages,
              skipped: true,
              skipReason: "cached_ocr_result",
              sourceVersionIds: versionResult.sourceVersionIds,
              ocrVersionId: versionResult.ocrVersionId,
              searchablePdfUploaded: versionResult.searchablePdfUploaded,
              ocrPersisted: versionResult.ocrPersisted,
              sourcePdfSha256,
              textSha256: versionResult.textSha256,
            };
          }
        }
        const ocrResult = yield* runMistralOCR(pdfBytes, docId, runId);
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
          sourcePdfSha256,
          existingVersions,
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
              sourcePdfSha256: versionResult.sourcePdfSha256,
              textSha256: versionResult.textSha256,
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
            sourcePdfSha256: versionResult.sourcePdfSha256,
            textSha256: versionResult.textSha256,
            error,
          };
        }

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
            sourcePdfSha256: versionResult.sourcePdfSha256,
            textSha256: versionResult.textSha256,
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
          sourcePdfSha256: versionResult.sourcePdfSha256,
          textSha256: versionResult.textSha256,
        };
      }).pipe(
        withInternalSpan("ocr.process_document", {
          "paperless.document.id": input.docId,
          "ocr.mock": input.mockMode === true,
          "ocr.force": input.force === true,
        }),
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
