import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import type { Schema } from "effect";
import type { CodexRuntimeError } from "./errors.js";

export const CODEX_EXECUTABLE = "codex";
export const CODEX_MODEL = "gpt-5.6-sol";
export const CODEX_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export type CodexStructuredOutputKind = "document" | "reviewer" | "chair";

export interface CodexUsage {
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

export interface CodexRunCaps {
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
}

export interface CodexRunRequest<A = unknown, I = unknown> {
  readonly prompt: string;
  readonly schema: Schema.Schema<A, I, never>;
  readonly jsonSchema: unknown;
  readonly structuredOutputKind: CodexStructuredOutputKind;
  readonly reasoningEffort?: CodexReasoningEffort;
  readonly timeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface CodexRunResult<A = unknown> {
  readonly output: A;
  readonly rawOutput: string;
  readonly usage: CodexUsage;
  readonly caps: CodexRunCaps;
  readonly exitCode: number;
  readonly signal: NodeJS.Signals | null;
  readonly redactedLog: Readonly<Record<string, unknown>>;
}

export interface CodexRuntimeService {
  readonly runStructured: <A, I>(
    request: CodexRunRequest<A, I>,
  ) => import("effect").Effect.Effect<CodexRunResult<A>, CodexRuntimeError>;
}

export type CodexProcessSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams;

export interface CodexRuntimeOptions {
  readonly spawn?: CodexProcessSpawner;
  readonly codexHome?: string;
  readonly tmpRoot?: string;
  readonly defaultTimeoutMs?: number;
  readonly stdoutMaxBytes?: number;
  readonly stderrMaxBytes?: number;
  readonly termGraceMs?: number;
}
