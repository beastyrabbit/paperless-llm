/**
 * Manual consolidation agent.
 *
 * This agent never applies catalog changes. It produces reviewable proposals
 * and stores them as a report plus pending inbox items.
 */
import {
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  Agent as PiAgent,
} from "@earendil-works/pi-agent-core";
import { Context, Effect, Layer } from "effect";
import { Type } from "typebox";
import { ConfigService } from "../config/index.js";
import { AgentError } from "../errors/index.js";
import type { Correspondent, CustomField, DocumentType, Tag } from "../models/index.js";
import { ConcurrencyLimitService } from "../services/ConcurrencyLimitService.js";
import { PaperlessService } from "../services/PaperlessService.js";
import { TinyBaseService } from "../services/TinyBaseService.js";
import {
  formatUntrustedDataBlock,
  UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
} from "../utils/promptData.js";
import { getWorkflowTagNames, isWorkflowTagName } from "../utils/tagState.js";
import {
  buildOllamaModel,
  checkOllamaModelRunning,
  makeGatedOllamaStreamSimple,
  PromptIdleTimeoutError,
  runWithPromptActivityWatchdog,
} from "./piOllamaModel.js";

export type ConsolidationAction = "merge" | "rename" | "delete" | "keep_separate" | "needs_review";
export type ConsolidationAttributeType = "tag" | "correspondent" | "document_type" | "custom_field";

export interface ConsolidationProposal {
  id: string;
  action: ConsolidationAction;
  attributeType: ConsolidationAttributeType;
  sourceIds: number[];
  targetId?: number;
  names: string[];
  proposedName?: string;
  affectedDocumentCount: number;
  exampleDocuments: Array<{ id: number; title: string }>;
  confidence: number;
  reasoning: string;
}

