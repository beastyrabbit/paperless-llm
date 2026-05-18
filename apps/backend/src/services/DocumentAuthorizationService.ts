import { Context, Effect, Layer } from "effect";
import { NotFoundError, PaperlessError } from "../errors/index.js";
import { PaperlessService } from "./PaperlessService.js";

export type DocumentAuthorizationAction = "view" | "process" | "change" | "admin";

export interface DocumentAuthorization {
  readonly authorizeDocument: (
    docId: number,
    action: DocumentAuthorizationAction,
  ) => Effect.Effect<void, NotFoundError>;
  readonly filterAuthorizedDocuments: <T>(
    items: ReadonlyArray<T>,
    getDocId: (item: T) => number | null | undefined,
    action: DocumentAuthorizationAction,
  ) => Effect.Effect<T[], never>;
}

export class DocumentAuthorizationService extends Context.Tag("DocumentAuthorizationService")<
  DocumentAuthorizationService,
  DocumentAuthorization
>() {}

const isPaperlessBackedMode = () => {
  const mode = process.env["PAPERLESS_LLM_DOCUMENT_AUTHORIZATION"]?.trim().toLowerCase();
  return mode === "paperless" || mode === "paperless-view" || mode === "upstream";
};

const toDeniedDocumentError = (docId: number, error: unknown) => {
  if (error instanceof NotFoundError || (error as { _tag?: string })?._tag === "NotFoundError") {
    return new NotFoundError({
      message: `Document ${docId} not found`,
      resource: "document",
      id: docId,
    });
  }
  if (
    error instanceof PaperlessError ||
    (error as { _tag?: string })?._tag === "PaperlessError"
  ) {
    const statusCode = (error as PaperlessError).statusCode;
    if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
      return new NotFoundError({
        message: `Document ${docId} not found`,
        resource: "document",
        id: docId,
      });
    }
  }
  return new NotFoundError({
    message: `Document ${docId} is not authorized`,
    resource: "document",
    id: docId,
  });
};

export const DocumentAuthorizationServiceLive = Layer.effect(
  DocumentAuthorizationService,
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;

    const authorizeDocument: DocumentAuthorization["authorizeDocument"] = (docId, _action) => {
      if (!Number.isInteger(docId) || docId <= 0) {
        return Effect.fail(
          new NotFoundError({ message: `Document ${docId} not found`, resource: "document", id: docId }),
        );
      }

      // Current product model is single-token/single-user local auth. Keep this
      // boundary permissive by default, but allow Paperless-backed visibility
      // checks for derived local stores when explicitly enabled.
      if (!isPaperlessBackedMode()) return Effect.void;

      return paperless.getDocument(docId).pipe(
        Effect.asVoid,
        Effect.mapError((error) => toDeniedDocumentError(docId, error)),
      );
    };

    return {
      authorizeDocument,
      filterAuthorizedDocuments: (items, getDocId, action) =>
        Effect.forEach(
          items,
          (item) => {
            const docId = getDocId(item);
            if (!Number.isInteger(docId) || (docId ?? 0) <= 0) return Effect.succeed(null);
            return authorizeDocument(docId as number, action).pipe(
              Effect.as(item),
              Effect.catchAll(() => Effect.succeed(null)),
            );
          },
          { concurrency: 4 },
        ).pipe(Effect.map((results) => results.filter((item) => item !== null))),
    } satisfies DocumentAuthorization;
  }),
);

export const DocumentAuthorizationServiceNoop = Layer.succeed(DocumentAuthorizationService, {
  authorizeDocument: () => Effect.void,
  filterAuthorizedDocuments: (items) => Effect.succeed([...items]),
} satisfies DocumentAuthorization);
