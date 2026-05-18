"use client";

import { Badge, Button } from "@repo/ui";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";

interface DashboardHeaderProps {
  loading: boolean;
  allConnected: boolean;
  anyChecking: boolean;
  onRefresh: () => void;
}

export function DashboardHeader({
  loading,
  allConnected,
  anyChecking,
  onRefresh,
}: DashboardHeaderProps) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");

  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex h-16 items-center justify-between px-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-zinc-500">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {tCommon("refresh")}
          </Button>
          {anyChecking ? (
            <Badge variant="secondary" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
              {tCommon("checking")}
            </Badge>
          ) : allConnected ? (
            <Badge variant="success" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
              {t("allSystemsOnline")}
            </Badge>
          ) : (
            <Badge variant="destructive" className="gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {t("someServicesOffline")}
            </Badge>
          )}
        </div>
      </div>
    </header>
  );
}
