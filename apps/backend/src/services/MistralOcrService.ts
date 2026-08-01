import { Context, Effect, Layer } from "effect";
import { ConfigService } from "../config/index.js";
import { ConcurrencyLimitService } from "./ConcurrencyLimitService.js";
import { processMistralOcrPdf } from "./mistral-ocr/client.js";
import type { MistralOcrError } from "./mistral-ocr/errors.js";
import type { MistralOcrPdfInput, MistralOcrResult } from "./mistral-ocr/types.js";

export type {
  MistralOcrBlock,
  MistralOcrConfidenceScores,
  MistralOcrDimensions,
  MistralOcrOptions,
  MistralOcrPage,
  MistralOcrPdfInput,
  MistralOcrResult,
  MistralOcrUsage,
} from "./mistral-ocr/types.js";
export { MISTRAL_OCR_MODEL } from "./mistral-ocr/types.js";
export { MistralOcrError } from "./mistral-ocr/errors.js";

export interface MistralOcrService {
  readonly processPdf: (
    input: MistralOcrPdfInput,
  ) => Effect.Effect<MistralOcrResult, MistralOcrError>;
}

export const MistralOcrService = Context.GenericTag<MistralOcrService>("MistralOcrService");

export const MistralOcrServiceLive = Layer.effect(
  MistralOcrService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const concurrency = yield* ConcurrencyLimitService;

    return {
      processPdf: (input) =>
        processMistralOcrPdf(input).pipe(
          Effect.provideService(ConfigService, configService),
          Effect.provideService(ConcurrencyLimitService, concurrency),
        ),
    } satisfies MistralOcrService;
  }),
);
