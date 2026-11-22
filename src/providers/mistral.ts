import { z } from "zod";
import type { Config } from "../config/index.js";
import type { DB } from "../db/db.js";
import { endpoint, fetchJson } from "../util.js";

const ocrResponse = z.object({
  pages: z.array(z.object({ index: z.number().int().nonnegative(), markdown: z.string() })).min(1),
  usage_info: z
    .object({ pages_processed: z.number().int().positive(), doc_size_bytes: z.number().optional() })
    .optional(),
});
export type OcrResult = { text: string; pages: number; response: unknown };
export class BudgetExhaustedError extends Error {
  constructor() {
    super("Daily OCR page budget exhausted");
  }
}
export function dailyPages(db: DB, date = new Date().toISOString().slice(0, 10)): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(CAST(json_extract(usage_json,'$.reservedPages') AS INTEGER)),0) AS pages FROM jobs WHERE stage='ocr' AND json_extract(usage_json,'$.budgetDate')=?",
    )
    .get(date) as { pages: number };
  return row.pages;
}
export function assertPageBudget(db: DB, max: number, pages: number) {
  if (!Number.isInteger(pages) || pages <= 0)
    throw new Error("A known positive page count is required before paid OCR");
  if (pages > max) throw new Error("Document page count exceeds daily OCR page budget");
  if (dailyPages(db) + pages > max) throw new BudgetExhaustedError();
}
export class MistralClient {
  constructor(
    readonly config: Config["ocr"],
    private readonly key: string,
    private readonly request: typeof fetch = fetch,
  ) {}
  async ocr(pdf: Uint8Array, maxPages: number): Promise<OcrResult> {
    if (!Number.isInteger(maxPages) || maxPages <= 0)
      throw new Error("OCR page reservation required");
    const response = ocrResponse.parse(
      await fetchJson(
        this.request,
        endpoint(this.config.mistralApiBaseUrl.replace(/\/v1\/?$/, ""), "/v1/ocr"),
        {
          method: "POST",
          headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: this.config.mistralModel,
            document: {
              type: "document_url",
              document_url: `data:application/pdf;base64,${Buffer.from(pdf).toString("base64")}`,
            },
            include_image_base64: false,
            pages: Array.from({ length: maxPages }, (_, index) => index),
          }),
        },
        "Mistral",
        Math.min(600_000, this.config.timeoutMs + this.config.perPageTimeoutMs * maxPages),
      ),
    );
    if (response.usage_info && response.usage_info.pages_processed !== response.pages.length)
      throw new Error("Mistral page count mismatch");
    if (response.pages.length > maxPages) throw new Error("Mistral exceeded reserved page count");
    if (
      response.pages.some((page) => page.index >= maxPages) ||
      new Set(response.pages.map((page) => page.index)).size !== response.pages.length
    )
      throw new Error("Mistral returned invalid page indices");
    return {
      text: response.pages.map((page) => `[Page ${page.index + 1}]\n${page.markdown}`).join("\n\n"),
      pages: response.pages.length,
      response,
    };
  }
}
