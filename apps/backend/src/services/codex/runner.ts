import { spawn as nodeSpawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import { copyCodexAuthOnly, defaultCodexHome } from "./auth.js";
import { CodexRuntimeError } from "./errors.js";
import { redactedEnvSummary, redactText } from "./redaction.js";
import {
  CODEX_EXECUTABLE,
  CODEX_MODEL,
  CODEX_REASONING_EFFORTS,
  type CodexProcessSpawner,
  type CodexReasoningEffort,
  type CodexRunRequest,
  type CodexRunResult,
  type CodexRuntimeOptions,
  type CodexRuntimeService,
} from "./types.js";
import { extractUsageFromJsonl } from "./usage.js";

const defaultTimeoutMs = 120_000;
const defaultStdoutMaxBytes = 1024 * 1024;
const defaultStderrMaxBytes = 256 * 1024;
const defaultTermGraceMs = 1_000;

interface CappedCollector {
  readonly append: (chunk: Buffer | string) => boolean;
  readonly read: () => string;
  readonly bytes: () => number;
}

const createCappedCollector = (maxBytes: number): CappedCollector => {
  const chunks: Buffer[] = [];
  let total = 0;
  return {
    append: (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.byteLength;
      if (total <= maxBytes) {
        chunks.push(buffer);
      } else {
        const remaining = Math.max(0, maxBytes - (total - buffer.byteLength));
        if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      }
      return total <= maxBytes;
    },
    read: () => Buffer.concat(chunks).toString("utf8"),
    bytes: () => total,
  };
};

const isAllowedReasoningEffort = (value: string): value is CodexReasoningEffort =>
  (CODEX_REASONING_EFFORTS as readonly string[]).includes(value);

const jsonStringConfig = (value: string): string => JSON.stringify(value);

const strictSchemaError = (path: string, message: string): CodexRuntimeError =>
  new CodexRuntimeError({
    code: "CODEX_INVALID_REQUEST",
    message: `Codex output schema is not strict-compatible at ${path}: ${message}`,
  });

/**
 * Codex structured output uses OpenAI strict JSON Schema. In that subset every
 * object key must be required and objects must reject additional properties.
 * Effect's `Schema.Unknown` and optional fields otherwise fail only after the
 * paid provider request has been submitted.
 */
export const assertStrictCodexJsonSchema = (schema: unknown): void => {
  const visit = (value: unknown, schemaPath: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        visit(item, `${schemaPath}[${index}]`);
      });
      return;
    }
    if (!value || typeof value !== "object") return;

    const node = value as Record<string, unknown>;
    if (node["$id"] === "/schemas/unknown" || node["title"] === "unknown") {
      throw strictSchemaError(schemaPath, "unconstrained values are not supported");
    }
    if (node["type"] === "object") {
      const properties =
        node["properties"] && typeof node["properties"] === "object"
          ? (node["properties"] as Record<string, unknown>)
          : {};
      if (node["additionalProperties"] !== false) {
        throw strictSchemaError(schemaPath, "additionalProperties must be false");
      }
      const required = new Set(
        Array.isArray(node["required"])
          ? node["required"].filter((item): item is string => typeof item === "string")
          : [],
      );
      const missing = Object.keys(properties).filter((key) => !required.has(key));
      if (missing.length > 0) {
        throw strictSchemaError(
          schemaPath,
          `all properties must be required; missing ${missing.join(", ")}`,
        );
      }
    }

    for (const [key, child] of Object.entries(node)) {
      if (key !== "description") visit(child, `${schemaPath}.${key}`);
    }
  };

  visit(schema, "$");
};

const isolatedEnv = (codexHome: string, home: string): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env["PATH"] ?? "",
    HOME: home,
    CODEX_HOME: codexHome,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    NO_COLOR: "1",
    CI: "1",
  };
  if (process.env["LANG"]) env["LANG"] = process.env["LANG"];
  if (process.env["LC_ALL"]) env["LC_ALL"] = process.env["LC_ALL"];
  return env;
};

const writeSchemaFile = async (cwd: string, jsonSchema: unknown): Promise<string> => {
  const schemaPath = path.join(cwd, "structured-output.schema.json");
  await fs.writeFile(schemaPath, `${JSON.stringify(jsonSchema)}\n`, { mode: 0o600 });
  return schemaPath;
};

const readOutputFile = async (outputPath: string): Promise<string> => {
  try {
    return await fs.readFile(outputPath, "utf8");
  } catch {
    return "";
  }
};

