"use client";

import { APP_PAGE_BACKGROUND } from "@/lib/styles";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import {
  Bug,
  CheckCircle2,
  FileText,
  GitBranch,
  Globe,
  Loader2,
  Save,
  Server,
  Tag,
  Wrench,
  Zap,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useActionState, useState } from "react";
import { useTinyBase } from "@/lib/tinybase";
import {
  AdvancedTab,
  AiDocumentTypesTab,
  AiTagsTab,
  ConnectionsTab,
  CustomFieldsTab,
  LanguageTab,
  MaintenanceTab,
  PipelineTab,
  ProcessingTab,
  WorkflowTagsTab,
} from "./components";

const VALID_TABS = [
  "connections",
  "processing",
  "pipeline",
  "custom-fields",
  "ai-tags",
  "ai-document-types",
  "workflow-tags",
  "language",
  "advanced",
  "maintenance",
] as const;

type SettingsTab = (typeof VALID_TABS)[number];

function SettingsPageContent() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { saveSettings, isSyncing, lastSyncError } = useTinyBase();

  // Get initial tab from URL or default to "connections"
  const tabParam = searchParams.get("tab");
  const initialTab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "connections";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const [saveState, saveAction, isSaving] = useActionState<
    { status: "idle" | "success" | "error"; message: string | null },
    FormData
  >(async () => {
    try {
      await saveSettings();
      return { status: "success", message: t("saved") };
    } catch {
      return { status: "error", message: t("saveError") };
    }
  }, { status: "idle", message: null });

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SettingsTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  return (
    <div className={APP_PAGE_BACKGROUND}>
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-center justify-between px-8 py-6">
          <div>
            <h1 className="font-serif text-3xl font-light tracking-tight text-zinc-900 dark:text-zinc-100">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("subtitle")}</p>
          </div>
          <form action={saveAction} className="flex items-center gap-3">
            {saveState.status === "error" && (
              <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                {saveState.message}
              </p>
            )}
            <Button
              type="submit"
              disabled={isSaving || isSyncing}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isSaving || isSyncing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : saveState.status === "success" ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {saveState.status === "success" ? tCommon("saved") : t("saveSettings")}
            </Button>
          </form>
        </div>
      </header>

      {/* Content */}
      <main className="p-8">
        {lastSyncError && (
          <div
            className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            {lastSyncError}
          </div>
        )}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="bg-zinc-100 dark:bg-zinc-800">
            <TabsTrigger value="connections" className="gap-2">
              <Server className="h-4 w-4" />
              {t("tabs.connections")}
            </TabsTrigger>
            <TabsTrigger value="processing" className="gap-2">
              <Zap className="h-4 w-4" />
              {t("tabs.processing")}
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2">
              <GitBranch className="h-4 w-4" />
              {t("tabs.pipeline")}
            </TabsTrigger>
            <TabsTrigger value="custom-fields" className="gap-2">
              <FileText className="h-4 w-4" />
              {t("tabs.customFields")}
            </TabsTrigger>
            <TabsTrigger value="ai-tags" className="gap-2">
              <Tag className="h-4 w-4" />
              {t("tabs.aiTags")}
            </TabsTrigger>
            <TabsTrigger value="ai-document-types" className="gap-2">
              <FileText className="h-4 w-4" />
              {t("tabs.aiDocumentTypes")}
            </TabsTrigger>
            <TabsTrigger value="workflow-tags" className="gap-2">
              <GitBranch className="h-4 w-4" />
              {t("tabs.workflowTags")}
            </TabsTrigger>
            <TabsTrigger value="language" className="gap-2">
              <Globe className="h-4 w-4" />
              {t("tabs.language")}
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <Bug className="h-4 w-4" />
              {t("tabs.advanced")}
            </TabsTrigger>
            <TabsTrigger value="maintenance" className="gap-2">
              <Wrench className="h-4 w-4" />
              {t("tabs.maintenance")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="connections" className="space-y-6">
            <ConnectionsTab />
          </TabsContent>

          <TabsContent value="processing" className="space-y-6">
            <ProcessingTab />
          </TabsContent>

          <TabsContent value="pipeline" className="space-y-6">
            <PipelineTab />
          </TabsContent>

          <TabsContent value="custom-fields" className="space-y-6">
            <CustomFieldsTab />
          </TabsContent>

          <TabsContent value="ai-tags" className="space-y-6">
            <AiTagsTab />
          </TabsContent>

          <TabsContent value="ai-document-types" className="space-y-6">
            <AiDocumentTypesTab />
          </TabsContent>

          <TabsContent value="workflow-tags" className="space-y-6">
            <WorkflowTagsTab />
          </TabsContent>

          <TabsContent value="language" className="space-y-6">
            <LanguageTab />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <AdvancedTab />
          </TabsContent>

          <TabsContent value="maintenance" className="space-y-6">
            <MaintenanceTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="size-7 animate-spin text-emerald-500" />
        </div>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}
