/**
 * Custom Fields extraction agent.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import { ConfigService, OllamaService, PromptService, TinyBaseService, PaperlessService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { CustomField, CustomFieldValue } from '../models/index.js';
import {
  type Agent,
  type AgentProcessResult,
  type StreamEvent,
  runConfirmationLoop,
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface CustomFieldsInput {
  docId: number;
  content: string;
  documentType?: string;
  customFields: CustomField[];
}

export interface FieldValue {
  fieldId: number;
  fieldName: string;
  value: string | number | boolean | null;
  reasoning: string;
}

export interface CustomFieldsAnalysis {
  suggestedFields: FieldValue[];
  reasoning: string;
  confidence: number;
}

export interface CustomFieldsResult extends AgentProcessResult {
  fields: FieldValue[];
  updatedFields: string[];
  skipped?: boolean;
  skipReason?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface CustomFieldsAgentService extends Agent<CustomFieldsInput, CustomFieldsResult> {
  readonly name: 'custom_fields';
  readonly process: (input: CustomFieldsInput) => Effect.Effect<CustomFieldsResult, AgentError>;
  readonly processStream: (input: CustomFieldsInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CustomFieldsAgentService = Context.GenericTag<CustomFieldsAgentService>('CustomFieldsAgentService');

// ===========================================================================
// Response Parsers
// ===========================================================================

const parseAnalysisResponse = (response: string, customFields: CustomField[]): CustomFieldsAnalysis => {
  const fieldIdToName = new Map(customFields.map((f) => [f.id, f.name]));

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        suggested_fields?: Array<{
          field_id?: number;
          fieldId?: number;
          field_name?: string;
          fieldName?: string;
          value?: string | number | boolean | null;
          reasoning?: string;
        }>;
        suggestedFields?: Array<{
          field_id?: number;
          fieldId?: number;
          field_name?: string;
          fieldName?: string;
          value?: string | number | boolean | null;
          reasoning?: string;
        }>;
        reasoning?: string;
        confidence?: number;
      };

      const fields = parsed.suggested_fields ?? parsed.suggestedFields ?? [];
      const suggestedFields = fields.map((f) => {
        const fieldId = f.field_id ?? f.fieldId ?? 0;
        return {
          fieldId,
          fieldName: f.field_name ?? f.fieldName ?? fieldIdToName.get(fieldId) ?? '',
          value: f.value ?? null,
          reasoning: f.reasoning ?? '',
        };
      });

      return {
        suggestedFields,
        reasoning: parsed.reasoning ?? '',
        confidence: parsed.confidence ?? 0.5,
      };
    }
  } catch {
    // Fall back to empty
  }

  return {
    suggestedFields: [],
    reasoning: 'Could not parse response',
    confidence: 0,
  };
};

const parseConfirmationResponse = (response: string): { confirmed: boolean; feedback?: string } => {
  const lower = response.toLowerCase();
  const confirmed = lower.includes('yes') || lower.includes('confirmed') || lower.includes('accept');
  const feedback = confirmed ? undefined : response.replace(/^(no|rejected|feedback:)\s*/i, '');
  return { confirmed, feedback };
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const CustomFieldsAgentServiceLive = Layer.effect(
  CustomFieldsAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const { autoProcessing, tags: tagConfig } = config.config;

    return {
      name: 'custom_fields' as const,

      process: (input: CustomFieldsInput) =>
        Effect.gen(function* () {
          // If no custom fields defined, skip
          if (input.customFields.length === 0) {
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

          return yield* runConfirmationLoop<CustomFieldsAnalysis, CustomFieldsResult>({
            maxRetries: autoProcessing.confirmationMaxRetries,

            analyze: (feedback) =>
              Effect.gen(function* () {
                // Format custom fields for prompt
                const fieldsInfo = input.customFields
                  .map((f) => `- ID: ${f.id}, Name: ${f.name}, Type: ${f.data_type}`)
                  .join('\n');

                const prompt = yield* prompts.renderPrompt('custom_fields', {
                  document_content: input.content.slice(0, 8000),
                  document_type: input.documentType ?? 'Unknown',
                  custom_fields: fieldsInfo,
                  feedback: feedback ?? 'None',
                });

                const response = yield* ollama.generate(
                  ollama.getModel('large'),
                  prompt,
                  { temperature: 0.1 }
                );

                return parseAnalysisResponse(response, input.customFields);
              }).pipe(
                Effect.mapError((e) =>
                  new AgentError({
                    message: `Custom fields analysis failed: ${e}`,
                    agent: 'custom_fields',
                    step: 'analyze',
                    cause: e,
                  })
                )
              ),

            confirm: (analysis) =>
              Effect.gen(function* () {
                if (analysis.suggestedFields.length === 0) {
                  return { confirmed: true }; // No fields to extract is valid
                }

                const fieldsSummary = analysis.suggestedFields
                  .map((f) => `${f.fieldName}: ${f.value} (Reason: ${f.reasoning})`)
                  .join('\n');

                const prompt = yield* prompts.renderPrompt('custom_fields_confirmation', {
                  document_excerpt: input.content.slice(0, 4000),
                  suggested_fields: fieldsSummary,
                  reasoning: analysis.reasoning,
                });

                const response = yield* ollama.generate(
                  ollama.getModel('small'),
                  prompt,
                  { temperature: 0 }
                );

                return parseConfirmationResponse(response);
              }).pipe(
                Effect.mapError((e) =>
                  new AgentError({
                    message: `Custom fields confirmation failed: ${e}`,
                    agent: 'custom_fields',
                    step: 'confirm',
                    cause: e,
                  })
                )
              ),

            apply: (analysis) =>
              Effect.gen(function* () {
                if (analysis.suggestedFields.length === 0) {
                  return {
                    success: true,
                    value: null,
                    reasoning: analysis.reasoning,
                    confidence: analysis.confidence,
                    alternatives: [],
                    attempts: 1,
                    needsReview: false,
                    fields: [],
                    updatedFields: [],
                  };
                }

                // Get current document
                const doc = yield* paperless.getDocument(input.docId);
                const currentFields = (doc.custom_fields ?? []) as CustomFieldValue[];

                const fieldIdToField = new Map(input.customFields.map((f) => [f.id, f]));
                const updatedFields: string[] = [];

                // Build new custom fields array
                const newCustomFields: CustomFieldValue[] = [...currentFields];

                for (const fieldValue of analysis.suggestedFields) {
                  const fieldDef = fieldIdToField.get(fieldValue.fieldId);
                  if (!fieldDef) continue;

                  // Find or create field entry
                  const existingIdx = newCustomFields.findIndex(
                    (cf) => cf.field === fieldValue.fieldId
                  );

                  if (existingIdx >= 0) {
                    newCustomFields[existingIdx] = {
                      field: fieldValue.fieldId,
                      value: fieldValue.value,
                    };
                  } else {
                    newCustomFields.push({
                      field: fieldValue.fieldId,
                      value: fieldValue.value,
                    });
                  }

                  updatedFields.push(fieldValue.fieldName);
                }

                // Update document
                if (updatedFields.length > 0) {
                  yield* paperless.updateDocument(input.docId, {
                    custom_fields: newCustomFields,
                  });
                }

                return {
                  success: true,
                  value: updatedFields.join(', '),
                  reasoning: analysis.reasoning,
                  confidence: analysis.confidence,
                  alternatives: [],
                  attempts: 1,
                  needsReview: false,
                  fields: analysis.suggestedFields,
                  updatedFields,
                };
              }).pipe(
                Effect.mapError((e) =>
                  new AgentError({
                    message: `Custom fields application failed: ${e}`,
                    agent: 'custom_fields',
                    step: 'apply',
                    cause: e,
                  })
                )
              ),

            onMaxRetries: (lastAnalysis) =>
              Effect.gen(function* () {
                // Custom fields don't block the pipeline
                return {
                  success: true,
                  value: null,
                  reasoning: lastAnalysis.reasoning,
                  confidence: lastAnalysis.confidence,
                  alternatives: [],
                  attempts: autoProcessing.confirmationMaxRetries,
                  needsReview: true,
                  fields: lastAnalysis.suggestedFields,
                  updatedFields: [],
                };
              }).pipe(
                Effect.mapError((e) =>
                  new AgentError({
                    message: `Custom fields max retries: ${e}`,
                    agent: 'custom_fields',
                    step: 'max_retries',
                    cause: e,
                  })
                )
              ),
          });
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError
              ? e
              : new AgentError({
                  message: `Custom fields processing failed: ${e}`,
                  agent: 'custom_fields',
                  cause: e,
                })
          )
        ),

      processStream: (input: CustomFieldsInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('custom_fields')));

            // If no custom fields defined, skip
            if (input.customFields.length === 0) {
              yield* Effect.sync(() =>
                emit.single(
                  emitResult('custom_fields', {
                    success: true,
                    skipped: true,
                    reason: 'No custom fields defined',
                  })
                )
              );
              yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
              yield* Effect.sync(() => emit.end());
              return;
            }

            let feedback: string | null = null;
            let lastAnalysis: CustomFieldsAnalysis | null = null;

            for (let attempt = 0; attempt < autoProcessing.confirmationMaxRetries; attempt++) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('custom_fields', `Attempt ${attempt + 1}`))
              );

              const fieldsInfo = input.customFields
                .map((f) => `- ID: ${f.id}, Name: ${f.name}, Type: ${f.data_type}`)
                .join('\n');

              const prompt = yield* prompts.renderPrompt('custom_fields', {
                document_content: input.content.slice(0, 8000),
                document_type: input.documentType ?? 'Unknown',
                custom_fields: fieldsInfo,
                feedback: feedback ?? 'None',
              });

              const analysisResponse = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(analysisResponse, input.customFields);
              lastAnalysis = analysis;

              yield* Effect.sync(() =>
                emit.single(emitThinking('custom_fields', analysis.reasoning))
              );

              if (analysis.suggestedFields.length === 0) {
                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('custom_fields', {
                      success: true,
                      fields: [],
                      updatedFields: [],
                    })
                  )
                );
                yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              const fieldsSummary = analysis.suggestedFields
                .map((f) => `${f.fieldName}: ${f.value}`)
                .join(', ');

              yield* Effect.sync(() =>
                emit.single(emitConfirming('custom_fields', fieldsSummary))
              );

              const confirmPrompt = yield* prompts.renderPrompt('custom_fields_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_fields: fieldsSummary,
                reasoning: analysis.reasoning,
              });

              const confirmResponse = yield* ollama.generate(
                ollama.getModel('small'),
                confirmPrompt,
                { temperature: 0 }
              );

              const confirmation = parseConfirmationResponse(confirmResponse);

              if (confirmation.confirmed) {
                const doc = yield* paperless.getDocument(input.docId);
                const currentFields = (doc.custom_fields ?? []) as CustomFieldValue[];
                const fieldIdToField = new Map(input.customFields.map((f) => [f.id, f]));
                const updatedFields: string[] = [];

                const newCustomFields: CustomFieldValue[] = [...currentFields];

                for (const fieldValue of analysis.suggestedFields) {
                  const fieldDef = fieldIdToField.get(fieldValue.fieldId);
                  if (!fieldDef) continue;

                  const existingIdx = newCustomFields.findIndex(
                    (cf) => cf.field === fieldValue.fieldId
                  );

                  if (existingIdx >= 0) {
                    newCustomFields[existingIdx] = {
                      field: fieldValue.fieldId,
                      value: fieldValue.value,
                    };
                  } else {
                    newCustomFields.push({
                      field: fieldValue.fieldId,
                      value: fieldValue.value,
                    });
                  }

                  updatedFields.push(fieldValue.fieldName);
                }

                if (updatedFields.length > 0) {
                  yield* paperless.updateDocument(input.docId, {
                    custom_fields: newCustomFields,
                  });
                }

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('custom_fields', {
                      success: true,
                      fields: analysis.suggestedFields,
                      updatedFields,
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              feedback = confirmation.feedback ?? 'Not confirmed';
            }

            // Max retries - custom fields don't block pipeline
            yield* Effect.sync(() =>
              emit.single(
                emitResult('custom_fields', {
                  success: true,
                  needsReview: true,
                  fields: lastAnalysis?.suggestedFields ?? [],
                  updatedFields: [],
                })
              )
            );

            yield* Effect.sync(() => emit.single(emitComplete('custom_fields')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Custom fields stream failed: ${e}`,
                agent: 'custom_fields',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
