/**
 * Pending Reviews API endpoints
 */
import { fetchApi } from "./client";
import type {
  PendingItem,
  PendingItemType,
  PendingCounts,
  PendingApproveResponse,
  SearchableEntities,
  BlockedItemsResponse,
  SchemaCleanupApproveResponse,
  SimilarGroupsResponse,
  MergePendingResponse,
  RejectWithFeedbackRequest,
  RejectWithFeedbackResponse,
} from "./types";

export const pendingApi = {
  list: (type?: PendingItemType) =>
    fetchApi<PendingItem[]>(`/api/pending${type ? `?type=${type}` : ""}`),

  getCounts: () => fetchApi<PendingCounts>("/api/pending/counts"),

  approve: (itemId: string, selectedValue?: string) =>
    fetchApi<PendingApproveResponse>(`/api/pending/${itemId}/approve`, {
      method: "POST",
      body: JSON.stringify({ selected_value: selectedValue }),
    }),

  reject: (itemId: string) =>
    fetchApi<{ success: boolean }>(`/api/pending/${itemId}/reject`, {
      method: "POST",
    }),

  rejectWithFeedback: (reviewId: string, request: RejectWithFeedbackRequest) =>
    fetchApi<RejectWithFeedbackResponse>(
      `/api/pending/${reviewId}/reject-with-feedback`,
      {
        method: "POST",
        body: JSON.stringify(request),
      }
    ),

  searchEntities: () => fetchApi<SearchableEntities>("/api/pending/search-entities"),

  getBlocked: () => fetchApi<BlockedItemsResponse>("/api/pending/blocked"),

  unblock: (blockId: number) =>
    fetchApi<{ success: boolean; unblocked_id: number }>(
      `/api/pending/blocked/${blockId}`,
      {
        method: "DELETE",
      }
    ),

  approveCleanup: (itemId: string, finalName?: string) =>
    fetchApi<SchemaCleanupApproveResponse>(
      `/api/pending/${itemId}/approve-cleanup`,
      {
        method: "POST",
        body: JSON.stringify({ final_name: finalName }),
      }
    ),

  // Pending cleanup (merge similar suggestions)
  findSimilar: (threshold?: number) =>
    fetchApi<SimilarGroupsResponse>(
      `/api/pending/similar${threshold ? `?threshold=${threshold}` : ""}`
    ),

  mergeSuggestions: (itemIds: string[], finalName: string) =>
    fetchApi<MergePendingResponse>("/api/pending/merge", {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds, final_name: finalName }),
    }),
};
