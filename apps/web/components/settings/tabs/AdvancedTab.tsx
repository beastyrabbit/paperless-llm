"use client";

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

const DEBUG_OPTIONS = [
  {
    key: "debug_log_prompts" as const,
    labelKey: "debug.logPrompts",
    descKey: "debug.logPromptsDesc",
  },
  {
    key: "debug_log_responses" as const,
    labelKey: "debug.logResponses",
    descKey: "debug.logResponsesDesc",
  },
  {
    key: "debug_save_processing_history" as const,
    labelKey: "debug.saveHistory",
    descKey: "debug.saveHistoryDesc",
  },
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface AdvancedTabProps {
  t: TranslationFunction;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export function AdvancedTab({ t, settings, updateSetting }: AdvancedTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("debug.title")}</CardTitle>
          <CardDescription>{t("debug.description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("debug.logLevel")}</Label>
            <Select
              value={settings.debug_log_level}
              onValueChange={(v) =>
                updateSetting("debug_log_level", v as "DEBUG" | "INFO" | "WARNING" | "ERROR")
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DEBUG">{t("debug.logLevelDebug")}</SelectItem>
                <SelectItem value="INFO">{t("debug.logLevelInfo")}</SelectItem>
                <SelectItem value="WARNING">{t("debug.logLevelWarning")}</SelectItem>
                <SelectItem value="ERROR">{t("debug.logLevelError")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="space-y-4">
            {DEBUG_OPTIONS.map((item) => (
              <div key={item.key} className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>{t(item.labelKey)}</Label>
                  <p className="text-xs text-zinc-500">{t(item.descKey)}</p>
                </div>
                <Switch
                  checked={settings[item.key]}
                  onCheckedChange={(v) => updateSetting(item.key, v)}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
