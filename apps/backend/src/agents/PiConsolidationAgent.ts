/**
 * Manual consolidation agent.
 *
 * This agent never applies catalog changes. It produces reviewable proposals
 * and stores them as a report plus pending inbox items.
 */
import { Agent as PiAgent, type AgentEvent, type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { type Model, streamSimple } from '@earendil-works/pi-ai';
import { Context, Effect, Layer } from 'effect';
import { Type } from 'typebox';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Correspondent, CustomField, DocumentType, Tag } from '../models/index.js';

export type ConsolidationAction = 'merge' | 'rename' | 'delete' | 'keep_separate' | 'needs_review';
export type ConsolidationAttributeType = 'tag' | 'correspondent' | 'document_type' | 'custom_field';

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
  status: 'ready';
  proposals: ConsolidationProposal[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface PiConsolidationAgentService {
  readonly name: 'consolidation_agent';
  readonly generateReport: (options?: { dryRun?: boolean }) => Effect.Effect<ConsolidationReport, AgentError>;
}

export const PiConsolidationAgentService = Context.GenericTag<PiConsolidationAgentService>('PiConsolidationAgentService');

type CatalogEntry = Pick<Tag | Correspondent | DocumentType, 'id' | 'name'> & { document_count?: number };

interface CatalogSnapshot {
  tags: CatalogEntry[];
  correspondents: CatalogEntry[];
  documentTypes: CatalogEntry[];
  customFields: CustomField[];
  candidateProposals: ConsolidationProposal[];
}

type ConsolidationProposalInput = Omit<ConsolidationProposal, 'id' | 'exampleDocuments'> & {
  id?: string;
  exampleDocuments?: Array<{ id: number; title: string }>;
};

const textResult = <T>(text: string, details: T, terminate = false) => ({
  content: [{ type: 'text' as const, text }],
  details,
  terminate,
});

const buildOllamaModel = (url: string, modelId: string): Model<'openai-completions'> => ({
  id: modelId,
  name: modelId,
  provider: 'ollama',
  api: 'openai-completions',
  baseUrl: `${url.replace(/\/$/, '')}/v1`,
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32_000,
  maxTokens: 4_096,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: 'max_tokens',
  },
});

const normalize = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const levenshtein = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let row = 0; row < rows; row++) matrix[row]![0] = row;
  for (let col = 0; col < cols; col++) matrix[0]![col] = col;

  for (let row = 1; row < rows; row++) {
    for (let col = 1; col < cols; col++) {
      const cost = a[row - 1] === b[col - 1] ? 0 : 1;
      matrix[row]![col] = Math.min(
        matrix[row - 1]![col]! + 1,
        matrix[row]![col - 1]! + 1,
        matrix[row - 1]![col - 1]! + cost
      );
    }
  }
  return matrix[a.length]![b.length]!;
};

const similarity = (a: string, b: string): number => {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
};

const clampConfidence = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0.5;

const isFinishReportResultMessage = (
  message: AgentMessage
): message is AgentMessage & { role: 'toolResult'; toolName: string; isError: boolean } =>
  message.role === 'toolResult' && message.toolName === 'finish_consolidation_report';

const getToolResultText = (message: AgentMessage): string =>
  message.role === 'toolResult'
    ? message.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('\n')
    : '';

const getAssistantPreview = (messages: AgentMessage[]): string =>
  messages
    .flatMap((message) =>
      message.role === 'assistant'
        ? message.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
        : []
    )
    .join('\n')
    .trim()
    .slice(0, 1_000);

