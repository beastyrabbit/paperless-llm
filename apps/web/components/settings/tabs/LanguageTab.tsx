"use client";

import React from "react";
import { Globe, Loader2, AlertCircle, CheckCircle2, Check } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Alert,
  AlertDescription,
  AlertTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@repo/ui";
import type { Locale } from "@/i18n/config";
import type { Settings, LanguageInfo } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface TranslationResult {
  success: boolean;
  total: number;
  successful: number;
  failed: number;
  results?: Array<{ prompt_name?: string; success: boolean; error?: string }>;
}

const SUPPORTED_TRANSLATION_LANGUAGES = [
  { code: "en", name: "English" },
  { code: "de", name: "German" },
  { code: "fr", name: "French" },
  { code: "es", name: "Spanish" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "pl", name: "Polish" },
];

interface LanguageTabProps {
  t: TranslationFunction;
  currentLocale: Locale;
  locales: readonly Locale[];
  localeNames: Record<Locale, string>;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  pendingUiLocale: Locale | null;
  setPendingUiLocale: React.Dispatch<React.SetStateAction<Locale | null>>;
  availableLanguages: LanguageInfo[];
  languagesLoading: boolean;
  translationSourceLang: string;
  setTranslationSourceLang: React.Dispatch<React.SetStateAction<string>>;
  translationTargetLang: string;
  setTranslationTargetLang: React.Dispatch<React.SetStateAction<string>>;
  translating: boolean;
  translationResult: TranslationResult | null;
  translatePrompts: () => Promise<void>;
}

export function LanguageTab({
  t,
  currentLocale,
  locales,
  localeNames,
  settings,
  updateSetting,
  pendingUiLocale,
  setPendingUiLocale,
  availableLanguages,
  languagesLoading,
  translationSourceLang,
  setTranslationSourceLang,
  translationTargetLang,
  setTranslationTargetLang,
  translating,
  translationResult,
  translatePrompts,
}: LanguageTabProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Prompt Language */}
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
              <Select
                value={settings.prompt_language}
                onValueChange={(v) => updateSetting("prompt_language", v)}
                disabled={languagesLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("language.selectLanguage")} />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      <div className="flex items-center gap-2">
                        <span>{lang.name}</span>
                        {!lang.is_complete && (
                          <Badge variant="outline" className="text-xs">
                            {lang.prompt_count} prompts
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-zinc-500">{t("language.controlsPromptLanguage")}</p>
            </div>

            {/* Available Languages Info */}
            {availableLanguages.length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {t("language.availableLanguages")}
                  </Label>
                  <div className="grid gap-2">
                    {availableLanguages.map((lang) => (
                      <div
                        key={lang.code}
                        className={`flex items-center justify-between rounded-lg border p-3 ${
                          settings.prompt_language === lang.code
                            ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
                            : ""
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={`h-8 w-8 rounded-full flex items-center justify-center ${
                              lang.is_complete
                                ? "bg-emerald-100 dark:bg-emerald-900/30"
                                : "bg-amber-100 dark:bg-amber-900/30"
                            }`}
                          >
                            {lang.is_complete ? (
                              <Check className="h-4 w-4 text-emerald-600" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-amber-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{lang.name}</p>
                            <p className="text-xs text-zinc-500">
                              {lang.prompt_count} prompts
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={lang.is_complete ? "default" : "secondary"}
                          className={lang.is_complete ? "bg-emerald-600" : ""}
                        >
                          {lang.is_complete ? "Complete" : "Partial"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* UI Language */}
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
              <Select
                value={pendingUiLocale ?? currentLocale}
                onValueChange={(value) => setPendingUiLocale(value as Locale)}
              >
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

      {/* Prompt Translation */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            {t("language.translatePrompts")}
          </CardTitle>
          <CardDescription>{t("language.translatePromptsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("language.sourceLanguage")}</Label>
              <Select value={translationSourceLang} onValueChange={setTranslationSourceLang}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages
                    .filter((l) => l.prompt_count > 0)
                    .map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.prompt_count} prompts)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("language.targetLanguage")}</Label>
              <Select value={translationTargetLang} onValueChange={setTranslationTargetLang}>
                <SelectTrigger>
                  <SelectValue placeholder={t("language.selectTarget")} />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_TRANSLATION_LANGUAGES.filter(
                    (l) => l.code !== translationSourceLang
                  ).map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={translatePrompts}
                disabled={
                  translating ||
                  !translationTargetLang ||
                  translationSourceLang === translationTargetLang
                }
                className="w-full bg-emerald-600 hover:bg-emerald-700"
              >
                {translating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="mr-2 h-4 w-4" />
                )}
                {t("language.translateAll")}
              </Button>
            </div>
          </div>

          {/* Translation Result */}
          {translationResult && (
            <div className="mt-4">
              {translationResult.success ? (
                <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>
                    {t("language.translationSuccess", {
                      successful: translationResult.successful,
                      total: translationResult.total,
                    })}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Error</AlertTitle>
                  <AlertDescription>
                    {t("language.translationFailed", {
                      failed: translationResult.failed,
                    })}
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <p className="text-xs text-zinc-500">{t("language.translateNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
