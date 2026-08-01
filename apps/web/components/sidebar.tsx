"use client";

import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui";
import {
  FileText,
  FlaskConical,
  Layers,
  LayoutDashboard,
  Menu,
  MessageSquare,
  Search,
  Settings,
  TestTube2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

const navigation = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "documents", href: "/documents", icon: FileText },
  {
    key: "workbench",
    href: "/workbench",
    icon: FlaskConical,
    children: [
      { key: "workbenchReview", href: "/workbench/review" },
      { key: "workbenchFailures", href: "/workbench/failures" },
    ],
  },
  { key: "optimization", href: "/catalog/optimization", icon: Layers },
  { key: "systemTest", href: "/system-test", icon: TestTube2 },
  { key: "search", href: "/search", icon: Search },
  { key: "chat", href: "/chat", icon: MessageSquare },
  { key: "settings", href: "/settings", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();
  const t = useTranslations("navigation");
  const [mobileOpen, setMobileOpen] = useState(false);

  const content = (closeAfterNavigation = false) => (
    <>
      <div className="flex h-16 items-center gap-3 border-b border-zinc-200 px-5 dark:border-zinc-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-700 text-white">
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold tracking-tight">{t("appName")}</h1>
          <p className="truncate text-xs text-zinc-500">{t("appTagline")}</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="Primary navigation">
        {navigation.map((item) => {
          const children = "children" in item ? item.children : undefined;
          const active =
            pathname === item.href ||
            Boolean(children?.some((child) => pathname === child.href)) ||
            (item.href !== "/" && pathname.startsWith(`${item.href}/`));
          return (
            <div key={item.key}>
              <Link
                href={item.href}
                aria-current={pathname === item.href ? "page" : undefined}
                onClick={() => {
                  if (closeAfterNavigation) setMobileOpen(false);
                }}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {t(item.key)}
              </Link>
              {children ? (
                <div className="mt-1 ml-5 space-y-0.5 border-l border-zinc-200 pl-3 dark:border-zinc-800">
                  {children.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.key}
                        href={child.href}
                        aria-current={childActive ? "page" : undefined}
                        onClick={() => {
                          if (closeAfterNavigation) setMobileOpen(false);
                        }}
                        className={cn(
                          "block rounded-md px-2 py-1.5 text-xs transition-colors",
                          childActive
                            ? "font-medium text-emerald-700 dark:text-emerald-300"
                            : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-200",
                        )}
                      >
                        {t(child.key)}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-center font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
          {process.env.NEXT_PUBLIC_APP_VERSION || "dev"}
        </p>
      </div>
    </>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 flex-col border-r border-zinc-200 bg-white md:flex dark:border-zinc-800 dark:bg-zinc-950">
        {content()}
      </aside>

      <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 bg-white px-4 md:hidden dark:border-zinc-800 dark:bg-zinc-950">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{t("appName")}</p>
            <p className="truncate text-xs text-zinc-500">{t("appTagline")}</p>
          </div>
        </div>
        <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open navigation">
              <Menu className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="top-0 left-0 flex h-dvh w-72 max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0">
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <DialogDescription className="sr-only">
              Navigate between Paperless-first application pages.
            </DialogDescription>
            {content(true)}
          </DialogContent>
        </Dialog>
      </header>
    </>
  );
}
