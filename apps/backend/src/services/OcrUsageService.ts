/**
 * OCR usage accounting and budget enforcement.
 */
import { Context, Effect, Layer } from "effect";
import { ConfigService } from "../config/index.js";
import { TinyBaseService } from "./TinyBaseService.js";

export class OcrBudgetExceededError {
  readonly _tag = "OcrBudgetExceededError";
  constructor(
    readonly message: string,
    readonly details: {
      readonly limitType: "daily_pages" | "run_pages" | "daily_tokens" | "run_tokens";
      readonly limit: number;
      readonly used: number;
      readonly requested: number;
      readonly runId: string;
    },
  ) {}
}

export interface OcrUsageBudget {
  readonly dailyPageLimit: number | null;
  readonly runPageLimit: number | null;
  readonly dailyTokenLimit: number | null;
  readonly runTokenLimit: number | null;
}

export interface OcrUsageReservationRequest {
  readonly runId: string;
  readonly docId?: number;
  readonly source: "ocr_agent" | "bulk_ocr" | "bulk_ingest" | "mistral_document";
  readonly estimatedPages: number;
  readonly estimatedTokens?: number;
  readonly model?: string;
}

export interface OcrUsageReservation {
  readonly id: string;
  readonly runId: string;
  readonly docId?: number;
  readonly source: OcrUsageReservationRequest["source"];
  readonly estimatedPages: number;
  readonly estimatedTokens: number;
  readonly date: string;
}

export interface OcrUsageCommit {
  readonly pages?: number;
  readonly tokens?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly model?: string;
}

export interface OcrUsageSnapshot {
  readonly dailyPagesUsed: number;
  readonly dailyTokensUsed: number;
  readonly runPagesUsed: number;
  readonly runTokensUsed: number;
  readonly dailyPageLimit: number | null;
  readonly runPageLimit: number | null;
  readonly dailyTokenLimit: number | null;
  readonly runTokenLimit: number | null;
}

export interface OcrUsageService {
  readonly getBudget: () => Effect.Effect<OcrUsageBudget, never>;
  readonly reserve: (
    request: OcrUsageReservationRequest,
  ) => Effect.Effect<OcrUsageReservation, OcrBudgetExceededError>;
  readonly commit: (reservation: OcrUsageReservation, usage: OcrUsageCommit) => Effect.Effect<void>;
  readonly release: (reservation: OcrUsageReservation, reason?: string) => Effect.Effect<void>;
  readonly getSnapshot: (runId: string) => Effect.Effect<OcrUsageSnapshot>;
  readonly withReservation: <A, E, R>(
    request: OcrUsageReservationRequest,
    use: (reservation: OcrUsageReservation) => Effect.Effect<{ readonly value: A; readonly usage: OcrUsageCommit }, E, R>,
  ) => Effect.Effect<A, E | OcrBudgetExceededError, R>;
  readonly estimatePdfPages: (pdfBytes: Uint8Array) => number;
  readonly estimateOcrTokens: (pdfBytes: Uint8Array, prompt?: string) => number;
}

export const OcrUsageService = Context.GenericTag<OcrUsageService>("OcrUsageService");

const tableName = "ocrUsageEvents";

const todayKey = (): string => new Date().toISOString().slice(0, 10);
const positiveIntOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const configuredBudgetLimit = (override: unknown, fallback: number | null): number | null => {
  if (override === undefined || override === null || override === "") return fallback;
  return positiveIntOrNull(override) ?? fallback;
};

export const estimateOcrTokens = (pdfBytes: Uint8Array, prompt = ""): number => {
  // Conservative pre-call estimate: OCR requests embed the PDF as base64 plus a small JSON/prompt envelope.
  // This intentionally overestimates text tokens so configured token caps can be enforced before vendor calls.
  const base64Chars = Math.ceil(pdfBytes.byteLength / 3) * 4;
  const promptChars = prompt.length;
  const envelopeChars = 1_024;
  return Math.max(1, Math.ceil((base64Chars + promptChars + envelopeChars) / 2));
};

