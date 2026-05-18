/**
 * Read-only Pi tag explorer.
 *
 * This micro-agent narrows noisy tag catalog exploration without mutating
 * Paperless or asking the user directly. The document agent remains the final
 * coordinator and decides whether to apply existing tag IDs or request review.
 */
import { type AgentMessage, type AgentTool, Agent as PiAgent } from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer, pipe } from "effect";
import { Type } from "typebox";
import { ConfigService } from "../config/index.js";
import { AgentError } from "../errors/index.js";
import { ConcurrencyLimitService } from "../services/ConcurrencyLimitService.js";
import { TinyBaseService } from "../services/TinyBaseService.js";
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
import {
  buildOllamaModel,
  checkOllamaModelRunning,
  makeGatedOllamaStreamSimple,
  PromptIdleTimeoutError,
  runWithPromptActivityWatchdog,
  DEFAULT_OLLAMA_CONTEXT_WINDOW,
  DEFAULT_OLLAMA_MAX_TOKENS,
} from "./piOllamaModel.js";

export interface TagExplorerCatalogTag {
  id: number;
  name: string;
  document_count?: number;
}

export interface TagExplorerSimilarDocument {
  id: number;
  title: string;
  tag_ids?: number[];
  tag_names?: string[];
}

export interface TagExplorerInput {
  docId: number;
  title: string;
  content: string;
  originalFileName?: string | null;
  archivedFileName?: string | null;
  mimeType?: string;
  currentTagIds: number[];
  currentTagNames: string[];
  catalogTags: TagExplorerCatalogTag[];
  similarDocuments: TagExplorerSimilarDocument[];
  promptLanguage?: string;
  tagLanguageAliasesDe?: readonly TagLanguageAliasRow[];
}

export interface TagExplorerNewTagProposal {
  name: string;
  evidence: string;
  reasoning: string;
}

export interface TagExplorerRejectedIdea {
  name: string;
  reason: string;
}

export interface TagExplorerResult {
  tagIdsToAdd: number[];
  tagIdsToRemove: number[];
  rejectedTagIdeas: TagExplorerRejectedIdea[];
  newTagProposal: TagExplorerNewTagProposal | null;
  reasoning: string;
}

export interface PiTagExplorerAgentService {
  readonly name: "tag_explorer_agent";
  readonly exploreTags: (input: TagExplorerInput) => Effect.Effect<TagExplorerResult, AgentError>;
}

export const PiTagExplorerAgentService = Context.GenericTag<PiTagExplorerAgentService>(
  "PiTagExplorerAgentService",
);

const normalizeName = (name: string): string => name.trim().replace(/\s+/g, " ");

const normalizeKey = (value: string): string =>
  normalizeName(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " und ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const uniqueNumbers = (values: unknown): number[] => {
  const array = Array.isArray(values) ? values : [];
  return [
    ...new Set(
      array
        .map((value) => (typeof value === "number" ? value : Number(value)))
        .filter((value) => Number.isFinite(value)),
    ),
  ];
};

const textResult = <T>(text: string, details: T, terminate = false) => ({
  content: [{ type: "text" as const, text }],
  details,
  terminate,
});

const hasFinishToolResult = (
  message: AgentMessage,
): message is AgentMessage & { role: "toolResult"; toolName: string; isError: boolean } =>
  message.role === "toolResult" && message.toolName === "finish_tag_exploration";

const getToolResultText = (message: AgentMessage): string =>
  message.role === "toolResult"
    ? message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n")
    : "";

export const buildTagExplorerFewShotExamples = (): string =>
  [
    "Few-shot examples (synthetic IDs are valid only inside examples):",
    JSON.stringify({
      case: "existing broad tag",
      catalog_tags: [{ id: 12, name: "Versicherung" }],
      final_tool: "finish_tag_exploration",
      arguments: {
        tagIdsToAdd: [12],
        tagIdsToRemove: [],
        rejectedTagIdeas: [],
        newTagProposal: null,
        reasoning: "Insurance letter matches the existing broad tag.",
      },
    }),
    JSON.stringify({
      case: "reject secret or narrow tag",
      final_tool: "finish_tag_exploration",
      arguments: {
        tagIdsToAdd: [],
        tagIdsToRemove: [],
        rejectedTagIdeas: [
          { name: "Activation code", reason: "Secret-bearing one-document label." },
        ],
        newTagProposal: null,
        reasoning: "Do not create tags from codes, PINs, TANs, or passwords.",
      },
    }),
    JSON.stringify({
      case: "no fitting broad tag",
      final_tool: "finish_tag_exploration",
      arguments: {
        tagIdsToAdd: [],
        tagIdsToRemove: [],
        rejectedTagIdeas: [],
        newTagProposal: null,
        reasoning: "Evidence is weak; do not invent a narrow label.",
      },
    }),
  ].join("\n");

