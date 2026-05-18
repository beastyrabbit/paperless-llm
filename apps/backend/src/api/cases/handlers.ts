/**
 * Document case API handlers.
 */
import { Effect } from "effect";
import { ProcessingPipelineService } from "../../agents/ProcessingPipeline.js";
import { ConfigService } from "../../config/index.js";
import { NotFoundError } from "../../errors/index.js";
import {
  DocumentAuthorizationService,
  type DocumentCase,
  DocumentCaseService,
  LockService,
  PaperlessService,
  TinyBaseService,
} from "../../services/index.js";

const isCaseStatusFilter = (
  status: string | undefined,
): status is "queued" | "needs_input" | "running" | "failed" | "done" | "open" =>
  status === "queued" ||
  status === "needs_input" ||
  status === "running" ||
  status === "failed" ||
  status === "done" ||
  status === "open";

const filterCases = (
  cases: DocumentCase[],
  status?: "queued" | "needs_input" | "running" | "failed" | "done" | "open",
): DocumentCase[] => {
  if (!status) return cases;
  if (status === "open") {
    return cases.filter((caseRecord) => {
      if (caseRecord.automationStatus === "needs_input") {
        return caseRecord.questions.some((question) => question.status === "open");
      }
      if (caseRecord.automationStatus === "running" || caseRecord.automationStatus === "failed") {
        return true;
      }
      if (caseRecord.automationStatus === "queued") {
        return true;
      }
      if (caseRecord.automationStatus === "ready") {
        return caseRecord.questions.length > 0 || caseRecord.answers.length > 0;
      }
      return false;
    });
  }
  return cases.filter((caseRecord) => caseRecord.automationStatus === status);
};

const uniqueTagNames = (...names: Array<string | null | undefined>): string[] =>
  Array.from(
    new Set(names.filter((name): name is string => typeof name === "string" && name.length > 0)),
  );

const hasAnyTag = (tagNames: string[], expected: Set<string>): boolean =>
  tagNames.some((tagName) => expected.has(tagName));

const getWorkflowTagNames = (tagConfig: Record<string, string | undefined>): Set<string> =>
  new Set(uniqueTagNames(...Object.values(tagConfig)));

const getQueuedTagNames = (tagConfig: Record<string, string | undefined>): string[] =>
  uniqueTagNames(tagConfig.todo, tagConfig.pending);

const getActiveWorkflowTagNames = (tagConfig: Record<string, string | undefined>): string[] =>
  uniqueTagNames(
    tagConfig.ocr,
    tagConfig.metadata,
    tagConfig.index,
    tagConfig.ocrDone,
    tagConfig.summaryDone,
    tagConfig.titleDone,
    tagConfig.correspondentDone,
    tagConfig.documentTypeDone,
    tagConfig.tagsDone,
  );

const getNonRecoverableWorkflowTagNames = (
  tagConfig: Record<string, string | undefined>,
): Set<string> =>
  new Set(
    uniqueTagNames(
      tagConfig.review,
      tagConfig.manualReview,
      tagConfig.schemaReview,
      tagConfig.done,
      tagConfig.processed,
      tagConfig.failed,
    ),
  );

const markCaseQueuedFromWorkflowTag = (caseRecord: DocumentCase) =>
  Effect.gen(function* () {
    if (
      caseRecord.automationStatus === "queued" &&
      caseRecord.activeRunId === null &&
      caseRecord.phase !== "done" &&
      caseRecord.phase !== "failed"
    ) {
      return caseRecord;
    }

    const cases = yield* DocumentCaseService;
    return yield* cases.updateCase(caseRecord.id, {
      automationStatus: "queued",
      activeRunId: null,
      phase:
        caseRecord.phase === "done" || caseRecord.phase === "failed" ? "new" : caseRecord.phase,
    });
  });