export const estimatePdfPages = (pdfBytes: Uint8Array): number => {
  const text = Buffer.from(pdfBytes).toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b(?!s)/g);
  return Math.max(1, matches?.length ?? 1);
};

export const OcrUsageServiceLive = Layer.effect(
  OcrUsageService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const tinybase = yield* TinyBaseService;
    const mutex = yield* Effect.makeSemaphore(1);

    const getBudget = (): Effect.Effect<OcrUsageBudget, never> =>
      tinybase.getAllSettings().pipe(
        Effect.map((settings) => ({
          dailyPageLimit: configuredBudgetLimit(
            settings["ocr_budget.daily_page_limit"] ?? settings["ocrBudget.dailyPageLimit"],
            configService.config.ocrBudget.dailyPageLimit,
          ),
          runPageLimit: configuredBudgetLimit(
            settings["ocr_budget.run_page_limit"] ?? settings["ocrBudget.runPageLimit"],
            configService.config.ocrBudget.runPageLimit,
          ),
          dailyTokenLimit: configuredBudgetLimit(
            settings["ocr_budget.daily_token_limit"] ?? settings["ocrBudget.dailyTokenLimit"],
            configService.config.ocrBudget.dailyTokenLimit,
          ),
          runTokenLimit: configuredBudgetLimit(
            settings["ocr_budget.run_token_limit"] ?? settings["ocrBudget.runTokenLimit"],
            configService.config.ocrBudget.runTokenLimit,
          ),
        })),
        Effect.catchAll(() =>
          Effect.succeed({
            dailyPageLimit: positiveIntOrNull(configService.config.ocrBudget.dailyPageLimit),
            runPageLimit: positiveIntOrNull(configService.config.ocrBudget.runPageLimit),
            dailyTokenLimit: positiveIntOrNull(configService.config.ocrBudget.dailyTokenLimit),
            runTokenLimit: positiveIntOrNull(configService.config.ocrBudget.runTokenLimit),
          }),
        ),
      );

    const readUsed = (runId: string, date = todayKey()) => {
      let dailyPagesUsed = 0;
      let dailyTokensUsed = 0;
      let runPagesUsed = 0;
      let runTokensUsed = 0;
      for (const row of Object.values(tinybase.store.getTable(tableName) ?? {})) {
        if (row["date"] !== date) continue;
        const status = row["status"];
        if (status !== "reserved" && status !== "committed") continue;
        const pages = Number(row[status === "reserved" ? "estimatedPages" : "pages"] ?? 0);
        const tokens = Number(row[status === "reserved" ? "estimatedTokens" : "tokens"] ?? 0);
        dailyPagesUsed += Number.isFinite(pages) ? pages : 0;
        dailyTokensUsed += Number.isFinite(tokens) ? tokens : 0;
        if (row["runId"] === runId) {
          runPagesUsed += Number.isFinite(pages) ? pages : 0;
          runTokensUsed += Number.isFinite(tokens) ? tokens : 0;
        }
      }
      return { dailyPagesUsed, dailyTokensUsed, runPagesUsed, runTokensUsed };
    };

    const reserve = (request: OcrUsageReservationRequest) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          const budget = yield* getBudget();
          const estimatedPages = Math.max(1, Math.floor(request.estimatedPages));
          const estimatedTokens = Math.max(0, Math.floor(request.estimatedTokens ?? 0));
          const used = readUsed(request.runId);
          if (
            estimatedTokens <= 0 &&
            (budget.dailyTokenLimit !== null || budget.runTokenLimit !== null)
          ) {
            return yield* Effect.fail(
              new OcrBudgetExceededError(
                "OCR token budget cannot be enforced without a positive token estimate",
                {
                  limitType: budget.dailyTokenLimit !== null ? "daily_tokens" : "run_tokens",
                  limit: budget.dailyTokenLimit ?? budget.runTokenLimit ?? 0,
                  used: budget.dailyTokenLimit !== null ? used.dailyTokensUsed : used.runTokensUsed,
                  requested: estimatedTokens,
                  runId: request.runId,
                },
              ),
            );
          }

          const failIfExceeded = (
            limitType: OcrBudgetExceededError["details"]["limitType"],
            limit: number | null,
            current: number,
            requested: number,
          ) => {
            if (limit !== null && current + requested > limit) {
              return new OcrBudgetExceededError(
                `OCR budget exceeded: ${limitType} limit ${limit}, used ${current}, requested ${requested}`,
                { limitType, limit, used: current, requested, runId: request.runId },
              );
            }
            return null;
          };

          const exceeded =
            failIfExceeded("daily_pages", budget.dailyPageLimit, used.dailyPagesUsed, estimatedPages) ??
            failIfExceeded("run_pages", budget.runPageLimit, used.runPagesUsed, estimatedPages) ??
            failIfExceeded("daily_tokens", budget.dailyTokenLimit, used.dailyTokensUsed, estimatedTokens) ??
            failIfExceeded("run_tokens", budget.runTokenLimit, used.runTokensUsed, estimatedTokens);
          if (exceeded) return yield* Effect.fail(exceeded);

          const reservation: OcrUsageReservation = {
            id: `ocr-usage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            runId: request.runId,
            docId: request.docId,
            source: request.source,
            estimatedPages,
            estimatedTokens,
            date: todayKey(),
          };
          tinybase.store.setRow(tableName, reservation.id, {
            ...reservation,
            docId: request.docId ?? 0,
            model: request.model ?? "",
            pages: 0,
            tokens: 0,
            promptTokens: 0,
            completionTokens: 0,
            status: "reserved",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            reason: "",
          });
          return reservation;
        }),
      );

    const commit = (reservation: OcrUsageReservation, usage: OcrUsageCommit) =>
      mutex.withPermits(1)(
        Effect.sync(() => {
          const row = tinybase.store.getRow(tableName, reservation.id);
          if (!row || row["status"] !== "reserved") return;
          tinybase.store.setPartialRow(tableName, reservation.id, {
            status: "committed",
            pages: Math.max(0, Math.floor(usage.pages ?? reservation.estimatedPages)),
            tokens: Math.max(0, Math.floor(usage.tokens ?? reservation.estimatedTokens)),
            promptTokens: Math.max(0, Math.floor(usage.promptTokens ?? 0)),
            completionTokens: Math.max(0, Math.floor(usage.completionTokens ?? 0)),
            model: usage.model ?? row["model"] ?? "",
            updatedAt: new Date().toISOString(),
          });
        }),
      );

    const release = (reservation: OcrUsageReservation, reason = "released") =>
      mutex.withPermits(1)(
        Effect.sync(() => {
          const row = tinybase.store.getRow(tableName, reservation.id);
          if (!row || row["status"] !== "reserved") return;
          tinybase.store.setPartialRow(tableName, reservation.id, {
            status: "released",
            reason,
            updatedAt: new Date().toISOString(),
          });
        }),
      );

    const getSnapshot = (runId: string) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          const budget = yield* getBudget();
          return { ...readUsed(runId), ...budget };
        }),
      );

    return {
      getBudget,
      reserve,
      commit,
      release,
      getSnapshot,
      estimatePdfPages,
      estimateOcrTokens,
      withReservation: (request, use) =>
        Effect.gen(function* () {
          const reservation = yield* reserve(request);
          const result = yield* Effect.either(use(reservation));
          if (result._tag === "Left") {
            yield* release(reservation, "interrupted_or_failed");
            return yield* Effect.fail(result.left);
          }
          yield* commit(reservation, result.right.usage);
          return result.right.value;
        }),
    } satisfies OcrUsageService;
  }),
);
