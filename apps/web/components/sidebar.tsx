"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  LayoutDashboard,
  FileText,
  Settings,
  Clock,
  Code2,
  Cog,
  Zap,
  Search,
  MessageSquare,
} from "lucide-react";
import { cn } from "@repo/ui";
import { processingApi, documentsApi, AutoProcessingStatus, QueueStats } from "@/lib/api";

const navigation = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "logs", href: "/documents", icon: FileText },
  { key: "pending", href: "/pending", icon: Clock },
  { key: "search", href: "/search", icon: Search },
  { key: "chat", href: "/chat", icon: MessageSquare },
  { key: "documentPrompts", href: "/prompts?category=document", icon: Code2 },
  { key: "systemPrompts", href: "/prompts?category=system", icon: Cog },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("navigation");
  const tCommon = useTranslations("common");

  // Auto-processing status state
  const [autoStatus, setAutoStatus] = useState<AutoProcessingStatus | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);

  const fetchStatus = useCallback(async () => {
    const [autoRes, queueRes] = await Promise.all([
      processingApi.getAutoStatus(),
      documentsApi.getQueue(),
    ]);
    if (autoRes.data) setAutoStatus(autoRes.data);
    if (queueRes.data) setQueueStats(queueRes.data);
  }, []);

  useEffect(() => {
    fetchStatus();
    // Refresh every 5 seconds
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Determine status display (check for both null and undefined)
  const isProcessing = autoStatus?.currently_processing_doc_id != null;
  const isEnabled = autoStatus?.enabled ?? false;
  const queueCount = queueStats?.total_in_pipeline ?? 0;

  // Build current full path with query params
  const currentPath = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-6 dark:border-zinc-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
          <Zap className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight">{t("appName")}</h1>
          <p className="text-xs text-zinc-500">{t("appTagline")}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = item.href.includes('?')
            ? currentPath === item.href
            : pathname === item.href;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              )}
            >
              <item.icon
                className={cn(
                  "h-5 w-5",
                  isActive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-400"
                )}
              />
              {t(item.key)}
            </Link>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                isProcessing
                  ? "bg-amber-500 animate-pulse"
                  : isEnabled
                    ? "bg-emerald-500"
                    : "bg-zinc-400"
              )}
            />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t("autoProcessing")}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {isProcessing
              ? tCommon("processing")
              : isEnabled
                ? tCommon("idle")
                : tCommon("disabled")}{" "}
            - {tCommon("inQueue", { count: queueCount })}
          </p>
        </div>
        {/* Version */}
        <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-600">
          {process.env.NEXT_PUBLIC_APP_VERSION || "dev"}
        </p>
      </div>
    </aside>
  );
}
