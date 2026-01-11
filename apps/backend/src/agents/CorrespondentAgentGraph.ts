/**
 * LangGraph-based Correspondent extraction agent.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import {
  ConfigService,
  OllamaService,
  PromptService,
  TinyBaseService,
  PaperlessService,
  QdrantService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
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
  CorrespondentAnalysisSchema,
  type CorrespondentAnalysis,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
  type ConfirmationLoopLogEvent,
} from './graph/index.js';
import type { ProcessingLogEventType } from '../services/TinyBaseService.js';

// ===========================================================================
// Types
// ===========================================================================

export interface CorrespondentInput {
  docId: number;
  content: string;
  docTitle: string;
  existingCorrespondents: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface CorrespondentAgentGraphService extends Agent<CorrespondentInput, AgentProcessResult> {
  readonly name: 'correspondent';
  readonly process: (input: CorrespondentInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: CorrespondentInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CorrespondentAgentGraphService = Context.GenericTag<CorrespondentAgentGraphService>('CorrespondentAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `Du bist ein Dokumentenanalyse-Spezialist mit Fokus auf die Identifikation von Korrespondenten (Absender/Ersteller).

Du hast Zugriff auf Tools, um ähnliche bereits verarbeitete Dokumente zu suchen. Nutze diese, um zu sehen, wie Korrespondenten typischerweise identifiziert und benannt werden.

Ein Korrespondent ist die Partei, mit der du bezüglich dieses Dokuments eine Geschäftsbeziehung hast. Achte auf:
- Briefkopf mit Firmen-/Organisationsname
- Absenderadresse (meist oben links oder oben rechts)
- Unterschriftenblock mit Name und Firma
- Logo des Absenders
- E-Mail-/Website-Domains

WICHTIG - Zahlungsdienstleister (PayPal, Stripe, Square, Klarna, etc.):
- Bei Transaktionsbenachrichtigungen von Zahlungsdienstleistern sollte der Korrespondent die ANDERE PARTEI (Händler/Verkäufer) sein, NICHT der Zahlungsdienstleister
- Zahlungsdienstleister sind Vermittler - die eigentliche Geschäftsbeziehung besteht mit dem Händler
- Beispiel: PayPal-Beleg für Kauf bei "Amazon" → Korrespondent ist "Amazon", nicht "PayPal"
- Beispiel: PayPal-Zahlung an "Jodi Parsons" → Korrespondent ist "Jodi Parsons", nicht "PayPal"

Richtlinien:
1. Wenn möglich aus existierenden Korrespondenten wählen - die Liste ist vorgeprüft
2. Beim Abgleich normalisieren: Rechtsformzusätze (GmbH, AG, Inc.) ignorieren
3. Beim Abgleich spezifisch sein: "Finanzamt München" passt zu "Finanzamt München", nicht zu "Finanzamt Berlin"
4. Nur neue Korrespondenten vorschlagen (is_new: true), wenn kein existierender auch nur annähernd passt UND die Konfidenz >0.9 ist

Du MUSST mit strukturiertem JSON antworten, das dem erforderlichen Schema entspricht.`;

const CONFIRMATION_SYSTEM_PROMPT = `Du bist ein Qualitätssicherungsassistent, der eine Korrespondenten-Identifikation überprüft.

Bewertungskriterien:
- Ist der identifizierte Korrespondent die Partei mit der tatsächlichen Geschäftsbeziehung?
- Bei Zahlungsdienstleister-Dokumenten: Ist der Korrespondent der Händler/Verkäufer, NICHT der Zahlungsdienstleister?
- Wenn als existierend markiert, passt er korrekt zu einem existierenden Korrespondenten?
- Wenn als neu markiert, gibt es wirklich keinen passenden existierenden Korrespondenten?
- Ist die Begründung schlüssig?

Bestätige, wenn der Korrespondent korrekt identifiziert wurde.
Ablehnen, wenn:
- Die falsche Partei identifiziert wurde
- Ein existierender Korrespondent statt eines neuen verwendet werden könnte
- Bei Zahlungsdienstleister-Dokumenten: Der Zahlungsdienstleister (PayPal, Stripe, etc.) statt des eigentlichen Händlers/Verkäufers gewählt wurde

Du MUSST mit strukturiertem JSON antworten: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const CorrespondentAgentGraphServiceLive = Layer.effect(
  CorrespondentAgentGraphService,
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

    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    const graphConfig: ConfirmationLoopConfig<CorrespondentAnalysis> = {
      agentName: 'correspondent',
      analysisSchema: CorrespondentAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as { existingCorrespondents: string[] };
        return `## Document Content

${state.content.slice(0, 8000)}

## Existing Correspondents

${ctx.existingCorrespondents.join(', ')}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Identify the correspondent (sender/creator) of this document. Use search tools to find similar documents if helpful.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        return `## Suggested Correspondent

${analysis.suggested_correspondent ?? 'None identified'}

## Is New Correspondent

${analysis.is_new ? 'Yes (needs to be created)' : 'No (existing correspondent)'}

## Reasoning

${analysis.reasoning}

## Confidence

${analysis.confidence}

## Alternatives

${analysis.alternatives.length ? analysis.alternatives.join(', ') : 'None'}

## Document Excerpt

${state.content.slice(0, 4000)}

Review this correspondent identification and provide your confirmation decision.`;
      },
    };

    return {
      name: 'correspondent' as const,

      process: (input: CorrespondentInput) =>
        Effect.gen(function* () {
          // Create logger to collect all events
          const logEntries: ConfirmationLoopLogEvent[] = [];
          const logger = (event: ConfirmationLoopLogEvent) => {
            logEntries.push(event);
          };

          // Log document context at start
          logger({
            eventType: 'prompt',
            data: {
              type: 'context',
              docId: input.docId,
              docTitle: input.docTitle,
              existingCorrespondents: input.existingCorrespondents,
            },
            timestamp: new Date().toISOString(),
          });

          // Create graph with logger
          const graphConfigWithLogger: ConfirmationLoopConfig<CorrespondentAnalysis> = {
            ...graphConfig,
            logger,
          };
          const graph = createConfirmationLoopGraph(graphConfigWithLogger);

          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.docTitle,
                content: input.content,
                context: { existingCorrespondents: input.existingCorrespondents },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `correspondent-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `Correspondent graph failed: ${e}`, agent: 'correspondent', cause: e }),
          });

          // Store all log entries (use captured timestamps and IDs)
          for (const entry of logEntries) {
            yield* tinybase.addProcessingLog({
              id: entry.id,
              docId: input.docId,
              timestamp: entry.timestamp,
              step: 'correspondent',
              eventType: entry.eventType as ProcessingLogEventType,
              data: entry.data,
              parentId: entry.parentId,
            });
          }

          const analysis = result.analysis as CorrespondentAnalysis | null;

          if (!result.success || !analysis || !analysis.suggested_correspondent) {
            yield* tinybase.addPendingReview({
              docId: input.docId,
              docTitle: input.docTitle,
              type: 'correspondent',
              suggestion: analysis?.suggested_correspondent ?? '',
              reasoning: analysis?.reasoning ?? result.error ?? 'Analysis failed',
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              lastFeedback: result.error ?? 'Max retries exceeded',
              nextTag: tagConfig.correspondentDone,
              metadata: analysis ? JSON.stringify({ isNew: analysis.is_new }) : null,
            });

            yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

            // Log result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'correspondent',
              eventType: 'result',
              data: {
                success: false,
                needsReview: true,
                reasoning: result.error ?? 'Confirmation failed',
                attempts: result.attempts,
              },
            });

            return {
              success: false,
              value: analysis?.suggested_correspondent ?? null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: analysis?.confidence ?? 0,
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Check if blocked
          const isBlocked = yield* tinybase.isBlocked(analysis.suggested_correspondent, 'correspondent');
          if (isBlocked) {
            // Log blocked result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'correspondent',
              eventType: 'result',
              data: {
                success: false,
                blocked: true,
                value: analysis.suggested_correspondent,
                reasoning: `Correspondent "${analysis.suggested_correspondent}" is blocked`,
              },
            });

            return {
              success: false,
              value: null,
              reasoning: `Correspondent "${analysis.suggested_correspondent}" is blocked`,
              confidence: 0,
              alternatives: analysis.alternatives,
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Apply the correspondent
          const correspondentId = yield* paperless.getOrCreateCorrespondent(analysis.suggested_correspondent);
          yield* paperless.updateDocument(input.docId, { correspondent: correspondentId });
          yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);

          // Log result
          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'correspondent',
            eventType: 'result',
            data: {
              success: true,
              value: analysis.suggested_correspondent,
              isNew: analysis.is_new,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: analysis.suggested_correspondent,
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: analysis.alternatives,
            attempts: result.attempts,
            needsReview: false,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Correspondent process failed: ${e}`, agent: 'correspondent', cause: e })
          )
        ),

      processStream: (input: CorrespondentInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('correspondent')));

            // Create logger to collect all events
            const logEntries: ConfirmationLoopLogEvent[] = [];
            const logger = (event: ConfirmationLoopLogEvent) => {
              logEntries.push(event);
            };

            // Log document context at start
            logger({
              eventType: 'prompt',
              data: {
                type: 'context',
                docId: input.docId,
                docTitle: input.docTitle,
                existingCorrespondents: input.existingCorrespondents,
              },
              timestamp: new Date().toISOString(),
            });

            // Create graph with logger
            const graphConfigWithLogger: ConfirmationLoopConfig<CorrespondentAnalysis> = {
              ...graphConfig,
              logger,
            };
            const graph = createConfirmationLoopGraph(graphConfigWithLogger);

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: { existingCorrespondents: input.existingCorrespondents },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `correspondent-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'correspondent' })));
              return;
            }

            let lastAnalysis: CorrespondentAnalysis | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as CorrespondentAnalysis;
                yield* Effect.sync(() => emit.single(emitAnalyzing('correspondent', `Attempt ${(state.attempt as number) ?? 1}`)));
                yield* Effect.sync(() => emit.single(emitThinking('correspondent', lastAnalysis!.reasoning)));
              }

              if (node === 'confirm' && lastAnalysis) {
                yield* Effect.sync(() => emit.single(emitConfirming('correspondent', lastAnalysis!.suggested_correspondent ?? 'None')));
              }

              if (node === 'apply' && lastAnalysis?.suggested_correspondent) {
                const correspondentId = yield* paperless.getOrCreateCorrespondent(lastAnalysis.suggested_correspondent);
                yield* paperless.updateDocument(input.docId, { correspondent: correspondentId });
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);
                yield* Effect.sync(() => emit.single(emitResult('correspondent', {
                  success: true,
                  value: lastAnalysis!.suggested_correspondent,
                  isNew: lastAnalysis!.is_new,
                })));

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'correspondent',
                  eventType: 'result',
                  data: {
                    success: true,
                    value: lastAnalysis.suggested_correspondent,
                    isNew: lastAnalysis.is_new,
                    reasoning: lastAnalysis.reasoning,
                    confidence: lastAnalysis.confidence,
                  },
                });
              }

              if (node === 'queue_review') {
                yield* tinybase.addPendingReview({
                  docId: input.docId,
                  docTitle: input.docTitle,
                  type: 'correspondent',
                  suggestion: lastAnalysis?.suggested_correspondent ?? '',
                  reasoning: lastAnalysis?.reasoning ?? 'Analysis failed',
                  alternatives: lastAnalysis?.alternatives ?? [],
                  attempts: autoProcessing.confirmationMaxRetries,
                  lastFeedback: 'Max retries exceeded',
                  nextTag: tagConfig.correspondentDone,
                  metadata: lastAnalysis ? JSON.stringify({ isNew: lastAnalysis.is_new }) : null,
                });
                yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);
                yield* Effect.sync(() => emit.single(emitResult('correspondent', { success: false, needsReview: true })));

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'correspondent',
                  eventType: 'result',
                  data: {
                    success: false,
                    needsReview: true,
                    reasoning: 'Max retries exceeded',
                  },
                });
              }
            }

            // Store all log entries (use captured timestamps and IDs)
            for (const entry of logEntries) {
              yield* tinybase.addProcessingLog({
                id: entry.id,
                docId: input.docId,
                timestamp: entry.timestamp,
                step: 'correspondent',
                eventType: entry.eventType as ProcessingLogEventType,
                data: entry.data,
                parentId: entry.parentId,
              });
            }

            yield* Effect.sync(() => emit.single(emitComplete('correspondent')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) => new AgentError({ message: `Correspondent stream failed: ${e}`, agent: 'correspondent', cause: e }))
          )
        ),
    };
  })
);
