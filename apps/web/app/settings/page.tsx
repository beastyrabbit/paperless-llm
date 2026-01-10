"use client";

import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { Save, Loader2 } from "lucide-react";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { useSettings } from "@/hooks/useSettings";
import {
  ConnectionsTab, ProcessingTab, PipelineTab, CustomFieldsTab,
  AiTagsTab, AiDocTypesTab, WorkflowTagsTab, LanguageTab,
  AdvancedTab, MaintenanceTab, DatabaseTab,
} from "@/components/settings/tabs";
import { type SettingsTab, VALID_TABS } from "@/components/settings/types";

function SettingsPageContent() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const tMaint = useTranslations("maintenance");
  const currentLocale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const router = useRouter();

  const tabParam = searchParams.get("tab");
  const initialTab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab) ? (tabParam as SettingsTab) : "connections";
  const s = useSettings(initialTab);

  const handleTabChange = (tab: string) => {
    s.setActiveTab(tab as SettingsTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };

  const formatDate = (date: string | null) => date ? new Date(date).toLocaleString() : tMaint("scheduled.never");

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <Button onClick={s.handleSave} disabled={s.saving}
          className={s.saveStatus === "success" ? "bg-emerald-600 hover:bg-emerald-700" : s.saveStatus === "error" ? "bg-red-600 hover:bg-red-700" : ""}>
          {s.saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {s.saveStatus === "success" ? tCommon("saved") : s.saveStatus === "error" ? tCommon("error") : tCommon("save")}
        </Button>
      </div>

      <Tabs value={s.activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-6 flex flex-wrap h-auto gap-1">
          <TabsTrigger value="connections">{t("tabs.connections")}</TabsTrigger>
          <TabsTrigger value="processing">{t("tabs.processing")}</TabsTrigger>
          <TabsTrigger value="pipeline">{t("tabs.pipeline")}</TabsTrigger>
          <TabsTrigger value="custom-fields">{t("tabs.customFields")}</TabsTrigger>
          <TabsTrigger value="ai-tags">{t("tabs.aiTags")}</TabsTrigger>
          <TabsTrigger value="ai-document-types">{t("tabs.aiDocTypes")}</TabsTrigger>
          <TabsTrigger value="workflow-tags">{t("tabs.workflowTags")}</TabsTrigger>
          <TabsTrigger value="language">{t("tabs.language")}</TabsTrigger>
          <TabsTrigger value="advanced">{t("tabs.advanced")}</TabsTrigger>
          <TabsTrigger value="maintenance">{t("tabs.maintenance")}</TabsTrigger>
          <TabsTrigger value="database">{t("tabs.database")}</TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          <ConnectionsTab t={t} settings={s.settings} updateSetting={s.updateSetting} connectionStatus={s.connectionStatus}
            testConnection={s.testConnection} showSecrets={s.showSecrets} setShowSecrets={s.setShowSecrets}
            ollamaModels={s.ollamaModels} mistralModels={s.mistralModels} loadingModels={s.loadingModels}
            fetchOllamaModels={s.fetchOllamaModels} loadMistralModels={s.loadMistralModels} />
        </TabsContent>
        <TabsContent value="processing">
          <ProcessingTab t={t} settings={s.settings} updateSetting={s.updateSetting} />
        </TabsContent>
        <TabsContent value="pipeline">
          <PipelineTab t={t} settings={s.settings} updateSetting={s.updateSetting} />
        </TabsContent>
        <TabsContent value="custom-fields">
          <CustomFieldsTab t={t} customFields={s.customFields} selectedCustomFields={s.selectedCustomFields}
            customFieldsLoading={s.customFieldsLoading} customFieldsError={s.customFieldsError}
            customFieldsHasChanges={s.customFieldsHasChanges} toggleCustomField={s.toggleCustomField}
            selectAllCustomFields={s.selectAllCustomFields} deselectAllCustomFields={s.deselectAllCustomFields} />
        </TabsContent>
        <TabsContent value="ai-tags">
          <AiTagsTab t={t} currentLocale={currentLocale} allTags={s.allTags} selectedAiTags={s.selectedAiTags}
            aiTagsLoading={s.aiTagsLoading} aiTagsError={s.aiTagsError} aiTagsHasChanges={s.aiTagsHasChanges}
            toggleAiTag={s.toggleAiTag} selectAllAiTags={s.selectAllAiTags} deselectAllAiTags={s.deselectAllAiTags}
            tagDescriptions={s.tagDescriptions} setTagDescriptions={s.setTagDescriptions}
            expandedTagId={s.expandedTagId} setExpandedTagId={s.setExpandedTagId}
            tagDescriptionsHasChanges={s.tagDescriptionsHasChanges} setTagDescriptionsHasChanges={s.setTagDescriptionsHasChanges}
            tagTranslations={s.tagTranslations} setTagTranslations={s.setTagTranslations}
            tagTranslatedLangs={s.tagTranslatedLangs} optimizingTagId={s.optimizingTagId}
            translatingTagId={s.translatingTagId} optimizeTagDescription={s.optimizeTagDescription}
            translateTagDescription={s.translateTagDescription} />
        </TabsContent>
        <TabsContent value="ai-document-types">
          <AiDocTypesTab t={t} allDocumentTypes={s.allDocumentTypes} selectedAiDocTypes={s.selectedAiDocTypes}
            aiDocTypesLoading={s.aiDocTypesLoading} aiDocTypesError={s.aiDocTypesError}
            aiDocTypesHasChanges={s.aiDocTypesHasChanges} toggleAiDocType={s.toggleAiDocType}
            selectAllAiDocTypes={s.selectAllAiDocTypes} deselectAllAiDocTypes={s.deselectAllAiDocTypes} />
        </TabsContent>
        <TabsContent value="workflow-tags">
          <WorkflowTagsTab t={t} settings={s.settings} updateSetting={s.updateSetting} tagsStatus={s.tagsStatus}
            tagsLoading={s.tagsLoading} tagsCreating={s.tagsCreating} tagsError={s.tagsError}
            tagsSuccess={s.tagsSuccess} fetchTagsStatus={s.fetchTagsStatus} createMissingTags={s.createMissingTags} />
        </TabsContent>
        <TabsContent value="language">
          <LanguageTab t={t} currentLocale={currentLocale} locales={locales} localeNames={localeNames}
            settings={s.settings} updateSetting={s.updateSetting} pendingUiLocale={s.pendingUiLocale}
            setPendingUiLocale={s.setPendingUiLocale} availableLanguages={s.availableLanguages}
            languagesLoading={s.languagesLoading} translationSourceLang={s.translationSourceLang}
            setTranslationSourceLang={s.setTranslationSourceLang} translationTargetLang={s.translationTargetLang}
            setTranslationTargetLang={s.setTranslationTargetLang} translating={s.translating}
            translationResult={s.translationResult} translatePrompts={s.translatePrompts} />
        </TabsContent>
        <TabsContent value="advanced">
          <AdvancedTab t={t} settings={s.settings} updateSetting={s.updateSetting} />
        </TabsContent>
        <TabsContent value="maintenance">
          <MaintenanceTab tMaint={tMaint} tCommon={tCommon} maintenanceError={s.maintenanceError}
            setMaintenanceError={() => {}} bootstrapProgress={s.bootstrapProgress}
            bootstrapStarting={s.bootstrapStarting} bootstrapLoading={s.bootstrapLoading}
            bootstrapDetailsOpen={s.bootstrapDetailsOpen} setBootstrapDetailsOpen={s.setBootstrapDetailsOpen}
            isBootstrapRunning={s.isBootstrapRunning} bootstrapProgressPercent={s.bootstrapProgressPercent}
            handleStartBootstrap={s.handleStartBootstrap} handleCancelBootstrap={s.handleCancelBootstrap}
            handleSkipDocument={s.handleSkipDocument} bulkOCRProgress={s.bulkOCRProgress}
            bulkOCRStarting={s.bulkOCRStarting} bulkOCRDocsPerSecond={s.bulkOCRDocsPerSecond}
            setBulkOCRDocsPerSecond={s.setBulkOCRDocsPerSecond} bulkOCRSkipExisting={s.bulkOCRSkipExisting}
            setBulkOCRSkipExisting={s.setBulkOCRSkipExisting} isBulkOCRRunning={s.isBulkOCRRunning}
            bulkOCRProgressPercent={s.bulkOCRProgressPercent} handleStartBulkOCR={s.handleStartBulkOCR}
            handleCancelBulkOCR={s.handleCancelBulkOCR} scheduleStatus={s.scheduleStatus}
            scheduleLoading={s.scheduleLoading} scheduleSaving={s.scheduleSaving}
            manualTriggerLoading={s.manualTriggerLoading} handleScheduleUpdate={s.handleScheduleUpdate}
            handleManualTrigger={s.handleManualTrigger} formatMaintenanceDate={formatDate} />
        </TabsContent>
        <TabsContent value="database">
          <DatabaseTab t={t}
            configImporting={s.configImporting} configImportResult={s.configImportResult}
            handleImportConfig={s.handleImportConfig}
            dbClearing={s.dbClearing} dbClearResult={s.dbClearResult}
            handleClearDatabase={s.handleClearDatabase} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="container mx-auto py-8 px-4"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <SettingsPageContent />
    </Suspense>
  );
}
