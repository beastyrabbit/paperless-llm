"use client";

import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DashboardErrorKey } from "./types";

interface DashboardErrorBannerProps {
  errorKey: DashboardErrorKey | null;
}

export function DashboardErrorBanner({ errorKey }: DashboardErrorBannerProps) {
  const t = useTranslations("dashboard");

  if (!errorKey) return null;

  return (
    <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-400">
      <div className="flex items-center gap-2">
        <AlertCircle className="h-4 w-4" />
        {t(errorKey)}
      </div>
    </div>
  );
}
