"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  Zap,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  Database,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Badge,
} from "@repo/ui";
import Link from "next/link";

interface QueueStats {
  pending: number;
  ocr_done: number;
  title_done: number;
  correspondent_done: number;
  document_type_done: number;
  tags_done: number;
  processed: number;
  total_in_pipeline: number;
  total_documents: number;
}

interface ConnectionStatus {
  paperless: "connected" | "disconnected" | "checking";
  ollama: "connected" | "disconnected" | "checking";
  qdrant: "connected" | "disconnected" | "checking";
  mistral: "connected" | "disconnected" | "checking";
}

interface ServiceInfo {
  name: string;
  key: keyof ConnectionStatus;
  url: string;
}

export default function Dashboard() {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common");
  const tServices = useTranslations("services");
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [connections, setConnections] = useState<ConnectionStatus>({
    paperless: "checking",
    ollama: "checking",
    qdrant: "checking",
    mistral: "checking",
  });
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:8000/api/settings");
      if (response.ok) {
        const data = await response.json();
        setServices([
          { name: tServices("paperless"), key: "paperless", url: data.paperless_url || tCommon("notConfigured") },
          { name: tServices("ollama"), key: "ollama", url: data.ollama_url || tCommon("notConfigured") },
          { name: tServices("qdrant"), key: "qdrant", url: data.qdrant_url || tCommon("notConfigured") },
          { name: tServices("mistral"), key: "mistral", url: data.mistral_api_key ? tCommon("apiKeyConfigured") : tCommon("notConfigured") },
        ]);
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    }
  }, [tServices, tCommon]);

  const fetchQueueStats = useCallback(async () => {
    try {
      const response = await fetch("http://localhost:8000/api/documents/queue");
      if (response.ok) {
        const data = await response.json();
        setStats(data);
        setError(null);
      } else {
        setError(t("failedToFetchQueue"));
      }
    } catch (err) {
      setError(t("unableToConnect"));
      console.error("Failed to fetch queue stats:", err);
    }
  }, [t]);

  const testConnections = useCallback(async () => {
    const serviceKeys: (keyof ConnectionStatus)[] = ["paperless", "ollama", "qdrant", "mistral"];

    for (const service of serviceKeys) {
      try {
        const response = await fetch(`http://localhost:8000/api/settings/test-connection/${service}`, {
          method: "POST",
        });
        if (response.ok) {
          const data = await response.json();
          setConnections(prev => ({
            ...prev,
            [service]: data.status === "connected" ? "connected" : "disconnected",
          }));
        } else {
          setConnections(prev => ({ ...prev, [service]: "disconnected" }));
        }
      } catch {
        setConnections(prev => ({ ...prev, [service]: "disconnected" }));
      }
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setConnections({
      paperless: "checking",
      ollama: "checking",
      qdrant: "checking",
      mistral: "checking",
    });
    await Promise.all([fetchSettings(), fetchQueueStats(), testConnections()]);
    setLoading(false);
  }, [fetchSettings, fetchQueueStats, testConnections]);

  useEffect(() => {
    // Initial load - intentionally calling refresh on mount
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const pipelineSteps = [
    { name: t("pending"), count: stats?.pending ?? 0, color: "bg-amber-500" },
    { name: t("ocr"), count: stats?.ocr_done ?? 0, color: "bg-blue-500" },
    { name: t("correspondent"), count: stats?.correspondent_done ?? 0, color: "bg-pink-500" },
    { name: t("docType"), count: stats?.document_type_done ?? 0, color: "bg-indigo-500" },
    { name: t("titleStep"), count: stats?.title_done ?? 0, color: "bg-purple-500" },
    { name: t("tags"), count: stats?.tags_done ?? 0, color: "bg-orange-500" },
  ];

  const allConnected = Object.values(connections).every(s => s === "connected");
  const anyChecking = Object.values(connections).some(s => s === "checking");

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-zinc-500">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {tCommon("refresh")}
            </Button>
            {anyChecking ? (
              <Badge variant="secondary" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                {tCommon("checking")}
              </Badge>
            ) : allConnected ? (
              <Badge variant="success" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {t("allSystemsOnline")}
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {t("someServicesOffline")}
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="p-8 stagger-children">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="mb-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">
                {t("totalDocuments")}
              </CardTitle>
              <Database className="h-4 w-4 text-zinc-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {loading ? "—" : stats?.total_documents ?? 0}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {t("inPaperless")}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">
                {t("inPipeline")}
              </CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {loading ? "—" : stats?.total_in_pipeline ?? 0}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {t("documentsBeingProcessed")}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">
                {t("pendingOcr")}
              </CardTitle>
              <FileText className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {loading ? "—" : stats?.pending ?? 0}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {t("awaitingProcessing")}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">
                {t("fullyProcessed")}
              </CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600">
                {loading ? "—" : stats?.processed ?? 0}
              </div>
              <p className="text-xs text-zinc-500 mt-1">
                {t("completedThroughPipeline")}
              </p>
            </CardContent>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-zinc-500">
                {t("ocrCompleted")}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {loading ? "—" : stats?.ocr_done ?? 0}
              </div>
              <p className="text-xs text-zinc-500 mt-1">{t("readyForTitle")}</p>
            </CardContent>
          </Card>
        </div>

        {/* Pipeline Visualization */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-emerald-500" />
              {t("processingPipeline")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-2">
              {pipelineSteps.map((step, i) => (
                <div key={step.name} className="flex items-center flex-1">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium">{step.name}</span>
                      <Badge variant="secondary" className="text-xs">
                        {step.count}
                      </Badge>
                    </div>
                    <div className="h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                      <div
                        className={`h-full ${step.color} transition-all duration-500`}
                        style={{ width: `${Math.min(step.count * 10, 100)}%` }}
                      />
                    </div>
                  </div>
                  {i < pipelineSteps.length - 1 && (
                    <ArrowRight className="h-4 w-4 text-zinc-300 mx-3 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Connections & Actions */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Service Status */}
          <Card>
            <CardHeader>
              <CardTitle>{t("serviceConnections")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {services.map((service) => (
                <div
                  key={service.key}
                  className="flex items-center justify-between rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        connections[service.key] === "connected"
                          ? "bg-emerald-500"
                          : connections[service.key] === "checking"
                          ? "bg-amber-500 animate-pulse"
                          : "bg-red-500"
                      }`}
                    />
                    <div>
                      <p className="text-sm font-medium">{service.name}</p>
                      <p className="text-xs text-zinc-500 truncate max-w-[200px]">{service.url}</p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      connections[service.key] === "connected"
                        ? "success"
                        : connections[service.key] === "checking"
                        ? "warning"
                        : "destructive"
                    }
                  >
                    {connections[service.key] === "connected"
                      ? tCommon("connected")
                      : connections[service.key] === "checking"
                      ? tCommon("checking")
                      : tCommon("disconnected")}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>{t("quickActions")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Link href="/documents">
                <Button className="w-full justify-between" variant="outline">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t("viewDocumentQueue")}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/pending">
                <Button className="w-full justify-between" variant="outline">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4" />
                    {t("reviewPendingItems")}
                  </span>
                  <Badge variant="warning" className="ml-2">{stats?.pending ?? 0}</Badge>
                </Button>
              </Link>
              <Link href="/settings">
                <Button className="w-full justify-between" variant="outline">
                  <span className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    {t("manageWorkflowTags")}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/settings">
                <Button className="w-full justify-between" variant="outline">
                  <span className="flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    {t("configureSettings")}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
