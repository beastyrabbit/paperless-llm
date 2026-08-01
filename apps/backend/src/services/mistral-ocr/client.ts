import { Effect } from "effect";
import { ConfigService } from "../../config/index.js";
import { MistralError } from "../../errors/index.js";
import { fetchWithTimeout, getRetryAfterMs, normalizeBaseUrl } from "../../utils/http.js";
import { logger } from "../../utils/logger.js";
import { ConcurrencyLimitService } from "../ConcurrencyLimitService.js";
import { classifyHttpRetryReason, isRetryableHttpStatus, MistralOcrError } from "./errors.js";
import { canonicalJson, hashCanonical, sha256Hex } from "./hashes.js";
import {
  assertEstimatedPageLimit,
  assertOutputLimit,
  mergeLimits,
  validatePdfBytes,
} from "./limits.js";
import { normalizePages } from "./pages.js";
import { decodeMistralOcrResponse, ocrHashPayload } from "./schema.js";
import {
  MISTRAL_OCR_MODEL,
  type MistralOcrOptions,
  type MistralOcrPdfInput,
  type MistralOcrResult,
  type MistralOcrSource,
} from "./types.js";

interface MistralOcrRuntimeConfig {
  readonly apiKey: string;
  readonly apiBaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly retryAttempts: number;
  readonly retryBaseDelayMs: number;
}

const serviceLogger = logger.child({ component: "mistral-ocr" });

const coercePdfBytes = (pdfBytes: Uint8Array): Uint8Array =>
  pdfBytes instanceof Buffer
    ? new Uint8Array(pdfBytes.buffer, pdfBytes.byteOffset, pdfBytes.byteLength)
    : pdfBytes;

const abortReason = (signal: AbortSignal): unknown =>
  "reason" in signal ? (signal as AbortSignal & { reason?: unknown }).reason : undefined;

const isAbortLikeError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";

const sanitizeCaughtError = (error: unknown, signal: AbortSignal | undefined): MistralOcrError => {
  if (error instanceof MistralOcrError) return error;
  if (error instanceof MistralError) {
    return new MistralOcrError({
      kind: "http",
      message: "Mistral OCR request failed",
      statusCode: error.statusCode,
      retryable: error.statusCode === undefined || isRetryableHttpStatus(error.statusCode),
      retryReason:
        error.statusCode === undefined ? "network" : classifyHttpRetryReason(error.statusCode),
      retryAfterMs: error.retryAfterMs,
      cause: error.cause,
    });
  }

  if (signal?.aborted || isAbortLikeError(error)) {
    return new MistralOcrError({
      kind: "cancelled",
      message: "Mistral OCR request was cancelled",
      cause: signal ? abortReason(signal) : error,
    });
  }

  if (error instanceof Error && error.name === "HttpTimeoutError") {
    return new MistralOcrError({
      kind: "timeout",
      message: error.message,
      retryable: true,
      retryReason: "timeout",
      cause: error,
    });
  }

  return new MistralOcrError({
    kind: "network",
    message: "Mistral OCR request failed before receiving a response",
    retryable: true,
    retryReason: "network",
    cause: error,
  });
};

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw new MistralOcrError({
      kind: "cancelled",
      message: "Mistral OCR request was cancelled",
      cause: abortReason(signal),
    });
  }
};

const readConfig = (configService: ConfigService): MistralOcrRuntimeConfig => ({
  apiKey: configService.config.mistral.apiKey,
  apiBaseUrl: normalizeBaseUrl(configService.config.mistral.apiBaseUrl ?? "https://api.mistral.ai"),
  requestTimeoutMs: configService.config.http?.requestTimeoutMs ?? 120_000,
  retryAttempts: Math.max(1, configService.config.http?.mistralRetryAttempts ?? 3),
  retryBaseDelayMs: Math.max(1, configService.config.http?.mistralRetryBaseDelayMs ?? 5_000),
});

const sourceFor = (input: MistralOcrPdfInput): MistralOcrSource => ({
  mimeType: "application/pdf",
  fileName: input.source?.fileName,
  id: input.source?.id,
  ...input.source,
});

const requestOptionsFor = (
  options: MistralOcrOptions | undefined,
  pages: ReadonlyArray<number> | undefined,
) => ({
  model: MISTRAL_OCR_MODEL,
  table_format: "markdown" as const,
  include_blocks: true,
  confidence_scores_granularity: "page" as const,
  include_image_base64: options?.includeImageBase64 ?? false,
  extract_header: options?.extractHeader ?? false,
  extract_footer: options?.extractFooter ?? false,
  pages,
});

const withConfiguredOverrides = (
  config: MistralOcrRuntimeConfig,
  options: MistralOcrOptions | undefined,
): MistralOcrRuntimeConfig => ({
  ...config,
  requestTimeoutMs: options?.timeoutMs ?? config.requestTimeoutMs,
  retryAttempts: Math.max(1, options?.retryAttempts ?? config.retryAttempts),
  retryBaseDelayMs: Math.max(1, options?.retryBaseDelayMs ?? config.retryBaseDelayMs),
});

