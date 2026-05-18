"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import { Globe, Plus, RotateCcw, Save, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Locale, localeNames, locales } from "@/i18n/config";
import { setLocale } from "@/lib/locale";
import {
  DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE,
  normalizeAliasKey,
  parseTagLanguageAliasRows,
  serializeTagLanguageAliasRows,
  type TagLanguageAliasRow,
} from "@/lib/tag-language-aliases";
import { useStringSetting, useTinyBase } from "@/lib/tinybase";

interface EditableAliasRow extends TagLanguageAliasRow {
  id: string;
}

export function LanguageTab() {
  const t = useTranslations("settings");
  const currentLocale = useLocale() as Locale;
  const promptLanguage = useStringSetting("language");
  const storedAliases = useStringSetting("tag_language.aliases.de");
  const { updateSetting } = useTinyBase();
  const [pendingUiLocale, setPendingUiLocale] = useState<Locale | null>(null);
  const nextAliasId = useRef(0);
  const toEditableRows = useCallback(
    (rows: TagLanguageAliasRow[]): EditableAliasRow[] =>
      rows.map((row) => ({ ...row, id: `alias-${nextAliasId.current++}` })),
    [],
  );
  const [aliasRows, setAliasRows] = useState<EditableAliasRow[]>(() =>
    toEditableRows(parseTagLanguageAliasRows(storedAliases || "")),
  );
  const [isSavingAliases, setIsSavingAliases] = useState(false);

  useEffect(() => {
    setAliasRows(toEditableRows(parseTagLanguageAliasRows(storedAliases || "")));
  }, [storedAliases, toEditableRows]);

  const duplicateSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of aliasRows) {
      const key = normalizeAliasKey(row.source);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [aliasRows]);

  const handleUiLocaleChange = (value: string) => {
    setPendingUiLocale(value as Locale);
    setLocale(value as Locale);
  };

  const handlePromptLanguageChange = (value: string) => {
    updateSetting("language", value);
  };

  const updateAliasRow = (index: number, patch: Partial<TagLanguageAliasRow>) => {
    setAliasRows((rows) => rows.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  const saveAliases = async (rows: TagLanguageAliasRow[] = aliasRows) => {
    setIsSavingAliases(true);
    try {
      await updateSetting("tag_language.aliases.de", serializeTagLanguageAliasRows(rows));
    } finally {
      setIsSavingAliases(false);
    }
  };

  const resetAliases = () => {
    setAliasRows(toEditableRows(DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE));
    saveAliases(DEFAULT_TAG_LANGUAGE_ALIAS_ROWS_DE);
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("language.promptLanguage")}
          </CardTitle>
          <CardDescription>{t("language.promptLanguageDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("language.title")}</Label>
            <Select value={promptLanguage || "en"} onValueChange={handlePromptLanguageChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("language.selectLanguage")} />
              </SelectTrigger>
              <SelectContent>
                {locales.map((locale) => (
                  <SelectItem key={locale} value={locale}>
                    {localeNames[locale]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500">{t("language.controlsPromptLanguage")}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("language.tagAliases")}
          </CardTitle>
          <CardDescription>{t("language.tagAliasesDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Label>{t("language.aliasSource")}</Label>
            <Label>{t("language.aliasTarget")}</Label>
            <span />
            {aliasRows.map((row, index) => {
              const isDuplicate = duplicateSources.has(normalizeAliasKey(row.source));
              return (
                <div className="contents" key={row.id}>
                  <Input
                    aria-label={t("language.aliasSource")}
                    value={row.source}
                    onChange={(event) => updateAliasRow(index, { source: event.target.value })}
                    className={isDuplicate ? "border-amber-500" : undefined}
                  />
                  <Input
                    aria-label={t("language.aliasTarget")}
                    value={row.target}
                    onChange={(event) => updateAliasRow(index, { target: event.target.value })}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={t("language.removeAlias")}
                    onClick={() => setAliasRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
          </div>
          {duplicateSources.size > 0 ? (
            <p className="text-xs text-amber-600">{t("language.duplicateAliasWarning")}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setAliasRows((rows) => [...rows, { id: `alias-${nextAliasId.current++}`, source: "", target: "" }])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              {t("language.addAlias")}
            </Button>
            <Button type="button" onClick={() => saveAliases()} disabled={isSavingAliases}>
              <Save className="mr-2 h-4 w-4" />
              {t("language.saveAliases")}
            </Button>
            <Button type="button" variant="outline" onClick={resetAliases} disabled={isSavingAliases}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {t("language.resetAliases")}
            </Button>
          </div>
          <p className="text-xs text-zinc-500">{t("language.tagAliasesNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
