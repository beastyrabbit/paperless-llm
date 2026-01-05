"use client";

import { useState, useEffect, useCallback } from "react";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ModelCombobox } from "@/components/model-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FileText, ArrowRight } from "lucide-react";

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

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    paperless_url: "",
    paperless_token: "",
    mistral_api_key: "",
    mistral_model: "mistral-ocr-latest",
    ollama_url: "",
    ollama_model_large: "",
    ollama_model_small: "",
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
  const [customFieldsSaving, setCustomFieldsSaving] = useState(false);
  const [customFieldsError, setCustomFieldsError] = useState<string | null>(null);
  const [customFieldsSuccess, setCustomFieldsSuccess] = useState<string | null>(null);
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
  const [aiTagsSaving, setAiTagsSaving] = useState(false);
  const [aiTagsError, setAiTagsError] = useState<string | null>(null);
  const [aiTagsSuccess, setAiTagsSuccess] = useState<string | null>(null);
  const [aiTagsHasChanges, setAiTagsHasChanges] = useState(false);

  // Language state
  const [availableLanguages, setAvailableLanguages] = useState<LanguageInfo[]>([]);
  const [languagesLoading, setLanguagesLoading] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Load settings, auto-test connections, check tags, and fetch custom fields on mount
  useEffect(() => {
    loadSettings();
    fetchTagsStatus();
    fetchCustomFields();
    fetchAiTags();
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (response.ok) {
        setSaveStatus("success");
        setTimeout(() => setSaveStatus("idle"), 3000);
      } else {
        setSaveStatus("error");
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

  // Save custom fields selection
  const saveCustomFieldsSelection = async () => {
    setCustomFieldsSaving(true);
    setCustomFieldsError(null);
    setCustomFieldsSuccess(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/custom-fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_field_ids: selectedCustomFields }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setCustomFieldsSuccess(`Saved ${selectedCustomFields.length} custom field(s) for LLM processing`);
      setCustomFieldsHasChanges(false);
    } catch (err) {
      setCustomFieldsError(err instanceof Error ? err.message : "Failed to save selection");
    } finally {
      setCustomFieldsSaving(false);
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
    setCustomFieldsSuccess(null);
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
    } catch (err) {
      setAiTagsError(err instanceof Error ? err.message : "Failed to fetch tags");
    } finally {
      setAiTagsLoading(false);
    }
  };

  // Save AI tags selection
  const saveAiTagsSelection = async () => {
    setAiTagsSaving(true);
    setAiTagsError(null);
    setAiTagsSuccess(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-tags`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_tag_ids: selectedAiTags }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setAiTagsSuccess(`Saved ${selectedAiTags.length} tag(s) for AI suggestions`);
      setAiTagsHasChanges(false);
    } catch (err) {
      setAiTagsError(err instanceof Error ? err.message : "Failed to save selection");
    } finally {
      setAiTagsSaving(false);
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
    setAiTagsSuccess(null);
  };

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
              Settings
            </h1>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Configure your Paperless Local LLM instance
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
            {saveStatus === "success" ? "Saved!" : "Save Settings"}
          </Button>
        </div>
      </header>

      {/* Content */}
      <main className="p-8">
        <Tabs defaultValue="connections" className="space-y-6">
          <TabsList className="bg-zinc-100 dark:bg-zinc-800">
            <TabsTrigger value="connections" className="gap-2">
              <Server className="h-4 w-4" />
              Connections
            </TabsTrigger>
            <TabsTrigger value="processing" className="gap-2">
              <Zap className="h-4 w-4" />
              Processing
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="gap-2">
              <GitBranch className="h-4 w-4" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="custom-fields" className="gap-2">
              <FileText className="h-4 w-4" />
              Custom Fields
            </TabsTrigger>
            <TabsTrigger value="ai-tags" className="gap-2">
              <Tag className="h-4 w-4" />
              Tags
            </TabsTrigger>
            <TabsTrigger value="workflow-tags" className="gap-2">
              <GitBranch className="h-4 w-4" />
              Workflow Tags
            </TabsTrigger>
            <TabsTrigger value="language" className="gap-2">
              <Globe className="h-4 w-4" />
              Language
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <Bug className="h-4 w-4" />
              Advanced
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
                    Paperless-ngx
                  </CardTitle>
                  <CardDescription>
                    Connect to your Paperless-ngx instance
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="paperless_url">Server URL</Label>
                    <Input
                      id="paperless_url"
                      placeholder="http://your-paperless:8000"
                      value={settings.paperless_url}
                      onChange={(e) => updateSetting("paperless_url", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="paperless_token">API Token</Label>
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
                    Test Connection
                  </Button>
                </CardContent>
              </Card>

              {/* Ollama */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <StatusIndicator status={connectionStatus.ollama} />
                    Ollama Server
                  </CardTitle>
                  <CardDescription>
                    Local LLM server for document analysis
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ollama_url">Server URL</Label>
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
                        <span className="text-sm font-medium">Available Models ({ollamaModels.length})</span>
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
                        <Label>Large Model (Analysis)</Label>
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
                        <Label>Small Model (Confirmation)</Label>
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
                        <Label>Embedding Model (Vector Search)</Label>
                        <ModelCombobox
                          models={ollamaModels}
                          value={settings.ollama_embedding_model}
                          onValueChange={(v) => updateSetting("ollama_embedding_model", v)}
                          placeholder="Select embedding model..."
                          searchPlaceholder="Search models..."
                          emptyText="No model found."
                        />
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
                          Thinking Mode
                        </Label>
                        <p className="text-xs text-zinc-500">
                          Enable extended reasoning for complex analysis
                        </p>
                      </div>
                      <Switch
                        checked={settings.ollama_thinking_enabled}
                        onCheckedChange={(v) => updateSetting("ollama_thinking_enabled", v)}
                      />
                    </div>

                    {settings.ollama_thinking_enabled && (
                      <div className="space-y-2">
                        <Label>Thinking Level</Label>
                        <Select
                          value={settings.ollama_thinking_level}
                          onValueChange={(v) => updateSetting("ollama_thinking_level", v as "low" | "medium" | "high")}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low - Fast, less detailed</SelectItem>
                            <SelectItem value="medium">Medium - Balanced</SelectItem>
                            <SelectItem value="high">High - Thorough reasoning</SelectItem>
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
                    Mistral AI
                  </CardTitle>
                  <CardDescription>
                    OCR and document understanding API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mistral_api_key">API Key</Label>
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
                      <Label>OCR Model</Label>
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
                    Qdrant Vector Database
                  </CardTitle>
                  <CardDescription>
                    Vector storage for semantic document search
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="qdrant_url">Server URL</Label>
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
                    <Label htmlFor="qdrant_collection">Collection Name</Label>
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
                        <Label>Vector Search</Label>
                        <p className="text-xs text-zinc-500">
                          Find similar documents for context
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
                          <Label>Top K Results</Label>
                          <Input
                            type="number"
                            min={1}
                            max={20}
                            value={settings.vector_search_top_k}
                            onChange={(e) => updateSetting("vector_search_top_k", parseInt(e.target.value) || 5)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Min Score (0-1)</Label>
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
                    Auto-Processing
                  </CardTitle>
                  <CardDescription>
                    Automatically process new documents in the background
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable Auto-Processing</Label>
                      <p className="text-xs text-zinc-500">
                        Process documents with &quot;llm-pending&quot; tag
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
                        <Label>Check Interval (minutes)</Label>
                        <Select
                          value={settings.auto_processing_interval_minutes.toString()}
                          onValueChange={(v) => updateSetting("auto_processing_interval_minutes", parseInt(v))}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">Every minute</SelectItem>
                            <SelectItem value="5">Every 5 minutes</SelectItem>
                            <SelectItem value="10">Every 10 minutes</SelectItem>
                            <SelectItem value="30">Every 30 minutes</SelectItem>
                            <SelectItem value="60">Every hour</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <Label>Pause on User Activity</Label>
                          <p className="text-xs text-zinc-500">
                            Pause when using manual processing
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
                    Confirmation Loop
                  </CardTitle>
                  <CardDescription>
                    Large model analyzes, small model confirms
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Max Retries</Label>
                    <p className="text-xs text-zinc-500">
                      Maximum rounds of 120B ↔ 20B discussion before user review
                    </p>
                    <Select
                      value={settings.confirmation_max_retries.toString()}
                      onValueChange={(v) => updateSetting("confirmation_max_retries", parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 retry</SelectItem>
                        <SelectItem value="2">2 retries</SelectItem>
                        <SelectItem value="3">3 retries</SelectItem>
                        <SelectItem value="5">5 retries</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Require User for New Entities</Label>
                      <p className="text-xs text-zinc-500">
                        Ask before creating new tags or correspondents
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
                <CardTitle>Processing Pipeline</CardTitle>
                <CardDescription>
                  Enable or disable individual processing steps
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    { key: "pipeline_ocr" as const, label: "OCR Processing", desc: "Extract text from PDFs using Mistral AI" },
                    { key: "pipeline_title" as const, label: "Title Generation", desc: "Generate descriptive document titles" },
                    { key: "pipeline_correspondent" as const, label: "Correspondent Assignment", desc: "Identify and assign document sender/recipient" },
                    { key: "pipeline_tags" as const, label: "Tag Assignment", desc: "Automatically assign relevant tags" },
                    { key: "pipeline_custom_fields" as const, label: "Custom Fields", desc: "Fill custom fields based on document type" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between rounded-lg border p-4">
                      <div className="space-y-0.5">
                        <Label>{item.label}</Label>
                        <p className="text-xs text-zinc-500">{item.desc}</p>
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
                      Custom Fields Configuration
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Select which custom fields the LLM should attempt to fill during document processing.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchCustomFields}
                      disabled={customFieldsLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${customFieldsLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveCustomFieldsSelection}
                      disabled={customFieldsSaving || !customFieldsHasChanges}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {customFieldsSaving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Selection
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Success/Error Messages */}
            {customFieldsSuccess && (
              <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>{customFieldsSuccess}</AlertDescription>
              </Alert>
            )}
            {customFieldsError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{customFieldsError}</AlertDescription>
              </Alert>
            )}

            {/* Loading State */}
            {customFieldsLoading && customFields.length === 0 && (
              <Card>
                <CardContent className="py-12">
                  <div className="flex flex-col items-center justify-center gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                    <p className="text-sm text-zinc-500">Loading custom fields from Paperless...</p>
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
                    <p className="text-lg font-medium">No Custom Fields Found</p>
                    <p className="text-sm">
                      Custom fields need to be created in Paperless-ngx first.
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
                      <CardTitle>Available Custom Fields</CardTitle>
                      <CardDescription>
                        {selectedCustomFields.length} of {customFields.length} fields selected
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCustomFields(customFields.map((f) => f.id));
                          setCustomFieldsHasChanges(true);
                          setCustomFieldsSuccess(null);
                        }}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCustomFields([]);
                          setCustomFieldsHasChanges(true);
                          setCustomFieldsSuccess(null);
                        }}
                      >
                        Clear
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
                                    ({(field.extra_data.select_options as unknown[]).length} options)
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
                          {selectedCustomFields.includes(field.id) ? "Enabled" : "Disabled"}
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
                      AI Tag Selection
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Select which tags the AI can suggest when processing documents.
                      Unselected tags will never be added by the AI.
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={fetchAiTags}
                      disabled={aiTagsLoading}
                    >
                      <RefreshCw className={`h-4 w-4 mr-2 ${aiTagsLoading ? "animate-spin" : ""}`} />
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      onClick={saveAiTagsSelection}
                      disabled={aiTagsSaving || !aiTagsHasChanges}
                      className="bg-emerald-600 hover:bg-emerald-700"
                    >
                      {aiTagsSaving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Selection
                    </Button>
                  </div>
                </div>
              </CardHeader>
            </Card>

            {/* Success/Error Messages */}
            {aiTagsSuccess && (
              <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>{aiTagsSuccess}</AlertDescription>
              </Alert>
            )}
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
                    <p className="text-sm text-zinc-500">Loading tags from Paperless...</p>
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
                    <p className="text-lg font-medium">No Tags Found</p>
                    <p className="text-sm">
                      Tags need to be created in Paperless-ngx first.
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
                      <CardTitle>Available Tags</CardTitle>
                      <CardDescription>
                        {selectedAiTags.length} of {allTags.length} tags enabled for AI
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiTags(allTags.map((t) => t.id));
                          setAiTagsHasChanges(true);
                          setAiTagsSuccess(null);
                        }}
                      >
                        Select All
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedAiTags([]);
                          setAiTagsHasChanges(true);
                          setAiTagsSuccess(null);
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {allTags.map((tag) => (
                      <div
                        key={tag.id}
                        className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4"
                        onClick={() => toggleAiTag(tag.id)}
                      >
                        <div className="flex items-center gap-4">
                          <div
                            className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                              selectedAiTags.includes(tag.id)
                                ? "bg-emerald-600 border-emerald-600"
                                : "border-zinc-300 dark:border-zinc-600"
                            }`}
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
                                {tag.document_count} document{tag.document_count !== 1 ? "s" : ""}
                              </p>
                            </div>
                          </div>
                        </div>
                        <Badge
                          variant={selectedAiTags.includes(tag.id) ? "default" : "secondary"}
                          className={selectedAiTags.includes(tag.id) ? "bg-emerald-600" : ""}
                        >
                          {selectedAiTags.includes(tag.id) ? "AI Enabled" : "AI Disabled"}
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
                          ? "Checking Tags..."
                          : tagsStatus?.all_exist
                          ? "All Workflow Tags Exist"
                          : `${tagsStatus?.missing_count || 0} Missing Tag${(tagsStatus?.missing_count || 0) > 1 ? "s" : ""}`}
                      </CardTitle>
                      <CardDescription>
                        {tagsStatus?.all_exist
                          ? "Your Paperless instance has all required workflow tags."
                          : "Some tags need to be created for the pipeline to work."}
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
                        Create Missing Tags
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
                    Workflow Tags Status
                  </CardTitle>
                  <CardDescription>
                    These tags track document processing status through the pipeline.
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
                <CardTitle>Tag Names</CardTitle>
                <CardDescription>
                  Customize the tag names used for each workflow stage
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
                  After changing tag names, click &quot;Save Settings&quot; and then &quot;Refresh&quot; to verify the new tags exist.
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
                    Prompt Language
                  </CardTitle>
                  <CardDescription>
                    Select the language for LLM prompts used during document processing
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <div className="flex gap-2">
                      <Select
                        value={settings.prompt_language}
                        onValueChange={(v) => updateSetting("prompt_language", v)}
                        disabled={languagesLoading}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Select language..." />
                        </SelectTrigger>
                        <SelectContent>
                          {availableLanguages.map((lang) => (
                            <SelectItem key={lang.code} value={lang.code}>
                              <div className="flex items-center gap-2">
                                <span>{lang.name}</span>
                                {!lang.is_complete && (
                                  <Badge variant="outline" className="text-xs">
                                    {lang.prompt_count} prompts
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
                      This controls the language of prompts sent to the LLM for document analysis.
                    </p>
                  </div>

                  {/* Available Languages Info */}
                  {availableLanguages.length > 0 && (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Available Languages</Label>
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
                                    {lang.prompt_count} prompt{lang.prompt_count !== 1 ? "s" : ""}
                                  </p>
                                </div>
                              </div>
                              <Badge
                                variant={lang.is_complete ? "default" : "secondary"}
                                className={lang.is_complete ? "bg-emerald-600" : ""}
                              >
                                {lang.is_complete ? "Complete" : "Partial"}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* UI Language (Coming Soon) */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    UI Language
                    <Badge variant="secondary" className="ml-2">Coming Soon</Badge>
                  </CardTitle>
                  <CardDescription>
                    Select the language for the user interface
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select disabled>
                      <SelectTrigger className="opacity-50">
                        <SelectValue placeholder="English" />
                      </SelectTrigger>
                    </Select>
                    <p className="text-xs text-zinc-500">
                      UI translation support is planned for a future release.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ============================================================= */}
          {/* ADVANCED TAB */}
          {/* ============================================================= */}
          <TabsContent value="advanced" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Debug Settings</CardTitle>
                <CardDescription>
                  Development and troubleshooting options
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Log Level</Label>
                  <Select
                    value={settings.debug_log_level}
                    onValueChange={(v) => updateSetting("debug_log_level", v as "DEBUG" | "INFO" | "WARNING" | "ERROR")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEBUG">Debug - All messages</SelectItem>
                      <SelectItem value="INFO">Info - Normal operation</SelectItem>
                      <SelectItem value="WARNING">Warning - Issues only</SelectItem>
                      <SelectItem value="ERROR">Error - Errors only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-4">
                  {[
                    { key: "debug_log_prompts" as const, label: "Log Prompts", desc: "Log full prompts sent to LLM" },
                    { key: "debug_log_responses" as const, label: "Log Responses", desc: "Log full LLM responses" },
                    { key: "debug_save_processing_history" as const, label: "Save Processing History", desc: "Keep history of all processing steps" },
                  ].map((item) => (
                    <div key={item.key} className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>{item.label}</Label>
                        <p className="text-xs text-zinc-500">{item.desc}</p>
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
        </Tabs>
      </main>
    </div>
  );
}
