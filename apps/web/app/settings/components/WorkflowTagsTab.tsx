"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@repo/ui";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Loader2,
  Palette,
  Plus,
  RefreshCw,
  Tag,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { settingsApi, type WorkflowTagsStatusResponse } from "@/lib/api";
import type { SettingKey } from "@/lib/tinybase";
import { useStringSetting, useTinyBase } from "@/lib/tinybase";

// Tag setting keys mapping
const TAG_KEYS: { key: string; settingKey: SettingKey }[] = [
  { key: "queued", settingKey: "tags.todo" },
  { key: "processing", settingKey: "tags.ocr" },
  { key: "needs input", settingKey: "tags.review" },
  { key: "done", settingKey: "tags.done" },
  { key: "failed", settingKey: "tags.failed" },
];

function TagNameInput({ settingKey, label }: { settingKey: SettingKey; label: string }) {
  const { updateSetting } = useTinyBase();
  const value = useStringSetting(settingKey);
  const inputId = `tag-name-${settingKey.replaceAll(".", "-")}`;

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId} className="capitalize">
        {label}
      </Label>
      <Input
        id={inputId}
        value={value}
        onChange={(e) => updateSetting(settingKey, e.target.value)}
      />
    </div>
  );
}

function ColorPickerInput() {
  const { updateSetting } = useTinyBase();
  const value = useStringSetting("tags.color");

  return (
    <div className="flex items-center gap-3">
      <Label htmlFor="tag-color-picker">{`Tag Color`}</Label>
      <div className="flex items-center gap-2">
        <input
          id="tag-color-picker"
          type="color"
          value={value || "#1e88e5"}
          onChange={(e) => updateSetting("tags.color", e.target.value)}
          className="w-10 h-10 rounded cursor-pointer border border-zinc-300 dark:border-zinc-700"
        />
        <Input
          aria-label="Tag color hex value"
          value={value || "#1e88e5"}
          onChange={(e) => updateSetting("tags.color", e.target.value)}
          className="w-28 font-mono text-sm"
          placeholder="#1e88e5"
        />
      </div>
    </div>
  );
}

