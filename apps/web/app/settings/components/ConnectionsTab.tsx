"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import {
  CheckCircle2,
  CircleAlert,
  Database,
  FileScan,
  Loader2,
  RefreshCw,
  Server,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ConnectionTest, type Settings, settingsApi, systemApi } from "@/lib/api";

type ProviderKey = "paperless" | "mistral" | "ollama" | "qdrant";
type TestState = "idle" | "testing" | "connected" | "failed";

const providerOrder: readonly ProviderKey[] = ["paperless", "mistral", "ollama", "qdrant"];

const providerMeta: Record<
  ProviderKey,
  { title: string; description: string; icon: typeof Server; required: boolean }
> = {
  paperless: {
    title: "Paperless-ngx",
    description: "Authoritative documents, OCR content, metadata, and catalog.",
    icon: Server,
    required: true,
  },
  mistral: {
    title: "Mistral OCR",
    description: "Authoritative OCR extraction for new analysis runs.",
    icon: FileScan,
    required: true,
  },
  ollama: {
    title: "Ollama",
    description: "Optional chat, search, and embedding features retained outside the new pipeline.",
    icon: Sparkles,
    required: false,
  },
  qdrant: {
    title: "Qdrant",
    description: "Optional vector search index retained outside the new analysis pipeline.",
    icon: Database,
    required: false,
  },
};

const initialStates = (): Record<ProviderKey, TestState> => ({
  paperless: "idle",
  mistral: "idle",
  ollama: "idle",
  qdrant: "idle",
});

const configured = (provider: ProviderKey, settings: Settings | null): boolean => {
  if (!settings) return false;
  switch (provider) {
    case "paperless":
      return Boolean(settings.paperless_url && settings.paperless_token_configured);
    case "mistral":
      return settings.mistral_api_key_configured;
    case "ollama":
      return Boolean(settings.ollama_url);
    case "qdrant":
      return Boolean(settings.qdrant_url);
  }
};

const endpoint = (provider: ProviderKey, settings: Settings | null): string => {
  if (!settings) return "Loading…";
  switch (provider) {
    case "paperless":
      return settings.paperless_url || "Not configured";
    case "mistral":
      return settings.mistral_model || "mistral-ocr-latest";
    case "ollama":
      return settings.ollama_url || "Not configured";
    case "qdrant":
      return settings.qdrant_url || "Not configured";
  }
};

function StatusBadge({ state, isConfigured }: { state: TestState; isConfigured: boolean }) {
  if (state === "testing") {
    return (
      <Badge variant="secondary">
        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        Testing
      </Badge>
    );
  }
  if (state === "connected") {
    return (
      <Badge variant="success">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Connected
      </Badge>
    );
  }
  if (state === "failed") {
    return (
      <Badge variant="destructive">
        <CircleAlert className="mr-1 h-3 w-3" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant={isConfigured ? "outline" : "warning"}>
      {isConfigured ? "Ready" : "Missing"}
    </Badge>
  );
}

export function ConnectionsTab({ refreshToken = 0 }: { refreshToken?: number }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [states, setStates] = useState(initialStates);
  const [results, setResults] = useState<Partial<Record<ProviderKey, ConnectionTest>>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const response = await settingsApi.get();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    setSettings(response.data);
  }, []);

  const testProvider = useCallback(async (provider: ProviderKey) => {
    setStates((current) => ({ ...current, [provider]: "testing" }));
    const response = await settingsApi.testConnection(provider);
    if (!response.ok) {
      setStates((current) => ({ ...current, [provider]: "failed" }));
      setResults((current) => ({
        ...current,
        [provider]: { status: "error", message: response.error, details: null },
      }));
      return;
    }
    const passed = response.data.status === "success";
    setStates((current) => ({ ...current, [provider]: passed ? "connected" : "failed" }));
    setResults((current) => ({ ...current, [provider]: response.data }));
  }, []);

  const testAll = useCallback(async () => {
    await Promise.all(providerOrder.map(testProvider));
  }, [testProvider]);

  useEffect(() => {
    void refreshToken;
    void load();
  }, [load, refreshToken]);

  useEffect(() => {
    if (settings) void testAll();
  }, [settings, testAll]);

  const connectedCount = useMemo(
    () => providerOrder.filter((provider) => states[provider] === "connected").length,
    [states],
  );

  return (
    <div className="space-y-5">
      <Alert>
        <Server className="h-4 w-4" />
        <AlertTitle>Deployment-owned configuration</AlertTitle>
        <AlertDescription>
          Provider URLs, tokens, model IDs, and the Qdrant collection are loaded from Infisical for
          both local and production runs. No secret or provider endpoint is saved from this page.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          {connectedCount} of {providerOrder.length} connection checks passed.
        </p>
        <Button variant="outline" onClick={() => void testAll()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Test all connections
        </Button>
      </div>

      {error ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Settings unavailable</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {providerOrder.map((provider) => {
          const meta = providerMeta[provider];
          const Icon = meta.icon;
          const providerConfigured = configured(provider, settings);
          const result = results[provider];
          return (
            <Card key={provider}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-5 w-5 text-zinc-500" />
                    <div>
                      <CardTitle className="text-base">{meta.title}</CardTitle>
                      <CardDescription className="mt-1">{meta.description}</CardDescription>
                    </div>
                  </div>
                  <StatusBadge state={states[provider]} isConfigured={providerConfigured} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-zinc-500">Runtime value</p>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-800 dark:text-zinc-200">
                    {endpoint(provider, settings)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500">
                    {meta.required ? "Required by analysis" : "Optional retained feature"}
                    {result ? ` · ${result.message}` : ""}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={states[provider] === "testing" || !providerConfigured}
                    onClick={() => void testProvider(provider)}
                  >
                    {states[provider] === "testing" ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-2 h-4 w-4" />
                    )}
                    Test
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <RuntimeModelSummary />
    </div>
  );
}

function RuntimeModelSummary() {
  const [summary, setSummary] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void systemApi.getReadiness().then((response) => {
      if (!active || !response.ok) return;
      const { ollama, qdrant } = response.data.providers;
      setSummary(
        `Ollama ${ollama.model} · embeddings ${ollama.embeddingModel} · Qdrant ${qdrant.collection} (${qdrant.embeddingDimension} dimensions)`,
      );
    });
    return () => {
      active = false;
    };
  }, []);
  return summary ? (
    <p className="text-xs text-zinc-500" data-testid="runtime-model-summary">
      {summary}
    </p>
  ) : null;
}
