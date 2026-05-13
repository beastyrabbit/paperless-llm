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
import { type Model, streamSimple } from "@earendil-works/pi-ai";
import { Context, Effect, Layer, Option, pipe } from "effect";
import { Type } from "typebox";
import { AgentError } from "../errors/index.js";
import type { CustomField, CustomFieldValue, Document } from "../models/index.js";
import { ConfigService, PaperlessService, TinyBaseService } from "../services/index.js";

export interface DocumentAgentInput {
  docId: number;
  auto?: boolean;
  resume?: boolean;
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

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown;
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
    if (Object.prototype.hasOwnProperty.call(record, key)) {
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
  const parsed = JSON.parse(value) as unknown;
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

const getWorkflowTagNames = (tagConfig: Record<string, string | undefined>): Set<string> =>
  new Set(Object.values(tagConfig).filter((name): name is string => typeof name === "string"));

const isWorkflowTagName = (name: string, workflowTagNames: Set<string>): boolean => {
  const normalized = normalizeName(name);
  return normalized.startsWith("llm-") || workflowTagNames.has(normalized);
};

const parseCatalogFieldAssignmentsJson = (
  value: string,
  fields: CustomField[],
  options: {
    fieldKeys?: string[];
    valueKeys?: string[];
  } = {},
): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown;
  const fieldNameIds = new Map(
    fields.map((field) => [normalizeName(field.name).toLowerCase(), field.id] as const),
  );
  const resolveFieldId = (field: unknown): number | null => {
    const fieldId = parseFieldId(field);
    if (fieldId !== null) return fieldId;
    if (typeof field !== "string") return null;
    return fieldNameIds.get(normalizeName(field).toLowerCase()) ?? null;
  };

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const assignments: Record<string, unknown> = {};
    for (const [key, assignment] of Object.entries(parsed as Record<string, unknown>)) {
      const fieldId = resolveFieldId(key);
      if (fieldId !== null) {
        assignments[String(fieldId)] = assignment;
      }
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

const getDocumentTitle = (doc: Document): string => doc.title || `Document ${doc.id}`;

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

const getToolResultText = (message: AgentMessage): string =>
  message.role === "toolResult"
    ? message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n")
    : "";

const isFinalToolName = (name: string): boolean =>
  name === "request_human_decision" || name === "finish_document_metadata";

const isFinalToolResultMessage = (
  message: AgentMessage,
): message is AgentMessage & { role: "toolResult"; toolName: string; isError: boolean } =>
  message.role === "toolResult" && isFinalToolName(message.toolName);

const isPolicyEnabledForDecision = (kind: EntityKind, policy: MetadataPolicy): boolean => {
  if (kind === "correspondent") return policy.correspondent;
  if (kind === "document_type") return policy.documentType;
  return policy.tags;
};

const normalizeHumanDecisionArguments = (args: unknown) => {
  const record =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const rawAction = String(record["action"] ?? "").toLowerCase();
  const rawKind = String(record["entityKind"] ?? record["entity_kind"] ?? "").toLowerCase();
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
  const suggestion = normalizeName(
    String(record["suggestion"] ?? record["name"] ?? record["value"] ?? ""),
  );
  const alternatives = Array.isArray(record["alternatives"])
    ? record["alternatives"].map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const alternative = entry as Record<string, unknown>;
          return String(alternative["name"] ?? alternative["id"] ?? JSON.stringify(alternative));
        }
        return String(entry);
      })
    : undefined;

  return {
    entityKind,
    question: String(record["question"] ?? `${action} ${entityKind} "${suggestion}"?`),
    suggestion,
    alternatives,
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
  };
};

const sensitiveMetadataKeywordPattern =
  /freischaltcode|pin|tan|passwort|kennwort|aktivierungscode|activation code|login code|security code/i;

const sensitiveValuePattern = /\b[A-Z0-9]{6,}\b/g;

