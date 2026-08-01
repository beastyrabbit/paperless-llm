import { estimatePdfPages } from "../OcrUsageService.js";
import { MistralOcrError } from "./errors.js";

export interface MistralOcrLimits {
  readonly maxInputBytes: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
}

export const defaultMistralOcrLimits: MistralOcrLimits = {
  maxInputBytes: 50 * 1024 * 1024,
  maxPages: 500,
  maxOutputBytes: 10 * 1024 * 1024,
};

export const mergeLimits = (limits: Partial<MistralOcrLimits> | undefined): MistralOcrLimits => ({
  maxInputBytes: positiveIntegerOrDefault(
    limits?.maxInputBytes,
    defaultMistralOcrLimits.maxInputBytes,
  ),
  maxPages: positiveIntegerOrDefault(limits?.maxPages, defaultMistralOcrLimits.maxPages),
  maxOutputBytes: positiveIntegerOrDefault(
    limits?.maxOutputBytes,
    defaultMistralOcrLimits.maxOutputBytes,
  ),
});

export const outputByteLength = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const positiveIntegerOrDefault = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isInteger(value) && value > 0 ? value : fallback;

const pdfMagic = "%PDF-";

export const validatePdfBytes = (pdfBytes: Uint8Array, limits: MistralOcrLimits): void => {
  if (pdfBytes.byteLength === 0) {
    throw new MistralOcrError({
      kind: "validation",
      message: "Mistral OCR input PDF is empty",
    });
  }

  const prefix = Buffer.from(pdfBytes.subarray(0, pdfMagic.length)).toString("latin1");
  if (prefix !== pdfMagic) {
    throw new MistralOcrError({
      kind: "validation",
      message: "Mistral OCR input must be a PDF",
    });
  }

  if (pdfBytes.byteLength > limits.maxInputBytes) {
    throw new MistralOcrError({
      kind: "limit",
      message: `Mistral OCR input exceeds ${limits.maxInputBytes} bytes`,
    });
  }
};

export const assertEstimatedPageLimit = (
  pdfBytes: Uint8Array,
  requestedPages: ReadonlyArray<number> | undefined,
  limits: MistralOcrLimits,
): number => {
  const pageCount = requestedPages?.length ?? estimatePdfPages(pdfBytes);
  if (pageCount > limits.maxPages) {
    throw new MistralOcrError({
      kind: "limit",
      message: `Mistral OCR page count exceeds ${limits.maxPages} pages`,
    });
  }
  return pageCount;
};

export const assertOutputLimit = (value: unknown, limits: MistralOcrLimits): void => {
  const bytes = outputByteLength(value);
  if (bytes > limits.maxOutputBytes) {
    throw new MistralOcrError({
      kind: "output_limit",
      message: `Mistral OCR response exceeds ${limits.maxOutputBytes} bytes`,
    });
  }
};
