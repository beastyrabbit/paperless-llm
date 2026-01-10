/**
 * Schema API endpoints (Blocked Suggestions)
 */
import { fetchApi } from "./client";
import type { BlockedSuggestion, BlockSuggestionRequest } from "./types";

export const schemaApi = {
  getBlocked: (blockType?: string) =>
    fetchApi<BlockedSuggestion[]>(
      `/api/schema/blocked${blockType ? `?block_type=${blockType}` : ""}`
    ),

  block: (request: BlockSuggestionRequest) =>
    fetchApi<BlockedSuggestion>("/api/schema/blocked", {
      method: "POST",
      body: JSON.stringify(request),
    }),

  unblock: (id: number) =>
    fetchApi<void>(`/api/schema/blocked/${id}`, {
      method: "DELETE",
    }),

  checkBlocked: (name: string, blockType: string) =>
    fetchApi<{ is_blocked: boolean }>(
      `/api/schema/blocked/check?name=${encodeURIComponent(name)}&block_type=${blockType}`
    ),
};
