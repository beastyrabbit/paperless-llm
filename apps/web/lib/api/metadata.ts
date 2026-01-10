/**
 * Metadata API endpoints
 */
import { fetchApi } from "./client";
import type {
  TagMetadata,
  TagMetadataUpdate,
  TagMetadataBulk,
  CustomFieldMetadata,
  CustomFieldMetadataUpdate,
  CustomFieldMetadataBulk,
} from "./types";

export const metadataApi = {
  // Tags
  listTags: () => fetchApi<TagMetadata[]>("/api/metadata/tags"),

  getTag: (tagId: number) => fetchApi<TagMetadata>(`/api/metadata/tags/${tagId}`),

  updateTag: (tagId: number, data: TagMetadataUpdate) =>
    fetchApi<TagMetadata>(`/api/metadata/tags/${tagId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteTag: (tagId: number) =>
    fetchApi<{ deleted: boolean }>(`/api/metadata/tags/${tagId}`, {
      method: "DELETE",
    }),

  bulkUpdateTags: (items: TagMetadataBulk[]) =>
    fetchApi<TagMetadata[]>("/api/metadata/tags/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),

  // Custom Fields
  listCustomFields: () =>
    fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields"),

  getCustomField: (fieldId: number) =>
    fetchApi<CustomFieldMetadata>(`/api/metadata/custom-fields/${fieldId}`),

  updateCustomField: (fieldId: number, data: CustomFieldMetadataUpdate) =>
    fetchApi<CustomFieldMetadata>(`/api/metadata/custom-fields/${fieldId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  deleteCustomField: (fieldId: number) =>
    fetchApi<{ deleted: boolean }>(`/api/metadata/custom-fields/${fieldId}`, {
      method: "DELETE",
    }),

  bulkUpdateCustomFields: (items: CustomFieldMetadataBulk[]) =>
    fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),
};
