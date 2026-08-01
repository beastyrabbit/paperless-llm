import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { codexStructuredOutputJsonSchemas } from "@repo/api-contracts";
import { Effect, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertStrictCodexJsonSchema,
  CodexRuntimeError,
  makeCodexRuntimeService,
} from "../../../src/services/CodexRuntimeService.js";
import type { CodexProcessSpawner } from "../../../src/services/codex/types.js";

const SimpleOutputSchema = Schema.Struct({
  ok: Schema.Boolean,
});

interface MockChild extends ChildProcessWithoutNullStreams {
  readonly stdin: PassThrough;
  readonly stdout: PassThrough;
  readonly stderr: PassThrough;
  readonly killSignals: NodeJS.Signals[];
  readonly prompt: () => string;
  emitClose: (exitCode: number | null, signal: NodeJS.Signals | null) => void;
}

const createMockChild = (): MockChild => {
  const events = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdinChunks: Buffer[] = [];
  const killSignals: NodeJS.Signals[] = [];
  let exitCode: number | null = null;
  let signalCode: NodeJS.Signals | null = null;

  stdin.on("data", (chunk: Buffer) => {
    stdinChunks.push(chunk);
  });

  const child = events as MockChild;
  Object.assign(child, {
    stdin,
    stdout,
    stderr,
    killSignals,
    killed: false,
    pid: 12345,
    kill: (signal: NodeJS.Signals = "SIGTERM") => {
      killSignals.push(signal);
      Object.assign(child, { killed: true });
      return true;
    },
    prompt: () => Buffer.concat(stdinChunks).toString("utf8"),
    emitClose: (code: number | null, signal: NodeJS.Signals | null) => {
      exitCode = code;
      signalCode = signal;
      events.emit("close", code, signal);
    },
  });
  Object.defineProperties(child, {
    exitCode: { get: () => exitCode },
    signalCode: { get: () => signalCode },
  });
  return child;
};

const writeAuthHome = async (root: string) => {
  const codexHome = path.join(root, "codex-source");
  await fsp.mkdir(codexHome, { recursive: true });
  await fsp.writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ token: "secret-token" }));
  await fsp.writeFile(path.join(codexHome, "config.toml"), 'model = "do-not-copy"\n');
  return codexHome;
};

const request = (prompt = "Return JSON") => ({
  prompt,
  schema: SimpleOutputSchema,
  jsonSchema: {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  },
  structuredOutputKind: "document" as const,
  reasoningEffort: "medium" as const,
});

