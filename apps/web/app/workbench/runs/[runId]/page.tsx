"use client";

import type { SystemReadiness } from "@repo/api-contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
} from "@repo/ui";
import {
  ArrowLeft,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  Loader2,
  Radio,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { outcomeTone, runOutcome, stateLabel } from "@/components/workbench/analysis-model";
import { computeRunStateHash, newIdempotencyKey } from "@/components/workbench/bundle-model";
import { failureMeta } from "@/components/workbench/failure-model";
import { ProposalDetail } from "@/components/workbench/proposal-detail";
import { RunTimeline } from "@/components/workbench/run-timeline";
import { HashChip, Notice, SectionHeader, StatusBadge } from "@/components/workbench/ui";
import { useWorkbench } from "@/components/workbench/use-workbench";
import { analysisApi, systemApi } from "@/lib/api";

export default function AnalysisRunDetailPage() {
  const params = useParams<{ runId: string }>();
  const router = useRouter();
  const runId = decodeURIComponent(params.runId);
  const workbench = useWorkbench(runId);
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void systemApi.getReadiness().then((response) => {
      if (active && response.ok) setReadiness(response.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const { run, projection } = workbench;
  const outcome = run ? runOutcome(run) : null;
  const paperlessDocumentUrl =
    run && readiness?.providers.paperless.url
      ? `${readiness.providers.paperless.url.replace(/\/$/, "")}/documents/${run.documentId}/details`
      : null;

  const retryRun = async () => {
    if (!run) return;
    setRetrying(true);
    setRetryError(null);
    const response = await analysisApi.retryRun(run.runId, {
      expectedRunStateHash: computeRunStateHash(run),
      idempotencyKey: newIdempotencyKey(),
    });
    setRetrying(false);
    if (!response.ok) {
      setRetryError(response.error);
      return;
    }
    if (response.data.runId === run.runId) {
      window.location.reload();
      return;
    }
    router.push(`/workbench/runs/${encodeURIComponent(response.data.runId)}`);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-5 md:px-8">
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-2">
            <Link href="/system-test">
              <ArrowLeft className="mr-2 h-4 w-4" />
              System test
            </Link>
          </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight">Canary run validation</h1>
              <p className="mt-1 max-w-3xl text-sm text-zinc-500">
                Inspect this one run from source identity through OCR evidence and the final
                metadata bundle before enabling automatic processing.
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href="/workbench">All analysis runs</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="space-y-5 px-6 py-6 md:px-8">
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>Automatic processing is not enabled from this page</AlertTitle>
          <AlertDescription>
            Scanner scope: <strong>{readiness?.scanner.scope ?? "checking"}</strong>. Approving this
            bundle applies only this run; it does not switch the scanner to full automatic mode.
          </AlertDescription>
        </Alert>

        {workbench.error && run ? (
          <Notice tone="danger" title="Run action failed" icon={<X className="h-4 w-4" />}>
            {workbench.error}
          </Notice>
        ) : null}
        {workbench.notice ? (
          <Notice tone="success" title={workbench.notice} icon={<FileCheck2 className="h-4 w-4" />}>
            The run stream will update after the backend completes the accepted action.
          </Notice>
        ) : null}

        {!run && workbench.error ? (
          <Card>
            <CardContent className="py-10">
              <Notice
                tone="danger"
                title="Run unavailable"
                icon={<CircleAlert className="h-4 w-4" />}
              >
                The backend could not load run <span className="font-mono">{runId}</span>.{" "}
                {workbench.error}
              </Notice>
            </CardContent>
          </Card>
        ) : !run ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-12 text-sm text-zinc-500">
              <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
              Loading run {runId}…
            </CardContent>
          </Card>
        ) : (
          <>
            <section
              aria-labelledby="run-summary-heading"
              className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Paperless document
                  </p>
                  <h2 id="run-summary-heading" className="mt-1 text-xl font-semibold">
                    {workbench.current?.title || `Document #${run.documentId}`}
                  </h2>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-500">{run.runId}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {outcome ? (
                    <StatusBadge tone={outcomeTone(outcome)}>{stateLabel(run.state)}</StatusBadge>
                  ) : null}
                  {run.forceOcr ? <StatusBadge tone="info">forced OCR</StatusBadge> : null}
                  <StatusBadge tone={workbench.streamStatus === "open" ? "success" : "neutral"}>
                    <Radio className="h-3 w-3" />
                    stream {workbench.streamStatus}
                  </StatusBadge>
                  {paperlessDocumentUrl ? (
                    <Button asChild size="sm" variant="outline">
                      <a href={paperlessDocumentUrl} target="_blank" rel="noreferrer">
                        Open in Paperless
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  ) : (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/documents/${run.documentId}`}>
                        Current document
                        <ExternalLink className="ml-2 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            </section>

            {run.failure ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>
                  {failureMeta(run.failure.code).label} · {run.failure.code}
                </AlertTitle>
                <AlertDescription>
                  <p>
                    {run.failure.message} {failureMeta(run.failure.code).hint}
                  </p>
                  {retryError ? <p className="mt-2 font-medium">{retryError}</p> : null}
                  {run.failure.retryable ? (
                    <Button
                      className="mt-3"
                      size="sm"
                      variant="outline"
                      disabled={retrying}
                      onClick={() => void retryRun()}
                    >
                      {retrying ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RotateCw className="mr-2 h-4 w-4" />
                      )}
                      Retry this run
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <section className="min-w-0 space-y-5" aria-label="Run proposal and evidence">
                {projection ? (
                  <Card>
                    <CardContent className="pt-6">
                      <ProposalDetail
                        run={run}
                        projection={projection}
                        current={workbench.current}
                        catalogIndex={workbench.catalogIndex}
                        currentLoading={workbench.currentLoading}
                        currentError={workbench.currentError}
                        busy={workbench.busy}
                        onApprove={() => void workbench.approve()}
                        onReject={() => void workbench.reject()}
                        onForceOcr={() => void workbench.forceOcr()}
                        onRefreshCurrent={() => void workbench.refreshCurrent()}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <SectionHeader title="Proposal and evidence" />
                    </CardHeader>
                    <CardContent className="text-sm text-zinc-500">
                      {run.state === "awaiting_review"
                        ? "The proposal projection is loading."
                        : "No proposal is available yet. Follow the pipeline stages on the right; this page updates from the live run stream."}
                    </CardContent>
                  </Card>
                )}

                <CurrentPaperlessSnapshot
                  current={workbench.current}
                  loading={workbench.currentLoading}
                  error={workbench.currentError}
                />
              </section>

              <aside className="space-y-5" aria-label="Run facts and progress">
                <Card>
                  <CardHeader>
                    <SectionHeader title="Pipeline progress" />
                  </CardHeader>
                  <CardContent>
                    <RunTimeline run={run} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <SectionHeader title="Run facts" />
                  </CardHeader>
                  <CardContent className="space-y-2 text-xs">
                    <Fact label="Document ID" value={`#${run.documentId}`} />
                    <Fact label="Created" value={formatDateTime(run.createdAt)} />
                    <Fact label="Last update" value={formatDateTime(run.updatedAt)} />
                    <Fact
                      label="Completed"
                      value={run.completedAt ? formatDateTime(run.completedAt) : "—"}
                    />
                    <Fact label="Retries" value={String(run.retryCount)} />
                    <Fact
                      label="Document state"
                      value={<HashChip hash={run.documentStateHash} label="documentStateHash" />}
                    />
                    <Fact
                      label="Source PDF"
                      value={
                        run.sourcePdfHash ? (
                          <HashChip hash={run.sourcePdfHash} label="sourcePdfHash" />
                        ) : (
                          "not captured yet"
                        )
                      }
                    />
                  </CardContent>
                </Card>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function CurrentPaperlessSnapshot({
  current,
  loading,
  error,
}: {
  current: ReturnType<typeof useWorkbench>["current"];
  loading: boolean;
  error: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <SectionHeader
          title="Live Paperless snapshot"
          description="Fetched now from Paperless; the operational ledger is not treated as document truth."
        />
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading current document…
          </p>
        ) : error ? (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : current ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <SnapshotFact label="Title" value={current.title} />
            <SnapshotFact label="Correspondent" value={current.correspondent ?? "None"} />
            <SnapshotFact label="Document type" value={current.document_type ?? "None"} />
            <SnapshotFact
              label="Tags"
              value={current.tags.length ? current.tags.map((tag) => tag.name).join(", ") : "None"}
            />
            <SnapshotFact
              label="Custom fields"
              value={`${current.custom_fields.length} configured value${current.custom_fields.length === 1 ? "" : "s"}`}
            />
            <SnapshotFact label="Modified" value={formatDateTime(current.modified)} />
            <SnapshotFact label="Original file" value={current.original_file_name ?? "Unknown"} />
            <SnapshotFact
              label="Content"
              value={
                current.content ? `${current.content.length.toLocaleString()} characters` : "Empty"
              }
            />
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">Current document values are not available.</p>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 py-1.5 last:border-0 dark:border-zinc-800">
      <span className="text-zinc-500">{label}</span>
      <span className="min-w-0 text-right text-zinc-800 dark:text-zinc-200">{value}</span>
    </div>
  );
}

function SnapshotFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-0.5 break-words text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}
