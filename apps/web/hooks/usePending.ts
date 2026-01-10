"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

export const sections = [
  { key: "correspondent", labelKey: "correspondents" },
  { key: "document_type", labelKey: "documentTypes" },
  { key: "tag", labelKey: "tags" },
] as const;

export type SectionKey = (typeof sections)[number]["key"];

export function usePending() {
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
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
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

  // Similar suggestions state
  const [similarGroups, setSimilarGroups] = useState<SimilarGroup[]>([]);
  const [showSimilarModal, setShowSimilarModal] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [mergingGroupIndex, setMergingGroupIndex] = useState<number | null>(null);
  const [similarMergeNames, setSimilarMergeNames] = useState<Record<number, string>>({});

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError(null);
    try {
      const [countsResponse, itemsResponse] = await Promise.all([
        pendingApi.getCounts(),
        pendingApi.list(),
      ]);

      if (countsResponse.error) { setError(countsResponse.error); return; }
      if (itemsResponse.error) { setError(itemsResponse.error); return; }

      setCounts(countsResponse.data!);
      setItems(itemsResponse.data!);

      setSelectedValues((prev) => {
        const updated = { ...prev };
        for (const item of itemsResponse.data!) {
          if (!(item.id in updated)) updated[item.id] = item.suggestion;
        }
        return updated;
      });
    } catch (err) {
      setError(String(err));
    } finally {
      if (showLoading) setLoading(false);
      isInitialLoad.current = false;
    }
  }, []);

  const loadEntities = useCallback(async () => {
    try {
      const response = await pendingApi.searchEntities();
      if (!response.error && response.data) setExistingEntities(response.data);
    } catch { /* Silently fail */ }
  }, []);

  const loadBlockedItems = useCallback(async () => {
    try {
      const response = await pendingApi.getBlocked();
      if (!response.error && response.data) setBlockedItems(response.data);
    } catch { /* Silently fail */ }
  }, []);

  const handleUnblock = async (blockId: number) => {
    setUnblockingId(blockId);
    try {
      const response = await pendingApi.unblock(blockId);
      if (!response.error) await loadBlockedItems();
    } finally {
      setUnblockingId(null);
    }
  };

  useEffect(() => {
    loadData(true);
    loadEntities();
  }, [loadData, loadEntities]);

  useEffect(() => {
    if (showBlocked) loadBlockedItems();
  }, [showBlocked, loadBlockedItems]);

  useEffect(() => {
    const interval = setInterval(() => loadData(false), 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Computed values
  const getCount = (type: SectionKey) => {
    const schemaKey = `schema_${type}` as keyof typeof counts;
    return counts[type] + ((counts[schemaKey] as number) || 0);
  };

  const totalCount = sections.reduce((sum, s) => sum + getCount(s.key), 0);
  const cleanupItems = useMemo(() => items.filter((item) => item.type === "schema_cleanup"), [items]);
  const cleanupCount = counts.schema_cleanup || 0;

  const cleanupItemIds = useMemo(() => cleanupItems.map((item) => item.id).join(","), [cleanupItems]);

  useEffect(() => {
    if (cleanupItems.length === 0) return;
    setCleanupMergeNames((prev) => {
      let hasChanges = false;
      const updated = { ...prev };
      for (const item of cleanupItems) {
        if (!(item.id in updated)) {
          hasChanges = true;
          const metadata = item.metadata as unknown as SchemaCleanupMetadata;
          updated[item.id] = metadata.cleanup_type === "merge" ? (metadata.target_name || "") : (metadata.entity_name || "");
        }
      }
      return hasChanges ? updated : prev;
    });
  }, [cleanupItemIds, cleanupItems]);

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
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setCounts((prev) => ({ ...prev, schema_cleanup: Math.max(0, (prev.schema_cleanup || 0) - 1) }));
      }
    } finally {
      setCleanupActionLoading(null);
    }
  };

  const handleCleanupReject = async (item: PendingItem) => {
    setCleanupActionLoading(item.id);
    setError(null);
    try {
      const response = await pendingApi.reject(item.id);
      if (response.error) {
        setError(response.error);
      } else {
        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setCounts((prev) => ({ ...prev, schema_cleanup: Math.max(0, (prev.schema_cleanup || 0) - 1) }));
      }
    } finally {
      setCleanupActionLoading(null);
    }
  };

  const handleFindSimilar = async () => {
    setSimilarLoading(true);
    setError(null);
    try {
      const response = await pendingApi.findSimilar(0.6);
      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        setSimilarGroups(response.data.groups);
        const names: Record<number, string> = {};
        response.data.groups.forEach((group, index) => { names[index] = group.recommended_name; });
        setSimilarMergeNames(names);
        setShowSimilarModal(true);
      }
    } finally {
      setSimilarLoading(false);
    }
  };

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
        setSimilarGroups((prev) => prev.filter((_, i) => i !== groupIndex));
        await loadData(false);
      }
    } finally {
      setMergingGroupIndex(null);
    }
  };

  const handleDismissSimilar = (groupIndex: number) => {
    setSimilarGroups((prev) => prev.filter((_, i) => i !== groupIndex));
  };

  const getFilteredExistingEntities = () => {
    if (!existingEntities || !searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    let entities: string[] = [];
    switch (activeSection) {
      case "correspondent": entities = existingEntities.correspondents; break;
      case "document_type": entities = existingEntities.document_types; break;
      case "tag": entities = existingEntities.tags; break;
    }
    return entities.filter((name) => name.toLowerCase().includes(query)).slice(0, 10);
  };

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

  const resetRejectForm = () => {
    setRejectingItem(null);
    setBlockType("none");
    setRejectionCategory(null);
    setRejectionReason("");
  };

  const openRejectModal = (item: PendingItem) => {
    setRejectingItem(item);
    setRejectModalOpen(true);
  };

  const handleReject = async () => {
    if (!rejectingItem) return;
    setActionLoading(rejectingItem.id);
    try {
      const response = blockType === "none"
        ? await pendingApi.reject(rejectingItem.id)
        : await pendingApi.rejectWithFeedback(rejectingItem.id, {
            block_type: blockType,
            rejection_category: rejectionCategory || undefined,
            rejection_reason: rejectionReason || undefined,
          });

      if (response.error) {
        setError(response.error);
      } else {
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

  const toggleSelectItem = (id: string) => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const currentIds = new Set(filteredItems.map((item) => item.id));
    const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selectedItems.has(item.id));
    if (allSelected) {
      setSelectedItems((prev) => {
        const next = new Set(prev);
        currentIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedItems((prev) => new Set([...prev, ...currentIds]));
    }
  };

  const handleBulkApprove = async () => {
    const idsToApprove = filteredItems.filter((item) => selectedItems.has(item.id)).map((item) => item.id);
    if (idsToApprove.length === 0) return;
    setBulkLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        idsToApprove.map((id) => pendingApi.approve(id, selectedValues[id]))
      );

      const succeeded = idsToApprove.filter((_, i) => results[i].status === "fulfilled");
      const failed = idsToApprove.filter((_, i) => results[i].status === "rejected");

      // Only remove successfully approved items
      if (succeeded.length > 0) {
        setItems((prev) => prev.filter((item) => !succeeded.includes(item.id)));
        setSelectedItems((prev) => {
          const next = new Set(prev);
          succeeded.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (failed.length > 0) {
        setError(`Failed to approve ${failed.length} of ${idsToApprove.length} items`);
      }

      await loadData(false);
    } finally {
      setBulkLoading(false);
    }
  };

  const openBulkRejectModal = () => {
    setBulkRejectModalOpen(true);
  };

  const resetBulkRejectForm = () => {
    setBulkBlockType("none");
    setBulkRejectionCategory(null);
    setBulkRejectionReason("");
  };

  const handleBulkReject = async () => {
    const idsToReject = filteredItems.filter((item) => selectedItems.has(item.id)).map((item) => item.id);
    if (idsToReject.length === 0) return;
    setBulkLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled(
        idsToReject.map((id) => {
          if (bulkBlockType === "none") {
            return pendingApi.reject(id);
          } else {
            return pendingApi.rejectWithFeedback(id, {
              block_type: bulkBlockType,
              rejection_category: bulkRejectionCategory || undefined,
              rejection_reason: bulkRejectionReason || undefined,
            });
          }
        })
      );

      const succeeded = idsToReject.filter((_, i) => results[i].status === "fulfilled");
      const failed = idsToReject.filter((_, i) => results[i].status === "rejected");

      // Only remove successfully rejected items
      if (succeeded.length > 0) {
        setItems((prev) => prev.filter((item) => !succeeded.includes(item.id)));
        setSelectedItems((prev) => {
          const next = new Set(prev);
          succeeded.forEach((id) => next.delete(id));
          return next;
        });
      }

      if (failed.length > 0) {
        setError(`Failed to reject ${failed.length} of ${idsToReject.length} items`);
      }

      setBulkRejectModalOpen(false);
      resetBulkRejectForm();
      await loadData(false);
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleReasoning = (id: string) => {
    setExpandedReasoning((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return {
    // Core state
    items, counts, loading, error, setError,
    // Section
    activeSection, setActiveSection, filteredItems, totalCount,
    // Selection
    selectedItems, selectedValues, toggleSelectItem, toggleSelectAll, handleSelectOption,
    expandedReasoning, toggleReasoning,
    // Actions
    actionLoading, handleApprove, handleReject,
    // Rejection modal
    rejectModalOpen, setRejectModalOpen, rejectingItem, openRejectModal, resetRejectForm,
    blockType, setBlockType, rejectionCategory, setRejectionCategory, rejectionReason, setRejectionReason,
    // Bulk actions
    bulkLoading, handleBulkApprove, openBulkRejectModal, handleBulkReject,
    bulkRejectModalOpen, setBulkRejectModalOpen, resetBulkRejectForm,
    bulkBlockType, setBulkBlockType, bulkRejectionCategory, setBulkRejectionCategory,
    bulkRejectionReason, setBulkRejectionReason,
    // Blocked items
    showBlocked, setShowBlocked, blockedItems, unblockingId, handleUnblock,
    // Search
    searchQuery, setSearchQuery, searchResults: getFilteredExistingEntities(),
    // Cleanup
    showCleanup, setShowCleanup, cleanupItems, cleanupCount, cleanupMergeNames, setCleanupMergeNames,
    cleanupActionLoading, handleCleanupApprove, handleCleanupReject,
    // Similar suggestions
    similarGroups, showSimilarModal, setShowSimilarModal, similarLoading, mergingGroupIndex,
    similarMergeNames, setSimilarMergeNames, handleFindSimilar, handleMergeSimilar, handleDismissSimilar,
    // Utilities
    getCount, loadData, sections,
  };
}

export type UsePendingReturn = ReturnType<typeof usePending>;
