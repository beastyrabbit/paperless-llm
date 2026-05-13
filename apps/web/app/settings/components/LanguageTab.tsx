"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { type Locale, localeNames, locales } from "@/i18n/config";
import { setLocale } from "@/lib/locale";

export function LanguageTab() {
  const t = useTranslations("settings");
  const currentLocale = useLocale() as Locale;
  const [pendingUiLocale, setPendingUiLocale] = useState<Locale | null>(null);

  const handleUiLocaleChange = (value: string) => {
    setPendingUiLocale(value as Locale);
    setLocale(value as Locale);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("language.uiLanguage")}
          </CardTitle>
          <CardDescription>{t("language.uiLanguageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("language.title")}</Label>
            <Select value={pendingUiLocale ?? currentLocale} onValueChange={handleUiLocaleChange}>
              <SelectTrigger>
                <SelectValue placeholder={localeNames[currentLocale]} />
              </SelectTrigger>
              <SelectContent>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {localeNames[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500">{t("language.controlsUiLanguage")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