export interface ConsolidationReport {
  id: string;
  status: "ready";
  proposals: ConsolidationProposal[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface PiConsolidationAgentService {
  readonly name: "consolidation_agent";
  readonly generateReport: (options?: {
    dryRun?: boolean;
    persist?: boolean;
  }) => Effect.Effect<ConsolidationReport, AgentError>;
}

export const PiConsolidationAgentService = Context.GenericTag<PiConsolidationAgentService>(
  "PiConsolidationAgentService",
);

type CatalogEntry = Pick<Tag | Correspondent | DocumentType, "id" | "name"> & {
  document_count?: number;
};

export interface CatalogSnapshot {
  tags: CatalogEntry[];
  correspondents: CatalogEntry[];
  documentTypes: CatalogEntry[];
  customFields: CustomField[];
  candidateProposals: ConsolidationProposal[];
}

type ConsolidationProposalInput = Omit<ConsolidationProposal, "id" | "exampleDocuments"> & {
  id?: string;
  exampleDocuments?: Array<{ id: number; title: string }>;
};

const textResult = <T>(text: string, details: T, terminate = false) => ({
  content: [{ type: "text" as const, text }],
  details,
  terminate,
});

const clampConfidence = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;

const isFinishReportResultMessage = (
  message: AgentMessage,
): message is AgentMessage & { role: "toolResult"; toolName: string; isError: boolean } =>
  message.role === "toolResult" && message.toolName === "finish_consolidation_report";

const getToolResultText = (message: AgentMessage): string =>
  message.role === "toolResult"
    ? message.content
        .filter((content) => content.type === "text")
        .map((content) => content.text)
        .join("\n")
    : "";

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

export const buildConsolidationAgentFewShotExamples = (): Array<Record<string, unknown>> => [
  {
    note: "Synthetic IDs are valid only inside examples; real proposals must use snapshot IDs.",
    final_tool: "finish_consolidation_report",
    action: "merge",
    proposal: {
      action: "merge",
      attributeType: "tag",
      sourceIds: [22],
      targetId: 12,
      names: ["Versicherung", "Insurance"],
      affectedDocumentCount: 9,
      confidence: 0.84,
      reasoning: "Same broad concept in two archive languages; merge into established target.",
    },
  },
  {
    action: "rename",
    proposal: {
      action: "rename",
      attributeType: "correspondent",
      sourceIds: [31],
      names: ["TK Krankenkasse"],
      proposedName: "Techniker Krankenkasse",
      affectedDocumentCount: 14,
      confidence: 0.78,
      reasoning: "Normalize abbreviation to official name; no merge without stronger evidence.",
    },
  },
  {
    action: "needs_review",
    proposal: {
      action: "needs_review",
      attributeType: "document_type",
      sourceIds: [7, 8],
      names: ["Bescheid", "Mitteilung"],
      affectedDocumentCount: 6,
      confidence: 0.43,
      reasoning: "Similar names alone are weak evidence; keep workflow tags out of proposals.",
    },
  },
];

export const buildConsolidationAgentPrompt = (snapshot: CatalogSnapshot): string => {
  const catalogPayload = JSON.stringify(
    {
      catalog_counts: {
        tags: snapshot.tags.length,
        correspondents: snapshot.correspondents.length,
        document_types: snapshot.documentTypes.length,
        custom_fields: snapshot.customFields.length,
      },
      candidate_proposals_sample: snapshot.candidateProposals.slice(0, 50),
    },
    null,
    2,
  );
  return JSON.stringify(
    {
      agent: "consolidation_agent",
      instructions: [
        "Generate a manual Paperless catalog cleanup report.",
        "Never apply catalog changes. Only call finish_consolidation_report with proposals for human review.",
        "Use get_catalog_snapshot if you need the full catalog snapshot and candidate list.",
        "Prefer needs_review over merge/delete when evidence is weak.",
        "Use only real Paperless attribute IDs from the snapshot.",
        "Never include workflow tags or unrelated operational tags in consolidation proposals.",
        UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
      ],
      few_shot_examples: buildConsolidationAgentFewShotExamples(),
      untrusted_catalog_payload: formatUntrustedDataBlock(catalogPayload, 12_000),
      required_final_tool: "finish_consolidation_report",
    },
    null,
    2,
  );
};

export const PiConsolidationAgentServiceLive = Layer.effect(
  PiConsolidationAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const concurrency = yield* ConcurrencyLimitService;
    const tinybase = yield* TinyBaseService;

    const getRuntimeSettings = () =>
      tinybase.getAllSettings().pipe(
        Effect.map((settings) => ({
          ollamaUrl: settings["ollama.url"] ?? config.config.ollama.url,
          model: settings["ollama.model"] ?? settings["ollama_model"] ?? config.config.ollama.model,
          agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
        })),
        Effect.catchAll(() =>
          Effect.succeed({
            ollamaUrl: config.config.ollama.url,
            model: config.config.ollama.model,
            agentPromptTimeoutMs: config.config.http?.agentPromptTimeoutMs ?? 120_000,
          }),
        ),
      );

    const buildSnapshot = () =>
      Effect.gen(function* () {
        const [tags, correspondents, documentTypes, customFields] = yield* Effect.all(
          [
            paperless.getTags(),
            paperless.getCorrespondents(),
            paperless.getDocumentTypes(),
            paperless.getCustomFields(),
          ],
          { concurrency: "unbounded" },
        );

        const workflowTagNames = getWorkflowTagNames(config.config.tags);
        const userTags = tags.filter((tag) => !isWorkflowTagName(tag.name, workflowTagNames));
        const candidateProposals: ConsolidationProposal[] = [];

        return {
          tags: userTags.map(({ id, name, document_count }) => ({ id, name, document_count })),
          correspondents: correspondents.map(({ id, name, document_count }) => ({
            id,
            name,
            document_count,
          })),
          documentTypes: documentTypes.map(({ id, name, document_count }) => ({
            id,
            name,
            document_count,
          })),
          customFields,
          candidateProposals,
        } satisfies CatalogSnapshot;
      });

    const deriveNames = (
      snapshot: CatalogSnapshot,
      attributeType: ConsolidationAttributeType,
      ids: number[],
    ): string[] => {
      const entries =
        attributeType === "tag"
          ? snapshot.tags
          : attributeType === "correspondent"
            ? snapshot.correspondents
            : attributeType === "document_type"
              ? snapshot.documentTypes
              : snapshot.customFields;
      return ids
        .map((id) => entries.find((entry) => entry.id === id)?.name)
        .filter((name): name is string => !!name);
    };

    const sanitizeProposal = (
      snapshot: CatalogSnapshot,
      proposal: ConsolidationProposalInput,
      index: number,
    ): ConsolidationProposal | null => {
      const validIds = new Set(
        (proposal.attributeType === "tag"
          ? snapshot.tags
          : proposal.attributeType === "correspondent"
            ? snapshot.correspondents
            : proposal.attributeType === "document_type"
              ? snapshot.documentTypes
              : snapshot.customFields
        ).map((entry) => entry.id),
      );
      let targetId =
        proposal.targetId !== undefined && validIds.has(proposal.targetId)
          ? proposal.targetId
          : undefined;
      const sourceIds = [
        ...new Set(proposal.sourceIds.filter((id) => validIds.has(id) && id !== targetId)),
      ];

      if (proposal.action === "merge" && (!targetId || sourceIds.length === 0)) return null;
      if (proposal.action === "rename" && !targetId) {
        targetId = sourceIds[0];
      }
      if (
        (proposal.action === "rename" && !targetId) ||
        (proposal.action === "delete" && sourceIds.length === 0)
      ) {
        return null;
      }
      if (
        (proposal.action === "keep_separate" || proposal.action === "needs_review") &&
        !targetId &&
        sourceIds.length === 0
      ) {
        return null;
      }

      const names = proposal.names.map((name) => name.trim()).filter(Boolean);
      const fallbackNames = deriveNames(snapshot, proposal.attributeType, [
        ...sourceIds,
        ...(targetId ? [targetId] : []),
      ]);

      return {
        id: proposal.id || `proposal-${index + 1}-${Date.now()}`,
        action: proposal.action,
        attributeType: proposal.attributeType,
        sourceIds,
        targetId,
        names: names.length > 0 ? names : fallbackNames,
        proposedName: proposal.proposedName?.trim() || undefined,
        affectedDocumentCount: Math.max(0, Math.trunc(proposal.affectedDocumentCount || 0)),
        exampleDocuments: (proposal.exampleDocuments ?? [])
          .filter((doc) => Number.isFinite(doc.id) && doc.title.trim())
          .slice(0, 5),
        confidence: clampConfidence(proposal.confidence),
        reasoning: proposal.reasoning.trim() || "Pi consolidation review requested.",
      };
    };

    const createTools = (
      snapshot: CatalogSnapshot,
      reportRef: { current: ConsolidationReport | null },
    ): AgentTool[] => {
      const emptyParams = Type.Object({});
      const actionSchema = Type.Union([
        Type.Literal("merge"),
        Type.Literal("rename"),
        Type.Literal("delete"),
        Type.Literal("keep_separate"),
        Type.Literal("needs_review"),
      ]);
      const attributeTypeSchema = Type.Union([
        Type.Literal("tag"),
        Type.Literal("correspondent"),
        Type.Literal("document_type"),
        Type.Literal("custom_field"),
      ]);
      const proposalSchema = Type.Object({
        id: Type.Optional(Type.String()),
        action: actionSchema,
        attributeType: attributeTypeSchema,
        sourceIds: Type.Array(Type.Number()),
        targetId: Type.Optional(Type.Number()),
        names: Type.Array(Type.String()),
        proposedName: Type.Optional(Type.String()),
        affectedDocumentCount: Type.Number(),
        exampleDocuments: Type.Optional(
          Type.Array(
            Type.Object({
              id: Type.Number(),
              title: Type.String(),
            }),
          ),
        ),
        confidence: Type.Number(),
        reasoning: Type.String(),
      });
      const finishParams = Type.Object({
        summary: Type.String(),
        proposals: Type.Array(proposalSchema),
      });

      const getCatalogSnapshot: AgentTool<typeof emptyParams, { snapshot: CatalogSnapshot }> = {
        name: "get_catalog_snapshot",
        label: "Get catalog snapshot",
        description:
          "Read Paperless catalog entries and deterministic duplicate/weak-attribute candidates.",
        parameters: emptyParams,
        execute: async () =>
          textResult(formatUntrustedDataBlock(JSON.stringify(snapshot), 40_000), { snapshot }),
      };

      const finishReport: AgentTool<typeof finishParams, { report: ConsolidationReport }> = {
        name: "finish_consolidation_report",
        label: "Finish consolidation report",
        description:
          "Return the final human-reviewable consolidation report. This tool never applies catalog changes.",
        parameters: finishParams,
        executionMode: "sequential",
        execute: async (_toolCallId, params) => {
          const proposals = params.proposals
            .map((proposal, index) => sanitizeProposal(snapshot, proposal, index))
            .filter((proposal): proposal is ConsolidationProposal => proposal !== null);
          const now = new Date().toISOString();
          const report: ConsolidationReport = {
            id: `consolidation-${Date.now()}`,
            status: "ready",
            proposals,
            summary:
              params.summary.trim() || `${proposals.length} consolidation proposal(s) generated.`,
            createdAt: now,
            updatedAt: now,
          };
          reportRef.current = report;
          return textResult(JSON.stringify({ report }), { report }, true);
        },
      };

      return [getCatalogSnapshot, finishReport];
    };

    const buildPrompt = buildConsolidationAgentPrompt;

    const persistReport = (report: ConsolidationReport) =>
      Effect.gen(function* () {
        const existingPendingReviewIds = new Set(
          Object.keys(tinybase.store.getTable("pendingReviews") ?? {}),
        );
        const createdPendingReviewIds: string[] = [];
        const rollback = Effect.gen(function* () {
          yield* Effect.all(
            createdPendingReviewIds.map((id) =>
              tinybase.removePendingReview(id).pipe(Effect.catchAll(() => Effect.void)),
            ),
            { concurrency: "unbounded", discard: true },
          );
          yield* Effect.sync(() => {
            tinybase.store.delRow("consolidationReports", report.id);
          });
        }).pipe(Effect.catchAll(() => Effect.void));

        const createPendingReviews = Effect.gen(function* () {
          for (const proposal of report.proposals) {
            const suggestion = (proposal.proposedName ?? proposal.names.join(" / ")).trim();
            if (!suggestion) {
              return yield* Effect.fail(
                new AgentError({
                  message: `Consolidation proposal ${proposal.id} has no review suggestion`,
                  agent: "consolidation_agent",
                }),
              );
            }

            const pendingId = yield* tinybase.addPendingReview({
              docId: 0,
              docTitle: "Catalog consolidation",
              type: "consolidation",
              suggestion,
              reasoning: proposal.reasoning,
              alternatives: proposal.names,
              attempts: 1,
              lastFeedback: null,
              nextTag: null,
              metadata: JSON.stringify({
                kind: "consolidation",
                reportId: report.id,
                proposal,
              }),
            });
            if (!pendingId) {
              return yield* Effect.fail(
                new AgentError({
                  message: `Failed to create pending consolidation review for proposal ${proposal.id}`,
                  agent: "consolidation_agent",
                }),
              );
            }
            if (!existingPendingReviewIds.has(pendingId)) {
              createdPendingReviewIds.push(pendingId);
            }
          }
        });

        yield* createPendingReviews.pipe(
          Effect.catchAll((error) => rollback.pipe(Effect.zipRight(Effect.fail(error)))),
        );
        yield* tinybase
          .saveConsolidationReport(report)
          .pipe(Effect.catchAll((error) => rollback.pipe(Effect.zipRight(Effect.fail(error)))));
      });

    return {
      name: "consolidation_agent" as const,

      generateReport: (options) =>
        Effect.gen(function* () {
          const dryRun = options?.dryRun === true;
          const shouldPersist = options?.persist !== false && !dryRun;
          const [runtime, snapshot] = yield* Effect.all([getRuntimeSettings(), buildSnapshot()], {
            concurrency: "unbounded",
          });

          const sessionId = `consolidation-agent-${Date.now()}`;
          const reportRef = { current: null as ConsolidationReport | null };
          const finalToolRef = { current: false };
          const piEvents: Array<{
            eventType: "response" | "tool_call" | "tool_result" | "error";
            data: Record<string, unknown>;
          }> = [];
          const agent = new PiAgent({
            initialState: {
              systemPrompt: [
                "You are consolidation_agent for Paperless.",
                "You produce reviewable cleanup proposals only.",
                "Deterministic backend tools apply approved changes later; never claim you applied anything.",
                UNTRUSTED_DOCUMENT_DATA_INSTRUCTION,
              ].join("\n"),
              model: buildOllamaModel(runtime.ollamaUrl, runtime.model),
              tools: createTools(snapshot, reportRef),
            },
            streamFn: makeGatedOllamaStreamSimple(concurrency),
            getApiKey: () => "ollama",
            sessionId,
            toolExecution: "sequential",
            beforeToolCall: async ({ toolCall }) => {
              if (toolCall.name !== "finish_consolidation_report") return undefined;
              if (finalToolRef.current) {
                return { block: true, reason: "Consolidation report already finalized." };
              }
              finalToolRef.current = true;
              return undefined;
            },
          });

          agent.subscribe((event: AgentEvent) => {
            if (event.type === "message_end" && event.message.role === "assistant") {
              const preview = getAssistantPreview([event.message]);
              piEvents.push({
                eventType: event.message.errorMessage ? "error" : "response",
                data: {
                  sessionId,
                  preview,
                  error: event.message.errorMessage,
                },
              });
            }
            if (event.type === "tool_execution_start") {
              piEvents.push({
                eventType: "tool_call",
                data: { sessionId, toolName: event.toolName, args: event.args },
              });
            }
            if (event.type === "tool_execution_end") {
              piEvents.push({
                eventType: event.isError ? "error" : "tool_result",
                data: {
                  sessionId,
                  toolName: event.toolName,
                  isError: event.isError,
                  result: event.result,
                },
              });
            }
          });

          yield* Effect.tryPromise({
            try: () =>
              runWithPromptActivityWatchdog(
                async ({ markActivity }) => {
                  const unsubscribe = agent.subscribe((event) => {
                    markActivity(`agent_${event.type}`);
                  });
                  try {
                    await agent.prompt(buildPrompt(snapshot));
                  } finally {
                    unsubscribe();
                  }
                },
                {
                  label: "Pi consolidation run",
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
                message:
                  error instanceof PromptIdleTimeoutError
                    ? messageText
                    : `Pi consolidation run failed: ${messageText}`,
                agent: "consolidation_agent",
                cause: error,
              });
            },
          });

          const finalToolResult = agent.state.messages.find(isFinishReportResultMessage);
          const finalToolError = finalToolResult?.isError
            ? getToolResultText(finalToolResult)
            : undefined;
          if (agent.state.errorMessage || finalToolError || !reportRef.current) {
            return yield* Effect.fail(
              new AgentError({
                message:
                  finalToolError ??
                  agent.state.errorMessage ??
                  "Consolidation agent did not finalize a report.",
                agent: "consolidation_agent",
              }),
            );
          }

          if (shouldPersist) {
            yield* Effect.all(
              piEvents.map((entry) =>
                tinybase
                  .addProcessingLog({
                    docId: 0,
                    timestamp: new Date().toISOString(),
                    step: "consolidation_agent",
                    eventType: entry.eventType,
                    data: entry.data,
                  })
                  .pipe(Effect.catchAll(() => Effect.void)),
              ),
              { concurrency: "unbounded" },
            );
            yield* persistReport(reportRef.current);
          }

          return reportRef.current;
        }).pipe(
          Effect.mapError(
            (error) =>
              new AgentError({
                message: `Consolidation report generation failed: ${String(error)}`,
                agent: "consolidation_agent",
                cause: error,
              }),
          ),
        ),
    };
  }),
);
