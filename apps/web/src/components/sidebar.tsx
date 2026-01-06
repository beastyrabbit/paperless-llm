import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  DashboardSquare01Icon,
  File01Icon,
  Settings01Icon,
  Clock01Icon,
  SourceCodeIcon,
  Zap01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@paperless-llm/ui/lib/utils";

const navigation = [
  { key: "dashboard", href: "/", icon: DashboardSquare01Icon },
  { key: "documents", href: "/documents", icon: File01Icon },
  { key: "pending", href: "/pending", icon: Clock01Icon },
  { key: "prompts", href: "/prompts", icon: SourceCodeIcon },
  { key: "settings", href: "/settings", icon: Settings01Icon },
] as const;

export function Sidebar() {
  const { pathname } = useLocation();
  const { t } = useTranslation();

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-6 dark:border-zinc-800">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
          <HugeiconsIcon icon={Zap01Icon} className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight">{t("navigation.appName")}</h1>
          <p className="text-xs text-zinc-500">{t("navigation.appTagline")}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.key}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              )}
            >
              <HugeiconsIcon
                icon={item.icon}
                className={cn(
                  "h-5 w-5",
                  isActive
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-zinc-400"
                )}
              />
              {t(`navigation.${item.key}`)}
            </Link>
          );
        })}
      </nav>

      {/* Status Footer */}
      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t("navigation.autoProcessing")}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {t("common.idle")} - {t("common.inQueue", { count: 0 })}
          </p>
        </div>
      </div>
    </aside>
  );
}
