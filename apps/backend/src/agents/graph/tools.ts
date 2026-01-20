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
      ).catch(() => ({ error: true as const }));

      if ('error' in result) {
        // Return a clear, actionable message instead of raw error details
        return 'Semantic search is currently unavailable. Please proceed with your analysis based on the document content alone.';
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

          // Use exact match against configured processed tag name
          if (!docTagNames.includes(deps.processedTagName)) {
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

// ===========================================================================
// Document Link Tools (for DocumentLinksAgentGraph)
// ===========================================================================

/**
 * Creates a tool to search for documents by reference (title, ASN, or reference text).
 * This is useful for finding documents explicitly mentioned in text.
 */
export const createSearchDocumentByReferenceTool = (deps: ToolDependencies) =>
  tool(
    async ({ searchTerm, searchType }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Get processed documents
          const docs = yield* deps.paperless.getDocumentsByTag(deps.processedTagName, 500);

          let matches: Array<{ id: number; title: string; asn: number | null; score: number }> = [];

          if (searchType === 'asn') {
            // Search by Archive Serial Number
            const asnNumber = parseInt(searchTerm, 10);
            if (!isNaN(asnNumber)) {
              matches = docs
                .filter((d) => d.archive_serial_number === asnNumber)
                .map((d) => ({
                  id: d.id,
                  title: d.title,
                  asn: d.archive_serial_number,
                  score: 1.0,
                }));
            }
          } else if (searchType === 'title_exact') {
            // Exact title match (case-insensitive)
            const searchLower = searchTerm.toLowerCase();
            matches = docs
              .filter((d) => d.title.toLowerCase() === searchLower)
              .map((d) => ({
                id: d.id,
                title: d.title,
                asn: d.archive_serial_number,
                score: 1.0,
              }));
          } else {
            // Fuzzy title search
            const searchLower = searchTerm.toLowerCase();
            matches = docs
              .filter((d) => d.title.toLowerCase().includes(searchLower))
              .map((d) => {
                const titleLower = d.title.toLowerCase();
                // Score based on how much of the title is the search term
                const score = searchLower.length / titleLower.length;
                return {
                  id: d.id,
                  title: d.title,
                  asn: d.archive_serial_number,
                  score,
                };
              })
              .sort((a, b) => b.score - a.score)
              .slice(0, 10);
          }

          return matches;
        })
      ).catch((e) => ({ error: String(e) }));

      if ('error' in result) {
        return `Error: ${result.error}`;
      }

      if (result.length === 0) {
        return `No documents found matching "${searchTerm}" (search type: ${searchType})`;
      }

      return `Found ${result.length} document(s) matching "${searchTerm}":\n\n${result
        .map(
          (d, i) =>
            `${i + 1}. "${d.title}" (ID: ${d.id}${d.asn ? `, ASN: ${d.asn}` : ''}) [Match score: ${(d.score * 100).toFixed(0)}%]`
        )
        .join('\n')}`;
    },
    {
      name: 'search_document_by_reference',
      description:
        'Search for documents by title, ASN (Archive Serial Number), or reference text. Use this when a document explicitly mentions another document by name or number.',
      schema: z.object({
        searchTerm: z.string().describe('The search term - document title, ASN number, or reference text'),
        searchType: z
          .enum(['title', 'title_exact', 'asn'])
          .describe('Type of search: "title" for fuzzy title match, "title_exact" for exact match, "asn" for Archive Serial Number'),
      }),
    }
  );

/**
 * Creates a tool to find related documents by correspondent and/or date range.
 * This is useful for finding documents that share context with the current document.
 */
