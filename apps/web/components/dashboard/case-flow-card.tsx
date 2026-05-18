"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle } from "@repo/ui";
import { Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CaseMetrics } from "./types";

interface CaseFlowCardProps {
  caseMetrics: CaseMetrics;
}

export function CaseFlowCard({ caseMetrics }: CaseFlowCardProps) {
  const t = useTranslations("dashboard");
  const maxPhaseCount = Math.max(1, ...Object.values(caseMetrics.phaseCounts));
  const casePhaseSteps = [
    { name: t("casePhaseNew"), count: caseMetrics.phaseCounts.new, color: "bg-zinc-500" },
    { name: t("ocr"), count: caseMetrics.phaseCounts.ocr, color: "bg-blue-500" },
    {
      name: t("casePhaseMetadata"),
      count: caseMetrics.phaseCounts.metadata,
      color: "bg-violet-500",
    },
    { name: t("casePhaseIndex"), count: caseMetrics.phaseCounts.index, color: "bg-emerald-500" },
    { name: t("casePhaseDone"), count: caseMetrics.phaseCounts.done, color: "bg-green-500" },
    { name: t("casePhaseFailed"), count: caseMetrics.phaseCounts.failed, color: "bg-red-500" },
  ];

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-emerald-500" />
          {t("caseFlow")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {casePhaseSteps.map((step) => (
            <div
              key={step.name}
              className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{step.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {step.count}
                </Badge>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className={`h-full ${step.color} transition-all duration-500`}
                  style={{ width: `${Math.round((step.count / maxPhaseCount) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
