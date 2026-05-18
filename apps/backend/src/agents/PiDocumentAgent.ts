/**
 * Pi document metadata agent.
 *
 * Pi owns the orchestration loop and tool calls; Paperless mutations are still
 * applied by deterministic backend tools.
 */
import {
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  Agent as PiAgent,
} from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, pipe } from "effect";
import { Type } from "typebox";
import { AgentError } from "../errors/index.js";
import { annotateSpan, withInternalSpan } from "../observability/tracing.js";
import type { CustomField, CustomFieldValue, Document } from "../models/index.js";
import {
  ConcurrencyLimitService,
  ConfigService,
  classifyMetricsErrorOutcome,
  DocumentCaseService,
  metrics,
  observeDuration,
  OllamaService,
  PaperlessService,
  TinyBaseService,
} from "../services/index.js";
import type { DocumentMemory } from "../services/TinyBaseService.js";
import { fetchWithTimeout, normalizeBaseUrl } from "../utils/http.js";
import {
  computeContentExcerptCharBudget,
  formatUntrustedDocumentText,
  UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
} from "../utils/promptData.js";
import {
  buildPromptLanguageInstruction,
  normalizePromptLanguage,
  parseTagLanguageAliasRows,
  type TagLanguageAliasRow,
} from "../utils/tagLanguage.js";
import { getWorkflowTagNames, isWorkflowTagName } from "../utils/tagState.js";
import { type ConfirmationResult, runConfirmationLoop } from "./base.js";
import { buildDocumentAgentFewShotExamples } from "./document/fewShotExamples.js";
import { PiTagExplorerAgentService } from "./PiTagExplorerAgent.js";
import {
  buildOllamaModel,
  checkOllamaModelRunning,
  makeGatedOllamaStreamSimple,
  PromptIdleTimeoutError,
  runWithPromptActivityWatchdog,
  DEFAULT_OLLAMA_CONTEXT_WINDOW,
  DEFAULT_OLLAMA_MAX_TOKENS,
} from "./piOllamaModel.js";

export interface DocumentAgentInput {
  docId: number;
  auto?: boolean;
  resume?: boolean;
  freshRun?: boolean;
  dryRun?: boolean;
  metadataPolicy?: Partial<MetadataPolicy>;
  onEvent?: (event: DocumentAgentRuntimeEvent) => void;
}

export interface MetadataPolicy {
  title: boolean;
  summary: boolean;
  correspondent: boolean;
  documentType: boolean;
  tags: boolean;
  customFields: boolean;
  documentLinks: boolean;
}

export interface DocumentAgentRuntimeEvent {
  eventType: "response" | "tool_call" | "tool_result" | "error";
  data: Record<string, unknown>;
}

export interface DocumentAgentResult {
  success: boolean;
  docId: number;
  sessionId: string;
  needsReview: boolean;
  paused: boolean;
  applied: Record<string, unknown>;
  dryRun?: boolean;
  toolCalls?: string[];
  agentMessageCount?: number;
  assistantPreview?: string;
  error?: string;
}

export interface PiDocumentAgentService {
  readonly name: "document_agent";
  readonly processDocument: (
    input: DocumentAgentInput,
  ) => Effect.Effect<DocumentAgentResult, AgentError>;
}

export const PiDocumentAgentService =
  Context.GenericTag<PiDocumentAgentService>("PiDocumentAgentService");

type EntityKind = "correspondent" | "document_type" | "tag";
type HumanDecisionAction = "create" | "map" | "edit" | "skip" | "reject";

const defaultMetadataPolicy: MetadataPolicy = {
  title: true,
  summary: true,
  correspondent: true,
  documentType: true,
  tags: true,
  customFields: true,
  documentLinks: true,
};

const textResult = <T>(text: string, details: T, terminate = false) => ({
  content: [{ type: "text" as const, text }],
  details,
  terminate,
});

const parseJsonValue = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new AgentError({
      message: `Invalid JSON for ${label}: ${error instanceof Error ? error.message : String(error)}`,
      agent: "document_agent",
      cause: error,
    });
  }
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = parseJsonValue(value, "object payload");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  if (Array.isArray(parsed)) {
    return { items: parsed };
  }
  return {};
};

const pickRecordValue = (
  record: Record<string, unknown>,
  keys: string[],
): { found: boolean; value: unknown } => {
  for (const key of keys) {
    if (Object.hasOwn(record, key)) {
      return { found: true, value: record[key] };
    }
  }
  return { found: false, value: undefined };
};

const parseFieldId = (value: unknown): number | null => {
  const fieldId =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : NaN;
  return Number.isFinite(fieldId) ? fieldId : null;
};

export const parseFieldAssignmentsJson = (
  value: string,
  options: {
    fieldKeys?: string[];
    valueKeys?: string[];
  } = {},
): Record<string, unknown> => {
  const parsed = parseJsonValue(value, "field assignments");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  if (!Array.isArray(parsed)) {
    return {};
  }

  const fieldKeys = options.fieldKeys ?? [
    "field",
    "field_id",
    "custom_field_id",
    "customFieldId",
    "id",
  ];
  const valueKeys = options.valueKeys ?? ["value"];
  const assignments: Record<string, unknown> = {};

  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const field = pickRecordValue(record, fieldKeys);
    const fieldId = parseFieldId(field.value);
    const assignment = pickRecordValue(record, valueKeys);
    if (fieldId !== null && assignment.found) {
      assignments[String(fieldId)] = assignment.value;
    }
  }

  return assignments;
};

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ");

export const normalizeEntityKey = (value: string): string =>
  normalizeName(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " und ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type NamedCatalogEntity = { id: number; name: string };

const findByNormalizedName = <T extends NamedCatalogEntity>(
  items: T[],
  name: string | undefined,
): T | null => {
  if (!name) return null;
  const key = normalizeEntityKey(name);
  return items.find((item) => normalizeEntityKey(item.name) === key) ?? null;
};

const findRequiredCompanyTags = <T extends NamedCatalogEntity>(
  content: string,
  tags: T[],
): T[] => {
  const lowerContent = content.toLowerCase();
  const requiredNames = ["SKYWAY"];
  return requiredNames
    .filter((name) => lowerContent.includes(name.toLowerCase()))
    .map((name) => findByNormalizedName(tags, name))
    .filter((tag): tag is T => tag !== null);
};

const CUSTOM_FIELD_ALIAS_KEYS: Record<string, readonly string[]> = {
  "echter korrespondent": ["seller", "merchant", "vendor", "payee", "recipient", "verkaeufer", "händler"],
  "gesamt rechnungsbetrag": ["amount", "total", "total charged", "betrag", "summe"],
  "einzelliste der artikel": ["items", "line_items", "articles", "products", "produkt", "description"],
  rechnungsnummer: ["invoice_number", "invoiceNumber", "orderId", "order_id", "order", "bestellnummer"],
  kundennummer: ["customer_number", "customerNumber", "account_number", "kundennummer"],
};

const parseCatalogFieldAssignmentsJson = (
  value: string,
  fields: CustomField[],
  options: {
    fieldKeys?: string[];
    valueKeys?: string[];
    includeEmptyObject?: boolean;
  } = {},
): Record<string, unknown> => {
  const parsed = parseJsonValue(value, "catalog field assignments");
  const fieldNameIds = new Map(
    fields.map((field) => [normalizeName(field.name).toLowerCase(), field.id] as const),
  );
  const aliasFieldIds = new Map<string, number>();
  for (const field of fields) {
    const aliases = CUSTOM_FIELD_ALIAS_KEYS[normalizeName(field.name).toLowerCase()] ?? [];
    for (const alias of aliases) aliasFieldIds.set(normalizeEntityKey(alias), field.id);
  }
  const resolveFieldId = (field: unknown): number | null => {
    const fieldId = parseFieldId(field);
    if (fieldId !== null) return fieldId;
    if (typeof field !== "string") return null;
    return (
      fieldNameIds.get(normalizeName(field).toLowerCase()) ??
      aliasFieldIds.get(normalizeEntityKey(field)) ??
      null
    );
  };

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>);
    const assignments: Record<string, unknown> = {};
    for (const [key, assignment] of entries) {
      const fieldId = resolveFieldId(key);
      if (fieldId !== null) {
        assignments[String(fieldId)] = assignment;
      }
    }
    if (entries.length === 0 && options.includeEmptyObject) {
      for (const field of fields) assignments[String(field.id)] = undefined;
    }
    return assignments;
  }

  if (!Array.isArray(parsed)) {
    return {};
  }

  const fieldKeys = options.fieldKeys ?? [
    "field",
    "field_id",
    "custom_field_id",
    "customFieldId",
    "field_name",
    "fieldName",
    "name",
    "id",
  ];
  const valueKeys = options.valueKeys ?? ["value"];
  const assignments: Record<string, unknown> = {};

  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const field = pickRecordValue(record, fieldKeys);
    const fieldId = resolveFieldId(field.value);
    const assignment = pickRecordValue(record, valueKeys);
    if (fieldId !== null && assignment.found) {
      assignments[String(fieldId)] = assignment.value;
    }
  }

  return assignments;
};

const getSourceFileName = (doc: Document): string =>
  doc.original_file_name ?? doc.archived_file_name ?? "";

const getContentHeading = (content: string): string =>
  content
    .split(/\r?\n/)
    .map((line) => normalizeName(line))
    .find((line) => line.length > 0)
    ?.slice(0, 200) ?? "";

const buildDocumentSearchQuery = (doc: Document, content: string): string => {
  const parts = [getSourceFileName(doc), getContentHeading(content), doc.title]
    .map((part) => normalizeName(part ?? ""))
    .filter((part, index, all) => part.length > 0 && all.indexOf(part) === index);

  return (parts.join(" | ") || `document ${doc.id}`).slice(0, 500);
};

const summarizeDocumentForAgent = (
  candidate: Document,
  excerptLength: number,
): Record<string, unknown> => {
  const content = candidate.content ?? "";
  return {
    id: candidate.id,
    title: candidate.title,
    original_file_name: candidate.original_file_name,
    archived_file_name: candidate.archived_file_name,
    mime_type: candidate.mime_type,
    correspondent: candidate.correspondent_name ?? candidate.correspondent,
    document_type: candidate.document_type_name ?? candidate.document_type,
    tags: candidate.tag_names ?? candidate.tags,
    created: candidate.created,
    content_heading: getContentHeading(content),
    content_excerpt: content.slice(0, excerptLength),
  };
};

const hasToolCall = (message: AgentMessage, toolName: string): boolean => {
  if (message.role !== "assistant") return false;
  return message.content.some(
    (content) => content.type === "toolCall" && content.name === toolName,
  );
};

const getToolCallNames = (messages: AgentMessage[]): string[] => [
  ...new Set(
    messages.flatMap((message) =>
      message.role === "assistant"
        ? message.content
            .filter((content) => content.type === "toolCall")
            .map((content) => content.name)
        : [],
    ),
  ),
];

const getAssistantPreview = (messages: AgentMessage[]): string =>
  messages
    .flatMap((message) =>
      message.role === "assistant"
        ? message.content
            .filter((content) => content.type === "text")
            .map((content) => content.text)
        : [],
    )
    .join("\n")
    .trim()
    .slice(0, 1_000);

export const getLatestAssistantError = (messages: AgentMessage[]): string | undefined => {
  const latestAssistantError = [...messages].reverse().find((message) => {
    if (message.role !== "assistant") return false;
    const record = message as unknown as Record<string, unknown>;
    return record["stopReason"] === "error" || typeof record["errorMessage"] === "string";
  });
  if (!latestAssistantError) return undefined;
  const record = latestAssistantError as unknown as Record<string, unknown>;
  const errorMessage = typeof record["errorMessage"] === "string" ? record["errorMessage"] : "";
  return errorMessage.slice(0, 1_000) || "Document agent model request failed.";
};

const getToolResultText = (message: AgentMessage): string =>
  message.role === "toolResult"
    ? message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n")
    : "";

export interface ToolValidationIssue {
  path: string;
  message: string;
}

export interface ToolValidationFeedback {
  toolName: string;
  issues: ToolValidationIssue[];
}

export const parseToolValidationFeedback = (text: string): ToolValidationFeedback | null => {
  const header = text.match(/Validation failed for tool "([^"]+)":/);
  const toolName = header?.[1];
  if (!toolName) return null;

  const issues: ToolValidationIssue[] = [];
  for (const line of text
    .slice(header.index ?? 0)
    .split("\n")
    .slice(1)) {
    if (line.trim().startsWith("Received arguments:")) break;
    const issue = line.match(/^\s*-\s+([^:]+):\s*(.+)$/);
    const path = issue?.[1];
    const message = issue?.[2];
    if (path && message) {
      issues.push({ path: path.trim(), message: message.trim() });
    }
  }

  return issues.length > 0 ? { toolName, issues } : null;
};

const pathWithoutToolPrefix = (path: string): string =>
  path.replace(/^finish_document_metadata\./, "").replace(/^request_human_decision\./, "");

const retryGuidanceForValidationPath = (path: string): string => {
  const normalizedPath = pathWithoutToolPrefix(path);
  const rootPath = normalizedPath.split(".")[0] ?? normalizedPath;

  if (rootPath === "candidateName") {
    return "request_human_decision requires candidateName as a concrete string; do not put the candidate only in userQuestion.";
  }
  if (rootPath === "entityKind") {
    return "entityKind must be one of correspondent, document_type, or tag.";
  }
  if (rootPath === "action") {
    return "action must be one of create, map, edit, skip, or reject.";
  }
  if (rootPath === "evidence") {
    return "evidence must quote or summarize source evidence from the current document.";
  }
  if (rootPath === "userQuestion") {
    return "userQuestion must be a clear user-facing question.";
  }
  if (rootPath === "tagIdsToAdd" || rootPath === "tagIdsToRemove") {
    return `${rootPath} must be an array of numeric existing Paperless tag IDs. Do not put tag names or objects there.`;
  }
  if (rootPath === "tagNamesToAdd") {
    return "tagNamesToAdd must be an array of strings only. Prefer existing tag IDs when known; unknown names may pause for human review.";
  }
  if (
    rootPath === "correspondentId" ||
    rootPath === "documentTypeId" ||
    rootPath === "candidateId" ||
    rootPath === "docId" ||
    rootPath === "limit"
  ) {
    return `${rootPath} must be a number, not a label or object.`;
  }
  if (rootPath === "confidence") {
    return "confidence must be a number between 0.0 and 1.0, not a label or object.";
  }
  if (
    rootPath === "correspondentName" ||
    rootPath === "documentTypeName" ||
    rootPath === "title" ||
    rootPath === "summary" ||
    rootPath === "reasoning"
  ) {
    return `${rootPath} must be a string.`;
  }
  if (
    rootPath === "customFieldsJson" ||
    rootPath === "linkedDocumentsJson" ||
    rootPath === "extractedFactsJson"
  ) {
    return `${rootPath} must be a valid JSON string.`;
  }
  if (rootPath === "root") {
    return "Call the real final tool with an object matching its schema; do not write prose or pseudo-tool JSON.";
  }
  return `${normalizedPath} must match the final tool schema.`;
};

export const buildRetryCorrectionFromFinalToolError = (errorText: string): string => {
  const validation = parseToolValidationFeedback(errorText);
  if (!validation) {
    return [
      "Your previous final metadata tool call was rejected.",
      `Final tool feedback: ${errorText}`,
      "Revise the metadata using that feedback and call exactly one final tool again.",
      "If a human must decide, call request_human_decision with a concrete candidateName, evidence, and userQuestion.",
      "Otherwise call finish_document_metadata with corrected metadata and confidence.",
      "Do not write prose.",
    ].join("\n");
  }

  const guidance = [
    ...new Set(validation.issues.map((issue) => retryGuidanceForValidationPath(issue.path))),
  ];

  return [
    "Your previous final metadata tool call was rejected.",
    "Tool validation feedback:",
    ...validation.issues.map((issue) => `- ${issue.path}: ${issue.message}`),
    "Correction requirements:",
    ...guidance.map((entry) => `- ${entry}`),
    "Revise the arguments and call exactly one final tool again.",
    "If a human must decide, call request_human_decision with a concrete candidateName, evidence, and userQuestion.",
    "Otherwise call finish_document_metadata with corrected metadata and confidence.",
    "Do not write prose.",
  ].join("\n");
};

export interface AppliedMetadataFieldAudit {
  value: unknown;
  appliedAt: string;
  sessionId: string;
}

export type AppliedMetadataAudit = Record<string, AppliedMetadataFieldAudit>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const optionalRecordString = (record: Record<string, unknown>, key: string): string | undefined =>
  typeof record[key] === "string" && record[key].trim() ? record[key] : undefined;

export interface OllamaPiPayloadOptions {
  seed: number;
  temperature?: number;
  responseFormatJson?: boolean;
}

