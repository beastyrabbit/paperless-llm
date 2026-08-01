import { MistralOcrError } from "./errors.js";

export type MistralOcrPages = string | ReadonlyArray<number>;

const pageRangePattern = /^\d+(?:-\d+)?$/;

export const normalizePages = (
  pages: MistralOcrPages | undefined,
): ReadonlyArray<number> | undefined => {
  if (pages === undefined || pages === null) return undefined;

  const parsed: ReadonlyArray<number> =
    typeof pages === "string"
      ? pages
          .split(",")
          .map((part: string) => part.trim())
          .filter((part: string) => part.length > 0)
          .flatMap((part: string): ReadonlyArray<number> => {
            if (!pageRangePattern.test(part)) {
              throw new MistralOcrError({
                kind: "validation",
                message: "Mistral OCR pages must be zero-based page numbers or ranges",
              });
            }
            const [startText, endText] = part.split("-");
            const start = Number(startText);
            const end = endText === undefined ? start : Number(endText);
            if (end < start) {
              throw new MistralOcrError({
                kind: "validation",
                message: "Mistral OCR page ranges must be ascending",
              });
            }
            return Array.from({ length: end - start + 1 }, (_value, index) => start + index);
          })
      : pages;

  if (parsed.length === 0) {
    throw new MistralOcrError({
      kind: "validation",
      message: "Mistral OCR pages cannot be empty",
    });
  }

  for (const page of parsed) {
    if (!Number.isInteger(page) || page < 0) {
      throw new MistralOcrError({
        kind: "validation",
        message: "Mistral OCR pages must be zero-based non-negative integers",
      });
    }
  }

  return [...new Set(parsed)].sort((left, right) => left - right);
};
