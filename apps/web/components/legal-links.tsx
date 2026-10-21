"use client";

import { useLocale, useTranslations } from "next-intl";
import { legalPaths } from "@/lib/legal/shared";

export function LegalLinks() {
  const locale = useLocale() === "de" ? "de" : "en";
  const t = useTranslations("legal");

  return (
    <footer className="shrink-0 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <nav aria-label={t("navigation")} className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <a
          className="text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
          href={legalPaths[locale].notice}
        >
          {t("notice")}
        </a>
        <a
          className="text-emerald-600 underline underline-offset-4 dark:text-emerald-400"
          href={legalPaths[locale].privacy}
        >
          {t("privacy")}
        </a>
      </nav>
    </footer>
  );
}