export const buildOllamaPiPayload = (
  payload: unknown,
  options: OllamaPiPayloadOptions,
): unknown => {
  if (!isRecord(payload)) return payload;

  const nextPayload: Record<string, unknown> = {
    ...payload,
    temperature: options.temperature ?? 0,
    seed: options.seed,
  };

  if (
    options.responseFormatJson === true &&
    !("tools" in payload) &&
    !("response_format" in payload)
  ) {
    nextPayload.response_format = { type: "json_object" };
  }

  return nextPayload;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export const metadataValuesEqual = (left: unknown, right: unknown): boolean =>
  stableStringify(left) === stableStringify(right);

export const readAppliedMetadataAudit = (
  value: unknown,
  finalDecisions: Record<string, unknown> = {},
): AppliedMetadataAudit => {
  const audit: AppliedMetadataAudit = {};
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (!isRecord(entry)) continue;
      const appliedAt = typeof entry["appliedAt"] === "string" ? entry["appliedAt"] : "";
      const sessionId = typeof entry["sessionId"] === "string" ? entry["sessionId"] : "";
      if (appliedAt && sessionId) {
        audit[key] = { value: entry["value"], appliedAt, sessionId };
      }
    }
  }
  for (const [key, value] of Object.entries(finalDecisions)) {
    if (key === "confidence" || audit[key] || value === undefined) continue;
    audit[key] = { value, appliedAt: "", sessionId: "" };
  }
  return audit;
};

export interface PromptSafeHumanDecision {
  id: string;
  type: string;
  question: string;
  suggestion: string;
  answer: string;
  value: string | null;
  decidedAt: string;
  pendingId?: string;
  feedback?: string;
}

export interface PromptSafeReviewFeedback {
  id: string;
  feedback: string;
  createdAt: string;
  pendingId?: string;
  category?: string | null;
}

export interface PromptSafeAppliedMetadataFieldAudit {
  value: unknown;
  appliedAt: string;
  sessionId: string;
}

export type PromptSafeAppliedMetadataAudit = Record<string, PromptSafeAppliedMetadataFieldAudit>;

export interface PromptSafeDocumentAgentMemory {
  sessionId: string;
  humanDecisions: PromptSafeHumanDecision[];
  reviewFeedback: PromptSafeReviewFeedback[];
  appliedMetadata: PromptSafeAppliedMetadataAudit;
  transcript: AgentMessage[];
}

const PROMPT_MEMORY_LIMITS = {
  maxHumanDecisions: 50,
  maxReviewFeedback: 50,
  maxResumeMessages: 100,
  maxStringChars: 2_000,
  maxAppliedMetadataChars: 16_000,
  maxArrayItems: 20,
  maxObjectEntries: 20,
  maxDepth: 3,
} as const;

const logDroppedMemoryEntry = (kind: string): void => {
  console.warn(`[document_agent] Dropped invalid prompt memory entry: ${kind}`);
};

const clampPromptString = (value: string): string =>
  redactSensitiveMetadataText(value).slice(0, PROMPT_MEMORY_LIMITS.maxStringChars);

export const sanitizeHumanDecisionsForPrompt = (value: unknown): PromptSafeHumanDecision[] => {
  if (!Array.isArray(value)) return [];
  const output: PromptSafeHumanDecision[] = [];
  for (const entry of value) {
    if (output.length >= PROMPT_MEMORY_LIMITS.maxHumanDecisions) break;
    if (!isRecord(entry)) {
      logDroppedMemoryEntry("humanDecisions");
      continue;
    }
    const id = entry["id"];
    const type = entry["type"];
    const question = entry["question"];
    const suggestion = entry["suggestion"];
    const answer = entry["answer"];
    const decidedAt = entry["decidedAt"];
    const recordValue = entry["value"];
    if (
      typeof id !== "string" ||
      typeof type !== "string" ||
      typeof question !== "string" ||
      typeof suggestion !== "string" ||
      typeof answer !== "string" ||
      typeof decidedAt !== "string" ||
      !(typeof recordValue === "string" || recordValue === null)
    ) {
      logDroppedMemoryEntry("humanDecisions");
      continue;
    }
    const safe: PromptSafeHumanDecision = {
      id: clampPromptString(id),
      type: clampPromptString(type),
      question: clampPromptString(question),
      suggestion: clampPromptString(suggestion),
      answer: clampPromptString(answer),
      value: typeof recordValue === "string" ? clampPromptString(recordValue) : null,
      decidedAt: clampPromptString(decidedAt),
    };
    if (typeof entry["pendingId"] === "string")
      safe.pendingId = clampPromptString(entry["pendingId"]);
    if (typeof entry["feedback"] === "string") safe.feedback = clampPromptString(entry["feedback"]);
    output.push(safe);
  }
  return output;
};

export const sanitizeReviewFeedbackForPrompt = (value: unknown): PromptSafeReviewFeedback[] => {
  if (!Array.isArray(value)) return [];
  const output: PromptSafeReviewFeedback[] = [];
  for (const entry of value) {
    if (output.length >= PROMPT_MEMORY_LIMITS.maxReviewFeedback) break;
    if (!isRecord(entry)) {
      logDroppedMemoryEntry("reviewFeedback");
      continue;
    }
    const id = entry["id"];
    const feedback = entry["feedback"];
    const createdAt = entry["createdAt"];
    const category = entry["category"];
    if (
      typeof id !== "string" ||
      typeof feedback !== "string" ||
      typeof createdAt !== "string" ||
      !(category === undefined || category === null || typeof category === "string")
    ) {
      logDroppedMemoryEntry("reviewFeedback");
      continue;
    }
    const safe: PromptSafeReviewFeedback = {
      id: clampPromptString(id),
      feedback: clampPromptString(feedback),
      createdAt: clampPromptString(createdAt),
    };
    if (typeof entry["pendingId"] === "string")
      safe.pendingId = clampPromptString(entry["pendingId"]);
    if (category === null || typeof category === "string") {
      safe.category = category === null ? null : clampPromptString(category);
    }
    output.push(safe);
  }
  return output;
};

const projectPromptSafeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return clampPromptString(value);
  if (depth >= PROMPT_MEMORY_LIMITS.maxDepth) return undefined;
  if (Array.isArray(value)) {
    return value
      .slice(0, PROMPT_MEMORY_LIMITS.maxArrayItems)
      .map((item) => projectPromptSafeValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (!isRecord(value)) return undefined;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, PROMPT_MEMORY_LIMITS.maxObjectEntries)) {
    const projected = projectPromptSafeValue(item, depth + 1);
    if (projected !== undefined) output[clampPromptString(key)] = projected;
  }
  return output;
};

export const sanitizeAppliedMetadataForPrompt = (
  value: AppliedMetadataAudit,
): PromptSafeAppliedMetadataAudit => {
  const output: PromptSafeAppliedMetadataAudit = {};
  let totalChars = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry.appliedAt !== "string" || typeof entry.sessionId !== "string") {
      logDroppedMemoryEntry("appliedMetadata");
      continue;
    }
    const projectedValue = projectPromptSafeValue(entry.value);
    if (projectedValue === undefined) {
      logDroppedMemoryEntry("appliedMetadata");
      continue;
    }
    const projectedEntry = {
      value: projectedValue,
      appliedAt: clampPromptString(entry.appliedAt),
      sessionId: clampPromptString(entry.sessionId),
    };
    const projectedChars = JSON.stringify({ [key]: projectedEntry }).length;
    if (totalChars + projectedChars > PROMPT_MEMORY_LIMITS.maxAppliedMetadataChars) break;
    output[clampPromptString(key)] = projectedEntry;
    totalChars += projectedChars;
  }
  return output;
};

const isSafePrimitiveRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && Object.values(value).every((item) => !isRecord(item) && !Array.isArray(item));

const sanitizeAssistantContent = (content: unknown): unknown[] => {
  if (!Array.isArray(content)) return [];
  const output: unknown[] = [];
  for (const item of content.slice(0, PROMPT_MEMORY_LIMITS.maxArrayItems)) {
    if (!isRecord(item) || typeof item["type"] !== "string") continue;
    if (item["type"] === "text" && typeof item["text"] === "string") {
      output.push({ type: "text", text: clampPromptString(item["text"]) });
      continue;
    }
    if (item["type"] === "toolCall" && typeof item["name"] === "string") {
      const safeToolCall: Record<string, unknown> = {
        type: "toolCall",
        name: clampPromptString(item["name"]),
        arguments: {},
      };
      for (const stringKey of ["id", "toolCallId"] as const) {
        if (typeof item[stringKey] === "string")
          safeToolCall[stringKey] = clampPromptString(item[stringKey]);
      }
      for (const argsKey of ["args", "arguments", "input"] as const) {
        const projected = isSafePrimitiveRecord(item[argsKey])
          ? projectPromptSafeValue(item[argsKey])
          : undefined;
        if (projected !== undefined) {
          safeToolCall["arguments"] = projected;
          break;
        }
      }
      output.push(safeToolCall);
    }
  }
  return output;
};

const sanitizeToolResultContent = (content: unknown): unknown[] => {
  if (!Array.isArray(content)) return [];
  return content
    .slice(0, PROMPT_MEMORY_LIMITS.maxArrayItems)
    .flatMap((item) =>
      isRecord(item) && item["type"] === "text" && typeof item["text"] === "string"
        ? [{ type: "text", text: clampPromptString(item["text"]) }]
        : [],
    );
};

export const sanitizeAgentMessagesForResume = (value: unknown): AgentMessage[] => {
  if (!Array.isArray(value)) return [];
  const output: AgentMessage[] = [];
  for (const message of value) {
    if (output.length >= PROMPT_MEMORY_LIMITS.maxResumeMessages) break;
    if (!isRecord(message) || typeof message["role"] !== "string") {
      logDroppedMemoryEntry("agentMessages");
      continue;
    }
    if (message["role"] === "assistant") {
      const content = sanitizeAssistantContent(message["content"]);
      if (content.length > 0) output.push({ role: "assistant", content } as AgentMessage);
      else logDroppedMemoryEntry("agentMessages");
      continue;
    }
    if (message["role"] === "toolResult" && typeof message["toolName"] === "string") {
      const content = sanitizeToolResultContent(message["content"]);
      if (content.length > 0) {
        output.push({
          role: "toolResult",
          toolName: clampPromptString(message["toolName"]),
          isError: message["isError"] === true,
          content,
        } as AgentMessage);
      } else {
        logDroppedMemoryEntry("agentMessages");
      }
      continue;
    }
    logDroppedMemoryEntry("agentMessages");
  }
  return output;
};

const validSessionId = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? clampPromptString(value) : null;

export const readPromptSafeDocumentAgentMemory = (input: {
  docId: number;
  caseMemory: Record<string, unknown>;
  legacyMemory: DocumentMemory | null;
  finalDecisions: Record<string, unknown>;
  now?: () => number;
}): PromptSafeDocumentAgentMemory => {
  const caseHumanDecisions = sanitizeHumanDecisionsForPrompt(input.caseMemory["humanDecisions"]);
  const legacyHumanDecisions = sanitizeHumanDecisionsForPrompt(input.legacyMemory?.humanDecisions);
  const caseReviewFeedback = sanitizeReviewFeedbackForPrompt(input.caseMemory["reviewFeedback"]);
  const legacyReviewFeedback = sanitizeReviewFeedbackForPrompt(input.legacyMemory?.reviewFeedback);
  const caseTranscript = sanitizeAgentMessagesForResume(input.caseMemory["agentMessages"]);
  const legacyTranscript = sanitizeAgentMessagesForResume(input.legacyMemory?.transcript);
  const humanDecisions = caseHumanDecisions.length > 0 ? caseHumanDecisions : legacyHumanDecisions;
  const reviewFeedback = caseReviewFeedback.length > 0 ? caseReviewFeedback : legacyReviewFeedback;
  const appliedMetadata = readAppliedMetadataAudit(
    input.caseMemory["appliedMetadata"],
    input.finalDecisions,
  );

  return {
    sessionId:
      validSessionId(input.caseMemory["sessionId"]) ??
      validSessionId(input.legacyMemory?.sessionId) ??
      `doc-${input.docId}-${input.now?.() ?? Date.now()}`,
    humanDecisions,
    reviewFeedback,
    appliedMetadata: sanitizeAppliedMetadataForPrompt(appliedMetadata),
    transcript:
      humanDecisions.length > 0
        ? []
        : caseTranscript.length > 0
          ? caseTranscript
          : legacyTranscript,
  };
};

export const mergeAppliedMetadataAudit = (
  existing: AppliedMetadataAudit,
  applied: Record<string, unknown>,
  appliedAt: string,
  sessionId: string,
): AppliedMetadataAudit => {
  const next: AppliedMetadataAudit = { ...existing };
  for (const [key, value] of Object.entries(applied)) {
    if (key === "confidence" || value === undefined) continue;
    next[key] = { value, appliedAt, sessionId };
  }
  return next;
};

export const getResumeProtectedMetadataKeys = (
  existing: AppliedMetadataAudit,
  proposed: Record<string, unknown>,
): string[] => {
  const protectionGroupFor = (key: string): string[] => {
    if (key === "added_tag_ids" || key === "removed_tag_ids" || key === "added_tag_names") {
      return ["added_tag_ids", "removed_tag_ids", "added_tag_names"];
    }
    if (key === "custom_fields" || key === "linked_documents") {
      return ["custom_fields", "linked_documents"];
    }
    return [key];
  };
  return Object.entries(proposed)
    .filter(([key, value]) => {
      if (key === "confidence") return false;
      const previous = protectionGroupFor(key)
        .map((candidateKey) => existing[candidateKey])
        .find((candidate) => candidate !== undefined);
      return previous !== undefined && !metadataValuesEqual(previous.value, value);
    })
    .map(([key]) => key);
};

const updateKeyForAppliedMetadataKey = (key: string): string | null => {
  if (key === "title") return "title";
  if (key === "correspondent") return "correspondent";
  if (key === "document_type") return "document_type";
  if (key === "added_tag_ids" || key === "removed_tag_ids" || key === "added_tag_names")
    return "tags";
  if (key === "custom_fields" || key === "linked_documents") return "custom_fields";
  return null;
};

