"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  FileText,
  Search,
  Filter,
  Play,
  Eye,
  Clock,
  ChevronRight,
  RefreshCw,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  ScrollArea,
} from "@repo/ui";
import Link from "next/link";

interface Document {
  id: number;
  title: string;
  correspondent: string | null;
  created: string;
  tags: string[];
  processing_status: string | null;
}

const statusConfig: Record<string, { labelKey: string; color: string; variant: "warning" | "info" | "secondary" | "success" | "destructive" }> = {
  pending: { labelKey: "statusPending", color: "bg-amber-500", variant: "warning" },
  ocr_done: { labelKey: "statusOcrDone", color: "bg-blue-500", variant: "info" },
  correspondent_done: { labelKey: "statusCorrDone", color: "bg-pink-500", variant: "secondary" },
  document_type_done: { labelKey: "statusDocTypeDone", color: "bg-indigo-500", variant: "secondary" },
  title_done: { labelKey: "statusTitleDone", color: "bg-purple-500", variant: "secondary" },
  tags_done: { labelKey: "statusTagsDone", color: "bg-orange-500", variant: "secondary" },
  processed: { labelKey: "statusProcessed", color: "bg-emerald-500", variant: "success" },
};

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("in_progress");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async (filter?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();

      // Get tag mappings from settings
      const settingsResponse = await fetch("/api/settings");
      let tagMap: Record<string, string> = {};

      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        if (settings.tags) {
          tagMap = {
            pending: settings.tags.pending,
            ocr_done: settings.tags.ocr_done,
            correspondent_done: settings.tags.correspondent_done,
            document_type_done: settings.tags.document_type_done,
            title_done: settings.tags.title_done,
            tags_done: settings.tags.tags_done,
            processed: settings.tags.processed,
          };
        }
      }

      // Handle "in_progress" filter - all statuses except processed
      if (filter === "in_progress") {
        // Don't set any tag param - backend will fetch all pipeline documents except processed
        // The backend's getPendingDocuments excludes processed by default when no tag specified
      } else if (filter && filter !== "all" && tagMap[filter]) {
        params.set("tag", tagMap[filter]);
      }

      const response = await fetch(`/api/documents/pending?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
      } else {
        setError(t("failedToFetch"));
      }
    } catch (err) {
      setError(t("unableToConnect"));
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchDocuments(statusFilter);
  }, [fetchDocuments, statusFilter]);

  const filteredDocs = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(search.toLowerCase()) ||
      doc.correspondent?.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  const handleRefresh = () => {
    fetchDocuments(statusFilter);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-zinc-500">
              {t("subtitle")}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {tCommon("refresh")}
            </Button>
            <Badge variant="secondary">{tCommon("documents", { count: documents.length })}</Badge>
          </div>
        </div>
      </header>

      <div className="p-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-48">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder={t("filterByStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_progress">{t("statusInProgress")}</SelectItem>
              <SelectItem value="all">{t("allStatus")}</SelectItem>
              <SelectItem value="pending">{t("statusPending")}</SelectItem>
              <SelectItem value="ocr_done">{t("statusOcrDone")}</SelectItem>
              <SelectItem value="correspondent_done">{t("statusCorrDone")}</SelectItem>
              <SelectItem value="document_type_done">{t("statusDocTypeDone")}</SelectItem>
              <SelectItem value="title_done">{t("statusTitleDone")}</SelectItem>
              <SelectItem value="tags_done">{t("statusTagsDone")}</SelectItem>
              <SelectItem value="processed">{t("statusProcessed")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Document List */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("documentQueue")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <Loader2 className="h-8 w-8 animate-spin mb-4 text-zinc-400" />
                <p className="text-sm">{t("loadingDocuments")}</p>
              </div>
            ) : (
              <ScrollArea className="h-[600px]">
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center gap-4 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
                    >
                      {/* Icon */}
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 dark:bg-zinc-800">
                        <FileText className="h-5 w-5 text-zinc-500" />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{doc.title}</h3>
                          {doc.processing_status && statusConfig[doc.processing_status] && (
                            <Badge variant={statusConfig[doc.processing_status].variant}>
                              {t(statusConfig[doc.processing_status].labelKey)}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-zinc-500">
                          {doc.correspondent && (
                            <span className="truncate">{doc.correspondent}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(doc.created).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex gap-1 mt-2">
                          {doc.tags
                            .filter((t) => !t.startsWith("llm-"))
                            .slice(0, 5)
                            .map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          {doc.tags.filter((t) => !t.startsWith("llm-")).length > 5 && (
                            <Badge variant="outline" className="text-xs">
                              +{doc.tags.filter((t) => !t.startsWith("llm-")).length - 5}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-2">
                        {doc.processing_status !== "processed" && (
                          <Button size="sm" variant="outline">
                            <Play className="mr-1 h-3 w-3" />
                            {tCommon("process")}
                          </Button>
                        )}
                        <Link href={`/documents/${doc.id}`}>
                          <Button size="sm" variant="ghost">
                            <Eye className="mr-1 h-3 w-3" />
                            {tCommon("view")}
                          </Button>
                        </Link>
                        <ChevronRight className="h-4 w-4 text-zinc-400" />
                      </div>
                    </div>
                  ))}

                  {filteredDocs.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <FileText className="h-12 w-12 mb-4 text-zinc-300" />
                      <p className="text-lg font-medium">{t("noDocuments")}</p>
                      <p className="text-sm">{t("tryAdjusting")}</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
