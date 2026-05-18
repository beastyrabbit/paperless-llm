"use client";

import { parseDocumentIdString } from "@repo/api-contracts";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Separator,
  Textarea,
} from "@repo/ui";
import {
  ArrowLeft,
  Bot,
  Calendar,
  Check,
  Edit3,
  ExternalLink,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  ScrollText,
  Tag,
  User,
  Wrench,
  X,
} from "lucide-react";
import Link from "next/link";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, use, useCallback, useEffect, useMemo, useState } from "react";
import {
  type CaseMetadataPatch,
  type CaseQuestion,
  type CaseQuestionAnswerAction,
  type CustomFieldSetting,
  casesApi,
  type DocumentCase,
  type DocumentDetail,
  documentsApi,
  type EntityOption,
  pendingApi,
  processingApi,
  settingsApi,
} from "@/lib/api";
import { APP_PAGE_BACKGROUND } from "@/lib/styles";
import { useStringSetting } from "@/lib/tinybase";

type WorkflowTagSettings = Record<
  | "todo"
  | "ocr"
  | "metadata"
  | "review"
  | "index"
  | "done"
  | "failed"
  | "pending"
  | "ocr_done"
  | "summary_done"
  | "schema_review"
  | "correspondent_done"
  | "document_type_done"
  | "title_done"
  | "tags_done"
  | "processed"
  | "manual_review",
  string
>;

// Helper to determine processing status from configured workflow tags
function getProcessingStatus(
  tags: Array<{ id: number; name: string }>,
  workflowTags: WorkflowTagSettings,
): string {
  const tagNames = new Set(tags.map((tag) => tag.name));
  const hasTag = (key: keyof WorkflowTagSettings) => {
    const value = workflowTags[key];
    return value.length > 0 && tagNames.has(value);
  };

  // Check final/error/manual states first.
  if (hasTag("done") || hasTag("processed")) return "done";
  if (hasTag("failed")) return "failed";
  if (hasTag("manual_review") || hasTag("review") || hasTag("schema_review")) return "review";

  // Check pipeline states in reverse order (most advanced first).
  if (hasTag("tags_done")) return "tags_done";
  if (hasTag("document_type_done")) return "document_type_done";
  if (hasTag("correspondent_done")) return "correspondent_done";
  if (hasTag("title_done")) return "title_done";
  if (hasTag("summary_done")) return "summary_done";
  if (hasTag("ocr_done")) return "ocr_done";
  if (hasTag("index")) return "index";
  if (hasTag("metadata")) return "metadata";
  if (hasTag("ocr")) return "ocr";
  if (hasTag("pending")) return "pending";
  if (hasTag("todo")) return "todo";
  return "unknown";
}

// Check if OCR is done (content accordion should be collapsed)
function isOcrComplete(status: string): boolean {
  return !["todo", "pending", "unknown"].includes(status);
}

const ENTITY_LABEL_KEYS: Record<CaseQuestion["entityKind"], string> = {
  tag: "entityTag",
  correspondent: "entityCorrespondent",
  document_type: "entityDocumentType",
  custom_field: "entityCustomField",
};

function getEntityOptions(
  entityKind: CaseQuestion["entityKind"],
  entities: {
    correspondents: EntityOption[];
    document_types: EntityOption[];
    tags: EntityOption[];
  },
): EntityOption[] {
  if (entityKind === "tag") return entities.tags;
  if (entityKind === "correspondent") return entities.correspondents;
  if (entityKind === "document_type") return entities.document_types;
  return [];
}

function parseTagNames(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry, index, entries) => entry.length > 0 && entries.indexOf(entry) === index);
}

function formatCustomFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) {
    return value.map(formatCustomFieldValue).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function ProposalQuestion({
  question,
  document,
  entities,
  onAnswered,
}: {
  question: CaseQuestion;
  document: DocumentDetail;
  entities: {
    correspondents: EntityOption[];
    document_types: EntityOption[];
    tags: EntityOption[];
  };
  onAnswered: (updatedCase?: DocumentCase) => Promise<void>;
}) {
  const [guidance, setGuidance] = useState("");
  const [savingAction, setSavingAction] = useState<CaseQuestionAnswerAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useAnotherOpen, setUseAnotherOpen] = useState(false);
  const [selectedEntityName, setSelectedEntityName] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editCorrespondent, setEditCorrespondent] = useState("");
  const [editDocumentType, setEditDocumentType] = useState("");
  const [editTags, setEditTags] = useState("");

  const t = useTranslations("documentDetail");
  const tCommon = useTranslations("common");
  const options = getEntityOptions(question.entityKind, entities);
  const label = t(ENTITY_LABEL_KEYS[question.entityKind]);
  const optionListId = `${question.id}-entity-options`;
  const mapTarget =
    question.requestedAction === "map"
      ? (question.alternatives.find((alternative) => alternative.exists && alternative.id) ?? null)
      : null;
  const applyLabel = mapTarget ? t("mapToExisting") : t("apply");

  const answer = async (
    selectedAnswer: CaseQuestionAnswerAction,
    extra: {
      selectedEntityName?: string | null;
      metadataPatch?: CaseMetadataPatch | null;
    } = {},
  ) => {
    setSavingAction(selectedAnswer);
    setError(null);
    const result = await casesApi.answerQuestion(question.id, {
      answer: selectedAnswer,
      guidance: guidance.trim() ? guidance.trim() : null,
      selectedEntityName: extra.selectedEntityName ?? null,
      metadataPatch: extra.metadataPatch ?? null,
    });
    if (result.error) {
      setError(result.error);
      setSavingAction(null);
      return;
    }
    setGuidance("");
    setSavingAction(null);
    await onAnswered(result.data);
  };

  const submitUseAnother = async () => {
    const value = selectedEntityName.trim();
    if (!value) {
      setError(t("enterReplacement"));
      return;
    }
    await answer("use_another", { selectedEntityName: value });
  };

  const openMetadataEditor = () => {
    setEditTitle(document.title);
    setEditCorrespondent(document.correspondent ?? "");
    setEditDocumentType(document.document_type ?? "");
    setEditTags(document.tags.map((tag) => tag.name).join(", "));
    setEditOpen(true);
  };

  const submitMetadataEdit = async () => {
    await answer("edit_metadata", {
      metadataPatch: {
        title: editTitle,
        correspondentName: editCorrespondent.trim() || null,
        documentTypeName: editDocumentType.trim() || null,
        tagNames: parseTagNames(editTags),
      },
    });
    setEditOpen(false);
  };

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase text-amber-700 dark:text-amber-300">
            {mapTarget
              ? t("mapProposal", { entity: label })
              : t("proposedEntity", { entity: label })}
          </p>
          {mapTarget ? (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-base font-semibold text-amber-950 dark:text-amber-100">
              <span className="break-words">{question.candidate.name}</span>
              <span aria-hidden="true" className="text-amber-700 dark:text-amber-300">
                →
              </span>
              <span className="break-words">{mapTarget.name}</span>
            </div>
          ) : (
            <p className="mt-1 break-words text-base font-semibold text-amber-950 dark:text-amber-100">
              {question.candidate.name}
            </p>
          )}
        </div>
        <Badge variant={question.candidate.exists ? "secondary" : "outline"} className="shrink-0">
          {mapTarget
            ? t("mapBadge")
            : question.candidate.exists
              ? tCommon("exists")
              : t("newEntity")}
        </Badge>
      </div>

      {question.evidence && (
        <p className="mt-3 rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-zinc-950/50 dark:text-amber-100">
          {question.evidence}
        </p>
      )}

      {question.alternatives.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.alternatives.slice(0, 6).map((alternative) => (
            <Badge key={`${alternative.id ?? "new"}-${alternative.name}`} variant="outline">
              {alternative.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={savingAction !== null}
          onClick={() => answer("apply")}
        >
          {savingAction === "apply" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-2 h-4 w-4" />
          )}
          {applyLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={savingAction !== null}
          onClick={() => setUseAnotherOpen((open) => !open)}
        >
          {t("useAnother")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={savingAction !== null}
          onClick={openMetadataEditor}
        >
          <Edit3 className="mr-2 h-4 w-4" />
          {t("editMetadata")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={savingAction !== null}
          onClick={() => answer("reject")}
        >
          <X className="mr-2 h-4 w-4" />
          {t("reject")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={savingAction !== null}
          onClick={() => answer("skip")}
        >
          {t("skip")}
        </Button>
      </div>

      {useAnotherOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-200 bg-white/80 p-3 dark:border-amber-900 dark:bg-zinc-950/60">
          <Input
            value={selectedEntityName}
            onChange={(event) => setSelectedEntityName(event.target.value)}
            list={optionListId}
            placeholder={t("useAnotherPlaceholder", { entity: label.toLowerCase() })}
            aria-label={t("useAnotherPlaceholder", { entity: label.toLowerCase() })}
          />
          <datalist id={optionListId}>
            {options.map((option) => (
              <option key={option.id} value={option.name} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setUseAnotherOpen(false)}
            >
              {tCommon("cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={savingAction !== null}
              onClick={submitUseAnother}
            >
              {savingAction === "use_another" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("use")}
            </Button>
          </div>
        </div>
      )}

      <Textarea
        className="mt-3 min-h-20 bg-white dark:bg-zinc-950"
        value={guidance}
        onChange={(event) => setGuidance(event.target.value)}
        placeholder={t("guidancePlaceholder")}
        aria-label={t("guidancePlaceholder")}
      />
      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("editMetadata")}</DialogTitle>
            <DialogDescription>{t("documentNumber", { id: document.id })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              aria-label={t("title")}
            />
            <Input
              value={editCorrespondent}
              onChange={(event) => setEditCorrespondent(event.target.value)}
              list={`${question.id}-correspondents`}
              placeholder={t("correspondent")}
              aria-label={t("correspondent")}
            />
            <datalist id={`${question.id}-correspondents`}>
              {entities.correspondents.map((option) => (
                <option key={option.id} value={option.name} />
              ))}
            </datalist>
            <Input
              value={editDocumentType}
              onChange={(event) => setEditDocumentType(event.target.value)}
              list={`${question.id}-document-types`}
              placeholder={t("documentType")}
              aria-label={t("documentType")}
            />
            <datalist id={`${question.id}-document-types`}>
              {entities.document_types.map((option) => (
                <option key={option.id} value={option.name} />
              ))}
            </datalist>
            <Input
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              list={`${question.id}-tags`}
              placeholder={t("tags")}
              aria-label={t("tags")}
            />
            <datalist id={`${question.id}-tags`}>
              {entities.tags.map((option) => (
                <option key={option.id} value={option.name} />
              ))}
            </datalist>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              {tCommon("cancel")}
            </Button>
            <Button type="button" disabled={savingAction !== null} onClick={submitMetadataEdit}>
              {savingAction === "edit_metadata" && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {t("applyEdits")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DocumentDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const docId = parseDocumentIdString(resolvedParams.id);
  if (docId === null) notFound();
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("documentDetail");
  const tCommon = useTranslations("common");
  const quickReviewMode = searchParams.get("review") === "1";

  // Document state
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [caseRecord, setCaseRecord] = useState<DocumentCase | null>(null);
  const [entities, setEntities] = useState<{
    correspondents: EntityOption[];
    document_types: EntityOption[];
    tags: EntityOption[];
  }>({ correspondents: [], document_types: [], tags: [] });
  const [customFields, setCustomFields] = useState<CustomFieldSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const paperlessExternalUrl = useStringSetting("paperless.external_url");
  const paperlessInternalUrl = useStringSetting("paperless.url");
  const paperlessUrl = paperlessExternalUrl || paperlessInternalUrl || null;
  const tagTodo = useStringSetting("tags.todo");
  const tagOcr = useStringSetting("tags.ocr");
  const tagMetadata = useStringSetting("tags.metadata");
  const tagReview = useStringSetting("tags.review");
  const tagIndex = useStringSetting("tags.index");
  const tagDone = useStringSetting("tags.done");
  const tagFailed = useStringSetting("tags.failed");
  const tagPending = useStringSetting("tags.pending");
  const tagOcrDone = useStringSetting("tags.ocr_done");
  const tagSummaryDone = useStringSetting("tags.summary_done");
  const tagSchemaReview = useStringSetting("tags.schema_review");
  const tagCorrespondentDone = useStringSetting("tags.correspondent_done");
  const tagDocumentTypeDone = useStringSetting("tags.document_type_done");
  const tagTitleDone = useStringSetting("tags.title_done");
  const tagTagsDone = useStringSetting("tags.tags_done");
  const tagProcessed = useStringSetting("tags.processed");
  const tagManualReview = useStringSetting("tags.manual_review");
  const workflowTags = useMemo<WorkflowTagSettings>(
    () => ({
      todo: tagTodo,
      ocr: tagOcr,
      metadata: tagMetadata,
      review: tagReview,
      index: tagIndex,
      done: tagDone,
      failed: tagFailed,
      pending: tagPending,
      ocr_done: tagOcrDone,
      summary_done: tagSummaryDone,
      schema_review: tagSchemaReview,
      correspondent_done: tagCorrespondentDone,
      document_type_done: tagDocumentTypeDone,
      title_done: tagTitleDone,
      tags_done: tagTagsDone,
      processed: tagProcessed,
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

  // Case run state
  const [processing, setProcessing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reviewAdvancing, setReviewAdvancing] = useState(false);

  // Content accordion - open if OCR not complete
  const [contentAccordionValue, setContentAccordionValue] = useState<string[]>([]);

  const loadDocumentAndCase = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      const [docResult, caseResult] = await Promise.all([
        documentsApi.get(docId),
        casesApi.getForDocument(docId),
      ]);

      if (docResult.error) {
        setError(docResult.error);
      } else if (docResult.data) {
        setError(null);
        setDocument(docResult.data);
        const status = getProcessingStatus(docResult.data.tags, workflowTags);
        if (!isOcrComplete(status)) {
          setContentAccordionValue(["content"]);
        }
      }

      if (caseResult.data) {
        setCaseRecord(caseResult.data);
      } else if (caseResult.error) {
        setActionError(caseResult.error);
      }

      if (showLoading) setLoading(false);
    },
    [docId, workflowTags],
  );

  useEffect(() => {
    pendingApi.searchEntities().then(({ data }) => {
      if (data) setEntities(data);
    });
    settingsApi.getCustomFields().then(({ data }) => {
      if (data) setCustomFields(data.fields);
    });
  }, []);

  // Fetch document on mount and when tab regains focus (in case processing happened in another tab)
  useEffect(() => {
    // Initial fetch
    loadDocumentAndCase();

    // Refresh when tab becomes visible again (user may have processed in another tab)
    const handleVisibilityChange = () => {
      if (globalThis.document.visibilityState === "visible") {
        loadDocumentAndCase(false); // Don't show loading spinner on refetch
      }
    };

    globalThis.document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      globalThis.document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDocumentAndCase]);

  const runCase = async (options: { rerun?: boolean } = {}) => {
    setProcessing(true);
    setActionError(null);
    try {
      const result = await casesApi.run(
        docId,
        options.rerun ? { resume: false, rerun: true } : { resume: true },
      );
      if (result.error) {
        setActionError(result.error);
      }
      await loadDocumentAndCase(false);
    } finally {
      setProcessing(false);
    }
  };

  const cancelRun = async () => {
    setCancelling(true);
    setActionError(null);
    try {
      const result = await processingApi.cancel(docId, {
        runId: caseRecord?.activeRunId,
        reason: "user_requested",
      });
      if (result.error) {
        setActionError(result.error);
      } else if (result.data?.status === "run_mismatch") {
        setActionError(t("cancelRunMismatch"));
      } else if (result.data?.status === "no_active_run") {
        setActionError(t("cancelNoActiveRun"));
      }
      await loadDocumentAndCase(false);
      setProcessing(false);
    } finally {
      setCancelling(false);
    }
  };

  const goToNextReviewDocument = useCallback(async (): Promise<boolean> => {
    setReviewAdvancing(true);
    const result = await casesApi.list("needs_input");
    setReviewAdvancing(false);
    if (result.error) {
      setActionError(result.error);
      return false;
    }

    const nextCase = (result.data?.cases ?? []).find(
      (candidate) =>
        candidate.docId !== docId &&
        candidate.questions.some((question) => question.status === "open"),
    );
    if (!nextCase) {
      setActionError(t("noMoreFastReview"));
      return false;
    }

    router.replace(`/documents/${nextCase.docId}?review=1#case`);
    return true;
  }, [docId, router, t]);

  const handleQuestionAnswered = useCallback(
    async (updatedCase?: DocumentCase) => {
      const hasMoreQuestionsOnCurrentDocument =
        updatedCase?.questions.some((question) => question.status === "open") ?? false;

      if (updatedCase) setCaseRecord(updatedCase);

      if (hasMoreQuestionsOnCurrentDocument) {
        await loadDocumentAndCase(false);
        return;
      }

      setProcessing(true);
      const resumeResult = await casesApi.run(docId, { resume: true });
      setProcessing(false);
      if (resumeResult.error) {
        setActionError(resumeResult.error);
        await loadDocumentAndCase(false);
        return;
      }

      if (!quickReviewMode) {
        await loadDocumentAndCase(false);
        return;
      }

      const moved = await goToNextReviewDocument();
      if (!moved) {
        await loadDocumentAndCase(false);
      }
    },
    [docId, goToNextReviewDocument, loadDocumentAndCase, quickReviewMode],
  );

  const processingStatus = document ? getProcessingStatus(document.tags, workflowTags) : "unknown";
  const isProcessed = processingStatus === "done" || processingStatus === "processed";
  const pdfUrl = documentsApi.getPdfUrl(docId);
  const openQuestions =
    caseRecord?.questions.filter((question) => question.status === "open") ?? [];
  const transcript = caseRecord?.transcript ?? [];
  const caseStatus = caseRecord?.automationStatus ?? "idle";
  const isCaseComplete = isProcessed || caseStatus === "done" || caseRecord?.phase === "done";
  const hasOpenQuestions = openQuestions.length > 0;
  const reviewModeHref = quickReviewMode
    ? `/documents/${docId}#case`
    : `/documents/${docId}?review=1#case`;
  const isRunActive = processing || caseStatus === "running" || Boolean(caseRecord?.activeRunId);
  const runActionLabel =
    caseStatus === "failed" || processingStatus === "failed" ? t("retryCase") : t("runCase");
  const getStatusLabel = useCallback(
    (status: string) => {
      switch (status) {
        case "done":
          return t("statusLabels.done");
        case "processed":
          return t("statusLabels.processed");
        case "failed":
          return t("statusLabels.failed");
        case "review":
        case "schema_review":
        case "needs_input":
          return t("statusLabels.needsReview");
        case "running":
        case "processing":
          return t("statusLabels.running");
        case "queued":
        case "pending":
          return t("statusLabels.pending");
        case "tags_done":
          return t("statusLabels.tagsDone");
        case "document_type_done":
          return t("statusLabels.documentTypeDone");
        case "correspondent_done":
          return t("statusLabels.correspondentDone");
        case "title_done":
          return t("statusLabels.titleDone");
        case "summary_done":
          return t("statusLabels.summaryDone");
        case "ocr_done":
          return t("statusLabels.ocrDone");
        case "index":
          return t("statusLabels.indexing");
        case "metadata":
          return t("statusLabels.metadata");
        case "ocr":
          return t("statusLabels.ocr");
        case "todo":
          return t("statusLabels.todo");
        case "idle":
          return t("statusLabels.idle");
        default:
          return t("statusLabels.unknown");
      }
    },
    [t],
  );
  const processingStatusLabel = getStatusLabel(processingStatus);
  const caseStatusLabel = getStatusLabel(caseStatus);
  const customFieldById = useMemo(
    () => new Map(customFields.map((field) => [field.id, field] as const)),
    [customFields],
  );
  const assignedCustomFields = useMemo(
    () =>
      (document?.custom_fields ?? []).map((assignment) => {
        const field = customFieldById.get(assignment.field);
        return {
          id: assignment.field,
          name: field?.name ?? t("customFieldFallback", { id: assignment.field }),
          dataType: field?.data_type,
          value: formatCustomFieldValue(assignment.value),
        };
      }),
    [customFieldById, document?.custom_fields, t],
  );

  if (loading) {
    return (
      <div className={`flex ${APP_PAGE_BACKGROUND} items-center justify-center`}>
        <Loader2 className="h-8 w-8 animate-spin text-emerald-500" />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className={`flex ${APP_PAGE_BACKGROUND} flex-col items-center justify-center gap-4`}>
        <p className="text-red-500">{error || t("notFound")}</p>
        <Button variant="outline" asChild>
          <Link href="/documents">
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t("backToDocuments")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className={APP_PAGE_BACKGROUND}>
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/documents" aria-label={t("backToDocuments")}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                {t("documentNumber", { id: docId })}
              </h1>
              <div className="flex items-center gap-2">
                <p className="text-sm text-zinc-500 truncate max-w-md">{document.title}</p>
                <Badge variant="outline" className="text-xs">
                  {processingStatusLabel}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {caseRecord && (
              <Badge variant="outline" className="text-xs">
                {t("caseStatus", { status: caseStatusLabel })}
              </Badge>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadDocumentAndCase(false)}
              disabled={processing || cancelling}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {tCommon("refresh")}
            </Button>

            {paperlessUrl && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={`${paperlessUrl}/documents/${docId}/details`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t("openInPaperless")}
                </a>
              </Button>
            )}

            <Button variant={quickReviewMode ? "default" : "outline"} size="sm" asChild>
              <Link href={reviewModeHref}>
                <ListChecks className="mr-2 h-4 w-4" />
                {quickReviewMode ? t("fastReviewOn") : t("fastReview")}
              </Link>
            </Button>

            <Button variant="outline" size="sm" asChild>
              <Link href={`/documents/${docId}/log`}>
                <ScrollText className="mr-2 h-4 w-4" />
                {t("logs")}
              </Link>
            </Button>

            {isRunActive && (
              <Button
                onClick={cancelRun}
                disabled={cancelling}
                size="sm"
                variant="outline"
                className="text-red-600 hover:text-red-700"
              >
                {cancelling ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                {cancelling ? t("cancelling") : t("cancelRun")}
              </Button>
            )}

            {hasOpenQuestions ? (
              <Button size="sm" asChild>
                <a href="#case">
                  <MessageSquare className="mr-2 h-4 w-4" />
                  {t("answerQuestions")}
                </a>
              </Button>
            ) : isCaseComplete ? (
              <Button
                onClick={() => runCase({ rerun: true })}
                disabled={isRunActive || cancelling}
                size="sm"
                variant="outline"
              >
                {processing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                {processing ? t("running") : t("rerunCase")}
              </Button>
            ) : (
              <Button onClick={() => runCase()} disabled={isRunActive || cancelling} size="sm">
                {processing ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Play className="mr-2 h-4 w-4" />
                )}
                {processing ? t("running") : runActionLabel}
              </Button>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-6 p-8">
        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {actionError}
          </div>
        )}

        {/* Main content area - PDF left, info right */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* PDF Viewer - Left Column */}
          <Card className="lg:row-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                {t("documentPreview")}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <iframe
                src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                className="h-[1000px] w-full rounded-b-lg border-t"
                title={t("pdfTitle", { id: docId })}
              />
            </CardContent>
          </Card>

          {/* Right Column - Content Accordion + Info */}
          <div className="flex flex-col gap-6">
            {/* Document Content Accordion */}
            <Card id="case">
              <Accordion
                type="multiple"
                value={contentAccordionValue}
                onValueChange={setContentAccordionValue}
              >
                <AccordionItem value="content" className="border-0">
                  <CardHeader className="py-4">
                    <AccordionTrigger className="hover:no-underline [&[data-state=open]>svg]:rotate-180">
                      <CardTitle className="flex items-center gap-2 text-base">
                        <FileText className="h-4 w-4" />
                        {t("ocrContent")}
                        {isOcrComplete(processingStatus) && (
                          <Badge variant="secondary" className="ml-2 text-xs">
                            {t("extracted")}
                          </Badge>
                        )}
                      </CardTitle>
                    </AccordionTrigger>
                  </CardHeader>
                  <AccordionContent>
                    <CardContent className="pt-0 pb-4">
                      <ScrollArea className="h-[200px] rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
                        <pre className="whitespace-pre-wrap font-mono text-sm">
                          {document.content || t("noContent")}
                        </pre>
                      </ScrollArea>
                    </CardContent>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Card>

            {/* Document Info Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("documentInformation")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Title */}
                <div>
                  <p className="text-sm text-zinc-500">{t("title")}</p>
                  <p className="font-medium">{document.title}</p>
                </div>

                <Separator />

                {/* Correspondent */}
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">{t("correspondent")}</p>
                    <p className="font-medium">{document.correspondent || t("notAssigned")}</p>
                  </div>
                </div>

                <Separator />

                {/* Document Type */}
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">{t("documentType")}</p>
                    <p className="font-medium">{document.document_type || t("notAssigned")}</p>
                  </div>
                </div>

                <Separator />

                {/* Created Date */}
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-zinc-400" />
                  <div>
                    <p className="text-sm text-zinc-500">{t("created")}</p>
                    <p className="font-medium">{new Date(document.created).toLocaleDateString()}</p>
                  </div>
                </div>

                <Separator />

                {/* Custom Fields */}
                {assignedCustomFields.length > 0 && (
                  <>
                    <div>
                      <div className="mb-2 flex items-center gap-2">
                        <Wrench className="h-4 w-4 text-zinc-400" />
                        <p className="text-sm text-zinc-500">{t("customFields")}</p>
                      </div>
                      <div className="space-y-2">
                        {assignedCustomFields.map((field) => (
                          <div
                            key={field.id}
                            className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900"
                          >
                            <p className="text-xs font-medium text-zinc-500">{field.name}</p>
                            <p className="mt-1 break-words text-sm font-medium">
                              {field.value || t("emptyCustomField")}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Separator />
                  </>
                )}

                {/* Tags */}
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Tag className="h-4 w-4 text-zinc-400" />
                    <p className="text-sm text-zinc-500">{t("tags")}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {document.tags.length > 0 ? (
                      document.tags.map((tag) => (
                        <Badge
                          key={tag.id}
                          variant={tag.name.startsWith("llm-") ? "secondary" : "outline"}
                        >
                          {tag.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-sm text-zinc-400">{t("noTags")}</span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Document Case */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3 text-base">
                  <span className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    {t("case")}
                  </span>
                  {caseRecord && (
                    <Badge variant="outline" className="text-xs">
                      {caseStatusLabel}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-zinc-500">{t("phase")}</p>
                    <p className="font-medium">{caseRecord?.phase ?? t("newEntity")}</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">{t("questions")}</p>
                    <p className="font-medium">
                      {t("openQuestions", { count: openQuestions.length })}
                    </p>
                  </div>
                </div>

                {openQuestions.length > 0 && (
                  <div className="space-y-3">
                    {openQuestions.map((question) => (
                      <ProposalQuestion
                        key={question.id}
                        question={question}
                        document={document}
                        entities={entities}
                        onAnswered={handleQuestionAnswered}
                      />
                    ))}
                  </div>
                )}

                {quickReviewMode && reviewAdvancing && (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("openingNextQuestion")}
                  </div>
                )}

                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <MessageSquare className="h-4 w-4 text-zinc-400" />
                    {t("transcript")}
                  </div>
                  <ScrollArea className="h-[260px] rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900">
                    {transcript.length === 0 ? (
                      <p className="text-sm text-zinc-500">{t("noTranscript")}</p>
                    ) : (
                      <div className="space-y-3 pr-3">
                        {transcript.map((message) => (
                          <div key={message.id} className="flex gap-2">
                            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white dark:bg-zinc-800">
                              {message.role === "user" ? (
                                <User className="h-4 w-4" />
                              ) : (
                                <Bot className="h-4 w-4" />
                              )}
                            </div>
                            <div className="min-w-0 rounded-md bg-white px-3 py-2 text-sm dark:bg-zinc-800">
                              <p className="whitespace-pre-wrap">{message.content}</p>
                              <p className="mt-1 text-[11px] text-zinc-500">
                                {new Date(message.createdAt).toLocaleString()}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-zinc-950">
          <Loader2 className="size-7 animate-spin text-emerald-500" />
        </div>
      }
    >
      <DocumentDetailContent params={params} />
    </Suspense>
  );
}
