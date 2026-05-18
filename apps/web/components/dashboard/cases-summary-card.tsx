"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { AlertCircle, FileText } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { CaseMetrics } from "./types";

interface CasesSummaryCardProps {
  loading: boolean;
  caseMetrics: CaseMetrics;
}

export function CasesSummaryCard({ loading, caseMetrics }: CasesSummaryCardProps) {
  const t = useTranslations("dashboard");
  const value = (numberValue: number) => (loading ? "—" : numberValue);

  return (
    <Link href="/cases?status=open">
      <Card className="cursor-pointer transition-colors hover:border-emerald-500/50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              {t("documentCases")}
            </span>
            {caseMetrics.needsInput > 0 && (
              <Badge variant="warning">{caseMetrics.needsInput}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex min-w-0 items-center gap-3">
              <FileText className="h-5 w-5 flex-shrink-0 text-emerald-500" />
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("casesNeedingInput")}</p>
                <p className="truncate text-xs text-zinc-500">{t("casesNeedingInputDesc")}</p>
              </div>
            </div>
            <Badge variant={caseMetrics.needsInput ? "warning" : "secondary"}>
              {value(caseMetrics.needsInput)}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">{t("activeRuns")}</p>
              <p className="mt-1 font-semibold">{value(caseMetrics.activeRuns)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">{t("openCases")}</p>
              <p className="mt-1 font-semibold">{value(caseMetrics.open)}</p>
            </div>
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
              <p className="text-xs text-zinc-500">{t("readyCases")}</p>
              <p className="mt-1 font-semibold">{value(caseMetrics.ready)}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
