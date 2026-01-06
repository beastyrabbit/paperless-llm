"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  CheckCircle2,
  User,
  Tag,
  FileText,
  Check,
  X,
  Loader2,
  RefreshCw,
  AlertCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  RadioGroup,
  RadioGroupItem,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  cn,
} from "@repo/ui";
import {
  pendingApi,
  PendingItem,
  PendingCounts,
  RejectBlockType,
  RejectionCategory,
} from "@/lib/api";

const sections = [
  { key: "correspondent", labelKey: "correspondents", icon: User },
  { key: "document_type", labelKey: "documentTypes", icon: FileText },
  { key: "tag", labelKey: "tags", icon: Tag },
] as const;

type SectionKey = (typeof sections)[number]["key"];

export default function PendingPage() {
  const t = useTranslations("pending");
  const [items, setItems] = useState<PendingItem[]>([]);
  const [counts, setCounts] = useState<PendingCounts>({
    correspondent: 0,
    document_type: 0,
    tag: 0,
    total: 0,
  });
  const [activeSection, setActiveSection] = useState<SectionKey>("correspondent");
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(
    new Set()
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});

  // Rejection modal state
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingItem, setRejectingItem] = useState<PendingItem | null>(null);
  const [blockType, setBlockType] = useState<RejectBlockType>("none");
  const [rejectionCategory, setRejectionCategory] = useState<RejectionCategory | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [countsResponse, itemsResponse] = await Promise.all([
        pendingApi.getCounts(),
        pendingApi.list(),
      ]);

      if (countsResponse.error) {
        setError(countsResponse.error);
        return;
      }
      if (itemsResponse.error) {
        setError(itemsResponse.error);
        return;
      }

      setCounts(countsResponse.data!);
      setItems(itemsResponse.data!);

      // Initialize selected values to the suggestion for each item
      const initial: Record<string, string> = {};
      for (const item of itemsResponse.data!) {
        initial[item.id] = item.suggestion;
      }
      setSelectedValues(initial);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getCount = (type: SectionKey) => counts[type];

  const totalCount = counts.total;

  const filteredItems = items.filter((item) => item.type === activeSection);

  const handleSelectOption = (id: string, option: string) => {
    setSelectedValues((prev) => ({ ...prev, [id]: option }));
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const selectedValue = selectedValues[id];
      const response = await pendingApi.approve(id, selectedValue);
      if (response.error) {
        setError(response.error);
      } else {
        // Remove item from local state and update counts
        setItems((prev) => prev.filter((item) => item.id !== id));
        const item = items.find((i) => i.id === id);
        if (item) {
          setCounts((prev) => ({
            ...prev,
            [item.type]: prev[item.type] - 1,
            total: prev.total - 1,
          }));
        }
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Reset rejection modal form
  const resetRejectForm = () => {
    setRejectingItem(null);
    setBlockType("none");
    setRejectionCategory(null);
    setRejectionReason("");
  };

  // Open rejection modal for schema items, direct reject for non-schema items
  const openRejectModal = (item: PendingItem) => {
    // For schema items (correspondent, document_type, tag), show the modal
    // These are the items where blocking makes sense
    setRejectingItem(item);
    setRejectModalOpen(true);
  };

  // Handle reject with feedback (from modal)
  const handleRejectWithFeedback = async () => {
    if (!rejectingItem) return;

    setActionLoading(rejectingItem.id);
    try {
      const response = await pendingApi.rejectWithFeedback(rejectingItem.id, {
        block_type: blockType,
        rejection_category: rejectionCategory,
        rejection_reason: rejectionReason || null,
      });

      if (response.error) {
        setError(response.error);
      } else {
        // Remove item from local state and update counts
        setItems((prev) => prev.filter((item) => item.id !== rejectingItem.id));
        setCounts((prev) => ({
          ...prev,
          [rejectingItem.type]: prev[rejectingItem.type] - 1,
          total: prev.total - 1,
        }));
        setRejectModalOpen(false);
        resetRejectForm();
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Get display name for item type
  const getTypeDisplayName = (type: string) => {
    switch (type) {
      case "correspondent":
        return t("correspondents").toLowerCase().replace(/s$/, "");
      case "document_type":
        return t("documentTypes").toLowerCase().replace(/s$/, "");
      case "tag":
        return t("tags").toLowerCase().replace(/s$/, "");
      default:
        return type;
    }
  };

  const toggleReasoning = (id: string) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getFirstSentence = (text: string) => {
    const match = text.match(/^[^.!?]+[.!?]/);
    return match ? match[0] : text;
  };

  // Auto-switch to first non-empty section if current is empty
  useEffect(() => {
    const currentCount = counts[activeSection];
    if (currentCount === 0 && totalCount > 0) {
      const firstNonEmpty = sections.find((s) => counts[s.key] > 0);
      if (firstNonEmpty && firstNonEmpty.key !== activeSection) {
        setActiveSection(firstNonEmpty.key);
      }
    }
  }, [counts, activeSection, totalCount]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-zinc-500">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-white to-emerald-50/30 dark:from-zinc-950 dark:via-zinc-900 dark:to-emerald-950/20">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white/80 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="flex h-16 items-center justify-between px-8">
          <div>
            <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-zinc-500">
              {t("subtitle", { count: totalCount })}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            {t("refresh")}
          </Button>
        </div>
      </header>

      <div className="p-8">
        {/* Error Alert */}
        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              onClick={() => setError(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Section Tabs */}
        <div className="flex gap-2 mb-6">
          {sections.map((section) => {
            const count = getCount(section.key);
            const Icon = section.icon;
            const isActive = activeSection === section.key;
            const isDisabled = count === 0;

            return (
              <Button
                key={section.key}
                variant={isActive ? "default" : "outline"}
                disabled={isDisabled}
                onClick={() => setActiveSection(section.key)}
                className={cn(
                  "gap-2",
                  isDisabled && "opacity-50 cursor-not-allowed"
                )}
              >
                <Icon className="h-4 w-4" />
                {t(section.labelKey)}
                <Badge
                  variant={isActive ? "secondary" : "outline"}
                  className={cn(
                    "ml-1 min-w-[1.5rem] justify-center",
                    isDisabled && "bg-zinc-100 dark:bg-zinc-800"
                  )}
                >
                  {count}
                </Badge>
              </Button>
            );
          })}
        </div>

        {/* Content */}
        {totalCount === 0 ? (
          <Card className="py-12">
            <CardContent className="flex flex-col items-center justify-center text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
              <h3 className="text-lg font-medium">{t("allCaughtUp")}</h3>
              <p className="text-zinc-500 mt-1">{t("noItems")}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredItems.map((item) => {
              const allOptions = [item.suggestion, ...item.alternatives];
              const selectedValue = selectedValues[item.id] || item.suggestion;
              const firstSentence = getFirstSentence(item.reasoning);
              const hasMore = item.reasoning.length > firstSentence.length;
              const isExpanded = expandedReasoning.has(item.id);
              const isLoading = actionLoading === item.id;

              return (
                <Card key={item.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    {/* Top row: Document title + attempt badge */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {item.doc_title}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {t("attempt", { count: item.attempts })}
                      </Badge>
                    </div>

                    {/* Options row */}
                    <div className="flex flex-wrap gap-2 mb-3">
                      {allOptions.map((option) => {
                        const isSelected = option === selectedValue;
                        return (
                          <Button
                            key={option}
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            className={cn(
                              "transition-all",
                              isSelected &&
                                "border-emerald-500 border-2 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                            )}
                            onClick={() => handleSelectOption(item.id, option)}
                          >
                            {isSelected && (
                              <Check className="h-3 w-3 mr-1 text-emerald-600" />
                            )}
                            {option}
                          </Button>
                        );
                      })}
                    </div>

                    {/* Reasoning */}
                    <div className="mb-3">
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">
                        {isExpanded ? item.reasoning : firstSentence}
                        {hasMore && !isExpanded && (
                          <button
                            onClick={() => toggleReasoning(item.id)}
                            className="ml-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            {t("more")}
                          </button>
                        )}
                        {isExpanded && hasMore && (
                          <button
                            onClick={() => toggleReasoning(item.id)}
                            className="ml-1 text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                          >
                            {t("less")}
                          </button>
                        )}
                      </p>
                      {item.last_feedback && (
                        <p className="text-xs text-zinc-400 dark:text-zinc-500 italic mt-1">
                          {t("feedback")}: {item.last_feedback}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-zinc-500 hover:text-red-600"
                        onClick={() => openRejectModal(item)}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <X className="h-4 w-4 mr-1" />
                        )}
                        {t("reject")}
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => handleApprove(item.id)}
                        disabled={isLoading}
                      >
                        {isLoading ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 mr-1" />
                        )}
                        {t("approve")}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Rejection Modal */}
      <Dialog
        open={rejectModalOpen}
        onOpenChange={(open) => {
          setRejectModalOpen(open);
          if (!open) resetRejectForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rejectModal.title")}</DialogTitle>
            <DialogDescription>
              {rejectingItem &&
                t("rejectModal.description", {
                  suggestion: rejectingItem.suggestion,
                  type: getTypeDisplayName(rejectingItem.type),
                })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <RadioGroup
              value={blockType}
              onValueChange={(v: string) => setBlockType(v as RejectBlockType)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="none" />
                <Label htmlFor="none">{t("rejectModal.justReject")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="per_type" id="per_type" />
                <Label htmlFor="per_type">
                  {rejectingItem &&
                    t("rejectModal.blockPerType", {
                      type: getTypeDisplayName(rejectingItem.type),
                    })}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="global" id="global" />
                <Label htmlFor="global">{t("rejectModal.blockGlobal")}</Label>
              </div>
            </RadioGroup>

            {blockType !== "none" && (
              <>
                <Select
                  value={rejectionCategory || ""}
                  onValueChange={(v) =>
                    setRejectionCategory(v as RejectionCategory)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("rejectModal.whyOptional")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="duplicate">
                      {t("rejectModal.duplicate")}
                    </SelectItem>
                    <SelectItem value="too_generic">
                      {t("rejectModal.tooGeneric")}
                    </SelectItem>
                    <SelectItem value="irrelevant">
                      {t("rejectModal.irrelevant")}
                    </SelectItem>
                    <SelectItem value="wrong_format">
                      {t("rejectModal.wrongFormat")}
                    </SelectItem>
                    <SelectItem value="other">{t("rejectModal.other")}</SelectItem>
                  </SelectContent>
                </Select>

                <Input
                  placeholder={t("rejectModal.additionalContext")}
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                />
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectModalOpen(false);
                resetRejectForm();
              }}
            >
              {t("rejectModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRejectWithFeedback}
              disabled={actionLoading === rejectingItem?.id}
            >
              {actionLoading === rejectingItem?.id ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-1" />
              )}
              {t("rejectModal.confirmReject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
