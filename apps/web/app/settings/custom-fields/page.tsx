"use client";

import { useEffect, useState } from "react";
import {
  RefreshCw,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Calendar,
  Hash,
  Type,
  ToggleLeft,
  Link as LinkIcon,
  List,
  ArrowLeft,
  Save,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Checkbox,
  Label,
  Alert,
  AlertDescription,
  AlertTitle,
} from "@repo/ui";
import Link from "next/link";

interface CustomField {
  id: number;
  name: string;
  data_type: string;
  extra_data: Record<string, unknown> | null;
}

interface CustomFieldsResponse {
  fields: CustomField[];
  selected_fields: number[];
}

const DATA_TYPE_ICONS: Record<string, React.ReactNode> = {
  string: <Type className="h-4 w-4" />,
  url: <LinkIcon className="h-4 w-4" />,
  date: <Calendar className="h-4 w-4" />,
  boolean: <ToggleLeft className="h-4 w-4" />,
  integer: <Hash className="h-4 w-4" />,
  float: <Hash className="h-4 w-4" />,
  monetary: <Hash className="h-4 w-4" />,
  documentlink: <FileText className="h-4 w-4" />,
  select: <List className="h-4 w-4" />,
};

const DATA_TYPE_LABELS: Record<string, string> = {
  string: "Text",
  url: "URL",
  date: "Date",
  boolean: "Boolean",
  integer: "Integer",
  float: "Decimal",
  monetary: "Money",
  documentlink: "Document Link",
  select: "Select",
};

export default function CustomFieldsPage() {
  const [fields, setFields] = useState<CustomField[]>([]);
  const [selectedFields, setSelectedFields] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchCustomFields = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/custom-fields");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data: CustomFieldsResponse = await response.json();
      setFields(data.fields);
      setSelectedFields(data.selected_fields);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch custom fields");
    } finally {
      setLoading(false);
    }
  };

  const saveSelection = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch("/api/settings/custom-fields", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_field_ids: selectedFields }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      setSuccessMessage(`Saved ${selectedFields.length} custom field(s) for LLM processing`);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save selection");
    } finally {
      setSaving(false);
    }
  };

  const toggleField = (fieldId: number) => {
    setSelectedFields((prev) => {
      if (prev.includes(fieldId)) {
        return prev.filter((id) => id !== fieldId);
      } else {
        return [...prev, fieldId];
      }
    });
    setHasChanges(true);
    setSuccessMessage(null);
  };

  const selectAll = () => {
    setSelectedFields(fields.map((f) => f.id));
    setHasChanges(true);
    setSuccessMessage(null);
  };

  const selectNone = () => {
    setSelectedFields([]);
    setHasChanges(true);
    setSuccessMessage(null);
  };

  useEffect(() => {
    fetchCustomFields();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Link href="/settings">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Settings
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Custom Fields</h1>
              <p className="text-sm text-zinc-500">
                Select which custom fields the LLM should try to fill
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchCustomFields}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={saveSelection}
              disabled={saving || !hasChanges}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save Selection
            </Button>
          </div>
        </div>
      </header>

      <div className="p-8 max-w-4xl mx-auto space-y-6">
        {/* Success Message */}
        {successMessage && (
          <Alert className="border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}

        {/* Error Message */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Loading State */}
        {loading && fields.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
                <p className="text-sm text-zinc-500">Loading custom fields from Paperless...</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* No Fields */}
        {!loading && fields.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
                <FileText className="h-12 w-12 text-zinc-300" />
                <p className="text-lg font-medium">No Custom Fields Found</p>
                <p className="text-sm">
                  Custom fields need to be created in Paperless-ngx first.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Fields List */}
        {fields.length > 0 && (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Available Custom Fields
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Select the fields you want the LLM to attempt to fill during document processing.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={selectAll}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={selectNone}>
                    Clear
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {fields.map((field) => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-4">
                      <Checkbox
                        id={`field-${field.id}`}
                        checked={selectedFields.includes(field.id)}
                        onCheckedChange={() => toggleField(field.id)}
                      />
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                          {DATA_TYPE_ICONS[field.data_type] || <FileText className="h-4 w-4" />}
                        </div>
                        <div>
                          <Label
                            htmlFor={`field-${field.id}`}
                            className="font-medium cursor-pointer"
                          >
                            {field.name}
                          </Label>
                          <p className="text-sm text-zinc-500">
                            Type: {DATA_TYPE_LABELS[field.data_type] || field.data_type}
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
                      variant={selectedFields.includes(field.id) ? "default" : "secondary"}
                      className={selectedFields.includes(field.id) ? "bg-emerald-600" : ""}
                    >
                      {selectedFields.includes(field.id) ? "Enabled" : "Disabled"}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Help Section */}
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50">
          <CardContent className="pt-6">
            <h3 className="font-medium mb-2">How Custom Fields Work</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
              When enabled, the LLM will analyze each document and attempt to extract values for the selected
              custom fields. The accuracy depends on the document content and field type.
            </p>
            <div className="grid gap-3 text-sm">
              <div className="flex items-center gap-2 text-zinc-500">
                <Type className="h-4 w-4" />
                <span><strong>Text fields:</strong> Best for names, IDs, reference numbers</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <Calendar className="h-4 w-4" />
                <span><strong>Date fields:</strong> Good for invoice dates, due dates, etc.</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <Hash className="h-4 w-4" />
                <span><strong>Number fields:</strong> Suitable for amounts, quantities</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-500">
                <List className="h-4 w-4" />
                <span><strong>Select fields:</strong> LLM will choose from available options</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
