"use client";

import { useState, useEffect, useCallback } from "react";
import { useLocale } from "next-intl";
import { setLocale } from "@/lib/locale";
import type { Locale } from "@/i18n/config";
import {
  jobsApi,
  BootstrapProgress,
  BootstrapAnalysisType,
  JobScheduleStatus,
  ScheduleType,
  BulkOCRProgress,
} from "@/lib/api";
import {
  type Settings,
  type ConnectionStatus,
  type OllamaModel,
  type MistralModel,
  type TagsStatusResponse,
  type CustomField,
  type CustomFieldsResponse,
  type PaperlessTag,
  type DocumentTypeInfo,
  type LanguageInfo,
  type SettingsTab,
  DEFAULT_SETTINGS,
  API_BASE,
  VALID_TABS,
} from "@/components/settings/types";

export function useSettings(initialTab: SettingsTab = "connections") {
  const currentLocale = useLocale() as Locale;

  // Tab state
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Main settings state
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [pendingUiLocale, setPendingUiLocale] = useState<Locale | null>(null);

  // Connection state
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({
    paperless: "idle",
    ollama: "idle",
    qdrant: "idle",
    mistral: "idle",
  });

  // Model state
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [mistralModels, setMistralModels] = useState<MistralModel[]>([]);
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({
    ollama: false,
    mistral: false,
  });

  // Secret visibility
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({
    paperless_token: false,
    mistral_api_key: false,
  });

  // Workflow tags state
  const [tagsStatus, setTagsStatus] = useState<TagsStatusResponse | null>(null);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsCreating, setTagsCreating] = useState(false);
  const [tagsError, setTagsError] = useState<string | null>(null);
  const [tagsSuccess, setTagsSuccess] = useState<string | null>(null);

  // Custom fields state
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [selectedCustomFields, setSelectedCustomFields] = useState<number[]>([]);
  const [customFieldsLoading, setCustomFieldsLoading] = useState(false);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [customFieldsHasChanges, setCustomFieldsHasChanges] = useState(false);

  // AI Tags state
  const [allTags, setAllTags] = useState<PaperlessTag[]>([]);
  const [selectedAiTags, setSelectedAiTags] = useState<number[]>([]);
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const [aiTagsError, setAiTagsError] = useState<string | null>(null);
  const [aiTagsHasChanges, setAiTagsHasChanges] = useState(false);

  // Tag descriptions/translations state
  const [tagDescriptions, setTagDescriptions] = useState<Record<number, string>>({});
  const [expandedTagId, setExpandedTagId] = useState<number | null>(null);
  const [tagDescriptionsHasChanges, setTagDescriptionsHasChanges] = useState(false);
  const [tagTranslations, setTagTranslations] = useState<Record<number, Record<string, string>>>({});
  const [tagTranslatedLangs, setTagTranslatedLangs] = useState<Record<number, string[]>>({});
  const [optimizingTagId, setOptimizingTagId] = useState<number | null>(null);
  const [translatingTagId, setTranslatingTagId] = useState<number | null>(null);

  // AI Document Types state
  const [allDocumentTypes, setAllDocumentTypes] = useState<DocumentTypeInfo[]>([]);
  const [selectedAiDocTypes, setSelectedAiDocTypes] = useState<number[]>([]);
  const [aiDocTypesLoading, setAiDocTypesLoading] = useState(false);
  const [aiDocTypesError, setAiDocTypesError] = useState<string | null>(null);
  const [aiDocTypesHasChanges, setAiDocTypesHasChanges] = useState(false);

  // Language state
  const [availableLanguages, setAvailableLanguages] = useState<LanguageInfo[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);
  const [translationSourceLang, setTranslationSourceLang] = useState("en");
  const [translationTargetLang, setTranslationTargetLang] = useState("");
  const [translating, setTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<{
    success: boolean;
    total: number;
    successful: number;
    failed: number;
    results?: Array<{ prompt_name?: string; success: boolean; error?: string }>;
  } | null>(null);

  // Maintenance state
  const [bootstrapProgress, setBootstrapProgress] = useState<BootstrapProgress | null>(null);
  const [bootstrapStarting, setBootstrapStarting] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapDetailsOpen, setBootstrapDetailsOpen] = useState(false);
  const [scheduleStatus, setScheduleStatus] = useState<JobScheduleStatus | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);
  const [manualTriggerLoading, setManualTriggerLoading] = useState<string | null>(null);

  // Bulk OCR state
  const [bulkOCRProgress, setBulkOCRProgress] = useState<BulkOCRProgress | null>(null);
  const [bulkOCRStarting, setBulkOCRStarting] = useState(false);
  const [bulkOCRDocsPerSecond, setBulkOCRDocsPerSecond] = useState(1.0);
  const [bulkOCRSkipExisting, setBulkOCRSkipExisting] = useState(true);

  // Config import state
  const [configImporting, setConfigImporting] = useState(false);
  const [configImportResult, setConfigImportResult] = useState<{
    success: boolean;
    message: string;
    imported_keys?: string[];
  } | null>(null);

  // Database clear state
  const [dbClearing, setDbClearing] = useState(false);
  const [dbClearResult, setDbClearResult] = useState<{
    success: boolean;
    message: string;
    deleted_count?: number;
  } | null>(null);

  // ============ API Functions ============

  const fetchOllamaModels = async () => {
    setLoadingModels((prev) => ({ ...prev, ollama: true }));
    try {
      const response = await fetch(`${API_BASE}/api/settings/ollama/models`);
      const data = await response.json();
      if (data.models) {
        setOllamaModels(data.models);
      }
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
    } finally {
      setLoadingModels((prev) => ({ ...prev, ollama: false }));
    }
  };

  const fetchMistralModels = async () => {
    setLoadingModels((prev) => ({ ...prev, mistral: true }));
    try {
      const response = await fetch(`${API_BASE}/api/settings/mistral/models`);
      const data = await response.json();
      if (data.models) {
        setMistralModels(data.models);
      }
    } catch (error) {
      console.error("Failed to load Mistral models:", error);
    } finally {
      setLoadingModels((prev) => ({ ...prev, mistral: false }));
    }
  };

  const testConnection = async (service: string) => {
    setConnectionStatus((prev) => ({ ...prev, [service]: "testing" }));
    try {
      const response = await fetch(`${API_BASE}/api/settings/test-connection/${service}`, {
        method: "POST",
      });
      const data = await response.json();
      setConnectionStatus((prev) => ({
        ...prev,
        [service]: data.status === "success" ? "success" : "error",
      }));

      if (data.status === "success" && service === "ollama") {
        fetchOllamaModels();
      }
      if (data.status === "success" && service === "mistral") {
        fetchMistralModels();
      }
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
    }
  };

  const loadSettings = useCallback(async () => {
    // Helper to test a connection silently (local to avoid dependency issues)
    const testSilent = async (service: string) => {
      setConnectionStatus((prev) => ({ ...prev, [service]: "testing" }));
      try {
        const response = await fetch(`${API_BASE}/api/settings/test-connection/${service}`, {
          method: "POST",
        });
        const data = await response.json();
        setConnectionStatus((prev) => ({
          ...prev,
          [service]: data.status === "success" ? "success" : "error",
        }));
        return data.status === "success";
      } catch {
        setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
        return false;
      }
    };

    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings((prev) => ({ ...prev, ...data }));

        // Auto-test connections based on loaded settings
        const tests: Promise<boolean>[] = [];

        if (data.paperless_url && data.paperless_token) {
          tests.push(testSilent("paperless"));
        }
        if (data.ollama_url) {
          tests.push(testSilent("ollama").then(async (connected) => {
            if (connected) {
              fetchOllamaModels();
            }
            return connected;
          }));
        }
        if (data.qdrant_url) {
          tests.push(testSilent("qdrant"));
        }
        if (data.mistral_api_key) {
          tests.push(testSilent("mistral").then(async (connected) => {
            if (connected) {
              fetchMistralModels();
            }
            return connected;
          }));
        }

        await Promise.all(tests);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  const fetchLanguages = async () => {
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
  };

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

  const fetchTagsStatus = async () => {
    setTagsLoading(true);
    setTagsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/tags/status`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setTagsStatus(data);
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : "Failed to fetch tags status");
    } finally {
      setTagsLoading(false);
    }
  };

  const createMissingTags = async () => {
    if (!tagsStatus) return;

    const missingTags = tagsStatus.tags
      .filter((t) => !t.exists)
      .map((t) => t.name);

    if (missingTags.length === 0) return;

    setTagsCreating(true);
    setTagsError(null);
    setTagsSuccess(null);

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
        setTagsSuccess(`Created ${result.created.length} tag(s): ${result.created.join(", ")}`);
      }

      if (result.failed.length > 0) {
        setTagsError(`Failed to create: ${result.failed.join(", ")}`);
      }

      await fetchTagsStatus();
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : "Failed to create tags");
    } finally {
      setTagsCreating(false);
    }
  };

  const fetchCustomFields = async () => {
    setCustomFieldsLoading(true);
    setCustomFieldsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/custom-fields`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: CustomFieldsResponse = await response.json();
      setCustomFields(data.fields);
      setSelectedCustomFields(data.selected_fields);
      setCustomFieldsHasChanges(false);
    } catch (err) {
      setCustomFieldsError(err instanceof Error ? err.message : "Failed to fetch custom fields");
    } finally {
      setCustomFieldsLoading(false);
    }
  };

  const toggleCustomField = (fieldId: number) => {
    setSelectedCustomFields((prev) => {
      if (prev.includes(fieldId)) {
        return prev.filter((id) => id !== fieldId);
      } else {
        return [...prev, fieldId];
      }
    });
    setCustomFieldsHasChanges(true);
  };

  const selectAllCustomFields = () => {
    setSelectedCustomFields(customFields.map((f) => f.id));
    setCustomFieldsHasChanges(true);
  };

  const deselectAllCustomFields = () => {
    setSelectedCustomFields([]);
    setCustomFieldsHasChanges(true);
  };

  const fetchAiTags = async () => {
    setAiTagsLoading(true);
    setAiTagsError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setAllTags(data.tags || []);
      setSelectedAiTags(data.selected_tag_ids || []);
      setAiTagsHasChanges(false);

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
              const transResponse = await fetch(`${API_BASE}/api/metadata/tags/${tagId}/translations`);
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
      setAiTagsError(err instanceof Error ? err.message : "Failed to fetch tags");
    } finally {
      setAiTagsLoading(false);
    }
  };

  const toggleAiTag = (tagId: number) => {
    setSelectedAiTags((prev) => {
      if (prev.includes(tagId)) {
        return prev.filter((id) => id !== tagId);
      } else {
        return [...prev, tagId];
      }
    });
    setAiTagsHasChanges(true);
  };

  const selectAllAiTags = () => {
    setSelectedAiTags(allTags.map((t) => t.id));
    setAiTagsHasChanges(true);
  };

  const deselectAllAiTags = () => {
    setSelectedAiTags([]);
    setAiTagsHasChanges(true);
  };

  const optimizeTagDescription = async (tagId: number, tagName: string) => {
    const description = tagTranslations[tagId]?.[currentLocale] ?? tagDescriptions[tagId];
    if (!description?.trim()) return;

    setOptimizingTagId(tagId);
    try {
      const response = await fetch(`${API_BASE}/api/metadata/tags/${tagId}/optimize-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          tag_name: tagName,
        }),
      });

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

  const translateTagDescription = async (tagId: number) => {
    const description = tagTranslations[tagId]?.[currentLocale] ?? tagDescriptions[tagId];
    if (!description?.trim()) return;

    setTranslatingTagId(tagId);
    try {
      const response = await fetch(`${API_BASE}/api/metadata/tags/${tagId}/translate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          source_lang: currentLocale,
        }),
      });

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

  const fetchAiDocTypes = async () => {
    setAiDocTypesLoading(true);
    setAiDocTypesError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-document-types`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setAllDocumentTypes(data.document_types || []);
      setSelectedAiDocTypes(data.selected_type_ids || []);
      setAiDocTypesHasChanges(false);
    } catch (err) {
      setAiDocTypesError(err instanceof Error ? err.message : "Failed to fetch document types");
    } finally {
      setAiDocTypesLoading(false);
    }
  };

  const toggleAiDocType = (typeId: number) => {
    setSelectedAiDocTypes((prev) => {
      if (prev.includes(typeId)) {
        return prev.filter((id) => id !== typeId);
      } else {
        return [...prev, typeId];
      }
    });
    setAiDocTypesHasChanges(true);
  };

  const selectAllAiDocTypes = () => {
    setSelectedAiDocTypes(allDocumentTypes.map((t) => t.id));
    setAiDocTypesHasChanges(true);
  };

  const deselectAllAiDocTypes = () => {
    setSelectedAiDocTypes([]);
    setAiDocTypesHasChanges(true);
  };

  // Maintenance functions
  const loadBootstrapStatus = useCallback(async () => {
    const response = await jobsApi.getBootstrapStatus();
    if (response.data) {
      setBootstrapProgress(response.data);
    }
  }, []);

  const loadScheduleStatus = useCallback(async () => {
    setScheduleLoading(true);
    const response = await jobsApi.getSchedules();
    if (response.data) {
      setScheduleStatus(response.data);
    } else if (response.error) {
      setMaintenanceError(response.error);
    }
    setScheduleLoading(false);
  }, []);

  const handleStartBootstrap = async (type: string) => {
    setBootstrapStarting(type);
    setMaintenanceError(null);
    const response = await jobsApi.startBootstrap(type as BootstrapAnalysisType);
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBootstrapStatus();
    }
    setBootstrapStarting(null);
  };

  const handleCancelBootstrap = async () => {
    setBootstrapLoading(true);
    const response = await jobsApi.cancelBootstrap();
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBootstrapStatus();
    }
    setBootstrapLoading(false);
  };

  const handleSkipDocument = async (count: number = 1) => {
    const response = await jobsApi.skipBootstrapDocument(count);
    if (response.error) {
      setMaintenanceError(response.error);
    }
  };

  const handleScheduleUpdate = async (
    jobName: "schema_cleanup" | "metadata_enhancement",
    enabled: boolean,
    schedule: ScheduleType,
    cron?: string
  ) => {
    setScheduleSaving(jobName);
    setMaintenanceError(null);
    const response = await jobsApi.updateSchedule({
      job_name: jobName,
      enabled,
      schedule,
      cron: schedule === "cron" ? cron : undefined,
    });
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadScheduleStatus();
    }
    setScheduleSaving(null);
  };

  const handleManualTrigger = async (jobName: "schema_cleanup" | "metadata_enhancement") => {
    setManualTriggerLoading(jobName);
    setMaintenanceError(null);
    const response = jobName === "schema_cleanup"
      ? await jobsApi.triggerSchemaCleanup()
      : await jobsApi.triggerMetadataEnhancement();
    if (response.error) {
      setMaintenanceError(response.error);
    }
    setManualTriggerLoading(null);
  };

  // Bulk OCR functions
  const loadBulkOCRStatus = useCallback(async () => {
    const response = await jobsApi.getBulkOCRStatus();
    if (response.data) {
      setBulkOCRProgress(response.data);
    }
  }, []);

  const handleStartBulkOCR = async () => {
    setBulkOCRStarting(true);
    setMaintenanceError(null);
    const response = await jobsApi.startBulkOCR(bulkOCRDocsPerSecond, bulkOCRSkipExisting);
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBulkOCRStatus();
    }
    setBulkOCRStarting(false);
  };

  const handleCancelBulkOCR = async () => {
    const response = await jobsApi.cancelBulkOCR();
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBulkOCRStatus();
    }
  };

  // Import config from YAML
  const handleImportConfig = async () => {
    setConfigImporting(true);
    setConfigImportResult(null);
    setMaintenanceError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/import-config`, {
        method: "POST",
      });
      const data = await response.json();
      setConfigImportResult({
        success: data.success,
        message: data.message,
        imported_keys: data.imported_keys,
      });
      if (data.success) {
        // Reload settings after successful import
        await loadSettings();
      }
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : "Failed to import config");
      setConfigImportResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to import config",
      });
    } finally {
      setConfigImporting(false);
    }
  };

  // Clear database
  const handleClearDatabase = async () => {
    setDbClearing(true);
    setDbClearResult(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/clear-database`, {
        method: "POST",
      });
      const data = await response.json();
      setDbClearResult({
        success: data.success,
        message: data.message,
        deleted_count: data.deleted_count,
      });
      if (data.success) {
        // Reset settings to defaults after clearing
        setSettings(DEFAULT_SETTINGS);
      }
    } catch (error) {
      setDbClearResult({
        success: false,
        message: error instanceof Error ? error.message : "Failed to clear database",
      });
    } finally {
      setDbClearing(false);
    }
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        setSaveStatus("error");
        return;
      }

      // Save custom fields selection if changed
      if (customFieldsHasChanges) {
        const cfResponse = await fetch(`${API_BASE}/api/settings/custom-fields`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_field_ids: selectedCustomFields }),
        });
        if (cfResponse.ok) {
          setCustomFieldsHasChanges(false);
        }
      }

      // Save AI tags selection if changed
      if (aiTagsHasChanges) {
        const tagsResponse = await fetch(`${API_BASE}/api/settings/ai-tags`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_tag_ids: selectedAiTags }),
        });
        if (tagsResponse.ok) {
          setAiTagsHasChanges(false);
        }
      }

      // Save AI document types selection if changed
      if (aiDocTypesHasChanges) {
        const dtResponse = await fetch(`${API_BASE}/api/settings/ai-document-types`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selected_type_ids: selectedAiDocTypes }),
        });
        if (dtResponse.ok) {
          setAiDocTypesHasChanges(false);
        }
      }

      // Save tag descriptions/translations if changed
      if (tagDescriptionsHasChanges) {
        for (const tag of allTags) {
          const translations = tagTranslations[tag.id];
          if (!translations) continue;

          for (const [lang, text] of Object.entries(translations)) {
            if (!text?.trim()) continue;

            await fetch(`${API_BASE}/api/metadata/tags/${tag.id}/translations/${lang}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ lang, text }),
            });

            if (lang === "en" || !tagDescriptions[tag.id]) {
              await fetch(`${API_BASE}/api/metadata/tags/${tag.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  tag_name: tag.name,
                  description: text,
                }),
              });
            }
          }
        }
        setTagDescriptionsHasChanges(false);
      }

      setSaveStatus("success");
      if (pendingUiLocale && pendingUiLocale !== currentLocale) {
        setTimeout(() => setLocale(pendingUiLocale), 500);
      } else {
        setTimeout(() => setSaveStatus("idle"), 3000);
      }
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  // Load initial data
  useEffect(() => {
    loadSettings();
    fetchTagsStatus();
    fetchCustomFields();
    fetchAiTags();
    fetchAiDocTypes();
    fetchLanguages();
  }, [loadSettings]);

  // Load maintenance data when tab is active
  useEffect(() => {
    if (activeTab === "maintenance") {
      loadBootstrapStatus();
      loadScheduleStatus();
      loadBulkOCRStatus();
    }
  }, [activeTab, loadBootstrapStatus, loadScheduleStatus, loadBulkOCRStatus]);

  // Poll bootstrap status while running
  useEffect(() => {
    if (bootstrapProgress?.status === "running") {
      const interval = setInterval(loadBootstrapStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [bootstrapProgress?.status, loadBootstrapStatus]);

  // Poll bulk OCR status while running
  useEffect(() => {
    if (bulkOCRProgress?.status === "running") {
      const interval = setInterval(loadBulkOCRStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [bulkOCRProgress?.status, loadBulkOCRStatus]);

  return {
    // Tab
    activeTab,
    setActiveTab,
    VALID_TABS,

    // Settings
    settings,
    updateSetting,
    saving,
    saveStatus,
    handleSave,
    pendingUiLocale,
    setPendingUiLocale,
    currentLocale,

    // Connections
    connectionStatus,
    testConnection,
    showSecrets,
    setShowSecrets,
    ollamaModels,
    mistralModels,
    loadingModels,
    fetchOllamaModels,
    loadMistralModels: fetchMistralModels,

    // Workflow Tags
    tagsStatus,
    tagsLoading,
    tagsCreating,
    tagsError,
    tagsSuccess,
    fetchTagsStatus,
    createMissingTags,

    // Custom Fields
    customFields,
    selectedCustomFields,
    customFieldsLoading,
    customFieldsError,
    customFieldsHasChanges,
    toggleCustomField,
    selectAllCustomFields,
    deselectAllCustomFields,

    // AI Tags
    allTags,
    selectedAiTags,
    aiTagsLoading,
    aiTagsError,
    aiTagsHasChanges,
    toggleAiTag,
    selectAllAiTags,
    deselectAllAiTags,
    tagDescriptions,
    setTagDescriptions,
    expandedTagId,
    setExpandedTagId,
    tagDescriptionsHasChanges,
    setTagDescriptionsHasChanges,
    tagTranslations,
    setTagTranslations,
    tagTranslatedLangs,
    setTagTranslatedLangs,
    optimizingTagId,
    translatingTagId,
    optimizeTagDescription,
    translateTagDescription,

    // AI Document Types
    allDocumentTypes,
    selectedAiDocTypes,
    aiDocTypesLoading,
    aiDocTypesError,
    aiDocTypesHasChanges,
    toggleAiDocType,
    selectAllAiDocTypes,
    deselectAllAiDocTypes,

    // Language
    availableLanguages,
    languagesLoading,
    translationSourceLang,
    setTranslationSourceLang,
    translationTargetLang,
    setTranslationTargetLang,
    translating,
    translationResult,
    translatePrompts,

    // Maintenance
    bootstrapProgress,
    bootstrapStarting,
    bootstrapLoading,
    bootstrapDetailsOpen,
    setBootstrapDetailsOpen,
    isBootstrapRunning: bootstrapProgress?.status === "running",
    bootstrapProgressPercent: bootstrapProgress?.total
      ? Math.round((bootstrapProgress.processed / bootstrapProgress.total) * 100)
      : 0,
    handleStartBootstrap,
    handleCancelBootstrap,
    handleSkipDocument,
    scheduleStatus,
    scheduleLoading,
    scheduleSaving,
    handleScheduleUpdate,
    maintenanceError,
    setMaintenanceError,
    manualTriggerLoading,
    handleManualTrigger,

    // Bulk OCR
    bulkOCRProgress,
    bulkOCRStarting,
    bulkOCRDocsPerSecond,
    setBulkOCRDocsPerSecond,
    bulkOCRSkipExisting,
    setBulkOCRSkipExisting,
    isBulkOCRRunning: bulkOCRProgress?.status === "running",
    bulkOCRProgressPercent: bulkOCRProgress?.total
      ? Math.round((bulkOCRProgress.processed / bulkOCRProgress.total) * 100)
      : 0,
    handleStartBulkOCR,
    handleCancelBulkOCR,

    // Config Import
    configImporting,
    configImportResult,
    handleImportConfig,

    // Database Clear
    dbClearing,
    dbClearResult,
    handleClearDatabase,
  };
}

export type UseSettingsReturn = ReturnType<typeof useSettings>;