export const buildTagExplorerPromptWithExcerpt = (
  input: TagExplorerInput,
  promptLanguage: string,
  contentExcerpt: string,
): string =>
  [
    "You are tag_explorer_agent for a Paperless-ngx archive.",
    buildPromptLanguageInstruction(
      input.promptLanguage ?? promptLanguage,
      input.tagLanguageAliasesDe ?? parseTagLanguageAliasRows(undefined),
    ),
    "Your job is only to explore tag choices for one document.",
    "You must call finish_tag_exploration exactly once.",
    "Prefer existing broad stable catalog tags by ID.",
    "Do not invent narrow one-document labels.",
    "Do not propose tags containing activation codes, PINs, TANs, passwords, one-time codes, or secret values.",
    UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
    "If no broad existing tag fits, return no tag additions.",
    "If a new tag is truly needed, return exactly one concrete newTagProposal with evidence.",
    "Never ask the user directly.",
    buildTagExplorerFewShotExamples(),
    "Input JSON:",
    JSON.stringify({
      document: {
        id: input.docId,
        title: input.title,
        original_file_name: input.originalFileName,
        archived_file_name: input.archivedFileName,
        mime_type: input.mimeType,
        current_tag_ids: input.currentTagIds,
        current_tag_names: input.currentTagNames,
        content_excerpt: contentExcerpt,
      },
      catalog_tags: input.catalogTags,
      similar_documents: input.similarDocuments,
    }),
  ].join("\n\n");

