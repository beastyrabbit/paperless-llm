"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { CheckCircle2, Clock, Database, FileText, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import type { QueueStats } from "@/lib/api";
import type { CaseMetrics } from "./types";

interface StatsGridProps {
  loading: boolean;
  stats: QueueStats | null;
  caseMetrics: CaseMetrics;
}

export function StatsGrid({ loading, stats, caseMetrics }: StatsGridProps) {
  const t = useTranslations("dashboard");
  const value = (numberValue: number | undefined) => (loading ? "—" : (numberValue ?? 0));

  return (
    <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-500">{t("totalDocuments")}</CardTitle>
          <Database className="h-4 w-4 text-zinc-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{value(stats?.total_documents)}</div>
          <p className="mt-1 text-xs text-zinc-500">{t("inPaperless")}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-500">{t("inPipeline")}</CardTitle>
          <Clock className="h-4 w-4 text-amber-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{value(stats?.total_in_pipeline)}</div>
          <p className="mt-1 text-xs text-zinc-500">{t("documentsBeingProcessed")}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-500">{t("needsInput")}</CardTitle>
          <FileText className="h-4 w-4 text-blue-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{value(caseMetrics.needsInput)}</div>
          <p className="mt-1 text-xs text-zinc-500">{t("openQuestions")}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-500">{t("fullyProcessed")}</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold text-emerald-600">{value(caseMetrics.done)}</div>
          <p className="mt-1 text-xs text-zinc-500">{t("completedCases")}</p>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-zinc-500">{t("failedCases")}</CardTitle>
          <TrendingUp className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{value(caseMetrics.failed)}</div>
          <p className="mt-1 text-xs text-zinc-500">{t("caseFailures")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
