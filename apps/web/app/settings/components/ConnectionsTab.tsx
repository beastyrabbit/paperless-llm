"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Separator,
  Switch,
} from "@repo/ui";
import { Database, Eye, EyeOff, Loader2, RefreshCw, TestTube } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { ModelCombobox } from "@/components/model-combobox";
import { type MistralModel, type OllamaModel, type OpenAICodexModel, settingsApi } from "@/lib/api";
import {
  type SettingKey,
  useBooleanSetting,
  useMistralApiKeyConfigured,
  useNumberSetting,
  usePaperlessTokenConfigured,
  useStringSetting,
  useTinyBase,
} from "@/lib/tinybase";
import { type ConnectionStatus, StatusIndicator } from "./shared";

const OPENAI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

function SecretInput({
  id,
  configured,
  settingKey,
  visible,
  placeholder,
  configuredPlaceholder,
  updateSetting,
}: {
  id: string;
  configured: boolean;
  settingKey: SettingKey;
  visible: boolean;
  placeholder: string;
  configuredPlaceholder: string;
  updateSetting: (key: SettingKey, value: string) => Promise<boolean>;
}) {
  const t = useTranslations("settings");
  const [draft, setDraft] = useState("");
  const [state, action, isPending] = useActionState<
    { status: "idle" | "success" | "error"; message: string | null },
    FormData
  >(async (_previous, formData) => {
    const value = String(formData.get("secret") ?? "").trim();
    if (!value) return { status: "idle", message: null };

    const saved = await updateSetting(settingKey, value);
    if (!saved) return { status: "error", message: t("secretSaveError") };
    setDraft("");
    return { status: "success", message: null };
  }, { status: "idle", message: null });

  return (
    <form action={action} className="space-y-1">
      <Input
        id={id}
        name="secret"
        type={visible ? "text" : "password"}
        placeholder={configured ? configuredPlaceholder : placeholder}
        value={draft}
        disabled={isPending}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
      />
      <div className="flex items-center justify-between text-xs">
        <Button type="submit" variant="ghost" size="sm" disabled={!draft || isPending}>
          {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
          {t("saveSecret")}
        </Button>
        {state.status === "error" && (
          <span className="text-red-600 dark:text-red-400" role="alert">
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}

export function ConnectionsTab() {
  const t = useTranslations("settings");
  const { updateSetting, isSyncing } = useTinyBase();
  const updateSettingSafely = useCallback(
    (key: SettingKey, value: string | number | boolean) => {
      void updateSetting(key, value).catch(() => undefined);
    },
    [updateSetting],
  );
  const hasAutoTestedRef = useRef(false);

  // TinyBase settings (persisted)
  const paperlessUrl = useStringSetting("paperless.url");
  const paperlessTokenConfigured = usePaperlessTokenConfigured();
  const paperlessExternalUrl = useStringSetting("paperless.external_url");
  const ollamaUrl = useStringSetting("ollama.url");
  const ollamaModel = useStringSetting("ollama.model");
  const ollamaEmbeddingModel = useStringSetting("ollama.embedding_model");
  const openAiCliEnabled = useBooleanSetting("openai_cli.enabled");
  const openAiCliCommand = useStringSetting("openai_cli.command");
  const openAiCliModel = useStringSetting("openai_cli.model");
  const openAiCliReasoningEffort = useStringSetting("openai_cli.reasoning_effort");
  const openAiCliFastMode = useBooleanSetting("openai_cli.fast_mode");
  const openAiCliScope = useStringSetting("openai_cli.scope");
  const mistralApiKeyConfigured = useMistralApiKeyConfigured();
  const mistralModel = useStringSetting("mistral.model");
  const qdrantUrl = useStringSetting("qdrant.url");
  const qdrantCollection = useStringSetting("qdrant.collection");
  const vectorSearchEnabled = useBooleanSetting("vector_search.enabled");
  const vectorSearchTopK = useNumberSetting("vector_search.top_k");
  const vectorSearchMinScore = useNumberSetting("vector_search.min_score");

  // Local UI state
  const [connectionStatus, setConnectionStatus] = useState<Record<string, ConnectionStatus>>({
    paperless: "idle",
    ollama: "idle",
    qdrant: "idle",
    mistral: "idle",
  });
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [mistralModels, setMistralModels] = useState<MistralModel[]>([]);
  const [openAiCodexModels, setOpenAiCodexModels] = useState<OpenAICodexModel[]>([]);
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({
    ollama: false,
    mistral: false,
    openai: false,
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({
    paperless_token: false,
    mistral_api_key: false,
  });

  // Fetch models
  const fetchOllamaModels = useCallback(async () => {
    setLoadingModels((prev) => ({ ...prev, ollama: true }));
    const result = await settingsApi.getOllamaModels();
    if (result.ok) {
      setOllamaModels(result.data.models);
    }
    setLoadingModels((prev) => ({ ...prev, ollama: false }));
  }, []);

  const fetchMistralModels = useCallback(async () => {
    setLoadingModels((prev) => ({ ...prev, mistral: true }));
    const result = await settingsApi.getMistralModels();
    if (result.ok) {
      setMistralModels(result.data.models);
    }
    setLoadingModels((prev) => ({ ...prev, mistral: false }));
  }, []);

  const fetchOpenAiCodexModels = useCallback(async () => {
    setLoadingModels((prev) => ({ ...prev, openai: true }));
    const result = await settingsApi.getOpenAICodexModels();
    if (result.ok) {
      setOpenAiCodexModels(result.data.models);
    }
    setLoadingModels((prev) => ({ ...prev, openai: false }));
  }, []);

  // Test connection
  const testConnection = useCallback(
    async (service: string) => {
      setConnectionStatus((prev) => ({ ...prev, [service]: "testing" }));
      const result = await settingsApi.testConnection(service);
      if (!result.ok) {
        setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
        return;
      }

      const isSuccess = result.data.status === "success";
      setConnectionStatus((prev) => ({
        ...prev,
        [service]: isSuccess ? "success" : "error",
      }));

      // If connection successful, load models
      if (isSuccess && service === "ollama") {
        void fetchOllamaModels();
      }
      if (isSuccess && service === "mistral") {
        void fetchMistralModels();
      }
    },
    [fetchOllamaModels, fetchMistralModels],
  );

  // Auto-test connections when settings are loaded (isSyncing becomes false)
  useEffect(() => {
    // Only auto-test once after initial sync is complete
    if (isSyncing || hasAutoTestedRef.current) {
      return;
    }

    hasAutoTestedRef.current = true;

    const autoTest = async () => {
      const tests: Promise<void>[] = [];
      if (paperlessUrl && paperlessTokenConfigured) {
        tests.push(testConnection("paperless"));
      }
      if (ollamaUrl) {
        tests.push(testConnection("ollama"));
      }
      if (qdrantUrl) {
        tests.push(testConnection("qdrant"));
      }
      if (mistralApiKeyConfigured) {
        tests.push(testConnection("mistral"));
      }
      await Promise.all(tests);
    };

    autoTest();
  }, [
    isSyncing,
    paperlessUrl,
    paperlessTokenConfigured,
    ollamaUrl,
    qdrantUrl,
    mistralApiKeyConfigured,
    testConnection,
  ]);

  useEffect(() => {
    if (!isSyncing && openAiCliEnabled && openAiCodexModels.length === 0) {
      fetchOpenAiCodexModels();
    }
  }, [fetchOpenAiCodexModels, isSyncing, openAiCliEnabled, openAiCodexModels.length]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Paperless-ngx */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusIndicator status={connectionStatus.paperless} />
            {t("paperless.title")}
          </CardTitle>
          <CardDescription>{t("paperless.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="paperless_url">{t("paperless.serverUrl")}</Label>
            <Input
              id="paperless_url"
              placeholder={t("paperless.serverUrlPlaceholder")}
              value={paperlessUrl}
              onChange={(e) => updateSettingSafely("paperless.url", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paperless_token">{t("paperless.apiToken")}</Label>
            <div className="flex gap-2">
              <SecretInput
                id="paperless_token"
                placeholder={t("paperless.apiTokenPlaceholder")}
                configuredPlaceholder={t("paperless.apiTokenConfigured")}
                configured={paperlessTokenConfigured}
                settingKey="paperless.token"
                visible={showSecrets.paperless_token}
                updateSetting={updateSetting}
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label={
                  showSecrets.paperless_token ? t("paperless.hideToken") : t("paperless.showToken")
                }
                onClick={() =>
                  setShowSecrets((prev) => ({
                    ...prev,
                    paperless_token: !prev.paperless_token,
                  }))
                }
              >
                {showSecrets.paperless_token ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paperless_external_url">{t("paperless.externalUrl")}</Label>
            <Input
              id="paperless_external_url"
              placeholder={t("paperless.externalUrlPlaceholder")}
              value={paperlessExternalUrl}
              onChange={(e) => updateSettingSafely("paperless.external_url", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("paperless.externalUrlDescription")}</p>
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
          <CardDescription>{t("ollama.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ollama_url">{t("ollama.serverUrl")}</Label>
            <div className="flex gap-2">
              <Input
                id="ollama_url"
                placeholder={t("ollama.serverUrlPlaceholder")}
                value={ollamaUrl}
                onChange={(e) => updateSettingSafely("ollama.url", e.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("testConnection")}
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
                <span className="text-sm font-medium">
                  {t("ollama.availableModels")} ({ollamaModels.length})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("ollama.refreshModels")}
                  onClick={fetchOllamaModels}
                  disabled={loadingModels.ollama}
                >
                  <RefreshCw className={`h-4 w-4 ${loadingModels.ollama ? "animate-spin" : ""}`} />
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.generationModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaModel}
                  onValueChange={(v) => updateSettingSafely("ollama.model", v)}
                  placeholder={t("ollama.selectGenerationModel")}
                  searchPlaceholder={t("modelSearchPlaceholder")}
                  emptyText={t("modelEmptyText")}
                />
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.embeddingModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaEmbeddingModel}
                  onValueChange={(v) => updateSettingSafely("ollama.embedding_model", v)}
                  placeholder={t("ollama.selectEmbeddingModel")}
                  searchPlaceholder={t("modelSearchPlaceholder")}
                  emptyText={t("modelEmptyText")}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* OpenAI subscription CLI connector */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusIndicator status={openAiCliEnabled ? "success" : "idle"} />
            {t("openai.title")}
          </CardTitle>
          <CardDescription>
            {t("openai.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="openai-enabled">{t("openai.enableConnector")}</Label>
              <p className="text-xs text-muted-foreground">
                {t("openai.enableDesc")}
              </p>
            </div>
            <Switch
              id="openai-enabled"
              checked={openAiCliEnabled}
              onCheckedChange={(v) => updateSettingSafely("openai_cli.enabled", v)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="openai_cli_command">{t("openai.cliCommand")}</Label>
            <Input
              id="openai_cli_command"
              value={openAiCliCommand}
              onChange={(e) => updateSettingSafely("openai_cli.command", e.target.value)}
              placeholder={t("openai.commandPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("openai.subscriptionModel")}</Label>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("openai.refreshModels")}
                onClick={fetchOpenAiCodexModels}
                disabled={loadingModels.openai}
              >
                <RefreshCw className={`h-4 w-4 ${loadingModels.openai ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <ModelCombobox
              models={openAiCodexModels.map((m) => ({ name: m.name || m.id, value: m.id }))}
              value={openAiCliModel}
              onValueChange={(v) => updateSettingSafely("openai_cli.model", v)}
              placeholder={t("openai.selectModel")}
              searchPlaceholder={t("openai.searchModels")}
              emptyText={t("openai.noModels")}
              disabled={loadingModels.openai}
            />
            <p className="text-xs text-muted-foreground">
              {t("openai.modelDesc")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="openai_cli_reasoning_effort">{t("openai.thinkingLevel")}</Label>
              <select
                id="openai_cli_reasoning_effort"
                value={openAiCliReasoningEffort || "medium"}
                onChange={(e) => updateSettingSafely("openai_cli.reasoning_effort", e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {OPENAI_THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {t(`openai.thinkingLevels.${level}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {t("openai.reasoningDesc")}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="openai_cli_fast_mode">{t("openai.fastMode")}</Label>
                <p className="text-xs text-muted-foreground">{t("openai.fastModeDesc")}</p>
              </div>
              <Switch
                id="openai_cli_fast_mode"
                checked={openAiCliFastMode}
                onCheckedChange={(v) => updateSettingSafely("openai_cli.fast_mode", v)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="openai_cli_scope">{t("openai.allowedWork")}</Label>
            <select
              id="openai_cli_scope"
              value={openAiCliScope || "chat"}
              onChange={(e) => updateSettingSafely("openai_cli.scope", e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="chat">{t("openai.scopeChat")}</option>
              <option value="full_pipeline">{t("openai.scopeFullPipeline")}</option>
              <option value="catalog">{t("openai.scopeCatalog")}</option>
              <option value="all">{t("openai.scopeAll")}</option>
            </select>
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
          <CardDescription>{t("mistral.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mistral_api_key">{t("mistral.apiKey")}</Label>
            <div className="flex gap-2">
              <SecretInput
                id="mistral_api_key"
                placeholder={t("mistral.apiKeyPlaceholder")}
                configuredPlaceholder={t("mistral.apiKeyConfigured")}
                configured={mistralApiKeyConfigured}
                settingKey="mistral.api_key"
                visible={showSecrets.mistral_api_key}
                updateSetting={updateSetting}
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
                aria-label={
                  showSecrets.mistral_api_key ? t("mistral.hideApiKey") : t("mistral.showApiKey")
                }
                onClick={() =>
                  setShowSecrets((prev) => ({
                    ...prev,
                    mistral_api_key: !prev.mistral_api_key,
                  }))
                }
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
                aria-label={t("testConnection")}
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
                aria-label={t("mistral.refreshModels")}
                onClick={fetchMistralModels}
                disabled={loadingModels.mistral}
              >
                <RefreshCw className={`h-4 w-4 ${loadingModels.mistral ? "animate-spin" : ""}`} />
              </Button>
            </div>
            <ModelCombobox
              models={mistralModels.map((m) => ({ name: m.name || m.id, value: m.id }))}
              value={mistralModel}
              onValueChange={(v) => updateSettingSafely("mistral.model", v)}
              placeholder={t("mistral.selectOcrModel")}
              searchPlaceholder={t("modelSearchPlaceholder")}
              emptyText={t("modelEmptyWithRefresh")}
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
          <CardDescription>{t("qdrant.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qdrant_url">{t("qdrant.serverUrl")}</Label>
            <div className="flex gap-2">
              <Input
                id="qdrant_url"
                placeholder={t("qdrant.serverUrlPlaceholder")}
                value={qdrantUrl}
                onChange={(e) => updateSettingSafely("qdrant.url", e.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                aria-label={t("testConnection")}
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
              placeholder={t("qdrant.collectionPlaceholder")}
              value={qdrantCollection}
              onChange={(e) => updateSettingSafely("qdrant.collection", e.target.value)}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="vector-search-enabled">{t("qdrant.vectorSearch")}</Label>
                <p className="text-xs text-zinc-500">{t("qdrant.vectorSearchDesc")}</p>
              </div>
              <Switch
                id="vector-search-enabled"
                checked={vectorSearchEnabled}
                onCheckedChange={(v) => updateSettingSafely("vector_search.enabled", v)}
              />
            </div>

            {vectorSearchEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vector-search-top-k">{t("qdrant.topKResults")}</Label>
                  <Input
                    id="vector-search-top-k"
                    type="number"
                    min={1}
                    max={20}
                    value={vectorSearchTopK}
                    onChange={(e) =>
                      updateSettingSafely("vector_search.top_k", Number.parseInt(e.target.value, 10) || 5)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vector-search-min-score">{t("qdrant.minScore")}</Label>
                  <Input
                    id="vector-search-min-score"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={vectorSearchMinScore}
                    onChange={(e) =>
                      updateSettingSafely("vector_search.min_score", parseFloat(e.target.value) || 0.7)
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
