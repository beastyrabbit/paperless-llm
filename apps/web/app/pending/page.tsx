"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  Square,
  CheckSquare,
  Trash2,
  Search,
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
  Checkbox,
  cn,
} from "@repo/ui";
import {
  pendingApi,
  PendingItem,
  PendingCounts,
  RejectBlockType,
  RejectionCategory,
  SearchableEntities,
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
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const isInitialLoad = useRef(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [existingEntities, setExistingEntities] = useState<SearchableEntities | null>(null);

  // Rejection modal state (single item)
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectingItem, setRejectingItem] = useState<PendingItem | null>(null);
  const [blockType, setBlockType] = useState<RejectBlockType>("none");
  const [rejectionCategory, setRejectionCategory] = useState<RejectionCategory | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // Bulk rejection modal state
  const [bulkRejectModalOpen, setBulkRejectModalOpen] = useState(false);
  const [bulkBlockType, setBulkBlockType] = useState<RejectBlockType>("none");
  const [bulkRejectionCategory, setBulkRejectionCategory] = useState<RejectionCategory | null>(null);
  const [bulkRejectionReason, setBulkRejectionReason] = useState("");

  const loadData = useCallback(async (showLoading = false) => {
    // Only show loading spinner on initial load or manual refresh
    if (showLoading) {
      setLoading(true);
    }
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

      // Initialize selected values for NEW items only (preserve user selections)
      setSelectedValues((prev) => {
        const updated = { ...prev };
        for (const item of itemsResponse.data!) {
          // Only set default if not already selected
          if (!(item.id in updated)) {
            updated[item.id] = item.suggestion;
          }
        }
        return updated;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
      isInitialLoad.current = false;
    }
  }, []);

  // Load existing entities for search
  const loadEntities = useCallback(async () => {
    try {
      const response = await pendingApi.searchEntities();
      if (!response.error && response.data) {
        setExistingEntities(response.data);
      }
    } catch {
      // Silently fail - search is optional
    }
  }, []);

  useEffect(() => {
    // Show loading only on initial load
    loadData(true);
    loadEntities();
  }, [loadData, loadEntities]);

  // Auto-refresh every 5 seconds to pick up new items from bootstrap analysis
  // This is a silent refresh that doesn't reset scroll position
  useEffect(() => {
    const interval = setInterval(() => {
      loadData(false); // Silent refresh - no loading spinner
    }, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Combine schema counts with regular counts for display
  const getCount = (type: SectionKey) => {
    const schemaKey = `schema_${type}` as keyof typeof counts;
    const schemaCount = (counts[schemaKey] as number) || 0;
    return counts[type] + schemaCount;
  };

  // Calculate total from all types (including schema_* types)
  const totalCount = sections.reduce((sum, section) => sum + getCount(section.key), 0);

  // Get existing entities for current section, filtered by search query
  const getFilteredExistingEntities = () => {
    if (!existingEntities || !searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase().trim();
    let entities: string[] = [];

    switch (activeSection) {
      case "correspondent":
        entities = existingEntities.correspondents;
        break;
      case "document_type":
        entities = existingEntities.document_types;
        break;
      case "tag":
        entities = existingEntities.tags;
        break;
    }

    return entities
      .filter((name) => name.toLowerCase().includes(query))
      .slice(0, 10); // Limit to 10 results
  };

  const searchResults = getFilteredExistingEntities();

  // Filter items by section - include both regular types and schema_* types
  const filteredItems = items.filter((item) =>
    item.type === activeSection || item.type === `schema_${activeSection}`
  );

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
          const countKey = item.type as keyof PendingCounts;
          setCounts((prev) => ({
            ...prev,
            [countKey]: Math.max(0, ((prev[countKey] as number) || 0) - 1),
            total: Math.max(0, prev.total - 1),
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
        const countKey = rejectingItem.type as keyof PendingCounts;
        setCounts((prev) => ({
          ...prev,
          [countKey]: Math.max(0, ((prev[countKey] as number) || 0) - 1),
          total: Math.max(0, prev.total - 1),
        }));
        setRejectModalOpen(false);
        resetRejectForm();
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Selection handlers
  const toggleItemSelection = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    const ids = filteredItems.map((item) => item.id);
    setSelectedItems(new Set(ids));
  };

  const deselectAll = () => {
    setSelectedItems(new Set());
  };

  // Bulk action handlers
  const handleBulkApprove = async () => {
    if (selectedItems.size === 0) return;
    setBulkLoading(true);
    setError(null);

    const idsToProcess = Array.from(selectedItems);
    const successIds: string[] = [];

    for (const id of idsToProcess) {
      try {
        const selectedValue = selectedValues[id];
        const response = await pendingApi.approve(id, selectedValue);
        if (!response.error) {
          successIds.push(id);
        }
      } catch {
        // Continue with other items
      }
    }

    // Remove successful items from state
    if (successIds.length > 0) {
      setItems((prev) => prev.filter((item) => !successIds.includes(item.id)));
      setSelectedItems((prev) => {
        const next = new Set(prev);
        for (const id of successIds) {
          next.delete(id);
        }
        return next;
      });
      // Reload counts
      loadData(false);
    }

    setBulkLoading(false);
  };

  // Open bulk reject modal
  const openBulkRejectModal = () => {
    if (selectedItems.size === 0) return;
    setBulkRejectModalOpen(true);
  };

  // Reset bulk rejection modal form
  const resetBulkRejectForm = () => {
    setBulkBlockType("none");
    setBulkRejectionCategory(null);
    setBulkRejectionReason("");
  };

  // Handle bulk reject with feedback (from modal)
  const handleBulkRejectWithFeedback = async () => {
    if (selectedItems.size === 0) return;
    setBulkLoading(true);
    setError(null);

    const idsToProcess = Array.from(selectedItems);
    const successIds: string[] = [];

    for (const id of idsToProcess) {
      try {
        const response = await pendingApi.rejectWithFeedback(id, {
          block_type: bulkBlockType,
          rejection_category: bulkRejectionCategory,
          rejection_reason: bulkRejectionReason || null,
        });
        if (!response.error) {
          successIds.push(id);
        }
      } catch {
        // Continue with other items
      }
    }

    // Remove successful items from state
    if (successIds.length > 0) {
      setItems((prev) => prev.filter((item) => !successIds.includes(item.id)));
      setSelectedItems((prev) => {
        const next = new Set(prev);
        for (const id of successIds) {
          next.delete(id);
        }
        return next;
      });
      // Reload counts
      loadData(false);
    }

    setBulkLoading(false);
    setBulkRejectModalOpen(false);
    resetBulkRejectForm();
  };

  // Handle bulk remove (no blocking, just remove from queue)
  const handleBulkRemove = async () => {
    if (selectedItems.size === 0) return;
    setBulkLoading(true);
    setError(null);

    const idsToProcess = Array.from(selectedItems);
    const successIds: string[] = [];

    for (const id of idsToProcess) {
      try {
        const response = await pendingApi.reject(id);
        if (!response.error) {
          successIds.push(id);
        }
      } catch {
        // Continue with other items
      }
    }

    // Remove successful items from state
    if (successIds.length > 0) {
      setItems((prev) => prev.filter((item) => !successIds.includes(item.id)));
      setSelectedItems((prev) => {
        const next = new Set(prev);
        for (const id of successIds) {
          next.delete(id);
        }
        return next;
      });
      // Reload counts
      loadData(false);
    }

    setBulkLoading(false);
  };

  // Get display name for item type (handles both regular and schema_* types)
  const getTypeDisplayName = (type: string) => {
    // Strip schema_ prefix for display
    const baseType = type.replace(/^schema_/, "");
    switch (baseType) {
      case "correspondent":
        return t("correspondents").toLowerCase().replace(/s$/, "");
      case "document_type":
        return t("documentTypes").toLowerCase().replace(/s$/, "");
      case "tag":
        return t("tags").toLowerCase().replace(/s$/, "");
      default:
        return baseType;
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
    const currentCount = getCount(activeSection);
    if (currentCount === 0 && totalCount > 0) {
      const firstNonEmpty = sections.find((s) => getCount(s.key) > 0);
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
            onClick={() => loadData(true)}
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
                onClick={() => {
                  setActiveSection(section.key);
                  setSelectedItems(new Set()); // Clear selection when switching tabs
                  setSearchQuery(""); // Clear search when switching tabs
                }}
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

        {/* Bulk Actions Toolbar */}
        {filteredItems.length > 0 && (
          <div className="flex flex-col gap-2 mb-4 p-3 bg-zinc-100 dark:bg-zinc-800 rounded-lg">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={selectedItems.size === filteredItems.length ? deselectAll : selectAll}
                className="gap-2"
              >
                {selectedItems.size === filteredItems.length ? (
                  <>
                    <Square className="h-4 w-4" />
                    {t("deselectAll")}
                  </>
                ) : (
                  <>
                    <CheckSquare className="h-4 w-4" />
                    {t("selectAll")}
                  </>
                )}
              </Button>

              {selectedItems.size > 0 && (
                <>
                  <span className="text-sm text-zinc-500 mx-2">
                    {t("selected", { count: selectedItems.size })}
                  </span>
                  <Button
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-700 gap-2"
                    onClick={handleBulkApprove}
                    disabled={bulkLoading}
                  >
                    {bulkLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    {t("approveSelected")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
                    onClick={openBulkRejectModal}
                    disabled={bulkLoading}
                  >
                    <X className="h-4 w-4" />
                    {t("rejectSelected")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-2 text-zinc-500 hover:text-zinc-700"
                    onClick={handleBulkRemove}
                    disabled={bulkLoading}
                  >
                    {bulkLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    {t("removeSelected")}
                  </Button>
                </>
              )}

              {/* Search existing entities */}
              <div className="relative ml-auto">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input
                  placeholder={t("searchExisting", { type: t(sections.find(s => s.key === activeSection)?.labelKey || "").toLowerCase() })}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 w-64 h-8 text-sm"
                />
              </div>
            </div>

            {/* Search results */}
            {searchQuery && (
              <div className="flex flex-wrap gap-1 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                {searchResults.length > 0 ? (
                  searchResults.map((name) => (
                    <Badge
                      key={name}
                      variant="secondary"
                      className="text-xs cursor-default"
                    >
                      <Check className="h-3 w-3 mr-1 text-emerald-500" />
                      {name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-zinc-400">{t("noResults")}</span>
                )}
              </div>
            )}
          </div>
        )}

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

              const isSelected = selectedItems.has(item.id);

              return (
                <Card
                  key={item.id}
                  className={cn(
                    "overflow-hidden transition-all cursor-pointer",
                    isSelected && "ring-2 ring-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
                  )}
                  onClick={() => toggleItemSelection(item.id)}
                >
                  <CardContent className="p-4">
                    {/* Top row: Checkbox + Document title + attempt badge */}
                    <div className="flex items-center gap-3 mb-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleItemSelection(item.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                      />
                      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300 flex-1">
                        {item.doc_title}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {t("attempt", { count: item.attempts })}
                      </Badge>
                    </div>

                    {/* Options row */}
                    <div className="flex flex-wrap gap-2 mb-3" onClick={(e) => e.stopPropagation()}>
                      {allOptions.map((option) => {
                        const isOptionSelected = option === selectedValue;
                        return (
                          <Button
                            key={option}
                            variant="outline"
                            size="sm"
                            disabled={isLoading}
                            className={cn(
                              "transition-all",
                              isOptionSelected &&
                                "border-emerald-500 border-2 bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-950/50"
                            )}
                            onClick={() => handleSelectOption(item.id, option)}
                          >
                            {isOptionSelected && (
                              <Check className="h-3 w-3 mr-1 text-emerald-600" />
                            )}
                            {option}
                          </Button>
                        );
                      })}
                    </div>

                    {/* Reasoning */}
                    <div className="mb-3" onClick={(e) => e.stopPropagation()}>
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
                    <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
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

      {/* Bulk Rejection Modal */}
      <Dialog
        open={bulkRejectModalOpen}
        onOpenChange={(open) => {
          setBulkRejectModalOpen(open);
          if (!open) resetBulkRejectForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bulkRejectModal.title")}</DialogTitle>
            <DialogDescription>
              {t("bulkRejectModal.description", { count: selectedItems.size })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <RadioGroup
              value={bulkBlockType}
              onValueChange={(v: string) => setBulkBlockType(v as RejectBlockType)}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="none" id="bulk-none" />
                <Label htmlFor="bulk-none">{t("rejectModal.justReject")}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="per_type" id="bulk-per_type" />
                <Label htmlFor="bulk-per_type">
                  {t("bulkRejectModal.blockPerType", {
                    type: t(sections.find(s => s.key === activeSection)?.labelKey || "").toLowerCase(),
                  })}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="global" id="bulk-global" />
                <Label htmlFor="bulk-global">{t("rejectModal.blockGlobal")}</Label>
              </div>
            </RadioGroup>

            {bulkBlockType !== "none" && (
              <>
                <Select
                  value={bulkRejectionCategory || ""}
                  onValueChange={(v) =>
                    setBulkRejectionCategory(v as RejectionCategory)
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
                  value={bulkRejectionReason}
                  onChange={(e) => setBulkRejectionReason(e.target.value)}
                />
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBulkRejectModalOpen(false);
                resetBulkRejectForm();
              }}
            >
              {t("rejectModal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkRejectWithFeedback}
              disabled={bulkLoading}
            >
              {bulkLoading ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <X className="h-4 w-4 mr-1" />
              )}
              {t("bulkRejectModal.confirmReject", { count: selectedItems.size })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
