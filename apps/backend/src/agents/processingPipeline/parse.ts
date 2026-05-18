import { Effect } from "effect";

export type NormalizedProcessingStep = "ocr" | "metadata" | "index";

export const normalizeStep = (step: string): NormalizedProcessingStep => {
  if (step === "ocr") return "ocr";
  if (step === "index" || step === "finalizing" || step === "complete") return "index";
  return "metadata";
};

export const parseStep = (step: string): Effect.Effect<NormalizedProcessingStep> =>
  Effect.succeed(normalizeStep(step));
