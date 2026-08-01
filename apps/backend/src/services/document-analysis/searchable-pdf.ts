import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Effect } from "effect";
import { DocumentAnalysisOrchestrationError } from "./errors.js";

export interface SearchablePdfGenerator {
  readonly generate: (
    input: Uint8Array,
    options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal },
  ) => Effect.Effect<Uint8Array, DocumentAnalysisOrchestrationError>;
}

export interface SearchablePdfGeneratorOptions {
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly termGraceMs?: number;
  readonly maxOutputBytes?: number;
  readonly spawnProcess?: typeof spawn;
}

const runOcrMyPdf = (
  spawnProcess: typeof spawn,
  command: string,
  inputPath: string,
  outputPath: string,
  timeoutMs: number,
  termGraceMs: number,
  signal?: AbortSignal,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawnProcess(command, [
      "--skip-text",
      "--deskew",
      "--rotate-pages",
      "--output-type",
      "pdf",
      inputPath,
      outputPath,
    ], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let killTimer: NodeJS.Timeout | null = null;
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const terminate = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), termGraceMs);
    };
    const abort = () => {
      terminate();
      finish(() =>
        reject(
          new DocumentAnalysisOrchestrationError(
            "CANCELED",
            "OCRmyPDF generation was cancelled.",
            false,
          ),
        ),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      terminate();
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new Error("OCRmyPDF timed out")));
      }, termGraceMs);
    }, timeoutMs);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-2_000);
    });
    child.on("error", (error) => {
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(`OCRmyPDF failed with exit code ${code ?? "unknown"}: ${stderr}`)));
    });
  });

export const makeOcrMyPdfGenerator = (
  options: SearchablePdfGeneratorOptions = {},
): SearchablePdfGenerator => {
  const command = options.command ?? "ocrmypdf";
  const defaultTimeoutMs = options.timeoutMs ?? 120_000;
  const termGraceMs = options.termGraceMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 100 * 1024 * 1024;
  const spawnProcess = options.spawnProcess ?? spawn;
  return {
    generate: (input, callOptions) =>
      Effect.tryPromise({
        try: async () => {
          const dir = await mkdtemp(path.join(tmpdir(), "paperless-local-llm-ocrmypdf-"));
          const inputPath = path.join(dir, "input.pdf");
          const outputPath = path.join(dir, "output.pdf");
          try {
            await writeFile(inputPath, input);
            await runOcrMyPdf(
              spawnProcess,
              command,
              inputPath,
              outputPath,
              callOptions?.timeoutMs ?? defaultTimeoutMs,
              termGraceMs,
              callOptions?.signal,
            );
            const output = await readFile(outputPath);
            if (output.byteLength > maxOutputBytes) {
              throw new Error("OCRmyPDF output exceeded configured byte limit");
            }
            return new Uint8Array(output);
          } finally {
            await rm(dir, { recursive: true, force: true });
          }
        },
        catch: (error) =>
          new DocumentAnalysisOrchestrationError(
            "PROVIDER_FAILURE",
            error instanceof Error ? error.message : String(error),
            true,
            error,
          ),
      }),
  };
};
