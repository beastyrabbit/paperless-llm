"use client";

import { cn } from "@repo/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/workbench", label: "Run detail" },
  { href: "/workbench/review", label: "Review queue" },
  { href: "/workbench/failures", label: "Failures" },
] as const;

export function WorkbenchNav({ counts }: { counts?: Partial<Record<string, number>> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Workbench sections" className="flex flex-wrap gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        const count = counts?.[tab.href];
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "border-emerald-500 text-zinc-900 dark:text-zinc-100"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200",
            )}
          >
            {tab.label}
            {typeof count === "number" && count > 0 ? (
              <span className="rounded-full bg-zinc-100 px-1.5 text-xs tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                {count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
