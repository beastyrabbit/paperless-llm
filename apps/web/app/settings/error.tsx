"use client";

import { Button } from "@repo/ui";
import { useTranslations } from "next-intl";

export default function SettingsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-3xl flex-col justify-center gap-4 px-6">
      <div role="alert" className="space-y-2">
        <h1 className="font-semibold text-2xl">{t("loadError")}</h1>
        <p className="text-muted-foreground text-sm">{error.message}</p>
      </div>
      <Button type="button" className="w-fit" onClick={reset}>
        {tCommon("retry")}
      </Button>
    </main>
  );
}
