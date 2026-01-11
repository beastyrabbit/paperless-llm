"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  TestTube,
  RefreshCw,
  Database,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Input,
  Button,
  Switch,
  Separator,
} from "@repo/ui";
import { useTinyBase, useStringSetting, useBooleanSetting, useNumberSetting } from "@/lib/tinybase";
import { StatusIndicator, type ConnectionStatus, type OllamaModel, type MistralModel } from "./shared";
import { ModelCombobox } from "@/components/model-combobox";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function ConnectionsTab() {
  const t = useTranslations("settings");
  const { updateSetting, isSyncing } = useTinyBase();
  const hasAutoTestedRef = useRef(false);

  // TinyBase settings (persisted)
  const paperlessUrl = useStringSetting("paperless.url");
  const paperlessToken = useStringSetting("paperless.token");
  const paperlessExternalUrl = useStringSetting("paperless.external_url");
  const ollamaUrl = useStringSetting("ollama.url");
  const ollamaModelLarge = useStringSetting("ollama.model_large");
  const ollamaModelSmall = useStringSetting("ollama.model_small");
  const ollamaModelTranslation = useStringSetting("ollama.model_translation");
  const ollamaEmbeddingModel = useStringSetting("ollama.embedding_model");
  const mistralApiKey = useStringSetting("mistral.api_key");
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
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({
    ollama: false,
    mistral: false,
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({
    paperless_token: false,
    mistral_api_key: false,
  });

  // Fetch models
  const fetchOllamaModels = useCallback(async () => {
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
  }, []);

  const fetchMistralModels = useCallback(async () => {
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
  }, []);

  // Test connection
  const testConnection = useCallback(async (service: string) => {
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

      // If connection successful, load models
      if (data.status === "success" && service === "ollama") {
        fetchOllamaModels();
      }
      if (data.status === "success" && service === "mistral") {
        fetchMistralModels();
      }
    } catch {
      setConnectionStatus((prev) => ({ ...prev, [service]: "error" }));
    }
  }, [fetchOllamaModels, fetchMistralModels]);

  // Auto-test connections when settings are loaded (isSyncing becomes false)
  useEffect(() => {
    // Only auto-test once after initial sync is complete
    if (isSyncing || hasAutoTestedRef.current) {
      return;
    }

    hasAutoTestedRef.current = true;

    const autoTest = async () => {
      const tests: Promise<void>[] = [];
      if (paperlessUrl && paperlessToken) {
        tests.push(testConnection("paperless"));
      }
      if (ollamaUrl) {
        tests.push(testConnection("ollama"));
      }
      if (qdrantUrl) {
        tests.push(testConnection("qdrant"));
      }
      if (mistralApiKey) {
        tests.push(testConnection("mistral"));
      }
      await Promise.all(tests);
    };

    autoTest();
  }, [isSyncing, paperlessUrl, paperlessToken, ollamaUrl, qdrantUrl, mistralApiKey, testConnection]);

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
              placeholder="http://your-paperless:8000"
              value={paperlessUrl}
              onChange={(e) => updateSetting("paperless.url", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paperless_token">{t("paperless.apiToken")}</Label>
            <div className="flex gap-2">
              <Input
                id="paperless_token"
                type={showSecrets.paperless_token ? "text" : "password"}
                placeholder="Your Paperless API token"
                value={paperlessToken}
                onChange={(e) => updateSetting("paperless.token", e.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
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
              placeholder="https://paperless.example.com"
              value={paperlessExternalUrl}
              onChange={(e) => updateSetting("paperless.external_url", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t("paperless.externalUrlDescription")}
            </p>
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
                placeholder="http://your-ollama:11434"
                value={ollamaUrl}
                onChange={(e) => updateSetting("ollama.url", e.target.value)}
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
                <span className="text-sm font-medium">
                  {t("ollama.availableModels")} ({ollamaModels.length})
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={fetchOllamaModels}
                  disabled={loadingModels.ollama}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loadingModels.ollama ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.largeModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaModelLarge}
                  onValueChange={(v) => updateSetting("ollama.model_large", v)}
                  placeholder="Select large model..."
                  searchPlaceholder="Search models..."
                  emptyText="No model found."
                />
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.smallModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaModelSmall}
                  onValueChange={(v) => updateSetting("ollama.model_small", v)}
                  placeholder="Select small model..."
                  searchPlaceholder="Search models..."
                  emptyText="No model found."
                />
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.embeddingModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaEmbeddingModel}
                  onValueChange={(v) => updateSetting("ollama.embedding_model", v)}
                  placeholder="Select embedding model..."
                  searchPlaceholder="Search models..."
                  emptyText="No model found."
                />
              </div>

              <div className="space-y-2">
                <Label>{t("ollama.translationModel")}</Label>
                <ModelCombobox
                  models={ollamaModels}
                  value={ollamaModelTranslation}
                  onValueChange={(v) => updateSetting("ollama.model_translation", v)}
                  placeholder="Select translation model (optional)..."
                  searchPlaceholder="Search models..."
                  emptyText="No model found."
                />
                <p className="text-xs text-zinc-500">{t("ollama.translationModelDesc")}</p>
              </div>
            </>
          )}

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
              <Input
                id="mistral_api_key"
                type={showSecrets.mistral_api_key ? "text" : "password"}
                placeholder="Your Mistral API key"
                value={mistralApiKey}
                onChange={(e) => updateSetting("mistral.api_key", e.target.value)}
              />
              <Button
                variant="outline"
                size="icon"
                type="button"
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
                onClick={fetchMistralModels}
                disabled={loadingModels.mistral}
              >
                <RefreshCw
                  className={`h-4 w-4 ${loadingModels.mistral ? "animate-spin" : ""}`}
                />
              </Button>
            </div>
            <ModelCombobox
              models={mistralModels.map((m) => ({ name: m.name || m.id, value: m.id }))}
              value={mistralModel}
              onValueChange={(v) => updateSetting("mistral.model", v)}
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
          <CardDescription>{t("qdrant.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qdrant_url">{t("qdrant.serverUrl")}</Label>
            <div className="flex gap-2">
              <Input
                id="qdrant_url"
                placeholder="http://your-qdrant:6333"
                value={qdrantUrl}
                onChange={(e) => updateSetting("qdrant.url", e.target.value)}
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
              value={qdrantCollection}
              onChange={(e) => updateSetting("qdrant.collection", e.target.value)}
            />
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("qdrant.vectorSearch")}</Label>
                <p className="text-xs text-zinc-500">{t("qdrant.vectorSearchDesc")}</p>
              </div>
              <Switch
                checked={vectorSearchEnabled}
                onCheckedChange={(v) => updateSetting("vector_search.enabled", v)}
              />
            </div>

            {vectorSearchEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t("qdrant.topKResults")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={vectorSearchTopK}
                    onChange={(e) =>
                      updateSetting("vector_search.top_k", parseInt(e.target.value) || 5)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("qdrant.minScore")}</Label>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={vectorSearchMinScore}
                    onChange={(e) =>
                      updateSetting(
                        "vector_search.min_score",
                        parseFloat(e.target.value) || 0.7
                      )
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
