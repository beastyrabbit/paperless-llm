/**
 * Catalog agent API handlers.
 */
import { Effect } from "effect";
import { CatalogAgentService, TinyBaseService } from "../../services/index.js";

export const startCatalogRun = (body: { runtime?: "pi_agent" | "local" | "openai_cli" } = {}) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogAgentService;
    return yield* catalog.startRun({ runtime: body.runtime ?? "pi_agent" });
  });

export const listCatalogRuns = Effect.gen(function* () {
  const catalog = yield* CatalogAgentService;
  return { runs: yield* catalog.listRuns() };
});

export const getCatalogRun = (runId: string) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogAgentService;
    const run = yield* catalog.getRun(runId);
    if (!run) return { status: 404, error: "Catalog run not found" };
    return run;
  });

export const listCatalogProposals = (runId?: string) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogAgentService;
    return { proposals: yield* catalog.listProposals(runId) };
  });

export const decideCatalogProposal = (
  proposalId: string,
  body: { decision?: "approved" | "rejected" },
) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogAgentService;
    const decision = body.decision === "approved" ? "approved" : "rejected";
    return yield* catalog.decideProposal(proposalId, decision);
  });

export const applyCatalogProposal = (proposalId: string) =>
  Effect.gen(function* () {
    const catalog = yield* CatalogAgentService;
    return yield* catalog.applyProposal(proposalId);
  });

export const getCatalogLogs = (runId?: string) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const logs = yield* tinybase.getProcessingLogs(0);
    return {
      logs: runId ? logs.filter((log) => log.step === `catalog:${runId}`) : logs,
    };
  });
