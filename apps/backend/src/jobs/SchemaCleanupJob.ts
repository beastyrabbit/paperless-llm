/**
 * Schema cleanup job - applies approved schema changes (merges, deletes).
 */
import { Context, Effect, Layer, Ref } from "effect";
import { PiConsolidationAgentService } from "../agents/PiConsolidationAgent.js";
import { JobError } from "../errors/index.js";

// ===========================================================================
// Types
// ===========================================================================

export interface SchemaCleanupProgress {
  status: "idle" | "running" | "completed" | "error";
  total: number;
  processed: number;
  merged: number;
  deleted: number;
  errors: number;
  startedAt: string | null;
  completedAt: string | null;
}

export interface SchemaCleanupResult {
  merged: number;
  deleted: number;
  errors: number;
  reportId?: string;
  proposals?: number;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface SchemaCleanupJobService {
  readonly run: () => Effect.Effect<SchemaCleanupResult, JobError>;
  readonly getStatus: () => Effect.Effect<SchemaCleanupProgress, never>;
}

export const SchemaCleanupJobService =
  Context.GenericTag<SchemaCleanupJobService>("SchemaCleanupJobService");

// ===========================================================================
// Live Implementation
// ===========================================================================

export const SchemaCleanupJobServiceLive = Layer.effect(
  SchemaCleanupJobService,
  Effect.gen(function* () {
    const consolidationAgent = yield* PiConsolidationAgentService;

    const progressRef = yield* Ref.make<SchemaCleanupProgress>({
      status: "idle",
      total: 0,
      processed: 0,
      merged: 0,
      deleted: 0,
      errors: 0,
      startedAt: null,
      completedAt: null,
    });

    return {
      run: () =>
        Effect.gen(function* () {
          yield* Ref.set(progressRef, {
            status: "running",
            total: 0,
            processed: 0,
            merged: 0,
            deleted: 0,
            errors: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
          });

          const reportResult = yield* Effect.either(consolidationAgent.generateReport());
          if (reportResult._tag === "Left") {
            yield* Ref.update(progressRef, (p) => ({
              ...p,
              status: "error" as const,
              completedAt: new Date().toISOString(),
            }));

            return yield* Effect.fail(
              new JobError({
                message: `Schema cleanup failed: ${reportResult.left}`,
                jobName: "schema_cleanup",
                cause: reportResult.left,
              }),
            );
          }

          const report = reportResult.right;

          yield* Ref.update(progressRef, (p) => ({
            ...p,
            total: report.proposals.length,
            processed: report.proposals.length,
          }));

          yield* Ref.update(progressRef, (p) => ({
            ...p,
            status: "completed" as const,
            completedAt: new Date().toISOString(),
          }));

          return {
            merged: 0,
            deleted: 0,
            errors: 0,
            reportId: report.id,
            proposals: report.proposals.length,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof JobError
              ? e
              : new JobError({
                  message: `Schema cleanup failed: ${e}`,
                  jobName: "schema_cleanup",
                  cause: e,
                }),
          ),
        ),

      getStatus: () => Ref.get(progressRef),
    };
  }),
);
