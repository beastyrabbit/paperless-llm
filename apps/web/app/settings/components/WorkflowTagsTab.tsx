"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Tag,
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Plus,
  Check,
  X,
  Palette,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
} from "@repo/ui";
import { useTinyBase, useStringSetting } from "@/lib/tinybase";
import type { SettingKey } from "@/lib/tinybase";

interface TagStatus {
  key: string;
  name: string;
  exists: boolean;
  tag_id: number | null;
  actual_color: string | null;
  color_matches: boolean | null;
}

interface TagsStatusResponse {
  tags: TagStatus[];
  expected_color: string;
  all_exist: boolean;
  missing_count: number;
  all_colors_match: boolean;
  color_mismatch_count: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Tag setting keys mapping
const TAG_KEYS: { key: string; settingKey: SettingKey }[] = [
  { key: "pending", settingKey: "tags.pending" },
  { key: "ocr_done", settingKey: "tags.ocr_done" },
  { key: "summary_done", settingKey: "tags.summary_done" },
  { key: "schema_review", settingKey: "tags.schema_review" },
  { key: "title_done", settingKey: "tags.title_done" },
  { key: "correspondent_done", settingKey: "tags.correspondent_done" },
  { key: "document_type_done", settingKey: "tags.document_type_done" },
  { key: "tags_done", settingKey: "tags.tags_done" },
  { key: "processed", settingKey: "tags.processed" },
  { key: "failed", settingKey: "tags.failed" },
  { key: "manual_review", settingKey: "tags.manual_review" },
];

function TagNameInput({ settingKey, label }: { settingKey: SettingKey; label: string }) {
  const { updateSetting } = useTinyBase();
  const value = useStringSetting(settingKey);

  return (
    <div className="space-y-2">
      <Label className="capitalize">{label}</Label>
      <Input
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
      <Label>{`Tag Color`}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || "#1e88e5"}
          onChange={(e) => updateSetting("tags.color", e.target.value)}
          className="w-10 h-10 rounded cursor-pointer border border-zinc-300 dark:border-zinc-700"
        />
        <Input
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
  const [tagsStatus, setTagsStatus] = useState<TagsStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [fixingColors, setFixingColors] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchTagsStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/tags/status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setTagsStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tags status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTagsStatus();
  }, [fetchTagsStatus]);

  const createMissingTags = async () => {
    if (!tagsStatus) return;

    const missingTags = tagsStatus.tags
      .filter((t) => !t.exists)
      .map((t) => t.name);

    if (missingTags.length === 0) return;

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_BASE}/api/settings/tags/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag_names: missingTags }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.created.length > 0) {
        setSuccess(`Created ${result.created.length} tag(s): ${result.created.join(", ")}`);
      }

      if (result.failed.length > 0) {
        setError(`Failed to create: ${result.failed.join(", ")}`);
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
      const response = await fetch(`${API_BASE}/api/settings/tags/fix-colors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();

      if (result.updated.length > 0) {
        setSuccess(`Updated color for ${result.updated.length} tag(s)`);
      } else {
        setSuccess("All tag colors are already correct");
      }

      if (result.failed.length > 0) {
        setError(`Failed to update: ${result.failed.join(", ")}`);
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
              <Button
                variant="outline"
                size="sm"
                onClick={fetchTagsStatus}
                disabled={loading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                {tCommon("refresh")}
              </Button>
              {tagsStatus && tagsStatus.missing_count > 0 && (
                <Button
                  size="sm"
                  onClick={createMissingTags}
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
              )}
              {tagsStatus && tagsStatus.color_mismatch_count > 0 && (
                <Button
                  size="sm"
                  onClick={fixColors}
                  disabled={fixingColors}
                  variant="outline"
                >
                  {fixingColors ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Palette className="h-4 w-4 mr-2" />
                  )}
                  Fix Colors ({tagsStatus.color_mismatch_count})
                </Button>
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
                      <span className="font-medium capitalize">
                        {tag.key.replace(/_/g, " ")}
                      </span>
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
                      <Badge
                        variant="outline"
                        className="text-amber-600 border-amber-600"
                      >
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
          <p className="text-xs text-zinc-500 mt-4">
            {t("workflowTags.tagNamesNote")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
