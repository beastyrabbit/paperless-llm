"use client";

import { APP_PAGE_BACKGROUND } from "@/lib/styles";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui";
import {
  AlertCircle,
  Clock,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type DocumentTagMap,
  documentDetailToSummary,
  filterDocuments,
  getNumericSearchId,
} from "@/components/documents/document-list-model";
import { type DocumentSummary, documentsApi } from "@/lib/api";
import { useStringSetting } from "@/lib/tinybase";

const statusConfig: Record<
  string,
  { labelKey: string; variant: "warning" | "info" | "secondary" | "success" | "destructive" }
> = {
  queued: { labelKey: "statusQueued", variant: "warning" },
  processing: { labelKey: "statusProcessing", variant: "info" },
  todo: { labelKey: "statusTodo", variant: "warning" },
  ocr: { labelKey: "statusOcr", variant: "info" },
  metadata: { labelKey: "statusMetadata", variant: "secondary" },
  review: { labelKey: "statusReview", variant: "warning" },
  index: { labelKey: "statusIndex", variant: "info" },
  done: { labelKey: "statusDone", variant: "success" },
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
  const { push } = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [directDocument, setDirectDocument] = useState<DocumentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<"unableToConnect" | "failedToFetch" | null>(null);
  const tagTodo = useStringSetting("tags.todo");
  const tagOcr = useStringSetting("tags.ocr");
  const tagMetadata = useStringSetting("tags.metadata");
  const tagReview = useStringSetting("tags.review");
  const tagIndex = useStringSetting("tags.index");
  const tagDone = useStringSetting("tags.done");
  const tagPending = useStringSetting("tags.pending");
  const tagOcrDone = useStringSetting("tags.ocr_done");
  const tagSummaryDone = useStringSetting("tags.summary_done");
  const tagSchemaReview = useStringSetting("tags.schema_review");
  const tagCorrespondentDone = useStringSetting("tags.correspondent_done");
  const tagDocumentTypeDone = useStringSetting("tags.document_type_done");
  const tagTitleDone = useStringSetting("tags.title_done");
  const tagTagsDone = useStringSetting("tags.tags_done");
  const tagProcessed = useStringSetting("tags.processed");
  const tagFailed = useStringSetting("tags.failed");
  const tagManualReview = useStringSetting("tags.manual_review");
  const tagMap: DocumentTagMap = useMemo(
    () => ({
      queued: tagTodo,
      processing: tagOcr,
      todo: tagTodo,
      ocr: tagOcr,
      metadata: tagMetadata,
      review: tagReview,
      index: tagIndex,
      done: tagDone,
      pending: tagPending,
      ocr_done: tagOcrDone,
      summary_done: tagSummaryDone,
      schema_review: tagSchemaReview,
      correspondent_done: tagCorrespondentDone,
      document_type_done: tagDocumentTypeDone,
      title_done: tagTitleDone,
      tags_done: tagTagsDone,
      processed: tagProcessed,
      failed: tagFailed,
      manual_review: tagManualReview,
    }),
    [
      tagCorrespondentDone,
      tagDocumentTypeDone,
      tagDone,
      tagFailed,
      tagIndex,
      tagManualReview,
      tagMetadata,
      tagOcr,
      tagOcrDone,
      tagPending,
      tagProcessed,
      tagReview,
      tagSchemaReview,
      tagSummaryDone,
      tagTagsDone,
      tagTitleDone,
      tagTodo,
    ],
  );

  const numericSearchId = useMemo(() => getNumericSearchId(search), [search]);

  const fetchDocuments = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setErrorKey(null);
      const result = await documentsApi.getPending("all", 50, { signal });
      if (signal?.aborted) return;

      if (result.ok) {
        setDocuments(result.data);
      } else {
        setErrorKey(result.status === 0 ? "unableToConnect" : "failedToFetch");
      }

      if (!signal?.aborted) {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchDocuments(controller.signal);
    return () => controller.abort();
  }, [fetchDocuments]);

  useEffect(() => {
    if (!numericSearchId) {
      setDirectDocument(null);
      return;
    }

    if (documents.some((doc) => doc.id === numericSearchId)) {
      setDirectDocument(null);
      return;
    }

    const controller = new AbortController();
    const documentId = numericSearchId;
    async function fetchDirectDocument() {
      const result = await documentsApi.get(documentId, { signal: controller.signal });
      if (controller.signal.aborted) return;

      if (result.ok) {
        setDirectDocument(documentDetailToSummary(result.data));
      } else {
        setDirectDocument(null);
      }
    }

    fetchDirectDocument();

    return () => controller.abort();
  }, [documents, numericSearchId]);

  // When searching, ignore filters and search all loaded documents.
  const filteredDocs = useMemo(
    () =>
      filterDocuments(documents, {
        statusFilter,
        search,
        tagMap,
        directDocument,
      }),
    [documents, directDocument, search, statusFilter, tagMap],
  );

  const handleRefresh = () => {
    fetchDocuments();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className={APP_PAGE_BACKGROUND}>
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
              {filteredDocs.length} / {documents.length}
            </Badge>
          </div>
        </div>
      </header>

      <div className="p-6">
        {/* Error Message */}
        {errorKey && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {t(errorKey)}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
            <Input
              aria-label={t("search")}
              placeholder={search ? t("searchingAll") : t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && numericSearchId) {
                  push(`/documents/${numericSearchId}`);
                }
              }}
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
              <SelectItem value="queued">{t("statusQueued")}</SelectItem>
              <SelectItem value="processing">{t("statusProcessing")}</SelectItem>
              <SelectItem value="todo">{t("statusTodo")}</SelectItem>
              <SelectItem value="ocr">{t("statusOcr")}</SelectItem>
              <SelectItem value="metadata">{t("statusMetadata")}</SelectItem>
              <SelectItem value="review">{t("statusReview")}</SelectItem>
              <SelectItem value="index">{t("statusIndex")}</SelectItem>
              <SelectItem value="done">{t("statusDone")}</SelectItem>
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
                      className="grid grid-cols-[80px_1fr_140px_140px_60px] gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors items-center text-sm"
                    >
                      <Link
                        href={`/documents/${doc.id}`}
                        aria-label={`${doc.title}, #${doc.id}`}
                        className="col-span-4 grid grid-cols-[80px_1fr_140px_140px] gap-2 items-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
                      >
                        {/* ID */}
                        <div className="font-mono text-xs text-zinc-400">#{doc.id}</div>

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
                          {doc.processing_status &&
                            statusConfig[doc.processing_status] &&
                            (doc.processing_status === "review" ||
                            doc.processing_status === "manual_review" ? (
                              <Badge
                                variant={statusConfig[doc.processing_status].variant}
                                className="text-xs"
                                title={t("clickToViewCase")}
                              >
                                {t(statusConfig[doc.processing_status].labelKey)}
                              </Badge>
                            ) : (
                              <Badge
                                variant={statusConfig[doc.processing_status].variant}
                                className="text-xs"
                              >
                                {t(statusConfig[doc.processing_status].labelKey)}
                              </Badge>
                            ))}
                        </div>
                      </Link>

                      {/* Logs Button */}
                      <div className="text-center">
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" asChild>
                          <Link
                            href={`/documents/${doc.id}/log`}
                            aria-label={`${t("columnLogs")} ${doc.title}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ScrollText className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
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
