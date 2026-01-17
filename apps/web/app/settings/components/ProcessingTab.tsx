"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Clock, Brain, PlayCircle, Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  Separator,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Button,
} from "@repo/ui";
import { useTinyBase, useBooleanSetting, useNumberSetting } from "@/lib/tinybase";
import { processingApi, AutoProcessingStatus } from "@/lib/api";

export function ProcessingTab() {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();

  // Auto-processing settings
  const autoProcessingEnabled = useBooleanSetting("auto_processing.enabled");
  const autoProcessingInterval = useNumberSetting("auto_processing.interval_minutes");
  const pauseOnActivity = useBooleanSetting("auto_processing.pause_on_user_activity");

  // Confirmation settings
  const maxRetries = useNumberSetting("confirmation.max_retries");
  const requireUser = useBooleanSetting("confirmation.require_user_for_new_entities");

  // Auto processing status
  const [autoStatus, setAutoStatus] = useState<AutoProcessingStatus | null>(null);
  const [isTriggering, setIsTriggering] = useState(false);

  const fetchAutoStatus = useCallback(async () => {
    const { data } = await processingApi.getAutoStatus();
    if (data) {
      setAutoStatus(data);
    }
  }, []);

  useEffect(() => {
    fetchAutoStatus();
    // Refresh every 10 seconds
    const interval = setInterval(fetchAutoStatus, 10000);
    return () => clearInterval(interval);
  }, [fetchAutoStatus]);

  const handleCheckNow = async () => {
    setIsTriggering(true);
    try {
      await processingApi.triggerAuto();
      // Refresh status after trigger
      await fetchAutoStatus();
    } finally {
      setIsTriggering(false);
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
              <p className="text-xs text-zinc-500">
                {t("autoProcessing.enableDesc")}
              </p>
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
                    <SelectItem value="1">
                      {t("autoProcessing.everyMinute")}
                    </SelectItem>
                    <SelectItem value="5">
                      {t("autoProcessing.every5Minutes")}
                    </SelectItem>
                    <SelectItem value="10">
                      {t("autoProcessing.every10Minutes")}
                    </SelectItem>
                    <SelectItem value="30">
                      {t("autoProcessing.every30Minutes")}
                    </SelectItem>
                    <SelectItem value="60">
                      {t("autoProcessing.everyHour")}
                    </SelectItem>
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
                  checked={pauseOnActivity}
                  onCheckedChange={(v) =>
                    updateSetting("auto_processing.pause_on_user_activity", v)
                  }
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
                          {t("autoProcessing.lastCheck")}: {formatLastCheck(autoStatus.last_check_at)}
                        </p>
                        {autoStatus.currently_processing_doc_id && (
                          <p className="text-blue-600 dark:text-blue-400">
                            {t("autoProcessing.processing")} #{autoStatus.currently_processing_doc_id}
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

      {/* Confirmation Loop */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {t("confirmation.title")}
          </CardTitle>
          <CardDescription>{t("confirmation.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("confirmation.maxRetries")}</Label>
            <p className="text-xs text-zinc-500">
              {t("confirmation.maxRetriesDesc")}
            </p>
            <Select
              value={maxRetries.toString()}
              onValueChange={(v) =>
                updateSetting("confirmation.max_retries", parseInt(v))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">
                  {t("confirmation.retries", { count: 1 })}
                </SelectItem>
                <SelectItem value="2">
                  {t("confirmation.retries", { count: 2 })}
                </SelectItem>
                <SelectItem value="3">
                  {t("confirmation.retries", { count: 3 })}
                </SelectItem>
                <SelectItem value="5">
                  {t("confirmation.retries", { count: 5 })}
                </SelectItem>
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
              checked={requireUser}
              onCheckedChange={(v) =>
                updateSetting("confirmation.require_user_for_new_entities", v)
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
