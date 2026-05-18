/**
 * Bootstrap job compatibility shell.
 *
 * Catalog discovery has moved to the manual consolidation agent. This job keeps
 * the existing API contract while no longer invoking legacy graph processing.
 */
import { Context, Effect, Fiber, Layer, Ref } from "effect";
import { JobError } from "../errors/index.js";
import { PaperlessService, TinyBaseService } from "../services/index.js";

export type AnalysisType = "all" | "correspondents" | "document_types" | "tags";

export interface SuggestionsByType {
  correspondents: number;
  documentTypes: number;
  tags: number;
}

export interface BootstrapProgress {
  status: "idle" | "running" | "completed" | "cancelled" | "error";
  analysisType: AnalysisType;
  total: number;
  processed: number;
  suggestionsFound: number;
  suggestionsByType: SuggestionsByType;
  errors: number;
  currentDocId: number | null;
  currentDocTitle: string | null;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  totalDocuments: number | null;
  currentEntityCount: number | null;
  avgSecondsPerDocument: number | null;
  estimatedRemainingSeconds: number | null;
}

export interface BootstrapJobService {
  readonly start: (analysisType: AnalysisType) => Effect.Effect<void, JobError>;
  readonly getProgress: () => Effect.Effect<BootstrapProgress, never>;
  readonly cancel: () => Effect.Effect<void, never>;
  readonly skip: (count?: number) => Effect.Effect<void, never>;
}

export const BootstrapJobService = Context.GenericTag<BootstrapJobService>("BootstrapJobService");

const emptySuggestions = (): SuggestionsByType => ({
  correspondents: 0,
  documentTypes: 0,
  tags: 0,
});

export const BootstrapJobServiceLive = Layer.effect(
  BootstrapJobService,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const progressRef = yield* Ref.make<BootstrapProgress>({
      status: "idle",
      analysisType: "all",
      total: 0,
      processed: 0,
      suggestionsFound: 0,
      suggestionsByType: emptySuggestions(),
      errors: 0,
      currentDocId: null,
      currentDocTitle: null,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      totalDocuments: null,
      currentEntityCount: null,
      avgSecondsPerDocument: null,
      estimatedRemainingSeconds: null,
    });
    const cancelRef = yield* Ref.make(false);
    const skipRef = yield* Ref.make(0);
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);

    const run = (_analysisType: AnalysisType): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        const started = Date.now();
        try {
          const [documents, totalDocuments, correspondents, documentTypes, tags] =
            yield* Effect.all(
              [
                paperless
                  .getDocuments({ page: 1, pageSize: 1000 })
                  .pipe(Effect.catchAll(() => Effect.succeed([]))),
                paperless.getTotalDocumentCount().pipe(Effect.catchAll(() => Effect.succeed(0))),
                paperless.getCorrespondents().pipe(Effect.catchAll(() => Effect.succeed([]))),
                paperless.getDocumentTypes().pipe(Effect.catchAll(() => Effect.succeed([]))),
                paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
              ],
              { concurrency: "unbounded" },
            );

          yield* Ref.update(progressRef, (progress) => ({
            ...progress,
            total: documents.length,
            totalDocuments,
            currentEntityCount: correspondents.length + documentTypes.length + tags.length,
          }));

          for (const doc of documents) {
            if (yield* Ref.get(cancelRef)) {
              yield* Ref.update(progressRef, (progress) => ({
                ...progress,
                status: "cancelled" as const,
                currentDocId: null,
                currentDocTitle: null,
                completedAt: new Date().toISOString(),
              }));
              return;
            }

            const skipCount = yield* Ref.get(skipRef);
            if (skipCount > 0) {
              yield* Ref.update(skipRef, (count) => count - 1);
              yield* Ref.update(progressRef, (progress) => ({
                ...progress,
                processed: progress.processed + 1,
              }));
              continue;
            }

            yield* Ref.update(progressRef, (progress) => ({
              ...progress,
              currentDocId: doc.id,
              currentDocTitle: doc.title,
            }));

            yield* tinybase
              .addProcessingLog({
                docId: doc.id,
                timestamp: new Date().toISOString(),
                step: "bootstrap",
                eventType: "result",
                data: {
                  compatibility: true,
                  message: "Bootstrap discovery is disabled; use manual consolidation.",
                },
              })
              .pipe(Effect.catchAll(() => Effect.void));

            yield* Ref.update(progressRef, (progress) => {
              const processed = progress.processed + 1;
              const elapsedSeconds = (Date.now() - started) / 1000;
              const avgSecondsPerDocument = processed > 0 ? elapsedSeconds / processed : null;
              const remaining = progress.total - processed;
              return {
                ...progress,
                processed,
                avgSecondsPerDocument,
                estimatedRemainingSeconds:
                  avgSecondsPerDocument === null ? null : remaining * avgSecondsPerDocument,
              };
            });
          }

          yield* Ref.update(progressRef, (progress) => ({
            ...progress,
            status: "completed" as const,
            currentDocId: null,
            currentDocTitle: null,
            completedAt: new Date().toISOString(),
          }));
        } catch (error) {
          yield* Ref.update(progressRef, (progress) => ({
            ...progress,
            status: "error" as const,
            currentDocId: null,
            currentDocTitle: null,
            completedAt: new Date().toISOString(),
            errorMessage: String(error),
          }));
        }
      }).pipe(Effect.catchAll(() => Effect.void));

    return {
      start: (analysisType) =>
        Effect.gen(function* () {
          const progress = yield* Ref.get(progressRef);
          if (progress.status === "running") {
            return yield* Effect.fail(
              new JobError({ message: "Bootstrap job already running", jobName: "bootstrap" }),
            );
          }

          yield* Ref.set(cancelRef, false);
          yield* Ref.set(skipRef, 0);
          yield* Ref.set(progressRef, {
            status: "running",
            analysisType,
            total: 0,
            processed: 0,
            suggestionsFound: 0,
            suggestionsByType: emptySuggestions(),
            errors: 0,
            currentDocId: null,
            currentDocTitle: null,
            startedAt: new Date().toISOString(),
            completedAt: null,
            errorMessage: null,
            totalDocuments: null,
            currentEntityCount: null,
            avgSecondsPerDocument: null,
            estimatedRemainingSeconds: null,
          });

          const fiber = yield* Effect.forkDaemon(run(analysisType));
          yield* Ref.set(fiberRef, fiber as Fiber.RuntimeFiber<void, never>);
        }).pipe(
          Effect.mapError((error) =>
            error instanceof JobError
              ? error
              : new JobError({
                  message: `Bootstrap start failed: ${String(error)}`,
                  jobName: "bootstrap",
                  cause: error,
                }),
          ),
        ),

      getProgress: () => Ref.get(progressRef),

      cancel: () =>
        Effect.gen(function* () {
          yield* Ref.set(cancelRef, true);
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
          }
          yield* Ref.update(progressRef, (progress) => ({
            ...progress,
            status: progress.status === "running" ? "cancelled" : progress.status,
            completedAt:
              progress.status === "running" ? new Date().toISOString() : progress.completedAt,
          }));
        }).pipe(Effect.catchAll(() => Effect.void)),

      skip: (count = 1) => Ref.update(skipRef, (current) => current + Math.max(1, count)),
    };
  }),
);
