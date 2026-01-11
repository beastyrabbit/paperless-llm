"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { localeNames, type Locale } from "@/i18n/config";
import {
  Tag,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Languages,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
} from "@repo/ui";

interface PaperlessTag {
  id: number;
  name: string;
  color: string;
  matching_algorithm: number;
  document_count: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function AiTagsTab() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const currentLocale = useLocale() as Locale;

  // UI state
  const [allTags, setAllTags] = useState<PaperlessTag[]>([]);
  const [selectedAiTags, setSelectedAiTags] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_hasChanges, setHasChanges] = useState(false);

  // Tag descriptions and translations
  const [tagDescriptions, setTagDescriptions] = useState<Record<number, string>>({});
  const [tagTranslations, setTagTranslations] = useState<Record<number, Record<string, string>>>({});
  const [tagTranslatedLangs, setTagTranslatedLangs] = useState<Record<number, string[]>>({});
  const [expandedTagId, setExpandedTagId] = useState<number | null>(null);
  const [_tagDescriptionsHasChanges, setTagDescriptionsHasChanges] = useState(false);

  // Action loading states
  const [optimizingTagId, setOptimizingTagId] = useState<number | null>(null);
  const [translatingTagId, setTranslatingTagId] = useState<number | null>(null);

  const fetchAiTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setAllTags(data.tags || []);
      setSelectedAiTags(data.selected_tag_ids || []);
      setHasChanges(false);

      // Also fetch tag descriptions (metadata)
      try {
        const metaResponse = await fetch(`${API_BASE}/api/metadata/tags`);
        if (metaResponse.ok) {
          const metaData = await metaResponse.json();
          const descriptions: Record<number, string> = {};
          const tagsWithDescriptions: number[] = [];
          for (const meta of metaData) {
            if (meta.description) {
              descriptions[meta.paperless_tag_id] = meta.description;
              tagsWithDescriptions.push(meta.paperless_tag_id);
            }
          }
          setTagDescriptions(descriptions);

          // Fetch translations for tags with descriptions
          const translations: Record<number, Record<string, string>> = {};
          const translatedLangs: Record<number, string[]> = {};

          for (const tagId of tagsWithDescriptions) {
            try {
              const transResponse = await fetch(
                `${API_BASE}/api/metadata/tags/${tagId}/translations`
              );
              if (transResponse.ok) {
                const transData = await transResponse.json();
                if (transData.translated_langs && transData.translated_langs.length > 0) {
                  translations[tagId] = transData.translations;
                  translatedLangs[tagId] = transData.translated_langs;
                }
              }
            } catch {
              // Translations are optional, continue
            }
          }
          setTagTranslations(translations);
          setTagTranslatedLangs(translatedLangs);
        }
      } catch {
        // Metadata is optional, don't fail if unavailable
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAiTags();
  }, [fetchAiTags]);

  const saveTagSelection = async (newSelection: number[]) => {
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_tag_ids: newSelection }),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      setHasChanges(false);
    } catch (err) {
      console.error("Failed to save AI tags selection:", err);
      setError(err instanceof Error ? err.message : "Failed to save selection");
    }
  };

  const toggleAiTag = (tagId: number) => {
    const newSelection = selectedAiTags.includes(tagId)
      ? selectedAiTags.filter((id) => id !== tagId)
      : [...selectedAiTags, tagId];
    setSelectedAiTags(newSelection);
    saveTagSelection(newSelection);
  };

  const selectAll = () => {
    const allIds = allTags.map((tg) => tg.id);
    setSelectedAiTags(allIds);
    saveTagSelection(allIds);
  };

  const clearSelection = () => {
    setSelectedAiTags([]);
    saveTagSelection([]);
  };

  // Optimize a tag description using AI
  const optimizeTagDescription = async (tagId: number, tagName: string) => {
    const description =
      tagTranslations[tagId]?.[currentLocale] ?? tagDescriptions[tagId];
    if (!description?.trim()) return;

    setOptimizingTagId(tagId);
    try {
      const response = await fetch(
        `${API_BASE}/api/metadata/tags/${tagId}/optimize-description`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            tag_name: tagName,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setTagTranslations((prev) => ({
          ...prev,
          [tagId]: {
            ...prev[tagId],
            [currentLocale]: data.optimized,
          },
        }));
        setTagTranslatedLangs((prev) => {
          const existing = prev[tagId] || [];
          if (!existing.includes(currentLocale)) {
            return { ...prev, [tagId]: [...existing, currentLocale] };
          }
          return prev;
        });
        setTagDescriptionsHasChanges(true);
      }
    } catch (error) {
      console.error("Failed to optimize description:", error);
    } finally {
      setOptimizingTagId(null);
    }
  };

  // Translate a tag description to all other languages
  const translateTagDescription = async (tagId: number) => {
    const description =
      tagTranslations[tagId]?.[currentLocale] ?? tagDescriptions[tagId];
    if (!description?.trim()) return;

    setTranslatingTagId(tagId);
    try {
      const response = await fetch(
        `${API_BASE}/api/metadata/tags/${tagId}/translate-description`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description,
            source_lang: currentLocale,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const newTranslations: Record<string, string> = {
          ...tagTranslations[tagId],
          [currentLocale]: description,
        };
        for (const t of data.translations) {
          newTranslations[t.lang] = t.text;
        }
        setTagTranslations((prev) => ({
          ...prev,
          [tagId]: newTranslations,
        }));
        setTagTranslatedLangs((prev) => ({
          ...prev,
          [tagId]: Object.keys(newTranslations),
        }));
        setTagDescriptionsHasChanges(true);
      }
    } catch (error) {
      console.error("Failed to translate description:", error);
    } finally {
      setTranslatingTagId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" />
                {t("aiTags.title")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("aiTags.description")}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAiTags}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {tCommon("refresh")}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{tCommon("error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && allTags.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-500">{t("aiTags.loadingTags")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Tags */}
      {!loading && allTags.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
              <Tag className="h-12 w-12 text-zinc-300" />
              <p className="text-lg font-medium">{t("aiTags.noTagsFound")}</p>
              <p className="text-sm">{t("aiTags.noTagsDesc")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tags List */}
      {allTags.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("aiTags.availableTags")}</CardTitle>
                <CardDescription>
                  {t("aiTags.tagsEnabled", {
                    selected: selectedAiTags.length,
                    total: allTags.length,
                  })}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {tCommon("selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  {tCommon("clear")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {allTags.map((tag) => (
                <div key={tag.id} className="py-3 first:pt-0 last:pb-0 -mx-4 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors cursor-pointer ${
                          selectedAiTags.includes(tag.id)
                            ? "bg-emerald-600 border-emerald-600"
                            : "border-zinc-300 dark:border-zinc-600"
                        }`}
                        onClick={() => toggleAiTag(tag.id)}
                      >
                        {selectedAiTags.includes(tag.id) && (
                          <Check className="h-3 w-3 text-white" />
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div
                          className="h-8 w-8 rounded-full flex items-center justify-center"
                          style={{
                            backgroundColor: tag.color ? `${tag.color}20` : undefined,
                          }}
                        >
                          <Tag
                            className="h-4 w-4"
                            style={{ color: tag.color || undefined }}
                          />
                        </div>
                        <div>
                          <p className="font-medium">{tag.name}</p>
                          <p className="text-sm text-zinc-500">
                            {t("aiTags.documentCount", { count: tag.document_count })}
                            {tagDescriptions[tag.id] && (
                              <span className="ml-2 text-emerald-600">
                                • {t("aiTags.hasDescription")}
                              </span>
                            )}
                            {tagTranslatedLangs[tag.id]?.length > 1 && (
                              <span className="ml-2 text-blue-600">
                                • {t("aiTags.isTranslated")}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={selectedAiTags.includes(tag.id) ? "default" : "secondary"}
                        className={selectedAiTags.includes(tag.id) ? "bg-emerald-600" : ""}
                      >
                        {selectedAiTags.includes(tag.id)
                          ? t("aiTags.aiEnabled")
                          : t("aiTags.aiDisabled")}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setExpandedTagId(expandedTagId === tag.id ? null : tag.id)
                        }
                        className="h-8 w-8 p-0"
                      >
                        {expandedTagId === tag.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  {expandedTagId === tag.id && (
                    <ExpandedTagDescription
                      tag={tag}
                      currentLocale={currentLocale}
                      tagTranslations={tagTranslations}
                      tagDescriptions={tagDescriptions}
                      tagTranslatedLangs={tagTranslatedLangs}
                      optimizingTagId={optimizingTagId}
                      translatingTagId={translatingTagId}
                      onOptimize={optimizeTagDescription}
                      onTranslate={translateTagDescription}
                      onDescriptionChange={(tagId, lang, text) => {
                        setTagTranslations((prev) => ({
                          ...prev,
                          [tagId]: {
                            ...prev[tagId],
                            [lang]: text,
                          },
                        }));
                        setTagTranslatedLangs((prev) => {
                          const existing = prev[tagId] || [];
                          if (!existing.includes(lang)) {
                            return { ...prev, [tagId]: [...existing, lang] };
                          }
                          return prev;
                        });
                        setTagDescriptionsHasChanges(true);
                      }}
                      t={t}
                    />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface ExpandedTagDescriptionProps {
  tag: PaperlessTag;
  currentLocale: Locale;
  tagTranslations: Record<number, Record<string, string>>;
  tagDescriptions: Record<number, string>;
  tagTranslatedLangs: Record<number, string[]>;
  optimizingTagId: number | null;
  translatingTagId: number | null;
  onOptimize: (tagId: number, tagName: string) => void;
  onTranslate: (tagId: number) => void;
  onDescriptionChange: (tagId: number, lang: string, text: string) => void;
  t: ReturnType<typeof useTranslations>;
}

function ExpandedTagDescription({
  tag,
  currentLocale,
  tagTranslations,
  tagDescriptions,
  tagTranslatedLangs,
  optimizingTagId,
  translatingTagId,
  onOptimize,
  onTranslate,
  onDescriptionChange,
  t,
}: ExpandedTagDescriptionProps) {
  const currentValue =
    tagTranslations[tag.id]?.[currentLocale] ?? tagDescriptions[tag.id] ?? "";
  const otherLangs =
    tagTranslatedLangs[tag.id]?.filter((l) => l !== currentLocale) ?? [];

  return (
    <div className="mt-3 pl-9">
      <div className="flex items-center justify-between mb-2">
        <div>
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t("aiTags.descriptionLabel")}
            <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">
              ({t("aiTags.editingIn", { lang: localeNames[currentLocale] })})
            </span>
          </label>
          <p className="text-xs text-zinc-500">{t("aiTags.descriptionHint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!currentValue?.trim() || optimizingTagId === tag.id}
            onClick={() => onOptimize(tag.id, tag.name)}
            title={t("aiTags.optimizeDescription")}
          >
            {optimizingTagId === tag.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            <span className="ml-1">{t("aiTags.optimize")}</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!currentValue?.trim() || translatingTagId === tag.id}
            onClick={() => onTranslate(tag.id)}
            title={t("aiTags.translateDescription")}
          >
            {translatingTagId === tag.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Languages className="h-4 w-4" />
            )}
            <span className="ml-1">{t("aiTags.translate")}</span>
          </Button>
        </div>
      </div>
      <textarea
        className="w-full p-2 text-sm border rounded-md bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        rows={2}
        placeholder={t("aiTags.descriptionPlaceholder")}
        value={currentValue}
        onChange={(e) => onDescriptionChange(tag.id, currentLocale, e.target.value)}
      />
      {/* Show other available translations */}
      {otherLangs.length > 0 && (
        <p className="mt-2 text-xs text-zinc-500">
          {t("aiTags.alsoAvailableIn", {
            langs: otherLangs
              .map((l) => localeNames[l as Locale] || l)
              .join(", "),
          })}
        </p>
      )}
    </div>
  );
}
