"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  Play,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import {
  getCaseListItemModel,
  getCaseListMetrics,
  parseCasesStatusFilter,
} from "@/components/cases/case-list-model";
import { useCasesData } from "./use-cases-data";

const statusTone: Record<string, string> = {
  queued: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  needs_input: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  running: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ready: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  idle: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
};

function CasesPageContent() {
  const searchParams = useSearchParams();
  const t = useTranslations("cases");
  const tCommon = useTranslations("common");
  const status = parseCasesStatusFilter(searchParams.get("status"));
  const { cases, loading, error, refresh } = useCasesData(status);
  const { needsInputCount, queuedCount, firstNeedsInputCase } = getCaseListMetrics(cases);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex items-center justify-between px-8 py-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-sm text-zinc-500">{t("subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={refresh} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Play className="mr-2 h-4 w-4" />
              )}
              {tCommon("refresh")}
            </Button>
            <Button disabled={!firstNeedsInputCase} asChild={!!firstNeedsInputCase}>
              {firstNeedsInputCase ? (
                <Link href={`/documents/${firstNeedsInputCase.docId}?review=1#case`}>
                  <ListChecks className="mr-2 h-4 w-4" />
                  {t("fastReview")}
                </Link>
              ) : (
                <>
                  <ListChecks className="mr-2 h-4 w-4" />
                  {t("fastReview")}
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="p-8">
        <div className="mb-5 flex flex-wrap gap-2">
          <Button asChild variant={status === "open" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=open">{t("statusOpen")}</Link>
          </Button>
          <Button asChild variant={status === "queued" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=queued">
              {t("statusQueued")}
              {queuedCount > 0 && <Badge className="ml-2">{queuedCount}</Badge>}
            </Link>
          </Button>
          <Button asChild variant={status === "needs_input" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=needs_input">
              {t("statusNeedsInput")}
              {needsInputCount > 0 && <Badge className="ml-2">{needsInputCount}</Badge>}
            </Link>
          </Button>
          <Button asChild variant={status === "running" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=running">{t("statusRunning")}</Link>
          </Button>
          <Button asChild variant={status === "failed" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=failed">{t("statusFailed")}</Link>
          </Button>
          <Button asChild variant={status === "done" ? "default" : "outline"} size="sm">
            <Link href="/cases?status=done">{t("statusDone")}</Link>
          </Button>
        </div>

        {error && (
          <div
            className="mb-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center" role="status" aria-live="polite">
            <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
            <span className="sr-only">{tCommon("loading")}</span>
          </div>
        ) : cases.length === 0 ? (
          <div className="rounded-md border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            {t("noCases")}
          </div>
        ) : (
          <div className="grid gap-3">
            {cases.map((caseRecord) => {
              const itemModel = getCaseListItemModel(caseRecord);
              return (
                <Card key={itemModel.caseRecord.id} className="rounded-md">
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <FileText className="h-4 w-4 text-zinc-500" />
                          <span className="truncate">{itemModel.caseRecord.docTitle}</span>
                        </CardTitle>
                        <p className="mt-1 text-xs text-zinc-500">
                          {t("documentPhase", {
                            id: itemModel.caseRecord.docId,
                            phase: itemModel.caseRecord.phase,
                          })}
                          {itemModel.caseRecord.automationStatus === "queued"
                            ? t("queuedForRun")
                            : ""}
                        </p>
                      </div>
                      <Badge
                        className={
                          statusTone[itemModel.caseRecord.automationStatus] ?? statusTone.idle
                        }
                      >
                        {t("automationStatus", {
                          status: itemModel.caseRecord.automationStatus.replaceAll("_", " "),
                        })}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-0">
                    <div className="flex gap-4 text-sm text-zinc-600 dark:text-zinc-300">
                      <span className="flex items-center gap-1.5">
                        <MessageSquare className="h-4 w-4" />
                        {t("turns", { count: itemModel.caseRecord.transcript.length })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4" />
                        {t("openQuestions", { count: itemModel.openQuestions })}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        {t("answered", { count: itemModel.caseRecord.answers.length })}
                      </span>
                    </div>
                    <Link href={itemModel.href}>
                      <Button size="sm">{t("openCase")}</Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

export default function CasesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="size-7 animate-spin text-emerald-500" />
        </div>
      }
    >
      <CasesPageContent />
    </Suspense>
  );
}
