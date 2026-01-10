"use client";

import React from "react";
import {
  FileText,
  Clock,
  CheckCircle2,
  Database,
  Tag,
  ArrowRight,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";
import type { CustomField } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

const DATA_TYPE_ICONS: Record<string, React.ReactNode> = {
  string: <FileText className="h-4 w-4" />,
  url: <ArrowRight className="h-4 w-4" />,
  date: <Clock className="h-4 w-4" />,
  boolean: <CheckCircle2 className="h-4 w-4" />,
  integer: <Database className="h-4 w-4" />,
  float: <Database className="h-4 w-4" />,
  monetary: <Database className="h-4 w-4" />,
  documentlink: <FileText className="h-4 w-4" />,
  select: <Tag className="h-4 w-4" />,
};

interface CustomFieldsTabProps {
  t: TranslationFunction;
  customFields: CustomField[];
  selectedCustomFields: number[];
  customFieldsLoading: boolean;
  customFieldsError: string | null;
  customFieldsHasChanges: boolean;
  toggleCustomField: (fieldId: number) => void;
  selectAllCustomFields: () => void;
  deselectAllCustomFields: () => void;
}

export function CustomFieldsTab({
  t,
  customFields,
  selectedCustomFields,
  customFieldsLoading,
  customFieldsError,
  toggleCustomField,
  selectAllCustomFields,
  deselectAllCustomFields,
}: CustomFieldsTabProps) {
  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("customFields.title")}
          </CardTitle>
          <CardDescription>
            {t("customFields.description")}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Error Message */}
      {customFieldsError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{customFieldsError}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {customFieldsLoading && customFields.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-500">{t("customFields.loadingFields")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Fields */}
      {!customFieldsLoading && customFields.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
              <FileText className="h-12 w-12 text-zinc-300" />
              <p className="text-lg font-medium">{t("customFields.noFieldsFound")}</p>
              <p className="text-sm">{t("customFields.noFieldsDesc")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Fields List */}
      {customFields.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("customFields.availableFields")}</CardTitle>
                <CardDescription>
                  {t("customFields.fieldsSelected", {
                    selected: selectedCustomFields.length,
                    total: customFields.length,
                  })}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllCustomFields}
                  disabled={selectedCustomFields.length === customFields.length}
                >
                  {t("customFields.enableAll")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAllCustomFields}
                  disabled={selectedCustomFields.length === 0}
                >
                  {t("customFields.disableAll")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {customFields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4"
                  onClick={() => toggleCustomField(field.id)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                        selectedCustomFields.includes(field.id)
                          ? "bg-emerald-600 border-emerald-600"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {selectedCustomFields.includes(field.id) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                        {DATA_TYPE_ICONS[field.data_type] || <FileText className="h-4 w-4" />}
                      </div>
                      <div>
                        <p className="font-medium">{field.name}</p>
                        <p className="text-sm text-zinc-500 capitalize">
                          {field.data_type}
                          {Array.isArray(field.extra_data?.select_options) && (
                            <span className="ml-2">
                              ({(field.extra_data.select_options as unknown[]).length} options)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant={selectedCustomFields.includes(field.id) ? "default" : "secondary"}
                    className={selectedCustomFields.includes(field.id) ? "bg-emerald-600" : ""}
                  >
                    {selectedCustomFields.includes(field.id) ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
