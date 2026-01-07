"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { locales, localeNames, type Locale } from "@/i18n/config";
import { setLocale } from "@/lib/locale";
import {
  Save,
  TestTube,
  Server,
  Clock,
  Tag,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Brain,
  Database,
  Zap,
  Bug,
  GitBranch,
  Eye,
  EyeOff,
  Plus,
  Check,
  X,
  AlertCircle,
  Globe,
  ChevronUp,
  ChevronDown,
  FileText,
  Sparkles,
  Languages,
  Wrench,
  Play,
  Square,
  User,
  Calendar,
  SkipForward,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Label,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Badge,
  Separator,
  Alert,
  AlertDescription,
  AlertTitle,
  Progress,
} from "@repo/ui";
import {
  jobsApi,
  BootstrapProgress,
  BootstrapAnalysisType,
  JobScheduleStatus,
  ScheduleType,
  BulkOCRProgress,
} from "@/lib/api";
import { ModelCombobox } from "@/components/model-combobox";
import { ArrowRight } from "lucide-react";

// Types
interface OllamaModel {
  name: string;
  size: string;
  modified: string;
  digest: string;
}

interface MistralModel {
  id: string;
  name: string;
}

interface TagStatus {
  key: string;
  name: string;
  exists: boolean;
  tag_id: number | null;
}

interface TagsStatusResponse {
  tags: TagStatus[];
  all_exist: boolean;
  missing_count: number;
}

interface CustomField {
  id: number;
  name: string;
  data_type: string;
  extra_data: Record<string, unknown> | null;
}

interface CustomFieldsResponse {
  fields: CustomField[];
  selected_fields: number[];
}

interface Settings {
  // External Services
  paperless_url: string;
  paperless_token: string;
  mistral_api_key: string;
  mistral_model: string;
  ollama_url: string;
  ollama_model_large: string;
  ollama_model_small: string;
  ollama_model_translation: string;
  ollama_embedding_model: string;
  ollama_thinking_enabled: boolean;
  ollama_thinking_level: "low" | "medium" | "high";
  qdrant_url: string;
  qdrant_collection: string;
  // Processing
  auto_processing_enabled: boolean;
  auto_processing_interval_minutes: number;
  auto_processing_pause_on_user_activity: boolean;
  confirmation_max_retries: number;
  confirmation_require_user_for_new_entities: boolean;
  // Pipeline
  pipeline_ocr: boolean;
  pipeline_title: boolean;
  pipeline_correspondent: boolean;
  pipeline_tags: boolean;
  pipeline_custom_fields: boolean;
  // Vector Search
  vector_search_enabled: boolean;
  vector_search_top_k: number;
  vector_search_min_score: number;
  // Language
  prompt_language: string;
  // Debug
  debug_log_level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  debug_log_prompts: boolean;
  debug_log_responses: boolean;
  debug_save_processing_history: boolean;
  // Tags
  tags: {
    pending: string;
    ocr_done: string;
    schema_review: string;
    correspondent_done: string;
    document_type_done: string;
    title_done: string;
    tags_done: string;
    processed: string;
  };
}

interface LanguageInfo {
  code: string;
  name: string;
  prompt_count: number;
  is_complete: boolean;
}

type ConnectionStatus = "idle" | "testing" | "success" | "error";