describe("CodexRuntimeService", () => {
  let tmpRoot: string;
  let codexHome: string;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-runtime-test-"));
    codexHome = await writeAuthHome(tmpRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it("spawns fixed codex exec argv with shell false, stdin prompt, read-only sandbox, and isolated auth", async () => {
    const calls: Array<{
      command: string;
      args: readonly string[];
      options: SpawnOptionsWithoutStdio;
      child: MockChild;
    }> = [];
    const spawn: CodexProcessSpawner = (command, args, options) => {
      const child = createMockChild();
      calls.push({ command, args, options, child });
      child.stdin.on("finish", () => {
        const outputPath = String(args[args.indexOf("--output-last-message") + 1]);
        const schemaPath = String(args[args.indexOf("--output-schema") + 1]);
        expect(JSON.parse(fs.readFileSync(schemaPath, "utf8"))).toMatchObject({ type: "object" });
        const env = options.env ?? {};
        expect(fs.existsSync(path.join(String(env["CODEX_HOME"]), "auth.json"))).toBe(true);
        expect(fs.existsSync(path.join(String(env["CODEX_HOME"]), "config.toml"))).toBe(false);
        expect(env["OPENAI_API_KEY"]).toBeUndefined();
        child.stdout.write('{"usage":{"input_tokens":3,"output_tokens":4,"total_tokens":7}}\n');
        fs.writeFileSync(outputPath, JSON.stringify({ ok: true }));
        child.emitClose(0, null);
      });
      return child;
    };
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot });

    const result = await Effect.runPromise(service.runStructured(request("stdin prompt")));

    expect(result.output).toEqual({ ok: true });
    expect(result.usage).toEqual({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.command).toBe("codex");
    expect(call?.options.shell).toBe(false);
    expect(call?.options.cwd).toContain("paperless-codex-");
    expect(call?.child.prompt()).toBe("stdin prompt");
    expect(call?.args).toEqual([
      "exec",
      "--model",
      "gpt-5.6-sol",
      "--config",
      'model_reasoning_effort="medium"',
      "--config",
      'shell_environment_policy.inherit="none"',
      "--sandbox",
      "read-only",
      "--cd",
      call?.options.cwd,
      "--skip-git-repo-check",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema",
      expect.stringMatching(/structured-output\.schema\.json$/),
      "--output-last-message",
      expect.stringMatching(/last-message\.json$/),
      "--json",
      "--color",
      "never",
      "-",
    ]);
  });

  it("fails auth checks before spawning when isolated auth cannot be prepared", async () => {
    const emptyHome = path.join(tmpRoot, "empty-codex-home");
    await fsp.mkdir(emptyHome);
    const spawn = vi.fn<CodexProcessSpawner>();
    const service = makeCodexRuntimeService({ spawn, codexHome: emptyHome, tmpRoot });

    const result = await Effect.runPromise(Effect.either(service.runStructured(request())));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("CODEX_AUTH_MISSING");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects non-strict output schemas before auth or provider execution", async () => {
    const spawn = vi.fn<CodexProcessSpawner>();
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot });
    const nonStrict = {
      type: "object",
      properties: {
        requiredValue: { type: "string" },
        optionalValue: { $id: "/schemas/unknown", title: "unknown" },
      },
      required: ["requiredValue"],
      additionalProperties: false,
    };

    const result = await Effect.runPromise(
      Effect.either(service.runStructured({ ...request(), jsonSchema: nonStrict })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.code).toBe("CODEX_INVALID_REQUEST");
      expect(result.left.message).toMatch(/all properties must be required/i);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("accepts every production Codex structured-output schema", () => {
    for (const schema of Object.values(codexStructuredOutputJsonSchemas)) {
      expect(() => assertStrictCodexJsonSchema(schema)).not.toThrow();
    }
  });

  it("sends TERM then KILL when a process exceeds timeout", async () => {
    let child: MockChild | undefined;
    const spawn: CodexProcessSpawner = () => {
      child = createMockChild();
      const originalKill = child.kill.bind(child);
      child.kill = ((signal: NodeJS.Signals = "SIGTERM") => {
        originalKill(signal);
        if (signal === "SIGKILL") child?.emitClose(null, "SIGKILL");
        return true;
      }) as MockChild["kill"];
      return child;
    };
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot, termGraceMs: 5 });

    const result = await Effect.runPromise(
      Effect.either(service.runStructured({ ...request(), timeoutMs: 5 })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("CODEX_TIMEOUT");
    expect(child?.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("terminates and fails when stdout exceeds the configured cap", async () => {
    let child: MockChild | undefined;
    const spawn: CodexProcessSpawner = () => {
      child = createMockChild();
      child.kill = ((signal: NodeJS.Signals = "SIGTERM") => {
        child?.killSignals.push(signal);
        child?.emitClose(null, signal);
        return true;
      }) as MockChild["kill"];
      child.stdin.on("finish", () => {
        child?.stdout.write("x".repeat(128));
      });
      return child;
    };
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot, termGraceMs: 5 });

    const result = await Effect.runPromise(
      Effect.either(service.runStructured({ ...request(), stdoutMaxBytes: 8 })),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") expect(result.left.code).toBe("CODEX_OUTPUT_CAP_EXCEEDED");
    expect(child?.killSignals[0]).toBe("SIGTERM");
  });

  it("validates structured output and reports schema failures", async () => {
    const spawn: CodexProcessSpawner = (_command, args) => {
      const child = createMockChild();
      child.stdin.on("finish", () => {
        const outputPath = String(args[args.indexOf("--output-last-message") + 1]);
        fs.writeFileSync(outputPath, JSON.stringify({ ok: "not boolean" }));
        child.emitClose(0, null);
      });
      return child;
    };
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot });

    const result = await Effect.runPromise(Effect.either(service.runStructured(request())));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toBeInstanceOf(CodexRuntimeError);
      expect(result.left.code).toBe("CODEX_STRUCTURED_OUTPUT_INVALID");
    }
  });

  it("cleans up isolated runtime directories after success", async () => {
    const runtimeTmpRoot = path.join(tmpRoot, "runtime");
    await fsp.mkdir(runtimeTmpRoot);
    const spawn: CodexProcessSpawner = (_command, args) => {
      const child = createMockChild();
      child.stdin.on("finish", () => {
        const outputPath = String(args[args.indexOf("--output-last-message") + 1]);
        fs.writeFileSync(outputPath, JSON.stringify({ ok: true }));
        child.emitClose(0, null);
      });
      return child;
    };
    const service = makeCodexRuntimeService({ spawn, codexHome, tmpRoot: runtimeTmpRoot });

    await Effect.runPromise(service.runStructured(request()));

    expect(await fsp.readdir(runtimeTmpRoot)).toEqual([]);
  });
});
