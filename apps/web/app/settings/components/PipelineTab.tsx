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
} from "@repo/ui";
import { useTinyBase, useBooleanSetting } from "@/lib/tinybase";
import type { SettingKey } from "@/lib/tinybase";

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
    key: "pipeline.tags",
    labelKey: "pipeline.tags",
    descKey: "pipeline.tagsDesc",
  },
  {
    key: "pipeline.custom_fields",
    labelKey: "pipeline.customFields",
    descKey: "pipeline.customFieldsDesc",
  },
];

function PipelineSwitch({ item }: { item: PipelineItem }) {
  const t = useTranslations("settings");
  const { updateSetting } = useTinyBase();
  const checked = useBooleanSetting(item.key);

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
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
