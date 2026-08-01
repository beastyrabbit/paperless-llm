import type { CodexUsage } from "./types.js";

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

const mergeUsage = (current: CodexUsage, candidate: CodexUsage): CodexUsage => ({
  promptTokens: candidate.promptTokens ?? current.promptTokens,
  completionTokens: candidate.completionTokens ?? current.completionTokens,
  totalTokens: candidate.totalTokens ?? current.totalTokens,
});

const usageFromRecord = (record: Record<string, unknown>): CodexUsage => {
  const promptTokens =
    asFiniteNumber(record["prompt_tokens"]) ??
    asFiniteNumber(record["input_tokens"]) ??
    asFiniteNumber(record["cached_input_tokens"]);
  const completionTokens =
    asFiniteNumber(record["completion_tokens"]) ?? asFiniteNumber(record["output_tokens"]);
  const totalTokens =
    asFiniteNumber(record["total_tokens"]) ??
    (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);
  return { promptTokens, completionTokens, totalTokens };
};

const visitUsage = (value: unknown, current: CodexUsage): CodexUsage => {
  if (value === null || typeof value !== "object") return current;
  if (Array.isArray(value)) return value.reduce((usage, item) => visitUsage(item, usage), current);

  const record = value as Record<string, unknown>;
  const direct = usageFromRecord(record);
  let next = mergeUsage(current, direct);
  for (const nested of Object.values(record)) {
    next = visitUsage(nested, next);
  }
  return next;
};

export const extractUsageFromJsonl = (stdout: string): CodexUsage => {
  let usage: CodexUsage = {};
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      usage = visitUsage(JSON.parse(trimmed), usage);
    } catch {
      continue;
    }
  }
  return usage;
};
