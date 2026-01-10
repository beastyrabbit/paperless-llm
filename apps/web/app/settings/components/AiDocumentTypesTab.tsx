"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  RefreshCw,
  Loader2,
  AlertCircle,
  Check,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
} from "@repo/ui";

interface DocumentTypeInfo {
  id: number;
  name: string;
  document_count: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function AiDocumentTypesTab() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");

  // UI state
  const [allDocumentTypes, setAllDocumentTypes] = useState<DocumentTypeInfo[]>([]);
  const [selectedAiDocTypes, setSelectedAiDocTypes] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_hasChanges, setHasChanges] = useState(false);

  const fetchAiDocTypes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/settings/ai-document-types`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setAllDocumentTypes(data.document_types || []);
      setSelectedAiDocTypes(data.selected_type_ids || []);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch document types");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAiDocTypes();
  }, [fetchAiDocTypes]);

  const toggleAiDocType = (typeId: number) => {
    setSelectedAiDocTypes((prev) => {
      if (prev.includes(typeId)) {
        return prev.filter((id) => id !== typeId);
      } else {
        return [...prev, typeId];
      }
    });
    setHasChanges(true);
  };

  const selectAll = () => {
    setSelectedAiDocTypes(allDocumentTypes.map((dt) => dt.id));
    setHasChanges(true);
  };

  const clearSelection = () => {
    setSelectedAiDocTypes([]);
    setHasChanges(true);
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
                {t("aiDocumentTypes.title")}
              </CardTitle>
              <CardDescription className="mt-1">
                {t("aiDocumentTypes.description")}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchAiDocTypes}
              disabled={loading}
            >
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
      {loading && allDocumentTypes.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
              <p className="text-sm text-zinc-500">{t("aiDocumentTypes.loadingDocTypes")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* No Document Types */}
      {!loading && allDocumentTypes.length === 0 && (
        <Card>
          <CardContent className="py-12">
            <div className="flex flex-col items-center justify-center gap-3 text-zinc-500">
              <FileText className="h-12 w-12 text-zinc-300" />
              <p className="text-lg font-medium">{t("aiDocumentTypes.noTypesFound")}</p>
              <p className="text-sm">{t("aiDocumentTypes.noTypesDesc")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Document Types List */}
      {allDocumentTypes.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{t("aiDocumentTypes.availableTypes")}</CardTitle>
                <CardDescription>
                  {t("aiDocumentTypes.typesEnabled", {
                    selected: selectedAiDocTypes.length,
                    total: allDocumentTypes.length,
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
              {allDocumentTypes.map((docType) => (
                <div
                  key={docType.id}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-900/50 -mx-4 px-4"
                  onClick={() => toggleAiDocType(docType.id)}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`h-5 w-5 rounded border-2 flex items-center justify-center transition-colors ${
                        selectedAiDocTypes.includes(docType.id)
                          ? "bg-emerald-600 border-emerald-600"
                          : "border-zinc-300 dark:border-zinc-600"
                      }`}
                    >
                      {selectedAiDocTypes.includes(docType.id) && (
                        <Check className="h-3 w-3 text-white" />
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                        <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium">{docType.name}</p>
                        <p className="text-sm text-zinc-500">
                          {t("aiDocumentTypes.documentCount", { count: docType.document_count })}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant={selectedAiDocTypes.includes(docType.id) ? "default" : "secondary"}
                    className={selectedAiDocTypes.includes(docType.id) ? "bg-emerald-600" : ""}
                  >
                    {selectedAiDocTypes.includes(docType.id)
                      ? t("aiDocumentTypes.aiEnabled")
                      : t("aiDocumentTypes.aiDisabled")}
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
