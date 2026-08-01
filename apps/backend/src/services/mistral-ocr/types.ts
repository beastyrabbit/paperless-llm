import type { MistralOcrLimits } from "./limits.js";
import type { MistralOcrPages } from "./pages.js";

export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";

export interface MistralOcrSource {
  readonly id?: string;
  readonly fileName?: string;
  readonly mimeType?: "application/pdf";
}

export interface MistralOcrOptions {
  readonly pages?: MistralOcrPages;
  readonly includeImageBase64?: boolean;
  readonly extractHeader?: boolean;
  readonly extractFooter?: boolean;
  readonly timeoutMs?: number;
  readonly retryAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly limits?: Partial<MistralOcrLimits>;
  readonly signal?: AbortSignal;
}

export interface MistralOcrPdfInput {
  readonly pdfBytes: Uint8Array;
  readonly source?: MistralOcrSource;
  readonly options?: MistralOcrOptions;
}

export interface MistralOcrUsage {
  readonly pagesProcessed: number;
  readonly docSizeBytes: number | null;
}

export interface MistralOcrDimensions {
  readonly dpi?: number;
  readonly height?: number;
  readonly width?: number;
}

export interface MistralOcrConfidenceScores {
  readonly averagePageConfidenceScore?: number;
  readonly minimumPageConfidenceScore?: number;
}

export interface MistralOcrBlock {
  readonly type: string;
  readonly content: string;
  readonly topLeftX?: number;
  readonly topLeftY?: number;
  readonly bottomRightX?: number;
  readonly bottomRightY?: number;
  readonly tableId?: string;
  readonly imageId?: string;
}

export interface MistralOcrPage {
  readonly index: number;
  readonly markdown: string;
  readonly tables: ReadonlyArray<unknown>;
  readonly images: ReadonlyArray<unknown>;
  readonly hyperlinks: ReadonlyArray<unknown>;
  readonly header: string | null;
  readonly footer: string | null;
  readonly dimensions: MistralOcrDimensions | null;
  readonly confidence: MistralOcrConfidenceScores | null;
  readonly blocks: ReadonlyArray<MistralOcrBlock>;
}

export interface MistralOcrHashes {
  readonly sourceHash: string;
  readonly optionsHash: string;
  readonly ocrHash: string;
}

export interface MistralOcrResult extends MistralOcrHashes {
  readonly model: typeof MISTRAL_OCR_MODEL | string;
  readonly pages: ReadonlyArray<MistralOcrPage>;
  readonly markdown: string;
  readonly usage: MistralOcrUsage;
  readonly source: MistralOcrSource;
}
