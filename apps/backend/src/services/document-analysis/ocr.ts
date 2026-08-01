import { canonicalSha256, type Sha256Digest, sha256Hex, sourcePdfHash } from "@repo/api-contracts";
import { Effect } from "effect";
import { MISTRAL_OCR_MODEL, type MistralOcrResult, type MistralOcrService } from "../MistralOcrService.js";
import type { PaperlessService } from "../PaperlessService.js";
import type { PaperlessDocumentVersion } from "../paperless/types.js";

export const OCR_OPTIONS_VERSION = "mistral-ocr-options.v1" as const;

export interface ApprovedOcrVersion {
  readonly versionId: number;
  readonly sourceHash: Sha256Digest;
  readonly ocrHash: Sha256Digest;
  readonly contentHash: Sha256Digest;
  readonly model: string;
  readonly optionsVersion: string;
  readonly content: string;
}

export interface SourcePdfSelection {
  readonly versionId: number | null;
  readonly pdfBytes: Uint8Array;
  readonly sourceHash: Sha256Digest;
}

export interface OcrPreviewBlock {
  readonly blockId: string;
  readonly pageNumber: number;
  readonly text: string;
  readonly quoteHash: Sha256Digest;
}

export interface OcrPreview {
  readonly descriptor: string;
  readonly previewHash: Sha256Digest;
  readonly pageCount: number;
  readonly blockCount: number;
  readonly pages: ReadonlyArray<{
    readonly pageNumber: number;
    readonly blocks: readonly OcrPreviewBlock[];
  }>;
}

export interface OcrSelection {
  readonly source: SourcePdfSelection;
  readonly ocrHash: Sha256Digest;
  readonly contentHash: Sha256Digest;
  readonly model: string;
  readonly optionsVersion: string;
  readonly markdown: string;
  readonly preview: OcrPreview;
  readonly reusedVersion: ApprovedOcrVersion | null;
  readonly result: MistralOcrResult | null;
}

const ocrLabelPattern =
  /paperless-local-llm\s+approved-ocr\s+source:([a-f0-9]{64})\s+ocr:([a-f0-9]{64})\s+content:([a-f0-9]{64})\s+model:([A-Za-z0-9._-]+)\s+options:([A-Za-z0-9._-]+)/i;

export const ocrContentHash = (content: string): Sha256Digest => sha256Hex(content);

export const approvedOcrLabel = (
  sourceHash: Sha256Digest,
  ocrHash: Sha256Digest,
  contentHash: Sha256Digest,
  model: string = MISTRAL_OCR_MODEL,
  optionsVersion: string = OCR_OPTIONS_VERSION,
): string =>
  `paperless-local-llm approved-ocr source:${sourceHash} ocr:${ocrHash} content:${contentHash} model:${model} options:${optionsVersion}`;

const parseApprovedOcrVersion = (version: PaperlessDocumentVersion): ApprovedOcrVersion | null => {
  const label = String(version.label ?? version.version_label ?? "");
  const match = ocrLabelPattern.exec(label);
  const content = typeof version.content === "string" ? version.content : "";
  if (!match || content.length === 0) return null;
  const contentHash = ocrContentHash(content);
  if (contentHash !== match[3]) return null;
  return {
    versionId: version.id,
    sourceHash: match[1] as Sha256Digest,
    ocrHash: match[2] as Sha256Digest,
    contentHash,
    model: match[4] ?? "",
    optionsVersion: match[5] ?? "",
    content,
  };
};

export const findApprovedOcrVersion = (
  versions: readonly PaperlessDocumentVersion[],
  sourceHash: Sha256Digest,
  options: { readonly model?: string; readonly optionsVersion?: string } = {},
): ApprovedOcrVersion | null =>
  versions
    .map(parseApprovedOcrVersion)
    .filter((version): version is ApprovedOcrVersion => version !== null)
    .filter((version) => version.sourceHash === sourceHash)
    .filter((version) => version.model === (options.model ?? MISTRAL_OCR_MODEL))
    .filter((version) => version.optionsVersion === (options.optionsVersion ?? OCR_OPTIONS_VERSION))
    .sort((left, right) => right.versionId - left.versionId)[0] ?? null;

