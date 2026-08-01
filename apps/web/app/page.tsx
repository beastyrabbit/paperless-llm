"use client";

import type { AnalysisRun, CatalogEpoch, SystemReadiness } from "@repo/api-contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FlaskConical,
  Layers,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { analysisApi, catalogWorkbenchApi, systemApi } from "@/lib/api";

export default function Dashboard() {
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [runs, setRuns] = useState<readonly AnalysisRun[]>([]);
  const [epochs, setEpochs] = useState<readonly CatalogEpoch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [runtimeResult, runResult, epochResult] = await Promise.all([
      systemApi.getReadiness(),
      analysisApi.listRuns({ limit: 20 }),
      catalogWorkbenchApi.listEpochs({ limit: 5 }),
    ]);
    if (runtimeResult.ok) setReadiness(runtimeResult.data);
    if (runResult.ok) setRuns(runResult.data.items);
    if (epochResult.ok) setEpochs(epochResult.data.items);
    const firstError = [runtimeResult, runResult, epochResult].find((result) => !result.ok);
    if (firstError && !firstError.ok) setError(firstError.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = useMemo(
    () => ({
      active: runs.filter((run) =>
        [
          "queued",
          "reading_paperless",
          "ocr_requested",
          "hashing_source",
          "analyzing",
          "retrying",
          "applying",
        ].includes(run.state),
      ).length,
      review: runs.filter((run) => run.state === "awaiting_review").length,
      failed: runs.filter((run) => run.state === "failed").length,
      completed: runs.filter((run) => run.state === "succeeded").length,
    }),
    [runs],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 md:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Paperless-first analysis and catalog activity.
            </p>
          </div>
          <Button variant="outline" onClick={() => void refresh()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      <main className="space-y-6 px-6 py-6 md:px-8">
        {error ? (
          <Alert variant="destructive">
            <CircleAlert className="h-4 w-4" />
            <AlertTitle>Dashboard data is incomplete</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Alert variant={readiness?.analysisReady ? "default" : "destructive"}>
          {readiness?.analysisReady ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <CircleAlert className="h-4 w-4" />
          )}
          <AlertTitle>
            {readiness?.analysisReady
              ? "Paperless-first analysis is ready"
              : loading
                ? "Checking runtime readiness"
                : "Analysis requires attention"}
          </AlertTitle>
          <AlertDescription>
            {readiness?.analysisReady
              ? `Manual runs are enabled; the automatic scanner is ${readiness.scanner.scope}.`
              : readiness?.blockers.join(" ") || "Runtime checks are still loading."}
          </AlertDescription>
        </Alert>

        <section aria-labelledby="analysis-summary-heading">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="analysis-summary-heading" className="text-base font-semibold">
              Analysis summary
            </h2>
            <Button asChild variant="outline" size="sm">
              <Link href="/system-test">
                Run system test
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Active" value={metrics.active} />
            <Metric label="Needs review" value={metrics.review} tone="warning" />
            <Metric label="Failed" value={metrics.failed} tone="danger" />
            <Metric label="Completed" value={metrics.completed} tone="success" />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <FlaskConical className="h-5 w-5 text-zinc-500" />
                    Recent analysis runs
                  </CardTitle>
                  <CardDescription>
                    Live operational state; document facts stay in Paperless.
                  </CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/workbench">Workbench</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {runs.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {runs.slice(0, 6).map((run) => (
                    <Link
                      key={run.runId}
                      href={`/workbench/runs/${encodeURIComponent(run.runId)}`}
                      className="flex items-center justify-between gap-4 py-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">Document #{run.documentId}</span>
                        <span className="block truncate font-mono text-xs text-zinc-500">
                          {run.runId}
                        </span>
                      </span>
                      <Badge variant={runVariant(run.state)}>{run.state}</Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <Empty message="No Paperless-first analysis runs yet." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Layers className="h-5 w-5 text-zinc-500" />
                    Catalog optimization
                  </CardTitle>
                  <CardDescription>
                    Manual evidence epochs and human-reviewed proposals.
                  </CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/catalog/optimization">Open</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {epochs.length ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {epochs.map((epoch) => (
                    <div
                      key={epoch.epochId}
                      className="flex items-center justify-between gap-4 py-3 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block font-medium">{epoch.scope.join(", ")}</span>
                        <span className="block truncate font-mono text-xs text-zinc-500">
                          {epoch.epochId}
                        </span>
                      </span>
                      <Badge variant={epoch.state === "applied" ? "success" : "secondary"}>
                        {epoch.state}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty message="No catalog optimization epochs yet." />
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Metric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "warning" | "danger" | "success";
}) {
  const iconClass =
    tone === "success"
      ? "text-emerald-600"
      : tone === "warning"
        ? "text-amber-600"
        : tone === "danger"
          ? "text-red-600"
          : "text-zinc-500";
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm text-zinc-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        {tone === "success" ? (
          <CheckCircle2 className={`h-5 w-5 ${iconClass}`} />
        ) : (
          <FileCheck2 className={`h-5 w-5 ${iconClass}`} />
        )}
      </CardContent>
    </Card>
  );
}

function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-zinc-500">{message}</p>;
}

function runVariant(state: AnalysisRun["state"]) {
  if (state === "succeeded") return "success" as const;
  if (state === "failed") return "destructive" as const;
  if (state === "awaiting_review") return "warning" as const;
  return "secondary" as const;
}
