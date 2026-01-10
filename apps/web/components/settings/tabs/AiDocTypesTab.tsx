"use client";

import React from "react";
import { FileText, Loader2, AlertCircle, Check } from "lucide-react";
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
import type { DocumentTypeInfo } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TranslationFunction = (key: string, values?: any) => string;

interface AiDocTypesTabProps {
  t: TranslationFunction;
  allDocumentTypes: DocumentTypeInfo[];
  selectedAiDocTypes: number[];
  aiDocTypesLoading: boolean;
  aiDocTypesError: string | null;
  aiDocTypesHasChanges: boolean;
  toggleAiDocType: (docTypeId: number) => void;
  selectAllAiDocTypes: () => void;
  deselectAllAiDocTypes: () => void;
}

export function AiDocTypesTab({
  t,
  allDocumentTypes,
  selectedAiDocTypes,
  aiDocTypesLoading,
  aiDocTypesError,
  toggleAiDocType,
  selectAllAiDocTypes,
  deselectAllAiDocTypes,
}: AiDocTypesTabProps) {
  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t("aiDocumentTypes.title")}
          </CardTitle>
          <CardDescription>
            {t("aiDocumentTypes.description")}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Error Message */}
      {aiDocTypesError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{aiDocTypesError}</AlertDescription>
        </Alert>
      )}

      {/* Loading State */}
      {aiDocTypesLoading && allDocumentTypes.length === 0 && (
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
      {!aiDocTypesLoading && allDocumentTypes.length === 0 && (
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
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllAiDocTypes}
                  disabled={selectedAiDocTypes.length === allDocumentTypes.length}
                >
                  {t("aiDocumentTypes.enableAll")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAllAiDocTypes}
                  disabled={selectedAiDocTypes.length === 0}
                >
                  {t("aiDocumentTypes.disableAll")}
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
                          {t("aiDocumentTypes.documentCount", {
                            count: docType.document_count,
                          })}
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