const parseAndValidate = <A, I>(rawOutput: string, schema: Schema.Schema<A, I, never>): A => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch (error) {
    throw new CodexRuntimeError({
      code: "CODEX_STRUCTURED_OUTPUT_INVALID",
      message: "Codex final response was not valid JSON.",
      cause: error,
      details: { outputPreview: redactText(rawOutput.slice(0, 2_000)) },
    });
  }

  const decoded = Schema.decodeUnknownEither(schema)(parsed);
  if (decoded._tag === "Left") {
    throw new CodexRuntimeError({
      code: "CODEX_STRUCTURED_OUTPUT_INVALID",
      message: "Codex final response did not match the required structured output schema.",
      cause: decoded.left,
      details: { outputPreview: redactText(rawOutput.slice(0, 2_000)) },
    });
  }
  return decoded.right;
};

interface RuntimePaths {
  readonly root: string;
  readonly cwd: string;
  readonly home: string;
  readonly codexHome: string;
}

const makeRuntimePaths = async (tmpRoot?: string): Promise<RuntimePaths> => {
  const root = await fs.mkdtemp(path.join(tmpRoot ?? os.tmpdir(), "paperless-codex-"));
  const cwd = path.join(root, "workspace");
  const home = path.join(root, "home");
  const codexHome = path.join(root, "codex-home");
  await fs.mkdir(cwd, { recursive: true, mode: 0o700 });
  await fs.mkdir(home, { recursive: true, mode: 0o700 });
  await fs.mkdir(codexHome, { recursive: true, mode: 0o700 });
  return { root, cwd, home, codexHome };
};

const cleanupRuntimePaths = async (paths: RuntimePaths): Promise<void> => {
  await fs.rm(paths.root, { recursive: true, force: true });
};

const buildArgv = (
  request: Required<Pick<CodexRunRequest, "reasoningEffort">> & {
    readonly schemaPath: string;
    readonly outputPath: string;
    readonly cwd: string;
  },
): readonly string[] => [
  "exec",
  "--model",
  CODEX_MODEL,
  "--config",
  `model_reasoning_effort=${jsonStringConfig(request.reasoningEffort)}`,
  "--config",
  'shell_environment_policy.inherit="none"',
  "--sandbox",
  "read-only",
  "--cd",
  request.cwd,
  "--skip-git-repo-check",
  "--ephemeral",
  "--ignore-user-config",
  "--ignore-rules",
  "--output-schema",
  request.schemaPath,
  "--output-last-message",
  request.outputPath,
  "--json",
  "--color",
  "never",
  "-",
];

const terminateProcess = (
  child: ReturnType<CodexProcessSpawner>,
  graceMs: number,
  onKill: () => void,
): NodeJS.Timeout => {
  if (!child.killed) child.kill("SIGTERM");
  return setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      onKill();
      child.kill("SIGKILL");
    }
  }, graceMs);
};