const recoverStaleActiveWorkflowTag = (caseRecord: DocumentCase) =>
  Effect.gen(function* () {
    const locks = yield* LockService;
    const cases = yield* DocumentCaseService;
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags as Record<string, string | undefined>;

    const activeLock = yield* locks
      .get("document", caseRecord.docId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));
    const [doc, tags] = yield* Effect.all(
      [
        paperless.getDocument(caseRecord.docId).pipe(Effect.catchAll(() => Effect.succeed(null))),
        paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
      ],
      { concurrency: "unbounded" },
    );

    if (!doc) return caseRecord;

    const tagNameById = new Map(tags.map((tag) => [tag.id, tag.name]));
    const docTagNames = doc.tags
      .map((tagId) => tagNameById.get(tagId))
      .filter((tagName): tagName is string => tagName !== undefined);
    const queuedWorkflowTags = new Set(getQueuedTagNames(tagConfig));
    if (hasAnyTag(docTagNames, queuedWorkflowTags)) {
      if (activeLock) {
        if (
          caseRecord.automationStatus === "running" &&
          caseRecord.activeRunId === activeLock.runId
        ) {
          return caseRecord;
        }
        return yield* cases.updateCase(caseRecord.id, {
          automationStatus: "running",
          activeRunId: activeLock.runId,
        });
      }
      return yield* markCaseQueuedFromWorkflowTag(caseRecord);
    }

    const activeWorkflowTags = new Set(getActiveWorkflowTagNames(tagConfig));
    if (!hasAnyTag(docTagNames, activeWorkflowTags)) {
      return caseRecord;
    }

    if (activeLock) {
      if (
        caseRecord.automationStatus === "running" &&
        caseRecord.activeRunId === activeLock.runId
      ) {
        return caseRecord;
      }
      return yield* cases.updateCase(caseRecord.id, {
        automationStatus: "running",
        activeRunId: activeLock.runId,
      });
    }

    const nonRecoverableTags = getNonRecoverableWorkflowTagNames(tagConfig);
    if (hasAnyTag(docTagNames, nonRecoverableTags)) {
      return caseRecord;
    }

    if (
      caseRecord.automationStatus === "needs_input" ||
      caseRecord.automationStatus === "done" ||
      caseRecord.automationStatus === "failed"
    ) {
      return caseRecord;
    }

    const queuedTagName = tagConfig.todo ?? "ai-queued";
    const queuedTagId = yield* paperless.getOrCreateTag(queuedTagName);
    const workflowTagNames = getWorkflowTagNames(tagConfig);
    const workflowTagIds = new Set(
      tags.filter((tag) => workflowTagNames.has(tag.name)).map((tag) => tag.id),
    );
    let nextTagIds = doc.tags.filter(
      (tagId) => !workflowTagIds.has(tagId) || tagId === queuedTagId,
    );
    if (!nextTagIds.includes(queuedTagId)) {
      nextTagIds = [...nextTagIds, queuedTagId];
    }

    const tagIdsChanged =
      nextTagIds.length !== doc.tags.length ||
      nextTagIds.some((tagId) => !doc.tags.includes(tagId));
    if (tagIdsChanged) {
      yield* paperless.updateDocument(caseRecord.docId, { tags: nextTagIds });
    }

    const updated = yield* cases.updateCase(caseRecord.id, {
      automationStatus: "queued",
      activeRunId: null,
      phase:
        caseRecord.phase === "done" || caseRecord.phase === "failed" ? "new" : caseRecord.phase,
    });

    yield* tinybase
      .addProcessingLog({
        docId: caseRecord.docId,
        timestamp: new Date().toISOString(),
        step: "lock",
        eventType: "lock_stale",
        data: {
          recovered: true,
          reason: "active_workflow_tag_without_active_lock",
          previousActiveRunId: caseRecord.activeRunId,
          retaggedTo: queuedTagName,
        },
      })
      .pipe(Effect.catchAll(() => Effect.void));

    return updated;
  });

const reconcileRunningCase = (caseRecord: DocumentCase) =>
  Effect.gen(function* () {
    if (caseRecord.automationStatus !== "running") {
      return yield* recoverStaleActiveWorkflowTag(caseRecord);
    }

    const locks = yield* LockService;
    const cases = yield* DocumentCaseService;
    const tinybase = yield* TinyBaseService;

    const prunedLocks = yield* locks.pruneStale().pipe(Effect.catchAll(() => Effect.succeed(0)));
    const activeLock = yield* locks
      .get("document", caseRecord.docId)
      .pipe(Effect.catchAll(() => Effect.succeed(null)));

    if (activeLock) return caseRecord;

    const recovered = yield* recoverStaleActiveWorkflowTag(caseRecord);
    if (recovered.automationStatus === "queued" && recovered.activeRunId === null) {
      return recovered;
    }

    const updated = yield* cases.updateCase(caseRecord.id, {
      automationStatus: "queued",
      activeRunId: null,
    });

    yield* tinybase
      .addProcessingLog({
        docId: caseRecord.docId,
        timestamp: new Date().toISOString(),
        step: "lock",
        eventType: "lock_stale",
        data: {
          recovered: true,
          reason: "running_case_without_active_lock",
          previousActiveRunId: caseRecord.activeRunId,
          prunedLocks,
        },
      })
      .pipe(Effect.catchAll(() => Effect.void));

    return updated;
  });

