"use client";

import { Loader2, TestTube, RefreshCw, Brain, Database, Eye, EyeOff } from "lucide-react";
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
  Separator,
} from "@repo/ui";
import { ModelCombobox } from "@/components/model-combobox";
import { StatusIndicator } from "../StatusIndicator";
import type { Settings, ConnectionStatus, OllamaModel, MistralModel } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface ConnectionsTabProps {
  t: TranslationFunction;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  connectionStatus: Record<string, ConnectionStatus>;
  testConnection: (service: string) => Promise<void>;
  showSecrets: Record<string, boolean>;
  setShowSecrets: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  ollamaModels: OllamaModel[];
  mistralModels: MistralModel[];
  loadingModels: Record<string, boolean>;
  fetchOllamaModels: () => Promise<void>;
  loadMistralModels: () => Promise<void>;
}

export function ConnectionsTab({
  t,
  settings,
  updateSetting,
  connectionStatus,
  testConnection,
  showSecrets,
  setShowSecrets,
  ollamaModels,
  mistralModels,
  loadingModels,
  fetchOllamaModels,
  loadMistralModels,
}: ConnectionsTabProps) {
  return (
    <div className="space-y-6">
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
                  <p className="text-xs text-zinc-500">{t("ollama.translationModelDesc")}</p>
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
                  <p className="text-xs text-zinc-500">{t("ollama.thinkingModeDesc")}</p>
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
                    onValueChange={(v) =>
                      updateSetting("ollama_thinking_level", v as "low" | "medium" | "high")
                    }
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
                  value={settings.mistral_api_key}
                  onChange={(e) => updateSetting("mistral_api_key", e.target.value)}
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
                  onClick={loadMistralModels}
                  disabled={loadingModels.mistral}
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loadingModels.mistral ? "animate-spin" : ""}`}
                  />
                </Button>
              </div>
              <ModelCombobox
                models={mistralModels.map((m) => ({ name: m.id, value: m.id }))}
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
            <CardDescription>{t("qdrant.description")}</CardDescription>
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
                  <p className="text-xs text-zinc-500">{t("qdrant.vectorSearchDesc")}</p>
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
                      onChange={(e) =>
                        updateSetting("vector_search_top_k", parseInt(e.target.value) || 5)
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
                      value={settings.vector_search_min_score}
                      onChange={(e) =>
                        updateSetting(
                          "vector_search_min_score",
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
    </div>
  );
}
