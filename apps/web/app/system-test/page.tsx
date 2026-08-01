"use client";

import type {
  ConnectionTest,
  DocumentId,
  PaperlessCapabilityDescriptor,
  SystemReadiness,
} from "@repo/api-contracts";
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
  Checkbox,
  Input,
  Label,
  Progress,
} from "@repo/ui";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  FileSearch,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Shuffle,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { analysisApi, settingsApi, systemApi } from "@/lib/api";

type ProviderKey = "paperless" | "mistral" | "ollama" | "qdrant";
type CheckState = "idle" | "running" | "passed" | "failed";

const providers: readonly ProviderKey[] = ["paperless", "mistral", "ollama", "qdrant"];

interface PreflightState {
  runtime: CheckState;
  capabilities: CheckState;
  paperless: CheckState;
  mistral: CheckState;
  ollama: CheckState;
  qdrant: CheckState;
}

const initialPreflight = (): PreflightState => ({
  runtime: "idle",
  capabilities: "idle",
  paperless: "idle",
  mistral: "idle",
  ollama: "idle",
  qdrant: "idle",
});

const checkLabels: Record<keyof PreflightState, string> = {
  runtime: "Runtime and local tools",
  capabilities: "Paperless capability contract",
  paperless: "Paperless connection",
  mistral: "Mistral connection",
  ollama: "Ollama connection",
  qdrant: "Qdrant connection",
};

const SYSTEM_TEST_RANDOM_CYCLE = "system-test-canary";