export const createFindRelatedDocumentsTool = (deps: ToolDependencies) =>
  tool(
    async ({ correspondentName, dateFrom, dateTo, limit }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          // Get processed documents
          const docs = yield* deps.paperless.getDocumentsByTag(deps.processedTagName, 500);
          const correspondents = yield* deps.paperless.getCorrespondents();
          const tags = yield* deps.paperless.getTags();

          // Find correspondent ID if specified
          let correspondentId: number | null = null;
          if (correspondentName) {
            const correspondent = correspondents.find(
              (c) => c.name.toLowerCase() === correspondentName.toLowerCase()
            );
            if (!correspondent) {
              return { error: `Correspondent "${correspondentName}" not found.` };
            }
            correspondentId = correspondent.id;
          }

          // Parse and validate dates
          const parsedFromDate = dateFrom ? new Date(dateFrom) : null;
          const parsedToDate = dateTo ? new Date(dateTo) : null;
          const fromDate = parsedFromDate && !isNaN(parsedFromDate.getTime()) ? parsedFromDate : null;
          const toDate = parsedToDate && !isNaN(parsedToDate.getTime()) ? parsedToDate : null;

          // Filter documents
          let filteredDocs = docs;

          if (correspondentId !== null) {
            filteredDocs = filteredDocs.filter((d) => d.correspondent === correspondentId);
          }

          if (fromDate || toDate) {
            filteredDocs = filteredDocs.filter((d) => {
              const docDate = new Date(d.created);
              if (isNaN(docDate.getTime())) return true; // Keep docs with invalid dates
              if (fromDate && docDate < fromDate) return false;
              if (toDate && docDate > toDate) return false;
              return true;
            });
          }

          // Limit results
          const limitedDocs = filteredDocs.slice(0, Math.min(limit ?? 10, 20));

          if (limitedDocs.length === 0) {
            return { empty: true, correspondentName, dateFrom, dateTo };
          }

          return limitedDocs.map((d) => ({
            id: d.id,
            title: d.title,
            asn: d.archive_serial_number,
            created: d.created,
            correspondent: d.correspondent
              ? correspondents.find((c) => c.id === d.correspondent)?.name
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
        const filters: string[] = [];
        if (result.correspondentName) filters.push(`correspondent: ${result.correspondentName}`);
        if (result.dateFrom) filters.push(`from: ${result.dateFrom}`);
        if (result.dateTo) filters.push(`to: ${result.dateTo}`);
        return `No related documents found (${filters.join(', ')})`;
      }

      const filters: string[] = [];
      if (correspondentName) filters.push(`correspondent: ${correspondentName}`);
      if (dateFrom) filters.push(`from: ${dateFrom}`);
      if (dateTo) filters.push(`to: ${dateTo}`);

      return `Related documents (${filters.join(', ')}):\n\n${result
        .map(
          (d, i) =>
            `${i + 1}. "${d.title}" (ID: ${d.id}${d.asn ? `, ASN: ${d.asn}` : ''})\n   Date: ${d.created.split('T')[0]}\n   Correspondent: ${d.correspondent || 'none'}\n   Tags: ${d.tags.join(', ') || 'none'}`
        )
        .join('\n\n')}`;
    },
    {
      name: 'find_related_documents',
      description:
        'Find documents that share context with the current document - by same correspondent and/or similar date range. Use this to discover related documents that might be linked.',
      schema: z.object({
        correspondentName: z.string().optional().describe('Filter by correspondent name'),
        dateFrom: z.string().optional().describe('Filter from date (ISO format: YYYY-MM-DD)'),
        dateTo: z.string().optional().describe('Filter to date (ISO format: YYYY-MM-DD)'),
        limit: z.number().min(1).max(20).optional().describe('Maximum number of results (default: 10, max: 20)'),
      }),
    }
  );

/**
 * Creates a tool to validate that a document ID exists and is accessible.
 */
export const createValidateDocumentIdTool = (deps: ToolDependencies) =>
  tool(
    async ({ docId }): Promise<string> => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const doc = yield* deps.paperless.getDocument(docId);
          const correspondents = yield* deps.paperless.getCorrespondents();
          const correspondent = doc.correspondent
            ? correspondents.find((c) => c.id === doc.correspondent)?.name
            : null;

          return {
            id: doc.id,
            title: doc.title,
            asn: doc.archive_serial_number,
            correspondent,
            created: doc.created,
          };
        })
      ).catch(() => ({ error: true as const }));

      if ('error' in result) {
        return `Document ID ${docId} does not exist or is not accessible.`;
      }

      return `Document ID ${result.id} is valid:
- Title: "${result.title}"
- ASN: ${result.asn || 'none'}
- Correspondent: ${result.correspondent || 'none'}
- Created: ${result.created.split('T')[0]}`;
    },
    {
      name: 'validate_document_id',
      description:
        'Verify that a document ID exists and is accessible. Use this before suggesting a document link to ensure the target document is valid.',
      schema: z.object({
        docId: z.number().describe('The document ID to validate'),
      }),
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

/**
 * Creates tools specifically for document linking agents.
 */
export const createDocumentLinkTools = (deps: ToolDependencies) => [
  createSearchSimilarDocumentsTool(deps),
  createSearchDocumentByReferenceTool(deps),
  createFindRelatedDocumentsTool(deps),
  createValidateDocumentIdTool(deps),
  createGetDocumentTool(deps),
];
