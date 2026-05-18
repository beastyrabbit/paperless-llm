"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ScrollArea } from "@repo/ui";
import { Check, Loader2, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  type CatalogProposal,
  type CatalogRun,
  catalogApi,
  type ProcessingLogEntry,
} from "@/lib/api";

const proposalTone: Record<string, string> = {
  proposed: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
  approved: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  applied: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const formatSkippedUnused = (value: unknown): string | null => {
  const skipped = asRecord(value);
  const parts = [
    ["tags", skipped.tags],
    ["correspondents", skipped.correspondents],
    ["document types", skipped.documentTypes],
    ["custom fields", skipped.customFields],
  ]
    .filter(([, count]) => typeof count === "number" && count > 0)
    .map(([label, count]) => `${count} ${label}`);
  return parts.length > 0 ? parts.join(", ") : null;
};

export default function CatalogPage() {
  const [runs, setRuns] = useState<CatalogRun[]>([]);
  const [activeRun, setActiveRun] = useState<CatalogRun | null>(null);
  const [proposals, setProposals] = useState<CatalogProposal[]>([]);
  const [logs, setLogs] = useState<ProcessingLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningRuntime, setRunningRuntime] = useState<"pi_agent" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (preferredRunId?: string) => {
      setLoading(true);
      setError(null);
      const runsResult = await catalogApi.listRuns();
      if (runsResult.error) {
        setError(runsResult.error);
        setLoading(false);
        return;
      }
      const nextRuns = runsResult.data?.runs ?? [];
      setRuns(nextRuns);
      const selected =
        nextRuns.find((run) => run.id === (preferredRunId ?? activeRun?.id)) ?? nextRuns[0] ?? null;
      setActiveRun(selected);
      if (!selected) {
        setProposals([]);
        setLogs([]);
        setLoading(false);
        return;
      }
      const [proposalsResult, logsResult] = await Promise.all([
        catalogApi.listProposals(selected.id),
        catalogApi.getLogs(selected.id),
      ]);
      if (proposalsResult.error) {
        setError(proposalsResult.error);
      } else {
        setProposals(proposalsResult.data?.proposals ?? []);
      }
      if (logsResult.error) {
        setError(logsResult.error);
      } else {
        setLogs(logsResult.data?.logs ?? []);
      }
      setLoading(false);
    },
    [activeRun?.id],
  );

  useEffect(() => {
    load();
  }, [load]);

  const startRun = async () => {
    setRunningRuntime("pi_agent");
    setError(null);
    const result = await catalogApi.startRun("pi_agent");
    if (result.error) {
      setError(result.error);
    } else if (result.data) {
      setActiveRun(result.data);
    }
    await load(result.data?.id);
    setRunningRuntime(null);
  };

  const decide = async (proposalId: string, decision: "approved" | "rejected") => {
    await catalogApi.decideProposal(proposalId, decision);
    await load();
  };

  const apply = async (proposalId: string) => {
    const result = await catalogApi.applyProposal(proposalId);
    if (result.error) setError(result.error);
    await load();
  };

  const agentNotes = logs.flatMap((log) => {
    const notes = asRecord(log.data).notes;
    return typeof notes === "string" && notes.trim().length > 0 ? [{ id: log.id, notes }] : [];
  });
  const skippedUnusedSummary =
    logs
      .map((log) => formatSkippedUnused(asRecord(log.data).skippedUnused))
      .find((summary): summary is string => !!summary) ?? null;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-3 px-8 py-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Catalog Agent</h1>
            <p className="mt-1 text-sm text-zinc-500">
              Review conservative taxonomy proposals for tags, correspondents, document types, and
              custom fields.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => load()} disabled={loading}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={startRun} disabled={!!runningRuntime}>
              {runningRuntime === "pi_agent" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              Run Pi Catalog Agent
            </Button>
          </div>
        </div>
      </header>

      <main className="grid gap-4 p-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <Card className="rounded-md">
          <CardHeader>
            <CardTitle className="text-sm">Runs</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[70vh]">
              <div className="space-y-2 pr-3">
                {runs.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setActiveRun(run)}
                    className={`w-full rounded-md border p-3 text-left text-sm ${
                      activeRun?.id === run.id
                        ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30"
                        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{run.status}</span>
                      <Badge variant="outline">{run.runtime}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-zinc-500">{run.id}</p>
                    <p className="mt-2 text-xs text-zinc-500">{run.summary}</p>
                  </button>
                ))}
                {runs.length === 0 && (
                  <p className="rounded-md border border-dashed p-4 text-center text-sm text-zinc-500">
                    No catalog runs yet.
                  </p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <section className="space-y-4">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-4">
            {["proposed", "approved", "rejected", "applied"].map((status) => (
              <Card key={status} className="rounded-md">
                <CardContent className="p-4">
                  <p className="text-xs text-zinc-500">{status}</p>
                  <p className="mt-1 text-2xl font-semibold">
                    {proposals.filter((proposal) => proposal.status === status).length}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {activeRun && (
            <Card className="rounded-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Run Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-zinc-700 dark:text-zinc-200">{activeRun.summary}</p>
                {skippedUnusedSummary && (
                  <p className="text-xs text-zinc-500">
                    Ignored unused entries: {skippedUnusedSummary}. Zero usage is not enough
                    evidence for deletion.
                  </p>
                )}
                {agentNotes.map(({ id, notes }) => (
                  <div
                    key={`${activeRun.id}-notes-${id}`}
                    className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                  >
                    {notes}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3">
            {loading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
              </div>
            ) : proposals.length === 0 ? (
              <div className="rounded-md border border-dashed bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
                No high-confidence catalog changes were found. Unused entries are ignored unless
                there is stronger evidence than a zero document count.
              </div>
            ) : (
              proposals.map((proposal) => (
                <Card key={proposal.id} className="rounded-md">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">
                          {proposal.type.replaceAll("_", " ")} ·{" "}
                          {proposal.entityKind.replaceAll("_", " ")}
                        </CardTitle>
                        <p className="mt-1 text-sm text-zinc-500">
                          {proposal.entityName}
                          {proposal.targetEntityName ? ` → ${proposal.targetEntityName}` : ""}
                        </p>
                      </div>
                      <Badge className={proposalTone[proposal.status] ?? proposalTone.proposed}>
                        {proposal.status}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm">{proposal.reason}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
                      <span>usage {proposal.usageCount}</span>
                      <span>confidence {(proposal.confidence * 100).toFixed(0)}%</span>
                      {proposal.customFieldMode && <span>mode {proposal.customFieldMode}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {proposal.status === "proposed" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decide(proposal.id, "rejected")}
                          >
                            <X className="mr-2 h-4 w-4" />
                            Reject
                          </Button>
                          <Button size="sm" onClick={() => decide(proposal.id, "approved")}>
                            <Check className="mr-2 h-4 w-4" />
                            Approve
                          </Button>
                        </>
                      )}
                      {proposal.status === "approved" &&
                        ["delete", "delete_unused", "merge", "rename"].includes(proposal.type) && (
                          <Button size="sm" onClick={() => apply(proposal.id)}>
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Apply
                          </Button>
                        )}
                      {proposal.status === "approved" &&
                        !["delete", "delete_unused", "merge", "rename"].includes(proposal.type) && (
                          <p className="self-center text-xs text-zinc-500">
                            Apply this manually in Paperless after review.
                          </p>
                        )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
