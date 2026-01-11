/**
 * LangGraph-based Custom Fields extraction agent.
 *
 * Uses the confirmation loop pattern to extract custom field values from documents.
 * Has access to tools to search for documents with similar custom field values.
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
import type { CustomField, CustomFieldValue } from '../models/index.js';
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
  CustomFieldsAnalysisSchema,
  type CustomFieldsAnalysisOutput,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
} from './graph/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface CustomFieldsGraphInput {
  docId: number;
  content: string;
  docTitle: string;
  documentType?: string;
  customFields: CustomField[];
}

export interface FieldValueResult {
  fieldId: number;
  fieldName: string;
  value: string | number | boolean | null;
  reasoning: string;
}

export interface CustomFieldsGraphResult extends AgentProcessResult {
  fields: FieldValueResult[];
  updatedFields: string[];
  skipped?: boolean;
  skipReason?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface CustomFieldsAgentGraphService extends Agent<CustomFieldsGraphInput, CustomFieldsGraphResult> {
  readonly name: 'custom_fields';
  readonly process: (input: CustomFieldsGraphInput) => Effect.Effect<CustomFieldsGraphResult, AgentError>;
  readonly processStream: (input: CustomFieldsGraphInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CustomFieldsAgentGraphService = Context.GenericTag<CustomFieldsAgentGraphService>('CustomFieldsAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document data extraction specialist. Your task is to extract values for custom fields from document content.

## Tool Usage Guidelines

You have access to tools to search for similar processed documents. These tools are OPTIONAL and should be used sparingly:
- Only call a tool if you genuinely need more information
- If a tool returns "not found" or empty results, DO NOT call the same tool again - proceed with your analysis
- Make at most 2-3 tool calls total, then provide your final answer
- You can make your decision based on the document content alone if tools don't provide useful information

Available tools:
- list_custom_fields: List all available custom fields and their data types
- get_documents_by_custom_field: Find documents that have a specific custom field filled to see example values
- search_similar_documents: Find semantically similar processed documents
- get_document: Get full details of a specific processed document

Guidelines:
1. Only extract values for fields that have clear evidence in the document
2. Match the expected data type for each field (string, number, boolean, date, etc.)
3. Leave fields null if the value cannot be reliably determined
5. Provide reasoning for each extracted value
6. Consider the document type when interpreting field meanings

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing extracted field values.

Evaluation criteria:
- Are the extracted values accurate based on the document content?
- Are the data types correct for each field?
- Is there sufficient evidence in the document for each value?
- Are any values guessed without clear support?

Confirm if the field extractions are accurate.
Reject if values are incorrect, unsupported, or mistyped.

You MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const CustomFieldsAgentGraphServiceLive = Layer.effect(
  CustomFieldsAgentGraphService,
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

    // Create tools for document context lookup
    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    // Convert structured output to result format
    const toFieldResults = (analysis: CustomFieldsAnalysisOutput): FieldValueResult[] =>
      analysis.suggested_fields.map((f) => ({
        fieldId: f.field_id,
        fieldName: f.field_name,
        value: f.value,
        reasoning: f.reasoning,
      }));

    const graphConfig: ConfirmationLoopConfig<CustomFieldsAnalysisOutput> = {
      agentName: 'custom_fields',
      analysisSchema: CustomFieldsAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools, // Tools for looking up documents with custom field values
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as { customFields: CustomField[]; documentType?: string };
        const fieldsInfo = ctx.customFields
          .map((f) => `- ID: ${f.id}, Name: ${f.name}, Type: ${f.data_type}`)
          .join('\n');

        return `## Document Content

${state.content.slice(0, 8000)}

## Document Type

${ctx.documentType ?? 'Unknown'}

## Custom Fields to Extract

${fieldsInfo}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Extract values for the custom fields listed above from this document.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        const fieldsSummary = analysis.suggested_fields
          .map((f) => `${f.field_name}: ${f.value} (Reason: ${f.reasoning})`)
          .join('\n');

        return `## Extracted Field Values

${fieldsSummary || 'No fields extracted'}

## Reasoning

${analysis.reasoning}

## Confidence

${analysis.confidence}

## Document Excerpt

${state.content.slice(0, 4000)}

Review these field extractions and provide your confirmation decision.`;
      },
    };

    const graph = createConfirmationLoopGraph(graphConfig);

    return {
      name: 'custom_fields' as const,

      process: (input: CustomFieldsGraphInput) =>
        Effect.gen(function* () {
          // If no custom fields defined, skip
          if (input.customFields.length === 0) {
            // Log skip
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'custom_fields',
              eventType: 'result',
              data: {
                success: true,
                skipped: true,
                reason: 'No custom fields defined in Paperless',
              },
            });

            return {
              success: true,
              value: null,
              reasoning: 'No custom fields defined',
              confidence: 1,
              alternatives: [],
              attempts: 0,
              needsReview: false,
              fields: [],
              updatedFields: [],
              skipped: true,
              skipReason: 'No custom fields defined in Paperless',
            };
          }

          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.docTitle,
                content: input.content,
                context: { customFields: input.customFields, documentType: input.documentType },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `customfields-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `Custom fields graph failed: ${e}`, agent: 'custom_fields', cause: e }),
          });

          const analysis = result.analysis as CustomFieldsAnalysisOutput | null;

          if (!result.success || !analysis) {
            // Log failure (but custom fields don't block the pipeline)
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'custom_fields',
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
              confidence: analysis?.confidence ?? 0,
              alternatives: [],
              attempts: result.attempts,
              needsReview: true,
              fields: analysis ? toFieldResults(analysis) : [],
              updatedFields: [],
            };
          }

          if (analysis.suggested_fields.length === 0) {
            // Log no fields extracted
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'custom_fields',
              eventType: 'result',
              data: {
                success: true,
                fieldsExtracted: 0,
                reason: 'No relevant field values found in document',
                attempts: result.attempts,
              },
            });

            return {
              success: true,
              value: null,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              alternatives: [],
              attempts: result.attempts,
              needsReview: false,
              fields: [],
              updatedFields: [],
            };
          }

          // Apply the field values
          const doc = yield* paperless.getDocument(input.docId);
          const currentFields = (doc.custom_fields ?? []) as CustomFieldValue[];
          const fieldIdToField = new Map(input.customFields.map((f) => [f.id, f]));
          const updatedFields: string[] = [];

          const newCustomFields: CustomFieldValue[] = [...currentFields];

          for (const fieldValue of analysis.suggested_fields) {
            const fieldDef = fieldIdToField.get(fieldValue.field_id);
            if (!fieldDef) continue;

            const existingIdx = newCustomFields.findIndex(
              (cf) => cf.field === fieldValue.field_id
            );

            if (existingIdx >= 0) {
              newCustomFields[existingIdx] = {
                field: fieldValue.field_id,
                value: fieldValue.value,
              };
            } else {
              newCustomFields.push({
                field: fieldValue.field_id,
                value: fieldValue.value,
              });
            }

            updatedFields.push(fieldValue.field_name);
          }

          if (updatedFields.length > 0) {
            yield* paperless.updateDocument(input.docId, {
              custom_fields: newCustomFields,
            });
          }

          // Log success
          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'custom_fields',
            eventType: 'result',
            data: {
              success: true,
              fieldsExtracted: analysis.suggested_fields.length,
              updatedFields,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: updatedFields.join(', '),
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: [],
            attempts: result.attempts,
            needsReview: false,
            fields: toFieldResults(analysis),
            updatedFields,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Custom fields process failed: ${e}`, agent: 'custom_fields', cause: e })
          )
        ),

      processStream: (input: CustomFieldsGraphInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('custom_fields')));

            // If no custom fields defined, skip
            if (input.customFields.length === 0) {
              yield* Effect.sync(() =>
                emit.single(emitResult('custom_fields', {
                  success: true,
                  skipped: true,
                  reason: 'No custom fields defined',
                }))
              );
              yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
              yield* Effect.sync(() => emit.end());
              return;
            }

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: { customFields: input.customFields, documentType: input.documentType },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `customfields-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'custom_fields' })));
              return;
            }

            let lastAnalysis: CustomFieldsAnalysisOutput | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as CustomFieldsAnalysisOutput;
                yield* Effect.sync(() => emit.single(emitAnalyzing('custom_fields', `Attempt ${(state.attempt as number) ?? 1}`)));
                yield* Effect.sync(() => emit.single(emitThinking('custom_fields', lastAnalysis!.reasoning)));
              }

              if (node === 'confirm' && lastAnalysis) {
                const fieldsSummary = lastAnalysis.suggested_fields
                  .map((f) => `${f.field_name}: ${f.value}`)
                  .join(', ');
                yield* Effect.sync(() => emit.single(emitConfirming('custom_fields', fieldsSummary || 'No fields')));
              }

              if (node === 'apply' && lastAnalysis) {
                // Apply the field values
                const doc = yield* paperless.getDocument(input.docId);
                const currentFields = (doc.custom_fields ?? []) as CustomFieldValue[];
                const fieldIdToField = new Map(input.customFields.map((f) => [f.id, f]));
                const updatedFields: string[] = [];

                const newCustomFields: CustomFieldValue[] = [...currentFields];

                for (const fieldValue of lastAnalysis.suggested_fields) {
                  const fieldDef = fieldIdToField.get(fieldValue.field_id);
                  if (!fieldDef) continue;

                  const existingIdx = newCustomFields.findIndex(
                    (cf) => cf.field === fieldValue.field_id
                  );

                  if (existingIdx >= 0) {
                    newCustomFields[existingIdx] = {
                      field: fieldValue.field_id,
                      value: fieldValue.value,
                    };
                  } else {
                    newCustomFields.push({
                      field: fieldValue.field_id,
                      value: fieldValue.value,
                    });
                  }

                  updatedFields.push(fieldValue.field_name);
                }

                if (updatedFields.length > 0) {
                  yield* paperless.updateDocument(input.docId, {
                    custom_fields: newCustomFields,
                  });
                }

                yield* Effect.sync(() => emit.single(emitResult('custom_fields', {
                  success: true,
                  fields: toFieldResults(lastAnalysis!),
                  updatedFields,
                })));
              }

              if (node === 'queue_review') {
                yield* Effect.sync(() => emit.single(emitResult('custom_fields', {
                  success: true,
                  needsReview: true,
                  fields: lastAnalysis ? toFieldResults(lastAnalysis) : [],
                  updatedFields: [],
                })));
              }
            }

            yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) => new AgentError({ message: `Custom fields stream failed: ${e}`, agent: 'custom_fields', cause: e }))
          )
        ),
    };
  })
);
