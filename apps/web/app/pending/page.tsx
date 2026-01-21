"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
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
  Ban,
  Unlock,
  Globe,
  GitMerge,
  ArrowRight,
  Sparkles,
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
  BlockedItemsResponse,
  SchemaCleanupMetadata,
  SimilarGroup,
} from "@/lib/api";

const sections = [
  { key: "correspondent", labelKey: "correspondents", icon: User },
  { key: "document_type", labelKey: "documentTypes", icon: FileText },
  { key: "tag", labelKey: "tags", icon: Tag },
] as const;

type SectionKey = (typeof sections)[number]["key"];

export default function PendingPage() {
  const t = useTranslations("pending");
  const searchParams = useSearchParams();
  const docIdFilter = searchParams.get("docId");
  const [items, setItems] = useState<PendingItem[]>([]);
  const [counts, setCounts] = useState<PendingCounts>({
    correspondent: 0,
    document_type: 0,
    tag: 0,
    total: 0,
    schema_correspondent: 0,
    schema_document_type: 0,
    schema_tag: 0,
    schema_custom_field: 0,
    schema_cleanup: 0,
    metadata_description: 0,
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

  // Blocked items state
  const [showBlocked, setShowBlocked] = useState(false);
  const [blockedItems, setBlockedItems] = useState<BlockedItemsResponse | null>(null);
  const [unblockingId, setUnblockingId] = useState<number | null>(null);

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

  // Schema cleanup state
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleanupMergeNames, setCleanupMergeNames] = useState<Record<string, string>>({});
  const [cleanupActionLoading, setCleanupActionLoading] = useState<string | null>(null);

  // Similar suggestions state (pending cleanup)
  const [similarGroups, setSimilarGroups] = useState<SimilarGroup[]>([]);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [mergingGroupIndex, setMergingGroupIndex] = useState<number | null>(null);
  const [similarMergeNames, setSimilarMergeNames] = useState<Record<number, string>>({});

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

  // Load blocked items
  const loadBlockedItems = useCallback(async () => {
    try {
      const response = await pendingApi.getBlocked();
      if (!response.error && response.data) {
        setBlockedItems(response.data);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Handle unblock
  const handleUnblock = async (blockId: number) => {
    setUnblockingId(blockId);
    try {
      const response = await pendingApi.unblock(blockId);
      if (!response.error) {
        // Reload blocked items
        await loadBlockedItems();
      }
    } finally {
      setUnblockingId(null);
    }
  };

  useEffect(() => {
    // Show loading only on initial load
    loadData(true);
    loadEntities();
  }, [loadData, loadEntities]);

  // Load blocked items when switching to blocked view
  useEffect(() => {
    if (showBlocked) {
      loadBlockedItems();
    }
  }, [showBlocked, loadBlockedItems]);

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

  // Get schema cleanup items (memoized to prevent infinite loops)
  const cleanupItems = useMemo(
    () => items.filter((item) => item.type === "schema_cleanup"),
    [items]
  );
  const cleanupCount = counts.schema_cleanup || 0;

  // Create a stable key for cleanup items to detect changes
  const cleanupItemIds = useMemo(
    () => cleanupItems.map((item) => item.id).join(","),
    [cleanupItems]
  );

  // Initialize merge names when cleanup items change
  useEffect(() => {
    if (cleanupItems.length === 0) return;

    setCleanupMergeNames((prev) => {
      let hasChanges = false;
      const updated = { ...prev };
      for (const item of cleanupItems) {
        if (!(item.id in updated)) {
          hasChanges = true;
          const metadata = item.metadata as unknown as SchemaCleanupMetadata;
          // For merges, default to target_name; for deletes, use entity_name
          if (metadata.cleanup_type === "merge") {
            updated[item.id] = metadata.target_name || "";
          } else {
            updated[item.id] = metadata.entity_name || "";
          }
        }
      }
      // Only return new object if there were changes
      return hasChanges ? updated : prev;
    });
  }, [cleanupItemIds, cleanupItems]);

  // Handle cleanup approve (merge or delete)
  const handleCleanupApprove = async (item: PendingItem) => {
    setCleanupActionLoading(item.id);
    setError(null);
    try {
      const metadata = item.metadata as unknown as SchemaCleanupMetadata;
      const finalName = metadata.cleanup_type === "merge" ? cleanupMergeNames[item.id] : undefined;

      const response = await pendingApi.approveCleanup(item.id, finalName);
      if (response.error) {
        setError(response.error);
      } else {
        // Remove item from local state
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setCounts((prev) => ({
          ...prev,
          schema_cleanup: Math.max(0, (prev.schema_cleanup || 0) - 1),
        }));
      }
    } finally {
      setCleanupActionLoading(null);
    }
  };

  // Handle cleanup reject (just remove from queue)
  const handleCleanupReject = async (item: PendingItem) => {
    setCleanupActionLoading(item.id);
    setError(null);
    try {
      const response = await pendingApi.reject(item.id);
      if (response.error) {
        setError(response.error);
      } else {
        // Remove item from local state
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setCounts((prev) => ({
          ...prev,
          schema_cleanup: Math.max(0, (prev.schema_cleanup || 0) - 1),
        }));
      }
    } finally {
      setCleanupActionLoading(null);
    }
  };

  // Find similar pending suggestions
  const handleFindSimilar = async () => {
    setSimilarLoading(true);
    setError(null);
    try {
      const response = await pendingApi.findSimilar(0.6); // Lower threshold for more matches
      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        const groups = response.data.groups ?? [];
        setSimilarGroups(groups);
        // Initialize merge names with recommended names
        const names: Record<number, string> = {};
        groups.forEach((group, index) => {
          names[index] = group.recommended_name;
        });
        setSimilarMergeNames(names);
        setShowSimilarModal(true);
      }
    } finally {
      setSimilarLoading(false);
    }
  };

  // Merge a group of similar suggestions
  const handleMergeSimilar = async (groupIndex: number) => {
    const group = similarGroups[groupIndex];
    const finalName = similarMergeNames[groupIndex] || group.recommended_name;

    setMergingGroupIndex(groupIndex);
    setError(null);
    try {
      const response = await pendingApi.mergeSuggestions(group.item_ids, finalName);
      if (response.error) {
        setError(response.error);
      } else {
        // Remove merged group from list
        setSimilarGroups((prev) => prev.filter((_, i) => i !== groupIndex));
        // Reload data to reflect changes
        await loadData(false);
      }
    } finally {
      setMergingGroupIndex(null);
    }
  };

  // Dismiss a similar group (don't merge)
  const handleDismissSimilar = (groupIndex: number) => {
    setSimilarGroups((prev) => prev.filter((_, i) => i !== groupIndex));
  };

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
  // Also filter by docId if specified in URL
  const filteredItems = items.filter((item) => {
    const matchesSection = item.type === activeSection || item.type === `schema_${activeSection}`;
    const matchesDocId = !docIdFilter || item.doc_id === Number(docIdFilter);
    return matchesSection && matchesDocId;
  });

  // Count items matching docId filter across all sections
  const docFilteredCount = docIdFilter
    ? items.filter((item) => item.doc_id === Number(docIdFilter)).length
    : 0;

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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleFindSimilar}
              disabled={similarLoading || totalCount === 0}
              className="gap-2"
            >
              {similarLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t("similar.findSimilar")}
            </Button>
            <Button
              variant={showCleanup ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setShowCleanup(!showCleanup);
                if (!showCleanup) setShowBlocked(false);
              }}
              className="gap-2"
            >
              <GitMerge className="h-4 w-4" />
              {t("cleanup.toggle")}
              {cleanupCount > 0 && (
                <Badge variant={showCleanup ? "secondary" : "outline"} className="ml-1">
                  {cleanupCount}
                </Badge>
              )}
            </Button>
            <Button
              variant={showBlocked ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setShowBlocked(!showBlocked);
                if (!showBlocked) setShowCleanup(false);
              }}
              className="gap-2"
            >
              <Ban className="h-4 w-4" />
              {t("blocked.toggle")}
              {blockedItems && blockedItems.total > 0 && (
                <Badge variant={showBlocked ? "secondary" : "outline"} className="ml-1">
                  {blockedItems.total}
                </Badge>
              )}
            </Button>
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
        </div>
      </header>

      <div className="p-8">
        {/* Document Filter Banner */}
        {docIdFilter && (
          <div className="mb-6 flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 p-4 text-blue-700 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-400">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              <span>
                {t("filterByDocument", { docId: docIdFilter, count: docFilteredCount })}
              </span>
            </div>
            <a href="/pending">
              <Button variant="outline" size="sm" className="gap-1">
                <X className="h-4 w-4" />
                {t("clearFilter")}
              </Button>
            </a>
          </div>
        )}

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

        {/* Schema Cleanup View */}
        {showCleanup ? (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <GitMerge className="h-5 w-5" />
              {t("cleanup.title")}
            </h2>
            <p className="text-sm text-zinc-500">{t("cleanup.description")}</p>

            {cleanupItems.length === 0 ? (
              <Card className="py-12">
                <CardContent className="flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                  <h3 className="font-semibold text-lg mb-1">{t("cleanup.noItems")}</h3>
                  <p className="text-zinc-500 text-sm">{t("cleanup.noItemsDesc")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {/* Merge requests */}
                {cleanupItems.filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "merge").length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-3 flex items-center gap-2">
                      <GitMerge className="h-4 w-4" />
                      {t("cleanup.mergeRequests")} ({cleanupItems.filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "merge").length})
                    </h3>
                    <div className="space-y-3">
                      {cleanupItems
                        .filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "merge")
                        .map((item) => {
                          const metadata = item.metadata as unknown as SchemaCleanupMetadata;
                          const isLoading = cleanupActionLoading === item.id;
                          const entityIcon = metadata.entity_type === "correspondent" ? User
                            : metadata.entity_type === "document_type" ? FileText
                            : Tag;
                          const EntityIcon = entityIcon;

                          return (
                            <Card key={item.id} className="overflow-hidden">
                              <CardContent className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <EntityIcon className="h-4 w-4 text-zinc-500" />
                                  <Badge variant="outline" className="text-xs">
                                    {metadata.entity_type?.replace("_", " ")}
                                  </Badge>
                                </div>

                                {/* Merge visualization */}
                                <div className="flex items-center gap-3 mb-3 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
                                  <div className="flex-1 text-center">
                                    <div className="text-sm font-medium">{metadata.source_name}</div>
                                    <div className="text-xs text-zinc-500">
                                      {metadata.doc_count_source} {t("cleanup.documents")}
                                    </div>
                                  </div>
                                  <ArrowRight className="h-5 w-5 text-zinc-400" />
                                  <div className="flex-1 text-center">
                                    <div className="text-sm font-medium">{metadata.target_name}</div>
                                    <div className="text-xs text-zinc-500">
                                      {metadata.doc_count_target} {t("cleanup.documents")}
                                    </div>
                                  </div>
                                </div>

                                {/* Editable final name */}
                                <div className="mb-3">
                                  <Label className="text-xs text-zinc-500 mb-1 block">
                                    {t("cleanup.finalName")}
                                  </Label>
                                  <Input
                                    value={cleanupMergeNames[item.id] ?? metadata.target_name ?? ""}
                                    onChange={(e) => setCleanupMergeNames(prev => ({
                                      ...prev,
                                      [item.id]: e.target.value
                                    }))}
                                    disabled={isLoading}
                                    className="h-8 text-sm"
                                  />
                                </div>

                                {/* Reasoning */}
                                <p className="text-sm text-zinc-500 mb-3">{item.reasoning}</p>

                                {/* Actions */}
                                <div className="flex justify-end gap-2">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-zinc-500 hover:text-red-600"
                                    onClick={() => handleCleanupReject(item)}
                                    disabled={isLoading}
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    ) : (
                                      <X className="h-4 w-4 mr-1" />
                                    )}
                                    {t("cleanup.dismiss")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    className="bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => handleCleanupApprove(item)}
                                    disabled={isLoading}
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    ) : (
                                      <GitMerge className="h-4 w-4 mr-1" />
                                    )}
                                    {t("cleanup.merge")}
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                    </div>
                  </div>
                )}

                {/* Delete requests */}
                {cleanupItems.filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "delete").length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-3 flex items-center gap-2">
                      <Trash2 className="h-4 w-4" />
                      {t("cleanup.deleteRequests")} ({cleanupItems.filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "delete").length})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {cleanupItems
                        .filter(i => (i.metadata as unknown as SchemaCleanupMetadata).cleanup_type === "delete")
                        .map((item) => {
                          const metadata = item.metadata as unknown as SchemaCleanupMetadata;
                          const isLoading = cleanupActionLoading === item.id;
                          const entityIcon = metadata.entity_type === "correspondent" ? User
                            : metadata.entity_type === "document_type" ? FileText
                            : Tag;
                          const EntityIcon = entityIcon;

                          return (
                            <Card key={item.id} className="w-full sm:w-auto">
                              <CardContent className="p-3 flex items-center gap-3">
                                <EntityIcon className="h-4 w-4 text-zinc-500" />
                                <div className="flex-1">
                                  <div className="font-medium text-sm">{metadata.entity_name}</div>
                                  <div className="text-xs text-zinc-500">{t("cleanup.unused")}</div>
                                </div>
                                <div className="flex gap-1">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2"
                                    onClick={() => handleCleanupReject(item)}
                                    disabled={isLoading}
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <X className="h-3 w-3" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 px-2"
                                    onClick={() => handleCleanupApprove(item)}
                                    disabled={isLoading}
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3 w-3" />
                                    )}
                                  </Button>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : /* Blocked Items View */
        showBlocked ? (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Ban className="h-5 w-5" />
              {t("blocked.title")}
            </h2>

            {!blockedItems ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
              </div>
            ) : blockedItems.total === 0 ? (
              <Card className="py-12">
                <CardContent className="flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
                  <h3 className="font-semibold text-lg mb-1">{t("blocked.noItems")}</h3>
                  <p className="text-zinc-500 text-sm">{t("blocked.noItemsDesc")}</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-6">
                {/* Global blocks */}
                {(blockedItems.global_blocks?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-2 flex items-center gap-2">
                      <Globe className="h-4 w-4" />
                      {t("blocked.globalBlocks")} ({blockedItems.global_blocks?.length ?? 0})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {blockedItems.global_blocks?.map((item) => (
                        <Badge
                          key={item.id}
                          variant="destructive"
                          className="text-sm py-1 px-3 gap-2"
                        >
                          {item.suggestion_name}
                          <button
                            onClick={() => handleUnblock(item.id)}
                            disabled={unblockingId === item.id}
                            className="hover:bg-white/20 rounded p-0.5"
                          >
                            {unblockingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Correspondent blocks */}
                {(blockedItems.correspondent_blocks?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-2 flex items-center gap-2">
                      <User className="h-4 w-4" />
                      {t("blocked.correspondentBlocks")} ({blockedItems.correspondent_blocks?.length ?? 0})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {blockedItems.correspondent_blocks?.map((item) => (
                        <Badge
                          key={item.id}
                          variant="outline"
                          className="text-sm py-1 px-3 gap-2 border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-700 dark:bg-orange-950 dark:text-orange-300"
                        >
                          {item.suggestion_name}
                          <button
                            onClick={() => handleUnblock(item.id)}
                            disabled={unblockingId === item.id}
                            className="hover:bg-orange-200 dark:hover:bg-orange-900 rounded p-0.5"
                          >
                            {unblockingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Document type blocks */}
                {(blockedItems.document_type_blocks?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      {t("blocked.documentTypeBlocks")} ({blockedItems.document_type_blocks?.length ?? 0})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {blockedItems.document_type_blocks?.map((item) => (
                        <Badge
                          key={item.id}
                          variant="outline"
                          className="text-sm py-1 px-3 gap-2 border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        >
                          {item.suggestion_name}
                          <button
                            onClick={() => handleUnblock(item.id)}
                            disabled={unblockingId === item.id}
                            className="hover:bg-blue-200 dark:hover:bg-blue-900 rounded p-0.5"
                          >
                            {unblockingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tag blocks */}
                {(blockedItems.tag_blocks?.length ?? 0) > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-zinc-500 mb-2 flex items-center gap-2">
                      <Tag className="h-4 w-4" />
                      {t("blocked.tagBlocks")} ({blockedItems.tag_blocks?.length ?? 0})
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {blockedItems.tag_blocks?.map((item) => (
                        <Badge
                          key={item.id}
                          variant="outline"
                          className="text-sm py-1 px-3 gap-2 border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        >
                          {item.suggestion_name}
                          <button
                            onClick={() => handleUnblock(item.id)}
                            disabled={unblockingId === item.id}
                            className="hover:bg-emerald-200 dark:hover:bg-emerald-900 rounded p-0.5"
                          >
                            {unblockingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Unlock className="h-3 w-3" />
                            )}
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
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
              const selectedValue = selectedValues[item.id] ?? item.suggestion;
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
                    <div className="flex flex-wrap gap-2 mb-2" onClick={(e) => e.stopPropagation()}>
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

                    {/* Editable input field */}
                    <div className="mb-3" onClick={(e) => e.stopPropagation()}>
                      <Input
                        value={selectedValue}
                        onChange={(e) => handleSelectOption(item.id, e.target.value)}
                        disabled={isLoading}
                        placeholder={t("customName")}
                        className="h-8 text-sm"
                      />
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
          </>
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

      {/* Similar Suggestions Modal */}
      <Dialog open={showSimilarModal} onOpenChange={setShowSimilarModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              {t("similar.title")}
            </DialogTitle>
            <DialogDescription>
              {t("similar.description")}
            </DialogDescription>
          </DialogHeader>

          {(similarGroups?.length ?? 0) === 0 ? (
            <div className="py-8 text-center">
              <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto mb-4" />
              <h3 className="font-semibold text-lg mb-1">{t("similar.noSimilar")}</h3>
              <p className="text-zinc-500 text-sm">{t("similar.noSimilarDesc")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-zinc-500">
                {t("similar.found", { count: similarGroups.length })}
              </p>

              {similarGroups.map((group, index) => {
                const isMerging = mergingGroupIndex === index;
                const entityIcon = group.item_type === "correspondent" ? User
                  : group.item_type === "document_type" ? FileText
                  : Tag;
                const EntityIcon = entityIcon;

                return (
                  <Card key={index} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <EntityIcon className="h-4 w-4 text-zinc-500" />
                        <Badge variant="outline" className="text-xs">
                          {group.item_type.replace("_", " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {group.item_ids.length} {t("similar.items")}
                        </Badge>
                      </div>

                      {/* Similar suggestions list */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {group.suggestions.map((suggestion, sIndex) => (
                          <Badge
                            key={sIndex}
                            variant="outline"
                            className="cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800"
                            onClick={() => setSimilarMergeNames(prev => ({
                              ...prev,
                              [index]: suggestion
                            }))}
                          >
                            {suggestion}
                            {suggestion === (similarMergeNames[index] || group.recommended_name) && (
                              <Check className="h-3 w-3 ml-1 text-emerald-500" />
                            )}
                          </Badge>
                        ))}
                      </div>

                      {/* Editable final name */}
                      <div className="mb-3">
                        <Label className="text-xs text-zinc-500 mb-1 block">
                          {t("similar.mergeTo")}
                        </Label>
                        <Input
                          value={similarMergeNames[index] ?? group.recommended_name}
                          onChange={(e) => setSimilarMergeNames(prev => ({
                            ...prev,
                            [index]: e.target.value
                          }))}
                          disabled={isMerging}
                          className="h-8 text-sm"
                        />
                      </div>

                      {/* Actions */}
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-zinc-500"
                          onClick={() => handleDismissSimilar(index)}
                          disabled={isMerging}
                        >
                          <X className="h-4 w-4 mr-1" />
                          {t("similar.dismiss")}
                        </Button>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          onClick={() => handleMergeSimilar(index)}
                          disabled={isMerging}
                        >
                          {isMerging ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <GitMerge className="h-4 w-4 mr-1" />
                          )}
                          {t("similar.merge")}
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSimilarModal(false)}>
              {t("similar.close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