export const computeDeterministicModelSeed = (docId: number, model: string): number => {
  let hash = 2_166_136_261;
  for (const char of `document-agent:${docId}:${model}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const isFinalToolName = (name: string): boolean =>
  name === "request_human_decision" || name === "finish_document_metadata";

const isFinalToolResultMessage = (
  message: AgentMessage,
): message is AgentMessage & { role: "toolResult"; toolName: string; isError: boolean } =>
  message.role === "toolResult" && isFinalToolName(message.toolName);

export const getLatestFinalToolError = (messages: AgentMessage[]): string | undefined => {
  const latestFinalToolResult = [...messages].reverse().find(isFinalToolResultMessage);
  if (!latestFinalToolResult?.isError) return undefined;
  const text = getToolResultText(latestFinalToolResult);
  if (text.includes("Final metadata action already executed")) return undefined;
  return text.slice(0, 1_000) || "Final metadata tool failed.";
};

export const classifyFinalMetadataOutcome = (input: {
  paused: boolean;
  hasFinalToolCall: boolean;
  hasSuccessfulFinishToolResult: boolean;
  finalToolError?: string;
  assistantError?: string;
}): { success: boolean; runError?: string } => {
  if (input.finalToolError) {
    return { success: false, runError: input.finalToolError };
  }
  if (input.assistantError) {
    return { success: false, runError: input.assistantError };
  }
  if (input.paused) {
    return { success: false };
  }
  if (!input.hasFinalToolCall) {
    return {
      success: false,
      runError:
        "Document agent stopped without calling request_human_decision or finish_document_metadata.",
    };
  }
  if (!input.hasSuccessfulFinishToolResult) {
    return {
      success: false,
      runError:
        "Document agent stopped without calling finish_document_metadata after non-pausing metadata decisions.",
    };
  }
  return { success: true };
};

const isPolicyEnabledForDecision = (kind: EntityKind, policy: MetadataPolicy): boolean => {
  if (kind === "correspondent") return policy.correspondent;
  if (kind === "document_type") return policy.documentType;
  return policy.tags;
};

const looksLikeMetadataBundleQuestion = (value: string): boolean => {
  const normalized = value.toLowerCase();
  const markers = [
    "korrespondent:",
    "korrespondenz:",
    "correspondent:",
    "dokumenttyp:",
    "document type:",
    "titel:",
    "title:",
    "tags:",
  ];
  return markers.filter((marker) => normalized.includes(marker)).length >= 2;
};

const EMPTY_METADATA_VERIFIER_FEEDBACK = "Metadata verifier returned an empty response.";

const normalizeCustomFieldKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isRealCorrespondentCustomField = (name: string): boolean => {
  const key = normalizeCustomFieldKey(name);
  return (
    key === "echter korrespondent" ||
    key === "real correspondent" ||
    key === "actual correspondent" ||
    key === "seller" ||
    key === "merchant" ||
    key === "haendler" ||
    key === "handler" ||
    key === "verkaeufer" ||
    key === "verkaufer"
  );
};

const cleanMerchantCandidate = (value: string): string | null => {
  const candidate = value
    .replace(/\*\*/g, "")
    .replace(/^\|+|\|+$/g, "")
    .replace(/\s*\|.*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (candidate.length < 2 || candidate.length > 120) return null;
  if (!/[a-zA-Z]/.test(candidate)) return null;
  if (candidate.split(/\s+/).length > 8) return null;
  if (/^(we|if|for|this|the|der|die|das|order|status|pending|seller|merchant)\b/i.test(candidate)) {
    return null;
  }
  if (/[!?]/.test(candidate)) return null;
  return candidate;
};

const extractMerchantFromContent = (content: string): string | null => {
  const normalizedContent = content.replace(/\r/g, "\n");
  const tableSeller = normalizedContent.match(/\bSeller\s*\n\s*([^\n|]+?)(?:\s*\||\s*\n)/i);
  const explicitSeller = normalizedContent.match(
    /\b(?:Seller|Merchant|Händler|Haendler|Verkäufer|Verkaeufer)\b\s*[:|-]\s*([^\n|]+)/i,
  );
  for (const value of [tableSeller?.[1], explicitSeller?.[1]]) {
    const candidate = value ? cleanMerchantCandidate(value) : null;
    if (candidate) return candidate;
  }
  return null;
};

const extractFirstInvoiceLineItem = (content: string): string | null => {
  const match = content.match(/\|\s*Description\s*\|\s*Qty\s*\|\s*Total\s*\|[\s\S]*?\n\|\s*([^|\n]+?)\s*\|\s*\d+/i);
  const item = match?.[1]?.replace(/\s+/g, " ").trim();
  return item && item.length > 2 ? item : null;
};

const extractInvoiceTotal = (content: string): number | null => {
  const patterns = [
    /(?:Total Charged|Amount Due[^\n]*)\s*\|\s*\$?\s*([0-9]+(?:[.,][0-9]{2})?)/i,
    /\|\s*(?:Rechnungsbetrag|Zu zahlender Betrag)\s*\|[^\n]*\|\s*([0-9]+(?:[.,][0-9]{2})?)\s*\|/i,
    /\b(?:Rechnungsbetrag|Zu zahlender Betrag|Gesamtbetrag)\b[^\n0-9]*([0-9]+(?:[.,][0-9]{2})?)\s*€/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    const value = match?.[1] ? Number(match[1].replace(",", ".")) : Number.NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const extractInvoiceNumber = (content: string): string | null => {
  const match = content.match(
    /\b(?:Order ID|Invoice(?: Number)?|Rechnungsnummer|Bestellnummer)\b\s*:?\s*(?:\n\s*)?([^\n|]+)/i,
  );
  const value = match?.[1]?.trim();
  return value && value.length > 1 ? value : null;
};

const extractCustomerNumber = (content: string): string | null => {
  const match = content.match(/\b(?:Kundennummer|Kunden Nr\.?|Customer Number)\b\s*:?\s*(?:\n\s*)?([A-Z0-9][A-Z0-9 /.-]{2,})/i);
  const value = match?.[1]?.trim();
  return value && value.length > 1 ? value : null;
};

const deterministicCustomFieldAssignments = (
  content: string,
  customFields: CustomField[],
): Record<string, unknown> => {
  const assignments: Record<string, unknown> = {};
  const setByName = (predicate: (name: string) => boolean, value: unknown) => {
    if (value === null || value === undefined || value === "") return;
    const field = customFields.find((candidate) => predicate(candidate.name));
    if (field) assignments[String(field.id)] = value;
  };
  setByName(isRealCorrespondentCustomField, extractMerchantFromContent(content));
  setByName((name) => normalizeCustomFieldKey(name) === "gesamt rechnungsbetrag", extractInvoiceTotal(content));
  setByName((name) => normalizeCustomFieldKey(name) === "rechnungsnummer", extractInvoiceNumber(content));
  setByName((name) => normalizeCustomFieldKey(name) === "kundennummer", extractCustomerNumber(content));
  setByName((name) => normalizeCustomFieldKey(name) === "einzelliste der artikel", extractFirstInvoiceLineItem(content));
  return assignments;
};

const enrichFinishMetadataWithDeterministicCustomFields = (
  params: FinishMetadataArguments,
  content: string,
  customFields: CustomField[],
): FinishMetadataArguments => {
  const deterministicAssignments = deterministicCustomFieldAssignments(content, customFields);
  if (Object.keys(deterministicAssignments).length === 0) return params;

  const existingAssignments = params.customFieldsJson?.trim()
    ? parseCatalogFieldAssignmentsJson(params.customFieldsJson, customFields)
    : {};

  return {
    ...params,
    customFieldsJson: JSON.stringify({
      ...deterministicAssignments,
      ...existingAssignments,
    }),
  };
};

const normalizeStringList = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const alternative = entry as Record<string, unknown>;
        return String(
          alternative["name"] ??
            alternative["label"] ??
            alternative["title"] ??
            alternative["id"] ??
            JSON.stringify(alternative),
        );
      }
      return String(entry);
    })
    .map(normalizeName)
    .filter((entry) => entry.length > 0);
  return items.length > 0 ? items : undefined;
};

const firstNonEmptyRecordValue = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = normalizeName(String(record[key] ?? ""));
    if (value) return value;
  }
  return "";
};

export const normalizeHumanDecisionArguments = (args: unknown) => {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const rawAction = String(record["action"] ?? "").toLowerCase();
  const rawKind = String(
    record["entityKind"] ?? record["entity_kind"] ?? record["entity"] ?? "",
  ).toLowerCase();
  const entityKind: EntityKind =
    rawKind === "document_type" ||
    rawKind === "document type" ||
    rawAction.includes("document_type") ||
    rawAction.includes("document type")
      ? "document_type"
      : rawKind === "correspondent" || rawAction.includes("correspondent")
        ? "correspondent"
        : "tag";
  const action: HumanDecisionAction = rawAction.includes("map")
    ? "map"
    : rawAction.includes("edit")
      ? "edit"
      : rawAction.includes("skip")
        ? "skip"
        : rawAction.includes("reject")
          ? "reject"
          : "create";
  const alternatives = normalizeStringList(record["alternatives"]);
  const candidateName = firstNonEmptyRecordValue(record, [
    "candidateName",
    "candidate_name",
    "suggestedName",
    "suggested_name",
    "proposedName",
    "proposed_name",
    "entityName",
    "entity_name",
    "targetName",
    "target_name",
    "correspondentName",
    "correspondent_name",
    "documentTypeName",
    "document_type_name",
    "tagName",
    "tag_name",
    "name",
  ]);
  const candidateId = toOptionalNumber(
    record["candidateId"] ??
      record["candidate_id"] ??
      record["proposedId"] ??
      record["proposed_id"],
  );
  const evidence = normalizeName(String(record["evidence"] ?? record["reasoning"] ?? ""));
  const userQuestion = normalizeName(
    String(record["userQuestion"] ?? record["user_question"] ?? record["question"] ?? ""),
  );
  const whyExistingCatalogIsInsufficient = normalizeName(
    String(
      record["whyExistingCatalogIsInsufficient"] ??
        record["why_existing_catalog_is_insufficient"] ??
        "",
    ),
  );

  return {
    entityKind,
    candidateName,
    candidateId,
    alternatives,
    evidence,
    whyExistingCatalogIsInsufficient,
    userQuestion,
    action,
  };
};

const toOptionalNumber = (value: unknown): number | undefined => {
  const parsed = parseFieldId(value);
  return parsed ?? undefined;
};

const toOptionalNumberArray = (value: unknown): number[] | undefined => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = values
    .map((entry) => parseFieldId(entry))
    .filter((entry): entry is number => entry !== null);
  return parsed.length > 0 ? parsed : undefined;
};

const toOptionalStringArray = (value: unknown): string[] | undefined => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  const parsed = values
    .map((entry) => normalizeName(String(entry)))
    .filter((entry) => entry.length > 0);
  return parsed.length > 0 ? parsed : undefined;
};

const toOptionalJsonString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

export const normalizeFinishMetadataArguments = (args: unknown) => {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};

  return {
    ...record,
    title: typeof record["title"] === "string" ? record["title"] : undefined,
    summary: typeof record["summary"] === "string" ? record["summary"] : undefined,
    correspondentId: toOptionalNumber(
      record["correspondentId"] ?? record["correspondent_id"] ?? record["correspondent"],
    ),
    correspondentName:
      typeof record["correspondentName"] === "string"
        ? record["correspondentName"]
        : typeof record["correspondent_name"] === "string"
          ? record["correspondent_name"]
          : undefined,
    documentTypeId: toOptionalNumber(
      record["documentTypeId"] ??
        record["document_type_id"] ??
        record["documentType"] ??
        record["document_type"],
    ),
    documentTypeName:
      typeof record["documentTypeName"] === "string"
        ? record["documentTypeName"]
        : typeof record["document_type_name"] === "string"
          ? record["document_type_name"]
          : undefined,
    tagIdsToAdd: toOptionalNumberArray(record["tagIdsToAdd"] ?? record["tag_ids_to_add"]),
    tagNamesToAdd: toOptionalStringArray(record["tagNamesToAdd"] ?? record["tag_names_to_add"]),
    tagIdsToRemove: toOptionalNumberArray(record["tagIdsToRemove"] ?? record["tag_ids_to_remove"]),
    customFieldValues: Array.isArray(record["customFieldValues"])
      ? record["customFieldValues"]
      : undefined,
    customFieldsJson: toOptionalJsonString(
      record["customFieldsJson"] ??
        record["custom_fieldsJson"] ??
        record["custom_fields_json"] ??
        record["customFields"] ??
        record["custom_fields"],
    ),
    linkedDocumentsJson: toOptionalJsonString(
      record["linkedDocumentsJson"] ??
        record["documentLinksJson"] ??
        record["document_links_json"] ??
        record["documentLinks"] ??
        record["document_links"] ??
        record["linked_documentsJson"] ??
        record["linked_documents_json"] ??
        record["linkedDocuments"] ??
        record["linked_documents"],
    ),
    extractedFactsJson: toOptionalJsonString(
      record["extractedFactsJson"] ??
        record["extracted_factsJson"] ??
        record["extracted_facts_json"] ??
        record["extractedFacts"] ??
        record["extracted_facts"],
    ),
    reasoning: typeof record["reasoning"] === "string" ? record["reasoning"] : undefined,
    confidence: toOptionalNumber(record["confidence"]),
  };
};

type FinishMetadataArguments = ReturnType<typeof normalizeFinishMetadataArguments>;

interface MetadataVerifierContext {
  doc: Document;
  content: string;
  catalogs: Record<string, unknown>;
  metadataPolicy: MetadataPolicy;
  promptLanguage: string;
  model: string;
  verifierSeed: number;
  confirmationEnabled: boolean;
  confirmationMaxRetries: number;
  confirmationMinConfidence: number;
  resume: boolean;
  appliedMetadata: AppliedMetadataAudit;
  dryRun: boolean;
}

const extractJsonObjectText = (value: string): string => {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
};

export const parseMetadataVerificationResponse = (value: string): ConfirmationResult => {
  if (!value.trim()) {
    return {
      confirmed: false,
      feedback: EMPTY_METADATA_VERIFIER_FEEDBACK,
    };
  }
  const parsed = parseJsonValue(extractJsonObjectText(value), "metadata verification response");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentError({
      message: "Invalid metadata verification response: expected a JSON object",
      agent: "document_agent",
    });
  }
  const record = parsed as Record<string, unknown>;
  const feedback = typeof record["feedback"] === "string" ? normalizeName(record["feedback"]) : "";
  const suggestedChange =
    typeof record["suggestedChange"] === "string"
      ? normalizeName(record["suggestedChange"])
      : typeof record["suggested_change"] === "string"
        ? normalizeName(record["suggested_change"])
        : "";
  return {
    confirmed: record["confirmed"] === true,
    feedback:
      feedback ||
      (record["confirmed"] === true
        ? undefined
        : "Metadata verifier rejected the metadata without detailed feedback."),
    suggestedChange: suggestedChange || undefined,
  };
};

export const getLowConfidenceFeedback = (confidence: unknown, minimum: number): string | null => {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  const threshold = Number.isFinite(minimum) ? minimum : 0.7;
  if (confidence >= threshold) return null;
  return `Metadata confidence ${confidence.toFixed(2)} is below the auto-apply threshold ${threshold.toFixed(2)}.`;
};

const readCatalogEntities = (catalogs: Record<string, unknown>, key: string): NamedCatalogEntity[] => {
  const value = catalogs[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return typeof record["id"] === "number" && typeof record["name"] === "string"
      ? [{ id: record["id"], name: record["name"] }]
      : [];
  });
};

const publicMetadataContainsSecretValue = (value: string | undefined): boolean => {
  if (!value) return false;
  const normalized = normalizeName(value);
  return redactSensitiveMetadataText(normalized) !== normalized;
};

export const getDeterministicMetadataVerificationFailure = (
  params: FinishMetadataArguments,
  catalogs: Record<string, unknown>,
): string | null => {
  if (publicMetadataContainsSecretValue(params.title)) {
    return "Title contains a secret value and must not be applied automatically.";
  }
  if (publicMetadataContainsSecretValue(params.summary)) {
    return "Summary contains a secret value and must not be applied automatically.";
  }

  const correspondents = readCatalogEntities(catalogs, "correspondents");
  if (
    params.correspondentId !== undefined &&
    !correspondents.some((entry) => entry.id === params.correspondentId)
  ) {
    return `Correspondent ID ${params.correspondentId} does not exist.`;
  }

  const documentTypes = readCatalogEntities(catalogs, "document_types");
  if (
    params.documentTypeId !== undefined &&
    !documentTypes.some((entry) => entry.id === params.documentTypeId)
  ) {
    return `Document type ID ${params.documentTypeId} does not exist.`;
  }

  const tags = readCatalogEntities(catalogs, "tags");
  const tagIds = [...(params.tagIdsToAdd ?? []), ...(params.tagIdsToRemove ?? [])];
  const missingTagId = tagIds.find((tagId) => !tags.some((entry) => entry.id === tagId));
  if (missingTagId !== undefined) {
    return `Tag ID ${missingTagId} does not exist.`;
  }

  return null;
};

const isDeferrableMetadataVerifierRejection = (feedback: string | undefined): boolean => {
  if (!feedback) return false;
  return /\b(id\s*\/\s*name|name\s*\/\s*id|mismatch|catalog|invents?|new (?:correspondent|document type|tag)|unknown (?:correspondent|document type|tag))\b/i.test(
    feedback,
  );
};

const METADATA_VERIFIER_SYSTEM_PROMPT = [
  "You are a strict metadata verifier for Paperless metadata.",
  "You do not apply changes. You only return JSON with confirmed, feedback, and optional suggested_change.",
  UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
].join("\n");

const METADATA_VERIFIER_RESERVED_OUTPUT_TOKENS = 4_096;
const OLLAMA_DOCUMENT_AGENT_HEALTHCHECK_TIMEOUT_MS = 15_000;
const OLLAMA_DOCUMENT_AGENT_HEALTHCHECK_MODEL_CANDIDATES = [
  "granite4:latest",
  "gemma3:4b",
  "qwen3:8b",
] as const;
const METADATA_VERIFIER_RESPONSE_FORMAT = {
  type: "object",
  properties: {
    confirmed: { type: "boolean" },
    feedback: { type: "string" },
    suggested_change: { type: "string" },
  },
  required: ["confirmed", "feedback"],
  additionalProperties: false,
};

const buildMetadataVerifierPromptWithExcerpt = (
  input: {
    doc: Pick<Document, "id" | "title" | "original_file_name" | "archived_file_name" | "mime_type">;
    proposedMetadata: FinishMetadataArguments;
    metadataPolicy: MetadataPolicy;
    catalogs: Record<string, unknown>;
    promptLanguage: string;
    minConfidence: number;
  },
  contentExcerpt: string,
): string =>
  JSON.stringify(
    {
      task: "Verify whether the proposed Paperless metadata can be applied automatically.",
      response_contract: {
        confirmed: "boolean",
        feedback: "short string explaining rejection or confirmation",
        suggested_change: "optional short correction",
      },
      rules: [
        "Return JSON only.",
        "Do not reject solely for a catalog ID/name mismatch or a possibly new catalog name; downstream deterministic logic will apply exact matches or pause for human review.",
        "Catalog IDs are scoped by catalog type. The same numeric ID may appear in correspondents, document types, tags, and custom fields without conflict.",
        "Only compare correspondentId against correspondents, documentTypeId against document_types, tag IDs against tags, and custom field IDs against custom_fields.",
        "Reject only if an explicitly supplied catalog ID does not exist in its own scoped catalog.",
        "Reject if the title or summary contains activation codes, PINs, TANs, passwords, or one-time codes.",
        "Reject if confidence is present and below the configured threshold.",
        UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
      ],
      prompt_language: input.promptLanguage,
      min_confidence: input.minConfidence,
      enabled_metadata_fields: input.metadataPolicy,
      document: {
        id: input.doc.id,
        title: input.doc.title,
        original_file_name: input.doc.original_file_name,
        archived_file_name: input.doc.archived_file_name,
        mime_type: input.doc.mime_type,
        content_excerpt: contentExcerpt,
      },
      proposed_metadata: input.proposedMetadata,
      catalogs: input.catalogs,
    },
    null,
    2,
  );

const ensureOllamaChatResponsive = (ollamaUrl: string): Effect.Effect<void, AgentError> =>
  Effect.tryPromise({
    try: async () => {
      const tagsResponse = await fetchWithTimeout(
        `${normalizeBaseUrl(ollamaUrl)}/api/tags`,
        { method: "GET" },
        OLLAMA_DOCUMENT_AGENT_HEALTHCHECK_TIMEOUT_MS,
      );
      if (!tagsResponse.ok) {
        throw new Error(`Ollama model listing failed: HTTP ${tagsResponse.status}`);
      }
      const tagsBody = (await tagsResponse.json()) as { models?: Array<{ name?: string; model?: string }> };
      const availableModels = new Set(
        (tagsBody.models ?? []).flatMap((entry) => [entry.name, entry.model]).filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        ),
      );
      const healthcheckModel =
        OLLAMA_DOCUMENT_AGENT_HEALTHCHECK_MODEL_CANDIDATES.find((candidate) =>
          availableModels.has(candidate),
        ) ?? [...availableModels][0];
      if (!healthcheckModel) {
        throw new Error("Ollama has no installed models to health check.");
      }

      const response = await fetchWithTimeout(
        `${normalizeBaseUrl(ollamaUrl)}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: healthcheckModel,
            stream: false,
            think: false,
            messages: [{ role: "user", content: "Return OK." }],
            options: { temperature: 0, num_predict: 1, num_ctx: 512 },
          }),
        },
        OLLAMA_DOCUMENT_AGENT_HEALTHCHECK_TIMEOUT_MS,
      );
      if (!response.ok) {
        throw new Error(`Ollama chat health check failed: HTTP ${response.status}`);
      }
      const body = (await response.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error.trim()) {
        throw new Error(`Ollama chat health check failed: ${body.error}`);
      }
    },
    catch: (error) =>
      new AgentError({
        message: `Ollama chat API is not responding; skipping document agent run: ${String(error)}`,
        agent: "document_agent",
        cause: error,
      }),
  });

