"use client";

import { Clock, Brain } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Label,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
} from "@repo/ui";
import type { Settings } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface ProcessingTabProps {
  t: TranslationFunction;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function ProcessingTab({ t, settings, updateSetting }: ProcessingTabProps) {
  return (
    <div className="space-y-6">
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
                checked={settings.auto_processing_enabled}
                onCheckedChange={(v) => updateSetting("auto_processing_enabled", v)}
              />
            </div>

            {settings.auto_processing_enabled && (
              <>
                <Separator />
                <div className="space-y-2">
                  <Label>{t("autoProcessing.checkInterval")}</Label>
                  <Select
                    value={settings.auto_processing_interval_minutes.toString()}
                    onValueChange={(v) =>
                      updateSetting("auto_processing_interval_minutes", parseInt(v))
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
                    <p className="text-xs text-zinc-500">
                      {t("autoProcessing.pauseOnActivityDesc")}
                    </p>
                  </div>
                  <Switch
                    checked={settings.auto_processing_pause_on_user_activity}
                    onCheckedChange={(v) =>
                      updateSetting("auto_processing_pause_on_user_activity", v)
                    }
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
              {t("confirmation.title")}
            </CardTitle>
            <CardDescription>{t("confirmation.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("confirmation.maxRetries")}</Label>
              <p className="text-xs text-zinc-500">{t("confirmation.maxRetriesDesc")}</p>
              <Select
                value={settings.confirmation_max_retries.toString()}
                onValueChange={(v) => updateSetting("confirmation_max_retries", parseInt(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{t("confirmation.retries", { count: 1 })}</SelectItem>
                  <SelectItem value="2">{t("confirmation.retries", { count: 2 })}</SelectItem>
                  <SelectItem value="3">{t("confirmation.retries", { count: 3 })}</SelectItem>
                  <SelectItem value="5">{t("confirmation.retries", { count: 5 })}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t("confirmation.requireUser")}</Label>
                <p className="text-xs text-zinc-500">{t("confirmation.requireUserDesc")}</p>
              </div>
              <Switch
                checked={settings.confirmation_require_user_for_new_entities}
                onCheckedChange={(v) =>
                  updateSetting("confirmation_require_user_for_new_entities", v)
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
