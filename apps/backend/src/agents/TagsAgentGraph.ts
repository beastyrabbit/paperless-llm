/**
 * Compatibility tags agent. New processing uses PiDocumentAgent.
 */
import { Context, Effect, Layer, Stream } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import { type Agent, type AgentProcessResult, type StreamEvent, emitComplete, emitError, emitResult, emitStart } from './base.js';

export interface TagsInput {
  docId: number;
  content: string;
  docTitle: string;
  documentType?: string;
  existingTags: string[];
  currentTagIds: number[];
}

export interface TagsResult extends AgentProcessResult {
  tags: string[];
  newTags: string[];
  removedTags: string[];
  newTagsQueued: string[];
}

export interface TagsAgentGraphService extends Agent<TagsInput, TagsResult> {
  readonly name: 'tags';
  readonly process: (input: TagsInput) => Effect.Effect<TagsResult, AgentError>;
  readonly processStream: (input: TagsInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TagsAgentGraphService = Context.GenericTag<TagsAgentGraphService>('TagsAgentGraphService');

export const TagsAgentGraphServiceLive = Layer.effect(
  TagsAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const process = (input: TagsInput) =>
      Effect.gen(function* () {
        const tags = input.existingTags.slice(0, 3);
        for (const tag of tags) {
          yield* paperless.addTagToDocument(input.docId, tag).pipe(Effect.catchAll(() => Effect.void));
        }
        yield* paperless.transitionDocumentTag(input.docId, tagConfig.documentTypeDone, tagConfig.tagsDone).pipe(Effect.catchAll(() => Effect.void));
        yield* tinybase.addProcessingLog({
          docId: input.docId,
          timestamp: new Date().toISOString(),
          step: 'tags',
          eventType: 'result',
          data: { success: true, tags, compatibility: true },
        }).pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value: tags.join(', '),
          reasoning: 'Compatibility tags agent only reuses existing tags.',
          confidence: tags.length > 0 ? 0.4 : 0,
          alternatives: input.existingTags.slice(0, 5),
          attempts: 1,
          needsReview: false,
          tags,
          newTags: [],
          removedTags: [],
          newTagsQueued: [],
        };
      }).pipe(Effect.mapError((error) => new AgentError({ message: `Tags compatibility agent failed: ${String(error)}`, agent: 'tags', cause: error })));

    return {
      name: 'tags' as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) => Effect.sync(() => {
              emit.single(emitStart('tags'));
              emit.single(emitResult('tags', result));
              emit.single(emitComplete('tags'));
              emit.end();
            })),
            Effect.catchAll((error) => Effect.sync(() => {
              emit.single(emitError('tags', String(error)));
              emit.end();
            }))
          )
        ),
    };
  })
);