export const buildMetadataVerifierPrompt = (input: {
  doc: Pick<Document, "id" | "title" | "original_file_name" | "archived_file_name" | "mime_type">;
  content: string;
  proposedMetadata: FinishMetadataArguments;
  metadataPolicy: MetadataPolicy;
  catalogs: Record<string, unknown>;
  promptLanguage: string;
  minConfidence: number;
  contextWindowTokens?: number;
}): string => {
  const staticPrompt = [
    METADATA_VERIFIER_SYSTEM_PROMPT,
    buildMetadataVerifierPromptWithExcerpt(input, formatUntrustedDocumentText("", 0)),
  ].join("\n");
  const excerptBudget = computeContentExcerptCharBudget({
    contextWindowTokens: input.contextWindowTokens ?? DEFAULT_OLLAMA_CONTEXT_WINDOW,
    reservedOutputTokens: METADATA_VERIFIER_RESERVED_OUTPUT_TOKENS,
    staticPromptText: staticPrompt,
    maxExcerptChars: 4_000,
  });

  return buildMetadataVerifierPromptWithExcerpt(
    input,
    formatUntrustedDocumentText(input.content, excerptBudget),
  );
};

const sensitiveMetadataKeywordAlternation = [
  "freischaltcode",
  "aktivierungscode",
  "zugangs[-\\s]?code",
  "sicherheits[-\\s]?code",
  "wiederherstellungs?[-\\s]?code",
  "backup[-\\s]?code",
  "sicherungs[-\\s]?code",
  "ersatz[-\\s]?code",
  "einmal[-\\s]?code",
  "einmalpasswort",
  "passwort",
  "kennwort",
  "\\bpin\\b",
  "\\btan\\b",
  "activation\\s+code",
  "access[-\\s]+code",
  "security[-\\s]+code",
  "login[-\\s]+code",
  "verification\\s+code",
  "one[-\\s]?time\\s+code",
  "one[-\\s]?time\\s+password",
  "\\botp\\b",
  "pass[-\\s]?code",
  "password",
  "recovery[-\\s]+code",
  "backup[-\\s]+code",
].join("|");

const sensitiveMetadataKeywordPattern = new RegExp(sensitiveMetadataKeywordAlternation, "i");
const sensitiveMetadataValueAfterKeywordPattern = new RegExp(
  `(${sensitiveMetadataKeywordAlternation})(\\s*(?::|=|[-–—]|ist\\b|is\\b)?\\s*)([A-Za-z0-9]{2,}(?:[-\\s][A-Za-z0-9]{2,})+|[A-Za-z0-9]{4,32})`,
  "gi",
);

// Public metadata may name the kind of document (for example "PIN-Brief") but
// must not expose the actual code value. Keep this conservative and contextual:
// secret-shaped values are only redacted/blocked when a sensitive keyword is
// present nearby.
const isSecretLikeMetadataValue = (value: string): boolean => {
  const compact = value.replace(/[-\s]/g, "");
  if (compact.length === 0) return false;

  if (/^\d{4,12}$/.test(compact)) return true;

  const hasLetter = /[A-Za-z]/.test(compact);
  const hasDigit = /\d/.test(compact);
  if (hasLetter && hasDigit && compact.length >= 6 && compact.length <= 32) return true;

  const hasSeparators = /[-\s]/.test(value);
  if (hasSeparators && /^[A-Z0-9]{8,32}$/.test(compact)) return true;

  const looksTokenLike = /^[A-Za-z0-9_-]{16,64}$/.test(compact);
  const hasMixedCase = /[a-z]/.test(compact) && /[A-Z]/.test(compact);
  return looksTokenLike && (hasDigit || hasMixedCase);
};

export const isUnsafeGeneratedTagName = (value: string): boolean => {
  const normalized = normalizeEntityKey(value);
  if (!normalized) return true;
  if (!sensitiveMetadataKeywordPattern.test(value)) return false;

  sensitiveMetadataValueAfterKeywordPattern.lastIndex = 0;
  for (const match of value.matchAll(sensitiveMetadataValueAfterKeywordPattern)) {
    const candidate = match[3];
    if (candidate && isSecretLikeMetadataValue(candidate)) return true;
  }
  return false;
};

export const redactSensitiveMetadataText = (value: string): string => {
  if (!sensitiveMetadataKeywordPattern.test(value)) return value;
  sensitiveMetadataValueAfterKeywordPattern.lastIndex = 0;
  return value.replace(
    sensitiveMetadataValueAfterKeywordPattern,
    (match, keyword: string, separator: string, candidate: string) =>
      isSecretLikeMetadataValue(candidate) ? `${keyword}${separator}[redacted]` : match,
  );
};

const normalizePublicTitle = (value: string): string =>
  redactSensitiveMetadataText(normalizeName(value))
    .replace(/\s*[:–-]\s*\[redacted\]\s*$/i, "")
    .replace(/\s*\(\s*\[redacted\]\s*\)\s*$/i, "")
    .trim();

export { buildDocumentAgentFewShotExamples } from "./document/fewShotExamples.js";