function StatusIndicator({ status }: { status: ConnectionStatus }) {
  switch (status) {
    case "testing":
      return <Loader2 className="h-4 w-4 animate-spin text-amber-500" />;
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <div className="h-4 w-4 rounded-full bg-zinc-300 dark:bg-zinc-600" />;
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function formatETA(seconds: number): string {
  if (seconds < 60) {
    return `~${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `~${mins}m ${secs}s`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `~${hours}h ${mins}m`;
  }
}

const VALID_TABS = ["connections", "processing", "pipeline", "custom-fields", "ai-tags", "ai-document-types", "workflow-tags", "language", "advanced", "maintenance"] as const;
type SettingsTab = typeof VALID_TABS[number];

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const currentLocale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get initial tab from URL or default to "connections"
  const tabParam = searchParams.get("tab");
  const initialTab: SettingsTab = VALID_TABS.includes(tabParam as SettingsTab)
    ? (tabParam as SettingsTab)
    : "connections";
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab as SettingsTab);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`/settings?${params.toString()}`, { scroll: false });
  };
  const [settings, setSettings] = useState<Settings>({
    paperless_url: "",
    paperless_token: "",
    mistral_api_key: "",
    mistral_model: "mistral-ocr-latest",
    ollama_url: "",
    ollama_model_large: "",
    ollama_model_small: "",
    ollama_model_translation: "",
    ollama_embedding_model: "",
    ollama_thinking_enabled: true,
    ollama_thinking_level: "high",
    qdrant_url: "",
    qdrant_collection: "paperless-documents",
    auto_processing_enabled: false,
    auto_processing_interval_minutes: 10,
    auto_processing_pause_on_user_activity: true,
    confirmation_max_retries: 3,
    confirmation_require_user_for_new_entities: true,
    pipeline_ocr: true,
    pipeline_title: true,
    pipeline_correspondent: true,
    pipeline_tags: true,
    pipeline_custom_fields: true,
    vector_search_enabled: true,
    vector_search_top_k: 5,
    vector_search_min_score: 0.7,
    prompt_language: "en",
    debug_log_level: "INFO",
    debug_log_prompts: false,
    debug_log_responses: false,
    debug_save_processing_history: true,
    tags: {
      pending: "llm-pending",
      ocr_done: "llm-ocr-done",
      schema_review: "llm-schema-review",
      correspondent_done: "llm-correspondent-done",
      document_type_done: "llm-document-type-done",
      title_done: "llm-title-done",
      tags_done: "llm-tags-done",
      processed: "llm-processed",
    },
  });

  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({
    paperless: "idle",
    ollama: "idle",
    qdrant: "idle",
    mistral: "idle",
  });

  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [mistralModels, setMistralModels] = useState<MistralModel[]>([]);
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({
    ollama: false,
    mistral: false,
  });

  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle");
  const [pendingUiLocale, setPendingUiLocale] = useState<Locale | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({
    paperless_token: false,
    mistral_api_key: false,
  });

  // Tags status state
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

  // AI Tags state - which tags AI can suggest
  interface PaperlessTag {
    id: number;
    name: string;
    color: string;
    matching_algorithm: number;
    document_count: number;
  }
  const [allTags, setAllTags] = useState<PaperlessTag[]>([]);
  const [selectedAiTags, setSelectedAiTags] = useState<number[]>([]);
  const [aiTagsLoading, setAiTagsLoading] = useState(false);
  const [aiTagsError, setAiTagsError] = useState<string | null>(null);
  const [aiTagsHasChanges, setAiTagsHasChanges] = useState(false);

  // Tag Descriptions state (metadata)
  const [tagDescriptions, setTagDescriptions] = useState<Record<number, string>>({});
  const [expandedTagId, setExpandedTagId] = useState<number | null>(null);
  const [tagDescriptionsHasChanges, setTagDescriptionsHasChanges] = useState(false);

  // Tag translations state
  const [tagTranslations, setTagTranslations] = useState<Record<number, Record<string, string>>>({}); // tagId -> {lang -> text}
  const [tagTranslatedLangs, setTagTranslatedLangs] = useState<Record<number, string[]>>({}); // tagId -> [langs]
  const [optimizingTagId, setOptimizingTagId] = useState<number | null>(null);
  const [translatingTagId, setTranslatingTagId] = useState<number | null>(null);

  // AI Document Types state
  interface DocumentTypeInfo {
    id: number;
    name: string;
    document_count: number;
  }
  const [allDocumentTypes, setAllDocumentTypes] = useState<DocumentTypeInfo[]>([]);
  const [selectedAiDocTypes, setSelectedAiDocTypes] = useState<number[]>([]);
  const [aiDocTypesLoading, setAiDocTypesLoading] = useState(false);
  const [aiDocTypesError, setAiDocTypesError] = useState<string | null>(null);
  const [aiDocTypesHasChanges, setAiDocTypesHasChanges] = useState(false);

  // Language state
  const [availableLanguages, setAvailableLanguages] = useState<LanguageInfo[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);

  // Translation state
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

  // Maintenance / Bootstrap state
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

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      if (response.ok) {
        const data = await response.json();
        setSettings((prev) => ({ ...prev, ...data }));
        // Auto-test all connections after loading settings
        autoTestConnections(data);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  // Fetch available languages
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

  // Translate all prompts
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
        // Refresh languages list to show new prompt count
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

  // Load settings, auto-test connections, check tags, and fetch custom fields on mount
  useEffect(() => {
    loadSettings();
    fetchTagsStatus();
    fetchCustomFields();
    fetchAiTags();
    fetchAiDocTypes();
    fetchLanguages();
  }, [loadSettings]);

  const autoTestConnections = async (loadedSettings: Partial<Settings>) => {
    // Test each service if it has the required config
    const tests: Promise<void>[] = [];

    if (loadedSettings.paperless_url && loadedSettings.paperless_token) {
      tests.push(testConnectionSilent("paperless"));
    }
    if (loadedSettings.ollama_url) {
      tests.push(testConnectionSilent("ollama"));
    }
    if (loadedSettings.qdrant_url) {
      tests.push(testConnectionSilent("qdrant"));
    }
    if (loadedSettings.mistral_api_key) {
      tests.push(testConnectionSilent("mistral"));
    }

    await Promise.all(tests);
  };

  const testConnectionSilent = async (service: string) => {
    setConnectionStatus((prev) => ({ ...prev, [service]: "testing" }));
    try {
      const response = await fetch(`${API_BASE}/api/settings/test-connection/${service}`, {
        method: "POST",
      });
      const data = await response.json();
      setConnectionStatus((prev) => ({
        ...prev,
        [service]: data.status === "connected" ? "success" : "error",
      }));

      // If connection successful, load models directly (avoid stale closure)
      if (data.status === "connected" && service === "ollama") {
        fetchOllamaModels();
      }
      if (data.status === "connected" && service === "mistral") {
        fetchMistralModels();
      }
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
    }
  };

  // Direct fetch functions that don't depend on settings state
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
        [service]: data.status === "connected" ? "success" : "error",
      }));

      // If connection successful, load models
      if (data.status === "connected" && service === "ollama") {
        fetchOllamaModels();
      }
      if (data.status === "connected" && service === "mistral") {
        fetchMistralModels();
      }
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
    }
  };

  // Load Ollama models (available for future use)
  const _loadOllamaModels = useCallback(async () => {
    if (!settings.ollama_url) return;
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
  }, [settings.ollama_url]);

  const loadMistralModels = useCallback(async () => {
    if (!settings.mistral_api_key) return;
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
  }, [settings.mistral_api_key]);

  const handleSave = async () => {
    setSaving(true);
    setSaveStatus("idle");
    try {
      // Save main settings
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

          // Save each language's translation
          for (const [lang, text] of Object.entries(translations)) {
            if (!text?.trim()) continue;

            // Save translation for this language
            await fetch(`${API_BASE}/api/metadata/tags/${tag.id}/translations/${lang}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lang,
                text,
              }),
            });

            // Also update main tag metadata with first available description (prefer en)
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
      // Apply UI locale change after successful save
      if (pendingUiLocale && pendingUiLocale !== currentLocale) {
        // Brief delay to show success state before reload
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

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Fetch workflow tags status from Paperless
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

  // Create missing workflow tags in Paperless
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

      // Refresh status
      await fetchTagsStatus();
    } catch (err) {
      setTagsError(err instanceof Error ? err.message : "Failed to create tags");
    } finally {
      setTagsCreating(false);
    }
  };

  // Fetch custom fields from Paperless
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

  // Toggle a custom field selection
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

  // Fetch all tags from Paperless for AI selection
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

  // Toggle an AI tag selection
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

  // Optimize a tag description using AI (for current locale)
  const optimizeTagDescription = async (tagId: number, tagName: string) => {
    // Get description for current locale, fall back to original
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
        // Update only the current locale's translation
        setTagTranslations((prev) => ({
          ...prev,
          [tagId]: {
            ...prev[tagId],
            [currentLocale]: data.optimized,
          },
        }));
        // Track that this language now has a translation
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

  // Translate a tag description from current locale to all other languages
  const translateTagDescription = async (tagId: number) => {
    // Get description for current locale, fall back to original
    const description = tagTranslations[tagId]?.[currentLocale] ?? tagDescriptions[tagId];
    if (!description?.trim()) return;

    setTranslatingTagId(tagId);
    try {
      const response = await fetch(`${API_BASE}/api/metadata/tags/${tagId}/translate-description`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          source_lang: currentLocale, // Translate from current UI language
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Merge new translations with existing (keep current locale's version)
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

  // Fetch all document types from Paperless for AI selection
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

  // Toggle an AI document type selection
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

  // Maintenance functions
  const tMaint = useTranslations("maintenance");

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

  // Load maintenance data when tab is active
  useEffect(() => {
    if (activeTab === "maintenance") {
      loadBootstrapStatus();
      loadScheduleStatus();
    }
  }, [activeTab, loadBootstrapStatus, loadScheduleStatus]);

  // Poll bootstrap status while running
  useEffect(() => {
    if (bootstrapProgress?.status === "running") {
      const interval = setInterval(loadBootstrapStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [bootstrapProgress?.status, loadBootstrapStatus]);

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
    // Don't reload status - it will be picked up by the polling
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

  // Poll bulk OCR status while running
  useEffect(() => {
    if (bulkOCRProgress?.status === "running") {
      const interval = setInterval(loadBulkOCRStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [bulkOCRProgress?.status, loadBulkOCRStatus]);

  // Load bulk OCR status when maintenance tab is active
  useEffect(() => {
    if (activeTab === "maintenance") {
      loadBulkOCRStatus();
    }
  }, [activeTab, loadBulkOCRStatus]);

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
    setMaintenanceError(null);
    const response = await jobsApi.cancelBulkOCR();
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBulkOCRStatus();
    }
  };

  const bulkOCRProgressPercent = bulkOCRProgress?.total
    ? Math.round((bulkOCRProgress.processed / bulkOCRProgress.total) * 100)
    : 0;
  const isBulkOCRRunning = bulkOCRProgress?.status === "running";

  const formatMaintenanceDate = (dateString: string | null) => {
    if (!dateString) return tMaint("scheduled.never");
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const bootstrapProgressPercent = bootstrapProgress?.total
    ? Math.round((bootstrapProgress.processed / bootstrapProgress.total) * 100)
    : 0;

  const isBootstrapRunning = bootstrapProgress?.status === "running";

  // Data type icons for custom fields
  const DATA_TYPE_ICONS: Record<string, React.ReactNode> = {
    string: <FileText className="h-4 w-4" />,
    url: <ArrowRight className="h-4 w-4" />,
    date: <Clock className="h-4 w-4" />,
    boolean: <CheckCircle2 className="h-4 w-4" />,
    integer: <Database className="h-4 w-4" />,
    float: <Database className="h-4 w-4" />,
    monetary: <Database className="h-4 w-4" />,
    documentlink: <FileText className="h-4 w-4" />,
    select: <Tag className="h-4 w-4" />,
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
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {saving ? (
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

          {/* ============================================================= */}
          {/* CONNECTIONS TAB */}
          {/* ============================================================= */}
          <TabsContent value="connections" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Paperless-ngx */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StatusIndicator status={connectionStatus.paperless} />
                    {t("paperless.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("paperless.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="paperless_url">{t("paperless.serverUrl")}</Label>
                    <Input
                      id="paperless_url"
                      placeholder="http://your-paperless:8000"
                      value={settings.paperless_url}
                      onChange={(e) => updateSetting("paperless_url", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paperless_token">{t("paperless.apiToken")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="paperless_token"
                        type={showSecrets.paperless_token ? "text" : "password"}
                        placeholder="Your Paperless API token"
                        value={settings.paperless_token}
                        onChange={(e) => updateSetting("paperless_token", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        onClick={() => setShowSecrets((prev) => ({ ...prev, paperless_token: !prev.paperless_token }))}
                      >
                        {showSecrets.paperless_token ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => testConnection("paperless")}
                    disabled={connectionStatus.paperless === "testing"}
                  >
                    {connectionStatus.paperless === "testing" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <TestTube className="mr-2 h-4 w-4" />
                    )}
                    {t("testConnection")}
                  </Button>
                </CardContent>
              </Card>

              {/* Ollama */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StatusIndicator status={connectionStatus.ollama} />
                    {t("ollama.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("ollama.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ollama_url">{t("ollama.serverUrl")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="ollama_url"
                        placeholder="http://your-ollama:11434"
                        value={settings.ollama_url}
                        onChange={(e) => updateSetting("ollama_url", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection("ollama")}
                        disabled={connectionStatus.ollama === "testing"}
                      >
                        {connectionStatus.ollama === "testing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {/* Model Selection */}
                  {ollamaModels.length > 0 && (
                    <>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{t("ollama.availableModels")} ({ollamaModels.length})</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={fetchOllamaModels}
                          disabled={loadingModels.ollama}
                        >
                          <RefreshCw className={`h-4 w-4 ${loadingModels.ollama ? "animate-spin" : ""}`} />
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <Label>{t("ollama.largeModel")}</Label>
                        <ModelCombobox
                          models={ollamaModels}
                          value={settings.ollama_model_large}
                          onValueChange={(v) => updateSetting("ollama_model_large", v)}
                          placeholder="Select large model..."
                          searchPlaceholder="Search models..."
                          emptyText="No model found."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("ollama.smallModel")}</Label>
                        <ModelCombobox
                          models={ollamaModels}
                          value={settings.ollama_model_small}
                          onValueChange={(v) => updateSetting("ollama_model_small", v)}
                          placeholder="Select small model..."
                          searchPlaceholder="Search models..."
                          emptyText="No model found."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("ollama.embeddingModel")}</Label>
                        <ModelCombobox
                          models={ollamaModels}
                          value={settings.ollama_embedding_model}
                          onValueChange={(v) => updateSetting("ollama_embedding_model", v)}
                          placeholder="Select embedding model..."
                          searchPlaceholder="Search models..."
                          emptyText="No model found."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>{t("ollama.translationModel")}</Label>
                        <ModelCombobox
                          models={ollamaModels}
                          value={settings.ollama_model_translation}
                          onValueChange={(v) => updateSetting("ollama_model_translation", v)}
                          placeholder="Select translation model (optional)..."
                          searchPlaceholder="Search models..."
                          emptyText="No model found."
                        />
                        <p className="text-xs text-zinc-500">
                          {t("ollama.translationModelDesc")}
                        </p>
                      </div>
                    </>
                  )}

                  {/* Thinking Mode */}
                  <Separator />
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="flex items-center gap-2">
                          <Brain className="h-4 w-4" />
                          {t("ollama.thinkingMode")}
                        </Label>
                        <p className="text-xs text-zinc-500">
                          {t("ollama.thinkingModeDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={settings.ollama_thinking_enabled}
                        onCheckedChange={(v) => updateSetting("ollama_thinking_enabled", v)}
                      />
                    </div>

                    {settings.ollama_thinking_enabled && (
                      <div className="space-y-2">
                        <Label>{t("ollama.thinkingLevel")}</Label>
                        <Select
                          value={settings.ollama_thinking_level}
                          onValueChange={(v) => updateSetting("ollama_thinking_level", v as "low" | "medium" | "high")}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">{t("ollama.thinkingLow")}</SelectItem>
                            <SelectItem value="medium">{t("ollama.thinkingMedium")}</SelectItem>
                            <SelectItem value="high">{t("ollama.thinkingHigh")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Mistral AI */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StatusIndicator status={connectionStatus.mistral} />
                    {t("mistral.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("mistral.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mistral_api_key">{t("mistral.apiKey")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="mistral_api_key"
                        type={showSecrets.mistral_api_key ? "text" : "password"}
                        placeholder="Your Mistral API key"
                        value={settings.mistral_api_key}
                        onChange={(e) => updateSetting("mistral_api_key", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        onClick={() => setShowSecrets((prev) => ({ ...prev, mistral_api_key: !prev.mistral_api_key }))}
                      >
                        {showSecrets.mistral_api_key ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection("mistral")}
                        disabled={connectionStatus.mistral === "testing"}
                      >
                        {connectionStatus.mistral === "testing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>{t("mistral.ocrModel")}</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadMistralModels}
                        disabled={loadingModels.mistral}
                      >
                        <RefreshCw className={`h-4 w-4 ${loadingModels.mistral ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    <ModelCombobox
                      models={mistralModels.map(m => ({ name: m.name, value: m.id }))}
                      value={settings.mistral_model}
                      onValueChange={(v) => updateSetting("mistral_model", v)}
                      placeholder="Select OCR model..."
                      searchPlaceholder="Search models..."
                      emptyText="No models found. Click refresh to load."
                      disabled={loadingModels.mistral}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Qdrant */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StatusIndicator status={connectionStatus.qdrant} />
                    <Database className="h-4 w-4" />
                    {t("qdrant.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("qdrant.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="qdrant_url">{t("qdrant.serverUrl")}</Label>
                    <div className="flex gap-2">
                      <Input
                        id="qdrant_url"
                        placeholder="http://your-qdrant:6333"
                        value={settings.qdrant_url}
                        onChange={(e) => updateSetting("qdrant_url", e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => testConnection("qdrant")}
                        disabled={connectionStatus.qdrant === "testing"}
                      >
                        {connectionStatus.qdrant === "testing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <TestTube className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="qdrant_collection">{t("qdrant.collectionName")}</Label>
                    <Input
                      id="qdrant_collection"
                      placeholder="paperless-documents"
                      value={settings.qdrant_collection}
                      onChange={(e) => updateSetting("qdrant_collection", e.target.value)}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>{t("qdrant.vectorSearch")}</Label>
                        <p className="text-xs text-zinc-500">
                          {t("qdrant.vectorSearchDesc")}
                        </p>
                      </div>
                      <Switch
                        checked={settings.vector_search_enabled}
                        onCheckedChange={(v) => updateSetting("vector_search_enabled", v)}
                      />
                    </div>

                    {settings.vector_search_enabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>{t("qdrant.topKResults")}</Label>
                          <Input
                            type="number"
                            min={1}
                            max={20}
                            value={settings.vector_search_top_k}
                            onChange={(e) => updateSetting("vector_search_top_k", parseInt(e.target.value) || 5)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{t("qdrant.minScore")}</Label>
                          <Input
                            type="number"
                            min={0}
                            max={1}
                            step={0.1}
                            value={settings.vector_search_min_score}
                            onChange={(e) => updateSetting("vector_search_min_score", parseFloat(e.target.value) || 0.7)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============================================================= */}
          {/* PROCESSING TAB */}
          {/* ============================================================= */}
          <TabsContent value="processing" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Auto-Processing */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    {t("autoProcessing.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("autoProcessing.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{t("autoProcessing.enable")}</Label>
                      <p className="text-xs text-zinc-500">
                        {t("autoProcessing.enableDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={settings.auto_processing_enabled}
                      onCheckedChange={(v) => updateSetting("auto_processing_enabled", v)}
                    />
                  </div>

                  {settings.auto_processing_enabled && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label>{t("autoProcessing.checkInterval")}</Label>
                        <Select
                          value={settings.auto_processing_interval_minutes.toString()}
                          onValueChange={(v) => updateSetting("auto_processing_interval_minutes", parseInt(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">{t("autoProcessing.everyMinute")}</SelectItem>
                            <SelectItem value="5">{t("autoProcessing.every5Minutes")}</SelectItem>
                            <SelectItem value="10">{t("autoProcessing.every10Minutes")}</SelectItem>
                            <SelectItem value="30">{t("autoProcessing.every30Minutes")}</SelectItem>
                            <SelectItem value="60">{t("autoProcessing.everyHour")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>{t("autoProcessing.pauseOnActivity")}</Label>
                          <p className="text-xs text-zinc-500">
                            {t("autoProcessing.pauseOnActivityDesc")}
                          </p>
                        </div>
                        <Switch
                          checked={settings.auto_processing_pause_on_user_activity}
                          onCheckedChange={(v) => updateSetting("auto_processing_pause_on_user_activity", v)}
                        />
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* Confirmation Loop */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Brain className="h-5 w-5" />
                    {t("confirmation.title")}
                  </CardTitle>
                  <CardDescription>
                    {t("confirmation.description")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("confirmation.maxRetries")}</Label>
                    <p className="text-xs text-zinc-500">
                      {t("confirmation.maxRetriesDesc")}
                    </p>
                    <Select
                      value={settings.confirmation_max_retries.toString()}
                      onValueChange={(v) => updateSetting("confirmation_max_retries", parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">{t("confirmation.retries", { count: 1 })}</SelectItem>
                        <SelectItem value="2">{t("confirmation.retries", { count: 2 })}</SelectItem>
                        <SelectItem value="3">{t("confirmation.retries", { count: 3 })}</SelectItem>
                        <SelectItem value="5">{t("confirmation.retries", { count: 5 })}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>{t("confirmation.requireUser")}</Label>
                      <p className="text-xs text-zinc-500">
                        {t("confirmation.requireUserDesc")}
                      </p>
                    </div>
                    <Switch
                      checked={settings.confirmation_require_user_for_new_entities}
                      onCheckedChange={(v) => updateSetting("confirmation_require_user_for_new_entities", v)}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============================================================= */}
          {/* PIPELINE TAB */}
          {/* ============================================================= */}
          <TabsContent value="pipeline" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("pipeline.title")}</CardTitle>
                <CardDescription>
                  {t("pipeline.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { key: "pipeline_ocr" as const, labelKey: "pipeline.ocr", descKey: "pipeline.ocrDesc" },
                    { key: "pipeline_title" as const, labelKey: "pipeline.titleGeneration", descKey: "pipeline.titleDesc" },
                    { key: "pipeline_correspondent" as const, labelKey: "pipeline.correspondent", descKey: "pipeline.correspondentDesc" },
                    { key: "pipeline_tags" as const, labelKey: "pipeline.tags", descKey: "pipeline.tagsDesc" },
                    { key: "pipeline_custom_fields" as const, labelKey: "pipeline.customFields", descKey: "pipeline.customFieldsDesc" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <Label>{t(item.labelKey)}</Label>
                        <p className="text-xs text-zinc-500">{t(item.descKey)}</p>
                      </div>
                      <Switch
                        checked={settings[item.key]}
                        onCheckedChange={(v) => updateSetting(item.key, v)}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* CUSTOM FIELDS TAB */}
          {/* ============================================================= */}
          <TabsContent value="custom-fields" className="space-y-6">
            {/* Header Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      {t("customFields.title")}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t("customFields.description")}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchCustomFields}
                    disabled={customFieldsLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${customFieldsLoading ? "animate-spin" : ""}`} />
                    {tCommon("refresh")}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Error Message */}
            {customFieldsError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tCommon("error")}</AlertTitle>
                <AlertDescription>{customFieldsError}</AlertDescription>
              </Alert>
            )}

            {/* Loading State */}
            {customFieldsLoading && customFields.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                    <p className="text-sm text-zinc-500">{t("customFields.loadingFields")}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* No Fields */}
            {!customFieldsLoading && customFields.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
                    <FileText className="h-12 w-12 text-zinc-300" />
                    <p className="text-lg font-medium">{t("customFields.noFieldsFound")}</p>
                    <p className="text-sm">
                      {t("customFields.noFieldsDesc")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Fields List */}
            {customFields.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{t("customFields.availableFields")}</CardTitle>
                      <CardDescription>
                        {t("customFields.fieldsSelected", { selected: selectedCustomFields.length, total: customFields.length })}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCustomFields(customFields.map((f) => f.id));
                          setCustomFieldsHasChanges(true);
                        }}
                      >
                        {tCommon("selectAll")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCustomFields([]);
                          setCustomFieldsHasChanges(true);
                        }}
                      >
                        {tCommon("clear")}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {customFields.map((field) => (
                      <div
                        key={field.id}
                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4"
                        onClick={() => toggleCustomField(field.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                              selectedCustomFields.includes(field.id)
                                ? "bg-emerald-600 border-emerald-600"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
                          >
                            {selectedCustomFields.includes(field.id) && (
                              <Check className="h-3 w-3 text-white" />
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                              {DATA_TYPE_ICONS[field.data_type] || <FileText className="h-4 w-4" />}
                            </div>
                            <div>
                              <p className="font-medium">{field.name}</p>
                              <p className="text-sm text-zinc-500 capitalize">
                                {field.data_type}
                                {Array.isArray(field.extra_data?.select_options) && (
                                  <span className="ml-2">
                                    ({t("customFields.options", { count: (field.extra_data.select_options as unknown[]).length })})
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={selectedCustomFields.includes(field.id) ? "default" : "secondary"}
                          className={selectedCustomFields.includes(field.id) ? "bg-emerald-600" : ""}
                        >
                          {selectedCustomFields.includes(field.id) ? tCommon("enabled") : tCommon("disabled")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================= */}
          {/* AI TAGS TAB */}
          {/* ============================================================= */}
          <TabsContent value="ai-tags" className="space-y-6">
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
                    disabled={aiTagsLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${aiTagsLoading ? "animate-spin" : ""}`} />
                    {tCommon("refresh")}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Error Message */}
            {aiTagsError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tCommon("error")}</AlertTitle>
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
                    <p className="text-sm">
                      {t("aiTags.noTagsDesc")}
                    </p>
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
                        {t("aiTags.tagsEnabled", { selected: selectedAiTags.length, total: allTags.length })}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiTags(allTags.map((tg) => tg.id));
                          setAiTagsHasChanges(true);
                        }}
                      >
                        {tCommon("selectAll")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiTags([]);
                          setAiTagsHasChanges(true);
                        }}
                      >
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
                              {selectedAiTags.includes(tag.id) ? t("aiTags.aiEnabled") : t("aiTags.aiDisabled")}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setExpandedTagId(expandedTagId === tag.id ? null : tag.id)}
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
                        {expandedTagId === tag.id && (() => {
                          // Get current value: prefer translation for current locale, fall back to original
                          const currentValue = tagTranslations[tag.id]?.[currentLocale]
                            ?? tagDescriptions[tag.id]
                            ?? "";
                          const otherLangs = tagTranslatedLangs[tag.id]?.filter(l => l !== currentLocale) ?? [];

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
                                // Update translation for current locale
                                setTagTranslations((prev) => ({
                                  ...prev,
                                  [tag.id]: {
                                    ...prev[tag.id],
                                    [currentLocale]: e.target.value,
                                  },
                                }));
                                // Track that this language now has a translation
                                setTagTranslatedLangs((prev) => {
                                  const existing = prev[tag.id] || [];
                                  if (!existing.includes(currentLocale)) {
                                    return { ...prev, [tag.id]: [...existing, currentLocale] };
                                  }
                                  return prev;
                                });
                                setTagDescriptionsHasChanges(true);
                              }}
                            />
                            {/* Show other available translations */}
                            {otherLangs.length > 0 && (
                              <p className="mt-2 text-xs text-zinc-500">
                                {t("aiTags.alsoAvailableIn", { langs: otherLangs.map(l => localeNames[l as Locale] || l).join(", ") })}
                              </p>
                            )}
                          </div>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================= */}
          {/* AI DOCUMENT TYPES TAB */}
          {/* ============================================================= */}
          <TabsContent value="ai-document-types" className="space-y-6">
            {/* Header Card */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      {t("aiDocumentTypes.title")}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {t("aiDocumentTypes.description")}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchAiDocTypes}
                    disabled={aiDocTypesLoading}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${aiDocTypesLoading ? "animate-spin" : ""}`} />
                    {tCommon("refresh")}
                  </Button>
                </div>
              </CardHeader>
            </Card>

            {/* Error Message */}
            {aiDocTypesError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tCommon("error")}</AlertTitle>
                <AlertDescription>{aiDocTypesError}</AlertDescription>
              </Alert>
            )}

            {/* Loading State */}
            {aiDocTypesLoading && allDocumentTypes.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                    <p className="text-sm text-zinc-500">{t("aiDocumentTypes.loadingDocTypes")}</p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* No Document Types */}
            {!aiDocTypesLoading && allDocumentTypes.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
                    <FileText className="h-12 w-12 text-zinc-300" />
                    <p className="text-lg font-medium">{t("aiDocumentTypes.noTypesFound")}</p>
                    <p className="text-sm">
                      {t("aiDocumentTypes.noTypesDesc")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Document Types List */}
            {allDocumentTypes.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{t("aiDocumentTypes.availableTypes")}</CardTitle>
                      <CardDescription>
                        {t("aiDocumentTypes.typesEnabled", { selected: selectedAiDocTypes.length, total: allDocumentTypes.length })}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiDocTypes(allDocumentTypes.map((dt) => dt.id));
                          setAiDocTypesHasChanges(true);
                        }}
                      >
                        {tCommon("selectAll")}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiDocTypes([]);
                          setAiDocTypesHasChanges(true);
                        }}
                      >
                        {tCommon("clear")}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {allDocumentTypes.map((docType) => (
                      <div
                        key={docType.id}
                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4"
                        onClick={() => toggleAiDocType(docType.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                              selectedAiDocTypes.includes(docType.id)
                                ? "bg-emerald-600 border-emerald-600"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
                          >
                            {selectedAiDocTypes.includes(docType.id) && (
                              <Check className="h-3 w-3 text-white" />
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <p className="font-medium">{docType.name}</p>
                              <p className="text-sm text-zinc-500">
                                {t("aiDocumentTypes.documentCount", { count: docType.document_count })}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={selectedAiDocTypes.includes(docType.id) ? "default" : "secondary"}
                          className={selectedAiDocTypes.includes(docType.id) ? "bg-emerald-600" : ""}
                        >
                          {selectedAiDocTypes.includes(docType.id) ? t("aiDocumentTypes.aiEnabled") : t("aiDocumentTypes.aiDisabled")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ============================================================= */}
          {/* WORKFLOW TAGS TAB */}
          {/* ============================================================= */}
          <TabsContent value="workflow-tags" className="space-y-6">
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
                      disabled={tagsLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${tagsLoading ? "animate-spin" : ""}`} />
                      {tCommon("refresh")}
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
                <AlertTitle>{tCommon("success")}</AlertTitle>
                <AlertDescription>{tagsSuccess}</AlertDescription>
              </Alert>
            )}
            {tagsError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tCommon("error")}</AlertTitle>
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
                  <CardDescription>
                    {t("workflowTags.description")}
                  </CardDescription>
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
                          className={tag.exists ? "bg-emerald-600" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"}
                        >
                          {tag.exists ? tCommon("exists") : tCommon("missing")}
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
                <CardDescription>
                  {t("workflowTags.tagNamesDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(settings.tags).map(([key, value]) => (
                    <div key={key} className="space-y-2">
                      <Label className="capitalize">{key.replace(/_/g, " ")}</Label>
                      <Input
                        value={value}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            tags: { ...prev.tags, [key]: e.target.value },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 mt-4">
                  {t("workflowTags.tagNamesNote")}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* LANGUAGE TAB */}
          {/* ============================================================= */}
          <TabsContent value="language" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Prompt Language */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    {t("language.promptLanguage")}
                  </CardTitle>
                  <CardDescription>
                    {t("language.promptLanguageDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("language.title")}</Label>
                    <div className="flex gap-2">
                      <Select
                        value={settings.prompt_language}
                        onValueChange={(v) => updateSetting("prompt_language", v)}
                        disabled={languagesLoading}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={t("language.selectLanguage")} />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLanguages.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              <div className="flex items-center gap-2">
                                <span>{lang.name}</span>
                                {!lang.is_complete && (
                                  <Badge variant="outline" className="text-xs">
                                    {tCommon("prompts", { count: lang.prompt_count })}
                                  </Badge>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={fetchLanguages}
                        disabled={languagesLoading}
                      >
                        <RefreshCw className={`h-4 w-4 ${languagesLoading ? "animate-spin" : ""}`} />
                      </Button>
                    </div>
                    <p className="text-xs text-zinc-500">
                      {t("language.controlsPromptLanguage")}
                    </p>
                  </div>

                  {/* Available Languages Info */}
                  {availableLanguages.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">{t("language.availableLanguages")}</Label>
                        <div className="grid gap-2">
                          {availableLanguages.map((lang) => (
                            <div
                              key={lang.code}
                              className={`flex items-center justify-between rounded-lg border p-3 ${
                                settings.prompt_language === lang.code
                                  ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20"
                                  : ""
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className={`h-8 w-8 rounded-full flex items-center justify-center ${
                                    lang.is_complete
                                      ? "bg-emerald-100 dark:bg-emerald-900/30"
                                      : "bg-amber-100 dark:bg-amber-900/30"
                                  }`}
                                >
                                  {lang.is_complete ? (
                                    <Check className="h-4 w-4 text-emerald-600" />
                                  ) : (
                                    <AlertCircle className="h-4 w-4 text-amber-600" />
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium">{lang.name}</p>
                                  <p className="text-xs text-zinc-500">
                                    {tCommon("prompts", { count: lang.prompt_count })}
                                  </p>
                                </div>
                              </div>
                              <Badge
                                variant={lang.is_complete ? "default" : "secondary"}
                                className={lang.is_complete ? "bg-emerald-600" : ""}
                              >
                                {lang.is_complete ? tCommon("complete") : tCommon("partial")}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* UI Language */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    {t("language.uiLanguage")}
                  </CardTitle>
                  <CardDescription>
                    {t("language.uiLanguageDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t("language.title")}</Label>
                    <Select
                      value={pendingUiLocale ?? currentLocale}
                      onValueChange={(value) => setPendingUiLocale(value as Locale)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={localeNames[currentLocale]} />
                      </SelectTrigger>
                      <SelectContent>
                        {locales.map((locale) => (
                          <SelectItem key={locale} value={locale}>
                            {localeNames[locale]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      {t("language.controlsUiLanguage")}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Prompt Translation */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" />
                  {t("language.translatePrompts")}
                </CardTitle>
                <CardDescription>
                  {t("language.translatePromptsDesc")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>{t("language.sourceLanguage")}</Label>
                    <Select
                      value={translationSourceLang}
                      onValueChange={setTranslationSourceLang}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {availableLanguages
                          .filter((l) => l.prompt_count > 0)
                          .map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.name} ({lang.prompt_count} {tCommon("prompts", { count: lang.prompt_count }).split(" ")[0]})
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("language.targetLanguage")}</Label>
                    <Select
                      value={translationTargetLang}
                      onValueChange={setTranslationTargetLang}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("language.selectTarget")} />
                      </SelectTrigger>
                      <SelectContent>
                        {[
                          { code: "en", name: "English" },
                          { code: "de", name: "German" },
                          { code: "fr", name: "French" },
                          { code: "es", name: "Spanish" },
                          { code: "it", name: "Italian" },
                          { code: "pt", name: "Portuguese" },
                          { code: "nl", name: "Dutch" },
                          { code: "pl", name: "Polish" },
                        ]
                          .filter((l) => l.code !== translationSourceLang)
                          .map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              {lang.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-end">
                    <Button
                      onClick={translatePrompts}
                      disabled={translating || !translationTargetLang || translationSourceLang === translationTargetLang}
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                    >
                      {translating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Globe className="mr-2 h-4 w-4" />
                      )}
                      {t("language.translateAll")}
                    </Button>
                  </div>
                </div>

                {/* Translation Result */}
                {translationResult && (
                  <div className="mt-4">
                    {translationResult.success ? (
                      <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <AlertTitle>{tCommon("success")}</AlertTitle>
                        <AlertDescription>
                          {t("language.translationSuccess", {
                            successful: translationResult.successful,
                            total: translationResult.total,
                          })}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle>{tCommon("error")}</AlertTitle>
                        <AlertDescription>
                          {t("language.translationFailed", {
                            failed: translationResult.failed,
                          })}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                )}

                <p className="text-xs text-zinc-500">
                  {t("language.translateNote")}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* ADVANCED TAB */}
          {/* ============================================================= */}
          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("debug.title")}</CardTitle>
                <CardDescription>
                  {t("debug.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t("debug.logLevel")}</Label>
                  <Select
                    value={settings.debug_log_level}
                    onValueChange={(v) => updateSetting("debug_log_level", v as "DEBUG" | "INFO" | "WARNING" | "ERROR")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEBUG">{t("debug.logLevelDebug")}</SelectItem>
                      <SelectItem value="INFO">{t("debug.logLevelInfo")}</SelectItem>
                      <SelectItem value="WARNING">{t("debug.logLevelWarning")}</SelectItem>
                      <SelectItem value="ERROR">{t("debug.logLevelError")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-4">
                  {[
                    { key: "debug_log_prompts" as const, labelKey: "debug.logPrompts", descKey: "debug.logPromptsDesc" },
                    { key: "debug_log_responses" as const, labelKey: "debug.logResponses", descKey: "debug.logResponsesDesc" },
                    { key: "debug_save_processing_history" as const, labelKey: "debug.saveHistory", descKey: "debug.saveHistoryDesc" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>{t(item.labelKey)}</Label>
                        <p className="text-xs text-zinc-500">{t(item.descKey)}</p>
                      </div>
                      <Switch
                        checked={settings[item.key]}
                        onCheckedChange={(v) => updateSetting(item.key, v)}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============================================================= */}
          {/* MAINTENANCE TAB */}
          {/* ============================================================= */}
          <TabsContent value="maintenance" className="space-y-6">
            {/* Error Alert */}
            {maintenanceError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{tCommon("error")}</AlertTitle>
                <AlertDescription className="flex items-center justify-between">
                  <span>{maintenanceError}</span>
                  <Button variant="ghost" size="sm" onClick={() => setMaintenanceError(null)}>
                    <X className="h-4 w-4" />
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Bootstrap Analysis Card */}
            <Card>
              <CardHeader>
                <CardTitle>{tMaint("bootstrap.title")}</CardTitle>
                <CardDescription>{tMaint("bootstrap.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Action Buttons */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "correspondents", labelKey: "analyzeCorrespondents", Icon: User },
                    { key: "document_types", labelKey: "analyzeTypes", Icon: FileText },
                    { key: "tags", labelKey: "analyzeTags", Icon: Tag },
                    { key: "all", labelKey: "fullAnalysis", Icon: Zap },
                  ].map((btn) => (
                    <Button
                      key={btn.key}
                      variant={btn.key === "all" ? "default" : "outline"}
                      onClick={() => handleStartBootstrap(btn.key)}
                      disabled={isBootstrapRunning || bootstrapStarting !== null}
                      className={btn.key === "all" ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                    >
                      {bootstrapStarting === btn.key ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <btn.Icon className="h-4 w-4 mr-2" />
                      )}
                      {tMaint(`bootstrap.${btn.labelKey}`)}
                    </Button>
                  ))}
                </div>

                {/* Progress Display */}
                {bootstrapProgress && bootstrapProgress.status !== "idle" && (
                  <div className="mt-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 space-y-3">
                    {/* Status Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {bootstrapProgress.status === "running" && (
                          <Badge variant="default" className="bg-blue-500">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {tMaint("bootstrap.running")}
                          </Badge>
                        )}
                        {bootstrapProgress.status === "completed" && (
                          <Badge variant="default" className="bg-emerald-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {tMaint("bootstrap.completed")}
                          </Badge>
                        )}
                        {bootstrapProgress.status === "cancelled" && (
                          <Badge variant="secondary">
                            {tMaint("bootstrap.cancelled")}
                          </Badge>
                        )}
                        {bootstrapProgress.status === "failed" && (
                          <Badge variant="destructive">
                            {tMaint("bootstrap.failed")}
                          </Badge>
                        )}
                      </div>
                      {isBootstrapRunning && (
                        <div className="flex gap-2 flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSkipDocument(1)}
                            title={tMaint("bootstrap.skipTooltip")}
                          >
                            <SkipForward className="h-4 w-4 mr-1" />
                            {tMaint("bootstrap.skip")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSkipDocument(10)}
                            title={tMaint("bootstrap.skip10Tooltip")}
                          >
                            <SkipForward className="h-4 w-4 mr-1" />
                            {tMaint("bootstrap.skip10")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSkipDocument(100)}
                            title={tMaint("bootstrap.skip100Tooltip")}
                          >
                            <SkipForward className="h-4 w-4 mr-1" />
                            {tMaint("bootstrap.skip100")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCancelBootstrap}
                            disabled={bootstrapLoading}
                          >
                            {bootstrapLoading ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Square className="h-4 w-4 mr-1" />
                            )}
                            {tMaint("bootstrap.cancel")}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {bootstrapProgress.total > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400">
                          <span>{tMaint("bootstrap.progress")}</span>
                          <span>
                            {bootstrapProgress.processed}/{bootstrapProgress.total} ({bootstrapProgressPercent}%)
                          </span>
                        </div>
                        <Progress value={bootstrapProgressPercent} className="h-2" />
                        {/* ETA */}
                        {isBootstrapRunning && bootstrapProgress.estimated_remaining_seconds !== null && (
                          <div className="text-xs text-zinc-500 mt-1">
                            {tMaint("bootstrap.eta")}: {formatETA(bootstrapProgress.estimated_remaining_seconds)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Current Document */}
                    {bootstrapProgress.current_doc_title && isBootstrapRunning && (
                      <div className="text-sm">
                        <span className="text-zinc-500">{tMaint("bootstrap.currentDoc")}:</span>{" "}
                        <span className="font-medium">{bootstrapProgress.current_doc_title}</span>
                      </div>
                    )}

                    {/* Stats with Expandable Details */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-4 text-sm">
                          <div>
                            <span className="text-zinc-500">{tMaint("bootstrap.suggestionsFound")}:</span>{" "}
                            <span className="font-medium text-emerald-600">{bootstrapProgress.suggestions_found}</span>
                          </div>
                          {bootstrapProgress.errors > 0 && (
                            <div>
                              <span className="text-zinc-500">{tMaint("bootstrap.errors")}:</span>{" "}
                              <span className="font-medium text-red-600">{bootstrapProgress.errors}</span>
                            </div>
                          )}
                          {bootstrapProgress.skipped > 0 && (
                            <div>
                              <span className="text-zinc-500">{tMaint("bootstrap.skipped")}:</span>{" "}
                              <span className="font-medium text-amber-600">{bootstrapProgress.skipped}</span>
                            </div>
                          )}
                        </div>
                        {bootstrapProgress.suggestions_found > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setBootstrapDetailsOpen(!bootstrapDetailsOpen)}
                            className="h-6 px-2 text-xs text-zinc-500"
                          >
                            {tMaint("bootstrap.details")}
                            {bootstrapDetailsOpen ? (
                              <ChevronUp className="h-3 w-3 ml-1" />
                            ) : (
                              <ChevronDown className="h-3 w-3 ml-1" />
                            )}
                          </Button>
                        )}
                      </div>

                      {/* Expandable Details */}
                      {bootstrapDetailsOpen && bootstrapProgress.suggestions_by_type && (
                        <div className="mt-2 p-3 rounded-md bg-zinc-100 dark:bg-zinc-800 space-y-2 text-sm">
                          <div className="font-medium text-zinc-700 dark:text-zinc-300 mb-2">
                            {tMaint("bootstrap.byType")}
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-blue-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">{tMaint("bootstrap.correspondentsCount")}:</span>
                              <span className="font-medium">{bootstrapProgress.suggestions_by_type.correspondents}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-purple-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">{tMaint("bootstrap.typesCount")}:</span>
                              <span className="font-medium">{bootstrapProgress.suggestions_by_type.document_types}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Tag className="h-4 w-4 text-emerald-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">{tMaint("bootstrap.tagsCount")}:</span>
                              <span className="font-medium">{bootstrapProgress.suggestions_by_type.tags}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Error Message */}
                    {bootstrapProgress.error_message && (
                      <div className="text-sm text-red-600 dark:text-red-400">
                        {bootstrapProgress.error_message}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Bulk OCR Card */}
            <Card>
              <CardHeader>
                <CardTitle>{tMaint("bulkOCR.title")}</CardTitle>
                <CardDescription>{tMaint("bulkOCR.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Configuration */}
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="ocr-rate">{tMaint("bulkOCR.docsPerSecond")}</Label>
                    <Input
                      id="ocr-rate"
                      type="number"
                      min="0.1"
                      max="10"
                      step="0.1"
                      value={bulkOCRDocsPerSecond}
                      onChange={(e) => setBulkOCRDocsPerSecond(parseFloat(e.target.value) || 1)}
                      disabled={isBulkOCRRunning}
                      className="w-24"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="skip-existing"
                      checked={bulkOCRSkipExisting}
                      onCheckedChange={setBulkOCRSkipExisting}
                      disabled={isBulkOCRRunning}
                    />
                    <Label htmlFor="skip-existing">{tMaint("bulkOCR.skipExisting")}</Label>
                  </div>
                  <Button
                    onClick={handleStartBulkOCR}
                    disabled={isBulkOCRRunning || bulkOCRStarting}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    {bulkOCRStarting ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    {tMaint("bulkOCR.start")}
                  </Button>
                </div>

                {/* Progress Display */}
                {bulkOCRProgress && bulkOCRProgress.status !== "idle" && (
                  <div className="mt-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 space-y-3">
                    {/* Status Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {bulkOCRProgress.status === "running" && (
                          <Badge variant="default" className="bg-blue-500">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            {tMaint("bulkOCR.running")}
                          </Badge>
                        )}
                        {bulkOCRProgress.status === "completed" && (
                          <Badge variant="default" className="bg-emerald-500">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            {tMaint("bulkOCR.completed")}
                          </Badge>
                        )}
                        {bulkOCRProgress.status === "cancelled" && (
                          <Badge variant="secondary">
                            {tMaint("bulkOCR.cancelled")}
                          </Badge>
                        )}
                        {bulkOCRProgress.status === "failed" && (
                          <Badge variant="destructive">
                            {tMaint("bulkOCR.failed")}
                          </Badge>
                        )}
                      </div>
                      {isBulkOCRRunning && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelBulkOCR}
                        >
                          <Square className="h-4 w-4 mr-1" />
                          {tMaint("bulkOCR.cancel")}
                        </Button>
                      )}
                    </div>

                    {/* Progress Bar */}
                    {bulkOCRProgress.total > 0 && (
                      <div className="space-y-1">
                        <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400">
                          <span>{tMaint("bulkOCR.progress")}</span>
                          <span>
                            {bulkOCRProgress.processed}/{bulkOCRProgress.total} ({bulkOCRProgressPercent}%)
                          </span>
                        </div>
                        <Progress value={bulkOCRProgressPercent} className="h-2" />
                      </div>
                    )}

                    {/* Current Document */}
                    {bulkOCRProgress.current_doc_title && isBulkOCRRunning && (
                      <div className="text-sm">
                        <span className="text-zinc-500">{tMaint("bulkOCR.currentDoc")}:</span>{" "}
                        <span className="font-medium">{bulkOCRProgress.current_doc_title}</span>
                      </div>
                    )}

                    {/* Stats */}
                    <div className="flex gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">{tMaint("bulkOCR.processed")}:</span>{" "}
                        <span className="font-medium">{bulkOCRProgress.processed - bulkOCRProgress.skipped}</span>
                      </div>
                      {bulkOCRProgress.skipped > 0 && (
                        <div>
                          <span className="text-zinc-500">{tMaint("bulkOCR.skipped")}:</span>{" "}
                          <span className="font-medium text-zinc-600">{bulkOCRProgress.skipped}</span>
                        </div>
                      )}
                      {bulkOCRProgress.errors > 0 && (
                        <div>
                          <span className="text-zinc-500">{tMaint("bulkOCR.errors")}:</span>{" "}
                          <span className="font-medium text-red-600">{bulkOCRProgress.errors}</span>
                        </div>
                      )}
                    </div>

                    {/* Error Message */}
                    {bulkOCRProgress.error_message && (
                      <div className="text-sm text-red-600 dark:text-red-400">
                        {bulkOCRProgress.error_message}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Scheduled Jobs Card */}
            <Card>
              <CardHeader>
                <CardTitle>{tMaint("scheduled.title")}</CardTitle>
                <CardDescription>{tMaint("scheduled.description")}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {scheduleLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
                  </div>
                ) : scheduleStatus ? (
                  <>
                    {/* Schema Cleanup Job */}
                    <ScheduledJobSection
                      jobName="schema_cleanup"
                      title={tMaint("scheduled.schemaCleanup")}
                      description={tMaint("scheduled.schemaCleanupDesc")}
                      jobInfo={scheduleStatus.jobs.schema_cleanup}
                      saving={scheduleSaving === "schema_cleanup"}
                      triggerLoading={manualTriggerLoading === "schema_cleanup"}
                      onUpdate={(enabled, schedule, cron) =>
                        handleScheduleUpdate("schema_cleanup", enabled, schedule, cron)
                      }
                      onTrigger={() => handleManualTrigger("schema_cleanup")}
                      tMaint={tMaint}
                      formatDate={formatMaintenanceDate}
                    />

                    <Separator />

                    {/* Metadata Enhancement Job */}
                    <ScheduledJobSection
                      jobName="metadata_enhancement"
                      title={tMaint("scheduled.metadataEnhancement")}
                      description={tMaint("scheduled.metadataEnhancementDesc")}
                      jobInfo={scheduleStatus.jobs.metadata_enhancement}
                      saving={scheduleSaving === "metadata_enhancement"}
                      triggerLoading={manualTriggerLoading === "metadata_enhancement"}
                      onUpdate={(enabled, schedule, cron) =>
                        handleScheduleUpdate("metadata_enhancement", enabled, schedule, cron)
                      }
                      onTrigger={() => handleManualTrigger("metadata_enhancement")}
                      tMaint={tMaint}
                      formatDate={formatMaintenanceDate}
                    />
                  </>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// Scheduled Job Section Component
interface ScheduledJobSectionProps {
  jobName: string;
  title: string;
  description: string;
  jobInfo: {
    enabled: boolean;
    schedule: ScheduleType;
    cron: string;
    next_run: string | null;
    last_run: string | null;
    last_result: Record<string, unknown> | null;
  };
  saving: boolean;
  triggerLoading: boolean;
  onUpdate: (enabled: boolean, schedule: ScheduleType, cron?: string) => void;
  onTrigger: () => void;
  tMaint: ReturnType<typeof useTranslations>;
  formatDate: (date: string | null) => string;
}

function ScheduledJobSection({
  title,
  description,
  jobInfo,
  saving,
  triggerLoading,
  onUpdate,
  onTrigger,
  tMaint,
  formatDate,
}: ScheduledJobSectionProps) {
  const [localEnabled, setLocalEnabled] = useState(jobInfo.enabled);
  const [localSchedule, setLocalSchedule] = useState<ScheduleType>(jobInfo.schedule);
  const [localCron, setLocalCron] = useState(jobInfo.cron);

  // Sync local state with props
  useEffect(() => {
    setLocalEnabled(jobInfo.enabled);
    setLocalSchedule(jobInfo.schedule);
    setLocalCron(jobInfo.cron);
  }, [jobInfo]);

  const handleEnabledChange = (enabled: boolean) => {
    setLocalEnabled(enabled);
    onUpdate(enabled, localSchedule, localCron);
  };

  const handleScheduleChange = (schedule: ScheduleType) => {
    setLocalSchedule(schedule);
    onUpdate(localEnabled, schedule, localCron);
  };

  const handleCronChange = (cron: string) => {
    setLocalCron(cron);
  };

  const handleCronBlur = () => {
    if (localSchedule === "cron") {
      onUpdate(localEnabled, localSchedule, localCron);
    }
  };

  const scheduleOptions: { value: ScheduleType; labelKey: string }[] = [
    { value: "daily", labelKey: "daily" },
    { value: "weekly", labelKey: "weekly" },
    { value: "monthly", labelKey: "monthly" },
    { value: "cron", labelKey: "customCron" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <h3 className="font-medium">{title}</h3>
          <p className="text-sm text-zinc-500">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />}
          <Switch
            checked={localEnabled}
            onCheckedChange={handleEnabledChange}
            disabled={saving}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm text-zinc-500">{tMaint("scheduled.schedule")}:</Label>
          <Select
            value={localSchedule}
            onValueChange={(v) => handleScheduleChange(v as ScheduleType)}
            disabled={saving}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scheduleOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {tMaint(`scheduled.${opt.labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {localSchedule === "cron" && (
          <div className="flex items-center gap-2">
            <Label className="text-sm text-zinc-500">Cron:</Label>
            <Input
              value={localCron}
              onChange={(e) => handleCronChange(e.target.value)}
              onBlur={handleCronBlur}
              placeholder="0 3 * * *"
              className="w-32 font-mono text-sm"
              disabled={saving}
            />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-1 text-zinc-500">
          <Clock className="h-4 w-4" />
          <span>{tMaint("scheduled.nextRun")}:</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {localEnabled ? formatDate(jobInfo.next_run) : tMaint("scheduled.disabled")}
          </span>
        </div>
        <div className="flex items-center gap-1 text-zinc-500">
          <Calendar className="h-4 w-4" />
          <span>{tMaint("scheduled.lastRun")}:</span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {formatDate(jobInfo.last_run)}
          </span>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onTrigger}
        disabled={triggerLoading}
      >
        {triggerLoading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Play className="h-4 w-4 mr-2" />
        )}
        {tMaint("scheduled.runNow")}
      </Button>
    </div>
  );
}
