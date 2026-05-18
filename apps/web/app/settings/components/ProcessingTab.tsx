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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@repo/ui";
import { AlertTriangle, Clock, Loader2, PlayCircle, Unlock } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { processingApi } from "@/lib/api";
import { useGlobalStatus } from "@/lib/global-status";
import { useBooleanSetting, useNumberSetting, useTinyBase } from "@/lib/tinybase";

export function ProcessingTab() {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();

  // Auto-processing settings
  const autoProcessingEnabled = useBooleanSetting("auto_processing.enabled");
  const autoProcessingInterval = useNumberSetting("auto_processing.interval_minutes");
  const includeUntagged = useBooleanSetting("auto_processing.include_untagged");
  const pauseOnActivity = useBooleanSetting("auto_processing.pause_on_user_activity");

  const { autoStatus, refresh: refreshGlobalStatus } = useGlobalStatus();
  const [isTriggering, setIsTriggering] = useState(false);
  const [lockDocId, setLockDocId] = useState("");
  const [lockRunId, setLockRunId] = useState("");
  const [isReleasingLock, setIsReleasingLock] = useState(false);
  const [lockReleaseMessage, setLockReleaseMessage] = useState<string | null>(null);
  const [lockReleaseError, setLockReleaseError] = useState<string | null>(null);

  const handleCheckNow = async () => {
    setIsTriggering(true);
    try {
      await processingApi.triggerAuto();
      // Refresh status after trigger
      await refreshGlobalStatus();
    } finally {
      setIsTriggering(false);
    }
  };

  const handleReleaseLock = async () => {
    const docId = Number.parseInt(lockDocId, 10);
    if (!Number.isInteger(docId) || docId <= 0) return;

    if (!window.confirm(t("lockRecovery.confirm"))) return;

    setIsReleasingLock(true);
    setLockReleaseMessage(null);
    setLockReleaseError(null);
    try {
      const response = await processingApi.releaseLock(docId, {
        force: lockRunId.trim().length === 0,
        ...(lockRunId.trim().length > 0 ? { runId: lockRunId.trim() } : {}),
      });
      if (!response.ok) {
        setLockReleaseError(response.error);
      } else if (response.data.success) {
        setLockReleaseMessage(response.data.message);
      } else {
        setLockReleaseError(response.data.message);
      }
      await refreshGlobalStatus();
    } catch (error) {
      setLockReleaseError(error instanceof Error ? error.message : t("lockRecovery.releaseFailed"));
    } finally {
      setIsReleasingLock(false);
    }
  };

  const formatLastCheck = (lastCheckAt: string | null) => {
    if (!lastCheckAt) return t("autoProcessing.neverChecked");
    const date = new Date(lastCheckAt);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);

    if (diffSec < 60) return t("autoProcessing.justNow");
    if (diffMin < 60) return t("autoProcessing.minutesAgo", { count: diffMin });
    return date.toLocaleTimeString();
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Auto-Processing */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            {t("autoProcessing.title")}
          </CardTitle>
          <CardDescription>{t("autoProcessing.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>{t("autoProcessing.enable")}</Label>
              <p className="text-xs text-zinc-500">{t("autoProcessing.enableDesc")}</p>
            </div>
            <Switch
              checked={autoProcessingEnabled}
              onCheckedChange={(v) => updateSetting("auto_processing.enabled", v)}
            />
          </div>

          {autoProcessingEnabled && (
            <>
              <Separator />
              <div className="space-y-2">
                <Label>{t("autoProcessing.checkInterval")}</Label>
                <Select
                  value={autoProcessingInterval.toString()}
                  onValueChange={(v) =>
                    updateSetting("auto_processing.interval_minutes", parseInt(v))
                  }
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
                  <p className="text-xs text-zinc-500">{t("autoProcessing.pauseOnActivityDesc")}</p>
                </div>
                <Switch
                  checked={pauseOnActivity}
                  onCheckedChange={(v) =>
                    updateSetting("auto_processing.pause_on_user_activity", v)
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t("autoProcessing.includeUntagged")}</Label>
                  <p className="text-xs text-zinc-500">{t("autoProcessing.includeUntaggedDesc")}</p>
                </div>
                <Switch
                  checked={includeUntagged}
                  onCheckedChange={(v) => updateSetting("auto_processing.include_untagged", v)}
                />
              </div>

              <Separator />

              {/* Status and Check Now */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>{t("autoProcessing.status")}</Label>
                    {autoStatus && (
                      <div className="text-xs text-zinc-500 space-y-1">
                        <p>
                          {t("autoProcessing.lastCheck")}:{" "}
                          {formatLastCheck(autoStatus.last_check_at)}
                        </p>
                        {autoStatus.currently_processing_doc_id && (
                          <p className="text-blue-600 dark:text-blue-400">
                            {t("autoProcessing.processing")} #
                            {autoStatus.currently_processing_doc_id}
                          </p>
                        )}
                        <p>
                          {t("autoProcessing.processed")}: {autoStatus.processed_since_start}
                          {autoStatus.errors_since_start > 0 && (
                            <span className="text-red-500 ml-2">
                              ({autoStatus.errors_since_start} {t("autoProcessing.errors")})
                            </span>
                          )}
                        </p>
                        <p>
                          {t("autoProcessing.queue")}: {autoStatus.queue_length}
                        </p>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCheckNow}
                    disabled={isTriggering || !autoStatus?.running}
                    title={!autoStatus?.running ? t("autoProcessing.serviceNotRunning") : undefined}
                  >
                    {isTriggering ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <PlayCircle className="h-4 w-4 mr-2" />
                    )}
                    {t("autoProcessing.checkNow")}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Unlock className="h-5 w-5" />
            {t("lockRecovery.title")}
          </CardTitle>
          <CardDescription>{t("lockRecovery.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("lockRecovery.warning")}</span>
            </div>
          </div>

          {autoStatus?.currently_processing_doc_id && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLockDocId(String(autoStatus.currently_processing_doc_id))}
            >
              {t("lockRecovery.useCurrent", { docId: autoStatus.currently_processing_doc_id })}
            </Button>
          )}

          <div className="space-y-2">
            <Label htmlFor="lock-doc-id">{t("lockRecovery.docIdLabel")}</Label>
            <Input
              id="lock-doc-id"
              type="number"
              min={1}
              value={lockDocId}
              onChange={(event) => setLockDocId(event.target.value)}
              placeholder={t("lockRecovery.docIdPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lock-run-id">{t("lockRecovery.runIdLabel")}</Label>
            <Input
              id="lock-run-id"
              value={lockRunId}
              onChange={(event) => setLockRunId(event.target.value)}
              placeholder={t("lockRecovery.runIdPlaceholder")}
            />
            <p className="text-xs text-zinc-500">{t("lockRecovery.runIdHelp")}</p>
          </div>

          {lockReleaseMessage && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{lockReleaseMessage}</p>
          )}
          {lockReleaseError && (
            <p className="text-sm text-red-600 dark:text-red-400" role="alert">
              {lockReleaseError}
            </p>
          )}

          <Button
            variant="destructive"
            onClick={handleReleaseLock}
            disabled={
              isReleasingLock ||
              !Number.isInteger(Number.parseInt(lockDocId, 10)) ||
              Number.parseInt(lockDocId, 10) <= 0
            }
          >
            {isReleasingLock ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Unlock className="h-4 w-4 mr-2" />
            )}
            {t("lockRecovery.release")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
