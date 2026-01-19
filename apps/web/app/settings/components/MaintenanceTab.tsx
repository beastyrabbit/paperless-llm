"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  User,
  FileText,
  Tag,
  Zap,
  Play,
  Square,
  SkipForward,
  ChevronUp,
  ChevronDown,
  Trash2,
  Clock,
  Calendar,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Progress,
} from "@repo/ui";
import {
  jobsApi,
  settingsApi,
  BootstrapProgress,
  BootstrapAnalysisType,
  JobScheduleStatus,
  ScheduleType,
  BulkOCRProgress,
  BulkIngestProgress,
  ProcessingLogStats,
} from "@/lib/api";

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

export function MaintenanceTab() {
  const tMaint = useTranslations("maintenance");
  const tCommon = useTranslations("common");

  // Bootstrap state
  const [bootstrapProgress, setBootstrapProgress] = useState<BootstrapProgress | null>(null);
  const [bootstrapStarting, setBootstrapStarting] = useState<string | null>(null);
  const [bootstrapLoading, setBootstrapLoading] = useState(false);
  const [bootstrapDetailsOpen, setBootstrapDetailsOpen] = useState(false);

  // Bulk OCR state
  const [bulkOCRProgress, setBulkOCRProgress] = useState<BulkOCRProgress | null>(null);
  const [bulkOCRStarting, setBulkOCRStarting] = useState(false);
  const [bulkOCRDocsPerSecond, setBulkOCRDocsPerSecond] = useState(1.0);
  const [bulkOCRSkipExisting, setBulkOCRSkipExisting] = useState(true);

  // Bulk Ingest state (OCR + Vector DB)
  const [bulkIngestProgress, setBulkIngestProgress] = useState<BulkIngestProgress | null>(null);
  const [bulkIngestStarting, setBulkIngestStarting] = useState(false);
  const [bulkIngestDocsPerSecond, setBulkIngestDocsPerSecond] = useState(0.5);
  const [bulkIngestRunOcr, setBulkIngestRunOcr] = useState(true);
  const [bulkIngestSkipExistingOcr, setBulkIngestSkipExistingOcr] = useState(true);

  // Schedule state
  const [scheduleStatus, setScheduleStatus] = useState<JobScheduleStatus | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState<string | null>(null);
  const [manualTriggerLoading, setManualTriggerLoading] = useState<string | null>(null);

  // Processing logs state
  const [processingLogStats, setProcessingLogStats] = useState<ProcessingLogStats | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);

  // Error state
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

  // Load functions
  const loadBootstrapStatus = useCallback(async () => {
    const response = await jobsApi.getBootstrapStatus();
    if (response.data) {
      setBootstrapProgress(response.data);
    }
  }, []);

  const loadBulkOCRStatus = useCallback(async () => {
    const response = await jobsApi.getBulkOCRStatus();
    if (response.data) {
      setBulkOCRProgress(response.data);
    }
  }, []);

  const loadBulkIngestStatus = useCallback(async () => {
    const response = await jobsApi.getBulkIngestStatus();
    if (response.data) {
      setBulkIngestProgress(response.data);
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

  const loadProcessingLogStats = useCallback(async () => {
    const { data } = await settingsApi.getProcessingLogStats();
    if (data) {
      setProcessingLogStats(data);
    }
  }, []);

  // Initial load
  useEffect(() => {
    loadBootstrapStatus();
    loadBulkOCRStatus();
    loadBulkIngestStatus();
    loadScheduleStatus();
    loadProcessingLogStats();
  }, [loadBootstrapStatus, loadBulkOCRStatus, loadBulkIngestStatus, loadScheduleStatus, loadProcessingLogStats]);

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

  // Poll bulk ingest status while running
  useEffect(() => {
    if (bulkIngestProgress?.status === "running") {
      const interval = setInterval(loadBulkIngestStatus, 2000);
      return () => clearInterval(interval);
    }
  }, [bulkIngestProgress?.status, loadBulkIngestStatus]);

  // Bootstrap handlers
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

  // Bulk OCR handlers
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

  // Bulk Ingest handlers
  const handleStartBulkIngest = async () => {
    setBulkIngestStarting(true);
    setMaintenanceError(null);
    const response = await jobsApi.startBulkIngest({
      docs_per_second: bulkIngestDocsPerSecond,
      skip_existing_ocr: bulkIngestSkipExistingOcr,
      run_ocr: bulkIngestRunOcr,
    });
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBulkIngestStatus();
    }
    setBulkIngestStarting(false);
  };

  const handleCancelBulkIngest = async () => {
    setMaintenanceError(null);
    const response = await jobsApi.cancelBulkIngest();
    if (response.error) {
      setMaintenanceError(response.error);
    } else {
      await loadBulkIngestStatus();
    }
  };

  // Schedule handlers
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
    const response =
      jobName === "schema_cleanup"
        ? await jobsApi.triggerSchemaCleanup()
        : await jobsApi.triggerMetadataEnhancement();
    if (response.error) {
      setMaintenanceError(response.error);
    }
    setManualTriggerLoading(null);
  };

  // Processing logs handlers
  const handleClearProcessingLogs = async () => {
    setClearingLogs(true);
    const { error } = await settingsApi.clearAllProcessingLogs();
    if (!error) {
      setProcessingLogStats({ totalLogs: 0, oldestLog: null, newestLog: null });
    }
    setClearingLogs(false);
  };

  // Computed values
  const bootstrapProgressPercent = bootstrapProgress?.total
    ? Math.round((bootstrapProgress.processed / bootstrapProgress.total) * 100)
    : 0;
  const isBootstrapRunning = bootstrapProgress?.status === "running";

  const bulkOCRProgressPercent = bulkOCRProgress?.total
    ? Math.round((bulkOCRProgress.processed / bulkOCRProgress.total) * 100)
    : 0;
  const isBulkOCRRunning = bulkOCRProgress?.status === "running";

  const bulkIngestProgressPercent = bulkIngestProgress?.total
    ? Math.round((bulkIngestProgress.processed / bulkIngestProgress.total) * 100)
    : 0;
  const isBulkIngestRunning = bulkIngestProgress?.status === "running";

  const formatMaintenanceDate = (dateString: string | null) => {
    if (!dateString) return tMaint("scheduled.never");
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  return (
    <div className="space-y-6">
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
                    <Badge variant="secondary">{tMaint("bootstrap.cancelled")}</Badge>
                  )}
                  {bootstrapProgress.status === "failed" && (
                    <Badge variant="destructive">{tMaint("bootstrap.failed")}</Badge>
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
                      {bootstrapProgress.processed}/{bootstrapProgress.total} (
                      {bootstrapProgressPercent}%)
                    </span>
                  </div>
                  <Progress value={bootstrapProgressPercent} className="h-2" />
                  {isBootstrapRunning &&
                    bootstrapProgress.estimated_remaining_seconds !== null && (
                      <div className="text-xs text-zinc-500 mt-1">
                        {tMaint("bootstrap.eta")}:{" "}
                        {formatETA(bootstrapProgress.estimated_remaining_seconds)}
                      </div>
                    )}
                </div>
              )}

              {/* Current Phase with Entity Count and Document Coverage */}
              {bootstrapProgress.current_doc_title && isBootstrapRunning && (
                <div className="text-sm">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">
                    {tMaint("bootstrap.phase")} {bootstrapProgress.processed + 1}/{bootstrapProgress.total}:
                  </span>{" "}
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {bootstrapProgress.current_doc_title}
                  </span>
                  {bootstrapProgress.total_documents && (
                    <span className="text-zinc-500 ml-1">
                      ({tMaint("bootstrap.coveringDocs", { count: bootstrapProgress.total_documents.toLocaleString() })})
                    </span>
                  )}
                </div>
              )}

              {/* Stats with Expandable Details */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 text-sm">
                    <div>
                      <span className="text-zinc-500">
                        {tMaint("bootstrap.suggestionsFound")}:
                      </span>{" "}
                      <span className="font-medium text-emerald-600">
                        {bootstrapProgress.suggestions_found}
                      </span>
                    </div>
                    {bootstrapProgress.errors > 0 && (
                      <div>
                        <span className="text-zinc-500">{tMaint("bootstrap.errors")}:</span>{" "}
                        <span className="font-medium text-red-600">
                          {bootstrapProgress.errors}
                        </span>
                      </div>
                    )}
                    {bootstrapProgress.skipped > 0 && (
                      <div>
                        <span className="text-zinc-500">{tMaint("bootstrap.skipped")}:</span>{" "}
                        <span className="font-medium text-amber-600">
                          {bootstrapProgress.skipped}
                        </span>
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
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {tMaint("bootstrap.correspondentsCount")}:
                        </span>
                        <span className="font-medium">
                          {bootstrapProgress.suggestions_by_type.correspondents}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-purple-500" />
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {tMaint("bootstrap.typesCount")}:
                        </span>
                        <span className="font-medium">
                          {bootstrapProgress.suggestions_by_type.document_types}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Tag className="h-4 w-4 text-emerald-500" />
                        <span className="text-zinc-600 dark:text-zinc-400">
                          {tMaint("bootstrap.tagsCount")}:
                        </span>
                        <span className="font-medium">
                          {bootstrapProgress.suggestions_by_type.tags}
                        </span>
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
                    <Badge variant="secondary">{tMaint("bulkOCR.cancelled")}</Badge>
                  )}
                  {bulkOCRProgress.status === "failed" && (
                    <Badge variant="destructive">{tMaint("bulkOCR.failed")}</Badge>
                  )}
                </div>
                {isBulkOCRRunning && (
                  <Button variant="outline" size="sm" onClick={handleCancelBulkOCR}>
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
                      {bulkOCRProgress.processed}/{bulkOCRProgress.total} (
                      {bulkOCRProgressPercent}%)
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
                  <span className="font-medium">
                    {bulkOCRProgress.processed - bulkOCRProgress.skipped}
                  </span>
                </div>
                {bulkOCRProgress.skipped > 0 && (
                  <div>
                    <span className="text-zinc-500">{tMaint("bulkOCR.skipped")}:</span>{" "}
                    <span className="font-medium text-zinc-600">
                      {bulkOCRProgress.skipped}
                    </span>
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

      {/* Bulk Ingest Card (OCR + Vector DB) */}
      <Card>
        <CardHeader>
          <CardTitle>Vector Database Ingest</CardTitle>
          <CardDescription>
            Process documents through OCR and add them to the vector database for semantic search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Configuration */}
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label htmlFor="ingest-rate">Docs/sec</Label>
              <Input
                id="ingest-rate"
                type="number"
                min="0.1"
                max="5"
                step="0.1"
                value={bulkIngestDocsPerSecond}
                onChange={(e) => setBulkIngestDocsPerSecond(parseFloat(e.target.value) || 0.5)}
                disabled={isBulkIngestRunning}
                className="w-24"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="run-ocr"
                checked={bulkIngestRunOcr}
                onCheckedChange={setBulkIngestRunOcr}
                disabled={isBulkIngestRunning}
              />
              <Label htmlFor="run-ocr">Run OCR</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="skip-existing-ocr"
                checked={bulkIngestSkipExistingOcr}
                onCheckedChange={setBulkIngestSkipExistingOcr}
                disabled={isBulkIngestRunning || !bulkIngestRunOcr}
              />
              <Label htmlFor="skip-existing-ocr">Skip existing OCR</Label>
            </div>
            <Button
              onClick={handleStartBulkIngest}
              disabled={isBulkIngestRunning || bulkIngestStarting}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {bulkIngestStarting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Ingest to Vector DB
            </Button>
          </div>

          {/* Progress Display */}
          {bulkIngestProgress && bulkIngestProgress.status !== "idle" && (
            <div className="mt-4 p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900 space-y-3">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {bulkIngestProgress.status === "running" && (
                    <Badge variant="default" className="bg-blue-500">
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      Running
                    </Badge>
                  )}
                  {bulkIngestProgress.status === "completed" && (
                    <Badge variant="default" className="bg-emerald-500">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Completed
                    </Badge>
                  )}
                  {bulkIngestProgress.status === "cancelled" && (
                    <Badge variant="secondary">Cancelled</Badge>
                  )}
                  {bulkIngestProgress.status === "failed" && (
                    <Badge variant="destructive">Failed</Badge>
                  )}
                  {bulkIngestProgress.current_phase && isBulkIngestRunning && (
                    <span className="text-xs text-zinc-500 capitalize">
                      ({bulkIngestProgress.current_phase})
                    </span>
                  )}
                </div>
                {isBulkIngestRunning && (
                  <Button variant="outline" size="sm" onClick={handleCancelBulkIngest}>
                    <Square className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>

              {/* Progress Bar */}
              {bulkIngestProgress.total > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-400">
                    <span>Progress</span>
                    <span>
                      {bulkIngestProgress.processed}/{bulkIngestProgress.total} (
                      {bulkIngestProgressPercent}%)
                    </span>
                  </div>
                  <Progress value={bulkIngestProgressPercent} className="h-2" />
                </div>
              )}

              {/* Current Document */}
              {bulkIngestProgress.current_doc_title && isBulkIngestRunning && (
                <div className="text-sm">
                  <span className="text-zinc-500">Current:</span>{" "}
                  <span className="font-medium">{bulkIngestProgress.current_doc_title}</span>
                </div>
              )}

              {/* Stats */}
              <div className="flex gap-4 text-sm">
                {bulkIngestProgress.ocr_processed > 0 && (
                  <div>
                    <span className="text-zinc-500">OCR:</span>{" "}
                    <span className="font-medium text-blue-600">
                      {bulkIngestProgress.ocr_processed}
                    </span>
                  </div>
                )}
                <div>
                  <span className="text-zinc-500">Indexed:</span>{" "}
                  <span className="font-medium text-emerald-600">
                    {bulkIngestProgress.vector_indexed}
                  </span>
                </div>
                {bulkIngestProgress.skipped > 0 && (
                  <div>
                    <span className="text-zinc-500">Skipped:</span>{" "}
                    <span className="font-medium text-zinc-600">
                      {bulkIngestProgress.skipped}
                    </span>
                  </div>
                )}
                {bulkIngestProgress.errors > 0 && (
                  <div>
                    <span className="text-zinc-500">Errors:</span>{" "}
                    <span className="font-medium text-red-600">{bulkIngestProgress.errors}</span>
                  </div>
                )}
              </div>

              {/* Error Message */}
              {bulkIngestProgress.error_message && (
                <div className="text-sm text-red-600 dark:text-red-400">
                  {bulkIngestProgress.error_message}
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

      {/* Processing Logs Card */}
      <Card>
        <CardHeader>
          <CardTitle>{tMaint("processingLogs.title")}</CardTitle>
          <CardDescription>{tMaint("processingLogs.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-zinc-50 dark:bg-zinc-900">
            <div className="space-y-1">
              <div className="text-sm font-medium">{tMaint("processingLogs.totalLogs")}</div>
              <div className="text-2xl font-bold">{processingLogStats?.totalLogs ?? 0}</div>
              {processingLogStats?.oldestLog && processingLogStats?.newestLog && (
                <div className="text-xs text-zinc-500">
                  {tMaint("processingLogs.dateRange", {
                    from: new Date(processingLogStats.oldestLog).toLocaleDateString(),
                    to: new Date(processingLogStats.newestLog).toLocaleDateString(),
                  })}
                </div>
              )}
            </div>
            <Button
              variant="destructive"
              onClick={handleClearProcessingLogs}
              disabled={clearingLogs || (processingLogStats?.totalLogs ?? 0) === 0}
            >
              {clearingLogs ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-2" />
              )}
              {tMaint("processingLogs.clearAll")}
            </Button>
          </div>
        </CardContent>
      </Card>
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

      <Button variant="outline" size="sm" onClick={onTrigger} disabled={triggerLoading}>
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