export const PiDocumentAgentServiceLive = Layer.effect(
  PiDocumentAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const concurrency = yield* ConcurrencyLimitService;
    const ollama = yield* OllamaService;
    const tinybase = yield* TinyBaseService;
    const cases = yield* DocumentCaseService;
    const tagExplorer = yield* PiTagExplorerAgentService;
    const tagConfig = config.config.tags;

    const resolveEntityCandidate = (kind: EntityKind, name: string) =>
      Effect.gen(function* () {
        const normalized = normalizeEntityKey(name);
        if (kind === "tag") {
          const tags = yield* paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([])));
          const byName = tags.find((tag) => normalizeEntityKey(tag.name) === normalized);
          return byName
            ? { id: byName.id, name: byName.name, exists: true }
            : { id: null, name, exists: false };
        }
        if (kind === "correspondent") {
          const correspondents = yield* paperless
            .getCorrespondents()
            .pipe(Effect.catchAll(() => Effect.succeed([])));
          const byName = correspondents.find(
            (entry) => normalizeEntityKey(entry.name) === normalized,
          );
          return byName
            ? { id: byName.id, name: byName.name, exists: true }
            : { id: null, name, exists: false };
        }
        const documentTypes = yield* paperless
          .getDocumentTypes()
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        const byName = documentTypes.find((entry) => normalizeEntityKey(entry.name) === normalized);
        return byName
          ? { id: byName.id, name: byName.name, exists: true }
          : { id: null, name, exists: false };
      });

    const boolSetting = (
      settings: Record<string, string>,
      key: string,
      fallback: boolean,
    ): boolean => {
      const value = settings[key];
      if (value === undefined) return fallback;
      return value === "true" || value === "1";
    };

    const numberSetting = (
      settings: Record<string, string>,
      key: string,
      fallback: number,
    ): number => {
      const value = settings[key];
      if (value === undefined) return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const getRuntimeSettings = () =>
      pipe(
        tinybase.getAllSettings(),
        Effect.map((settings) => {
          const saveHistorySetting =
            settings["debug.save_processing_history"] ?? settings["debug.saveProcessingHistory"];
          return {
            ollamaUrl: settings["ollama.url"] ?? config.config.ollama.url,
            model:
              settings["ollama.model"] ?? settings["ollama_model"] ?? config.config.ollama.model,
            dryRunModel: process.env["PI_DRY_RUN_MODEL"],
            agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
            confirmationEnabled: boolSetting(
              settings,
              "auto_processing.confirmation_enabled",
              config.config.autoProcessing.confirmationEnabled,
            ),
            confirmationMaxRetries: numberSetting(
              settings,
              "auto_processing.confirmation_max_retries",
              config.config.autoProcessing.confirmationMaxRetries,
            ),
            confirmationMinConfidence: numberSetting(
              settings,
              "auto_processing.confirmation_min_confidence",
              config.config.autoProcessing.confirmationMinConfidence ?? 0.7,
            ),
            promptLanguage: normalizePromptLanguage(
              settings["language.prompt"] ??
                settings["prompt_language"] ??
                settings["language"] ??
                config.config.language,
            ),
            tagLanguageAliasesDe: parseTagLanguageAliasRows(settings["tag_language.aliases.de"]),
            saveProcessingHistory:
              saveHistorySetting === undefined
                ? true
                : saveHistorySetting === "true" || saveHistorySetting === "1",
          };
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            ollamaUrl: config.config.ollama.url,
            model: config.config.ollama.model,
            dryRunModel: process.env["PI_DRY_RUN_MODEL"],
            agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
            confirmationEnabled: config.config.autoProcessing.confirmationEnabled,
            confirmationMaxRetries: config.config.autoProcessing.confirmationMaxRetries,
            confirmationMinConfidence:
              config.config.autoProcessing.confirmationMinConfidence ?? 0.7,
            promptLanguage: normalizePromptLanguage(config.config.language),
            tagLanguageAliasesDe: parseTagLanguageAliasRows(undefined),
            saveProcessingHistory: true,
          }),
        ),
      );

    const queueHumanDecision = (
      doc: Document,
      sessionId: string,
      kind: EntityKind,
      question: string,
      suggestion: string,
      alternatives: string[],
      metadata: Record<string, unknown>,
      dryRun: boolean,
    ) =>
      Effect.gen(function* () {
        if (dryRun) {
          return `dry-run-${kind}-${Date.now()}`;
        }

        const candidate = yield* resolveEntityCandidate(kind, suggestion);
        const alternativeCandidates = yield* Effect.all(
          alternatives
            .filter((name) => normalizeEntityKey(name) !== normalizeEntityKey(suggestion))
            .slice(0, 20)
            .map((name) => resolveEntityCandidate(kind, name)),
          { concurrency: "unbounded" },
        );

        const questionRecord = yield* cases
          .addQuestion({
            docId: doc.id,
            entityKind: kind,
            candidate,
            alternatives: alternativeCandidates,
            requestedAction:
              metadata["requestedAction"] === "map" ||
              metadata["requestedAction"] === "edit" ||
              metadata["requestedAction"] === "skip" ||
              metadata["requestedAction"] === "reject"
                ? metadata["requestedAction"]
                : "create",
            evidence: question,
            source: "document_agent",
            metadata: {
              kind: "metadata_proposal",
              sessionId,
              reasoning: question,
              requestedAction: metadata["requestedAction"],
              ...metadata,
            },
          })
          .pipe(
            Effect.mapError(
              (error) =>
                new AgentError({
                  message: `Failed to create metadata proposal: ${String(error)}`,
                  agent: "document_agent",
                  cause: error,
                }),
            ),
          );

        yield* tinybase
          .addProcessingLog({
            docId: doc.id,
            timestamp: new Date().toISOString(),
            step: "document_agent",
            eventType: "question_requested",
            data: {
              questionId: questionRecord.id,
              entityKind: kind,
              candidate: questionRecord.candidate,
              suggestion,
              reasoning: question,
            },
          })
          .pipe(Effect.catchAll(() => Effect.void));

        yield* paperless
          .transitionDocumentTag(doc.id, tagConfig.metadata, tagConfig.review)
          .pipe(Effect.catchAll(() => paperless.addTagToDocument(doc.id, tagConfig.review)));

        const reviewSummary = {
          id: `review-${Date.now()}`,
          agent: "review_agent",
          status: "paused",
          summary: `Paused for ${kind.replaceAll("_", " ")} proposal: ${suggestion}`,
          createdAt: new Date().toISOString(),
          questionId: questionRecord.id,
        };
        const caseRecord = yield* cases
          .getOrCreateCaseForDocument(doc.id)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (caseRecord) {
          yield* cases
            .appendRunSummary(caseRecord.id, reviewSummary)
            .pipe(Effect.catchAll(() => Effect.void));
        }
        yield* tinybase
          .appendRunSummary(doc.id, reviewSummary)
          .pipe(Effect.catchAll(() => Effect.void));

        return questionRecord.id;
      });

    const logVerificationResult = (
      docId: number,
      dryRun: boolean,
      model: string,
      seed: number,
      result: ConfirmationResult,
      confidence: unknown,
      diagnostics?: Record<string, unknown>,
    ) =>
      dryRun
        ? Effect.void
        : tinybase
            .addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: "metadata_verifier",
              eventType: result.confirmed ? "confirming" : "error",
              data: {
                model,
                seed,
                confirmed: result.confirmed,
                feedback: result.feedback,
                suggestedChange: result.suggestedChange,
                confidence,
                diagnostics,
              },
            })
            .pipe(Effect.catchAll(() => Effect.void));

    const verifyMetadataProposal = (
      params: FinishMetadataArguments,
      context: MetadataVerifierContext,
    ): Effect.Effect<ConfirmationResult, AgentError> =>
      Effect.gen(function* () {
        const lowConfidenceFeedback = getLowConfidenceFeedback(
          params.confidence,
          context.confirmationMinConfidence,
        );
        if (lowConfidenceFeedback) {
          const result = { confirmed: false, feedback: lowConfidenceFeedback };
          yield* logVerificationResult(
            context.doc.id,
            context.dryRun,
            context.model,
            context.verifierSeed,
            result,
            params.confidence,
          );
          return result;
        }

        const deterministicFailure = getDeterministicMetadataVerificationFailure(
          params,
          context.catalogs,
        );
        if (deterministicFailure) {
          const result = { confirmed: false, feedback: deterministicFailure };
          yield* logVerificationResult(
            context.doc.id,
            context.dryRun,
            context.model,
            context.verifierSeed,
            result,
            params.confidence,
            { source: "deterministic" },
          );
          return result;
        }

        if (!context.confirmationEnabled) {
          return { confirmed: true, feedback: "Metadata verification disabled." };
        }

        const prompt = buildMetadataVerifierPrompt({
          doc: context.doc,
          content: context.content,
          proposedMetadata: params,
          metadataPolicy: context.metadataPolicy,
          catalogs: context.catalogs,
          promptLanguage: context.promptLanguage,
          minConfidence: context.confirmationMinConfidence,
        });
        const response = yield* ollama
          .chat(
            context.model,
            [
              {
                role: "system",
                content: METADATA_VERIFIER_SYSTEM_PROMPT,
              },
              { role: "user", content: prompt },
            ],
            {
              temperature: 0,
              num_predict: METADATA_VERIFIER_RESERVED_OUTPUT_TOKENS,
              num_ctx: DEFAULT_OLLAMA_CONTEXT_WINDOW,
              seed: context.verifierSeed,
              format: METADATA_VERIFIER_RESPONSE_FORMAT,
              think: false,
            },
          )
          .pipe(
            Effect.mapError(
              (error) =>
                new AgentError({
                  message: `Metadata verification failed: ${String(error)}`,
                  agent: "document_agent",
                  cause: error,
                }),
            ),
          );
        const responseDiagnostics = {
          doneReason: response.done_reason,
          promptEvalCount: response.prompt_eval_count,
          evalCount: response.eval_count,
          contentLength: response.message.content?.length ?? 0,
          thinkingLength: response.message.thinking?.length ?? 0,
        };
        const result = yield* Effect.try({
          try: () => parseMetadataVerificationResponse(response.message.content ?? ""),
          catch: (error) =>
            error instanceof AgentError
              ? error
              : new AgentError({
                  message: `Invalid metadata verifier response: ${String(error)}`,
                  agent: "document_agent",
                  cause: error,
                }),
        });
        const effectiveResult =
          result.feedback === EMPTY_METADATA_VERIFIER_FEEDBACK
            ? {
                confirmed: true,
                feedback:
                  response.done_reason === "length"
                    ? "Metadata verifier reached its output limit before returning final JSON; continuing with deterministic validation."
                    : "Metadata verifier returned an empty response; continuing with deterministic validation.",
              }
            : !result.confirmed && isDeferrableMetadataVerifierRejection(result.feedback)
              ? {
                  confirmed: true,
                  feedback: `Metadata verifier reported a catalog issue that will be handled by deterministic apply/review logic: ${result.feedback}`,
                  suggestedChange: result.suggestedChange,
                }
              : result;
        yield* logVerificationResult(
          context.doc.id,
          context.dryRun,
          context.model,
          context.verifierSeed,
          effectiveResult,
          params.confidence,
          responseDiagnostics,
        );
        return effectiveResult;
      });

    const confirmMetadataBeforeApply = (
      params: FinishMetadataArguments,
      context: MetadataVerifierContext,
    ): Effect.Effect<FinishMetadataArguments, AgentError> => {
      let verifierFeedback = "Metadata verifier rejected the metadata.";
      return runConfirmationLoop<FinishMetadataArguments, FinishMetadataArguments>({
        maxRetries: 1,
        analyze: () => Effect.succeed(params),
        confirm: (analysis) =>
          verifyMetadataProposal(analysis, context).pipe(
            Effect.tap((confirmation) =>
              Effect.sync(() => {
                if (!confirmation.confirmed) {
                  verifierFeedback = confirmation.feedback ?? verifierFeedback;
                }
              }),
            ),
          ),
        apply: (analysis) => Effect.succeed(analysis),
        onMaxRetries: () =>
          Effect.fail(
            new AgentError({
              message: `Metadata verifier rejected metadata: ${verifierFeedback}`,
              agent: "document_agent",
            }),
          ),
      });
    };

    const createTools = (
      doc: Document,
      sessionId: string,
      pausedRef: { current: boolean },
      appliedRef: { current: Record<string, unknown> },
      finalToolRef: { current: string | null },
      dryRun: boolean,
      metadataPolicy: MetadataPolicy,
      promptLanguage: string,
      tagLanguageAliasesDe: readonly TagLanguageAliasRow[],
      verifierContext: Omit<
        MetadataVerifierContext,
        "doc" | "metadataPolicy" | "promptLanguage" | "dryRun"
      >,
      promptMemory: Pick<PromptSafeDocumentAgentMemory, "humanDecisions">,
    ): AgentTool[] => {
      const workflowTagNames = getWorkflowTagNames(tagConfig);
      const runToolEffect = <A>(
        effect: Effect.Effect<A, unknown, never>,
        signal?: AbortSignal,
      ): Promise<A> => Effect.runPromise(effect, { signal });
      const getEntityAlternatives = (kind: EntityKind): Effect.Effect<string[], never> => {
        const effect =
          kind === "correspondent"
            ? paperless
                .getCorrespondents()
                .pipe(Effect.map((items) => items.map((item) => item.name)))
            : kind === "document_type"
              ? paperless
                  .getDocumentTypes()
                  .pipe(Effect.map((items) => items.map((item) => item.name)))
              : paperless
                  .getTags()
                  .pipe(
                    Effect.map((items) =>
                      items
                        .filter((item) => !isWorkflowTagName(item.name, workflowTagNames))
                        .map((item) => item.name),
                    ),
                  );

        return effect.pipe(
          Effect.map((items) => items.slice(0, 50)),
          Effect.catchAll(() => Effect.succeed([])),
        );
      };

      const searchSimilarDocumentsParams = Type.Object({
        query: Type.String(),
        limit: Type.Optional(Type.Number()),
      });

      const getDocumentParams = Type.Object({
        docId: Type.Number(),
      });

      const exploreTagsParams = Type.Object({});

      const analyzeCatalogEntityParams = Type.Object({
        entityKind: Type.Union([
          Type.Literal("correspondent"),
          Type.Literal("document_type"),
          Type.Literal("tag"),
        ]),
        candidateName: Type.String(),
        evidence: Type.String(),
      });

      const setCustomFieldValueParams = Type.Object({
        fieldId: Type.Optional(Type.Number()),
        fieldName: Type.Optional(Type.String()),
        value: Type.Unknown(),
        evidence: Type.String(),
      });

      const requestHumanDecisionParams = Type.Object({
        entityKind: Type.Union([
          Type.Literal("correspondent"),
          Type.Literal("document_type"),
          Type.Literal("tag"),
        ]),
        candidateName: Type.String(),
        candidateId: Type.Optional(Type.Number()),
        alternatives: Type.Optional(Type.Array(Type.String())),
        evidence: Type.String(),
        whyExistingCatalogIsInsufficient: Type.Optional(Type.String()),
        userQuestion: Type.String(),
        action: Type.Union([
          Type.Literal("create"),
          Type.Literal("map"),
          Type.Literal("edit"),
          Type.Literal("skip"),
          Type.Literal("reject"),
        ]),
      });

      const finishDocumentMetadataParams = Type.Object({
        title: Type.Optional(Type.String()),
        summary: Type.Optional(Type.String()),
        correspondentId: Type.Optional(Type.Number()),
        correspondentName: Type.Optional(Type.String()),
        documentTypeId: Type.Optional(Type.Number()),
        documentTypeName: Type.Optional(Type.String()),
        tagIdsToAdd: Type.Optional(Type.Array(Type.Number())),
        tagNamesToAdd: Type.Optional(Type.Array(Type.String())),
        tagIdsToRemove: Type.Optional(Type.Array(Type.Number())),
        customFieldsJson: Type.Optional(Type.String()),
        customFieldValues: Type.Optional(
          Type.Array(
            Type.Object({
              fieldId: Type.Optional(Type.Number()),
              fieldName: Type.Optional(Type.String()),
              value: Type.Unknown(),
            }),
          ),
        ),
        linkedDocumentsJson: Type.Optional(Type.String()),
        extractedFactsJson: Type.Optional(Type.String()),
        reasoning: Type.Optional(Type.String()),
        confidence: Type.Optional(Type.Number()),
      });

      const searchSimilarDocuments: AgentTool<
        typeof searchSimilarDocumentsParams,
        { documents: unknown[] }
      > = {
        name: "search_similar_documents",
        label: "Search similar documents",
        description:
          "Search Paperless documents for examples that may help classify the current document.",
        parameters: searchSimilarDocumentsParams,
        execute: async (_toolCallId, params, signal) => {
          const documents = await runToolEffect(
            paperless.getSimilarDocuments(doc.id, params.limit ?? 10).pipe(
              Effect.map((docs) =>
                docs.map((candidate) => summarizeDocumentForAgent(candidate, 500)),
              ),
              Effect.catchAll(() => Effect.succeed([])),
            ),
            signal,
          );
          return textResult(JSON.stringify({ documents }), { documents });
        },
      };

      const getDocumentTool: AgentTool<typeof getDocumentParams, { document: unknown | null }> = {
        name: "get_document",
        label: "Get document",
        description: "Retrieve a Paperless document by ID.",
        parameters: getDocumentParams,
        execute: async (_toolCallId, params, signal) => {
          if (params.docId !== doc.id) {
            const payload = {
              document: null,
              error: "The document agent may only retrieve the current document by ID.",
            };
            return textResult(JSON.stringify(payload), payload);
          }

          const found = await runToolEffect(
            paperless.getDocument(params.docId).pipe(
              Effect.map((candidate) => summarizeDocumentForAgent(candidate, 1_500)),
              Effect.catchAll(() => Effect.succeed(null)),
            ),
            signal,
          );
          return textResult(JSON.stringify({ document: found }), { document: found });
        },
      };

      const exploreTagsTool: AgentTool<typeof exploreTagsParams, { result: unknown }> = {
        name: "explore_tags",
        label: "Explore tags",
        description:
          "Run the read-only tag explorer micro-agent. Use its recommendations as advice; finish_document_metadata still applies explicit tag IDs.",
        parameters: exploreTagsParams,
        execute: async (_toolCallId, _params, signal) => {
          const result = await runToolEffect(
            Effect.gen(function* () {
              const [currentDoc, tags, similarDocuments] = yield* Effect.all(
                [
                  paperless.getDocument(doc.id),
                  paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
                  paperless
                    .getSimilarDocuments(doc.id, 5)
                    .pipe(Effect.catchAll(() => Effect.succeed([]))),
                ],
                { concurrency: "unbounded" },
              );
              const tagNamesById = new Map(tags.map((tag) => [tag.id, tag.name] as const));
              const currentTagIds = (currentDoc.tags ?? []).filter((tagId) => {
                const name = tagNamesById.get(tagId);
                return !!name && !isWorkflowTagName(name, workflowTagNames);
              });
              const currentTagNames =
                currentDoc.tag_names && currentDoc.tag_names.length > 0
                  ? currentDoc.tag_names.filter(
                      (name) => !isWorkflowTagName(name, workflowTagNames),
                    )
                  : currentTagIds
                      .map((tagId) => tagNamesById.get(tagId))
                      .filter((name): name is string => !!name);
              return yield* tagExplorer.exploreTags({
                docId: currentDoc.id,
                title: currentDoc.title,
                content: currentDoc.content ?? "",
                originalFileName: currentDoc.original_file_name,
                archivedFileName: currentDoc.archived_file_name,
                mimeType: currentDoc.mime_type,
                currentTagIds,
                currentTagNames,
                catalogTags: tags
                  .filter((tag) => !isWorkflowTagName(tag.name, workflowTagNames))
                  .map((tag) => ({
                    id: tag.id,
                    name: tag.name,
                    document_count: tag.document_count,
                  })),
                similarDocuments: similarDocuments.map((candidate) => ({
                  id: candidate.id,
                  title: candidate.title,
                  tag_ids: [...candidate.tags],
                  tag_names: candidate.tag_names ? [...candidate.tag_names] : undefined,
                })),
                promptLanguage,
                tagLanguageAliasesDe,
              });
            }),
            signal,
          );
          return textResult(JSON.stringify(result), { result });
        },
      };

      const stagedCustomFields: Record<string, unknown> = {};
      const catalogAnalysisByCandidate = new Map<
        string,
        { recommendation: "use_existing" | "create"; existingId?: number; existingName?: string }
      >();

      const analyzeCatalogEntity: AgentTool<
        typeof analyzeCatalogEntityParams,
        {
          recommendation: "use_existing" | "create";
          entityKind: EntityKind;
          candidateName: string;
          existingId?: number;
          existingName?: string;
          alternatives: Array<{ id: number; name: string; document_count?: number }>;
          instruction: string;
        }
      > = {
        name: "analyze_catalog_entity",
        label: "Analyze catalog entity",
        description:
          "Separately analyze whether a proposed correspondent, document type, or tag should use an existing catalog entry or ask the user to create a new one. This tool never proposes merge/rename; consolidation handles that separately.",
        parameters: analyzeCatalogEntityParams,
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          const candidateName = normalizeName(params.candidateName);
          if (!candidateName) throw new Error("candidateName is required.");
          if (!params.evidence?.trim()) throw new Error("Evidence is required.");
          const items = await runToolEffect(
            (params.entityKind === "correspondent"
              ? paperless.getCorrespondents()
              : params.entityKind === "document_type"
                ? paperless.getDocumentTypes()
                : paperless.getTags()
            ).pipe(Effect.catchAll(() => Effect.succeed([]))),
            signal,
          );
          const filtered =
            params.entityKind === "tag"
              ? items.filter((item) => !isWorkflowTagName(item.name, workflowTagNames))
              : items;
          const exact = findByNormalizedName(filtered, candidateName);
          const candidateKey = normalizeEntityKey(candidateName);
          const alternatives = filtered
            .filter((item) => {
              const key = normalizeEntityKey(item.name);
              return key.includes(candidateKey) || candidateKey.includes(key);
            })
            .slice(0, 8)
            .map((item) => ({ id: item.id, name: item.name, document_count: item.document_count }));
          const recommendation: "use_existing" | "create" = exact ? "use_existing" : "create";
          const payload = {
            recommendation,
            entityKind: params.entityKind,
            candidateName,
            ...(exact ? { existingId: exact.id, existingName: exact.name } : {}),
            alternatives,
            instruction: exact
              ? `Use existing ${params.entityKind.replaceAll("_", " ")} ID ${exact.id} (${exact.name}) in finish_document_metadata. Do not ask the user.`
              : `No exact existing ${params.entityKind.replaceAll("_", " ")} found. If this entity is truly needed for the document, ask the user to create "${candidateName}" with request_human_decision action=create. Do not ask merge/map/rename questions.`,
          };
          catalogAnalysisByCandidate.set(`${params.entityKind}:${candidateKey}`, {
            recommendation,
            ...(exact ? { existingId: exact.id, existingName: exact.name } : {}),
          });
          return textResult(JSON.stringify(payload), payload);
        },
      };

      const setCustomFieldValue: AgentTool<
        typeof setCustomFieldValueParams,
        { accepted: boolean; fieldId?: number; fieldName?: string; staged: Record<string, unknown> }
      > = {
        name: "set_custom_field_value",
        label: "Set custom field value",
        description:
          "Validate and stage one custom field value for the current document. Call once per custom field with explicit evidence before finish_document_metadata.",
        parameters: setCustomFieldValueParams,
        executionMode: "sequential",
        execute: async (_toolCallId, params, signal) => {
          if (!metadataPolicy.customFields) {
            throw new Error("Custom fields are disabled by metadata settings.");
          }
          const fields = await runToolEffect(
            paperless.getCustomFields().pipe(Effect.catchAll(() => Effect.succeed([]))),
            signal,
          );
          const parsed = parseCatalogFieldAssignmentsJson(
            JSON.stringify([{ fieldId: params.fieldId, fieldName: params.fieldName, value: params.value }]),
            fields,
            { fieldKeys: ["fieldId", "fieldName"], valueKeys: ["value"] },
          );
          const [fieldId, value] = Object.entries(parsed)[0] ?? [];
          if (!fieldId) {
            throw new Error(
              `Unknown custom field ${params.fieldName ?? params.fieldId ?? "<missing>"}. Use one of: ${fields.map((field) => `${field.id}:${field.name}`).join(", ")}`,
            );
          }
          if (!params.evidence?.trim()) {
            throw new Error("Custom field evidence is required.");
          }
          stagedCustomFields[fieldId] = value;
          const field = fields.find((candidate) => candidate.id === Number(fieldId));
          const payload = { accepted: true, fieldId: Number(fieldId), fieldName: field?.name, staged: stagedCustomFields };
          return textResult(JSON.stringify(payload), payload);
        },
      };

      const requestHumanDecision: AgentTool<
        typeof requestHumanDecisionParams,
        { pendingId: string | null; paused: boolean }
      > = {
        name: "request_human_decision",
        label: "Request human decision",
        description:
          "Pause this Pi run and ask the user to create one concrete missing catalog entity. Do not use this for merge/map/rename decisions; those belong to catalog consolidation.",
        parameters: requestHumanDecisionParams,
        executionMode: "sequential",
        prepareArguments: normalizeHumanDecisionArguments,
        execute: async (_toolCallId, params, signal) => {
          if (!isPolicyEnabledForDecision(params.entityKind, metadataPolicy)) {
            throw new Error(
              `Human decisions for ${params.entityKind} are disabled by metadata settings.`,
            );
          }

          const candidateName = normalizeName(params.candidateName);
          const evidence = normalizeName(params.evidence);
          const userQuestion = normalizeName(params.userQuestion);
          if (!candidateName) {
            throw new Error(
              "Human decision candidateName is required. Do not ask vague review questions.",
            );
          }
          if (
            looksLikeMetadataBundleQuestion(candidateName) ||
            looksLikeMetadataBundleQuestion(userQuestion)
          ) {
            throw new Error(
              "request_human_decision is only for one concrete catalog entity. Do not use it to confirm a full metadata bundle; call finish_document_metadata with structured fields instead.",
            );
          }
          if (!evidence) {
            throw new Error(
              `Human decision evidence is required for ${params.entityKind} "${candidateName}".`,
            );
          }
          if (!userQuestion) {
            throw new Error(
              `Human decision userQuestion is required for ${params.entityKind} "${candidateName}".`,
            );
          }
          if (
            params.entityKind === "tag" &&
            /\b(which|what|welche|welchen|was)\b.*\b(tag|tags)\b/i.test(userQuestion)
          ) {
            throw new Error(
              "Open-ended tag questions are invalid. Propose one concrete tag candidate or skip tags.",
            );
          }
          if (params.entityKind === "tag" && isUnsafeGeneratedTagName(candidateName)) {
            throw new Error("Tag proposals must not contain secret values.");
          }

          const existingCandidate = await runToolEffect(
            resolveEntityCandidate(params.entityKind, candidateName),
            signal,
          );
          if (params.action === "map") {
            throw new Error(
              "Document agent must not request catalog merge/map decisions. Use an existing catalog ID/name for this document, or ask to create one concrete missing entity. Catalog merge/rename cleanup belongs to the separate catalog consolidation workflow.",
            );
          }
          const analysis = catalogAnalysisByCandidate.get(
            `${params.entityKind}:${normalizeEntityKey(candidateName)}`,
          );
          if (!analysis) {
            throw new Error(
              `Call analyze_catalog_entity for ${params.entityKind} "${candidateName}" before requesting human creation.`,
            );
          }
          if (analysis.recommendation === "use_existing") {
            throw new Error(
              `Catalog analysis found existing ${params.entityKind} ${analysis.existingId} (${analysis.existingName}). Use that ID in finish_document_metadata instead of asking the user.`,
            );
          }
          if (existingCandidate.exists && params.action === "create") {
            const idField =
              params.entityKind === "correspondent"
                ? "correspondentId"
                : params.entityKind === "document_type"
                  ? "documentTypeId"
                  : "tagIdsToAdd";
            const payload = {
              pendingId: null,
              paused: false,
              existingCandidate,
              instruction:
                params.entityKind === "tag"
                  ? `The tag already exists. Continue by calling finish_document_metadata with ${idField} including ${existingCandidate.id}.`
                  : `The ${params.entityKind.replaceAll("_", " ")} already exists. Continue by calling finish_document_metadata with ${idField}: ${existingCandidate.id}.`,
            };
            return textResult(JSON.stringify(payload), payload);
          }

          const pendingId = await runToolEffect(
            Effect.gen(function* () {
              const alternatives = params.alternatives?.length
                ? params.alternatives
                : yield* getEntityAlternatives(params.entityKind);
              return yield* queueHumanDecision(
                doc,
                sessionId,
                params.entityKind,
                userQuestion,
                candidateName,
                alternatives,
                {
                  requestedAction: params.action,
                  candidateId: params.candidateId,
                  evidence,
                  whyExistingCatalogIsInsufficient: params.whyExistingCatalogIsInsufficient,
                },
                dryRun,
              );
            }),
            signal,
          );
          pausedRef.current = true;
          finalToolRef.current = "request_human_decision";
          return textResult(
            JSON.stringify({ pendingId, paused: true }),
            { pendingId, paused: true },
            true,
          );
        },
      };

      const finishDocumentMetadata: AgentTool<
        typeof finishDocumentMetadataParams,
        { applied: Record<string, unknown>; paused: boolean }
      > = {
        name: "finish_document_metadata",
        label: "Finish document metadata",
        description:
          "Apply final metadata decisions to Paperless, or only return proposed changes during dry-run testing. New catalog entities must be requested through request_human_decision first.",
        parameters: finishDocumentMetadataParams,
        executionMode: "sequential",
        prepareArguments: normalizeFinishMetadataArguments,
        execute: async (_toolCallId, rawParams, signal) => {
          const result = await runToolEffect(
            Effect.gen(function* () {
              const updates: Record<string, unknown> = {};
              const applied: Record<string, unknown> = {};
              const currentDoc = yield* paperless.getDocument(doc.id);
              const [allCorrespondents, allDocumentTypes, catalogCustomFields] = yield* Effect.all(
                [
                  paperless.getCorrespondents().pipe(Effect.catchAll(() => Effect.succeed([]))),
                  paperless.getDocumentTypes().pipe(Effect.catchAll(() => Effect.succeed([]))),
                  paperless.getCustomFields().pipe(Effect.catchAll(() => Effect.succeed([]))),
                ],
                { concurrency: "unbounded" },
              );
              const params = yield* confirmMetadataBeforeApply(
                enrichFinishMetadataWithDeterministicCustomFields(
                  normalizeFinishMetadataArguments(rawParams),
                  currentDoc.content ?? doc.content ?? "",
                  catalogCustomFields,
                ),
                {
                  ...verifierContext,
                  doc,
                  metadataPolicy,
                  promptLanguage,
                  dryRun,
                },
              );
              if (params.confidence !== undefined) {
                applied["confidence"] = Math.max(0, Math.min(1, params.confidence));
              }
              const pauseWithPendingDecision = (pendingId: string | null) =>
                Effect.gen(function* () {
                  if (!pendingId) {
                    return yield* Effect.fail(
                      new AgentError({
                        message: "Human decision request did not return a pending review id.",
                        agent: "document_agent",
                      }),
                    );
                  }
                  if (!dryRun && Object.keys(updates).length > 0) {
                    const stagedMetadata = {
                      pendingId,
                      sessionId,
                      updates,
                      decisions: applied,
                      stagedAt: new Date().toISOString(),
                    };
                    const memory = yield* tinybase
                      .getDocumentMemory(doc.id)
                      .pipe(Effect.catchAll(() => Effect.succeed(null)));
                    yield* tinybase
                      .patchDocumentMemory(doc.id, {
                        candidateEntities: {
                          ...(memory?.candidateEntities ?? {}),
                          stagedMetadata,
                        },
                      })
                      .pipe(Effect.catchAll(() => Effect.void));
                    const caseRecord = yield* cases
                      .getOrCreateCaseForDocument(doc.id)
                      .pipe(Effect.catchAll(() => Effect.succeed(null)));
                    if (caseRecord) {
                      yield* cases
                        .updateCase(caseRecord.id, { memory: { stagedMetadata } })
                        .pipe(Effect.catchAll(() => Effect.void));
                    }
                  }
                  pausedRef.current = true;
                  return { applied: {}, staged: applied, pendingId, paused: true };
                });

              const queueMetadataReview = (
                kind: EntityKind,
                candidateName: string,
                userQuestion: string,
                evidence: string,
                alternatives: string[],
                metadata: Record<string, unknown>,
              ) =>
                Effect.gen(function* () {
                  const wasRejected = promptMemory.humanDecisions.some(
                    (decision) =>
                      decision.type === kind &&
                      decision.answer === "reject" &&
                      normalizeEntityKey(decision.suggestion) === normalizeEntityKey(candidateName),
                  );
                  const adjustedMetadata = { ...metadata };
                  let adjustedQuestion = userQuestion;
                  let adjustedAlternatives = alternatives;
                  if (wasRejected && metadata["requestedAction"] === "map") {
                    const reverseMapTargetName = alternatives[0]?.trim() ?? "";
                    adjustedMetadata["requestedAction"] = "create";
                    adjustedMetadata["source"] = `${String(metadata["source"] ?? "agent")}_after_reject`;
                    if (reverseMapTargetName) {
                      adjustedMetadata["reverseMapTargetName"] = reverseMapTargetName;
                      adjustedQuestion = `Rename existing ${kind.replaceAll("_", " ")} "${reverseMapTargetName}" to "${candidateName}" and use it?`;
                    } else {
                      adjustedQuestion = `Create or use ${kind.replaceAll("_", " ")} "${candidateName}" instead of mapping it to the previous existing entry?`;
                    }
                    adjustedAlternatives = [];
                  }
                  const pendingId = yield* queueHumanDecision(
                    doc,
                    sessionId,
                    kind,
                    adjustedQuestion,
                    candidateName,
                    adjustedAlternatives,
                    {
                      evidence,
                      ...adjustedMetadata,
                    },
                    dryRun,
                  );
                  return yield* pauseWithPendingDecision(pendingId);
                });

              if (metadataPolicy.title && params.title?.trim()) {
                const title = normalizePublicTitle(params.title);
                if (title) {
                  updates["title"] = title;
                  applied["title"] = title;
                }
              }

              if (
                metadataPolicy.correspondent &&
                (params.correspondentId !== undefined || params.correspondentName?.trim())
              ) {
                const name = normalizeName(params.correspondentName ?? "");
                const byId =
                  params.correspondentId !== undefined
                    ? (allCorrespondents.find((entry) => entry.id === params.correspondentId) ??
                      null)
                    : null;
                if (params.correspondentId !== undefined && !byId) {
                  throw new Error(`Correspondent ID ${params.correspondentId} does not exist.`);
                }
                const byName = findByNormalizedName(allCorrespondents, name);
                const byContentHeading = findByNormalizedName(
                  allCorrespondents,
                  getContentHeading(currentDoc.content ?? ""),
                );
                const idNameMismatch =
                  !!byId && !!name && normalizeEntityKey(byId.name) !== normalizeEntityKey(name);
                if (byContentHeading && (byId ?? byName)?.id !== byContentHeading.id) {
                  updates["correspondent"] = byContentHeading.id;
                  applied["correspondent"] = byContentHeading.id;
                } else if (idNameMismatch && byId && currentDoc.correspondent === byId.id) {
                  updates["correspondent"] = byId.id;
                  applied["correspondent"] = byId.id;
                } else if (idNameMismatch && byName) {
                  updates["correspondent"] = byName.id;
                  applied["correspondent"] = byName.id;
                } else if (idNameMismatch && byId) {
                  updates["correspondent"] = byId.id;
                  applied["correspondent"] = byId.id;
                  yield* tinybase
                    .addProcessingLog({
                      docId: doc.id,
                      timestamp: new Date().toISOString(),
                      step: "document_agent",
                      eventType: "result",
                      data: {
                        ignoredAlias: name,
                        usedExistingCorrespondent: byId.name,
                        reason: "catalog_id_name_mismatch_merge_review_deferred",
                      },
                    })
                    .pipe(Effect.catchAll(() => Effect.void));
                } else {
                  const proposed = byId ?? byName;
                  if (proposed) {
                    updates["correspondent"] = proposed.id;
                    applied["correspondent"] = proposed.id;
                  } else if (name) {
                    return yield* queueMetadataReview(
                      "correspondent",
                      name,
                      `Create new correspondent "${name}"?`,
                      `The agent proposed correspondent "${name}", which does not exactly match an existing Paperless correspondent.`,
                      [],
                      {
                        requestedAction: "create",
                        source: "unknown_agent_correspondent_name",
                      },
                    );
                  }
                }
              }

              if (
                metadataPolicy.documentType &&
                (params.documentTypeId !== undefined || params.documentTypeName?.trim())
              ) {
                const name = normalizeName(params.documentTypeName ?? "");
                const byId =
                  params.documentTypeId !== undefined
                    ? (allDocumentTypes.find((entry) => entry.id === params.documentTypeId) ?? null)
                    : null;
                if (params.documentTypeId !== undefined && !byId) {
                  throw new Error(`Document type ID ${params.documentTypeId} does not exist.`);
                }
                const byName = findByNormalizedName(allDocumentTypes, name);
                const idNameMismatch =
                  !!byId && !!name && normalizeEntityKey(byId.name) !== normalizeEntityKey(name);
                if (idNameMismatch && byId && currentDoc.document_type === byId.id) {
                  updates["document_type"] = byId.id;
                  applied["document_type"] = byId.id;
                } else if (idNameMismatch && byName) {
                  updates["document_type"] = byName.id;
                  applied["document_type"] = byName.id;
                } else if (idNameMismatch && byId) {
                  updates["document_type"] = byId.id;
                  applied["document_type"] = byId.id;
                  yield* tinybase
                    .addProcessingLog({
                      docId: doc.id,
                      timestamp: new Date().toISOString(),
                      step: "document_agent",
                      eventType: "result",
                      data: {
                        ignoredAlias: name,
                        usedExistingDocumentType: byId.name,
                        reason: "catalog_id_name_mismatch_merge_review_deferred",
                      },
                    })
                    .pipe(Effect.catchAll(() => Effect.void));
                } else {
                  const proposed = byId ?? byName;
                  if (proposed) {
                    updates["document_type"] = proposed.id;
                    applied["document_type"] = proposed.id;
                  } else if (name) {
                    return yield* queueMetadataReview(
                      "document_type",
                      name,
                      `Create new document type "${name}"?`,
                      `The agent proposed document type "${name}", which does not exactly match an existing Paperless document type.`,
                      [],
                      {
                        requestedAction: "create",
                        source: "unknown_agent_document_type_name",
                      },
                    );
                  }
                }
              }

              const currentTagIds = currentDoc.tags ?? [];
              let tagIds = [...currentTagIds];

              if (metadataPolicy.tags) {
                const allTags = yield* paperless
                  .getTags()
                  .pipe(Effect.catchAll(() => Effect.succeed([])));
                const tagById = new Map(allTags.map((tag) => [tag.id, tag] as const));
                const deterministicRequiredTags = findRequiredCompanyTags(
                  currentDoc.content ?? "",
                  allTags.filter((tag) => !isWorkflowTagName(tag.name, workflowTagNames)),
                );
                const validateTagId = (tagId: number) => {
                  const tag = tagById.get(tagId);
                  if (!tag) throw new Error(`Tag ID ${tagId} does not exist.`);
                  if (isWorkflowTagName(tag.name, workflowTagNames)) {
                    throw new Error(`Workflow tag "${tag.name}" must not be changed by the agent.`);
                  }
                  return tag;
                };
                const stageTagUpdates = () => {
                  if (
                    tagIds.length !== currentTagIds.length ||
                    tagIds.some((tagId) => !currentTagIds.includes(tagId))
                  ) {
                    updates["tags"] = tagIds;
                  } else {
                    delete updates["tags"];
                  }
                };

                if (params.tagIdsToRemove?.length) {
                  const remove = new Set(
                    params.tagIdsToRemove.map((tagId) => validateTagId(tagId).id),
                  );
                  tagIds = tagIds.filter((id) => !remove.has(id));
                  if (remove.size > 0) {
                    applied["removed_tag_ids"] = [...remove];
                  }
                }

                if (params.tagIdsToAdd?.length) {
                  const tagIdsToAdd = params.tagIdsToAdd.map((tagId) => validateTagId(tagId).id);
                  for (const tagId of tagIdsToAdd) {
                    if (!tagIds.includes(tagId)) tagIds.push(tagId);
                  }
                  if (tagIdsToAdd.length > 0) {
                    applied["added_tag_ids"] = tagIdsToAdd;
                  }
                }

                if (params.tagNamesToAdd) {
                  const addedNames: string[] = [];
                  for (const rawName of params.tagNamesToAdd) {
                    const name = normalizeName(rawName);
                    if (!name) continue;
                    if (isWorkflowTagName(name, workflowTagNames)) {
                      throw new Error(`Workflow tag "${name}" must not be changed by the agent.`);
                    }
                    if (isUnsafeGeneratedTagName(name)) {
                      throw new Error("Tag names must not contain secret values.");
                    }
                    const existing = findByNormalizedName(allTags, name);
                    if (existing) {
                      validateTagId(existing.id);
                      if (!tagIds.includes(existing.id)) {
                        tagIds.push(existing.id);
                      }
                      addedNames.push(existing.name);
                    } else {
                      if (addedNames.length > 0) {
                        applied["added_tag_names"] = [...addedNames];
                      }
                      stageTagUpdates();
                      return yield* queueMetadataReview(
                        "tag",
                        name,
                        `Create new tag "${name}"?`,
                        `The agent proposed tag "${name}", which does not exactly match an existing Paperless tag.`,
                        allTags
                          .filter((tag) => !isWorkflowTagName(tag.name, workflowTagNames))
                          .slice(0, 20)
                          .map((tag) => tag.name),
                        {
                          requestedAction: "create",
                          source: "unknown_agent_tag_name",
                        },
                      );
                    }
                  }
                  if (addedNames.length > 0) {
                    applied["added_tag_names"] = addedNames;
                  }
                }

                for (const tag of deterministicRequiredTags) {
                  if (!tagIds.includes(tag.id)) tagIds.push(tag.id);
                }
                if (deterministicRequiredTags.length > 0) {
                  const existingAdded = Array.isArray(applied["added_tag_ids"])
                    ? (applied["added_tag_ids"] as number[])
                    : [];
                  applied["added_tag_ids"] = [
                    ...new Set([...existingAdded, ...deterministicRequiredTags.map((tag) => tag.id)]),
                  ];
                }

                stageTagUpdates();
              }

              const customFields = [...((currentDoc.custom_fields ?? []) as CustomFieldValue[])];
              const upsertCustomField = (fieldId: number, value: unknown) => {
                const index = customFields.findIndex((field) => field.field === fieldId);
                if (index >= 0) {
                  customFields[index] = { field: fieldId, value };
                } else {
                  customFields.push({ field: fieldId, value });
                }
              };

              if (metadataPolicy.customFields && Object.keys(stagedCustomFields).length > 0) {
                for (const [fieldId, value] of Object.entries(stagedCustomFields)) {
                  upsertCustomField(Number(fieldId), value);
                }
                applied["custom_fields"] = { ...(applied["custom_fields"] ?? {}), ...stagedCustomFields };
              }

              if (metadataPolicy.customFields && params.customFieldsJson?.trim()) {
                const parsed = parseCatalogFieldAssignmentsJson(
                  params.customFieldsJson,
                  catalogCustomFields,
                  { includeEmptyObject: true },
                );
                for (const [fieldId, value] of Object.entries(parsed)) {
                  const parsedFieldId = Number(fieldId);
                  if (Number.isFinite(parsedFieldId) && value !== undefined) {
                    upsertCustomField(parsedFieldId, value);
                  }
                }
                applied["custom_fields"] = parsed;
              }
              if (metadataPolicy.customFields && params.customFieldValues?.length) {
                const structured = parseCatalogFieldAssignmentsJson(
                  JSON.stringify(params.customFieldValues),
                  catalogCustomFields,
                  { fieldKeys: ["fieldId", "fieldName"], valueKeys: ["value"] },
                );
                for (const [fieldId, value] of Object.entries(structured)) {
                  const parsedFieldId = Number(fieldId);
                  if (Number.isFinite(parsedFieldId)) upsertCustomField(parsedFieldId, value);
                }
                applied["custom_fields"] = { ...(applied["custom_fields"] ?? {}), ...structured };
              }

              if (metadataPolicy.documentLinks && params.linkedDocumentsJson?.trim()) {
                const parsed = parseCatalogFieldAssignmentsJson(
                  params.linkedDocumentsJson,
                  catalogCustomFields,
                  {
                    valueKeys: [
                      "value",
                      "document_ids",
                      "documentIds",
                      "documents",
                      "document_id",
                      "documentId",
                    ],
                  },
                );
                for (const [fieldId, value] of Object.entries(parsed)) {
                  const parsedFieldId = Number(fieldId);
                  const values = Array.isArray(value) ? value : [value];
                  const docIds = values.map((entry) => Number(entry)).filter(Number.isFinite);
                  if (Number.isFinite(parsedFieldId)) {
                    upsertCustomField(parsedFieldId, docIds);
                  }
                }
                applied["linked_documents"] = parsed;
              }

              if (
                customFields.length !==
                  ((currentDoc.custom_fields ?? []) as CustomFieldValue[]).length ||
                applied["custom_fields"] ||
                applied["linked_documents"]
              ) {
                updates["custom_fields"] = customFields;
              }

              const protectedKeys = verifierContext.resume
                ? getResumeProtectedMetadataKeys(verifierContext.appliedMetadata, applied)
                : [];
              if (protectedKeys.length > 0) {
                for (const key of protectedKeys) {
                  delete applied[key];
                  const updateKey = updateKeyForAppliedMetadataKey(key);
                  if (updateKey) delete updates[updateKey];
                }
                yield* tinybase
                  .addProcessingLog({
                    docId: doc.id,
                    timestamp: new Date().toISOString(),
                    step: "document_agent",
                    eventType: "result",
                    data: {
                      skippedAlreadyAppliedMetadata: protectedKeys,
                      reason: "resume_would_overwrite_prior_decision",
                    },
                  })
                  .pipe(Effect.catchAll(() => Effect.void));
              }

              if (!dryRun && Object.keys(updates).length > 0) {
                yield* paperless.updateDocument(doc.id, updates);
              }

              const summary = params.summary?.trim()
                ? redactSensitiveMetadataText(normalizeName(params.summary))
                : "";

              if (metadataPolicy.summary && summary) {
                const previousSummary = verifierContext.resume
                  ? verifierContext.appliedMetadata["summary"]
                  : undefined;
                if (previousSummary) {
                  yield* tinybase
                    .addProcessingLog({
                      docId: doc.id,
                      timestamp: new Date().toISOString(),
                      step: "document_agent",
                      eventType: "result",
                      data: {
                        skippedAlreadyAppliedMetadata: ["summary"],
                        reason: "resume_would_duplicate_prior_summary",
                      },
                    })
                    .pipe(Effect.catchAll(() => Effect.void));
                } else if (!dryRun) {
                  const noteResult = yield* Effect.either(paperless.addNote(doc.id, summary));
                  if (noteResult._tag === "Left") {
                    yield* tinybase
                      .addProcessingLog({
                        docId: doc.id,
                        timestamp: new Date().toISOString(),
                        step: "document_agent",
                        eventType: "result",
                        data: {
                          warning: true,
                          message:
                            "Document metadata was applied, but summary note creation failed.",
                          error: String(noteResult.left),
                        },
                      })
                      .pipe(Effect.catchAll(() => Effect.void));
                  } else {
                    applied["summary"] = summary;
                  }
                } else {
                  applied["summary"] = summary;
                }
              }

              const extractedFacts = params.extractedFactsJson?.trim()
                ? parseJsonObject(params.extractedFactsJson)
                : {};

              if (!dryRun) {
                const appliedAt = new Date().toISOString();
                const nextAppliedMetadata = mergeAppliedMetadataAudit(
                  verifierContext.appliedMetadata,
                  applied,
                  appliedAt,
                  sessionId,
                );
                yield* tinybase
                  .patchDocumentMemory(doc.id, {
                    extractedFacts,
                    finalDecisions: applied,
                  })
                  .pipe(Effect.catchAll(() => Effect.void));
                const caseRecord = yield* cases
                  .getOrCreateCaseForDocument(doc.id)
                  .pipe(Effect.catchAll(() => Effect.succeed(null)));
                if (caseRecord) {
                  yield* cases
                    .updateCase(caseRecord.id, {
                      memory: { appliedMetadata: nextAppliedMetadata },
                    })
                    .pipe(Effect.catchAll(() => Effect.void));
                }
              }

              appliedRef.current = { ...appliedRef.current, ...applied };
              return { applied, paused: false };
            }).pipe(
              Effect.catchAll((error) =>
                Effect.succeed({
                  applied: {},
                  paused: false,
                  error: String(error),
                }),
              ),
            ),
            signal,
          );

          if ("error" in result) {
            throw new Error(result.error);
          }

          appliedRef.current = { ...appliedRef.current, ...result.applied };
          finalToolRef.current = "finish_document_metadata";

          return textResult(
            JSON.stringify(result),
            { applied: result.applied, paused: result.paused },
            true,
          );
        },
      };

      return [
        searchSimilarDocuments,
        getDocumentTool,
        exploreTagsTool,
        analyzeCatalogEntity,
        setCustomFieldValue,
        requestHumanDecision,
        finishDocumentMetadata,
      ];
    };

    const buildSystemPrompt = (
      promptLanguage: string,
      tagLanguageAliasesDe: readonly TagLanguageAliasRow[],
    ): string =>
      [
        "You are document_agent for a Paperless-ngx archive.",
        "Classify and enrich one document using only the provided tools.",
        buildPromptLanguageInstruction(promptLanguage, tagLanguageAliasesDe),
        buildDocumentAgentFewShotExamples(promptLanguage),
        "A text-only answer is invalid.",
        "First call search_similar_documents for the current document.",
        "When tags are enabled, call explore_tags after search_similar_documents before final tag decisions.",
        "Then call exactly one of request_human_decision or finish_document_metadata.",
        "Never stop until one of those final tools has been called.",
        "Use existing Paperless catalog entities whenever possible.",
        "When a new tag, correspondent, or document type may be needed, first call analyze_catalog_entity. If it returns use_existing, use that existing ID in finish_document_metadata. Only if it returns create may you call request_human_decision action=create.",
        "request_human_decision requires a concrete candidateName, evidence, and userQuestion. Vague review questions are invalid.",
        "Do not ask users to merge, map, or rename catalog entities from the document agent. If an entity already exists, use its ID. If a truly missing entity is needed, ask only whether to create that concrete entity. Catalog merge/rename cleanup is handled by the separate catalog consolidation workflow.",
        "Never use request_human_decision to ask the user to approve a full metadata bundle with title, correspondent, document type, and tags. Use finish_document_metadata with structured fields for that.",
        "Prefer broad stable tags from the catalog over narrow one-document labels.",
        "Mandatory company tag rule: if the current document mentions SKYWAY, the existing SKYWAY tag must be included. Company/project tags like SKYWAY are critical and must not be skipped as too specific.",
        "When multiple existing tags are plausible, prefer the semantically correct established tag with the higher document count.",
        "Do not request tags containing actual activation codes, PINs, TANs, passwords, one-time codes, or secret values.",
        "If tag review is unavoidable, request one concrete tag proposal at a time; never ask the user an open-ended which-tags question.",
        "Document types must be broad reusable classes, not provider-specific or product-specific labels.",
        "Similar documents are only supporting examples. Never copy their correspondent, document type, or tags when the current document sender, subject, body, or filename says otherwise.",
        "Use explicit current-document source evidence first: email From header, letterhead, sender address, title line, and filename beat vector search results.",
        "For correspondent, choose the document sender/issuer shown in the current document's From header, letterhead, or first heading. Do not use a marketplace, merchant, payee, or product brand as correspondent merely because it appears in the invoice body; put seller/merchant/payee in custom fields instead.",
        "Never pass mismatched IDs and names. If you use an ID, the name must describe that exact catalog entity.",
        "When custom fields are enabled, call set_custom_field_value once per field with explicit evidence before finish_document_metadata. Use customFieldValues/customFieldsJson only as fallback in finish_document_metadata.",
        'For custom fields named "Echter Korrespondent", "real correspondent", "seller", or "merchant", extract the actual seller/merchant/payee from rows or labels such as Seller, Merchant, Händler, or Verkäufer. Do not use a payment platform such as PayPal as the real correspondent unless it is explicitly the seller.',
        'For invoice custom fields, extract obvious values: "Gesamt Rechnungsbetrag" as the numeric total, "Einzelliste der Artikel" as the purchased line items, "Rechnungsnummer" from invoice/order number labels, and "Kundennummer" from customer/account number labels.',
        "Do not ask the user for a narrower document type when an existing broad type is good enough.",
        "Map obvious aliases to existing types: Allgemeine Geschäftsbedingungen -> AGB; Festsetzungsbescheid/Rundfunkbeitragsbescheid -> Gebührenbescheid; order confirmation -> Bestellbestätigung; discount/marketing letters -> Werbung.",
        "For letters containing activation or access codes, use the closest existing broad letter/code document type instead of proposing a new product-specific type.",
        "Call finish_document_metadata exactly once when your final decisions are ready and include confidence from 0.0 to 1.0.",
        "The metadata verifier rejects low-confidence metadata and unsafe catalog decisions before anything is applied.",
        "Return concise decisions; do not invent IDs.",
        "Never add or remove workflow tags such as llm-*; the pipeline owns those.",
        "Do not put secret activation codes, PINs, TANs, passwords, or one-time codes in titles or summaries; store them only in extracted facts if needed.",
        "Treat the current document content, original filename, and MIME type as authoritative.",
        UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
        "Existing titles and similar documents may be stale; if they conflict with the current file content, prefer the current file content.",
      ].join("\n");

    const buildUserPrompt = (
      doc: Document,
      content: string,
      catalogs: Record<string, unknown>,
      memory: {
        humanDecisions: unknown[];
        reviewFeedback: unknown[];
        appliedMetadata: AppliedMetadataAudit;
      },
      metadataPolicy: MetadataPolicy,
      resume: boolean,
      documentTags: {
        tagIds: number[];
        tagNames: string[];
        workflowTagNames: string[];
      },
      promptLanguage: string,
      tagLanguageAliasesDe: readonly TagLanguageAliasRow[],
    ): string => {
      const contentHeading = getContentHeading(content);
      const requiredSearch = {
        query: buildDocumentSearchQuery(doc, content),
        limit: 5,
      };
      const buildPromptForExcerpt = (contentExcerpt: string): string => {
        const payload = {
          task: "Process this Paperless document metadata.",
          mode: resume ? "resume_after_human_decision" : "new_metadata_run",
          enabled_metadata_fields: metadataPolicy,
          required_tool_sequence: [
            {
              tool: "search_similar_documents",
              arguments: requiredSearch,
            },
            ...(metadataPolicy.tags
              ? [
                  {
                    tool: "explore_tags",
                    rule: "Use the read-only tag explorer before final tag decisions.",
                  },
                ]
              : []),
            {
              tool: "analyze_catalog_entity_optional",
              rule: "Required before request_human_decision whenever a correspondent, document type, or tag might be missing. Use its existing ID recommendation instead of asking the user.",
            },
            {
              tool: "finish_document_metadata_or_request_human_decision",
              rule: "Use request_human_decision only for one concrete new catalog entity after analyze_catalog_entity returns create; use finish_document_metadata for complete metadata decisions with existing IDs.",
            },
          ],
          invalid_result:
            "Do not answer with prose only. The run is successful only after a final tool call.",
          document: {
            id: doc.id,
            title: doc.title,
            original_file_name: doc.original_file_name,
            archived_file_name: doc.archived_file_name,
            mime_type: doc.mime_type,
            created: doc.created,
            correspondent: doc.correspondent_name ?? doc.correspondent,
            document_type: doc.document_type_name ?? doc.document_type,
            tag_ids: documentTags.tagIds,
            tag_names: documentTags.tagNames,
            workflow_tag_names: documentTags.workflowTagNames,
            content_heading: contentHeading,
            content_excerpt: contentExcerpt,
          },
          language: {
            prompt: promptLanguage,
            generated_tag_names:
              promptLanguage === "de"
                ? "German names, except established brands, vendors, products, or official names."
                : "English names unless the archive/catalog already uses another language.",
          },
          catalog_guidance: {
            current_document_beats_similar_documents: true,
            never_mix_catalog_ids_with_different_names: true,
            prefer_existing_broad_types: true,
            custom_fields:
              "Fill customFieldValues as structured {fieldId, fieldName, value} entries when values are explicitly present. For Echter Korrespondent/real correspondent, prefer Seller/Merchant/Händler/Verkäufer over a payment-platform logo/header.",
            aliases: {
              "Allgemeine Geschäftsbedingungen": "AGB",
              Festsetzungsbescheid: "Gebührenbescheid",
              Rundfunkbeitragsbescheid: "Gebührenbescheid",
              "order confirmation": "Bestellbestätigung",
              marketing_or_discount_letter: "Werbung",
            },
          },
          catalogs,
          already_applied_metadata: memory.appliedMetadata,
          human_decisions: memory.humanDecisions,
          review_feedback: memory.reviewFeedback,
        };

        return [
          `Call search_similar_documents now with ${JSON.stringify(requiredSearch)}.`,
          metadataPolicy.tags
            ? "Then call explore_tags before choosing tag IDs. Treat its output as advice, not as an automatic decision."
            : "",
          "After the search result, call set_custom_field_value for every selected custom field with explicit evidence. Do not pass empty customFieldValues/customFieldsJson when the document contains invoice number, customer number, amount, sender address, line items, seller, merchant, or payee. If a catalog entity may be missing, call analyze_catalog_entity before any user question. Then call request_human_decision only for create recommendations, otherwise call finish_document_metadata.",
          "Human decisions and review feedback in Document data JSON are authoritative user input. Do not repeat a rejected proposal; incorporate the feedback and choose a different action or candidate.",
          "For request_human_decision, provide one concrete missing candidateName, evidence, userQuestion, and action=create. Do not ask vague questions, full-metadata confirmation questions, or catalog merge/map questions.",
          UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
          `Only propose enabled metadata fields: ${JSON.stringify(metadataPolicy)}.`,
          "Do not answer in prose. Tool calls only.",
          "Document data JSON:",
          JSON.stringify(payload),
          "Now call search_similar_documents. Do not write prose.",
        ].join("\n\n");
      };
      const staticPromptText = [
        buildSystemPrompt(promptLanguage, tagLanguageAliasesDe),
        buildPromptForExcerpt(formatUntrustedDocumentText("", 0)),
      ].join("\n");
      const excerptBudget = computeContentExcerptCharBudget({
        contextWindowTokens: DEFAULT_OLLAMA_CONTEXT_WINDOW,
        reservedOutputTokens: DEFAULT_OLLAMA_MAX_TOKENS,
        staticPromptText,
        maxExcerptChars: 12_000,
      });

      return buildPromptForExcerpt(formatUntrustedDocumentText(content, excerptBudget));
    };

    return {
      name: "document_agent" as const,

      processDocument: (input) =>
        Effect.gen(function* () {
          const doc = yield* paperless.getDocument(input.docId);
          const dryRun = input.dryRun === true;
          const metadataPolicy: MetadataPolicy = {
            ...defaultMetadataPolicy,
            ...input.metadataPolicy,
          };
          const content = doc.content ?? "";
          const settings = yield* getRuntimeSettings();
          const caseRecord = dryRun ? null : yield* cases.getOrCreateCaseForDocument(input.docId);
          const legacyMemory = yield* tinybase
            .getDocumentMemory(input.docId)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));
          const freshRun = input.freshRun === true;
          const caseMemory = freshRun ? {} : (caseRecord?.memory ?? {});
          const memory = readPromptSafeDocumentAgentMemory({
            docId: input.docId,
            caseMemory,
            legacyMemory: freshRun ? null : legacyMemory,
            finalDecisions: freshRun
              ? {}
              : (caseRecord?.finalDecisions ?? legacyMemory?.finalDecisions ?? {}),
          });

          const sessionId = memory.sessionId;
          const appliedMetadata = memory.appliedMetadata;
          const modelSeed = computeDeterministicModelSeed(input.docId, settings.model);
          const verifierSeed = computeDeterministicModelSeed(input.docId, settings.model);
          const pausedRef = { current: false };
          const appliedRef = { current: {} as Record<string, unknown> };
          const finalToolRef = { current: null as string | null };
          const piEvents: Array<{
            eventType: "response" | "tool_call" | "tool_result" | "error";
            data: Record<string, unknown>;
          }> = [];

          const [correspondents, documentTypes, tags, customFields] = yield* Effect.all(
            [
              paperless.getCorrespondents().pipe(Effect.catchAll(() => Effect.succeed([]))),
              paperless.getDocumentTypes().pipe(Effect.catchAll(() => Effect.succeed([]))),
              paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
              paperless.getCustomFields().pipe(Effect.catchAll(() => Effect.succeed([]))),
            ],
            { concurrency: "unbounded" },
          );
          const workflowTagNames = getWorkflowTagNames(tagConfig);
          const tagNamesById = new Map(tags.map((tag) => [tag.id, tag.name] as const));
          const documentUserTagIds = (doc.tags ?? []).filter((tagId) => {
            const name = tagNamesById.get(tagId);
            return !name || !isWorkflowTagName(name, workflowTagNames);
          });
          const documentUserTagNames =
            doc.tag_names && doc.tag_names.length > 0
              ? doc.tag_names.filter((name) => !isWorkflowTagName(name, workflowTagNames))
              : documentUserTagIds
                  .map((tagId) => tagNamesById.get(tagId))
                  .filter(
                    (name): name is string => !!name && !isWorkflowTagName(name, workflowTagNames),
                  );
          const documentWorkflowTagNames = (doc.tags ?? [])
            .map((tagId) => tagNamesById.get(tagId))
            .filter((name): name is string => !!name && isWorkflowTagName(name, workflowTagNames));
          const catalogsForPrompt = {
            correspondents: correspondents.map((entry) => ({
              id: entry.id,
              name: entry.name,
              document_count: entry.document_count,
            })),
            document_types: documentTypes.map((entry) => ({
              id: entry.id,
              name: entry.name,
              document_count: entry.document_count,
            })),
            tags: tags
              .filter((entry) => !isWorkflowTagName(entry.name, workflowTagNames))
              .map((entry) => ({
                id: entry.id,
                name: entry.name,
                document_count: entry.document_count,
              })),
            custom_fields: customFields.map((entry) => ({
              id: entry.id,
              name: entry.name,
              data_type: entry.data_type,
            })),
          };

          const modelId = dryRun ? (settings.dryRunModel ?? settings.model) : settings.model;
          const agent = new PiAgent({
            initialState: {
              systemPrompt: buildSystemPrompt(
                settings.promptLanguage,
                settings.tagLanguageAliasesDe,
              ),
              model: buildOllamaModel(settings.ollamaUrl, modelId),
              tools: createTools(
                doc,
                sessionId,
                pausedRef,
                appliedRef,
                finalToolRef,
                dryRun,
                metadataPolicy,
                settings.promptLanguage,
                settings.tagLanguageAliasesDe,
                {
                  content,
                  catalogs: catalogsForPrompt,
                  model: settings.model,
                  verifierSeed,
                  confirmationEnabled: settings.confirmationEnabled,
                  confirmationMaxRetries: settings.confirmationMaxRetries,
                  confirmationMinConfidence: settings.confirmationMinConfidence,
                  resume: input.resume === true,
                  appliedMetadata,
                },
                { humanDecisions: memory.humanDecisions },
              ),
              messages:
                input.resume === true &&
                settings.saveProcessingHistory &&
                Array.isArray(memory.transcript)
                  ? (memory.transcript as AgentMessage[])
                  : [],
            },
            streamFn: makeGatedOllamaStreamSimple(concurrency),
            getApiKey: () => "ollama",
            onPayload: (payload) => buildOllamaPiPayload(payload, { seed: modelSeed }),
            sessionId,
            toolExecution: "sequential",
            beforeToolCall: async ({ toolCall }) => {
              if (!isFinalToolName(toolCall.name)) return undefined;
              if (finalToolRef.current) {
                return {
                  block: true,
                  reason: `Final metadata action already executed: ${finalToolRef.current}`,
                };
              }
              return undefined;
            },
          });
          const recordPiEvent = (entry: DocumentAgentRuntimeEvent) => {
            piEvents.push(entry);
            input.onEvent?.(entry);
          };

          agent.subscribe((event: AgentEvent) => {
            if (event.type === "message_end" && event.message.role === "assistant") {
              const messageRecord = event.message as unknown as Record<string, unknown>;
              const errorMessage = optionalRecordString(messageRecord, "errorMessage");
              recordPiEvent({
                eventType: event.message.stopReason === "error" ? "error" : "response",
                data: {
                  stopReason: event.message.stopReason,
                  contentTypes: event.message.content.map((content) => content.type),
                  ...(errorMessage ? { errorMessage } : {}),
                },
              });
            } else if (event.type === "tool_execution_start") {
              recordPiEvent({
                eventType: "tool_call",
                data: {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  args: event.args,
                },
              });
            } else if (event.type === "tool_execution_end") {
              recordPiEvent({
                eventType: event.isError ? "error" : "tool_result",
                data: {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  isError: event.isError,
                  result: event.result,
                },
              });
            }
          });

          const prompt = buildUserPrompt(
            doc,
            content,
            catalogsForPrompt,
            {
              humanDecisions: memory.humanDecisions,
              reviewFeedback: memory.reviewFeedback,
              appliedMetadata,
            },
            metadataPolicy,
            input.resume === true,
            {
              tagIds: documentUserTagIds,
              tagNames: documentUserTagNames,
              workflowTagNames: documentWorkflowTagNames,
            },
            settings.promptLanguage,
            settings.tagLanguageAliasesDe,
          );

          const runPrompt = (message: string) => {
            const startedAt = Date.now();
            return Effect.tryPromise({
              try: () =>
                runWithPromptActivityWatchdog(
                  async ({ markActivity }) => {
                    const unsubscribe = agent.subscribe((event) => {
                      markActivity(`agent_${event.type}`);
                    });
                    try {
                      await agent.prompt(message);
                    } finally {
                      unsubscribe();
                    }
                  },
                  {
                    label: "Pi document agent",
                    timeoutMs: settings.agentPromptTimeoutMs,
                    abort: () => agent.abort(),
                    checkStillRunning: async () =>
                      agent.state.isStreaming ||
                      (await checkOllamaModelRunning(settings.ollamaUrl, modelId)),
                  },
                ),
              catch: (error) => {
                const messageText =
                  error instanceof Error && error.message ? error.message : String(error);
                return new AgentError({
                  message:
                    error instanceof PromptIdleTimeoutError
                      ? messageText
                      : `Pi document agent failed: ${messageText}`,
                  agent: "document_agent",
                  cause: error,
                });
              },
            }).pipe(
              withInternalSpan("pi_document_agent.prompt", {
                "paperless.document.id": input.docId,
                "pi.session_id.length": sessionId.length,
                "llm.model": modelId,
                "pi.dry_run": dryRun,
              }),
              Effect.tap(() =>
                Effect.sync(() =>
                  metrics.llmRequestDuration.observe(
                    {
                      provider: "pi_ollama",
                      operation: "agent_prompt",
                      model: modelId,
                      outcome: "success",
                    },
                    observeDuration(startedAt),
                  ),
                ),
              ),
              Effect.tapError((error) =>
                Effect.sync(() =>
                  metrics.llmRequestDuration.observe(
                    {
                      provider: "pi_ollama",
                      operation: "agent_prompt",
                      model: modelId,
                      outcome: classifyMetricsErrorOutcome(error),
                    },
                    observeDuration(startedAt),
                  ),
                ),
              ),
            );
          };

          if (caseRecord && !dryRun) {
            yield* cases
              .updateCase(caseRecord.id, {
                memory: {
                  sessionId,
                  model: settings.model,
                  modelSeed,
                  verifierModel: settings.model,
                  verifierSeed,
                  modelTemperature: 0,
                },
              })
              .pipe(Effect.catchAll(() => Effect.void));
            yield* tinybase
              .addProcessingLog({
                docId: input.docId,
                timestamp: new Date().toISOString(),
                step: "document_agent",
                eventType: "context",
                data: {
                  model: modelId,
                  modelSeed,
                  verifierModel: settings.model,
                  verifierSeed,
                  temperature: 0,
                },
              })
              .pipe(Effect.catchAll(() => Effect.void));
          }

          yield* ensureOllamaChatResponsive(settings.ollamaUrl);

          const initialMessageCount = agent.state.messages.length;
          const currentRunMessages = () => agent.state.messages.slice(initialMessageCount);

          const getFailedFinalToolError = (): string | undefined => {
            return getLatestFinalToolError(currentRunMessages());
          };

          yield* runPrompt(prompt);

          const requiredSearch = {
            query: buildDocumentSearchQuery(doc, content),
            limit: 5,
          };
          for (let retry = 0; retry < 2; retry++) {
            const currentMessages = currentRunMessages();
            if (getLatestAssistantError(currentMessages)) break;
            const currentToolCalls = getToolCallNames(currentMessages);
            const hasFinalTool = currentMessages.some(
              (message) =>
                hasToolCall(message, "request_human_decision") ||
                hasToolCall(message, "finish_document_metadata"),
            );
            if (hasFinalTool) break;

            const correction = currentToolCalls.includes("search_similar_documents")
              ? [
                  "Your previous response was invalid because no final tool was called.",
                  "Use the actual function/tool-call interface now.",
                  "Call request_human_decision if a new catalog entity is needed; otherwise call finish_document_metadata.",
                  "Do not write prose.",
                ].join("\n")
              : [
                  "Your previous response was invalid because it was text, not a real tool call.",
                  `Use the actual function/tool-call interface now and call search_similar_documents with ${JSON.stringify(requiredSearch)}.`,
                  "Do not write prose or pseudo-code.",
                ].join("\n");

            yield* Effect.sync(() =>
              metrics.retries.inc({
                component: "document_agent",
                operation: "final_tool_correction",
                reason: "validation",
              }),
            );
            yield* runPrompt(correction);
          }

          for (let retry = 0; retry < Math.max(0, settings.confirmationMaxRetries); retry++) {
            if (getLatestAssistantError(currentRunMessages())) break;
            const finalToolError = getFailedFinalToolError();
            if (!finalToolError || pausedRef.current || finalToolRef.current) break;

            yield* Effect.sync(() =>
              metrics.retries.inc({
                component: "document_agent",
                operation: "final_tool_correction",
                reason: "validation",
              }),
            );
            yield* runPrompt(buildRetryCorrectionFromFinalToolError(finalToolError));
          }

          const finalRunMessages = currentRunMessages();
          const toolCalls = getToolCallNames(finalRunMessages);
          const assistantPreview = getAssistantPreview(finalRunMessages);
          const hasFinalToolCall = finalRunMessages.some(
            (message) =>
              hasToolCall(message, "request_human_decision") ||
              hasToolCall(message, "finish_document_metadata"),
          );
          const finalToolResults = finalRunMessages.filter(isFinalToolResultMessage);
          const finalToolError = getFailedFinalToolError();
          const assistantError = getLatestAssistantError(finalRunMessages);
          const successfulFinishToolResult = finalToolResults.some(
            (message) => message.toolName === "finish_document_metadata" && !message.isError,
          );
          const finalOutcome = classifyFinalMetadataOutcome({
            paused: pausedRef.current,
            hasFinalToolCall,
            hasSuccessfulFinishToolResult: successfulFinishToolResult,
            finalToolError,
            assistantError,
          });
          const runError = finalOutcome.runError;

          if (!dryRun) {
            yield* Effect.all(
              piEvents.map((entry) =>
                annotateSpan({
                  "pi.event_type": entry.eventType,
                  "pi.tool_name":
                    typeof entry.data["toolName"] === "string" ? entry.data["toolName"] : undefined,
                  "paperless.document.id": input.docId,
                }).pipe(
                  withInternalSpan("pi_document_agent.event", {
                    "pi.event_type": entry.eventType,
                    "paperless.document.id": input.docId,
                  }),
                  Effect.zipRight(
                    tinybase
                      .addProcessingLog({
                        docId: input.docId,
                        timestamp: new Date().toISOString(),
                        step: "document_agent",
                        eventType: entry.eventType,
                        data: entry.data,
                      })
                      .pipe(Effect.catchAll(() => Effect.void)),
                  ),
                ),
              ),
              { concurrency: "unbounded" },
            );

            const savedAgentMessages = settings.saveProcessingHistory ? agent.state.messages : [];
            const finalAppliedMetadata = mergeAppliedMetadataAudit(
              appliedMetadata,
              appliedRef.current,
              new Date().toISOString(),
              sessionId,
            );
            const runSummary = {
              id: `document-${Date.now()}`,
              agent: "document_agent",
              status: pausedRef.current ? "paused" : runError ? "failed" : "completed",
              summary: pausedRef.current
                ? "Paused for human metadata decision."
                : runError
                  ? runError
                  : `Applied metadata keys: ${Object.keys(appliedRef.current).join(", ") || "none"}.`,
              createdAt: new Date().toISOString(),
            };

            if (caseRecord) {
              yield* cases
                .updateCase(caseRecord.id, {
                  finalDecisions: appliedRef.current,
                  memory: {
                    sessionId,
                    model: settings.model,
                    modelSeed,
                    verifierModel: settings.model,
                    verifierSeed,
                    modelTemperature: 0,
                    agentMessages: savedAgentMessages,
                    finalDecisions: appliedRef.current,
                    appliedMetadata: finalAppliedMetadata,
                    humanDecisions: memory.humanDecisions,
                    reviewFeedback: memory.reviewFeedback,
                  },
                })
                .pipe(Effect.catchAll(() => Effect.void));
              yield* cases
                .appendRunSummary(caseRecord.id, runSummary)
                .pipe(Effect.catchAll(() => Effect.void));
              yield* cases
                .appendTranscript(caseRecord.id, {
                  role: "agent",
                  content: runSummary.summary,
                  metadata: {
                    agent: "document_agent",
                    status: runSummary.status,
                    toolCalls,
                    appliedKeys: Object.keys(appliedRef.current),
                  },
                })
                .pipe(Effect.catchAll(() => Effect.void));
            }

            yield* tinybase
              .patchDocumentMemory(input.docId, {
                sessionId,
                transcript: savedAgentMessages,
                finalDecisions: appliedRef.current,
              })
              .pipe(Effect.catchAll(() => Effect.void));

            yield* tinybase
              .appendRunSummary(input.docId, runSummary)
              .pipe(Effect.catchAll(() => Effect.void));
          }

          return {
            success: finalOutcome.success,
            docId: input.docId,
            sessionId,
            needsReview: pausedRef.current,
            paused: pausedRef.current,
            applied: appliedRef.current,
            dryRun,
            toolCalls,
            agentMessageCount: agent.state.messages.length,
            assistantPreview,
            error: runError,
          };
        }).pipe(
          withInternalSpan("pi_document_agent.process_document", {
            "paperless.document.id": input.docId,
            "pi.dry_run": input.dryRun === true,
            "pi.resume": input.resume === true,
          }),
          Effect.mapError((error) =>
            error instanceof AgentError
              ? error
              : new AgentError({
                  message: `Document agent processing failed: ${String(error)}`,
                  agent: "document_agent",
                  cause: error,
                }),
          ),
        ),
    };
  }),
);