export const selectLatestOriginalSourcePdf = (
  paperless: PaperlessService,
  documentId: number,
): Effect.Effect<SourcePdfSelection, unknown> =>
  Effect.gen(function* () {
    const original = yield* paperless.selectOriginalPdfVersion(documentId);
    const pdfBytes = original
      ? yield* paperless.downloadVersionPdf(documentId, original.id)
      : yield* paperless.downloadPdf(documentId);
    return {
      versionId: original?.id ?? null,
      pdfBytes,
      sourceHash: sourcePdfHash(pdfBytes),
    };
  });

const splitTextBlocks = (
  text: string,
  pageNumber: number,
  maxBlocksPerPage: number,
): readonly OcrPreviewBlock[] => {
  const chunks = text
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\s+/g, " ").trim())
    .filter((chunk) => chunk.length > 0)
    .slice(0, maxBlocksPerPage);
  return chunks.map((chunk, index) => ({
    blockId: `p${pageNumber}-b${index + 1}`,
    pageNumber,
    text: chunk.slice(0, 700),
    quoteHash: sha256Hex(chunk),
  }));
};

export const buildOcrPreviewFromMarkdown = (
  markdown: string,
  pageMarkdown: readonly string[],
  options: { readonly maxPages?: number; readonly maxBlocksPerPage?: number } = {},
): OcrPreview => {
  const maxPages = options.maxPages ?? 5;
  const maxBlocksPerPage = options.maxBlocksPerPage ?? 6;
  const pages = (pageMarkdown.length > 0 ? pageMarkdown : [markdown])
    .slice(0, maxPages)
    .map((text, index) => ({
      pageNumber: index + 1,
      blocks: splitTextBlocks(text, index + 1, maxBlocksPerPage),
    }));
  const blockCount = pages.reduce((sum, page) => sum + page.blocks.length, 0);
  const previewHash = canonicalSha256(
    pages.map((page) => ({
      pageNumber: page.pageNumber,
      quoteHashes: page.blocks.map((block) => block.quoteHash),
    })),
  );
  return {
    descriptor: `OCR preview covers ${pages.length} pages and ${blockCount} blocks.`,
    previewHash,
    pageCount: Math.max(1, pages.length),
    blockCount,
    pages,
  };
};

export const selectOrRunOcr = (
  paperless: PaperlessService,
  mistralOcr: MistralOcrService,
  input: {
    readonly documentId: number;
    readonly forceOcr?: boolean;
  },
): Effect.Effect<OcrSelection, unknown> =>
  Effect.gen(function* () {
    const source = yield* selectLatestOriginalSourcePdf(paperless, input.documentId);
    const versions = yield* paperless.getDocumentVersions(input.documentId);
    const reusable = input.forceOcr ? null : findApprovedOcrVersion(versions, source.sourceHash);
    if (reusable) {
      return {
        source,
        ocrHash: reusable.ocrHash,
        contentHash: reusable.contentHash,
        model: reusable.model,
        optionsVersion: reusable.optionsVersion,
        markdown: reusable.content,
        preview: buildOcrPreviewFromMarkdown(reusable.content, [reusable.content]),
        reusedVersion: reusable,
        result: null,
      };
    }

    const result = yield* mistralOcr.processPdf({
      pdfBytes: source.pdfBytes,
      source: {
        id: `document-${input.documentId}`,
        fileName: `document-${input.documentId}.pdf`,
        mimeType: "application/pdf",
      },
    });
    return {
      source,
      ocrHash: result.ocrHash as Sha256Digest,
      contentHash: ocrContentHash(result.markdown),
      model: result.model,
      optionsVersion: OCR_OPTIONS_VERSION,
      markdown: result.markdown,
      preview: buildOcrPreviewFromMarkdown(
        result.markdown,
        result.pages.map((page) => page.markdown),
      ),
      reusedVersion: null,
      result,
    };
  });