const syncWorkflowDocumentCases = Effect.gen(function* () {
  const cases = yield* DocumentCaseService;
  const paperless = yield* PaperlessService;
  const config = yield* ConfigService;
  const tagConfig = config.config.tags as Record<string, string | undefined>;
  const queuedTagNames = getQueuedTagNames(tagConfig);
  const activeTagNames = getActiveWorkflowTagNames(tagConfig);
  const queuedDocs = yield* paperless
    .getDocumentsByTags(queuedTagNames, 100)
    .pipe(Effect.catchAll(() => Effect.succeed([])));
  const activeDocs = yield* paperless
    .getDocumentsByTags(activeTagNames, 100)
    .pipe(Effect.catchAll(() => Effect.succeed([])));
  const docEntries = new Map([...queuedDocs, ...activeDocs].map((doc) => [doc.id, doc]));
  const queuedDocIds = new Set(queuedDocs.map((doc) => doc.id));

  return yield* Effect.forEach(
    Array.from(docEntries.values()),
    (doc) =>
      Effect.gen(function* () {
        const caseRecord = yield* cases.getOrCreateCaseForDocument(doc.id);
        if (!queuedDocIds.has(doc.id)) {
          return yield* reconcileRunningCase(caseRecord);
        }
        const reconciled =
          caseRecord.automationStatus === "running"
            ? yield* reconcileRunningCase(caseRecord)
            : caseRecord;
        if (reconciled.automationStatus === "running") return reconciled;
        return yield* markCaseQueuedFromWorkflowTag(reconciled);
      }),
    { concurrency: "unbounded" },
  );
});

export const listCases = (status?: string) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    const cases = yield* DocumentCaseService;
    const safeStatus = isCaseStatusFilter(status) ? status : undefined;
    yield* syncWorkflowDocumentCases;
    const allCases = yield* cases.listCases();
    const reconciledCases = yield* Effect.forEach(allCases, reconcileRunningCase);
    const filteredCases = yield* auth.filterAuthorizedDocuments(
      filterCases(reconciledCases, safeStatus),
      (caseRecord) => caseRecord.docId,
      "view",
    );
    return {
      cases: filteredCases,
    };
  });

export const getCase = (caseId: string) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    const cases = yield* DocumentCaseService;
    const caseRecord = yield* cases.getCase(caseId);
    if (!caseRecord) return { status: 404, error: "Case not found" };
    yield* auth.authorizeDocument(caseRecord.docId, "view");
    return yield* reconcileRunningCase(caseRecord);
  });

export const getOrCreateDocumentCase = (docId: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "view");
    const cases = yield* DocumentCaseService;
    const caseRecord = yield* cases.getOrCreateCaseForDocument(docId);
    return yield* reconcileRunningCase(caseRecord);
  });

export const answerQuestion = (
  questionId: string,
  body: {
    answer?: string;
    guidance?: string | null;
    selectedEntityId?: number | null;
    selectedEntityName?: string | null;
    metadataPatch?: {
      title?: string;
      correspondentId?: number | null;
      correspondentName?: string | null;
      documentTypeId?: number | null;
      documentTypeName?: string | null;
      tagIds?: number[];
      tagNames?: string[];
    } | null;
  },
) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    const cases = yield* DocumentCaseService;
    if (
      body.answer !== "apply" &&
      body.answer !== "reject" &&
      body.answer !== "skip" &&
      body.answer !== "use_another" &&
      body.answer !== "edit_metadata"
    ) {
      return {
        status: 400,
        error: "Invalid answer",
        allowed: ["apply", "reject", "skip", "use_another", "edit_metadata"],
      };
    }
    const answer = body.answer;
    const questionCase = (yield* cases.listCases()).find((caseRecord) =>
      caseRecord.questions.some((question) => question.id === questionId),
    );
    if (!questionCase) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Question ${questionId} not found`,
          resource: "caseQuestion",
          id: questionId,
        }),
      );
    }
    yield* auth.authorizeDocument(questionCase.docId, "change");
    const caseRecord = yield* cases.answerQuestion(questionId, {
      answer,
      guidance: body.guidance ?? null,
      selectedEntityId: body.selectedEntityId ?? null,
      selectedEntityName: body.selectedEntityName ?? null,
      metadataPatch: body.metadataPatch ?? null,
    });
    const tinybase = yield* TinyBaseService;
    yield* tinybase
      .addProcessingLog({
        docId: caseRecord.docId,
        timestamp: new Date().toISOString(),
        step: "case",
        eventType: "question_answered",
        data: { questionId, answer, hasGuidance: !!body.guidance },
      })
      .pipe(Effect.catchAll(() => Effect.void));
    return caseRecord;
  });

export const runCase = (
  docId: number,
  body: { resume?: boolean; rerun?: boolean; dryRun?: boolean } = {},
) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "process");
    const cases = yield* DocumentCaseService;
    const pipeline = yield* ProcessingPipelineService;
    const dryRun = body.dryRun === true;
    const caseId = `doc-${docId}`;
    const existingCase = yield* cases.getCase(caseId);
    if (!dryRun) {
      const caseRecord = yield* cases.getOrCreateCaseForDocument(docId);
      yield* reconcileRunningCase(caseRecord);
    }
    const result = yield* pipeline.processDocument({
      docId,
      resume: body.resume ?? body.rerun !== true,
      rerun: body.rerun === true,
      dryRun,
    });
    const updated = dryRun
      ? yield* cases.getCase(caseId)
      : yield* cases.getOrCreateCaseForDocument(docId);
    return { case: updated ?? existingCase, result };
  });

export const getCaseLogs = (docId: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "view");
    const tinybase = yield* TinyBaseService;
    const logs = yield* tinybase.getProcessingLogs(docId);
    return { logs };
  });
