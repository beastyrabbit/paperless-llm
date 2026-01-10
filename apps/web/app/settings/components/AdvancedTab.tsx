"use client";

import { useTranslations } from "next-intl";
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
} from "@repo/ui";
import { useTinyBase, useBooleanSetting, useStringSetting } from "@/lib/tinybase";
import type { SettingKey } from "@/lib/tinybase";

interface DebugSwitchItem {
  key: SettingKey;
  labelKey: string;
  descKey: string;
}

const DEBUG_SWITCHES: DebugSwitchItem[] = [
  {
    key: "debug.log_prompts",
    labelKey: "debug.logPrompts",
    descKey: "debug.logPromptsDesc",
  },
  {
    key: "debug.log_responses",
    labelKey: "debug.logResponses",
    descKey: "debug.logResponsesDesc",
  },
  {
    key: "debug.save_processing_history",
    labelKey: "debug.saveHistory",
    descKey: "debug.saveHistoryDesc",
  },
];

function DebugSwitch({ item }: { item: DebugSwitchItem }) {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();
  const checked = useBooleanSetting(item.key);

  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label>{t(item.labelKey)}</Label>
        <p className="text-xs text-zinc-500">{t(item.descKey)}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={(v) => updateSetting(item.key, v)}
      />
    </div>
  );
}

export function AdvancedTab() {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();
  const logLevel = useStringSetting("debug.log_level");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("debug.title")}</CardTitle>
        <CardDescription>{t("debug.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>{t("debug.logLevel")}</Label>
          <Select
            value={logLevel}
            onValueChange={(v) => updateSetting("debug.log_level", v)}
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
          {DEBUG_SWITCHES.map((item) => (
            <DebugSwitch key={item.key} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
