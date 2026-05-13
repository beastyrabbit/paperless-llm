/**
 * Compatibility title agent. New processing uses PiDocumentAgent.
 */
import { Context, Effect, Layer, Stream } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import { type Agent, type AgentProcessResult, type StreamEvent, emitComplete, emitError, emitResult, emitStart } from './base.js';

export interface TitleInput {
  docId: number;
  content: string;
  existingTitle?: string;
  similarTitles?: string[];
}

export interface TitleAgentGraphService extends Agent<TitleInput, AgentProcessResult> {
  readonly name: 'title';
  readonly process: (input: TitleInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: TitleInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TitleAgentGraphService = Context.GenericTag<TitleAgentGraphService>('TitleAgentGraphService');

const deriveTitle = (input: TitleInput): string =>
  (input.existingTitle?.trim() || input.content.split(/\r?\n/).find((line) => line.trim())?.trim() || `Document ${input.docId}`).slice(0, 200);

export const TitleAgentGraphServiceLive = Layer.effect(
  TitleAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const process = (input: TitleInput) =>
      Effect.gen(function* () {
        const title = deriveTitle(input);
        yield* paperless.updateDocument(input.docId, { title });
        yield* paperless.transitionDocumentTag(input.docId, tagConfig.summaryDone, tagConfig.titleDone).pipe(Effect.catchAll(() => Effect.void));
        yield* tinybase.addProcessingLog({
          docId: input.docId,
          timestamp: new Date().toISOString(),
          step: 'title',
          eventType: 'result',
          data: { success: true, title, compatibility: true },
        }).pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value: title,
          reasoning: 'Compatibility title selected from existing title or first content line.',
          confidence: 0.5,
          alternatives: input.similarTitles ?? [],
          attempts: 1,
          needsReview: false,
        };
      }).pipe(Effect.mapError((error) => new AgentError({ message: `Title compatibility agent failed: ${String(error)}`, agent: 'title', cause: error })));

    return {
      name: 'title' as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) => Effect.sync(() => {
              emit.single(emitStart('title'));
              emit.single(emitResult('title', result));
              emit.single(emitComplete('title'));
              emit.end();
            })),
            Effect.catchAll((error) => Effect.sync(() => {
              emit.single(emitError('title', String(error)));
              emit.end();
            }))
          )
        ),
    };
  })
);