const runCodexProcess = async <A, I>(
  rawRequest: CodexRunRequest<A, I>,
  options: CodexRuntimeOptions,
): Promise<CodexRunResult<A>> => {
  const reasoningEffort = rawRequest.reasoningEffort ?? "high";
  if (!isAllowedReasoningEffort(reasoningEffort)) {
    throw new CodexRuntimeError({
      code: "CODEX_INVALID_REQUEST",
      message: `Unsupported Codex reasoning effort: ${reasoningEffort}`,
    });
  }
  if (rawRequest.prompt.trim().length === 0) {
    throw new CodexRuntimeError({
      code: "CODEX_INVALID_REQUEST",
      message: "Codex prompt must not be empty.",
    });
  }
  assertStrictCodexJsonSchema(rawRequest.jsonSchema);

  const paths = await makeRuntimePaths(options.tmpRoot);
  try {
    const authFiles = await copyCodexAuthOnly(
      options.codexHome ?? defaultCodexHome(),
      paths.codexHome,
    );
    const schemaPath = await writeSchemaFile(paths.cwd, rawRequest.jsonSchema);
    const outputPath = path.join(paths.cwd, "last-message.json");
    const args = buildArgv({ reasoningEffort, schemaPath, outputPath, cwd: paths.cwd });
    const env = isolatedEnv(paths.codexHome, paths.home);
    const spawn = options.spawn ?? nodeSpawn;
    const stdout = createCappedCollector(
      rawRequest.stdoutMaxBytes ?? options.stdoutMaxBytes ?? defaultStdoutMaxBytes,
    );
    const stderr = createCappedCollector(
      rawRequest.stderrMaxBytes ?? options.stderrMaxBytes ?? defaultStderrMaxBytes,
    );
    const timeoutMs = rawRequest.timeoutMs ?? options.defaultTimeoutMs ?? defaultTimeoutMs;
    const termGraceMs = options.termGraceMs ?? defaultTermGraceMs;
    let killTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let killedAfterTerm = false;
    const state: {
      settledBy: "exit" | "timeout" | "canceled" | "stdout_cap" | "stderr_cap";
    } = { settledBy: "exit" };

    const child = spawn(CODEX_EXECUTABLE, args, {
      cwd: paths.cwd,
      env,
      shell: false,
      windowsHide: true,
    });

    const redactedLog = {
      command: CODEX_EXECUTABLE,
      args,
      shell: false,
      cwd: paths.cwd,
      env: redactedEnvSummary(env),
      model: CODEX_MODEL,
      reasoningEffort,
      structuredOutputKind: rawRequest.structuredOutputKind,
      authFiles,
    } as const;

    const capAndTerminate = (streamName: "stdout" | "stderr") => {
      if (state.settledBy === "exit") {
        state.settledBy = streamName === "stdout" ? "stdout_cap" : "stderr_cap";
        killTimer = terminateProcess(child, termGraceMs, () => {
          killedAfterTerm = true;
        });
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (!stdout.append(chunk)) capAndTerminate("stdout");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!stderr.append(chunk)) capAndTerminate("stderr");
    });
    child.stdin.end(rawRequest.prompt);

    const exit = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        const abort = () => {
          if (state.settledBy === "exit") state.settledBy = "canceled";
          killTimer = terminateProcess(child, termGraceMs, () => {
            killedAfterTerm = true;
          });
        };

        timeoutTimer = setTimeout(() => {
          if (state.settledBy === "exit") state.settledBy = "timeout";
          killTimer = terminateProcess(child, termGraceMs, () => {
            killedAfterTerm = true;
          });
        }, timeoutMs);

        rawRequest.signal?.addEventListener("abort", abort, { once: true });
        child.once("error", reject);
        child.once("close", (exitCode, signal) => {
          rawRequest.signal?.removeEventListener("abort", abort);
          resolve({ exitCode, signal });
        });
      },
    );

    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (killTimer) clearTimeout(killTimer);

    const stdoutText = stdout.read();
    const stderrText = stderr.read();
    const caps = { stdoutBytes: stdout.bytes(), stderrBytes: stderr.bytes() };

    if (state.settledBy === "timeout") {
      throw new CodexRuntimeError({
        code: "CODEX_TIMEOUT",
        message: killedAfterTerm
          ? "Codex timed out and required SIGKILL after SIGTERM."
          : "Codex timed out and was terminated.",
        exitCode: exit.exitCode,
        signal: exit.signal,
        details: { ...redactedLog, caps, stderrPreview: redactText(stderrText.slice(0, 2_000)) },
      });
    }
    if (state.settledBy === "canceled") {
      throw new CodexRuntimeError({
        code: "CODEX_CANCELED",
        message: "Codex run was canceled and terminated.",
        exitCode: exit.exitCode,
        signal: exit.signal,
        details: { ...redactedLog, caps },
      });
    }
    if (state.settledBy === "stdout_cap" || state.settledBy === "stderr_cap") {
      throw new CodexRuntimeError({
        code: "CODEX_OUTPUT_CAP_EXCEEDED",
        message: `Codex ${state.settledBy === "stdout_cap" ? "stdout" : "stderr"} exceeded the configured byte cap.`,
        exitCode: exit.exitCode,
        signal: exit.signal,
        details: { ...redactedLog, caps },
      });
    }
    if (exit.exitCode !== 0) {
      const stderrSummary = stderrText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith("WARNING:"))
        .at(-1);
      throw new CodexRuntimeError({
        code: "CODEX_PROCESS_FAILED",
        message: stderrSummary
          ? `Codex process exited unsuccessfully: ${redactText(stderrSummary).slice(0, 600)}`
          : "Codex process exited unsuccessfully.",
        exitCode: exit.exitCode,
        signal: exit.signal,
        details: { ...redactedLog, caps, stderrPreview: redactText(stderrText.slice(0, 2_000)) },
      });
    }

    const rawOutput = (await readOutputFile(outputPath)).trim();
    const output = parseAndValidate(rawOutput, rawRequest.schema);
    return {
      output,
      rawOutput,
      usage: extractUsageFromJsonl(stdoutText),
      caps,
      exitCode: exit.exitCode ?? 0,
      signal: exit.signal,
      redactedLog,
    };
  } finally {
    try {
      await cleanupRuntimePaths(paths);
    } catch {
      // Cleanup is best-effort after the primary process result has been decided.
    }
  }
};

export const makeCodexRuntimeService = (
  options: CodexRuntimeOptions = {},
): CodexRuntimeService => ({
  runStructured: <A, I>(request: CodexRunRequest<A, I>) =>
    Effect.tryPromise({
      try: () => runCodexProcess(request, options),
      catch: (error) =>
        error instanceof CodexRuntimeError
          ? error
          : new CodexRuntimeError({
              code: "CODEX_PROCESS_FAILED",
              message: "Codex runtime failed unexpectedly.",
              cause: error,
            }),
    }),
});
