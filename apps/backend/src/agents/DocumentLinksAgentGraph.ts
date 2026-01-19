/**
 * LangGraph-based Document Links agent.
 *
 * Uses the confirmation loop pattern to find and suggest document links.
 * Two-tier confidence system:
 * - High confidence (auto-apply): Explicit references like "See Invoice #456"
 * - Low confidence (manual review): Semantic similarity, shared context
 */
import { Effect, Context, Layer, Stream } from 'effect';
import {
  ConfigService,
  OllamaService,
  TinyBaseService,
  PaperlessService,
  QdrantService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { CustomField } from '../models/index.js';
import type { Agent, AgentProcessResult, StreamEvent } from './base.js';
import {
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';
import {
  DocumentLinksAnalysisSchema,
  type DocumentLinksAnalysisOutput,
  type DocumentLinkSuggestionOutput,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createDocumentLinkTools,
  type ConfirmationLoopConfig,
} from './graph/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface DocumentLinksGraphInput {
  docId: number;
  content: string;
  docTitle: string;
  correspondent?: string;
  documentType?: string;
  documentLinkFields: CustomField[]; // Fields of type 'documentlink'
}

export interface DocumentLinkResult {
  fieldId: number;
  fieldName: string;
  targetDocIds: number[];
  suggestedLinks: DocumentLinkSuggestionOutput[];
}

export interface DocumentLinksGraphResult extends AgentProcessResult {
  links: DocumentLinkResult[];
  autoApplied: number[];
  pendingReview: number[];
  skipped?: boolean;
  skipReason?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface DocumentLinksAgentGraphService extends Agent<DocumentLinksGraphInput, DocumentLinksGraphResult> {
  readonly name: 'document_links';
  readonly process: (input: DocumentLinksGraphInput) => Effect.Effect<DocumentLinksGraphResult, AgentError>;
  readonly processStream: (input: DocumentLinksGraphInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const DocumentLinksAgentGraphService = Context.GenericTag<DocumentLinksAgentGraphService>('DocumentLinksAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document relationship specialist. Your task is to find related documents that should be linked to the current document.

## Tool Usage Guidelines

You have access to tools to search for documents. Use them to find related documents:
- search_document_by_reference: Find documents by title, ASN, or reference text
- find_related_documents: Find documents by correspondent and/or date range
- validate_document_id: Verify that a document ID exists
- search_similar_documents: Find semantically similar documents
- get_document: Get full details of a specific document

## Link Types

1. **Explicit References (High Confidence)**
   - Document mentions another document by name: "See Invoice #456"
   - References an ASN (Archive Serial Number): "Reference: ASN 12345"
   - Mentions a specific document title: "As discussed in Annual Report 2023"
   - These should have confidence > 0.8

2. **Semantic Similarity (Medium Confidence)**
   - Documents about the same topic or project
   - Follow-up documents (e.g., quote → invoice → receipt)
   - These should have confidence 0.5-0.8

3. **Shared Context (Low Confidence)**
   - Same correspondent with similar date
   - Same document type from same period
   - These should have confidence < 0.5

Guidelines:
1. Only suggest links where there's clear evidence of relationship
2. For explicit references, search using the exact text mentioned
3. For semantic similarity, use the search tools to find related documents
4. Always validate document IDs before suggesting them
5. Include the reference text that triggered explicit suggestions
6. High confidence links (>0.8) will be auto-applied, so be conservative

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing document link suggestions.

Evaluation criteria:
- Are the suggested links relevant to the document?
- Is there clear evidence for each link in the document content?
- Are high-confidence links truly explicit references?
- Are the target documents valid and correctly identified?

Confirm if the link suggestions are accurate.
Reject if links are tenuous, incorrectly identified, or lack supporting evidence.

You MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const DocumentLinksAgentGraphServiceLive = Layer.effect(
  DocumentLinksAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;

    const { autoProcessing, tags: tagConfig } = config.config;
    const settings = yield* tinybase.getAllSettings();

    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');
    const smallModel = ollama.getModel('small');

    // Create document link tools
    const tools = createDocumentLinkTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    // Convert structured output to result format
    const toLinkResults = (
      analysis: DocumentLinksAnalysisOutput,
      documentLinkFields: CustomField[]
    ): DocumentLinkResult[] => {
      // For now, we create one result per documentlink field
      // Each field gets all the suggested links
      return documentLinkFields.map((field) => ({
        fieldId: field.id,
        fieldName: field.name,
        targetDocIds: analysis.suggested_links.map((l) => l.target_doc_id),
        suggestedLinks: analysis.suggested_links,
      }));
    };

    const graphConfig: ConfirmationLoopConfig<DocumentLinksAnalysisOutput> = {
      agentName: 'document_links',
      analysisSchema: DocumentLinksAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as {
          correspondent?: string;
          documentType?: string;
          documentLinkFields: CustomField[];
        };

        const fieldsInfo = ctx.documentLinkFields
          .map((f) => `- ID: ${f.id}, Name: ${f.name}`)
          .join('\n');

        return `## Document Content

${state.content.slice(0, 8000)}

## Document Metadata

Title: ${state.docTitle}
Correspondent: ${ctx.correspondent ?? 'Unknown'}
Document Type: ${ctx.documentType ?? 'Unknown'}

## Document Link Fields

${fieldsInfo || 'No documentlink fields defined'}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Find documents that should be linked to this document. Look for:
1. Explicit references to other documents (by name, ASN, or reference number)
2. Semantically related documents (same topic, follow-up documents)
3. Documents sharing context (same correspondent, similar date)

Use the search tools to find related documents and validate their IDs.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        const linksSummary = analysis.suggested_links
          .map(
            (l) =>
              `- "${l.target_doc_title}" (ID: ${l.target_doc_id})\n  Confidence: ${(l.confidence * 100).toFixed(0)}%\n  Type: ${l.reference_type}\n  Reason: ${l.reasoning}${l.reference_text ? `\n  Reference: "${l.reference_text}"` : ''}`
          )
          .join('\n\n');

        return `## Suggested Document Links

${linksSummary || 'No links suggested'}

## High Confidence (Auto-Apply)
${analysis.high_confidence_links.length > 0 ? analysis.high_confidence_links.map((id) => `- Document ID: ${id}`).join('\n') : 'None'}

## Low Confidence (Manual Review)
${analysis.low_confidence_links.length > 0 ? analysis.low_confidence_links.map((id) => `- Document ID: ${id}`).join('\n') : 'None'}

## Overall Reasoning

${analysis.reasoning}

## Document Excerpt

${state.content.slice(0, 4000)}

Review these link suggestions and provide your confirmation decision.`;
      },
    };

    const graph = createConfirmationLoopGraph(graphConfig);

    return {
      name: 'document_links' as const,

      process: (input: DocumentLinksGraphInput) =>
        Effect.gen(function* () {
          // If no documentlink fields defined, skip
          if (input.documentLinkFields.length === 0) {
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_links',
              eventType: 'result',
              data: {
                success: true,
                skipped: true,
                reason: 'No documentlink fields defined in Paperless',
              },
            });

            return {
              success: true,
              value: null,
              reasoning: 'No documentlink fields defined',
              confidence: 1,
              alternatives: [],
              attempts: 0,
              needsReview: false,
              links: [],
              autoApplied: [],
              pendingReview: [],
              skipped: true,
              skipReason: 'No documentlink fields defined in Paperless',
            };
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(
                graph,
                {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: {
                    correspondent: input.correspondent,
                    documentType: input.documentType,
                    documentLinkFields: input.documentLinkFields,
                  },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                },
                `documentlinks-${input.docId}-${Date.now()}`
              ),
            catch: (e) =>
              new AgentError({
                message: `Document links graph failed: ${e}`,
                agent: 'document_links',
                cause: e,
              }),
          });

          const analysis = result.analysis as DocumentLinksAnalysisOutput | null;

          if (!result.success || !analysis) {
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_links',
              eventType: 'result',
              data: {
                success: false,
                needsReview: true,
                reason: result.error ?? 'Confirmation failed',
                attempts: result.attempts,
              },
            });

            return {
              success: true,
              value: null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: 0,
              alternatives: [],
              attempts: result.attempts,
              needsReview: true,
              links: analysis ? toLinkResults(analysis, input.documentLinkFields) : [],
              autoApplied: [],
              pendingReview: [],
            };
          }

          if (analysis.suggested_links.length === 0) {
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_links',
              eventType: 'result',
              data: {
                success: true,
                linksFound: 0,
                reason: 'No related documents found',
                attempts: result.attempts,
              },
            });

            return {
              success: true,
              value: null,
              reasoning: analysis.reasoning,
              confidence: 1,
              alternatives: [],
              attempts: result.attempts,
              needsReview: false,
              links: [],
              autoApplied: [],
              pendingReview: [],
            };
          }

          // Apply high-confidence links automatically
          const highConfidenceLinks = analysis.suggested_links.filter(
            (l) => analysis.high_confidence_links.includes(l.target_doc_id)
          );
          const lowConfidenceLinks = analysis.suggested_links.filter(
            (l) => analysis.low_confidence_links.includes(l.target_doc_id)
          );

          // Auto-apply high confidence links to the first documentlink field
          const autoApplied: number[] = [];
          const firstField = input.documentLinkFields[0];
          if (highConfidenceLinks.length > 0 && firstField) {
            const doc = yield* paperless.getDocument(input.docId);
            const currentFields = (doc.custom_fields ?? []) as Array<{
              field: number;
              value: unknown;
            }>;

            // Get current value for the field (should be an array of doc IDs)
            const existingField = currentFields.find((cf) => cf.field === firstField.id);
            const existingLinks = Array.isArray(existingField?.value)
              ? (existingField.value as number[])
              : [];

            // Add new links
            const newLinks = [
              ...existingLinks,
              ...highConfidenceLinks.map((l) => l.target_doc_id),
            ];

            // Deduplicate
            const uniqueLinks = [...new Set(newLinks)];

            // Update the field
            const newCustomFields = currentFields.filter((cf) => cf.field !== firstField.id);
            newCustomFields.push({
              field: firstField.id,
              value: uniqueLinks,
            });

            yield* paperless.updateDocument(input.docId, {
              custom_fields: newCustomFields,
            });

            autoApplied.push(...highConfidenceLinks.map((l) => l.target_doc_id));
          }

          // Queue low confidence links for review
          const pendingReview: number[] = [];
          if (lowConfidenceLinks.length > 0) {
            // Add to pending review queue
            for (const link of lowConfidenceLinks) {
              const addResult = yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'documentlink',
                suggestion: `Link to: ${link.target_doc_title} (ID: ${link.target_doc_id})`,
                reasoning: link.reasoning,
                alternatives: [],
                attempts: result.attempts,
                lastFeedback: null,
                nextTag: null,
                metadata: JSON.stringify({
                  targetDocId: link.target_doc_id,
                  targetDocTitle: link.target_doc_title,
                  confidence: link.confidence,
                  referenceType: link.reference_type,
                  referenceText: link.reference_text,
                  fieldId: input.documentLinkFields[0]?.id,
                  fieldName: input.documentLinkFields[0]?.name,
                }),
              });

              if (addResult) {
                pendingReview.push(link.target_doc_id);
              }
            }
          }

          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'document_links',
            eventType: 'result',
            data: {
              success: true,
              linksFound: analysis.suggested_links.length,
              autoApplied: autoApplied.length,
              pendingReview: pendingReview.length,
              reasoning: analysis.reasoning,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: `${autoApplied.length} auto-applied, ${pendingReview.length} pending review`,
            reasoning: analysis.reasoning,
            confidence: 1,
            alternatives: [],
            attempts: result.attempts,
            needsReview: pendingReview.length > 0,
            links: toLinkResults(analysis, input.documentLinkFields),
            autoApplied,
            pendingReview,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError
              ? e
              : new AgentError({
                  message: `Document links process failed: ${e}`,
                  agent: 'document_links',
                  cause: e,
                })
          )
        ),

      processStream: (input: DocumentLinksGraphInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('document_links')));

            // If no documentlink fields defined, skip
            if (input.documentLinkFields.length === 0) {
              yield* Effect.sync(() =>
                emit.single(
                  emitResult('document_links', {
                    success: true,
                    skipped: true,
                    reason: 'No documentlink fields defined',
                  })
                )
              );
              yield* Effect.sync(() => emit.single(emitComplete('document_links')));
              yield* Effect.sync(() => emit.end());
              return;
            }

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(
                  graph,
                  {
                    docId: input.docId,
                    docTitle: input.docTitle,
                    content: input.content,
                    context: {
                      correspondent: input.correspondent,
                      documentType: input.documentType,
                      documentLinkFields: input.documentLinkFields,
                    },
                    maxRetries: autoProcessing.confirmationMaxRetries,
                  },
                  `documentlinks-stream-${input.docId}-${Date.now()}`
                );

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e instanceof Error ? e : new Error(String(e)),
            });

            if (result instanceof Error) {
              yield* Effect.sync(() =>
                emit.fail(
                  new AgentError({
                    message: `Stream failed: ${result}`,
                    agent: 'document_links',
                  })
                )
              );
              return;
            }

            let lastAnalysis: DocumentLinksAnalysisOutput | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as DocumentLinksAnalysisOutput;
                yield* Effect.sync(() =>
                  emit.single(
                    emitAnalyzing('document_links', `Attempt ${(state.attempt as number) ?? 1}`)
                  )
                );
                yield* Effect.sync(() =>
                  emit.single(emitThinking('document_links', lastAnalysis!.reasoning))
                );
              }

              if (node === 'confirm' && lastAnalysis) {
                const linksSummary = lastAnalysis.suggested_links
                  .map((l) => `${l.target_doc_title} (${l.reference_type})`)
                  .join(', ');
                yield* Effect.sync(() =>
                  emit.single(emitConfirming('document_links', linksSummary || 'No links'))
                );
              }

              if (node === 'apply' && lastAnalysis) {
                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('document_links', {
                      success: true,
                      links: toLinkResults(lastAnalysis!, input.documentLinkFields),
                      autoApplied: lastAnalysis!.high_confidence_links,
                      pendingReview: lastAnalysis!.low_confidence_links,
                    })
                  )
                );
              }

              if (node === 'queue_review') {
                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('document_links', {
                      success: true,
                      needsReview: true,
                      links: lastAnalysis ? toLinkResults(lastAnalysis, input.documentLinkFields) : [],
                      autoApplied: [],
                      pendingReview: [],
                    })
                  )
                );
              }
            }

            yield* Effect.sync(() => emit.single(emitComplete('document_links')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Document links stream failed: ${e}`,
                agent: 'document_links',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