export const PiTagExplorerAgentServiceLive = Layer.effect(
  PiTagExplorerAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const tinybase = yield* TinyBaseService;
    const concurrency = yield* ConcurrencyLimitService;

    const getRuntimeSettings = () =>
      pipe(
        tinybase.getAllSettings(),
        Effect.map((settings) => ({
          ollamaUrl: settings["ollama.url"] ?? config.config.ollama.url,
          model: settings["ollama.model"] ?? settings["ollama_model"] ?? config.config.ollama.model,
          agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
          promptLanguage: normalizePromptLanguage(
            settings["language.prompt"] ??
              settings["prompt_language"] ??
              settings["language"] ??
              config.config.language,
          ),
          tagLanguageAliasesDe: parseTagLanguageAliasRows(settings["tag_language.aliases.de"]),
        })),
        Effect.catchAll(() =>
          Effect.succeed({
            ollamaUrl: config.config.ollama.url,
            model: config.config.ollama.model,
            agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
            promptLanguage: normalizePromptLanguage(config.config.language),
            tagLanguageAliasesDe: parseTagLanguageAliasRows(undefined),
          }),
        ),
      );

    const sanitizeResult = (
      input: TagExplorerInput,
      params: {
        tagIdsToAdd?: unknown;
        tagIdsToRemove?: unknown;
        rejectedTagIdeas?: unknown;
        newTagProposal?: unknown;
        reasoning?: unknown;
      },
    ): TagExplorerResult => {
      const catalogIds = new Set(input.catalogTags.map((tag) => tag.id));
      const catalogByKey = new Map(input.catalogTags.map((tag) => [normalizeKey(tag.name), tag]));
      const tagIdsToAdd = uniqueNumbers(params.tagIdsToAdd).filter((id) => catalogIds.has(id));
      const tagIdsToRemove = uniqueNumbers(params.tagIdsToRemove).filter((id) =>
        input.currentTagIds.includes(id),
      );
      const rejectedTagIdeas = Array.isArray(params.rejectedTagIdeas)
        ? params.rejectedTagIdeas
            .map((item) => {
              if (!item || typeof item !== "object" || Array.isArray(item)) return null;
              const record = item as Record<string, unknown>;
              const name = normalizeName(String(record["name"] ?? ""));
              const reason = normalizeName(String(record["reason"] ?? ""));
              return name && reason ? { name, reason } : null;
            })
            .filter((item): item is TagExplorerRejectedIdea => item !== null)
            .slice(0, 20)
        : [];

      const proposal =
        params.newTagProposal &&
        typeof params.newTagProposal === "object" &&
        !Array.isArray(params.newTagProposal)
          ? (params.newTagProposal as Record<string, unknown>)
          : null;
      const proposalName = proposal ? normalizeName(String(proposal["name"] ?? "")) : "";
      const proposalEvidence = proposal ? normalizeName(String(proposal["evidence"] ?? "")) : "";
      const proposalReasoning = proposal ? normalizeName(String(proposal["reasoning"] ?? "")) : "";
      const newTagProposal =
        proposalName &&
        proposalEvidence &&
        proposalReasoning &&
        !catalogByKey.has(normalizeKey(proposalName))
          ? {
              name: proposalName,
              evidence: proposalEvidence,
              reasoning: proposalReasoning,
            }
          : null;

      return {
        tagIdsToAdd,
        tagIdsToRemove,
        rejectedTagIdeas,
        newTagProposal,
        reasoning: normalizeName(String(params.reasoning ?? "")),
      };
    };

    const createTools = (
      input: TagExplorerInput,
      resultRef: { current: TagExplorerResult | null },
    ): AgentTool[] => {
      const finishParams = Type.Object({
        tagIdsToAdd: Type.Optional(Type.Array(Type.Number())),
        tagIdsToRemove: Type.Optional(Type.Array(Type.Number())),
        rejectedTagIdeas: Type.Optional(
          Type.Array(
            Type.Object({
              name: Type.String(),
              reason: Type.String(),
            }),
          ),
        ),
        newTagProposal: Type.Optional(
          Type.Union([
            Type.Null(),
            Type.Object({
              name: Type.String(),
              evidence: Type.String(),
              reasoning: Type.String(),
            }),
          ]),
        ),
        reasoning: Type.String(),
      });

      const finishTagExploration: AgentTool<typeof finishParams, TagExplorerResult> = {
        name: "finish_tag_exploration",
        label: "Finish tag exploration",
        description:
          "Return read-only tag recommendations. This tool never mutates Paperless or asks the user.",
        parameters: finishParams,
        executionMode: "sequential",
        execute: async (_toolCallId, params) => {
          const result = sanitizeResult(input, params);
          resultRef.current = result;
          return textResult(JSON.stringify(result), result, true);
        },
      };

      return [finishTagExploration];
    };

    const buildPrompt = (input: TagExplorerInput, promptLanguage: string): string => {
      const staticPromptText = [
        "You are a read-only tag exploration micro-agent.",
        buildTagExplorerPromptWithExcerpt(
          input,
          promptLanguage,
          formatUntrustedDocumentText("", 0),
        ),
      ].join("\n");
      const excerptBudget = computeContentExcerptCharBudget({
        contextWindowTokens: DEFAULT_OLLAMA_CONTEXT_WINDOW,
        reservedOutputTokens: DEFAULT_OLLAMA_MAX_TOKENS,
        staticPromptText,
        maxExcerptChars: 10_000,
      });

      return buildTagExplorerPromptWithExcerpt(
        input,
        promptLanguage,
        formatUntrustedDocumentText(input.content, excerptBudget),
      );
    };

    return {
      name: "tag_explorer_agent" as const,
      exploreTags: (input) =>
        Effect.gen(function* () {
          const runtime = yield* getRuntimeSettings();
          const resultRef = { current: null as TagExplorerResult | null };
          const agent = new PiAgent({
            initialState: {
              systemPrompt: "You are a read-only tag exploration micro-agent.",
              model: buildOllamaModel(runtime.ollamaUrl, runtime.model),
              tools: createTools(input, resultRef),
            },
            streamFn: makeGatedOllamaStreamSimple(concurrency),
            getApiKey: () => "ollama",
            sessionId: `tag-explorer-${input.docId}-${Date.now()}`,
            toolExecution: "sequential",
          });

          yield* Effect.tryPromise({
            try: () =>
              runWithPromptActivityWatchdog(
                async ({ markActivity }) => {
                  const unsubscribe = agent.subscribe((event) => {
                    markActivity(`agent_${event.type}`);
                  });
                  try {
                    await agent.prompt(
                      buildPrompt(
                        {
                          ...input,
                          tagLanguageAliasesDe:
                            input.tagLanguageAliasesDe ?? runtime.tagLanguageAliasesDe,
                        },
                        runtime.promptLanguage,
                      ),
                    );
                  } finally {
                    unsubscribe();
                  }
                },
                {
                  label: "Tag explorer",
                  timeoutMs: runtime.agentPromptTimeoutMs,
                  abort: () => agent.abort(),
                  checkStillRunning: async () =>
                    agent.state.isStreaming ||
                    (await checkOllamaModelRunning(runtime.ollamaUrl, runtime.model)),
                },
              ),
            catch: (error) => {
              const messageText =
                error instanceof Error && error.message ? error.message : String(error);
              return new AgentError({
                agent: "tag_explorer_agent",
                message:
                  error instanceof PromptIdleTimeoutError
                    ? messageText
                    : `Tag explorer failed: ${messageText}`,
                cause: error,
              });
            },
          });

          const failedFinish = agent.state.messages.find(
            (message) => hasFinishToolResult(message) && message.isError,
          );
          if (failedFinish || !resultRef.current) {
            return yield* Effect.fail(
              new AgentError({
                agent: "tag_explorer_agent",
                message:
                  (failedFinish ? getToolResultText(failedFinish) : null) ||
                  "Tag explorer did not finalize tag recommendations.",
              }),
            );
          }

          return resultRef.current;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof AgentError
              ? error
              : new AgentError({
                  agent: "tag_explorer_agent",
                  message: `Tag explorer failed: ${String(error)}`,
                  cause: error,
                }),
          ),
        ),
    };
  }),
);
