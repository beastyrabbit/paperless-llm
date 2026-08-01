import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import type { RuntimeToolCapability, SystemReadiness } from "@repo/api-contracts";
import { Effect } from "effect";
import { ConfigService } from "../../config/index.js";
import { defaultCodexHome } from "../../services/codex/auth.js";
import { CODEX_EXECUTABLE, CODEX_MODEL } from "../../services/codex/types.js";
import { MISTRAL_OCR_MODEL } from "../../services/mistral-ocr/types.js";

const execFileAsync = promisify(execFile);

const normalizedVersion = (value: string): string | null => {
  const firstLine = value.trim().split(/\r?\n/, 1)[0]?.trim();
  return firstLine ? firstLine.slice(0, 160) : null;
};

const probeBinary = (
  executable: string,
  args: readonly string[],
): Effect.Effect<RuntimeToolCapability, never> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout, stderr } = await execFileAsync(executable, [...args], {
        timeout: 5_000,
        maxBuffer: 8_192,
        encoding: "utf8",
      });
      return {
        status: "available" as const,
        version: normalizedVersion(stdout || stderr),
      };
    },
    catch: () => new Error(`${executable} is unavailable`),
  }).pipe(
    Effect.catchAll(() =>
      Effect.succeed({
        status: "missing" as const,
        version: null,
      }),
    ),
  );

const codexAuthAvailable = (): Effect.Effect<boolean, never> =>
  Effect.tryPromise({
    try: async () => {
      const auth = await stat(`${defaultCodexHome()}/auth.json`);
      return auth.isFile() && auth.size > 0;
    },
    catch: () => new Error("Codex authentication is unavailable"),
  }).pipe(Effect.catchAll(() => Effect.succeed(false)));

export const getSystemReadiness: Effect.Effect<SystemReadiness, never, ConfigService> = Effect.gen(
  function* () {
    const config = yield* ConfigService;
    const [codexBinary, ocrmypdf, authenticated] = yield* Effect.all(
      [
        probeBinary(CODEX_EXECUTABLE, ["--version"]),
        probeBinary("ocrmypdf", ["--version"]),
        codexAuthAvailable(),
      ],
      { concurrency: "unbounded" },
    );

    const codex = { ...codexBinary, authenticated };
    const scanner = config.config.cutover.scanner;
    const blockers: string[] = [];
    if (!config.config.paperless.url || !config.config.paperless.token) {
      blockers.push("Paperless configuration is incomplete.");
    }
    if (!config.config.mistral.apiKey) {
      blockers.push("Mistral API key is unavailable.");
    }
    if (config.config.cutover.mutationMode !== "paperless_first") {
      blockers.push("Mutation mode is not paperless_first.");
    }
    if (scanner.aiAnalyseTagId <= 0) {
      blockers.push("The ai-analyse Paperless tag ID is not configured.");
    }
    if (codex.status !== "available") {
      blockers.push("Codex CLI is unavailable.");
    } else if (!codex.authenticated) {
      blockers.push("Codex CLI authentication is unavailable.");
    }
    if (ocrmypdf.status !== "available") {
      blockers.push("OCRmyPDF is unavailable.");
    }

    const analysisReady = blockers.length === 0;
    return {
      status: analysisReady ? "ready" : "blocked",
      analysisReady,
      configurationSource: "environment",
      mutationMode: config.config.cutover.mutationMode,
      scanner: {
        scope: scanner.scope,
        aiAnalyseTagId: scanner.aiAnalyseTagId > 0 ? scanner.aiAnalyseTagId : null,
        canaryDocumentCount: scanner.canaryDocumentIds.length,
      },
      providers: {
        paperless: {
          configured: Boolean(config.config.paperless.url && config.config.paperless.token),
          url: config.config.paperless.url,
        },
        mistral: {
          configured: Boolean(config.config.mistral.apiKey),
          model: MISTRAL_OCR_MODEL,
        },
        ollama: {
          configured: Boolean(config.config.ollama.url),
          url: config.config.ollama.url,
          model: config.config.ollama.model,
          embeddingModel: config.config.ollama.embeddingModel,
        },
        qdrant: {
          configured: Boolean(config.config.qdrant.url),
          url: config.config.qdrant.url,
          collection: config.config.qdrant.collectionName,
          embeddingDimension: config.config.qdrant.embeddingDimension,
        },
      },
      codex: {
        model: CODEX_MODEL,
        documentReasoningEffort: "medium",
        catalogReviewerReasoningEffort: "high",
        catalogChairReasoningEffort: "xhigh",
      },
      tools: { codex, ocrmypdf },
      blockers,
      checkedAt: new Date().toISOString(),
    };
  },
);
