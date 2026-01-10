"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, Label, Switch } from "@repo/ui";
import type { Settings } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface PipelineTabProps {
  t: TranslationFunction;
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

const PIPELINE_ITEMS = [
  { key: "pipeline_ocr" as const, labelKey: "pipeline.ocr", descKey: "pipeline.ocrDesc" },
  {
    key: "pipeline_title" as const,
    labelKey: "pipeline.titleGeneration",
    descKey: "pipeline.titleDesc",
  },
  {
    key: "pipeline_correspondent" as const,
    labelKey: "pipeline.correspondent",
    descKey: "pipeline.correspondentDesc",
  },
  { key: "pipeline_tags" as const, labelKey: "pipeline.tags", descKey: "pipeline.tagsDesc" },
  {
    key: "pipeline_custom_fields" as const,
    labelKey: "pipeline.customFields",
    descKey: "pipeline.customFieldsDesc",
  },
] as const;

export function PipelineTab({ t, settings, updateSetting }: PipelineTabProps) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("pipeline.title")}</CardTitle>
          <CardDescription>{t("pipeline.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {PIPELINE_ITEMS.map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between rounded-lg border p-4"
              >
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