export function WorkflowTagsTab() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  // UI state
  const [tagsStatus, setTagsStatus] = useState<WorkflowTagsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fixingColors, setFixingColors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const missingTags = tagsStatus?.tags.filter((tag) => !tag.exists).map((tag) => tag.name) ?? [];
  const colorMismatchTags =
    tagsStatus?.tags
      .filter((tag) => tag.exists && tag.color_matches === false)
      .map((tag) => tag.name) ?? [];

  const fetchTagsStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await settingsApi.getWorkflowTagsStatus();
    if (result.ok) {
      setTagsStatus(result.data);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTagsStatus();
  }, [fetchTagsStatus]);

  const createMissingTags = async () => {
    if (missingTags.length === 0) return;

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await settingsApi.createWorkflowTags(missingTags);
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (result.data.created.length > 0) {
        setSuccess(
          t("workflowTags.createdSuccess", {
            count: result.data.created.length,
            tags: result.data.created.join(", "),
          }),
        );
      }

      if (result.data.failed.length > 0) {
        setError(t("workflowTags.createFailed", { tags: result.data.failed.join(", ") }));
      }

      // Refresh status
      await fetchTagsStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tags");
    } finally {
      setCreating(false);
    }
  };

  const fixColors = async () => {
    setFixingColors(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await settingsApi.fixWorkflowTagColors();
      if (!result.ok) {
        setError(result.error);
        return;
      }

      if (result.data.updated.length > 0) {
        setSuccess(t("workflowTags.fixedColorsSuccess", { count: result.data.updated.length }));
      } else {
        setSuccess(t("workflowTags.colorsAlreadyCorrect"));
      }

      if (result.data.failed.length > 0) {
        setError(t("workflowTags.fixColorsFailed", { tags: result.data.failed.join(", ") }));
      }

      // Refresh status
      await fetchTagsStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fix colors");
    } finally {
      setFixingColors(false);
    }
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
                  {loading
                    ? t("workflowTags.checkingTags")
                    : tagsStatus?.all_exist
                      ? t("workflowTags.allTagsExist")
                      : t("workflowTags.missingTags", { count: tagsStatus?.missing_count || 0 })}
                </CardTitle>
                <CardDescription>
                  {tagsStatus?.all_exist
                    ? t("workflowTags.allTagsExistDesc")
                    : t("workflowTags.missingTagsDesc")}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={fetchTagsStatus} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                {tCommon("refresh")}
              </Button>
              {tagsStatus && tagsStatus.missing_count > 0 && (
                <ConfirmActionDialog
                  title={t("workflowTags.confirmCreateTitle")}
                  description={t("workflowTags.confirmCreateDescription", {
                    count: missingTags.length,
                    tags: missingTags.join(", "),
                  })}
                  confirmLabel={t("workflowTags.confirmCreateAction", {
                    count: missingTags.length,
                  })}
                  cancelLabel={tCommon("cancel")}
                  confirmVariant="default"
                  disabled={creating}
                  onConfirm={createMissingTags}
                >
                  <Button
                    size="sm"
                    disabled={creating}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    {t("workflowTags.createMissingTags")}
                  </Button>
                </ConfirmActionDialog>
              )}
              {tagsStatus && tagsStatus.color_mismatch_count > 0 && (
                <ConfirmActionDialog
                  title={t("workflowTags.confirmFixColorsTitle")}
                  description={t("workflowTags.confirmFixColorsDescription", {
                    count: colorMismatchTags.length,
                    tags: colorMismatchTags.join(", "),
                  })}
                  confirmLabel={t("workflowTags.confirmFixColorsAction", {
                    count: colorMismatchTags.length,
                  })}
                  cancelLabel={tCommon("cancel")}
                  confirmVariant="default"
                  disabled={fixingColors}
                  onConfirm={fixColors}
                >
                  <Button size="sm" disabled={fixingColors} variant="outline">
                    {fixingColors ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Palette className="h-4 w-4 mr-2" />
                    )}
                    {t("workflowTags.fixColors", { count: tagsStatus.color_mismatch_count })}
                  </Button>
                </ConfirmActionDialog>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Success/Error Messages */}
      {success && (
        <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          <AlertTitle>{tCommon("success")}</AlertTitle>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{tCommon("error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
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
                      <span className="font-medium capitalize">{tag.key.replace(/_/g, " ")}</span>
                      <Badge variant="outline" className="ml-2 font-mono text-xs">
                        {tag.name}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Color indicator */}
                    {tag.exists && tag.actual_color && (
                      <div
                        className="w-5 h-5 rounded border border-zinc-300 dark:border-zinc-600"
                        style={{ backgroundColor: tag.actual_color }}
                        title={`Actual: ${tag.actual_color}`}
                      />
                    )}
                    {/* Color match status */}
                    {tag.exists && tag.color_matches === false && (
                      <Badge variant="outline" className="text-amber-600 border-amber-600">
                        Color
                      </Badge>
                    )}
                    {/* Exists status */}
                    <Badge
                      variant={tag.exists ? "default" : "secondary"}
                      className={
                        tag.exists
                          ? "bg-emerald-600"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      }
                    >
                      {tag.exists ? tCommon("exists") : tCommon("missing")}
                    </Badge>
                  </div>
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
          {/* Color picker */}
          <div className="mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800">
            <ColorPickerInput />
            <p className="text-xs text-zinc-500 mt-2">
              All workflow tags will use this color in Paperless-ngx
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {TAG_KEYS.map((item) => (
              <TagNameInput
                key={item.key}
                settingKey={item.settingKey}
                label={item.key.replace(/_/g, " ")}
              />
            ))}
          </div>
          <p className="text-xs text-zinc-500 mt-4">{t("workflowTags.tagNamesNote")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