const requestOnce = (
  config: MistralOcrRuntimeConfig,
  requestBody: unknown,
  signal: AbortSignal | undefined,
): Effect.Effect<unknown, MistralOcrError> =>
  Effect.tryPromise({
    try: async () => {
      assertNotAborted(signal);
      const response = await fetchWithTimeout(
        `${config.apiBaseUrl}/v1/ocr`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal,
        },
        config.requestTimeoutMs,
      );

      if (!response.ok) {
        throw new MistralOcrError({
          kind: "http",
          message: `Mistral OCR request rejected with HTTP ${response.status}`,
          statusCode: response.status,
          retryable: isRetryableHttpStatus(response.status),
          retryReason: classifyHttpRetryReason(response.status),
          retryAfterMs: getRetryAfterMs(response) ?? undefined,
        });
      }

      return response.json();
    },
    catch: (error) => sanitizeCaughtError(error, signal),
  });

export const processMistralOcrPdf = (
  input: MistralOcrPdfInput,
): Effect.Effect<MistralOcrResult, MistralOcrError, ConfigService | ConcurrencyLimitService> =>
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const concurrency = yield* ConcurrencyLimitService;
    const { pdfBytes, limits, pages } = yield* Effect.try({
      try: () => {
        const pdfBytes = coercePdfBytes(input.pdfBytes);
        const limits = mergeLimits(input.options?.limits);
        const pages = normalizePages(input.options?.pages);
        validatePdfBytes(pdfBytes, limits);
        assertEstimatedPageLimit(pdfBytes, pages, limits);
        assertNotAborted(input.options?.signal);
        return { pdfBytes, limits, pages };
      },
      catch: (error) => sanitizeCaughtError(error, input.options?.signal),
    });

    const runtimeConfig = withConfiguredOverrides(readConfig(configService), input.options);
    if (!runtimeConfig.apiKey) {
      return yield* Effect.fail(
        new MistralOcrError({
          kind: "configuration",
          message: "Mistral OCR API key not configured",
        }),
      );
    }

    const source = sourceFor(input);
    const sourceHash = sha256Hex(pdfBytes);
    const requestOptions = requestOptionsFor(input.options, pages);
    const optionsHash = hashCanonical(requestOptions);
    const requestBody = {
      ...requestOptions,
      document: {
        type: "document_url" as const,
        document_url: `data:application/pdf;base64,${Buffer.from(pdfBytes).toString("base64")}`,
      },
    };

    let lastError: MistralOcrError | null = null;
    for (let attempt = 0; attempt < runtimeConfig.retryAttempts; attempt++) {
      yield* Effect.try({
        try: () => assertNotAborted(input.options?.signal),
        catch: (error) => sanitizeCaughtError(error, input.options?.signal),
      });
      const response = yield* Effect.either(
        concurrency.withOcr(requestOnce(runtimeConfig, requestBody, input.options?.signal)),
      );

      if (response._tag === "Right") {
        const resultWithoutOcrHash = yield* Effect.try({
          try: () => {
            assertOutputLimit(response.right, limits);
            return decodeMistralOcrResponse(response.right, source, {
              sourceHash,
              optionsHash,
              ocrHash: "",
            });
          },
          catch: (error) => sanitizeCaughtError(error, input.options?.signal),
        });
        if (resultWithoutOcrHash.usage.pagesProcessed > limits.maxPages) {
          return yield* Effect.fail(
            new MistralOcrError({
              kind: "limit",
              message: `Mistral OCR response reports more than ${limits.maxPages} processed pages`,
            }),
          );
        }

        const ocrHash = hashCanonical(ocrHashPayload(resultWithoutOcrHash));
        const result = { ...resultWithoutOcrHash, ocrHash };
        yield* Effect.try({
          try: () => assertOutputLimit(result, limits),
          catch: (error) => sanitizeCaughtError(error, input.options?.signal),
        });
        serviceLogger.debug("Mistral OCR request succeeded", {
          model: result.model,
          sourceHash,
          optionsHash,
          ocrHash,
          pagesProcessed: result.usage.pagesProcessed,
        });
        return result;
      }

      lastError = response.left;
      if (!response.left.retryable || attempt === runtimeConfig.retryAttempts - 1) {
        serviceLogger.warn("Mistral OCR request failed", {
          kind: response.left.kind,
          statusCode: response.left.statusCode,
          retryable: response.left.retryable,
          retryReason: response.left.retryReason,
          sourceHash,
          optionsHash,
        });
        return yield* Effect.fail(response.left);
      }

      serviceLogger.warn("Retrying Mistral OCR request", {
        kind: response.left.kind,
        statusCode: response.left.statusCode,
        retryReason: response.left.retryReason,
        attempt: attempt + 1,
        sourceHash,
        optionsHash,
      });
      yield* Effect.sleep(
        `${response.left.retryAfterMs ?? runtimeConfig.retryBaseDelayMs * 2 ** attempt} millis`,
      );
    }

    return yield* Effect.fail(
      lastError ??
        new MistralOcrError({
          kind: "network",
          message: "Mistral OCR request failed without a response",
          retryable: true,
          retryReason: "network",
        }),
    );
  });

export const canonicalMistralOcrRequestForTest = (
  input: MistralOcrPdfInput,
): {
  readonly sourceHash: string;
  readonly optionsHash: string;
  readonly requestOptionsJson: string;
} => {
  const pdfBytes = coercePdfBytes(input.pdfBytes);
  const pages = normalizePages(input.options?.pages);
  const requestOptions = requestOptionsFor(input.options, pages);
  return {
    sourceHash: sha256Hex(pdfBytes),
    optionsHash: hashCanonical(requestOptions),
    requestOptionsJson: canonicalJson(requestOptions),
  };
};
