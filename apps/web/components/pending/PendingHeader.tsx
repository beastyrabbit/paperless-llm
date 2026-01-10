"use client";

import { Loader2, RefreshCw, Ban, GitMerge, Sparkles } from "lucide-react";
import { Button, Badge, cn } from "@repo/ui";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface PendingHeaderProps {
  t: TranslationFunction;
  totalCount: number;
  cleanupCount: number;
  blockedTotal: number;
  loading: boolean;
  similarLoading: boolean;
  showCleanup: boolean;
  showBlocked: boolean;
  onFindSimilar: () => void;
  onToggleCleanup: () => void;
  onToggleBlocked: () => void;
  onRefresh: () => void;
}

export function PendingHeader({
  t, totalCount, cleanupCount, blockedTotal, loading, similarLoading,
  showCleanup, showBlocked, onFindSimilar, onToggleCleanup, onToggleBlocked, onRefresh,
}: PendingHeaderProps) {
  return (
    <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex h-16 items-center justify-between px-8">
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-zinc-500">{t("subtitle", { count: totalCount })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onFindSimilar} disabled={similarLoading || totalCount === 0} className="gap-2">
            {similarLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {t("similar.findSimilar")}
          </Button>
          <Button variant={showCleanup ? "default" : "outline"} size="sm" onClick={onToggleCleanup} className="gap-2">
            <GitMerge className="h-4 w-4" />
            {t("cleanup.toggle")}
            {cleanupCount > 0 && <Badge variant={showCleanup ? "secondary" : "outline"} className="ml-1">{cleanupCount}</Badge>}
          </Button>
          <Button variant={showBlocked ? "default" : "outline"} size="sm" onClick={onToggleBlocked} className="gap-2">
            <Ban className="h-4 w-4" />
            {t("blocked.toggle")}
            {blockedTotal > 0 && <Badge variant={showBlocked ? "secondary" : "outline"} className="ml-1">{blockedTotal}</Badge>}
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            {t("refresh")}
          </Button>
        </div>
      </div>
    </header>
  );
}
