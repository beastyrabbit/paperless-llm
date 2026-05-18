/**
 * Catalog/taxonomy agent service.
 *
 * This service persists proposals from the Pi consolidation agent. It
 * does not mutate Paperless during analysis; proposals must be explicitly
 * approved and applied.
 */
import { Context, Effect, Layer } from "effect";
import {
  type ConsolidationProposal,
  PiConsolidationAgentService,
} from "../agents/PiConsolidationAgent.js";
import { AgentError, DatabaseError, NotFoundError } from "../errors/index.js";
import { LockService } from "./LockService.js";
import { PaperlessService } from "./PaperlessService.js";
import { TinyBaseService } from "./TinyBaseService.js";

export type CatalogEntityKind = "tag" | "correspondent" | "document_type" | "custom_field";
export type CatalogProposalType =
  | "merge"
  | "rename"
  | "delete"
  | "delete_unused"
  | "keep_separate"
  | "needs_decision";
export type CatalogProposalStatus = "proposed" | "approved" | "rejected" | "applied";
export type CatalogRunStatus = "running" | "completed" | "failed";
export type CustomFieldWriteMode = "append" | "update" | "replace";

export interface CatalogRun {
  id: string;
  status: CatalogRunStatus;
  runtime: "pi_agent" | "local" | "openai_cli";
  summary: string;
  proposalIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface CatalogProposal {
  id: string;
  runId: string;
  type: CatalogProposalType;
  entityKind: CatalogEntityKind;
  entityId: number | null;
  entityName: string;
  targetEntityId: number | null;
  targetEntityName: string | null;
  reason: string;
  confidence: number;
  usageCount: number;
  customFieldMode: CustomFieldWriteMode | null;
  payload: Record<string, unknown>;
  status: CatalogProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogAgentService {
  readonly startRun: (options?: {
    runtime?: "pi_agent" | "local" | "openai_cli";
  }) => Effect.Effect<CatalogRun, AgentError | DatabaseError>;
  readonly getRun: (runId: string) => Effect.Effect<CatalogRun | null, DatabaseError>;
  readonly listRuns: () => Effect.Effect<CatalogRun[], DatabaseError>;
  readonly listProposals: (runId?: string) => Effect.Effect<CatalogProposal[], DatabaseError>;
  readonly decideProposal: (
    proposalId: string,
    status: "approved" | "rejected",
  ) => Effect.Effect<CatalogProposal, DatabaseError | NotFoundError>;
  readonly applyProposal: (
    proposalId: string,
  ) => Effect.Effect<CatalogProposal, DatabaseError | NotFoundError | AgentError>;
}

export const CatalogAgentService = Context.GenericTag<CatalogAgentService>("CatalogAgentService");

const nowIso = (): string => new Date().toISOString();
const generateId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asNullableString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const rowToRun = (id: string, row: Record<string, unknown> | undefined): CatalogRun | null => {
  if (!row || Object.keys(row).length === 0) return null;
  return {
    id,
    status: row["status"] as CatalogRunStatus,
    runtime: row["runtime"] as "pi_agent" | "local" | "openai_cli",
    summary: String(row["summary"] ?? ""),
    proposalIds: parseJson<string[]>(row["proposalIds"], []),
    startedAt: String(row["startedAt"] ?? ""),
    updatedAt: String(row["updatedAt"] ?? ""),
    completedAt: asNullableString(row["completedAt"]),
    error: asNullableString(row["error"]),
  };
};

const rowToProposal = (
  id: string,
  row: Record<string, unknown> | undefined,
): CatalogProposal | null => {
  if (!row || Object.keys(row).length === 0) return null;
  return {
    id,
    runId: String(row["runId"] ?? ""),
    type: row["type"] as CatalogProposalType,
    entityKind: row["entityKind"] as CatalogEntityKind,
    entityId: row["entityId"] === "" ? null : Number(row["entityId"] ?? 0),
    entityName: String(row["entityName"] ?? ""),
    targetEntityId: row["targetEntityId"] === "" ? null : Number(row["targetEntityId"] ?? 0),
    targetEntityName: asNullableString(row["targetEntityName"]),
    reason: String(row["reason"] ?? ""),
    confidence: Number(row["confidence"] ?? 0),
    usageCount: Number(row["usageCount"] ?? 0),
    customFieldMode:
      (asNullableString(row["customFieldMode"]) as CustomFieldWriteMode | null) ?? null,
    payload: parseJson<Record<string, unknown>>(row["payload"], {}),
    status: row["status"] as CatalogProposalStatus,
    createdAt: String(row["createdAt"] ?? ""),
    updatedAt: String(row["updatedAt"] ?? ""),
  };
};

export const CatalogAgentServiceLive = Layer.effect(
  CatalogAgentService,
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const locks = yield* LockService;
    const consolidationAgent = yield* PiConsolidationAgentService;
    const { store } = tinybase;

    const writeRun = (run: CatalogRun): void => {
      store.setRow("catalogRuns", run.id, {
        id: run.id,
        status: run.status,
        runtime: run.runtime,
        summary: run.summary,
        proposalIds: JSON.stringify(run.proposalIds),
        startedAt: run.startedAt,
        updatedAt: run.updatedAt,
        completedAt: run.completedAt ?? "",
        error: run.error ?? "",
      });
    };

    const writeProposal = (proposal: CatalogProposal): void => {
      store.setRow("catalogProposals", proposal.id, {
        id: proposal.id,
        runId: proposal.runId,
        type: proposal.type,
        entityKind: proposal.entityKind,
        entityId: proposal.entityId ?? "",
        entityName: proposal.entityName,
        targetEntityId: proposal.targetEntityId ?? "",
        targetEntityName: proposal.targetEntityName ?? "",
        reason: proposal.reason,
        confidence: proposal.confidence,
        usageCount: proposal.usageCount,
        customFieldMode: proposal.customFieldMode ?? "",
        payload: JSON.stringify(proposal.payload),
        status: proposal.status,
        createdAt: proposal.createdAt,
        updatedAt: proposal.updatedAt,
      });
    };

    const addCatalogLog = (runId: string, eventType: string, data: Record<string, unknown>) =>
      tinybase
        .addProcessingLog({
          docId: 0,
          timestamp: nowIso(),
          step: `catalog:${runId}`,
          eventType: eventType as never,
          data,
        })
        .pipe(Effect.catchAll(() => Effect.void));

    const makeProposal = (
      runId: string,
      input: Omit<CatalogProposal, "id" | "runId" | "status" | "createdAt" | "updatedAt">,
    ): CatalogProposal => {
      const timestamp = nowIso();
      return {
        id: generateId("proposal"),
        runId,
        status: "proposed",
        createdAt: timestamp,
        updatedAt: timestamp,
        ...input,
      };
    };

    const proposalFromConsolidation = (
      runId: string,
      proposal: ConsolidationProposal,
    ): CatalogProposal => {
      const type: CatalogProposalType =
        proposal.action === "needs_review"
          ? "needs_decision"
          : proposal.action === "delete"
            ? "delete"
            : proposal.action;
      return makeProposal(runId, {
        type,
        entityKind: proposal.attributeType,
        entityId: proposal.sourceIds[0] ?? proposal.targetId ?? null,
        entityName: proposal.names[0] ?? proposal.proposedName ?? "",
        targetEntityId: proposal.targetId ?? null,
        targetEntityName: proposal.proposedName ?? proposal.names[1] ?? null,
        reason: proposal.reasoning,
        confidence: proposal.confidence,
        usageCount: proposal.affectedDocumentCount,
        customFieldMode: null,
        payload: { consolidationProposal: proposal },
      });
    };

    const getCurrentUsageCount = (proposal: CatalogProposal) =>
      Effect.gen(function* () {
        if (proposal.entityId === null) return null;
        if (proposal.entityKind === "tag") {
          const tags = yield* paperless.getTags();
          return tags.find((tag) => tag.id === proposal.entityId)?.document_count ?? null;
        }
        if (proposal.entityKind === "correspondent") {
          const correspondents = yield* paperless.getCorrespondents();
          return (
            correspondents.find((correspondent) => correspondent.id === proposal.entityId)
              ?.document_count ?? null
          );
        }
        if (proposal.entityKind === "document_type") {
          const documentTypes = yield* paperless.getDocumentTypes();
          return (
            documentTypes.find((documentType) => documentType.id === proposal.entityId)
              ?.document_count ?? null
          );
        }
        return null;
      });

    return {
      startRun: (options = {}) =>
        Effect.gen(function* () {
          const lock = yield* locks.acquire({
            scope: "catalog",
            resourceId: "global",
            owner: "catalog_agent",
            metadata: {
              requestedRuntime: options.runtime ?? "pi_agent",
              runtime: "pi_agent",
            },
          });
          if (!lock.acquired) {
            return yield* Effect.fail(
              new AgentError({
                agent: "catalog_agent",
                message: `Catalog run already active: ${lock.lock.runId}`,
              }),
            );
          }

          const run: CatalogRun = {
            id: lock.lock.runId,
            status: "running",
            runtime: "pi_agent",
            summary: "Pi catalog agent running.",
            proposalIds: [],
            startedAt: nowIso(),
            updatedAt: nowIso(),
            completedAt: null,
            error: null,
          };
          writeRun(run);
          yield* addCatalogLog(run.id, "run_started", {
            runtime: run.runtime,
          });

          const finalRun = yield* Effect.gen(function* () {
            const report = yield* consolidationAgent.generateReport({ persist: false });
            const proposals = report.proposals.map((proposal) =>
              proposalFromConsolidation(run.id, proposal),
            );

            for (const proposal of proposals) {
              writeProposal(proposal);
            }

            const completed: CatalogRun = {
              ...run,
              status: "completed",
              summary: `Pi catalog agent created ${proposals.length} review proposal(s). No Paperless changes were applied.`,
              proposalIds: proposals.map((proposal) => proposal.id),
              updatedAt: nowIso(),
              completedAt: nowIso(),
            };
            writeRun(completed);
            yield* addCatalogLog(run.id, "run_completed", {
              proposalCount: proposals.length,
              reportId: report.id,
              reportSummary: report.summary,
            });
            return completed;
          }).pipe(
            Effect.catchAll((error) => {
              const failed: CatalogRun = {
                ...run,
                status: "failed",
                summary: "Catalog analysis failed.",
                updatedAt: nowIso(),
                completedAt: nowIso(),
                error: String(error),
              };
              writeRun(failed);
              return addCatalogLog(run.id, "run_failed", { error: String(error) }).pipe(
                Effect.as(failed),
              );
            }),
            Effect.ensuring(
              locks.release("catalog", "global", lock.lock.runId).pipe(Effect.ignore),
            ),
          );

          return finalRun;
        }),

      getRun: (runId) =>
        Effect.try({
          try: () => rowToRun(runId, store.getRow("catalogRuns", runId)),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to get catalog run: ${String(error)}`,
              operation: "getCatalogRun",
              cause: error,
            }),
        }),

      listRuns: () =>
        Effect.try({
          try: () =>
            Object.entries(store.getTable("catalogRuns") ?? {})
              .map(([id, row]) => rowToRun(id, row))
              .filter((run): run is CatalogRun => run !== null)
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to list catalog runs: ${String(error)}`,
              operation: "listCatalogRuns",
              cause: error,
            }),
        }),

      listProposals: (runId) =>
        Effect.try({
          try: () =>
            Object.entries(store.getTable("catalogProposals") ?? {})
              .map(([id, row]) => rowToProposal(id, row))
              .filter((proposal): proposal is CatalogProposal => proposal !== null)
              .filter((proposal) => !runId || proposal.runId === runId)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to list catalog proposals: ${String(error)}`,
              operation: "listCatalogProposals",
              cause: error,
            }),
        }),

      decideProposal: (proposalId, status) =>
        Effect.try({
          try: () => {
            const proposal = rowToProposal(
              proposalId,
              store.getRow("catalogProposals", proposalId),
            );
            if (!proposal) {
              throw new NotFoundError({
                message: `Catalog proposal ${proposalId} not found`,
                resource: "catalogProposal",
              });
            }
            const updated = { ...proposal, status, updatedAt: nowIso() };
            writeProposal(updated);
            return updated;
          },
          catch: (error) => {
            if (error instanceof NotFoundError) return error;
            return new DatabaseError({
              message: `Failed to decide catalog proposal: ${String(error)}`,
              operation: "decideCatalogProposal",
              cause: error,
            });
          },
        }),

      applyProposal: (proposalId) =>
        Effect.gen(function* () {
          const proposal = rowToProposal(proposalId, store.getRow("catalogProposals", proposalId));
          if (!proposal) {
            return yield* Effect.fail(
              new NotFoundError({
                message: `Catalog proposal ${proposalId} not found`,
                resource: "catalogProposal",
              }),
            );
          }
          if (proposal.status !== "approved") {
            return yield* Effect.fail(
              new AgentError({
                agent: "catalog_agent",
                message: "Catalog proposal must be approved before it can be applied.",
              }),
            );
          }

          if (
            (proposal.type === "delete_unused" || proposal.type === "delete") &&
            proposal.entityId !== null
          ) {
            const currentUsage = yield* getCurrentUsageCount(proposal);
            if (currentUsage === null) {
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: `Cannot verify current usage for ${proposal.entityKind} ${proposal.entityId}; proposal was not applied.`,
                }),
              );
            }
            if (currentUsage > 0) {
              const updated = {
                ...proposal,
                status: "rejected" as const,
                reason: `${proposal.reason} Current usage is now ${currentUsage}, so deletion was rejected.`,
                updatedAt: nowIso(),
              };
              writeProposal(updated);
              yield* addCatalogLog(proposal.runId, "catalog_proposal_rejected", {
                proposalId,
                type: proposal.type,
                entityKind: proposal.entityKind,
                currentUsage,
                reason: "usage_changed_before_apply",
              });
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: `${proposal.entityKind} ${proposal.entityName} now has ${currentUsage} document(s); deletion proposal was rejected.`,
                }),
              );
            }
            if (proposal.entityKind === "tag") {
              yield* paperless.deleteTag(proposal.entityId);
            } else if (proposal.entityKind === "correspondent") {
              yield* paperless.deleteCorrespondent(proposal.entityId);
            } else if (proposal.entityKind === "document_type") {
              yield* paperless.deleteDocumentType(proposal.entityId);
            } else {
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: "Custom-field deletion proposals must be applied manually in Paperless.",
                }),
              );
            }
          } else if (
            proposal.type === "merge" &&
            proposal.entityId !== null &&
            proposal.targetEntityId !== null
          ) {
            if (proposal.entityKind === "tag") {
              yield* paperless.mergeTags(proposal.entityId, proposal.targetEntityId);
            } else if (proposal.entityKind === "correspondent") {
              yield* paperless.mergeCorrespondents(proposal.entityId, proposal.targetEntityId);
            } else if (proposal.entityKind === "document_type") {
              yield* paperless.mergeDocumentTypes(proposal.entityId, proposal.targetEntityId);
            } else {
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: "Custom-field merge proposals must be applied manually in Paperless.",
                }),
              );
            }
          } else if (proposal.type === "rename" && proposal.targetEntityName) {
            const targetId = proposal.targetEntityId ?? proposal.entityId;
            if (targetId === null) {
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: "Rename proposal is missing the entity ID to rename.",
                }),
              );
            }
            if (proposal.entityKind === "tag") {
              yield* paperless.renameTag(targetId, proposal.targetEntityName);
            } else if (proposal.entityKind === "correspondent") {
              yield* paperless.renameCorrespondent(targetId, proposal.targetEntityName);
            } else if (proposal.entityKind === "document_type") {
              yield* paperless.renameDocumentType(targetId, proposal.targetEntityName);
            } else {
              return yield* Effect.fail(
                new AgentError({
                  agent: "catalog_agent",
                  message: "Custom-field rename proposals must be applied manually in Paperless.",
                }),
              );
            }
          } else {
            return yield* Effect.fail(
              new AgentError({
                agent: "catalog_agent",
                message:
                  "Only approved delete, merge, or rename proposals with complete target data can be applied automatically.",
              }),
            );
          }

          const updated = { ...proposal, status: "applied" as const, updatedAt: nowIso() };
          writeProposal(updated);
          yield* addCatalogLog(proposal.runId, "catalog_proposal_applied", {
            proposalId,
            type: proposal.type,
            entityKind: proposal.entityKind,
          });
          return updated;
        }).pipe(
          Effect.mapError((error) =>
            error instanceof NotFoundError || error instanceof AgentError
              ? error
              : new DatabaseError({
                  message: `Failed to apply catalog proposal: ${String(error)}`,
                  operation: "applyCatalogProposal",
                  cause: error,
                }),
          ),
        ),
    };
  }),
);
