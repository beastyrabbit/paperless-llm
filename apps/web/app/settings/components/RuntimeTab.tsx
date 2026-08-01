"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import { CheckCircle2, CircleAlert, Cpu, FileCheck2, ShieldCheck, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import type { PaperlessCapabilityDescriptor, SystemReadiness } from "@/lib/api";
import { systemApi } from "@/lib/api";

const capabilityLabels: Record<keyof PaperlessCapabilityDescriptor, string> = {
  supportsOriginalContent: "Original PDF access",
  supportsVersionContent: "Version content",
  supportsFullPagination: "Complete pagination",
  supportsBulkOperations: "Official bulk operations",
  supportsTaskPolling: "Async task polling",
  supportsNotes: "Paperless notes",
  supportsMutationRereads: "Mutation rereads",
  supportsConditionalPreconditions: "Conditional preconditions",
};

export function RuntimeTab({ refreshToken = 0 }: { refreshToken?: number }) {
  const [readiness, setReadiness] = useState<SystemReadiness | null>(null);
  const [capabilities, setCapabilities] = useState<PaperlessCapabilityDescriptor | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void refreshToken;
    let active = true;
    setError(null);
    void Promise.all([systemApi.getReadiness(), systemApi.getPaperlessCapabilities()]).then(
      ([runtimeResponse, capabilityResponse]) => {
        if (!active) return;
        if (!runtimeResponse.ok) {
          setError(runtimeResponse.error);
        } else {
          setReadiness(runtimeResponse.data);
        }
        if (!capabilityResponse.ok) {
          setError((current) => current ?? capabilityResponse.error);
        } else {
          setCapabilities(capabilityResponse.data);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [refreshToken]);

  if (error) {
    return (
      <Alert variant="destructive">
        <CircleAlert className="h-4 w-4" />
        <AlertTitle>Runtime readiness unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!readiness) {
    return <p className="text-sm text-zinc-500">Loading Paperless-first runtime…</p>;
  }

  return (
    <div className="space-y-5">
      <Alert variant={readiness.analysisReady ? "default" : "destructive"}>
        {readiness.analysisReady ? (
          <ShieldCheck className="h-4 w-4" />
        ) : (
          <CircleAlert className="h-4 w-4" />
        )}
        <AlertTitle>
          {readiness.analysisReady ? "Manual analysis is ready" : "Analysis is blocked"}
        </AlertTitle>
        <AlertDescription>
          {readiness.analysisReady
            ? "Paperless-first mode, the ai-analyse tag, Codex authentication, and OCRmyPDF are available."
            : readiness.blockers.join(" ")}
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileCheck2 className="h-5 w-5 text-zinc-500" />
              Mutation policy
            </CardTitle>
            <CardDescription>Explicit cutover configuration loaded at startup.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <RuntimeRow label="Mode" value={readiness.mutationMode} />
            <RuntimeRow label="Scanner" value={readiness.scanner.scope} />
            <RuntimeRow
              label="ai-analyse tag"
              value={
                readiness.scanner.aiAnalyseTagId
                  ? `#${readiness.scanner.aiAnalyseTagId}`
                  : "missing"
              }
            />
            <RuntimeRow label="Paperless metadata" value="All available fields and tags" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Cpu className="h-5 w-5 text-zinc-500" />
              Codex skills
            </CardTitle>
            <CardDescription>Fixed TypeScript-defined model and reasoning policy.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <RuntimeRow label="Model" value={readiness.codex.model} />
            <RuntimeRow label="Document" value={readiness.codex.documentReasoningEffort} />
            <RuntimeRow label="Reviewers" value={readiness.codex.catalogReviewerReasoningEffort} />
            <RuntimeRow label="Chair" value={readiness.codex.catalogChairReasoningEffort} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-5 w-5 text-zinc-500" />
              Local tools
            </CardTitle>
            <CardDescription>Read-only binary and authentication checks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <ToolRow
              label="Codex CLI"
              status={readiness.tools.codex.status}
              detail={
                readiness.tools.codex.authenticated
                  ? readiness.tools.codex.version
                  : "authentication missing"
              }
            />
            <ToolRow
              label="OCRmyPDF"
              status={readiness.tools.ocrmypdf.status}
              detail={readiness.tools.ocrmypdf.version}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Paperless capability contract</CardTitle>
          <CardDescription>
            The new pipeline fails closed when a required Paperless operation is unavailable.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {capabilities
              ? Object.entries(capabilities).map(([key, available]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 border-b border-zinc-200 pb-2 text-sm dark:border-zinc-800"
                  >
                    <span>{capabilityLabels[key as keyof PaperlessCapabilityDescriptor]}</span>
                    <Badge variant={available ? "success" : "destructive"}>
                      {available ? "Supported" : "Missing"}
                    </Badge>
                  </div>
                ))
              : "Loading capabilities…"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function RuntimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-2 last:border-0 last:pb-0 dark:border-zinc-800">
      <span className="text-zinc-500">{label}</span>
      <span className="break-all text-right font-mono text-xs">{value}</span>
    </div>
  );
}

function ToolRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: "available" | "missing";
  detail: string | null | undefined;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-zinc-200 pb-2 last:border-0 last:pb-0 dark:border-zinc-800">
      <span>{label}</span>
      <span className="text-right">
        <Badge variant={status === "available" ? "success" : "destructive"}>
          {status === "available" ? (
            <CheckCircle2 className="mr-1 h-3 w-3" />
          ) : (
            <CircleAlert className="mr-1 h-3 w-3" />
          )}
          {status}
        </Badge>
        {detail ? (
          <span className="mt-1 block max-w-48 text-xs text-zinc-500">{detail}</span>
        ) : null}
      </span>
    </div>
  );
}
