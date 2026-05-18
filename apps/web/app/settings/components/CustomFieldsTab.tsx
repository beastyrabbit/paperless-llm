"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui";
import {
  AlertCircle,
  Calendar,
  Check,
  DollarSign,
  FileText,
  Hash,
  Link,
  List,
  Loader2,
  RefreshCw,
  TextIcon,
  ToggleLeft,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { type CustomFieldSetting, settingsApi } from "@/lib/api";

// Icons for different data types
const DATA_TYPE_ICONS: Record<string, React.ReactNode> = {
  string: <TextIcon className="h-4 w-4" />,
  url: <Link className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  boolean: <ToggleLeft className="h-4 w-4" />,
  integer: <Hash className="h-4 w-4" />,
  float: <Hash className="h-4 w-4" />,
  monetary: <DollarSign className="h-4 w-4" />,
  documentlink: <FileText className="h-4 w-4" />,
  select: <List className="h-4 w-4" />,
};

interface CustomFieldsTabProps {
  onHasChanges?: (hasChanges: boolean) => void;
}

export function CustomFieldsTab({ onHasChanges }: CustomFieldsTabProps) {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  // UI-only state
  const [customFields, setCustomFields] = useState<CustomFieldSetting[]>([]);
  const [selectedCustomFields, setSelectedCustomFields] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchCustomFields = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await settingsApi.getCustomFields();
    if (result.ok) {
      setCustomFields(result.data.fields || []);
      setSelectedCustomFields(result.data.selected_fields || []);
    } else {
      setError(result.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

  useEffect(() => {
    onHasChanges?.(hasChanges);
  }, [hasChanges, onHasChanges]);

  const saveSelection = async (newSelection: number[]) => {
    setHasChanges(true);
    const result = await settingsApi.updateCustomFields(newSelection);
    if (result.ok) {
      setHasChanges(false);
    } else {
      setError(result.error);
    }
  };

  const toggleCustomField = (id: number) => {
    const newSelection = selectedCustomFields.includes(id)
      ? selectedCustomFields.filter((f) => f !== id)
      : [...selectedCustomFields, id];
    setSelectedCustomFields(newSelection);
    void saveSelection(newSelection);
  };

  const selectAll = () => {
    const allIds = customFields.map((f) => f.id);
    setSelectedCustomFields(allIds);
    void saveSelection(allIds);
  };

  const clearSelection = () => {
    setSelectedCustomFields([]);
    void saveSelection([]);
  };

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {t("customFields.title")}
              </CardTitle>
              <CardDescription className="mt-1">{t("customFields.description")}</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchCustomFields} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {tCommon("refresh")}
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Error Message */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>{tCommon("error")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {loading && customFields.length === 0 && (
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
      {!loading && customFields.length === 0 && (
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
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {tCommon("selectAll")}
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  {tCommon("clear")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {customFields.map((field) => (
                <label
                  key={field.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selectedCustomFields.includes(field.id)}
                    onChange={() => toggleCustomField(field.id)}
                  />
                  <div className="flex items-center gap-4">
                    <div
                      aria-hidden="true"
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
                              (
                              {t("customFields.options", {
                                count: (field.extra_data.select_options as unknown[]).length,
                              })}
                              )
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
                    {selectedCustomFields.includes(field.id)
                      ? tCommon("enabled")
                      : tCommon("disabled")}
                  </Badge>
                </label>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