export default function SystemTestPage() {
  const [checks, setChecks] = useState(initialPreflight);
  const [runtime, setRuntime] = useState<SystemReadiness | null>(null);
  const [capabilities, setCapabilities] = useState<PaperlessCapabilityDescriptor | null>(null);
  const [connectionResults, setConnectionResults] = useState<
    Partial<Record<ProviderKey, ConnectionTest>>
  >({});
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [runningPreflight, setRunningPreflight] = useState(false);
  const [documentId, setDocumentId] = useState("");
  const [forceOcr, setForceOcr] = useState(false);
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [acceptedRun, setAcceptedRun] = useState<{
    runId: string;
    documentId: number;
    selection: "specific" | "random";
  } | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const runPreflight = useCallback(async () => {
    setRunningPreflight(true);
    setPreflightError(null);
    setChecks({
      runtime: "running",
      capabilities: "running",
      paperless: "running",
      mistral: "running",
      ollama: "running",
      qdrant: "running",
    });

    const [runtimeResult, capabilityResult, ...providerResults] = await Promise.all([
      systemApi.getReadiness(),
      systemApi.getPaperlessCapabilities(),
      ...providers.map((provider) => settingsApi.testConnection(provider)),
    ]);

    if (runtimeResult.ok) {
      setRuntime(runtimeResult.data);
    }
    if (capabilityResult.ok) {
      setCapabilities(capabilityResult.data);
    }

    const next: PreflightState = {
      runtime: runtimeResult.ok && runtimeResult.data.analysisReady ? "passed" : "failed",
      capabilities:
        capabilityResult.ok && Object.values(capabilityResult.data).every(Boolean)
          ? "passed"
          : "failed",
      paperless: "failed",
      mistral: "failed",
      ollama: "failed",
      qdrant: "failed",
    };

    providers.forEach((provider, index) => {
      const result = providerResults[index];
      if (result?.ok) {
        setConnectionResults((current) => ({ ...current, [provider]: result.data }));
        next[provider] = result.data.status === "success" ? "passed" : "failed";
      }
    });
    setChecks(next);

    const failures = [
      runtimeResult.ok ? null : runtimeResult.error,
      capabilityResult.ok ? null : capabilityResult.error,
      ...providerResults.map((result) => (result?.ok ? null : result?.error)),
    ].filter((value): value is string => Boolean(value));
    setPreflightError(failures[0] ?? null);
    setRunningPreflight(false);
  }, []);

  const passedChecks = useMemo(
    () => Object.values(checks).filter((state) => state === "passed").length,
    [checks],
  );
  const totalChecks = Object.keys(checks).length;
  const preflightPassed = passedChecks === totalChecks;
  const parsedDocumentId = /^\d+$/.test(documentId.trim()) ? Number(documentId.trim()) : null;

  const startAnalysis = useCallback(async () => {
    if (!parsedDocumentId) return;
    setStartingAnalysis(true);
    setAnalysisError(null);
    setAcceptedRun(null);
    const response = await analysisApi.startRun({
      documentId: parsedDocumentId as DocumentId,
      forceOcr,
    });
    setStartingAnalysis(false);
    if (!response.ok) {
      setAnalysisError(response.error);
      return;
    }
    setAcceptedRun({
      runId: response.data.runId,
      documentId: parsedDocumentId,
      selection: "specific",
    });
  }, [forceOcr, parsedDocumentId]);

  const startRandomAnalysis = useCallback(async () => {
    setStartingAnalysis(true);
    setAnalysisError(null);
    setAcceptedRun(null);
    const response = await analysisApi.selectRandomCycle({
      cycleKey: SYSTEM_TEST_RANDOM_CYCLE,
      forceOcr,
    });
    setStartingAnalysis(false);
    if (!response.ok) {
      setAnalysisError(response.error);
      return;
    }
    setDocumentId(String(response.data.documentId));
    setAcceptedRun({
      runId: response.data.runId,
      documentId: response.data.documentId,
      selection: "random",
    });
  }, [forceOcr]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-5 md:px-8">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">System test</h1>
            <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
              Verify the real local configuration, then deliberately run one Paperless document
              through Mistral OCR and the Codex document skill.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/settings?tab=runtime">View runtime settings</Link>
          </Button>
        </div>
      </header>

      <main className="space-y-6 px-6 py-6 md:px-8">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="h-5 w-5 text-zinc-500" />
                  1. Preflight
                </CardTitle>
                <CardDescription className="mt-1">
                  Read-only checks except for provider connection probes. No document is changed.
                </CardDescription>
              </div>
              <Button onClick={() => void runPreflight()} disabled={runningPreflight}>
                {runningPreflight ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Run all checks
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Progress value={(passedChecks / totalChecks) * 100} className="max-w-xl" />
              <span className="whitespace-nowrap text-sm tabular-nums text-zinc-500">
                {passedChecks}/{totalChecks}
              </span>
            </div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
              {(Object.keys(checks) as Array<keyof PreflightState>).map((key) => (
                <CheckRow
                  key={key}
                  label={checkLabels[key]}
                  state={checks[key]}
                  detail={
                    key in connectionResults
                      ? connectionResults[key as ProviderKey]?.message
                      : undefined
                  }
                />
              ))}
            </div>
            {preflightError ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Preflight request failed</AlertTitle>
                <AlertDescription>{preflightError}</AlertDescription>
              </Alert>
            ) : null}
            {runtime && !runtime.analysisReady ? (
              <Alert variant="destructive">
                <CircleAlert className="h-4 w-4" />
                <AlertTitle>Analysis blockers</AlertTitle>
                <AlertDescription>{runtime.blockers.join(" ")}</AlertDescription>
              </Alert>
            ) : null}
            {capabilities ? (
              <p className="text-xs text-zinc-500">
                Paperless capabilities: {Object.values(capabilities).filter(Boolean).length}/
                {Object.keys(capabilities).length} supported.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileSearch className="h-5 w-5 text-zinc-500" />
                2. Run one real document
              </CardTitle>
              <CardDescription>
                This adds the transient ai-analyse tag and starts the paid OCR/Codex workflow.
                Metadata is not applied until you approve the whole proposal in the workbench.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert>
                <FlaskConical className="h-4 w-4" />
                <AlertTitle>Deliberate live action</AlertTitle>
                <AlertDescription>
                  Choose a disposable or representative Paperless document. Starting this test can
                  call Mistral and Codex and will create an operational run record.
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_1fr]">
                <div className="space-y-2">
                  <Label htmlFor="system-test-document-id">Paperless document ID</Label>
                  <Input
                    id="system-test-document-id"
                    inputMode="numeric"
                    placeholder="e.g. 4821"
                    value={documentId}
                    onChange={(event) => setDocumentId(event.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <label
                    htmlFor="system-test-force-ocr"
                    className="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-300"
                  >
                    <Checkbox
                      id="system-test-force-ocr"
                      checked={forceOcr}
                      onCheckedChange={(checked) => setForceOcr(checked === true)}
                    />
                    Force fresh OCR instead of reusing an approved version
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void startRandomAnalysis()}
                  disabled={!preflightPassed || startingAnalysis}
                >
                  {startingAnalysis ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Shuffle className="mr-2 h-4 w-4" />
                  )}
                  Pick random &amp; start
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void startAnalysis()}
                  disabled={!preflightPassed || !parsedDocumentId || startingAnalysis}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start specific document
                </Button>
              </div>

              {!preflightPassed ? (
                <p className="text-xs text-zinc-500">
                  Run and pass all preflight checks before starting a live document.
                </p>
              ) : null}
              {analysisError ? (
                <Alert variant="destructive">
                  <CircleAlert className="h-4 w-4" />
                  <AlertTitle>Analysis was not started</AlertTitle>
                  <AlertDescription>{analysisError}</AlertDescription>
                </Alert>
              ) : null}
              {acceptedRun ? (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>Run accepted</AlertTitle>
                  <AlertDescription>
                    <span className="block">
                      {acceptedRun.selection === "random" ? "Randomly selected" : "Selected"}{" "}
                      Paperless document #{acceptedRun.documentId}.
                    </span>
                    <span className="mt-1 block font-mono text-xs">{acceptedRun.runId}</span>
                    <Button asChild size="sm" className="mt-3 flex w-fit">
                      <Link href={`/workbench/runs/${encodeURIComponent(acceptedRun.runId)}`}>
                        Open detailed run
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">3. Review the result</CardTitle>
              <CardDescription>
                The manual test is complete only after you inspect the proposal and choose an
                outcome.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <TestLink
                href="/workbench"
                label="Analysis workbench"
                detail="Progress and bundle diff"
              />
              <TestLink
                href="/workbench/review"
                label="Needs review"
                detail="Stale and unusual proposals"
              />
              <TestLink
                href="/workbench/failures"
                label="Failure recovery"
                detail="Retry and force-OCR actions"
              />
              <TestLink
                href="/catalog/optimization"
                label="Catalog optimization"
                detail="Separate manual council workflow"
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function CheckRow({ label, state, detail }: { label: string; state: CheckState; detail?: string }) {
  const variant =
    state === "passed"
      ? "success"
      : state === "failed"
        ? "destructive"
        : state === "running"
          ? "secondary"
          : "outline";
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-200 py-2 text-sm dark:border-zinc-800">
      <span>
        {label}
        {detail ? <span className="mt-0.5 block text-xs text-zinc-500">{detail}</span> : null}
      </span>
      <Badge variant={variant}>
        {state === "running" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
        {state}
      </Badge>
    </div>
  );
}

function TestLink({ href, label, detail }: { href: string; label: string; detail: string }) {
  return (
    <Link
      href={href}
      className="block border-b border-zinc-200 py-2 last:border-0 dark:border-zinc-800"
    >
      <span className="flex items-center justify-between gap-3 font-medium">
        {label}
        <ArrowRight className="h-4 w-4 text-zinc-400" />
      </span>
      <span className="mt-0.5 block text-xs text-zinc-500">{detail}</span>
    </Link>
  );
}