const redactSensitiveMetadataText = (value: string): string => {
  if (!sensitiveMetadataKeywordPattern.test(value)) return value;
  return value.replace(sensitiveValuePattern, "[redacted]");
};

const normalizePublicTitle = (value: string): string =>
  redactSensitiveMetadataText(normalizeName(value))
    .replace(/\s*[:–-]\s*\[redacted\]\s*$/i, "")
    .replace(/\s*\(\s*\[redacted\]\s*\)\s*$/i, "")
    .trim();

const buildOllamaModel = (url: string, modelId: string): Model<"openai-completions"> => ({
  id: modelId,
  name: modelId,
  provider: "ollama",
  api: "openai-completions",
  baseUrl: `${url.replace(/\/$/, "")}/v1`,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: "max_tokens",
  },
});

export const PiDocumentAgentServiceLive = Layer.effect(
  PiDocumentAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const getRuntimeSettings = () =>
      pipe(
        tinybase.getAllSettings(),
        Effect.map((settings) => {
          const saveHistorySetting =
            settings["debug.save_processing_history"] ?? settings["debug.saveProcessingHistory"];
          return {
            ollamaUrl: settings["ollama.url"] ?? config.config.ollama.url,
            model:
              settings["ollama.model_large"] ??
              settings["ollama.modelLarge"] ??
              config.config.ollama.modelLarge,
            modelSmall:
              settings["ollama.model_small"] ??
              settings["ollama.modelSmall"] ??
              config.config.ollama.modelSmall,
            dryRunModel: process.env["PI_DRY_RUN_MODEL"],
            saveProcessingHistory:
              saveHistorySetting === undefined
                ? true
                : saveHistorySetting === "true" || saveHistorySetting === "1",
          };
        }),
        Effect.catchAll(() =>
          Effect.succeed({
            ollamaUrl: config.config.ollama.url,
            model: config.config.ollama.modelLarge,
            modelSmall: config.config.ollama.modelSmall,
            dryRunModel: process.env["PI_DRY_RUN_MODEL"],
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

        const pendingId = yield* tinybase.addPendingReview({
          docId: doc.id,
          docTitle: getDocumentTitle(doc),
          type: "human_decision",
          suggestion,
          reasoning: question,
          alternatives,
          attempts: 1,
          lastFeedback: null,
          nextTag: tagConfig.metadata,
          metadata: JSON.stringify({
            kind: "pi_human_decision",
            sessionId,
            entityKind: kind,
            question,
            ...metadata,
          }),
        });

        yield* paperless
          .transitionDocumentTag(doc.id, tagConfig.metadata, tagConfig.review)
          .pipe(Effect.catchAll(() => paperless.addTagToDocument(doc.id, tagConfig.review)));

        yield* tinybase
          .appendRunSummary(doc.id, {
            id: `review-${Date.now()}`,
            agent: "review_agent",
            status: "paused",
            summary: question,
            createdAt: new Date().toISOString(),
          })
          .pipe(Effect.catchAll(() => Effect.void));

        return pendingId;
      });

    const createTools = (
      doc: Document,
      sessionId: string,
      pausedRef: { current: boolean },
      appliedRef: { current: Record<string, unknown> },
      dryRun: boolean,
      metadataPolicy: MetadataPolicy,
    ): AgentTool[] => {
      const workflowTagNames = getWorkflowTagNames(tagConfig);
      const getAssignableTagIds = (tagIds: number[]): Effect.Effect<number[], never> =>
        paperless.getTags().pipe(
          Effect.map((tags) => {
            const tagNamesById = new Map(tags.map((tag) => [tag.id, tag.name] as const));
            return tagIds.filter((tagId) => {
              const name = tagNamesById.get(tagId);
              return !!name && !isWorkflowTagName(name, workflowTagNames);
            });
          }),
          Effect.catchAll(() => Effect.succeed([])),
        );

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
              : paperless.getTags().pipe(Effect.map((items) => items.map((item) => item.name)));

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

      const requestHumanDecisionParams = Type.Object({
        entityKind: Type.Union([
          Type.Literal("correspondent"),
          Type.Literal("document_type"),
          Type.Literal("tag"),
        ]),
        question: Type.String(),
        suggestion: Type.String(),
        alternatives: Type.Optional(Type.Array(Type.String())),
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
        linkedDocumentsJson: Type.Optional(Type.String()),
        extractedFactsJson: Type.Optional(Type.String()),
        reasoning: Type.Optional(Type.String()),
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
        execute: async (_toolCallId, params) => {
          const documents = await Effect.runPromise(
            paperless.getSimilarDocuments(doc.id, params.limit ?? 10).pipe(
              Effect.map((docs) =>
                docs.map((candidate) => summarizeDocumentForAgent(candidate, 500)),
              ),
              Effect.catchAll(() => Effect.succeed([])),
            ),
          );
          return textResult(JSON.stringify({ documents }), { documents });
        },
      };

      const getDocumentTool: AgentTool<typeof getDocumentParams, { document: unknown | null }> = {
        name: "get_document",
        label: "Get document",
        description: "Retrieve a Paperless document by ID.",
        parameters: getDocumentParams,
        execute: async (_toolCallId, params) => {
          if (params.docId !== doc.id) {
            const payload = {
              document: null,
              error: "The document agent may only retrieve the current document by ID.",
            };
            return textResult(JSON.stringify(payload), payload);
          }

          const found = await Effect.runPromise(
            paperless.getDocument(params.docId).pipe(
              Effect.map((candidate) => summarizeDocumentForAgent(candidate, 1_500)),
              Effect.catchAll(() => Effect.succeed(null)),
            ),
          );
          return textResult(JSON.stringify({ document: found }), { document: found });
        },
      };

      const requestHumanDecision: AgentTool<
        typeof requestHumanDecisionParams,
        { pendingId: string | null; paused: boolean }
      > = {
        name: "request_human_decision",
        label: "Request human decision",
        description:
          "Pause this Pi run and ask the user to create, map, edit, skip, or reject a metadata suggestion.",
        parameters: requestHumanDecisionParams,
        executionMode: "sequential",
        prepareArguments: normalizeHumanDecisionArguments,
        execute: async (_toolCallId, params) => {
          if (!isPolicyEnabledForDecision(params.entityKind, metadataPolicy)) {
            throw new Error(
              `Human decisions for ${params.entityKind} are disabled by metadata settings.`,
            );
          }

          const suggestion = normalizeName(params.suggestion);
          if (!suggestion) {
            throw new Error("Human decision suggestion must not be empty.");
          }
          const pendingId = await Effect.runPromise(
            Effect.gen(function* () {
              const alternatives = params.alternatives?.length
                ? params.alternatives
                : yield* getEntityAlternatives(params.entityKind);
              return yield* queueHumanDecision(
                doc,
                sessionId,
                params.entityKind,
                params.question,
                suggestion,
                alternatives,
                { requestedAction: params.action },
                dryRun,
              );
            }),
          );
          pausedRef.current = true;
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
        execute: async (_toolCallId, params) => {
          const result = await Effect.runPromise(
            Effect.gen(function* () {
              const updates: Record<string, unknown> = {};
              const applied: Record<string, unknown> = {};
              const currentDoc = yield* paperless.getDocument(doc.id);

              if (metadataPolicy.title && params.title?.trim()) {
                const title = normalizePublicTitle(params.title);
                if (title) {
                  updates["title"] = title;
                  applied["title"] = title;
                }
              }

              if (metadataPolicy.correspondent && params.correspondentId !== undefined) {
                if (
                  currentDoc.correspondent &&
                  currentDoc.correspondent !== params.correspondentId
                ) {
                  const pendingId = yield* queueHumanDecision(
                    doc,
                    sessionId,
                    "correspondent",
                    `Change correspondent from "${currentDoc.correspondent_name ?? currentDoc.correspondent}" to "${params.correspondentId}"?`,
                    String(params.correspondentId),
                    [String(currentDoc.correspondent)],
                    {
                      requestedAction: "map",
                      currentId: currentDoc.correspondent,
                      proposedId: params.correspondentId,
                    },
                    dryRun,
                  );
                  pausedRef.current = true;
                  return { applied, pendingId, paused: true };
                }
                updates["correspondent"] = params.correspondentId;
                applied["correspondent"] = params.correspondentId;
              } else if (metadataPolicy.correspondent && params.correspondentName?.trim()) {
                const name = normalizeName(params.correspondentName);
                const existing = yield* paperless
                  .getCorrespondentByName(name)
                  .pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
                if (Option.isSome(existing)) {
                  if (currentDoc.correspondent && currentDoc.correspondent !== existing.value.id) {
                    const pendingId = yield* queueHumanDecision(
                      doc,
                      sessionId,
                      "correspondent",
                      `Change correspondent from "${currentDoc.correspondent_name ?? currentDoc.correspondent}" to "${existing.value.name}"?`,
                      existing.value.name,
                      [currentDoc.correspondent_name ?? String(currentDoc.correspondent)],
                      {
                        requestedAction: "map",
                        currentId: currentDoc.correspondent,
                        proposedId: existing.value.id,
                      },
                      dryRun,
                    );
                    pausedRef.current = true;
                    return { applied, pendingId, paused: true };
                  }
                  updates["correspondent"] = existing.value.id;
                  applied["correspondent"] = existing.value.id;
                } else {
                  const pendingId = yield* queueHumanDecision(
                    doc,
                    sessionId,
                    "correspondent",
                    `Create or map correspondent "${name}"?`,
                    name,
                    [],
                    { requestedAction: "create" },
                    dryRun,
                  );
                  pausedRef.current = true;
                  return { applied, pendingId, paused: true };
                }
              }

              if (metadataPolicy.documentType && params.documentTypeId !== undefined) {
                if (
                  currentDoc.document_type &&
                  currentDoc.document_type !== params.documentTypeId
                ) {
                  const pendingId = yield* queueHumanDecision(
                    doc,
                    sessionId,
                    "document_type",
                    `Change document type from "${currentDoc.document_type_name ?? currentDoc.document_type}" to "${params.documentTypeId}"?`,
                    String(params.documentTypeId),
                    [String(currentDoc.document_type)],
                    {
                      requestedAction: "map",
                      currentId: currentDoc.document_type,
                      proposedId: params.documentTypeId,
                    },
                    dryRun,
                  );
                  pausedRef.current = true;
                  return { applied, pendingId, paused: true };
                }
                updates["document_type"] = params.documentTypeId;
                applied["document_type"] = params.documentTypeId;
              } else if (metadataPolicy.documentType && params.documentTypeName?.trim()) {
                const name = normalizeName(params.documentTypeName);
                const existing = yield* paperless
                  .getDocumentTypeByName(name)
                  .pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
                if (Option.isSome(existing)) {
                  if (currentDoc.document_type && currentDoc.document_type !== existing.value.id) {
                    const pendingId = yield* queueHumanDecision(
                      doc,
                      sessionId,
                      "document_type",
                      `Change document type from "${currentDoc.document_type_name ?? currentDoc.document_type}" to "${existing.value.name}"?`,
                      existing.value.name,
                      [currentDoc.document_type_name ?? String(currentDoc.document_type)],
                      {
                        requestedAction: "map",
                        currentId: currentDoc.document_type,
                        proposedId: existing.value.id,
                      },
                      dryRun,
                    );
                    pausedRef.current = true;
                    return { applied, pendingId, paused: true };
                  }
                  updates["document_type"] = existing.value.id;
                  applied["document_type"] = existing.value.id;
                } else {
                  const pendingId = yield* queueHumanDecision(
                    doc,
                    sessionId,
                    "document_type",
                    `Create or map document type "${name}"?`,
                    name,
                    [],
                    { requestedAction: "create" },
                    dryRun,
                  );
                  pausedRef.current = true;
                  return { applied, pendingId, paused: true };
                }
              }

              const currentTagIds = currentDoc.tags ?? [];
              let tagIds = [...currentTagIds];

              if (metadataPolicy.tags) {
                if (params.tagIdsToRemove?.length) {
                  const tagIdsToRemove = yield* getAssignableTagIds(params.tagIdsToRemove);
                  const remove = new Set(tagIdsToRemove);
                  tagIds = tagIds.filter((id) => !remove.has(id));
                  if (remove.size > 0) {
                    applied["removed_tag_ids"] = [...remove];
                  }
                }

                if (params.tagIdsToAdd?.length) {
                  const tagIdsToAdd = yield* getAssignableTagIds(params.tagIdsToAdd);
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
                    if (!name || isWorkflowTagName(name, workflowTagNames)) continue;
                    const existing = yield* paperless
                      .getTagByName(name)
                      .pipe(Effect.catchAll(() => Effect.succeed(Option.none())));
                    if (Option.isSome(existing)) {
                      if (!tagIds.includes(existing.value.id)) {
                        tagIds.push(existing.value.id);
                      }
                      addedNames.push(name);
                    } else {
                      const alternatives = yield* paperless.getTags().pipe(
                        Effect.map((tags) => tags.slice(0, 20).map((tag) => tag.name)),
                        Effect.catchAll(() => Effect.succeed([])),
                      );
                      const pendingId = yield* queueHumanDecision(
                        doc,
                        sessionId,
                        "tag",
                        `Create or map tag "${name}"?`,
                        name,
                        alternatives,
                        { requestedAction: "create" },
                        dryRun,
                      );
                      pausedRef.current = true;
                      return { applied, pendingId, paused: true };
                    }
                  }
                  applied["added_tag_names"] = addedNames;
                }

                if (
                  tagIds.length !== currentTagIds.length ||
                  tagIds.some((tagId) => !currentTagIds.includes(tagId))
                ) {
                  updates["tags"] = tagIds;
                }
              }

              const customFields = [...((currentDoc.custom_fields ?? []) as CustomFieldValue[])];
              const catalogCustomFields = yield* paperless
                .getCustomFields()
                .pipe(Effect.catchAll(() => Effect.succeed([])));
              const upsertCustomField = (fieldId: number, value: unknown) => {
                const index = customFields.findIndex((field) => field.field === fieldId);
                if (index >= 0) {
                  customFields[index] = { field: fieldId, value };
                } else {
                  customFields.push({ field: fieldId, value });
                }
              };

              if (metadataPolicy.customFields && params.customFieldsJson?.trim()) {
                const parsed = parseCatalogFieldAssignmentsJson(
                  params.customFieldsJson,
                  catalogCustomFields,
                );
                for (const [fieldId, value] of Object.entries(parsed)) {
                  const parsedFieldId = Number(fieldId);
                  if (Number.isFinite(parsedFieldId)) {
                    upsertCustomField(parsedFieldId, value);
                  }
                }
                applied["custom_fields"] = parsed;
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

              if (!dryRun && Object.keys(updates).length > 0) {
                yield* paperless.updateDocument(doc.id, updates);
              }

              const summary = params.summary?.trim()
                ? redactSensitiveMetadataText(normalizeName(params.summary))
                : "";

              if (metadataPolicy.summary && summary) {
                if (!dryRun) {
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
                yield* tinybase
                  .patchDocumentMemory(doc.id, {
                    extractedFacts,
                    finalDecisions: applied,
                  })
                  .pipe(Effect.catchAll(() => Effect.void));
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
          );

          if ("error" in result) {
            throw new Error(result.error);
          }

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
        requestHumanDecision,
        finishDocumentMetadata,
      ];
    };

    const buildSystemPrompt = (): string =>
      [
        "You are document_agent for a Paperless-ngx archive.",
        "Classify and enrich one document using only the provided tools.",
        "A text-only answer is invalid.",
        "First call search_similar_documents for the current document.",
        "Then call exactly one of request_human_decision or finish_document_metadata.",
        "Never stop until one of those final tools has been called.",
        "Use existing Paperless catalog entities whenever possible.",
        "When a new tag, correspondent, or document type may be needed, call request_human_decision instead of creating it.",
        "Prefer broad stable tags from the catalog over narrow one-document labels.",
        "When multiple existing tags are plausible, prefer the semantically correct established tag with the higher document count.",
        "Do not request new tags for activation codes, PINs, TANs, passwords, one-time codes, or secret values.",
        "Document types must be broad reusable classes, not provider-specific or product-specific labels.",
        "For letters containing activation or access codes, use the closest existing broad letter/code document type instead of proposing a new product-specific type.",
        "Call finish_document_metadata exactly once when your final decisions are ready.",
        "Return concise decisions; do not invent IDs.",
        "Never add or remove workflow tags such as llm-*; the pipeline owns those.",
        "Do not put secret activation codes, PINs, TANs, passwords, or one-time codes in titles or summaries; store them only in extracted facts if needed.",
        "Treat the current document content, original filename, and MIME type as authoritative.",
        "Existing titles and similar documents may be stale; if they conflict with the current file content, prefer the current file content.",
      ].join("\n");

    const buildUserPrompt = (
      doc: Document,
      content: string,
      catalogs: Record<string, unknown>,
      memory: { humanDecisions: unknown[]; reviewFeedback: unknown[] },
      metadataPolicy: MetadataPolicy,
      resume: boolean,
      documentTags: {
        tagIds: number[];
        tagNames: string[];
        workflowTagNames: string[];
      },
    ): string => {
      const contentHeading = getContentHeading(content);
      const requiredSearch = {
        query: buildDocumentSearchQuery(doc, content),
        limit: 5,
      };
      const payload = {
        task: "Process this Paperless document metadata.",
        mode: resume ? "resume_after_human_decision" : "new_metadata_run",
        enabled_metadata_fields: metadataPolicy,
        required_tool_sequence: [
          {
            tool: "search_similar_documents",
            arguments: requiredSearch,
          },
          {
            tool: "finish_document_metadata_or_request_human_decision",
            rule: "Use request_human_decision for new catalog entities; otherwise finish_document_metadata with existing IDs.",
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
          content_excerpt: content.slice(0, 12_000),
        },
        catalogs,
        human_decisions: memory.humanDecisions,
        review_feedback: memory.reviewFeedback,
      };

      return [
        `Call search_similar_documents now with ${JSON.stringify(requiredSearch)}.`,
        "After the search result, call request_human_decision if a new catalog entity is needed, otherwise call finish_document_metadata.",
        `Only propose enabled metadata fields: ${JSON.stringify(metadataPolicy)}.`,
        "Do not answer in prose. Tool calls only.",
        "Document data JSON:",
        JSON.stringify(payload),
        "Now call search_similar_documents. Do not write prose.",
      ].join("\n\n");
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
          const memory = (yield* tinybase.getDocumentMemory(input.docId)) ?? {
            sessionId: `doc-${input.docId}-${Date.now()}`,
            humanDecisions: [],
            reviewFeedback: [],
            transcript: [],
          };

          const sessionId = memory.sessionId;
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
          const documentUserTagNames = (doc.tag_names ?? []).filter(
            (name) => !isWorkflowTagName(name, workflowTagNames),
          );
          const documentWorkflowTagNames = (doc.tags ?? [])
            .map((tagId) => tagNamesById.get(tagId))
            .filter((name): name is string => !!name && isWorkflowTagName(name, workflowTagNames));

          const agent = new PiAgent({
            initialState: {
              systemPrompt: buildSystemPrompt(),
              model: buildOllamaModel(
                settings.ollamaUrl,
                dryRun ? (settings.dryRunModel ?? settings.modelSmall) : settings.model,
              ),
              tools: createTools(doc, sessionId, pausedRef, appliedRef, dryRun, metadataPolicy),
              messages:
                input.resume === true &&
                settings.saveProcessingHistory &&
                Array.isArray(memory.transcript)
                  ? (memory.transcript as AgentMessage[])
                  : [],
            },
            streamFn: streamSimple,
            getApiKey: () => "ollama",
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
              finalToolRef.current = toolCall.name;
              return undefined;
            },
          });
          const recordPiEvent = (entry: DocumentAgentRuntimeEvent) => {
            piEvents.push(entry);
            input.onEvent?.(entry);
          };

          agent.subscribe((event: AgentEvent) => {
            if (event.type === "message_end" && event.message.role === "assistant") {
              recordPiEvent({
                eventType: event.message.stopReason === "error" ? "error" : "response",
                data: {
                  stopReason: event.message.stopReason,
                  contentTypes: event.message.content.map((content) => content.type),
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
            {
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
            },
            {
              humanDecisions: memory.humanDecisions ?? [],
              reviewFeedback: memory.reviewFeedback ?? [],
            },
            metadataPolicy,
            input.resume === true,
            {
              tagIds: documentUserTagIds,
              tagNames: documentUserTagNames,
              workflowTagNames: documentWorkflowTagNames,
            },
          );

          const runPrompt = (message: string) =>
            Effect.tryPromise({
              try: () => agent.prompt(message),
              catch: (error) =>
                new AgentError({
                  message: `Pi document agent failed: ${String(error)}`,
                  agent: "document_agent",
                  cause: error,
                }),
            });

          yield* runPrompt(prompt);

          const requiredSearch = {
            query: buildDocumentSearchQuery(doc, content),
            limit: 5,
          };
          for (let retry = 0; retry < 2; retry++) {
            const currentToolCalls = getToolCallNames(agent.state.messages);
            const hasFinalTool = agent.state.messages.some(
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

            yield* runPrompt(correction);
          }

          const toolCalls = getToolCallNames(agent.state.messages);
          const assistantPreview = getAssistantPreview(agent.state.messages);
          const hasFinalToolCall = agent.state.messages.some(
            (message) =>
              hasToolCall(message, "request_human_decision") ||
              hasToolCall(message, "finish_document_metadata"),
          );
          const finalToolResults = agent.state.messages.filter(isFinalToolResultMessage);
          const successfulFinalToolResult = finalToolResults.find((message) => !message.isError);
          const failedFinalToolResult = finalToolResults.find(
            (message) =>
              message.isError &&
              !getToolResultText(message).includes("Final metadata action already executed"),
          );
          const finalToolError = failedFinalToolResult
            ? getToolResultText(failedFinalToolResult).slice(0, 1_000) ||
              "Final metadata tool failed."
            : undefined;
          const noFinalToolError = hasFinalToolCall
            ? undefined
            : "Document agent stopped without calling request_human_decision or finish_document_metadata.";
          const runError = finalToolError ?? noFinalToolError;

          if (!dryRun) {
            yield* Effect.all(
              piEvents.map((entry) =>
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
              { concurrency: "unbounded" },
            );

            yield* tinybase
              .patchDocumentMemory(input.docId, {
                sessionId,
                transcript: settings.saveProcessingHistory ? agent.state.messages : [],
                finalDecisions: appliedRef.current,
              })
              .pipe(Effect.catchAll(() => Effect.void));

            yield* tinybase
              .appendRunSummary(input.docId, {
                id: `document-${Date.now()}`,
                agent: "document_agent",
                status: pausedRef.current ? "paused" : runError ? "failed" : "completed",
                summary: pausedRef.current
                  ? "Paused for human metadata decision."
                  : runError
                    ? runError
                    : `Applied metadata keys: ${Object.keys(appliedRef.current).join(", ") || "none"}.`,
                createdAt: new Date().toISOString(),
              })
              .pipe(Effect.catchAll(() => Effect.void));
          }

          return {
            success: !pausedRef.current && !!successfulFinalToolResult && !finalToolError,
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
