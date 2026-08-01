import { z } from "zod";
import { MistralOcrError } from "./errors.js";
import type {
  MistralOcrBlock,
  MistralOcrConfidenceScores,
  MistralOcrDimensions,
  MistralOcrPage,
  MistralOcrResult,
  MistralOcrSource,
  MistralOcrUsage,
} from "./types.js";

const NullableString = z.string().nullable().optional();

const RawDimensionsSchema = z
  .object({
    dpi: z.number().optional(),
    height: z.number().optional(),
    width: z.number().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const RawConfidenceScoresSchema = z
  .object({
    average_page_confidence_score: z.number().optional(),
    minimum_page_confidence_score: z.number().optional(),
    word_confidence_scores: z.unknown().optional(),
  })
  .passthrough()
  .nullable()
  .optional();

const RawBlockSchema = z
  .object({
    type: z.string(),
    content: z.string().optional(),
    top_left_x: z.number().optional(),
    top_left_y: z.number().optional(),
    bottom_right_x: z.number().optional(),
    bottom_right_y: z.number().optional(),
    table_id: z.union([z.string(), z.number()]).optional(),
    image_id: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const RawPageSchema = z
  .object({
    index: z.number().int().nonnegative(),
    markdown: z.string(),
    images: z.array(z.unknown()).optional(),
    tables: z.array(z.unknown()).optional(),
    hyperlinks: z.array(z.unknown()).optional(),
    header: NullableString,
    footer: NullableString,
    dimensions: RawDimensionsSchema,
    confidence_scores: RawConfidenceScoresSchema,
    blocks: z.array(RawBlockSchema).nullable().optional(),
  })
  .passthrough();

const RawUsageInfoSchema = z
  .object({
    pages_processed: z.number().int().nonnegative().optional(),
    doc_size_bytes: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough()
  .optional();

const RawOcrResponseSchema = z
  .object({
    pages: z.array(RawPageSchema),
    model: z.string(),
    document_annotation: z.unknown().optional(),
    usage_info: RawUsageInfoSchema,
  })
  .passthrough();

type RawDimensions = z.infer<typeof RawDimensionsSchema>;
type RawConfidenceScores = z.infer<typeof RawConfidenceScoresSchema>;
type RawBlock = z.infer<typeof RawBlockSchema>;
type RawPage = z.infer<typeof RawPageSchema>;

const normalizeDimensions = (dimensions: RawDimensions): MistralOcrDimensions | null =>
  dimensions
    ? {
        dpi: dimensions.dpi,
        height: dimensions.height,
        width: dimensions.width,
      }
    : null;

const normalizeConfidence = (
  confidenceScores: RawConfidenceScores,
): MistralOcrConfidenceScores | null =>
  confidenceScores
    ? {
        averagePageConfidenceScore: confidenceScores.average_page_confidence_score,
        minimumPageConfidenceScore: confidenceScores.minimum_page_confidence_score,
      }
    : null;

const normalizeBlock = (block: RawBlock): MistralOcrBlock => ({
  type: block.type,
  content: block.content ?? "",
  topLeftX: block.top_left_x,
  topLeftY: block.top_left_y,
  bottomRightX: block.bottom_right_x,
  bottomRightY: block.bottom_right_y,
  tableId: block.table_id === undefined ? undefined : String(block.table_id),
  imageId: block.image_id === undefined ? undefined : String(block.image_id),
});

const normalizePage = (page: RawPage): MistralOcrPage => ({
  index: page.index,
  markdown: page.markdown,
  tables: page.tables ?? [],
  images: page.images ?? [],
  hyperlinks: page.hyperlinks ?? [],
  header: page.header ?? null,
  footer: page.footer ?? null,
  dimensions: normalizeDimensions(page.dimensions),
  confidence: normalizeConfidence(page.confidence_scores),
  blocks: (page.blocks ?? []).map(normalizeBlock),
});

export const decodeMistralOcrResponse = (
  value: unknown,
  source: MistralOcrSource,
  hashes: {
    readonly sourceHash: string;
    readonly optionsHash: string;
    readonly ocrHash: string;
  },
): MistralOcrResult => {
  const parsed = RawOcrResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new MistralOcrError({
      kind: "schema",
      message: "Mistral OCR response did not match the expected schema",
      cause: parsed.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
        code: issue.code,
      })),
    });
  }

  const pages = parsed.data.pages.map(normalizePage);
  const usage: MistralOcrUsage = {
    pagesProcessed: parsed.data.usage_info?.pages_processed ?? pages.length,
    docSizeBytes: parsed.data.usage_info?.doc_size_bytes ?? null,
  };

  return {
    model: parsed.data.model,
    pages,
    markdown: pages.map((page) => page.markdown).join("\n\n"),
    usage,
    source,
    ...hashes,
  };
};

export const ocrHashPayload = (result: Omit<MistralOcrResult, "ocrHash">): unknown => ({
  model: result.model,
  pages: result.pages,
  markdown: result.markdown,
  usage: result.usage,
  sourceHash: result.sourceHash,
  optionsHash: result.optionsHash,
});
