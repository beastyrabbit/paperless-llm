/**
 * Schema Analysis Agent for suggesting new entities.
 *
 * This agent analyzes documents and suggests new correspondents, document types,
 * or tags that could be added to improve the schema.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import { ConfigService, OllamaService, PromptService, TinyBaseService, PaperlessService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import {
  type Agent,
  type StreamEvent,
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitResult,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface SchemaAnalysisInput {
  docId: number;
  content: string;
  pendingSuggestions?: {
    correspondent: string[];
    document_type: string[];
    tag: string[];
  };
}

export interface SchemaSuggestion {
  entityType: 'correspondent' | 'document_type' | 'tag';
  suggestedName: string;
  reasoning: string;
  confidence: number;
  similarToExisting: string[];
}

export interface PendingMatch {
  entityType: 'correspondent' | 'document_type' | 'tag';
  matchedName: string;
}

export interface SchemaAnalysisResult {
  docId: number;
  hasSuggestions: boolean;
  suggestions: SchemaSuggestion[];
  matchesPending: PendingMatch[];
  reasoning: string;
  noSuggestionsReason?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface SchemaAnalysisAgentService extends Agent<SchemaAnalysisInput, SchemaAnalysisResult> {
  readonly name: 'schema_analysis';
  readonly process: (input: SchemaAnalysisInput) => Effect.Effect<SchemaAnalysisResult, AgentError>;
  readonly processStream: (input: SchemaAnalysisInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const SchemaAnalysisAgentService = Context.GenericTag<SchemaAnalysisAgentService>('SchemaAnalysisAgentService');

// ===========================================================================
// Response Parser
// ===========================================================================

const parseAnalysisResponse = (response: string): {
  suggestions: SchemaSuggestion[];
  matchesPending: PendingMatch[];
  reasoning: string;
  noSuggestionsReason?: string;
} => {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        suggestions?: Array<{
          entity_type?: string;
          entityType?: string;
          suggested_name?: string;
          suggestedName?: string;
          reasoning?: string;
          confidence?: number;
          similar_to_existing?: string[];
          similarToExisting?: string[];
        }>;
        matches_pending?: Array<{
          entity_type?: string;
          entityType?: string;
          matched_name?: string;
          matchedName?: string;
        }>;
        matchesPending?: Array<{
          entity_type?: string;
          entityType?: string;
          matched_name?: string;
          matchedName?: string;
        }>;
        reasoning?: string;
        no_suggestions_reason?: string;
        noSuggestionsReason?: string;
      };

      const suggestions = (parsed.suggestions ?? []).map((s) => ({
        entityType: (s.entity_type ?? s.entityType ?? 'tag') as SchemaSuggestion['entityType'],
        suggestedName: s.suggested_name ?? s.suggestedName ?? '',
        reasoning: s.reasoning ?? '',
        confidence: s.confidence ?? 0.5,
        similarToExisting: s.similar_to_existing ?? s.similarToExisting ?? [],
      }));

      const matchesPending = (parsed.matches_pending ?? parsed.matchesPending ?? []).map((m) => ({
        entityType: (m.entity_type ?? m.entityType ?? 'tag') as PendingMatch['entityType'],
        matchedName: m.matched_name ?? m.matchedName ?? '',
      }));

      return {
        suggestions,
        matchesPending,
        reasoning: parsed.reasoning ?? '',
        noSuggestionsReason: parsed.no_suggestions_reason ?? parsed.noSuggestionsReason,
      };
    }
  } catch {
    // Fall back to empty
  }

  return {
    suggestions: [],
    matchesPending: [],
    reasoning: 'Could not parse response',
  };
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const SchemaAnalysisAgentServiceLive = Layer.effect(
  SchemaAnalysisAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    // Helper to get blocked names for a type
    const getBlockedNames = (blockType: string): Effect.Effect<Set<string>, never> =>
      Effect.gen(function* () {
        const blocked = yield* tinybase.getBlockedSuggestions(blockType as any);
        return new Set(blocked.map((b) => b.normalizedName));
      }).pipe(Effect.catchAll(() => Effect.succeed(new Set<string>())));

    // Filter out blocked suggestions
    const filterBlockedSuggestions = (
      suggestions: SchemaSuggestion[],
      blockedCorrespondents: Set<string>,
      blockedDocTypes: Set<string>,
      blockedTags: Set<string>,
      blockedGlobal: Set<string>
    ): SchemaSuggestion[] => {
      return suggestions.filter((s) => {
        const normalized = s.suggestedName.trim().toLowerCase();

        // Check global blocklist
        if (blockedGlobal.has(normalized)) return false;

        // Check type-specific blocklist
        if (s.entityType === 'correspondent' && blockedCorrespondents.has(normalized)) return false;
        if (s.entityType === 'document_type' && blockedDocTypes.has(normalized)) return false;
        if (s.entityType === 'tag' && blockedTags.has(normalized)) return false;

        return true;
      });
    };

    return {
      name: 'schema_analysis' as const,

      process: (input: SchemaAnalysisInput) =>
        Effect.gen(function* () {
          const { docId, content, pendingSuggestions = { correspondent: [], document_type: [], tag: [] } } = input;

          // Get existing entities from Paperless
          const [correspondents, docTypes, tags] = yield* Effect.all([
            paperless.getCorrespondents(),
            paperless.getDocumentTypes(),
            paperless.getTags(),
          ]);

          const correspondentNames = correspondents.map((c) => c.name);
          const docTypeNames = docTypes.map((dt) => dt.name);
          const tagNames = tags.map((t) => t.name);

          // Get blocked suggestions
          const [blockedCorrespondents, blockedDocTypes, blockedTags, blockedGlobal] = yield* Effect.all([
            getBlockedNames('correspondent'),
            getBlockedNames('document_type'),
            getBlockedNames('tag'),
            getBlockedNames('global'),
          ]);

          // Format existing entities for prompt
          const correspondentsList = correspondentNames.join(', ') || 'None yet';
          const docTypesList = docTypeNames.join(', ') || 'None yet';
          const tagsList = tagNames.join(', ') || 'None yet';

          // Format blocked lists
          const blockedCorrespondentsList = [...blockedCorrespondents].sort().join(', ') || 'None';
          const blockedDocTypesList = [...blockedDocTypes].sort().join(', ') || 'None';
          const blockedTagsList = [...blockedTags].sort().join(', ') || 'None';
          const blockedGlobalList = [...blockedGlobal].sort().join(', ') || 'None';

          // Format pending suggestions
          const pendingCorrespondentsList = pendingSuggestions.correspondent.join(', ') || 'None';
          const pendingDocTypesList = pendingSuggestions.document_type.join(', ') || 'None';
          const pendingTagsList = pendingSuggestions.tag.join(', ') || 'None';

          const prompt = yield* prompts.renderPrompt('schema_analysis', {
            document_content: content.slice(0, 8000),
            existing_correspondents: correspondentsList,
            existing_document_types: docTypesList,
            existing_tags: tagsList,
            blocked_correspondents: blockedCorrespondentsList,
            blocked_document_types: blockedDocTypesList,
            blocked_tags: blockedTagsList,
            blocked_global: blockedGlobalList,
            pending_correspondents: pendingCorrespondentsList,
            pending_document_types: pendingDocTypesList,
            pending_tags: pendingTagsList,
          });

          const response = yield* ollama.generate(
            ollama.getModel('large'),
            prompt,
            { temperature: 0.1 }
          );

          const analysis = parseAnalysisResponse(response);

          // Filter out blocked suggestions
          const filteredSuggestions = filterBlockedSuggestions(
            analysis.suggestions,
            blockedCorrespondents,
            blockedDocTypes,
            blockedTags,
            blockedGlobal
          );

          return {
            docId,
            hasSuggestions: filteredSuggestions.length > 0,
            suggestions: filteredSuggestions,
            matchesPending: analysis.matchesPending,
            reasoning: analysis.reasoning,
            noSuggestionsReason: analysis.noSuggestionsReason,
          };
        }).pipe(
          Effect.mapError((e) =>
            new AgentError({
              message: `Schema analysis failed: ${e}`,
              agent: 'schema_analysis',
              cause: e,
            })
          )
        ),

      processStream: (input: SchemaAnalysisInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const { docId, content, pendingSuggestions = { correspondent: [], document_type: [], tag: [] } } = input;

            yield* Effect.sync(() => emit.single(emitStart('schema_analysis')));
            yield* Effect.sync(() =>
              emit.single(emitAnalyzing('schema_analysis', 'Fetching existing entities'))
            );

            // Get existing entities
            const [correspondents, docTypes, tags] = yield* Effect.all([
              paperless.getCorrespondents(),
              paperless.getDocumentTypes(),
              paperless.getTags(),
            ]);

            const correspondentNames = correspondents.map((c) => c.name);
            const docTypeNames = docTypes.map((dt) => dt.name);
            const tagNames = tags.map((t) => t.name);

            // Get blocked suggestions
            const [blockedCorrespondents, blockedDocTypes, blockedTags, blockedGlobal] = yield* Effect.all([
              getBlockedNames('correspondent'),
              getBlockedNames('document_type'),
              getBlockedNames('tag'),
              getBlockedNames('global'),
            ]);

            yield* Effect.sync(() =>
              emit.single(emitAnalyzing('schema_analysis', 'Analyzing document for schema improvements'))
            );

            // Format for prompt
            const correspondentsList = correspondentNames.join(', ') || 'None yet';
            const docTypesList = docTypeNames.join(', ') || 'None yet';
            const tagsList = tagNames.join(', ') || 'None yet';

            const blockedCorrespondentsList = [...blockedCorrespondents].sort().join(', ') || 'None';
            const blockedDocTypesList = [...blockedDocTypes].sort().join(', ') || 'None';
            const blockedTagsList = [...blockedTags].sort().join(', ') || 'None';
            const blockedGlobalList = [...blockedGlobal].sort().join(', ') || 'None';

            const pendingCorrespondentsList = pendingSuggestions.correspondent.join(', ') || 'None';
            const pendingDocTypesList = pendingSuggestions.document_type.join(', ') || 'None';
            const pendingTagsList = pendingSuggestions.tag.join(', ') || 'None';

            const prompt = yield* prompts.renderPrompt('schema_analysis', {
              document_content: content.slice(0, 8000),
              existing_correspondents: correspondentsList,
              existing_document_types: docTypesList,
              existing_tags: tagsList,
              blocked_correspondents: blockedCorrespondentsList,
              blocked_document_types: blockedDocTypesList,
              blocked_tags: blockedTagsList,
              blocked_global: blockedGlobalList,
              pending_correspondents: pendingCorrespondentsList,
              pending_document_types: pendingDocTypesList,
              pending_tags: pendingTagsList,
            });

            const response = yield* ollama.generate(
              ollama.getModel('large'),
              prompt,
              { temperature: 0.1 }
            );

            const analysis = parseAnalysisResponse(response);

            yield* Effect.sync(() =>
              emit.single(emitThinking('schema_analysis', analysis.reasoning))
            );

            // Filter out blocked suggestions
            const filteredSuggestions = filterBlockedSuggestions(
              analysis.suggestions,
              blockedCorrespondents,
              blockedDocTypes,
              blockedTags,
              blockedGlobal
            );

            yield* Effect.sync(() =>
              emit.single(
                emitResult('schema_analysis', {
                  docId,
                  hasSuggestions: filteredSuggestions.length > 0,
                  suggestions: filteredSuggestions,
                  matchesPending: analysis.matchesPending,
                  reasoning: analysis.reasoning,
                  noSuggestionsReason: analysis.noSuggestionsReason,
                })
              )
            );

            yield* Effect.sync(() => emit.single(emitComplete('schema_analysis')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Schema analysis stream failed: ${e}`,
                agent: 'schema_analysis',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
