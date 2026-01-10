"use client";

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Save,
  Server,
  Loader2,
  CheckCircle2,
  Zap,
  Bug,
  GitBranch,
  Globe,
  Tag,
  FileText,
  Wrench,
} from "lucide-react";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui";
import { useTinyBase } from "@/lib/tinybase";
import {
  ConnectionsTab,
  ProcessingTab,
  PipelineTab,
  CustomFieldsTab,
  AiTagsTab,
  AiDocumentTypesTab,
  WorkflowTagsTab,
  LanguageTab,
  AdvancedTab,
  MaintenanceTab,
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

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const searchParams = useSearchParams();
  const router = useRouter();
  const { saveSettings, isSyncing } = useTinyBase();

  // Get initial tab from URL or default to "connections"
  const tabParam = searchParams.get("tab");
  const initialTab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "connections";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Save status state
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SettingsTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  // Save all settings
  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      await saveSettings();
      setSaveStatus("success");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex items-center justify-between px-8 py-6">
          <div>
            <h1 className="font-serif text-3xl font-light tracking-tight text-zinc-900 dark:text-zinc-100">
              {t("title")}
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {t("subtitle")}
            </p>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || isSyncing}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saving || isSyncing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : saveStatus === "success" ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {saveStatus === "success" ? tCommon("saved") : t("saveSettings")}
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="p-8">
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
