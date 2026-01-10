"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/locale";
import {
  Globe,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
} from "@repo/ui";
import { useTinyBase, useStringSetting } from "@/lib/tinybase";

interface LanguageInfo {
  code: string;
  name: string;
  prompt_count: number;
  is_complete: boolean;
}

interface TranslationResult {
  success: boolean;
  total: number;
  successful: number;
  failed: number;
  results?: Array<{ prompt_name?: string; success: boolean; error?: string }>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function LanguageTab() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const { updateSetting } = useTinyBase();

  // TinyBase settings
  const promptLanguage = useStringSetting("prompt_language");

  // UI state
  const [pendingUiLocale, setPendingUiLocale] = useState<Locale | null>(null);
  const [availableLanguages, setAvailableLanguages] = useState<LanguageInfo[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);

  // Translation state
  const [translationSourceLang, setTranslationSourceLang] = useState("en");
  const [translationTargetLang, setTranslationTargetLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);

  const fetchLanguages = useCallback(async () => {
    setLanguagesLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/prompts/languages`);
      if (response.ok) {
        const data = await response.json();
        setAvailableLanguages(data.languages || []);
      }
    } catch (error) {
      console.error("Failed to fetch languages:", error);
    } finally {
      setLanguagesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLanguages();
  }, [fetchLanguages]);

  const translatePrompts = async () => {
    if (!translationTargetLang || translationSourceLang === translationTargetLang) return;

    setTranslating(true);
    setTranslationResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/translation/translate/prompts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_lang: translationSourceLang,
          target_lang: translationTargetLang,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setTranslationResult(data);
        // Refresh languages list to show new prompt count
        fetchLanguages();
      } else {
        const errorText = await response.text();
        setTranslationResult({
          success: false,
          total: 0,
          successful: 0,
          failed: 1,
          results: [{ success: false, error: errorText }],
        });
      }
    } catch (error) {
      setTranslationResult({
        success: false,
        total: 0,
        successful: 0,
        failed: 1,
        results: [{ success: false, error: String(error) }],
      });
    } finally {
      setTranslating(false);
    }
  };

  const handleUiLocaleChange = (value: string) => {
    setPendingUiLocale(value as Locale);
    // Apply the locale change immediately
    setLocale(value as Locale);
  };

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
              <div className="flex gap-2">
                <Select
                  value={promptLanguage}
                  onValueChange={(v) => updateSetting("prompt_language", v)}
                  disabled={languagesLoading}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={t("language.selectLanguage")} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        <div className="flex items-center gap-2">
                          <span>{lang.name}</span>
                          {!lang.is_complete && (
                            <Badge variant="outline" className="text-xs">
                              {tCommon("prompts", { count: lang.prompt_count })}
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={fetchLanguages}
                  disabled={languagesLoading}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${languagesLoading ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                {t("language.controlsPromptLanguage")}
              </p>
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
                          promptLanguage === lang.code
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
                              {tCommon("prompts", { count: lang.prompt_count })}
                            </p>
                          </div>
                        </div>
                        <Badge
                          variant={lang.is_complete ? "default" : "secondary"}
                          className={lang.is_complete ? "bg-emerald-600" : ""}
                        >
                          {lang.is_complete ? tCommon("complete") : tCommon("partial")}
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
                onValueChange={handleUiLocaleChange}
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
              <p className="text-xs text-zinc-500">
                {t("language.controlsUiLanguage")}
              </p>
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
              <Select
                value={translationSourceLang}
                onValueChange={setTranslationSourceLang}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableLanguages
                    .filter((l) => l.prompt_count > 0)
                    .map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.name} ({lang.prompt_count}{" "}
                        {tCommon("prompts", { count: lang.prompt_count }).split(" ")[0]})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t("language.targetLanguage")}</Label>
              <Select
                value={translationTargetLang}
                onValueChange={setTranslationTargetLang}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("language.selectTarget")} />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { code: "en", name: "English" },
                    { code: "de", name: "German" },
                    { code: "fr", name: "French" },
                    { code: "es", name: "Spanish" },
                    { code: "it", name: "Italian" },
                    { code: "pt", name: "Portuguese" },
                    { code: "nl", name: "Dutch" },
                    { code: "pl", name: "Polish" },
                  ]
                    .filter((l) => l.code !== translationSourceLang)
                    .map((lang) => (
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
                  <AlertTitle>{tCommon("success")}</AlertTitle>
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
                  <AlertTitle>{tCommon("error")}</AlertTitle>
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