export const PiConsolidationAgentServiceLive = Layer.effect(
  PiConsolidationAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;

    const getRuntimeSettings = () =>
      tinybase.getAllSettings().pipe(
        Effect.map((settings) => ({
          ollamaUrl: settings['ollama.url'] ?? config.config.ollama.url,
          model: settings['ollama.model_large'] ?? settings['ollama.modelLarge'] ?? config.config.ollama.modelLarge,
        })),
        Effect.catchAll(() => Effect.succeed({
          ollamaUrl: config.config.ollama.url,
          model: config.config.ollama.modelLarge,
        }))
      );

    const examplesFor = (field: 'tags__id' | 'correspondent' | 'document_type', id: number) =>
      paperless.getDocuments({ page: 1, pageSize: 25 }).pipe(
        Effect.map((docs) =>
          docs
            .filter((doc) => {
              if (field === 'tags__id') return doc.tags.includes(id);
              if (field === 'correspondent') return doc.correspondent === id;
              return doc.document_type === id;
            })
            .slice(0, 3)
            .map((doc) => ({ id: doc.id, title: doc.title }))
        ),
        Effect.catchAll(() => Effect.succeed([]))
      );

    const addProposal = (
      proposals: ConsolidationProposal[],
      proposal: Omit<ConsolidationProposal, 'id' | 'exampleDocuments'>
    ) =>
      Effect.gen(function* () {
        const id = `proposal-${proposals.length + 1}-${Date.now()}`;
        const exampleField =
          proposal.attributeType === 'tag'
            ? 'tags__id'
            : proposal.attributeType === 'correspondent'
              ? 'correspondent'
              : 'document_type';
        const exampleId = proposal.sourceIds[0] ?? proposal.targetId ?? 0;
        const exampleDocuments = proposal.attributeType === 'custom_field' || !exampleId
          ? []
          : yield* examplesFor(exampleField, exampleId);
        proposals.push({ id, ...proposal, exampleDocuments });
      });

    const analyzeCatalog = <T extends { id: number; name: string; document_count?: number }>(
      proposals: ConsolidationProposal[],
      attributeType: ConsolidationAttributeType,
      entries: T[]
    ) =>
      Effect.gen(function* () {
        for (const entry of entries) {
          if ((entry.document_count ?? 0) === 0) {
            yield* addProposal(proposals, {
              action: 'delete',
              attributeType,
              sourceIds: [entry.id],
              names: [entry.name],
              affectedDocumentCount: 0,
              confidence: 0.75,
              reasoning: `${entry.name} is unused.`,
            });
          }
        }

        for (let i = 0; i < entries.length; i++) {
          for (let j = i + 1; j < entries.length; j++) {
            const left = entries[i]!;
            const right = entries[j]!;
            const score = similarity(left.name, right.name);
            const sameNormalized = normalize(left.name) === normalize(right.name);
            if (!sameNormalized && score < 0.84) continue;

            const leftCount = left.document_count ?? 0;
            const rightCount = right.document_count ?? 0;
            const target = leftCount >= rightCount ? left : right;
            const source = target.id === left.id ? right : left;
            yield* addProposal(proposals, {
              action: sameNormalized ? 'merge' : 'needs_review',
              attributeType,
              sourceIds: [source.id],
              targetId: target.id,
              names: [left.name, right.name],
              proposedName: target.name,
              affectedDocumentCount: leftCount + rightCount,
              confidence: sameNormalized ? 0.92 : Math.max(0.55, score),
              reasoning: sameNormalized
                ? `Names normalize to the same value: "${normalize(left.name)}".`
                : `Names are similar (${Math.round(score * 100)}%).`,
            });
          }
        }
      });

    const buildSnapshot = () =>
      Effect.gen(function* () {
        const [tags, correspondents, documentTypes, customFields] = yield* Effect.all([
          paperless.getTags(),
          paperless.getCorrespondents(),
          paperless.getDocumentTypes(),
          paperless.getCustomFields(),
        ], { concurrency: 'unbounded' });

        const candidateProposals: ConsolidationProposal[] = [];
        yield* analyzeCatalog(candidateProposals, 'tag', tags);
        yield* analyzeCatalog(candidateProposals, 'correspondent', correspondents);
        yield* analyzeCatalog(candidateProposals, 'document_type', documentTypes);

        const normalizedCustomFields = new Map<string, typeof customFields>();
        for (const field of customFields) {
          const key = normalize(field.name);
          normalizedCustomFields.set(key, [...(normalizedCustomFields.get(key) ?? []), field]);
        }
        for (const group of normalizedCustomFields.values()) {
          if (group.length > 1) {
            yield* addProposal(candidateProposals, {
              action: 'needs_review',
              attributeType: 'custom_field',
              sourceIds: group.slice(1).map((field) => field.id),
              targetId: group[0]!.id,
              names: group.map((field) => `${field.name} (${field.data_type})`),
              proposedName: group[0]!.name,
              affectedDocumentCount: 0,
              confidence: 0.7,
              reasoning: 'Custom fields share the same normalized name and may duplicate each other.',
            });
          }
        }

        return {
          tags: tags.map(({ id, name, document_count }) => ({ id, name, document_count })),
          correspondents: correspondents.map(({ id, name, document_count }) => ({ id, name, document_count })),
          documentTypes: documentTypes.map(({ id, name, document_count }) => ({ id, name, document_count })),
          customFields,
          candidateProposals,
        } satisfies CatalogSnapshot;
      });

    const deriveNames = (
      snapshot: CatalogSnapshot,
      attributeType: ConsolidationAttributeType,
      ids: number[]
    ): string[] => {
      const entries =
        attributeType === 'tag'
          ? snapshot.tags
          : attributeType === 'correspondent'
            ? snapshot.correspondents
            : attributeType === 'document_type'
              ? snapshot.documentTypes
              : snapshot.customFields;
      return ids
        .map((id) => entries.find((entry) => entry.id === id)?.name)
        .filter((name): name is string => !!name);
    };

    const sanitizeProposal = (
      snapshot: CatalogSnapshot,
      proposal: ConsolidationProposalInput,
      index: number
    ): ConsolidationProposal | null => {
      const validIds = new Set(
        (proposal.attributeType === 'tag'
          ? snapshot.tags
          : proposal.attributeType === 'correspondent'
            ? snapshot.correspondents
            : proposal.attributeType === 'document_type'
              ? snapshot.documentTypes
              : snapshot.customFields
        ).map((entry) => entry.id)
      );
      let targetId = proposal.targetId !== undefined && validIds.has(proposal.targetId)
        ? proposal.targetId
        : undefined;
      const sourceIds = [...new Set(proposal.sourceIds.filter((id) => validIds.has(id) && id !== targetId))];

      if (proposal.action === 'merge' && (!targetId || sourceIds.length === 0)) return null;
      if (proposal.action === 'rename' && !targetId) {
        targetId = sourceIds[0];
      }
      if ((proposal.action === 'rename' && !targetId) || (proposal.action === 'delete' && sourceIds.length === 0)) {
        return null;
      }
      if ((proposal.action === 'keep_separate' || proposal.action === 'needs_review') && !targetId && sourceIds.length === 0) {
        return null;
      }

      const names = proposal.names.map((name) => name.trim()).filter(Boolean);
      const fallbackNames = deriveNames(
        snapshot,
        proposal.attributeType,
        [...sourceIds, ...(targetId ? [targetId] : [])]
      );

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
        reasoning: proposal.reasoning.trim() || 'Pi consolidation review requested.',
      };
    };

    const createTools = (
      snapshot: CatalogSnapshot,
      reportRef: { current: ConsolidationReport | null }
    ): AgentTool[] => {
      const emptyParams = Type.Object({});
      const actionSchema = Type.Union([
        Type.Literal('merge'),
        Type.Literal('rename'),
        Type.Literal('delete'),
        Type.Literal('keep_separate'),
        Type.Literal('needs_review'),
      ]);
      const attributeTypeSchema = Type.Union([
        Type.Literal('tag'),
        Type.Literal('correspondent'),
        Type.Literal('document_type'),
        Type.Literal('custom_field'),
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
        exampleDocuments: Type.Optional(Type.Array(Type.Object({
          id: Type.Number(),
          title: Type.String(),
        }))),
        confidence: Type.Number(),
        reasoning: Type.String(),
      });
      const finishParams = Type.Object({
        summary: Type.String(),
        proposals: Type.Array(proposalSchema),
      });

      const getCatalogSnapshot: AgentTool<typeof emptyParams, { snapshot: CatalogSnapshot }> = {
        name: 'get_catalog_snapshot',
        label: 'Get catalog snapshot',
        description: 'Read Paperless catalog entries and deterministic duplicate/weak-attribute candidates.',
        parameters: emptyParams,
        execute: async () => textResult(JSON.stringify(snapshot), { snapshot }),
      };

      const finishReport: AgentTool<typeof finishParams, { report: ConsolidationReport }> = {
        name: 'finish_consolidation_report',
        label: 'Finish consolidation report',
        description: 'Return the final human-reviewable consolidation report. This tool never applies catalog changes.',
        parameters: finishParams,
        executionMode: 'sequential',
        execute: async (_toolCallId, params) => {
          const proposals = params.proposals
            .map((proposal, index) => sanitizeProposal(snapshot, proposal, index))
            .filter((proposal): proposal is ConsolidationProposal => proposal !== null);
          const now = new Date().toISOString();
          const report: ConsolidationReport = {
            id: `consolidation-${Date.now()}`,
            status: 'ready',
            proposals,
            summary: params.summary.trim() || `${proposals.length} consolidation proposal(s) generated.`,
            createdAt: now,
            updatedAt: now,
          };
          reportRef.current = report;
          return textResult(JSON.stringify({ report }), { report }, true);
        },
      };

      return [getCatalogSnapshot, finishReport];
    };

    const buildPrompt = (snapshot: CatalogSnapshot): string => JSON.stringify({
      agent: 'consolidation_agent',
      instructions: [
        'Generate a manual Paperless catalog cleanup report.',
        'Never apply catalog changes. Only call finish_consolidation_report with proposals for human review.',
        'Use get_catalog_snapshot if you need the full catalog snapshot and candidate list.',
        'Prefer needs_review over merge/delete when evidence is weak.',
        'Use only real Paperless attribute IDs from the snapshot.',
        'Do not include workflow tags or unrelated operational tags unless they are duplicate or unused cleanup candidates.',
      ],
      catalog_counts: {
        tags: snapshot.tags.length,
        correspondents: snapshot.correspondents.length,
        document_types: snapshot.documentTypes.length,
        custom_fields: snapshot.customFields.length,
      },
      candidate_proposals_sample: snapshot.candidateProposals.slice(0, 50),
      required_final_tool: 'finish_consolidation_report',
    }, null, 2);

    const persistReport = (report: ConsolidationReport) =>
      Effect.gen(function* () {
        yield* tinybase.saveConsolidationReport(report);

        for (const proposal of report.proposals) {
          yield* tinybase.addPendingReview({
            docId: 0,
            docTitle: 'Catalog consolidation',
            type: 'consolidation',
            suggestion: proposal.proposedName ?? proposal.names.join(' / '),
            reasoning: proposal.reasoning,
            alternatives: proposal.names,
            attempts: 1,
            lastFeedback: null,
            nextTag: null,
            metadata: JSON.stringify({
              kind: 'consolidation',
              reportId: report.id,
              proposal,
            }),
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      });

    return {
      name: 'consolidation_agent' as const,

      generateReport: (options) =>
        Effect.gen(function* () {
          const dryRun = options?.dryRun === true;
          const [runtime, snapshot] = yield* Effect.all([
            getRuntimeSettings(),
            buildSnapshot(),
          ], { concurrency: 'unbounded' });

          const sessionId = `consolidation-agent-${Date.now()}`;
          const reportRef = { current: null as ConsolidationReport | null };
          const finalToolRef = { current: false };
          const piEvents: Array<{ eventType: 'response' | 'tool_call' | 'tool_result' | 'error'; data: Record<string, unknown> }> = [];
          const agent = new PiAgent({
            initialState: {
              systemPrompt: [
                'You are consolidation_agent for Paperless.',
                'You produce reviewable cleanup proposals only.',
                'Deterministic backend tools apply approved changes later; never claim you applied anything.',
              ].join('\n'),
              model: buildOllamaModel(runtime.ollamaUrl, runtime.model),
              tools: createTools(snapshot, reportRef),
            },
            streamFn: streamSimple,
            getApiKey: () => 'ollama',
            sessionId,
            toolExecution: 'sequential',
            beforeToolCall: async ({ toolCall }) => {
              if (toolCall.name !== 'finish_consolidation_report') return undefined;
              if (finalToolRef.current) {
                return { block: true, reason: 'Consolidation report already finalized.' };
              }
              finalToolRef.current = true;
              return undefined;
            },
          });

          agent.subscribe((event: AgentEvent) => {
            if (event.type === 'message_end' && event.message.role === 'assistant') {
              const preview = getAssistantPreview([event.message]);
              piEvents.push({
                eventType: event.message.errorMessage ? 'error' : 'response',
                data: {
                  sessionId,
                  preview,
                  error: event.message.errorMessage,
                },
              });
            }
            if (event.type === 'tool_execution_start') {
              piEvents.push({
                eventType: 'tool_call',
                data: { sessionId, toolName: event.toolName, args: event.args },
              });
            }
            if (event.type === 'tool_execution_end') {
              piEvents.push({
                eventType: event.isError ? 'error' : 'tool_result',
                data: { sessionId, toolName: event.toolName, isError: event.isError, result: event.result },
              });
            }
          });

          yield* Effect.tryPromise({
            try: () => agent.prompt(buildPrompt(snapshot)),
            catch: (error) =>
              new AgentError({
                message: `Pi consolidation run failed: ${String(error)}`,
                agent: 'consolidation_agent',
                cause: error,
              }),
          });

          const finalToolResult = agent.state.messages.find(isFinishReportResultMessage);
          const finalToolError = finalToolResult?.isError
            ? getToolResultText(finalToolResult)
            : undefined;
          if (agent.state.errorMessage || finalToolError || !reportRef.current) {
            return yield* Effect.fail(
              new AgentError({
                message: finalToolError ?? agent.state.errorMessage ?? 'Consolidation agent did not finalize a report.',
                agent: 'consolidation_agent',
              })
            );
          }

          if (!dryRun) {
            yield* Effect.all(
              piEvents.map((entry) =>
                tinybase.addProcessingLog({
                  docId: 0,
                  timestamp: new Date().toISOString(),
                  step: 'consolidation_agent',
                  eventType: entry.eventType,
                  data: entry.data,
                }).pipe(Effect.catchAll(() => Effect.void))
              ),
              { concurrency: 'unbounded' }
            );
            yield* persistReport(reportRef.current);
          }

          return reportRef.current;
        }).pipe(
          Effect.mapError((error) =>
            new AgentError({
              message: `Consolidation report generation failed: ${String(error)}`,
              agent: 'consolidation_agent',
              cause: error,
            })
          )
        ),
    };
  })
);
