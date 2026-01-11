"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  FileText,
  Search,
  Filter,
  Clock,
  RefreshCw,
  AlertCircle,
  Loader2,
  ScrollText,
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

const statusConfig: Record<string, { labelKey: string; variant: "warning" | "info" | "secondary" | "success" | "destructive" }> = {
  pending: { labelKey: "statusPending", variant: "warning" },
  ocr_done: { labelKey: "statusOcrDone", variant: "info" },
  summary_done: { labelKey: "statusSummaryDone", variant: "info" },
  schema_review: { labelKey: "statusSchemaReview", variant: "warning" },
  correspondent_done: { labelKey: "statusCorrDone", variant: "secondary" },
  document_type_done: { labelKey: "statusDocTypeDone", variant: "secondary" },
  title_done: { labelKey: "statusTitleDone", variant: "secondary" },
  tags_done: { labelKey: "statusTagsDone", variant: "secondary" },
  processed: { labelKey: "statusProcessed", variant: "success" },
  failed: { labelKey: "statusFailed", variant: "destructive" },
  manual_review: { labelKey: "statusManualReview", variant: "warning" },
};

export default function DocumentsPage() {
  const t = useTranslations("documents");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [documents, setDocuments] = useState<Document[]>([]);
  const [allDocuments, setAllDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagMap, setTagMap] = useState<Record<string, string>>({});

  // Fetch settings once to get tag mapping
  useEffect(() => {
    async function fetchSettings() {
      try {
        const response = await fetch("/api/settings");
        if (response.ok) {
          const settings = await response.json();
          setTagMap({
            pending: settings.tags.pending,
            ocr_done: settings.tags.ocr_done,
            summary_done: settings.tags.summary_done,
            schema_review: settings.tags.schema_review,
            correspondent_done: settings.tags.correspondent_done,
            document_type_done: settings.tags.document_type_done,
            title_done: settings.tags.title_done,
            tags_done: settings.tags.tags_done,
            processed: settings.tags.processed,
            failed: settings.tags.failed,
            manual_review: settings.tags.manual_review,
          });
        }
      } catch (err) {
        console.error("Failed to fetch settings:", err);
      }
    }
    fetchSettings();
  }, []);

  const fetchDocuments = useCallback(async (tag?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (tag && tag !== "all" && tagMap[tag]) {
        params.set("tag", tagMap[tag]);
      }

      const response = await fetch(`/api/documents/pending?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data);
        // Also fetch all documents for search (if we have a filter applied)
        if (tag && tag !== "all") {
          const allResponse = await fetch("/api/documents/pending");
          if (allResponse.ok) {
            setAllDocuments(await allResponse.json());
          }
        } else {
          setAllDocuments(data);
        }
      } else {
        setError(t("failedToFetch"));
      }
    } catch (err) {
      setError(t("unableToConnect"));
      console.error("Failed to fetch documents:", err);
    } finally {
      setLoading(false);
    }
  }, [t, tagMap]);

  useEffect(() => {
    if (Object.keys(tagMap).length > 0) {
      fetchDocuments(statusFilter);
    }
  }, [fetchDocuments, statusFilter, tagMap]);

  // When searching, ignore filters and search all documents
  const filteredDocs = useMemo(() => {
    const searchLower = search.toLowerCase().trim();

    if (searchLower) {
      // Search ignores filters - search ALL documents
      return allDocuments.filter((doc) =>
        doc.title.toLowerCase().includes(searchLower) ||
        doc.correspondent?.toLowerCase().includes(searchLower) ||
        String(doc.id).includes(searchLower)
      );
    }

    // No search - apply filters normally
    return documents;
  }, [documents, allDocuments, search]);

  const handleRefresh = () => {
    fetchDocuments(statusFilter);
  };

  const handleRowClick = (docId: number) => {
    router.push(`/documents/${docId}`);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-14 items-center justify-between px-6">
          <div>
            <h1 className="text-lg font-bold tracking-tight">{t("title")}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              {tCommon("refresh")}
            </Button>
            <Badge variant="secondary" className="text-xs">
              {filteredDocs.length} / {allDocuments.length}
            </Badge>
          </div>
        </div>
      </header>

      <div className="p-6">
        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {error}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              placeholder={search ? t("searchingAll") : t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9 text-sm">
              <Filter className="mr-2 h-3 w-3" />
              <SelectValue placeholder={t("filterByStatus")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allStatus")}</SelectItem>
              <SelectItem value="pending">{t("statusPending")}</SelectItem>
              <SelectItem value="ocr_done">{t("statusOcrDone")}</SelectItem>
              <SelectItem value="summary_done">{t("statusSummaryDone")}</SelectItem>
              <SelectItem value="schema_review">{t("statusSchemaReview")}</SelectItem>
              <SelectItem value="title_done">{t("statusTitleDone")}</SelectItem>
              <SelectItem value="correspondent_done">{t("statusCorrDone")}</SelectItem>
              <SelectItem value="document_type_done">{t("statusDocTypeDone")}</SelectItem>
              <SelectItem value="tags_done">{t("statusTagsDone")}</SelectItem>
              <SelectItem value="processed">{t("statusProcessed")}</SelectItem>
              <SelectItem value="failed">{t("statusFailed")}</SelectItem>
              <SelectItem value="manual_review">{t("statusManualReview")}</SelectItem>
            </SelectContent>
          </Select>
          {search && statusFilter !== "all" && (
            <Badge variant="outline" className="text-xs text-amber-600 dark:text-amber-400">
              {t("searchIgnoresFilter")}
            </Badge>
          )}
        </div>

        {/* Document Table */}
        <Card>
          <CardHeader className="py-3 px-4">
            <CardTitle className="text-sm font-medium">{t("documentQueue")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin mb-3 text-zinc-400" />
                <p className="text-sm">{t("loadingDocuments")}</p>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-280px)]">
                {/* Table Header */}
                <div className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 z-10">
                  <div className="grid grid-cols-[80px_1fr_140px_140px_60px] gap-2 px-4 py-2 text-xs font-medium text-zinc-500 uppercase tracking-wider">
                    <div>{t("columnId")}</div>
                    <div>{t("columnTitle")}</div>
                    <div>{t("columnDate")}</div>
                    <div>{t("columnStatus")}</div>
                    <div className="text-center">{t("columnLogs")}</div>
                  </div>
                </div>

                {/* Table Body */}
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filteredDocs.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => handleRowClick(doc.id)}
                      className="grid grid-cols-[80px_1fr_140px_140px_60px] gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 cursor-pointer transition-colors items-center text-sm"
                    >
                      {/* ID */}
                      <div className="font-mono text-xs text-zinc-400">
                        #{doc.id}
                      </div>

                      {/* Title + Correspondent */}
                      <div className="min-w-0">
                        <div className="font-medium truncate" title={doc.title}>
                          {doc.title}
                        </div>
                        {doc.correspondent && (
                          <div className="text-xs text-zinc-500 truncate">
                            {doc.correspondent}
                          </div>
                        )}
                      </div>

                      {/* Date */}
                      <div className="text-xs text-zinc-500 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(doc.created)}
                      </div>

                      {/* Status */}
                      <div>
                        {doc.processing_status && statusConfig[doc.processing_status] && (
                          <Badge
                            variant={statusConfig[doc.processing_status].variant}
                            className="text-xs"
                          >
                            {t(statusConfig[doc.processing_status].labelKey)}
                          </Badge>
                        )}
                      </div>

                      {/* Logs Button */}
                      <div className="text-center" onClick={(e) => e.stopPropagation()}>
                        <Link href={`/documents/${doc.id}/process`}>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                            <ScrollText className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  ))}

                  {filteredDocs.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
                      <FileText className="h-10 w-10 mb-3 text-zinc-300" />
                      <p className="font-medium">{t("noDocuments")}</p>
                      <p className="text-sm text-zinc-400">{t("tryAdjusting")}</p>
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
