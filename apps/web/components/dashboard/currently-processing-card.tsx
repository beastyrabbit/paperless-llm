"use client";

import { Badge, Button, Card, CardContent } from "@repo/ui";
import { Brain, Loader2, PlayCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { AutoProcessingStatus, OllamaStatus } from "@/lib/api";

interface CurrentlyProcessingCardProps {
  autoStatus: AutoProcessingStatus | null;
  ollamaStatus: OllamaStatus | null;
}

export function CurrentlyProcessingCard({
  autoStatus,
  ollamaStatus,
}: CurrentlyProcessingCardProps) {
  const t = useTranslations("dashboard");

  if (!autoStatus?.currently_processing_doc_id) return null;

  return (
    <Card className="mb-6 border-emerald-500/50 bg-emerald-50/50 dark:bg-emerald-950/20">
      <CardContent className="py-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/50">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                {t("currentlyProcessing")}
              </span>
              {ollamaStatus?.running && (
                <Badge variant="secondary" className="ml-2 gap-1">
                  <Brain className="h-3 w-3" />
                  {t("ollamaActive")}
                </Badge>
              )}
            </div>
            <p
              className="truncate text-base font-semibold"
              title={autoStatus.currently_processing_doc_title ?? undefined}
            >
              {autoStatus.currently_processing_doc_title ||
                `Document #${autoStatus.currently_processing_doc_id}`}
            </p>
            <div className="mt-0.5 flex items-center gap-3">
              {autoStatus.current_step && (
                <span className="flex items-center text-sm text-zinc-500">
                  {t("step")}:{" "}
                  <Badge variant="secondary" className="ml-1">
                    {autoStatus.current_step}
                  </Badge>
                </span>
              )}
              {ollamaStatus?.running && ollamaStatus.models[0] && (
                <span className="flex items-center text-sm text-zinc-500">
                  {t("model")}:{" "}
                  <Badge variant="outline" className="ml-1">
                    {ollamaStatus.models[0].name}
                  </Badge>
                </span>
              )}
            </div>
          </div>
          <Link href={`/documents/${autoStatus.currently_processing_doc_id}`}>
            <Button variant="outline" size="sm">
              {t("viewDocument")}
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
