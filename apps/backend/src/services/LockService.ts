/**
 * Durable processing locks backed by TinyBase.
 */
import { Context, Effect, Layer } from "effect";
import { DatabaseError } from "../errors/index.js";
import { TinyBaseService } from "./TinyBaseService.js";

export type LockScope = "document" | "catalog";

export interface DurableLock {
  id: string;
  scope: LockScope;
  resourceId: string;
  owner: string;
  runId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
}

export interface LockAcquireInput {
  scope: LockScope;
  resourceId: string | number;
  owner: string;
  runId?: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface LockAcquireResult {
  acquired: boolean;
  lock: DurableLock;
  staleRecovered: boolean;
}

export interface LockService {
  readonly acquire: (input: LockAcquireInput) => Effect.Effect<LockAcquireResult, DatabaseError>;
  readonly release: (
    scope: LockScope,
    resourceId: string | number,
    runId: string,
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly forceRelease: (
    scope: LockScope,
    resourceId: string | number,
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly get: (
    scope: LockScope,
    resourceId: string | number,
  ) => Effect.Effect<DurableLock | null, DatabaseError>;
  readonly heartbeat: (
    scope: LockScope,
    resourceId: string | number,
    runId: string,
    ttlMs?: number,
  ) => Effect.Effect<DurableLock | null, DatabaseError>;
  readonly list: () => Effect.Effect<DurableLock[], DatabaseError>;
  readonly pruneStale: () => Effect.Effect<number, DatabaseError>;
}

export const LockService = Context.GenericTag<LockService>("LockService");

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

const lockId = (scope: LockScope, resourceId: string | number): string =>
  `${scope}:${String(resourceId)}`;

const generateRunId = (scope: LockScope, resourceId: string | number): string =>
  `${scope}-${String(resourceId)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const rowToLock = (id: string, row: Record<string, unknown> | undefined): DurableLock | null => {
  if (!row || Object.keys(row).length === 0) return null;
  return {
    id,
    scope: row["scope"] as LockScope,
    resourceId: String(row["resourceId"] ?? ""),
    owner: String(row["owner"] ?? ""),
    runId: String(row["runId"] ?? ""),
    acquiredAt: String(row["acquiredAt"] ?? ""),
    heartbeatAt: String(row["heartbeatAt"] ?? ""),
    expiresAt: String(row["expiresAt"] ?? ""),
    metadata: parseJsonObject(row["metadata"]),
  };
};

export const LockServiceLive = Layer.effect(
  LockService,
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const { store } = tinybase;

    const writeLock = (lock: DurableLock): void => {
      store.setRow("locks", lock.id, {
        id: lock.id,
        scope: lock.scope,
        resourceId: lock.resourceId,
        owner: lock.owner,
        runId: lock.runId,
        acquiredAt: lock.acquiredAt,
        heartbeatAt: lock.heartbeatAt,
        expiresAt: lock.expiresAt,
        metadata: JSON.stringify(lock.metadata),
      });
    };

    return {
      acquire: (input) =>
        Effect.try({
          try: (): LockAcquireResult => {
            const id = lockId(input.scope, input.resourceId);
            const nowMs = Date.now();
            const existing = rowToLock(id, store.getRow("locks", id));
            const existingExpiry = existing ? Date.parse(existing.expiresAt) : Number.NaN;

            if (existing && Number.isFinite(existingExpiry) && existingExpiry > nowMs) {
              return { acquired: false, lock: existing, staleRecovered: false };
            }

            const now = new Date(nowMs).toISOString();
            const lock: DurableLock = {
              id,
              scope: input.scope,
              resourceId: String(input.resourceId),
              owner: input.owner,
              runId: input.runId ?? generateRunId(input.scope, input.resourceId),
              acquiredAt: now,
              heartbeatAt: now,
              expiresAt: new Date(nowMs + (input.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString(),
              metadata: input.metadata ?? {},
            };
            writeLock(lock);
            return { acquired: true, lock, staleRecovered: existing !== null };
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to acquire ${input.scope} lock: ${String(error)}`,
              operation: "acquireLock",
              cause: error,
            }),
        }),

      release: (scope, resourceId, runId) =>
        Effect.try({
          try: () => {
            const id = lockId(scope, resourceId);
            const existing = rowToLock(id, store.getRow("locks", id));
            if (!existing) return false;
            if (runId.trim().length === 0 || existing.runId !== runId) return false;
            store.delRow("locks", id);
            return true;
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to release ${scope} lock: ${String(error)}`,
              operation: "releaseLock",
              cause: error,
            }),
        }),

      forceRelease: (scope, resourceId) =>
        Effect.try({
          try: () => {
            const id = lockId(scope, resourceId);
            const existing = rowToLock(id, store.getRow("locks", id));
            if (!existing) return false;
            store.delRow("locks", id);
            return true;
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to force release ${scope} lock: ${String(error)}`,
              operation: "forceReleaseLock",
              cause: error,
            }),
        }),

      get: (scope, resourceId) =>
        Effect.try({
          try: () =>
            rowToLock(lockId(scope, resourceId), store.getRow("locks", lockId(scope, resourceId))),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to get ${scope} lock: ${String(error)}`,
              operation: "getLock",
              cause: error,
            }),
        }),

      heartbeat: (scope, resourceId, runId, ttlMs) =>
        Effect.try({
          try: () => {
            const id = lockId(scope, resourceId);
            const existing = rowToLock(id, store.getRow("locks", id));
            if (!existing || existing.runId !== runId) return null;
            const nowMs = Date.now();
            const heartbeatAt = new Date(nowMs).toISOString();
            const refreshed: DurableLock = {
              ...existing,
              heartbeatAt,
              expiresAt: new Date(nowMs + (ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString(),
            };
            writeLock(refreshed);
            return refreshed;
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to heartbeat ${scope} lock: ${String(error)}`,
              operation: "heartbeatLock",
              cause: error,
            }),
        }),

      list: () =>
        Effect.try({
          try: () =>
            Object.entries(store.getTable("locks") ?? {})
              .map(([id, row]) => rowToLock(id, row))
              .filter((lock): lock is DurableLock => lock !== null),
          catch: (error) =>
            new DatabaseError({
              message: `Failed to list locks: ${String(error)}`,
              operation: "listLocks",
              cause: error,
            }),
        }),

      pruneStale: () =>
        Effect.try({
          try: () => {
            const now = Date.now();
            let pruned = 0;
            for (const [id, row] of Object.entries(store.getTable("locks") ?? {})) {
              const lock = rowToLock(id, row);
              if (!lock) continue;
              const expiresAt = Date.parse(lock.expiresAt);
              if (!Number.isFinite(expiresAt) || expiresAt <= now) {
                store.delRow("locks", id);
                pruned++;
              }
            }
            return pruned;
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to prune stale locks: ${String(error)}`,
              operation: "pruneStaleLocks",
              cause: error,
            }),
        }),
    };
  }),
);
