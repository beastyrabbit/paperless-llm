import type { ResolvedConfig } from "../../config/schema.js";
import type { AiAnalyseAutomationScannerOptions } from "../document-analysis/ai-analyse-automation-scanner.js";
import type { RecoverInterruptedAppliesOptions } from "../document-analysis/orchestrator.js";

export type MutationMode = "disabled" | "legacy" | "paperless_first";
export type ScannerScope = "disabled" | "canary" | "all";

export class CutoverConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CutoverConfigError";
  }
}

export interface CutoverRuntimePlan {
  readonly mutationMode: MutationMode;
  readonly startLegacyWorker: boolean;
  readonly startPaperlessFirstScanner: boolean;
  readonly scannerScope: ScannerScope;
}

export const DEFAULT_CUTOVER_CONFIG: ResolvedConfig["cutover"] = {
  mutationMode: "disabled",
  scanner: {
    scope: "disabled",
    canaryDocumentIds: [],
    aiAnalyseTagId: 0,
  },
};

const legacyMutationPathPatterns = [
  /^\/api\/processing(\/|$)/,
  /^\/api\/cases\/document\/[^/]+\/run$/,
  /^\/api\/cases\/questions\/[^/]+\/answer$/,
  /^\/api\/pending(\/|$)/,
  /^\/api\/jobs(\/|$)/,
  /^\/api\/schema\/blocked(\/|$)/,
  /^\/api\/translation(\/|$)/,
  /^\/api\/search\/index(\/|$)/,
  /^\/api\/catalog\/runs$/,
  /^\/api\/catalog\/proposals\/[^/]+\/decision$/,
] as const;

const newMutationPathPatterns = [
  /^\/api\/analysis\/runs$/,
  /^\/api\/analysis\/runs\/[^/]+\/(apply|reject|retry|cancel|force-ocr)$/,
  /^\/api\/analysis\/random-cycle\/(select|reset)$/,
  /^\/api\/catalog\/epochs$/,
  /^\/api\/catalog\/epochs\/[^/]+\/cancel$/,
  /^\/api\/catalog\/proposals\/[^/]+\/(approve|reject)$/,
] as const;

const catalogApplyPathPattern = /^\/api\/catalog\/proposals\/[^/]+\/apply$/;

const isMutationMethod = (method: string | undefined): boolean => {
  const normalized = method?.toUpperCase() ?? "GET";
  return (
    normalized === "POST" ||
    normalized === "PATCH" ||
    normalized === "PUT" ||
    normalized === "DELETE"
  );
};

const legacyWorkerGetPathPatterns = [/^\/api\/processing\/\d+\/stream$/] as const;

const matchesAny = (path: string, patterns: readonly RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(path));

export const isLegacyMutationPath = (path: string): boolean =>
  matchesAny(path, legacyMutationPathPatterns);

export const isPaperlessFirstMutationPath = (path: string): boolean =>
  matchesAny(path, newMutationPathPatterns);

export const mutationModeRequestAllowed = (
  mode: MutationMode,
  method: string | undefined,
  path: string,
): boolean => {
  if (isMutationMethod(method) && catalogApplyPathPattern.test(path)) {
    // The legacy and Paperless-first APIs temporarily share this route. The
    // request body is checked after parsing to select exactly one runtime.
    return mode !== "disabled";
  }
  const legacyMutation =
    (isMutationMethod(method) && isLegacyMutationPath(path)) ||
    matchesAny(path, legacyWorkerGetPathPatterns);
  const paperlessFirstMutation = isMutationMethod(method) && isPaperlessFirstMutationPath(path);
  if (!legacyMutation && !paperlessFirstMutation) return true;
  if (mode === "disabled") {
    return false;
  }
  if (mode === "legacy") return !paperlessFirstMutation;
  return !legacyMutation;
};

const isPaperlessFirstCatalogApplyBody = (body: unknown): boolean =>
  typeof body === "object" &&
  body !== null &&
  !Array.isArray(body) &&
  ("expectedProposalFingerprint" in body ||
    "expectedEvidenceFingerprint" in body ||
    "expectedCatalogFingerprint" in body ||
    "idempotencyKey" in body);

export const catalogApplyRequestAllowed = (mode: MutationMode, body: unknown): boolean => {
  if (mode === "disabled") return false;
  const paperlessFirstBody = isPaperlessFirstCatalogApplyBody(body);
  return mode === "paperless_first" ? paperlessFirstBody : !paperlessFirstBody;
};

export const isCatalogApplyPath = (method: string | undefined, path: string): boolean =>
  isMutationMethod(method) && catalogApplyPathPattern.test(path);

const positiveUniqueSorted = (values: readonly number[], label: string): readonly number[] => {
  const unique = [...new Set(values)];
  if (unique.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new CutoverConfigError(`${label} must contain only positive integer IDs.`);
  }
  return unique.sort((left, right) => left - right);
};

export const validateCutoverRuntimeConfig = (
  config: ResolvedConfig["cutover"] = DEFAULT_CUTOVER_CONFIG,
  env: NodeJS.ProcessEnv = process.env,
): void => {
  if (
    config.mutationMode !== "disabled" &&
    String(env["PAPERLESS_LLM_BACKEND_WRITER_LOCK_ENABLED"] ?? "true").toLowerCase() === "false"
  ) {
    throw new CutoverConfigError("Backend writer lock must remain enabled for mutation modes.");
  }
  if (config.scanner.scope !== "disabled" && config.mutationMode !== "paperless_first") {
    throw new CutoverConfigError("Ai-analyse scanner may only be enabled in paperless_first mode.");
  }
  if (config.scanner.scope === "canary" && config.scanner.canaryDocumentIds.length === 0) {
    throw new CutoverConfigError(
      "Canary scanner scope requires an explicit document ID allowlist.",
    );
  }
  positiveUniqueSorted(config.scanner.canaryDocumentIds, "Canary document IDs");
  if (!Number.isInteger(config.scanner.aiAnalyseTagId) || config.scanner.aiAnalyseTagId < 0) {
    throw new CutoverConfigError("Ai-analyse tag ID must be a positive integer.");
  }
  if (config.scanner.scope !== "disabled" && config.scanner.aiAnalyseTagId <= 0) {
    throw new CutoverConfigError(
      "Ai-analyse scanner scope requires an explicit positive ai-analyse tag ID.",
    );
  }
};

export const cutoverRuntimePlan = (
  config: ResolvedConfig["cutover"] = DEFAULT_CUTOVER_CONFIG,
  env: NodeJS.ProcessEnv = process.env,
): CutoverRuntimePlan => {
  validateCutoverRuntimeConfig(config, env);
  return {
    mutationMode: config.mutationMode,
    startLegacyWorker: config.mutationMode === "legacy",
    startPaperlessFirstScanner:
      config.mutationMode === "paperless_first" && config.scanner.scope !== "disabled",
    scannerScope: config.scanner.scope,
  };
};

export const scannerOptionsFromConfig = (
  config: ResolvedConfig["cutover"],
  recoveryOptions: RecoverInterruptedAppliesOptions,
): AiAnalyseAutomationScannerOptions => ({
  ...recoveryOptions,
  enabled: config.scanner.scope !== "disabled",
  scope: config.scanner.scope,
  canaryDocumentIds: config.scanner.canaryDocumentIds,
  aiAnalyseTagId: config.scanner.aiAnalyseTagId,
  configuredCustomFieldIds: [],
  systemTagIds: [],
  parentTagIds: [],
  workflowTagIds: [],
  transientTagIds: [],
  forceOcr: false,
});
