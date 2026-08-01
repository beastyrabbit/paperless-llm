import { Context, Layer } from "effect";
import { makeCodexRuntimeService } from "./codex/runner.js";
import type {
  CodexRuntimeOptions,
  CodexRuntimeService as CodexRuntimeServiceShape,
} from "./codex/types.js";

export type CodexRuntimeService = CodexRuntimeServiceShape;

export const CodexRuntimeService = Context.GenericTag<CodexRuntimeService>("CodexRuntimeService");

export const CodexRuntimeServiceLive = (options: CodexRuntimeOptions = {}) =>
  Layer.succeed(CodexRuntimeService, makeCodexRuntimeService(options));

export { CodexRuntimeError, isStructuredOutputInvalid } from "./codex/errors.js";
export { assertStrictCodexJsonSchema, makeCodexRuntimeService } from "./codex/runner.js";
export type {
  CodexReasoningEffort,
  CodexRunRequest,
  CodexRunResult,
  CodexRuntimeOptions,
  CodexStructuredOutputKind,
  CodexUsage,
} from "./codex/types.js";
export { CODEX_MODEL, CODEX_REASONING_EFFORTS } from "./codex/types.js";
