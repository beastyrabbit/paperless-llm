/**
 * Schema API handlers.
 *
 * Stub implementations for blocked suggestions endpoints.
 */
import { Effect } from 'effect';

// ===========================================================================
// Blocked Suggestions
// ===========================================================================

export const getBlocked = (blockType?: string) =>
  Effect.succeed([]);

export const blockSuggestion = (data: {
  name: string;
  block_type: string;
  reason?: string;
}) =>
  Effect.succeed({
    id: Date.now(),
    name: data.name,
    block_type: data.block_type,
    reason: data.reason ?? null,
    created_at: new Date().toISOString(),
  });

export const unblock = (id: number) =>
  Effect.succeed(undefined);

export const checkBlocked = (name: string, blockType: string) =>
  Effect.succeed({ is_blocked: false });
