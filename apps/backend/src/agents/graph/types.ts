/**
 * Shared types for LangGraph-based agents.
 */
import { z } from 'zod';

// ===========================================================================
// State Types
// ===========================================================================

/**
 * Base state shared across all agent graphs.
 */
export interface BaseAgentState {
  /** Document being processed */
  docId: number;
  docTitle: string;
  content: string;

  /** Loop control */
  attempt: number;
  maxRetries: number;
  feedback: string | null;

  /** Outcome */
  confirmed: boolean;
  needsReview: boolean;
  error: string | null;

  /** Memory for graph execution context */
  memory: Record<string, unknown>;
}

// ===========================================================================
// Structured Output Schemas - Zod v4
// ===========================================================================

/**
 * Title analysis result schema.
 */
export const TitleAnalysisSchema = z.object({
  suggested_title: z.string().describe('The suggested document title'),
  reasoning: z.string().describe('Explanation for why this title is appropriate'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  based_on_similar: z.array(z.string()).describe('Similar document titles that influenced the suggestion'),
});

export type TitleAnalysis = z.infer<typeof TitleAnalysisSchema>;

/**
 * Tag suggestion schema.
 */
export const TagSuggestionSchema = z.object({
  name: z.string().describe('The tag name'),
  is_new: z.boolean().describe('Whether this tag needs to be created'),
  existing_tag_id: z.number().optional().describe('ID of existing tag if not new'),
  relevance: z.string().describe('Why this tag applies to the document'),
});

export const TagRemovalSchema = z.object({
  tag_name: z.string().describe('Name of the tag to remove'),
  reason: z.string().describe('Justification for removing this tag'),
});

export const TagsAnalysisSchema = z.object({
  suggested_tags: z.array(TagSuggestionSchema).describe('List of tag suggestions'),
  tags_to_remove: z.array(TagRemovalSchema).describe('Tags to remove from the document'),
  reasoning: z.string().describe('Overall reasoning for tag selection'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
});

export type TagsAnalysis = z.infer<typeof TagsAnalysisSchema>;

/**
 * Correspondent analysis result schema.
 */
export const CorrespondentAnalysisSchema = z.object({
  suggested_correspondent: z.string().nullable().describe('Suggested correspondent name, or null if none applies'),
  is_new: z.boolean().describe('Whether this correspondent needs to be created'),
  existing_correspondent_id: z.number().optional().describe('ID of existing correspondent if not new'),
  reasoning: z.string().describe('Explanation for the correspondent selection'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  alternatives: z.array(z.string()).describe('Alternative correspondent options'),
});

export type CorrespondentAnalysis = z.infer<typeof CorrespondentAnalysisSchema>;

/**
 * Document type analysis result schema.
 */
export const DocumentTypeAnalysisSchema = z.object({
  suggested_document_type: z.string().nullable().describe('Suggested document type, or null if none applies'),
  is_new: z.boolean().describe('Whether this document type needs to be created'),
  existing_type_id: z.number().optional().describe('ID of existing document type if not new'),
  reasoning: z.string().describe('Explanation for the document type selection'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  alternatives: z.array(z.string()).describe('Alternative document type options'),
});

export type DocumentTypeAnalysis = z.infer<typeof DocumentTypeAnalysisSchema>;

/**
 * Confirmation result schema (used by small model).
 */
export const ConfirmationResultSchema = z.object({
  confirmed: z.boolean().describe('Whether the suggestion is approved'),
  feedback: z.string().optional().describe('Feedback explaining the decision'),
  suggested_changes: z.string().optional().describe('Specific changes suggested if rejected'),
});

export type ConfirmationResult = z.infer<typeof ConfirmationResultSchema>;

// ===========================================================================
// Agent Type Definitions
// ===========================================================================

export type AgentType = 'title' | 'tags' | 'correspondent' | 'document_type';

export type AnalysisSchema =
  | typeof TitleAnalysisSchema
  | typeof TagsAnalysisSchema
  | typeof CorrespondentAnalysisSchema
  | typeof DocumentTypeAnalysisSchema;

export type AnalysisResult =
  | TitleAnalysis
  | TagsAnalysis
  | CorrespondentAnalysis
  | DocumentTypeAnalysis;

// ===========================================================================
// Schema Analysis Schemas
// ===========================================================================

/**
 * Entity type for schema suggestions.
 */
export const EntityTypeSchema = z.enum(['correspondent', 'document_type', 'tag']);

export type EntityType = z.infer<typeof EntityTypeSchema>;

/**
 * A single schema suggestion.
 */
export const SchemaSuggestionSchema = z.object({
  entity_type: EntityTypeSchema.describe('Type of entity being suggested'),
  suggested_name: z.string().describe('The suggested entity name'),
  reasoning: z.string().describe('Why this entity should be added'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  similar_to_existing: z.array(z.string()).describe('Names of similar existing entities'),
});

export type SchemaSuggestion = z.infer<typeof SchemaSuggestionSchema>;

/**
 * A match to a pending suggestion.
 */
export const PendingMatchSchema = z.object({
  entity_type: EntityTypeSchema.describe('Type of entity matched'),
  matched_name: z.string().describe('Name of the pending suggestion that was matched'),
});

export type PendingMatch = z.infer<typeof PendingMatchSchema>;

/**
 * Complete schema analysis result.
 */
export const SchemaAnalysisResultSchema = z.object({
  suggestions: z.array(SchemaSuggestionSchema).describe('New entity suggestions'),
  matches_pending: z.array(PendingMatchSchema).describe('Matches to pending suggestions'),
  reasoning: z.string().describe('Overall analysis reasoning'),
  no_suggestions_reason: z.string().optional().describe('Reason if no suggestions were made'),
});

export type SchemaAnalysisOutput = z.infer<typeof SchemaAnalysisResultSchema>;

// ===========================================================================
// Custom Fields Schemas
// ===========================================================================

/**
 * A single field value suggestion.
 */
export const FieldValueSchema = z.object({
  field_id: z.number().describe('ID of the custom field'),
  field_name: z.string().describe('Name of the custom field'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
  ]).describe('Extracted value for the field'),
  reasoning: z.string().describe('Why this value was extracted'),
});

export type FieldValueOutput = z.infer<typeof FieldValueSchema>;

/**
 * Complete custom fields analysis result.
 */
export const CustomFieldsAnalysisSchema = z.object({
  suggested_fields: z.array(FieldValueSchema).describe('List of field value suggestions'),
  reasoning: z.string().describe('Overall reasoning for field extraction'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
});

export type CustomFieldsAnalysisOutput = z.infer<typeof CustomFieldsAnalysisSchema>;

// ===========================================================================
// Document Link Schemas
// ===========================================================================

/**
 * Type of reference that triggered the link suggestion.
 */
export const ReferenceTypeSchema = z.enum(['explicit', 'semantic', 'shared_context']);

export type ReferenceType = z.infer<typeof ReferenceTypeSchema>;

/**
 * A single document link suggestion.
 */
export const DocumentLinkSuggestionSchema = z.object({
  target_doc_id: z.number().describe('ID of the document to link to'),
  target_doc_title: z.string().describe('Title of the target document for reference'),
  confidence: z.number().min(0).max(1).describe('Confidence score from 0 to 1'),
  reasoning: z.string().describe('Why this document should be linked'),
  reference_type: ReferenceTypeSchema.describe('Type of reference: explicit (e.g., "See Invoice #456"), semantic (similar content), or shared_context (same correspondent/date)'),
  reference_text: z.string().nullable().describe('The text that triggered this suggestion, if any'),
});

export type DocumentLinkSuggestionOutput = z.infer<typeof DocumentLinkSuggestionSchema>;

/**
 * Complete document links analysis result.
 */
export const DocumentLinksAnalysisSchema = z.object({
  suggested_links: z.array(DocumentLinkSuggestionSchema).describe('List of document link suggestions'),
  reasoning: z.string().describe('Overall reasoning for link suggestions'),
  high_confidence_links: z.array(z.number()).describe('IDs of links that can be auto-applied (confidence > 0.8, explicit references)'),
  low_confidence_links: z.array(z.number()).describe('IDs of links that need manual review'),
});

export type DocumentLinksAnalysisOutput = z.infer<typeof DocumentLinksAnalysisSchema>;
