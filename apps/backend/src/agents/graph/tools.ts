/**
 * Read-only tools for LangGraph agents to look up document context.
 * These tools allow agents to search for similar processed documents
 * to inform their decisions.
 */
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { Effect } from 'effect';
import type { PaperlessService } from '../../services/PaperlessService.js';
import type { QdrantService } from '../../services/QdrantService.js';

// ===========================================================================
// Tool Factory Types
// ===========================================================================

export interface ToolDependencies {
  paperless: PaperlessService;
  qdrant: QdrantService;
  processedTagName: string; // Tag name for fully processed documents
}

// ===========================================================================
// Tool Factories
// ===========================================================================

/**
 * Creates a tool to search for semantically similar processed documents.
 */
export const createSearchSimilarDocumentsTool = (deps: ToolDependencies) =>
  tool(
    async ({ query, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        deps.qdrant.searchSimilar(query, {
          limit: Math.min(limit ?? 5, 10),
          filterProcessed: true,
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error searching documents: ${result.error}`;
      }

      if (result.length === 0) {
        return 'No similar processed documents found.';
      }

      return result
        .map(
          (doc, i) =>
            `${i + 1}. [Score: ${doc.score.toFixed(2)}] "${doc.title}" (ID: ${doc.docId})\n   Tags: ${doc.tags.join(', ') || 'none'}\n   Correspondent: ${doc.correspondent || 'none'}\n   Type: ${doc.documentType || 'none'}`
        )
        .join('\n\n');
    },
    {
      name: 'search_similar_documents',
      description:
        'Search for semantically similar documents that have been fully processed. Use this to find examples of how similar documents were tagged, titled, or categorized.',
      schema: z.object({
        query: z.string().describe('The search query - describe what kind of documents you are looking for'),
        limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5, max: 10)'),
      }),
    }
  );

/**
 * Creates a tool to get full details of a specific document.
 */
export const createGetDocumentTool = (deps: ToolDependencies) =>
  tool(
    async ({ docId }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const doc = yield* deps.paperless.getDocument(docId);

          // Only return processed documents for reference
          const tags = yield* deps.paperless.getTags();
          const docTagNames = doc.tags.map((id: number) => tags.find((t) => t.id === id)?.name ?? `unknown-${id}`);

          if (!docTagNames.some((t: string) => t.toLowerCase().includes('processed'))) {
            return { error: 'Document is not fully processed and cannot be used as reference.' };
          }

          const correspondents = yield* deps.paperless.getCorrespondents();
          const correspondent = doc.correspondent
            ? correspondents.find((c) => c.id === doc.correspondent)?.name ?? 'unknown'
            : null;

          const documentTypes = yield* deps.paperless.getDocumentTypes();
          const documentType = doc.document_type
            ? documentTypes.find((dt) => dt.id === doc.document_type)?.name ?? 'unknown'
            : null;

          return {
            id: doc.id,
            title: doc.title,
            content: doc.content?.slice(0, 4000) ?? '',
            tags: docTagNames.filter((t: string) => !t.startsWith('llm-')),
            correspondent,
            documentType,
            created: doc.created,
            added: doc.added,
          };
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      return `Document: "${result.title}" (ID: ${result.id})
Correspondent: ${result.correspondent || 'Not assigned'}
Document Type: ${result.documentType || 'Not assigned'}
Tags: ${result.tags.join(', ') || 'None'}
Created: ${result.created}

Content Preview:
${result.content.slice(0, 2000)}${result.content.length > 2000 ? '...' : ''}`;
    },
    {
      name: 'get_document',
      description:
        'Get full details of a specific processed document by ID. Use this after finding similar documents to see their full content and metadata.',
      schema: z.object({
        docId: z.number().describe('The document ID to retrieve'),
      }),
    }
  );

/**
 * Creates a tool to get documents by tag.
 */
export const createGetDocumentsByTagTool = (deps: ToolDependencies) =>
  tool(
    async ({ tagName, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Get documents by tag (includes the processed tag filter)
          const docs = yield* deps.paperless.getDocumentsByTags(
            [tagName, deps.processedTagName],
            Math.min(limit ?? 5, 10)
          );

          if (docs.length === 0) {
            return { empty: true, tagName };
          }

          const tags = yield* deps.paperless.getTags();

          return docs.map((d) => ({
            id: d.id,
            title: d.title,
            tags: d.tags
              .map((id: number) => tags.find((t) => t.id === id)?.name ?? `unknown-${id}`)
              .filter((t: string) => !t.startsWith('llm-')),
          }));
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if ('empty' in result) {
        return `No processed documents found with tag "${result.tagName}".`;
      }

      return `Documents with tag "${tagName}":\n\n${result
        .map((d: { id: number; title: string; tags: string[] }, i: number) =>
          `${i + 1}. "${d.title}" (ID: ${d.id})\n   Tags: ${d.tags.join(', ')}`
        )
        .join('\n\n')}`;
    },
    {
      name: 'get_documents_by_tag',
      description:
        'Get a list of processed documents that have a specific tag. Use this to see examples of how a particular tag is used.',
      schema: z.object({
        tagName: z.string().describe('The tag name to search for'),
        limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5, max: 10)'),
      }),
    }
  );

/**
 * Creates a tool to get documents by correspondent.
 */
export const createGetDocumentsByCorrespondentTool = (deps: ToolDependencies) =>
  tool(
    async ({ correspondentName, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Get processed documents
          const processedDocs = yield* deps.paperless.getDocumentsByTag(
            deps.processedTagName,
            100 // Get more docs, we'll filter by correspondent
          );

          const correspondents = yield* deps.paperless.getCorrespondents();
          const correspondent = correspondents.find(
            (c) => c.name.toLowerCase() === correspondentName.toLowerCase()
          );

          if (!correspondent) {
            return { error: `Correspondent "${correspondentName}" not found.` };
          }

          // Filter by correspondent
          const filteredDocs = processedDocs
            .filter((d) => d.correspondent === correspondent.id)
            .slice(0, Math.min(limit ?? 5, 10));

          if (filteredDocs.length === 0) {
            return { empty: true, correspondentName };
          }

          const tags = yield* deps.paperless.getTags();

          return filteredDocs.map((d) => ({
            id: d.id,
            title: d.title,
            tags: d.tags
              .map((id: number) => tags.find((t) => t.id === id)?.name ?? `unknown-${id}`)
              .filter((t: string) => !t.startsWith('llm-')),
          }));
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if ('empty' in result) {
        return `No processed documents found for correspondent "${result.correspondentName}".`;
      }

      return `Documents from "${correspondentName}":\n\n${result
        .map((d: { id: number; title: string; tags: string[] }, i: number) =>
          `${i + 1}. "${d.title}" (ID: ${d.id})\n   Tags: ${d.tags.join(', ')}`
        )
        .join('\n\n')}`;
    },
    {
      name: 'get_documents_by_correspondent',
      description:
        'Get a list of processed documents from a specific correspondent. Use this to see the types of documents typically associated with a correspondent.',
      schema: z.object({
        correspondentName: z.string().describe('The correspondent name to search for'),
        limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5, max: 10)'),
      }),
    }
  );

/**
 * Creates a tool to get documents by document type.
 */
export const createGetDocumentsByTypeTool = (deps: ToolDependencies) =>
  tool(
    async ({ documentType, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const documentTypes = yield* deps.paperless.getDocumentTypes();
          const docType = documentTypes.find(
            (dt) => dt.name.toLowerCase() === documentType.toLowerCase()
          );

          if (!docType) {
            return { error: `Document type "${documentType}" not found.` };
          }

          // Get processed documents
          const processedDocs = yield* deps.paperless.getDocumentsByTag(
            deps.processedTagName,
            100 // Get more docs, we'll filter by type
          );

          // Filter by document type
          const filteredDocs = processedDocs
            .filter((d) => d.document_type === docType.id)
            .slice(0, Math.min(limit ?? 5, 10));

          if (filteredDocs.length === 0) {
            return { empty: true, documentType };
          }

          const tags = yield* deps.paperless.getTags();
          const correspondents = yield* deps.paperless.getCorrespondents();

          return filteredDocs.map((d) => ({
            id: d.id,
            title: d.title,
            correspondent: d.correspondent
              ? correspondents.find((c) => c.id === d.correspondent)?.name ?? 'unknown'
              : null,
            tags: d.tags
              .map((id: number) => tags.find((t) => t.id === id)?.name ?? `unknown-${id}`)
              .filter((t: string) => !t.startsWith('llm-')),
          }));
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if ('empty' in result) {
        return `No processed documents found of type "${result.documentType}".`;
      }

      return `Documents of type "${documentType}":\n\n${result
        .map(
          (d: { id: number; title: string; correspondent: string | null; tags: string[] }, i: number) =>
            `${i + 1}. "${d.title}" (ID: ${d.id})\n   Correspondent: ${d.correspondent || 'none'}\n   Tags: ${d.tags.join(', ')}`
        )
        .join('\n\n')}`;
    },
    {
      name: 'get_documents_by_type',
      description:
        'Get a list of processed documents of a specific document type. Use this to see examples and patterns for that document type.',
      schema: z.object({
        documentType: z.string().describe('The document type name to search for'),
        limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5, max: 10)'),
      }),
    }
  );

/**
 * Creates a tool to get documents that have a specific custom field filled.
 */
export const createGetDocumentsByCustomFieldTool = (deps: ToolDependencies) =>
  tool(
    async ({ fieldName, fieldValue, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Get custom fields to find the field ID
          const customFields = yield* deps.paperless.getCustomFields();
          const field = customFields.find(
            (f) => f.name.toLowerCase() === fieldName.toLowerCase()
          );

          if (!field) {
            // Return list of available fields for reference
            const availableFields = customFields.map((f) => `- ${f.name} (${f.data_type})`).join('\n');
            return {
              error: `Custom field "${fieldName}" not found. Available fields:\n${availableFields}`,
            };
          }

          // Get processed documents
          const processedDocs = yield* deps.paperless.getDocumentsByTag(
            deps.processedTagName,
            100 // Get more docs, we'll filter by custom field
          );

          // Filter documents that have this custom field set
          const docsWithField = processedDocs.filter((doc) => {
            const customFieldValues = (doc.custom_fields ?? []) as Array<{ field: number; value: unknown }>;
            const fieldEntry = customFieldValues.find((cf) => cf.field === field.id);

            if (!fieldEntry || fieldEntry.value === null || fieldEntry.value === undefined) {
              return false;
            }

            // If a specific value is requested, filter by it
            if (fieldValue !== undefined && fieldValue !== null) {
              const valueStr = String(fieldEntry.value).toLowerCase();
              const searchStr = String(fieldValue).toLowerCase();
              return valueStr.includes(searchStr);
            }

            return true;
          });

          const limitedDocs = docsWithField.slice(0, Math.min(limit ?? 5, 10));

          if (limitedDocs.length === 0) {
            const searchDesc = fieldValue ? ` with value containing "${fieldValue}"` : '';
            return { empty: true, fieldName, searchDesc };
          }

          const tags = yield* deps.paperless.getTags();
          const documentTypes = yield* deps.paperless.getDocumentTypes();

          return limitedDocs.map((doc) => {
            const customFieldValues = (doc.custom_fields ?? []) as Array<{ field: number; value: unknown }>;
            const fieldEntry = customFieldValues.find((cf) => cf.field === field.id);

            return {
              id: doc.id,
              title: doc.title,
              documentType: doc.document_type
                ? documentTypes.find((dt) => dt.id === doc.document_type)?.name ?? 'unknown'
                : null,
              fieldValue: fieldEntry?.value,
              tags: doc.tags
                .map((id: number) => tags.find((t) => t.id === id)?.name ?? `unknown-${id}`)
                .filter((t: string) => !t.startsWith('llm-')),
            };
          });
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if ('empty' in result) {
        return `No processed documents found with custom field "${result.fieldName}"${result.searchDesc}.`;
      }

      const valueLabel = fieldValue ? ` (filtered by "${fieldValue}")` : '';
      return `Documents with custom field "${fieldName}"${valueLabel}:\n\n${result
        .map(
          (d: { id: number; title: string; documentType: string | null; fieldValue: unknown; tags: string[] }, i: number) =>
            `${i + 1}. "${d.title}" (ID: ${d.id})\n   ${fieldName}: ${JSON.stringify(d.fieldValue)}\n   Type: ${d.documentType || 'none'}\n   Tags: ${d.tags.join(', ')}`
        )
        .join('\n\n')}`;
    },
    {
      name: 'get_documents_by_custom_field',
      description:
        'Get a list of processed documents that have a specific custom field filled. Use this to see examples of how a particular custom field is typically filled and what values are common for different document types.',
      schema: z.object({
        fieldName: z.string().describe('The custom field name to search for'),
        fieldValue: z.string().optional().describe('Optional: Filter by documents containing this value in the field'),
        limit: z.number().min(1).max(10).optional().describe('Maximum number of results (default: 5, max: 10)'),
      }),
    }
  );

/**
 * Creates a tool to list all available custom fields with their types.
 */
export const createListCustomFieldsTool = (deps: ToolDependencies) =>
  tool(
    async (): Promise<string> => {
      const result = await Effect.runPromise(
        deps.paperless.getCustomFields()
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if (result.length === 0) {
        return 'No custom fields are defined in the system.';
      }

      return `Available custom fields:\n\n${result
        .map((f, i) => `${i + 1}. ${f.name} (ID: ${f.id})\n   Type: ${f.data_type}`)
        .join('\n\n')}`;
    },
    {
      name: 'list_custom_fields',
      description:
        'List all custom fields defined in the system with their data types. Use this to understand what fields are available before extracting values.',
      schema: z.object({}),
    }
  );

/**
 * Creates all tools for an agent.
 */
export const createAgentTools = (deps: ToolDependencies) => [
  createSearchSimilarDocumentsTool(deps),
  createGetDocumentTool(deps),
  createGetDocumentsByTagTool(deps),
  createGetDocumentsByCorrespondentTool(deps),
  createGetDocumentsByTypeTool(deps),
  createGetDocumentsByCustomFieldTool(deps),
  createListCustomFieldsTool(deps),
];
