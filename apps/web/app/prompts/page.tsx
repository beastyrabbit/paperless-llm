"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Code2,
  Save,
  FileText,
  ChevronRight,
  Eye,
  Edit3,
  Loader2,
  RefreshCw,
  AlertCircle,
  Check,
  X,
  MessageSquare,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  ScrollArea,
  Textarea,
} from "@repo/ui";
import { promptsApi, PromptGroup, PreviewData } from "@/lib/api";

// Variable descriptions for tooltips
const VARIABLE_DESCRIPTIONS: Record<string, string> = {
  document_content: "First 3000 characters of the document's OCR content",
  similar_titles: "Titles from similar documents found via vector search",
  similar_docs: "Similar documents with their assigned metadata",
  existing_correspondents: "List of existing correspondents in Paperless-ngx",
  existing_types: "List of existing document types in Paperless-ngx",
  existing_tags: "List of existing tags in Paperless-ngx",
  feedback: "Feedback from previous confirmation attempt (or 'None')",
  analysis_result: "The analysis from the primary LLM to be confirmed",
  document_excerpt: "First 1500 characters of the document for context",
};

type PromptType = "main" | "confirmation";
type ViewMode = "edit" | "preview";
type PromptCategory = "document" | "system";

export default function PromptsPage() {
  const t = useTranslations("prompts");
  const tCommon = useTranslations("common");
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<PromptGroup | null>(null);
  const [promptType, setPromptType] = useState<PromptType>("main");
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [promptCategory, setPromptCategory] = useState<PromptCategory>("document");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [editedContent, setEditedContent] = useState<string>("");
  const [hasChanges, setHasChanges] = useState(false);

  // Filter groups by category
  const filteredGroups = useMemo(() => {
    return groups.filter((g) => g.category === promptCategory);
  }, [groups, promptCategory]);

  // Get current prompt based on selection
  const currentPrompt = useMemo(() => {
    if (!selectedGroup) return null;
    if (promptType === "main") return selectedGroup.main;
    return selectedGroup.confirmation;
  }, [selectedGroup, promptType]);

  // Fetch groups and preview data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    const [groupsRes, previewRes] = await Promise.all([
      promptsApi.listGroups(),
      promptsApi.getPreviewData(),
    ]);

    if (groupsRes.error) {
      setError(groupsRes.error);
    } else     if (groupsRes.data) {
      const data = groupsRes.data;
      setGroups(data);
      if (data.length > 0) {
        setSelectedGroup((prev) => prev ?? data[0]);
      }
    }

    if (previewRes.data) {
      setPreviewData(previewRes.data);
    }

    setLoading(false);
  }, []);

  // Fetch on mount
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Update edited content when prompt changes
  useEffect(() => {
    if (currentPrompt) {
      setEditedContent(currentPrompt.content);
      setHasChanges(false);
    }
  }, [currentPrompt]);

  const handleContentChange = useCallback(
    (value: string) => {
      setEditedContent(value);
      setHasChanges(value !== currentPrompt?.content);
    },
    [currentPrompt]
  );

  const handleSave = async () => {
    if (!currentPrompt || !hasChanges) return;

    setSaving(true);
    const promptName = currentPrompt.filename.replace(".md", "");
    const response = await promptsApi.update(promptName, editedContent);

    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      // Update the group with new content
      setGroups((prev) =>
        prev.map((g) => {
          if (g.name !== selectedGroup?.name) return g;
          if (promptType === "main") {
            return { ...g, main: response.data! };
          } else {
            return { ...g, confirmation: response.data! };
          }
        })
      );
      setHasChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    }
    setSaving(false);
  };

  const handleDiscard = () => {
    if (currentPrompt) {
      setEditedContent(currentPrompt.content);
      setHasChanges(false);
    }
  };

  // Generate preview content with real data substituted
  const previewContent = useMemo(() => {
    if (!currentPrompt || !previewData) return editedContent;

    let content = editedContent;
    const dataMap: Record<string, string> = {
      document_content: previewData.document_content,
      similar_titles: previewData.similar_titles,
      similar_docs: previewData.similar_docs,
      existing_correspondents: previewData.existing_correspondents,
      existing_types: previewData.existing_types,
      existing_tags: previewData.existing_tags,
      feedback: previewData.feedback,
      analysis_result: previewData.analysis_result,
      document_excerpt: previewData.document_excerpt,
    };

    for (const [key, value] of Object.entries(dataMap)) {
      content = content.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
    return content;
  }, [editedContent, previewData, currentPrompt]);

  // Highlight variables in edit view (prepared for future syntax highlighting)
  const _highlightedParts = useMemo(() => {
    const parts: { text: string; isVariable: boolean; variable?: string }[] =
      [];
    let lastIndex = 0;
    const regex = /\{(\w+)\}/g;
    let match;

    while ((match = regex.exec(editedContent)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          text: editedContent.slice(lastIndex, match.index),
          isVariable: false,
        });
      }
      parts.push({
        text: match[0],
        isVariable: true,
        variable: match[1],
      });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < editedContent.length) {
      parts.push({
        text: editedContent.slice(lastIndex),
        isVariable: false,
      });
    }

    return parts;
  }, [editedContent]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
        <div className="flex items-center gap-2 text-zinc-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t("loadingPrompts")}</span>
        </div>
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
        <Card className="max-w-md">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-red-500 mb-4">
              <AlertCircle className="h-5 w-5" />
              <span className="font-medium">{t("failedToLoad")}</span>
            </div>
            <p className="text-sm text-zinc-500 mb-4">{error}</p>
            <Button onClick={fetchData} variant="outline" size="sm">
              <RefreshCw className="mr-2 h-4 w-4" />
              {tCommon("retry")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-zinc-500">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={fetchData} variant="ghost" size="sm">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Badge variant="secondary">
              <Code2 className="mr-1 h-3 w-3" />
              {tCommon("prompts", { count: groups.length })}
            </Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-6 p-8 lg:grid-cols-[280px_1fr]">
        {/* Prompt Groups List */}
        <Card className="h-fit">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("promptGroups")}</CardTitle>
            <CardDescription className="text-xs">
              {t("promptGroupsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {/* Category Tabs */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800">
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  promptCategory === "document"
                    ? "text-emerald-600 border-b-2 border-emerald-600"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
                onClick={() => {
                  setPromptCategory("document");
                  setSelectedGroup(null);
                }}
              >
                {t("documentPrompts")}
              </button>
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  promptCategory === "system"
                    ? "text-emerald-600 border-b-2 border-emerald-600"
                    : "text-zinc-500 hover:text-zinc-700"
                }`}
                onClick={() => {
                  setPromptCategory("system");
                  setSelectedGroup(null);
                }}
              >
                {t("systemPrompts")}
              </button>
            </div>
            {/* Prompt List */}
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {filteredGroups.map((group) => (
                <button
                  key={group.name}
                  className={`w-full flex items-center justify-between p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors ${
                    selectedGroup?.name === group.name
                      ? "bg-emerald-50 dark:bg-emerald-950"
                      : ""
                  }`}
                  onClick={() => {
                    setSelectedGroup(group);
                    setPromptType("main");
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-zinc-400" />
                    <div>
                      <p className="font-medium">{group.name}</p>
                      <p className="text-xs text-zinc-500">
                        {group.confirmation ? t("mainPlusConfirmation") : t("mainOnly")}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Prompt Editor */}
        {selectedGroup && (
          <div className="space-y-4">
            {/* Prompt Type Tabs (Main / Confirmation) */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle>{selectedGroup.name}</CardTitle>
                    <CardDescription>
                      {currentPrompt?.description || currentPrompt?.filename}
                    </CardDescription>
                  </div>

                  {/* Prompt Type Toggle */}
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
                      <Button
                        variant={promptType === "main" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-3"
                        onClick={() => setPromptType("main")}
                      >
                        <FileText className="mr-1 h-3 w-3" />
                        {t("main")}
                      </Button>
                      {selectedGroup.confirmation && (
                        <Button
                          variant={
                            promptType === "confirmation" ? "secondary" : "ghost"
                          }
                          size="sm"
                          className="h-7 px-3"
                          onClick={() => setPromptType("confirmation")}
                        >
                          <MessageSquare className="mr-1 h-3 w-3" />
                          {t("confirmation")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Editor Card */}
            {currentPrompt && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    {/* View Mode Toggle */}
                    <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 p-1">
                      <Button
                        variant={viewMode === "edit" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-3"
                        onClick={() => setViewMode("edit")}
                      >
                        <Edit3 className="mr-1 h-3 w-3" />
                        {t("editTemplate")}
                      </Button>
                      <Button
                        variant={viewMode === "preview" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 px-3"
                        onClick={() => setViewMode("preview")}
                      >
                        <Eye className="mr-1 h-3 w-3" />
                        {t("preview")}
                      </Button>
                    </div>

                    {/* Save/Discard Actions */}
                    <div className="flex items-center gap-2">
                      {hasChanges && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleDiscard}
                          >
                            <X className="mr-1 h-4 w-4" />
                            {tCommon("discard")}
                          </Button>
                          <Button
                            variant="default"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving}
                          >
                            {saving ? (
                              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-1 h-4 w-4" />
                            )}
                            {tCommon("save")}
                          </Button>
                        </>
                      )}
                      {saveSuccess && (
                        <Badge variant="outline" className="text-emerald-600">
                          <Check className="mr-1 h-3 w-3" />
                          {tCommon("saved")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Variables */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">
                      {t("templateVariables")} ({currentPrompt.variables.length})
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {currentPrompt.variables.map((variable) => (
                        <div key={variable} className="group relative">
                          <Badge
                            variant="outline"
                            className="font-mono cursor-help hover:bg-emerald-50 dark:hover:bg-emerald-950"
                          >
                            {`{${variable}}`}
                          </Badge>
                          {VARIABLE_DESCRIPTIONS[variable] && (
                            <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-10">
                              <div className="bg-zinc-900 text-white text-xs rounded px-2 py-1 whitespace-nowrap max-w-xs">
                                {VARIABLE_DESCRIPTIONS[variable]}
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                      {currentPrompt.variables.length === 0 && (
                        <span className="text-sm text-zinc-500">
                          {t("noVariables")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content Area */}
                  <div>
                    <h4 className="text-sm font-medium mb-2">
                      {viewMode === "edit"
                        ? t("templateContent")
                        : t("previewWithData")}
                    </h4>

                    {viewMode === "edit" ? (
                      <Textarea
                        value={editedContent}
                        onChange={(e) => handleContentChange(e.target.value)}
                        className="font-mono text-sm min-h-[500px] bg-zinc-950 text-zinc-300 border-zinc-800"
                        placeholder={t("enterPromptPlaceholder")}
                      />
                    ) : (
                      <ScrollArea className="h-[500px] rounded-lg border border-zinc-200 bg-zinc-950 p-4 dark:border-zinc-800">
                        <pre className="font-mono text-sm text-emerald-400 whitespace-pre-wrap">
                          {previewContent}
                        </pre>
                      </ScrollArea>
                    )}
                  </div>

                  {/* Info Text */}
                  {viewMode === "edit" && hasChanges && (
                    <p className="text-xs text-amber-600">
                      {t("unsavedChanges")}
                    </p>
                  )}
                  {viewMode === "preview" && (
                    <p className="text-xs text-zinc-500">
                      {t("previewInfo")}
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
