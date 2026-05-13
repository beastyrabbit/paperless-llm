"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Switch } from "@repo/ui";
import { useTranslations } from "next-intl";
import type { SettingKey } from "@/lib/tinybase";
import { useBooleanSetting, useTinyBase } from "@/lib/tinybase";

interface PipelineItem {
  key: SettingKey;
  labelKey: string;
  descKey: string;
}

const PIPELINE_ITEMS: PipelineItem[] = [
  {
    key: "pipeline.ocr",
    labelKey: "pipeline.ocr",
    descKey: "pipeline.ocrDesc",
  },
  {
    key: "pipeline.summary",
    labelKey: "pipeline.summary",
    descKey: "pipeline.summaryDesc",
  },
  {
    key: "pipeline.title",
    labelKey: "pipeline.titleGeneration",
    descKey: "pipeline.titleDesc",
  },
  {
    key: "pipeline.correspondent",
    labelKey: "pipeline.correspondent",
    descKey: "pipeline.correspondentDesc",
  },
  {
    key: "pipeline.document_type",
    labelKey: "pipeline.documentType",
    descKey: "pipeline.documentTypeDesc",
  },
  {
    key: "pipeline.tags",
    labelKey: "pipeline.tags",
    descKey: "pipeline.tagsDesc",
  },
  {
    key: "pipeline.custom_fields",
    labelKey: "pipeline.customFields",
    descKey: "pipeline.customFieldsDesc",
  },
  {
    key: "pipeline.document_links",
    labelKey: "pipeline.documentLinks",
    descKey: "pipeline.documentLinksDesc",
  },
];

function PipelineSwitch({ item }: { item: PipelineItem }) {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();
  const checked = useBooleanSetting(item.key);

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="space-y-0.5">
        <Label htmlFor={item.key}>{t(item.labelKey)}</Label>
        <p className="text-xs text-zinc-500">{t(item.descKey)}</p>
      </div>
      <Switch id={item.key} checked={checked} onCheckedChange={(v) => updateSetting(item.key, v)} />
    </div>
  );
}

export function PipelineTab() {
  const t = useTranslations("settings");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("pipeline.title")}</CardTitle>
        <CardDescription>{t("pipeline.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {PIPELINE_ITEMS.map((item) => (
            <PipelineSwitch key={item.key} item={item} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
