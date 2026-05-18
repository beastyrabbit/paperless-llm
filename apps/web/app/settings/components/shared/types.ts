/**
 * Shared types for Settings components.
 *
 * API DTOs are defined in @repo/api-contracts; this file only keeps
 * settings-page local UI types/constants.
 */

export type {
  CustomFieldSetting as CustomField,
  CustomFieldsSettingsResponse as CustomFieldsResponse,
  MistralModel,
  OllamaModel,
  OpenAICodexModel,
  Settings,
  WorkflowTagStatus as TagStatus,
  WorkflowTagsStatusResponse as TagsStatusResponse,
} from "@repo/api-contracts";

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export const VALID_TABS = [
  "connections",
  "processing",
  "pipeline",
  "custom-fields",
  "ai-tags",
  "ai-document-types",
  "workflow-tags",
  "language",
  "advanced",
  "maintenance",
] as const;

export type SettingsTab = (typeof VALID_TABS)[number];
