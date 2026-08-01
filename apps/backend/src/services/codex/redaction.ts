const sensitiveKeyPattern = /(?:token|secret|password|credential|authorization|api[_-]?key|session)/gi;
const bearerPattern = /\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const longSecretPattern = /\b(?:sk-[A-Za-z0-9_-]{12,}|[A-Za-z0-9+/=_-]{32,})\b/g;

export const redactText = (value: string): string =>
  value
    .replace(bearerPattern, "$1 [REDACTED]")
    .replace(longSecretPattern, "[REDACTED]")
    .replace(sensitiveKeyPattern, "[REDACTED_KEY]");

export const redactedEnvSummary = (env: NodeJS.ProcessEnv): Readonly<Record<string, string>> => {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    summary[key] = sensitiveKeyPattern.test(key) ? "[REDACTED]" : value;
    sensitiveKeyPattern.lastIndex = 0;
  }
  return summary;
};
