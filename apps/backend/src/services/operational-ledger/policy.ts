import {
  assertAllowedStorageArtifactKind,
  type StorageLedgerEntry,
  storageDenylist,
  storageForbiddenFieldNames,
  strictDecodeStorageLedgerEntry,
} from "@repo/api-contracts";
import type { OperationalLedgerSettingKey, OperationalLedgerSettingValue } from "./types.js";

export class OperationalLedgerPolicyError extends Error {
  constructor(
    message: string,
    readonly path: readonly string[] = [],
  ) {
    super(message);
    this.name = "OperationalLedgerPolicyError";
  }
}

const locallyForbiddenFieldNames = [
  ...storageForbiddenFieldNames,
  "content",
  "ocr",
  "ocrContent",
  "paperlessMetadata",
  "paperlessBody",
  "paperlessRequestBody",
  "paperlessResponseBody",
  "catalogSnapshot",
  "paperlessCatalogSnapshot",
  "currentPaperlessCatalog",
  "promptTemplate",
  "rawProviderOutput",
  "providerOutput",
  "dossier",
  "excerpt",
  "excerpts",
  "pdfBytes",
  "sourcePdfBytes",
  "sourcePdfText",
  "sourceEntityName",
  "targetEntityName",
  "candidateName",
  "paperlessName",
  "documentTitle",
] as const;

const forbiddenFields = new Set<string>(locallyForbiddenFieldNames);
const forbiddenArtifactKinds = new Set<string>(storageDenylist);
const storageKindFields = new Set(["artifactKind", "storageKind", "ledgerKind"]);

const secretKeyPattern = /(?:token|secret|password|credential|authorization|api[_-]?key)/i;
const sensitiveTextPattern =
  /\b(?:ocr text|document content|paperless body|request body|response body|prompt|transcript|raw model output|raw provider output|source pdf|dossier|excerpt)\b/i;

const allowedSettingKeys = new Set<OperationalLedgerSettingKey>([
  "review.mode",
  "automatic.mode",
  "model.effort",
  "customFields.enabledIds",
  "limits.maxRetries",
  "limits.maxConcurrent",
  "limits.dailyProviderTokens",
  "limits.dailyOcrPages",
  "retentionDays",
]);

const isNonNegativeIntegerArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.every((item) => Number.isInteger(item) && item > 0) &&
  new Set(value).size === value.length;

export const assertNonSecretSetting = (
  key: string,
  value: unknown,
): OperationalLedgerSettingKey => {
  if (!allowedSettingKeys.has(key as OperationalLedgerSettingKey)) {
    throw new OperationalLedgerPolicyError(`Unsupported operational ledger setting key: ${key}`, [
      "settings",
      key,
    ]);
  }
  if (secretKeyPattern.test(key)) {
    throw new OperationalLedgerPolicyError(`Secret-like settings key is not allowed: ${key}`, [
      "settings",
      key,
    ]);
  }
  const typedKey = key as OperationalLedgerSettingKey;
  const validValue =
    typedKey === "review.mode"
      ? value === "manual" || value === "automatic" || value === "disabled"
      : typedKey === "automatic.mode"
        ? value === "off" || value === "review_required" || value === "apply_when_safe"
        : typedKey === "model.effort"
          ? value === "low" || value === "medium" || value === "high" || value === "xhigh"
          : typedKey === "customFields.enabledIds"
            ? isNonNegativeIntegerArray(value)
            : typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!validValue) {
    throw new OperationalLedgerPolicyError(`Invalid operational ledger setting value: ${key}`, [
      "settings",
      key,
    ]);
  }
  if (typeof value === "string" && sensitiveTextPattern.test(value)) {
    throw new OperationalLedgerPolicyError(`Sensitive settings value is not allowed: ${key}`, [
      "settings",
      key,
    ]);
  }
  return typedKey;
};

export const normalizeSettingValue = (
  key: OperationalLedgerSettingKey,
  value: unknown,
): OperationalLedgerSettingValue => {
  if (key === "customFields.enabledIds")
    return [...(value as readonly number[])].sort((left, right) => left - right);
  return value as OperationalLedgerSettingValue;
};

export const sanitizeStoredMessage = (message: string): string => {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (normalized.length === 0 || sensitiveTextPattern.test(normalized)) {
    return "Failure details omitted by storage policy.";
  }
  return normalized.slice(0, 512);
};

export const assertAllowedLedgerEntry = (entry: StorageLedgerEntry): StorageLedgerEntry => {
  assertAllowedStorageArtifactKind(entry.kind);
  const decoded = strictDecodeStorageLedgerEntry(entry);
  if (!decoded.ok) {
    const first = decoded.errors[0];
    throw new OperationalLedgerPolicyError(
      first?.message ?? "Invalid storage ledger entry",
      first?.path ?? [],
    );
  }
  assertStoragePolicySafe(entry);
  return decoded.value;
};

export const assertStoragePolicySafe = (value: unknown): void => {
  const seen = new WeakSet<object>();

  const visit = (node: unknown, path: readonly string[]): void => {
    if (node === null || node === undefined) return;
    if (typeof node === "string") {
      if (forbiddenArtifactKinds.has(node)) {
        throw new OperationalLedgerPolicyError(`Forbidden storage artifact kind: ${node}`, path);
      }
      return;
    }
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const [index, item] of node.entries()) {
        visit(item, [...path, String(index)]);
      }
      return;
    }

    const object = node as Record<string, unknown>;
    if (
      object.kind === "settings" &&
      object.values !== null &&
      typeof object.values === "object" &&
      !Array.isArray(object.values)
    ) {
      for (const [settingKey, settingValue] of Object.entries(
        object.values as Record<string, unknown>,
      )) {
        assertNonSecretSetting(settingKey, settingValue);
      }
    }
    for (const [key, child] of Object.entries(object)) {
      const nextPath = [...path, key];
      if (forbiddenFields.has(key)) {
        throw new OperationalLedgerPolicyError(`Forbidden storage field: ${key}`, nextPath);
      }
      if (storageKindFields.has(key) && typeof child === "string") {
        assertAllowedStorageArtifactKind(child);
      }
      if (key === "kind" && typeof child === "string" && forbiddenArtifactKinds.has(child)) {
        throw new OperationalLedgerPolicyError(
          `Forbidden storage artifact kind: ${child}`,
          nextPath,
        );
      }
      visit(child, nextPath);
    }
  };

  visit(value, []);
};
