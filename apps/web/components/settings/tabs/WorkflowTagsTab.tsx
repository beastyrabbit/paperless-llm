"use client";

import React from "react";
import {
  Tag,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Check,
  X,
  Plus,
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
  Label,
  Input,
} from "@repo/ui";
import type { Settings, TagsStatusResponse } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface WorkflowTagsTabProps {
  t: TranslationFunction;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  tagsStatus: TagsStatusResponse | null;
  tagsLoading: boolean;
  tagsCreating: boolean;
  tagsError: string | null;
  tagsSuccess: string | null;
  fetchTagsStatus: () => Promise<void>;
  createMissingTags: () => Promise<void>;
}

export function WorkflowTagsTab({
  t,
  settings,
  updateSetting,
  tagsStatus,
  tagsLoading,
  tagsCreating,
  tagsError,
  tagsSuccess,
  fetchTagsStatus,
  createMissingTags,
}: WorkflowTagsTabProps) {
  const updateTagName = (key: string, value: string) => {
    updateSetting("tags", { ...settings.tags, [key]: value });
  };

  return (
    <div className="space-y-6">
      {/* Tags Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {tagsStatus?.all_exist ? (
                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
              ) : (
                <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                </div>
              )}
              <div>
                <CardTitle>
                  {tagsLoading
                    ? t("workflowTags.checkingTags")
                    : tagsStatus?.all_exist
                      ? t("workflowTags.allTagsExist")
                      : t("workflowTags.missingTags", {
                          count: tagsStatus?.missing_count || 0,
                        })}
                </CardTitle>
                <CardDescription>
                  {tagsStatus?.all_exist
                    ? t("workflowTags.allTagsExistDesc")
                    : t("workflowTags.missingTagsDesc")}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={fetchTagsStatus}
                disabled={tagsLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${tagsLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              {tagsStatus && tagsStatus.missing_count > 0 && (
                <Button
                  size="sm"
                  onClick={createMissingTags}
                  disabled={tagsCreating}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  {tagsCreating ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4 mr-2" />
                  )}
                  {t("workflowTags.createMissingTags")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Success/Error Messages */}
      {tagsSuccess && (
        <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>Success</AlertTitle>
          <AlertDescription>{tagsSuccess}</AlertDescription>
        </Alert>
      )}
      {tagsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{tagsError}</AlertDescription>
        </Alert>
      )}

      {/* Tags Status List */}
      {tagsStatus && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              {t("workflowTags.title")}
            </CardTitle>
            <CardDescription>{t("workflowTags.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {tagsStatus.tags.map((tag) => (
                <div
                  key={tag.key}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-8 w-8 rounded-full flex items-center justify-center ${
                        tag.exists
                          ? "bg-emerald-100 dark:bg-emerald-900/30"
                          : "bg-zinc-100 dark:bg-zinc-800"
                      }`}
                    >
                      {tag.exists ? (
                        <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <X className="h-4 w-4 text-zinc-400" />
                      )}
                    </div>
                    <div>
                      <span className="font-medium capitalize">
                        {tag.key.replace(/_/g, " ")}
                      </span>
                      <Badge variant="outline" className="ml-2 font-mono text-xs">
                        {tag.name}
                      </Badge>
                    </div>
                  </div>
                  <Badge
                    variant={tag.exists ? "default" : "secondary"}
                    className={
                      tag.exists
                        ? "bg-emerald-600"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    }
                  >
                    {tag.exists ? "Exists" : "Missing"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tag Names Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>{t("workflowTags.tagNames")}</CardTitle>
          <CardDescription>{t("workflowTags.tagNamesDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(settings.tags).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label className="capitalize">{key.replace(/_/g, " ")}</Label>
                <Input
                  value={value}
                  onChange={(e) => updateTagName(key, e.target.value)}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-4">{t("workflowTags.tagNamesNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
