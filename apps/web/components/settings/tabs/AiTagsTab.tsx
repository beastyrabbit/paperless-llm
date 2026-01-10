"use client";

import React from "react";
import {
  Tag,
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
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";
import type { Locale } from "@/i18n/config";
import { localeNames } from "@/i18n/config";
import type { PaperlessTag } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface AiTagsTabProps {
  t: TranslationFunction;
  currentLocale: Locale;
  allTags: PaperlessTag[];
  selectedAiTags: number[];
  aiTagsLoading: boolean;
  aiTagsError: string | null;
  aiTagsHasChanges: boolean;
  toggleAiTag: (tagId: number) => void;
  selectAllAiTags: () => void;
  deselectAllAiTags: () => void;
  tagDescriptions: Record<number, string>;
  setTagDescriptions: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  expandedTagId: number | null;
  setExpandedTagId: React.Dispatch<React.SetStateAction<number | null>>;
  tagDescriptionsHasChanges: boolean;
  setTagDescriptionsHasChanges: React.Dispatch<React.SetStateAction<boolean>>;
  tagTranslations: Record<number, Record<string, string>>;
  setTagTranslations: React.Dispatch<React.SetStateAction<Record<number, Record<string, string>>>>;
  tagTranslatedLangs: Record<number, string[]>;
  optimizingTagId: number | null;
  translatingTagId: number | null;
  optimizeTagDescription: (tagId: number, tagName: string) => Promise<void>;
  translateTagDescription: (tagId: number) => Promise<void>;
}

export function AiTagsTab({
  t,
  currentLocale,
  allTags,
  selectedAiTags,
  aiTagsLoading,
  aiTagsError,
  toggleAiTag,
  selectAllAiTags,
  deselectAllAiTags,
  tagDescriptions,
  tagTranslations,
  setTagTranslations,
  tagTranslatedLangs,
  expandedTagId,
  setExpandedTagId,
  setTagDescriptionsHasChanges,
  optimizingTagId,
  translatingTagId,
  optimizeTagDescription,
  translateTagDescription,
}: AiTagsTabProps) {
  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            {t("aiTags.title")}
          </CardTitle>
          <CardDescription>{t("aiTags.description")}</CardDescription>
        </CardHeader>
      </Card>

      {/* Error Message */}
      {aiTagsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{aiTagsError}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {aiTagsLoading && allTags.length === 0 && (
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
      {!aiTagsLoading && allTags.length === 0 && (
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllAiTags}
                  disabled={selectedAiTags.length === allTags.length}
                >
                  {t("aiTags.enableAll")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAllAiTags}
                  disabled={selectedAiTags.length === 0}
                >
                  {t("aiTags.disableAll")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {allTags.map((tag) => {
                const currentValue =
                  tagTranslations[tag.id]?.[currentLocale] ??
                  tagDescriptions[tag.id] ??
                  "";
                const otherLangs =
                  tagTranslatedLangs[tag.id]?.filter((l) => l !== currentLocale) ?? [];

                return (
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
                      <div className="mt-3 pl-9">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                              {t("aiTags.descriptionLabel")}
                              <span className="ml-2 text-xs font-normal text-blue-600 dark:text-blue-400">
                                (
                                {t("aiTags.editingIn", {
                                  lang: localeNames[currentLocale],
                                })}
                                )
                              </span>
                            </label>
                            <p className="text-xs text-zinc-500">
                              {t("aiTags.descriptionHint")}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!currentValue?.trim() || optimizingTagId === tag.id}
                              onClick={() => optimizeTagDescription(tag.id, tag.name)}
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
                              onClick={() => translateTagDescription(tag.id)}
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
                          onChange={(e) => {
                            setTagTranslations((prev) => ({
                              ...prev,
                              [tag.id]: {
                                ...prev[tag.id],
                                [currentLocale]: e.target.value,
                              },
                            }));
                            setTagDescriptionsHasChanges(true);
                          }}
                        />
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
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
