/**
 * LangGraph-based Document Links agent.
 *
 * Uses the confirmation loop pattern to find and suggest document links.
 * All confirmed links are auto-applied - agents must be conservative.
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
  appliedLinks: number[];
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

IMPORTANT: All confirmed links will be automatically applied. Only suggest links when you are CERTAIN the relationship is meaningful and the user will appreciate the connection. When in doubt, do NOT suggest the link.

## Tool Usage Guidelines

You have access to tools to search for documents. Use them to find related documents:
- search_document_by_reference: Find documents by title, ASN, or reference text
- find_related_documents: Find documents by correspondent and/or date range
- validate_document_id: Verify that a document ID exists
- search_similar_documents: Find semantically similar documents
- get_document: Get full details of a specific document

## Link Types (in order of priority)

1. **Explicit References** (PRIMARY - suggest these)
   - Document explicitly mentions another document by name: "See Invoice #456"
   - References an ASN (Archive Serial Number): "Reference: ASN 12345"
   - Mentions a specific document title: "As discussed in Annual Report 2023"

2. **Strong Semantic Relationships** (only if crystal clear)
   - Clear follow-up documents in a chain (e.g., quote → invoice → receipt)
   - Direct amendments or addenda to a specific document

3. **Do NOT suggest** (unless explicitly requested)
   - Vague topic similarity
   - Same correspondent without explicit reference
   - Same time period without explicit reference

## Guidelines

1. Be EXTREMELY conservative - better to suggest 0 links than 1 wrong link
2. Only suggest links where there's undeniable evidence of relationship
3. For explicit references, search using the exact text mentioned
4. Always validate document IDs before suggesting them
5. Include the reference text that triggered explicit suggestions
6. Ask yourself: "Would the user thank me for this link?" - if unsure, don't suggest it

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing document link suggestions.

CRITICAL: All confirmed links will be AUTOMATICALLY applied. You are the last checkpoint before auto-apply. Only confirm if you would stake your reputation on this link being correct and helpful.

## Evaluation criteria (ALL must be met):

- Is the relationship crystal clear with undeniable evidence?
- Would the user thank you for adding this link?
- Is the target document correctly identified?
- Is there zero doubt about this link's value?

## Ask yourself:

1. "Would I be embarrassed if this link was wrong?" - If yes, reject.
2. "Is the evidence for this link beyond question?" - If no, reject.
3. "Would a human reviewer approve without hesitation?" - If no, reject.

## When to REJECT:

- ANY doubt about the relationship
- Tenuous or weak connections
- Missing or unclear evidence in the document
- Target document doesn't match the reference exactly
- Link is "nice to have" rather than "obviously correct"

Confirm ONLY if the link is obviously correct and helpful.
Reject if there is ANY uncertainty.

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
    // Each documentlink field receives the same suggested links
    const toLinkResults = (
      analysis: DocumentLinksAnalysisOutput,
      documentLinkFields: CustomField[]
    ): DocumentLinkResult[] => {
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

        return `## Suggested Document Links (ALL will be auto-applied if confirmed)

${linksSummary || 'No links suggested'}

## Overall Reasoning

${analysis.reasoning}

## Document Excerpt

${state.content.slice(0, 4000)}

REMINDER: If you confirm, ALL these links will be automatically applied. Only confirm if EVERY link is correct and helpful. Reject if you have ANY doubts about any link.`;
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
              appliedLinks: [],
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
            // Confirmation failed - log and skip, don't queue for review
            // Document links are optional metadata; if uncertain, skip rather than burden users
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_links',
              eventType: 'result',
              data: {
                success: false,
                reason: result.error ?? 'Confirmation failed - no links applied',
                attempts: result.attempts,
              },
            });

            return {
              success: true,
              value: null,
              reasoning: result.error ?? 'Confirmation failed - no links applied',
              confidence: 0,
              alternatives: [],
              attempts: result.attempts,
              needsReview: false,
              links: [],
              appliedLinks: [],
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
              appliedLinks: [],
            };
          }

          // Apply ALL confirmed links to ALL documentlink fields
          const appliedLinks: number[] = [];
          if (analysis.suggested_links.length > 0 && input.documentLinkFields.length > 0) {
            const doc = yield* paperless.getDocument(input.docId);
            const currentFields = (doc.custom_fields ?? []) as Array<{
              field: number;
              value: unknown;
            }>;

            // Build updated custom fields with links applied to each documentlink field
            const newLinkDocIds = analysis.suggested_links.map((l) => l.target_doc_id);
            const documentLinkFieldIds = new Set(input.documentLinkFields.map((f) => f.id));

            // Start with non-documentlink fields
            const newCustomFields = currentFields.filter(
              (cf) => !documentLinkFieldIds.has(cf.field)
            );

            // Add each documentlink field with merged links
            for (const field of input.documentLinkFields) {
              const existingField = currentFields.find((cf) => cf.field === field.id);
              const existingLinks = Array.isArray(existingField?.value)
                ? (existingField.value as number[])
                : [];

              // Merge existing and new links, deduplicate
              const mergedLinks = [...new Set([...existingLinks, ...newLinkDocIds])];

              newCustomFields.push({
                field: field.id,
                value: mergedLinks,
              });
            }

            yield* paperless.updateDocument(input.docId, {
              custom_fields: newCustomFields,
            });

            appliedLinks.push(...newLinkDocIds);
          }

          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'document_links',
            eventType: 'result',
            data: {
              success: true,
              linksFound: analysis.suggested_links.length,
              appliedLinks: appliedLinks.length,
              fieldsUpdated: input.documentLinkFields.length,
              reasoning: analysis.reasoning,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: `${appliedLinks.length} links applied to ${input.documentLinkFields.length} field(s)`,
            reasoning: analysis.reasoning,
            confidence: 1,
            alternatives: [],
            attempts: result.attempts,
            needsReview: false,
            links: toLinkResults(analysis, input.documentLinkFields),
            appliedLinks,
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
              catch: (e) => new AgentError({
                message: `Stream failed: ${e instanceof Error ? e.message : String(e)}`,
                agent: 'document_links',
                cause: e,
              }),
            }).pipe(
              Effect.tapError((error) =>
                Effect.sync(() => emit.fail(error))
              )
            );

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
                      appliedLinks: lastAnalysis!.suggested_links.map((l) => l.target_doc_id),
                    })
                  )
                );
              }

              if (node === 'queue_review') {
                // Confirmation failed - no links applied, no review needed
                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('document_links', {
                      success: true,
                      needsReview: false,
                      links: [],
                      appliedLinks: [],
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
