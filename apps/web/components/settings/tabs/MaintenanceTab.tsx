"use client";

import React, { useState, useEffect } from "react";
import {
  Tag,
  User,
  FileText,
  Zap,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronUp,
  ChevronDown,
  Square,
  SkipForward,
  Play,
  X,
  Clock,
  Calendar,
  Upload,
  Settings,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Alert,
  AlertDescription,
  AlertTitle,
  Label,
  Input,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Progress,
  Separator,
} from "@repo/ui";
import {
  type BootstrapProgress,
  type JobScheduleStatus,
  type ScheduleType,
  type BulkOCRProgress,
} from "@/lib/api";
import { formatETA } from "../StatusIndicator";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

type JobName = "schema_cleanup" | "metadata_enhancement";

interface MaintenanceTabProps {
  tMaint: TranslationFunction;
  tCommon: TranslationFunction;
  maintenanceError: string | null;
  setMaintenanceError: (val: string | null) => void;
  // Bootstrap
  bootstrapProgress: BootstrapProgress | null;
  bootstrapStarting: string | null;
  bootstrapLoading: boolean;
  bootstrapDetailsOpen: boolean;
  setBootstrapDetailsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  isBootstrapRunning: boolean;
  bootstrapProgressPercent: number;
  handleStartBootstrap: (type: string) => void;
  handleCancelBootstrap: () => void;
  handleSkipDocument: (count: number) => void;
  // Bulk OCR
  bulkOCRProgress: BulkOCRProgress | null;
  bulkOCRStarting: boolean;
  bulkOCRDocsPerSecond: number;
  setBulkOCRDocsPerSecond: React.Dispatch<React.SetStateAction<number>>;
  bulkOCRSkipExisting: boolean;
  setBulkOCRSkipExisting: React.Dispatch<React.SetStateAction<boolean>>;
  isBulkOCRRunning: boolean;
  bulkOCRProgressPercent: number;
  handleStartBulkOCR: () => void;
  handleCancelBulkOCR: () => void;
  // Scheduled Jobs
  scheduleStatus: JobScheduleStatus | null;
  scheduleLoading: boolean;
  scheduleSaving: string | null;
  manualTriggerLoading: string | null;
  handleScheduleUpdate: (
    jobName: JobName,
    enabled: boolean,
    schedule: ScheduleType,
    cron?: string
  ) => void;
  handleManualTrigger: (jobName: JobName) => void;
  formatMaintenanceDate: (date: string | null) => string;
  // Config Import
  configImporting?: boolean;
  configImportResult?: {
    success: boolean;
    message: string;
    imported_keys?: string[];
  } | null;
  handleImportConfig?: () => void;
}

const BOOTSTRAP_BUTTONS = [
  { key: "correspondents", labelKey: "analyzeCorrespondents", Icon: User },
  { key: "document_types", labelKey: "analyzeTypes", Icon: FileText },
  { key: "tags", labelKey: "analyzeTags", Icon: Tag },
  { key: "all", labelKey: "fullAnalysis", Icon: Zap },
] as const;

interface ScheduledJobSectionProps {
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
  tMaint: (key: string) => string;
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

export function MaintenanceTab({
  tMaint,
  tCommon,
  maintenanceError,
  setMaintenanceError,
  bootstrapProgress,
  bootstrapStarting,
  bootstrapLoading,
  bootstrapDetailsOpen,
  setBootstrapDetailsOpen,
  isBootstrapRunning,
  bootstrapProgressPercent,
  handleStartBootstrap,
  handleCancelBootstrap,
  handleSkipDocument,
  bulkOCRProgress,
  bulkOCRStarting,
  bulkOCRDocsPerSecond,
  setBulkOCRDocsPerSecond,
  bulkOCRSkipExisting,
  setBulkOCRSkipExisting,
  isBulkOCRRunning,
  bulkOCRProgressPercent,
  handleStartBulkOCR,
  handleCancelBulkOCR,
  scheduleStatus,
  scheduleLoading,
  scheduleSaving,
  manualTriggerLoading,
  handleScheduleUpdate,
  handleManualTrigger,
  formatMaintenanceDate,
  configImporting,
  configImportResult,
  handleImportConfig,
}: MaintenanceTabProps) {
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
            {BOOTSTRAP_BUTTONS.map((btn) => (
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

      {/* Config Import Card */}
      {handleImportConfig && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Import Configuration
            </CardTitle>
            <CardDescription>
              Import settings from config.yaml file. This will overwrite any existing settings in the database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <Button
                onClick={handleImportConfig}
                disabled={configImporting}
                variant="outline"
              >
                {configImporting ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Import from config.yaml
              </Button>
            </div>

            {/* Import Result */}
            {configImportResult && (
              <div className={`p-4 rounded-lg ${
                configImportResult.success
                  ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800"
                  : "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800"
              }`}>
                <div className="flex items-start gap-2">
                  {configImportResult.success ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className={`font-medium ${
                      configImportResult.success
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-red-700 dark:text-red-300"
                    }`}>
                      {configImportResult.success ? "Import Successful" : "Import Failed"}
                    </p>
                    <p className={`text-sm mt-1 ${
                      configImportResult.success
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}>
                      {configImportResult.message}
                    </p>
                    {configImportResult.success && configImportResult.imported_keys && configImportResult.imported_keys.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-zinc-500 mb-1">Imported {configImportResult.imported_keys.length} settings:</p>
                        <div className="flex flex-wrap gap-1">
                          {configImportResult.imported_keys.slice(0, 10).map((key) => (
                            <span key={key} className="text-xs px-2 py-0.5 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300">
                              {key}
                            </span>
                          ))}
                          {configImportResult.imported_keys.length > 10 && (
                            <span className="text-xs text-zinc-500">
                              +{configImportResult.imported_keys.length - 10} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <p className="text-sm text-zinc-500">
              The config.yaml file is searched in the following locations:
            </p>
            <ul className="text-xs text-zinc-400 list-disc list-inside space-y-1">
              <li>./config.yaml (current directory)</li>
              <li>../backend/config.yaml (Python backend)</li>
              <li>../../config.yaml (project root)</li>
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
