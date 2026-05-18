/**
 * Document case state service.
 *
 * A case is the durable coordination record for one Paperless document:
 * transcript, structured human questions, answers, decisions, run summaries,
 * and memory live here instead of in a detached pending queue.
 */
import { Context, Effect, Layer } from "effect";
import { DatabaseError, NotFoundError, ValidationError } from "../errors/index.js";
import { PaperlessService } from "./PaperlessService.js";
import {
  type HumanDecisionRecord,
  type ReviewFeedbackRecord,
  TinyBaseService,
} from "./TinyBaseService.js";

export type CasePhase = "new" | "ocr" | "metadata" | "index" | "done" | "failed";
export type CaseAutomationStatus =
  | "idle"
  | "queued"
  | "running"
  | "needs_input"
  | "ready"
  | "done"
  | "failed";
export type CaseQuestionStatus = "open" | "answered" | "cancelled";
export type CaseQuestionKind = "metadata_proposal";
export type CaseMetadataEntityKind = "tag" | "correspondent" | "document_type" | "custom_field";
export type CaseRequestedAction = "create" | "map" | "edit" | "skip" | "reject";
export type CaseFailureKind = "timeout" | "transient" | "permanent" | "unknown";
export type CaseQuestionAnswerAction =
  | "apply"
  | "reject"
  | "skip"
  | "use_another"
  | "edit_metadata";

export interface CaseProposalCandidate {
  id: number | null;
  name: string;
  exists: boolean;
}

export interface CaseMetadataPatch {
  title?: string;
  correspondentId?: number | null;
  correspondentName?: string | null;
  documentTypeId?: number | null;
  documentTypeName?: string | null;
  tagIds?: number[];
  tagNames?: string[];
}

export interface CaseQuestion {
  id: string;
  caseId: string;
  docId: number;
  kind: CaseQuestionKind;
  entityKind: CaseMetadataEntityKind;
  candidate: CaseProposalCandidate;
  alternatives: CaseProposalCandidate[];
  requestedAction: CaseRequestedAction;
  evidence: string | null;
  status: CaseQuestionStatus;
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  answeredAt: string | null;
}

export interface CaseAnswer {
  id: string;
  caseId: string;
  questionId: string;
  docId: number;
  answer: CaseQuestionAnswerAction;
  guidance: string | null;
  selectedCandidate: CaseProposalCandidate | null;
  metadataPatch: CaseMetadataPatch | null;
  createdAt: string;
}

export interface CaseTranscriptMessage {
  id: string;
  role: "agent" | "user" | "system";
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface CaseFailureDetail {
  message: string;
  kind: CaseFailureKind;
  step: string;
  retryable: boolean;
  runId: string | null;
  failedAt: string;
}

export interface DocumentCase {
  id: string;
  docId: number;
  docTitle: string;
  phase: CasePhase;
  automationStatus: CaseAutomationStatus;
  activeRunId: string | null;
  lastRunId: string | null;
  lastFailure: CaseFailureDetail | null;
  questions: CaseQuestion[];
  answers: CaseAnswer[];
  finalDecisions: Record<string, unknown>;
  runSummaries: unknown[];
  memory: Record<string, unknown>;
  transcript: CaseTranscriptMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseListOptions {
  status?: "queued" | "needs_input" | "running" | "failed" | "done" | "open";
}

export interface AddCaseQuestionInput {
  docId: number;
  entityKind: CaseMetadataEntityKind;
  candidate: CaseProposalCandidate;
  alternatives?: CaseProposalCandidate[];
  requestedAction?: CaseRequestedAction;
  evidence?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface AnswerCaseQuestionInput {
  answer: CaseQuestionAnswerAction;
  guidance?: string | null;
  selectedEntityId?: number | null;
  selectedEntityName?: string | null;
  metadataPatch?: CaseMetadataPatch | null;
}

export interface UpdateCaseInput {
  phase?: CasePhase;
  automationStatus?: CaseAutomationStatus;
  activeRunId?: string | null;
  lastRunId?: string | null;
  lastFailure?: CaseFailureDetail | null;
  finalDecisions?: Record<string, unknown>;
  memory?: Record<string, unknown>;
}

export interface DocumentCaseService {
  readonly listCases: (options?: CaseListOptions) => Effect.Effect<DocumentCase[], DatabaseError>;
  readonly getCase: (caseId: string) => Effect.Effect<DocumentCase | null, DatabaseError>;
  readonly getOrCreateCaseForDocument: (
    docId: number,
  ) => Effect.Effect<DocumentCase, DatabaseError>;
  readonly updateCase: (
    caseId: string,
    updates: UpdateCaseInput,
  ) => Effect.Effect<DocumentCase, DatabaseError | NotFoundError>;
  readonly addQuestion: (input: AddCaseQuestionInput) => Effect.Effect<CaseQuestion, DatabaseError>;
  readonly answerQuestion: (
    questionId: string,
    input: AnswerCaseQuestionInput,
  ) => Effect.Effect<DocumentCase, DatabaseError | NotFoundError | ValidationError>;
  readonly appendTranscript: (
    caseId: string,
    message: Omit<CaseTranscriptMessage, "id" | "createdAt">,
  ) => Effect.Effect<DocumentCase, DatabaseError | NotFoundError>;
  readonly appendRunSummary: (
    caseId: string,
    summary: unknown,
  ) => Effect.Effect<DocumentCase, DatabaseError | NotFoundError>;
}

export const DocumentCaseService = Context.GenericTag<DocumentCaseService>("DocumentCaseService");

const caseIdForDoc = (docId: number): string => `doc-${docId}`;
const nowIso = (): string => new Date().toISOString();
const generateId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const asNullableString = (value: unknown): string | null => {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
};

const asNullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeEntityKey = (value: string | null | undefined): string =>
  (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const looksLikeMetadataBundle = (value: string): boolean => {
  const normalized = value.toLowerCase();
  const markers = [
    "korrespondent:",
    "korrespondenz:",
    "correspondent:",
    "dokumenttyp:",
    "document type:",
    "titel:",
    "title:",
    "tags:",
  ];
  return markers.filter((marker) => normalized.includes(marker)).length >= 2;
};

const isCaseMetadataEntityKind = (value: unknown): value is CaseMetadataEntityKind =>
  value === "tag" ||
  value === "correspondent" ||
  value === "document_type" ||
  value === "custom_field";

const isCaseRequestedAction = (value: unknown): value is CaseRequestedAction =>
  value === "create" ||
  value === "map" ||
  value === "edit" ||
  value === "skip" ||
  value === "reject";

const isCaseAnswerAction = (value: unknown): value is CaseQuestionAnswerAction =>
  value === "apply" ||
  value === "reject" ||
  value === "skip" ||
  value === "use_another" ||
  value === "edit_metadata";

const normalizeFailureDetail = (value: unknown): CaseFailureDetail | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const message = typeof record["message"] === "string" ? record["message"].trim() : "";
  const step = typeof record["step"] === "string" ? record["step"].trim() : "";
  const failedAt = typeof record["failedAt"] === "string" ? record["failedAt"].trim() : "";
  const kind = record["kind"];
  if (!message || !step || !failedAt) return null;
  return {
    message,
    step,
    failedAt,
    kind:
      kind === "timeout" || kind === "transient" || kind === "permanent" || kind === "unknown"
        ? kind
        : "unknown",
    retryable: record["retryable"] === true,
    runId: asNullableString(record["runId"]),
  };
};

const normalizeCandidate = (value: unknown): CaseProposalCandidate | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const name = typeof record["name"] === "string" ? record["name"].trim() : "";
  if (!name) return null;
  const id = asNullableNumber(record["id"]);
  return {
    id,
    name,
    exists: record["exists"] === true || id !== null,
  };
};

const uniqueCandidates = (candidates: CaseProposalCandidate[]): CaseProposalCandidate[] => {
  const seen = new Set<string>();
  const unique: CaseProposalCandidate[] = [];
  for (const candidate of candidates) {
    const key =
      candidate.id !== null ? `id:${candidate.id}` : `name:${normalizeEntityKey(candidate.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
};

const compactRecord = (record: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object")
        return Object.keys(value as Record<string, unknown>).length > 0;
      return true;
    }),
  );

const isActionableCase = (caseRecord: DocumentCase): boolean => {
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
};

const rowToQuestion = (
  id: string,
  row: Record<string, unknown> | undefined,
): CaseQuestion | null => {
  if (!row || Object.keys(row).length === 0) return null;
  const kind = row["kind"] ?? "metadata_proposal";
  if (kind !== "metadata_proposal") return null;
  const entityKind = row["entityKind"];
  if (!isCaseMetadataEntityKind(entityKind)) return null;
  const candidate = normalizeCandidate(parseJson<unknown>(row["candidate"], null));
  if (!candidate) return null;
  const alternatives = parseJson<unknown[]>(row["alternatives"], [])
    .map(normalizeCandidate)
    .filter((value): value is CaseProposalCandidate => value !== null);
  const requestedAction = row["requestedAction"];
  return {
    id,
    caseId: String(row["caseId"] ?? ""),
    docId: Number(row["docId"] ?? 0),
    kind: "metadata_proposal",
    entityKind,
    candidate,
    alternatives,
    requestedAction: isCaseRequestedAction(requestedAction) ? requestedAction : "create",
    evidence: asNullableString(row["evidence"]),
    status: (row["status"] as CaseQuestionStatus) ?? "open",
    source: String(row["source"] ?? "agent"),
    metadata: parseJson<Record<string, unknown>>(row["metadata"], {}),
    createdAt: String(row["createdAt"] ?? ""),
    answeredAt: asNullableString(row["answeredAt"]),
  };
};

const rowToAnswer = (id: string, row: Record<string, unknown> | undefined): CaseAnswer | null => {
  if (!row || Object.keys(row).length === 0) return null;
  const answer = row["answer"];
  if (!isCaseAnswerAction(answer)) return null;
  return {
    id,
    caseId: String(row["caseId"] ?? ""),
    questionId: String(row["questionId"] ?? ""),
    docId: Number(row["docId"] ?? 0),
    answer,
    guidance: asNullableString(row["guidance"]),
    selectedCandidate: normalizeCandidate(parseJson<unknown>(row["selectedCandidate"], null)),
    metadataPatch: parseJson<CaseMetadataPatch | null>(row["metadataPatch"], null),
    createdAt: String(row["createdAt"] ?? ""),
  };
};

export const DocumentCaseServiceLive = Layer.effect(
  DocumentCaseService,
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const { store } = tinybase;

    const getQuestionIds = (caseId: string): string[] =>
      Object.entries(store.getTable("caseQuestions") ?? {})
        .filter(([, row]) => row?.["caseId"] === caseId)
        .map(([id]) => id);

    const getAnswerIds = (caseId: string): string[] =>
      Object.entries(store.getTable("caseAnswers") ?? {})
        .filter(([, row]) => row?.["caseId"] === caseId)
        .map(([id]) => id);

    const writeCaseRow = (caseRecord: Omit<DocumentCase, "questions" | "answers">): void => {
      store.setRow("documentCases", caseRecord.id, {
        id: caseRecord.id,
        docId: caseRecord.docId,
        docTitle: caseRecord.docTitle,
        phase: caseRecord.phase,
        automationStatus: caseRecord.automationStatus,
        activeRunId: caseRecord.activeRunId ?? "",
        lastRunId: caseRecord.lastRunId ?? "",
        lastFailure: JSON.stringify(caseRecord.lastFailure),
        finalDecisions: JSON.stringify(caseRecord.finalDecisions),
        runSummaries: JSON.stringify(caseRecord.runSummaries),
        memory: JSON.stringify(caseRecord.memory),
        transcript: JSON.stringify(caseRecord.transcript),
        createdAt: caseRecord.createdAt,
        updatedAt: caseRecord.updatedAt,
      });
    };

    const rowToCase = (id: string): DocumentCase | null => {
      const row = store.getRow("documentCases", id);
      if (!row || Object.keys(row).length === 0) return null;
      const questions = getQuestionIds(id)
        .map((questionId) => rowToQuestion(questionId, store.getRow("caseQuestions", questionId)))
        .filter((question): question is CaseQuestion => question !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const answers = getAnswerIds(id)
        .map((answerId) => rowToAnswer(answerId, store.getRow("caseAnswers", answerId)))
        .filter((answer): answer is CaseAnswer => answer !== null)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

      return {
        id,
        docId: Number(row["docId"] ?? 0),
        docTitle: String(row["docTitle"] ?? ""),
        phase: (row["phase"] as CasePhase) ?? "new",
        automationStatus: (row["automationStatus"] as CaseAutomationStatus) ?? "idle",
        activeRunId: asNullableString(row["activeRunId"]),
        lastRunId: asNullableString(row["lastRunId"]),
        lastFailure: normalizeFailureDetail(parseJson<unknown>(row["lastFailure"], null)),
        questions,
        answers,
        finalDecisions: parseJson<Record<string, unknown>>(row["finalDecisions"], {}),
        runSummaries: parseJson<unknown[]>(row["runSummaries"], []),
        memory: parseJson<Record<string, unknown>>(row["memory"], {}),
        transcript: parseJson<CaseTranscriptMessage[]>(row["transcript"], []),
        createdAt: String(row["createdAt"] ?? ""),
        updatedAt: String(row["updatedAt"] ?? ""),
      };
    };

    const readLegacyMemory = (docId: number): Record<string, unknown> => {
      const row = store.getRow("documentMemory", String(docId));
      if (!row || Object.keys(row).length === 0) return {};
      return compactRecord({
        sessionId: asNullableString(row["sessionId"]),
        ocrVersionIds: parseJson<unknown[]>(row["ocrVersionIds"], []),
        extractedFacts: parseJson<Record<string, unknown>>(row["extractedFacts"], {}),
        candidateEntities: parseJson<Record<string, unknown>>(row["candidateEntities"], {}),
        finalDecisions: parseJson<Record<string, unknown>>(row["finalDecisions"], {}),
        humanDecisions: parseJson<unknown[]>(row["humanDecisions"], []),
        reviewFeedback: parseJson<unknown[]>(row["reviewFeedback"], []),
        agentMessages: parseJson<unknown[]>(row["transcript"], []),
      });
    };

    const readLegacyRunSummaries = (docId: number): unknown[] => {
      const row = store.getRow("documentMemory", String(docId));
      if (!row || Object.keys(row).length === 0) return [];
      return parseJson<unknown[]>(row["runSummaries"], []);
    };

    const createCase = (docId: number, docTitle: string): DocumentCase => {
      const timestamp = nowIso();
      const legacyMemory = readLegacyMemory(docId);
      const legacyAgentMessages = Array.isArray(legacyMemory["agentMessages"])
        ? legacyMemory["agentMessages"]
        : [];
      const legacyFinalDecisions =
        legacyMemory["finalDecisions"] &&
        typeof legacyMemory["finalDecisions"] === "object" &&
        !Array.isArray(legacyMemory["finalDecisions"])
          ? (legacyMemory["finalDecisions"] as Record<string, unknown>)
          : {};
      const caseRecord: Omit<DocumentCase, "questions" | "answers"> = {
        id: caseIdForDoc(docId),
        docId,
        docTitle,
        phase: "new",
        automationStatus: "idle",
        activeRunId: null,
        lastRunId: null,
        lastFailure: null,
        finalDecisions: legacyFinalDecisions,
        runSummaries: readLegacyRunSummaries(docId),
        memory: legacyMemory,
        transcript: [
          {
            id: generateId("msg"),
            role: "system",
            content: "Document case created.",
            createdAt: timestamp,
          },
          ...(legacyAgentMessages.length > 0
            ? [
                {
                  id: generateId("msg"),
                  role: "system" as const,
                  content: `Imported ${legacyAgentMessages.length} saved agent message(s).`,
                  createdAt: timestamp,
                  metadata: { importedAgentMessages: legacyAgentMessages.length },
                },
              ]
            : []),
        ],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      writeCaseRow(caseRecord);
      return { ...caseRecord, questions: [], answers: [] };
    };

    const updateInputStatus = (caseId: string): void => {
      const existing = rowToCase(caseId);
      if (!existing) return;
      const hasOpenQuestions = existing.questions.some((question) => question.status === "open");
      if (hasOpenQuestions && existing.automationStatus !== "needs_input") {
        writeCaseRow({
          ...existing,
          automationStatus: "needs_input",
          updatedAt: nowIso(),
        });
      } else if (!hasOpenQuestions && existing.automationStatus === "needs_input") {
        writeCaseRow({
          ...existing,
          automationStatus: "idle",
          updatedAt: nowIso(),
        });
      } else if (
        !hasOpenQuestions &&
        existing.automationStatus === "ready" &&
        existing.questions.length === 0 &&
        existing.answers.length === 0
      ) {
        writeCaseRow({
          ...existing,
          automationStatus: "idle",
          updatedAt: nowIso(),
        });
      }
    };

    const removeLegacyQuestionRows = (caseId: string): void => {
      for (const questionId of getQuestionIds(caseId)) {
        const row = store.getRow("caseQuestions", questionId);
        const question = rowToQuestion(questionId, row);
        if (question) continue;
        const metadata = parseJson<Record<string, unknown>>(row?.["metadata"], {});
        const pendingReviewId = metadata["pendingReviewId"];
        if (typeof pendingReviewId === "string") {
          store.delRow("pendingReviews", pendingReviewId);
        }
        for (const answerId of getAnswerIds(caseId)) {
          const answer = rowToAnswer(answerId, store.getRow("caseAnswers", answerId));
          const answerRow = store.getRow("caseAnswers", answerId);
          if (answer?.questionId === questionId || answerRow?.["questionId"] === questionId) {
            store.delRow("caseAnswers", answerId);
          }
        }
        store.delRow("caseQuestions", questionId);
      }
      updateInputStatus(caseId);
    };

    const removeLegacyPendingReviews = (docId?: number): void => {
      for (const [pendingId, row] of Object.entries(store.getTable("pendingReviews") ?? {})) {
        if (row?.["type"] !== "human_decision") continue;
        if (docId !== undefined && Number(row?.["docId"] ?? 0) !== docId) continue;
        store.delRow("pendingReviews", pendingId);
      }
    };

    const findEntityByName = <T extends { id: number; name: string }>(
      items: T[],
      name: string | null | undefined,
    ): T | null => {
      const normalized = normalizeEntityKey(name);
      if (!normalized) return null;
      return items.find((item) => normalizeEntityKey(item.name) === normalized) ?? null;
    };

    const candidateFromEntity = (entity: { id: number; name: string }): CaseProposalCandidate => ({
      id: entity.id,
      name: entity.name,
      exists: true,
    });

    const resolveInputCandidate = (
      kind: CaseMetadataEntityKind,
      id?: number | null,
      name?: string | null,
    ): Effect.Effect<CaseProposalCandidate | null, unknown> =>
      Effect.gen(function* () {
        const normalizedName = name?.trim() ?? "";
        if (kind === "tag") {
          const tags = yield* paperless.getTags();
          const byId = id !== null && id !== undefined ? tags.find((tag) => tag.id === id) : null;
          const byName = findEntityByName(tags, normalizedName);
          if (byId) return candidateFromEntity(byId);
          if (byName) return candidateFromEntity(byName);
          return normalizedName ? { id: null, name: normalizedName, exists: false } : null;
        }
        if (kind === "correspondent") {
          const correspondents = yield* paperless.getCorrespondents();
          const byId =
            id !== null && id !== undefined
              ? correspondents.find((entry) => entry.id === id)
              : null;
          const byName = findEntityByName(correspondents, normalizedName);
          if (byId) return candidateFromEntity(byId);
          if (byName) return candidateFromEntity(byName);
          return normalizedName ? { id: null, name: normalizedName, exists: false } : null;
        }
        if (kind === "document_type") {
          const documentTypes = yield* paperless.getDocumentTypes();
          const byId =
            id !== null && id !== undefined ? documentTypes.find((entry) => entry.id === id) : null;
          const byName = findEntityByName(documentTypes, normalizedName);
          if (byId) return candidateFromEntity(byId);
          if (byName) return candidateFromEntity(byName);
          return normalizedName ? { id: null, name: normalizedName, exists: false } : null;
        }
        return null;
      });

    const applyCandidate = (
      docId: number,
      kind: CaseMetadataEntityKind,
      candidate: CaseProposalCandidate,
    ): Effect.Effect<CaseProposalCandidate, unknown> =>
      Effect.gen(function* () {
        if (kind === "tag") {
          const tagId = candidate.id ?? (yield* paperless.getOrCreateTag(candidate.name));
          const doc = yield* paperless.getDocument(docId);
          if (!doc.tags.includes(tagId)) {
            yield* paperless.updateDocument(docId, { tags: [...doc.tags, tagId] });
          }
          return { ...candidate, id: tagId, exists: true };
        }
        if (kind === "correspondent") {
          const correspondentId =
            candidate.id ?? (yield* paperless.getOrCreateCorrespondent(candidate.name));
          yield* paperless.updateDocument(docId, { correspondent: correspondentId });
          return { ...candidate, id: correspondentId, exists: true };
        }
        if (kind === "document_type") {
          const documentTypeId =
            candidate.id ?? (yield* paperless.getOrCreateDocumentType(candidate.name));
          yield* paperless.updateDocument(docId, { document_type: documentTypeId });
          return { ...candidate, id: documentTypeId, exists: true };
        }
        return candidate;
      });

    const applyMetadataPatch = (
      docId: number,
      patch: CaseMetadataPatch | null | undefined,
    ): Effect.Effect<void, unknown> =>
      Effect.gen(function* () {
        if (!patch) return;
        const updates: {
          title?: string;
          correspondent?: number | null;
          document_type?: number | null;
          tags?: number[];
        } = {};

        if (patch.title !== undefined) {
          const title = patch.title.trim();
          if (title) updates.title = title;
        }
        if (patch.correspondentId !== undefined) {
          updates.correspondent = patch.correspondentId;
        } else if (patch.correspondentName?.trim()) {
          updates.correspondent = yield* paperless.getOrCreateCorrespondent(
            patch.correspondentName.trim(),
          );
        }
        if (patch.documentTypeId !== undefined) {
          updates.document_type = patch.documentTypeId;
        } else if (patch.documentTypeName?.trim()) {
          updates.document_type = yield* paperless.getOrCreateDocumentType(
            patch.documentTypeName.trim(),
          );
        }
        if (patch.tagIds) {
          updates.tags = [...new Set(patch.tagIds)];
        } else if (patch.tagNames) {
          const tagIds: number[] = [];
          for (const name of patch.tagNames) {
            const normalized = name.trim();
            if (!normalized) continue;
            const tagId = yield* paperless.getOrCreateTag(normalized);
            if (!tagIds.includes(tagId)) tagIds.push(tagId);
          }
          updates.tags = tagIds;
        }

        if (Object.keys(updates).length > 0) {
          yield* paperless.updateDocument(docId, updates);
        }
      });

    const toHumanDecisionAnswer = (
      action: CaseQuestionAnswerAction,
      question: CaseQuestion,
      selected: CaseProposalCandidate | null,
    ): HumanDecisionRecord["answer"] => {
      if (action === "apply") return question.candidate.exists ? "map" : "create";
      if (action === "use_another") return selected?.exists ? "map" : "create";
      if (action === "edit_metadata") return "edit";
      if (action === "reject") return "reject";
      return "skip";
    };

    const getOrCreate = (docId: number) =>
      Effect.gen(function* () {
        const caseId = caseIdForDoc(docId);
        const existing = rowToCase(caseId);
        if (existing) {
          removeLegacyQuestionRows(caseId);
          removeLegacyPendingReviews(docId);
          return rowToCase(caseId) ?? existing;
        }

        const doc = yield* paperless
          .getDocument(docId)
          .pipe(Effect.catchAll(() => Effect.succeed({ id: docId, title: `Document ${docId}` })));
        const created = createCase(docId, doc.title || `Document ${docId}`);
        removeLegacyPendingReviews(docId);
        return rowToCase(created.id) ?? created;
      }).pipe(
        Effect.mapError(
          (error) =>
            new DatabaseError({
              message: `Failed to create document case: ${String(error)}`,
              operation: "getOrCreateCaseForDocument",
              cause: error,
            }),
        ),
      );

    return {
      listCases: (options = {}) =>
        Effect.try({
          try: () => {
            for (const caseId of Object.keys(store.getTable("documentCases") ?? {})) {
              removeLegacyQuestionRows(caseId);
            }
            removeLegacyPendingReviews();
            const cases = Object.keys(store.getTable("documentCases") ?? {})
              .map((id) => rowToCase(id))
              .filter((caseRecord): caseRecord is DocumentCase => caseRecord !== null)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

            if (!options.status) return cases;
            if (options.status === "open") {
              return cases.filter(isActionableCase);
            }
            return cases.filter((caseRecord) => caseRecord.automationStatus === options.status);
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to list cases: ${String(error)}`,
              operation: "listCases",
              cause: error,
            }),
        }),

      getCase: (caseId) =>
        Effect.try({
          try: () => {
            removeLegacyQuestionRows(caseId);
            return rowToCase(caseId);
          },
          catch: (error) =>
            new DatabaseError({
              message: `Failed to get case: ${String(error)}`,
              operation: "getCase",
              cause: error,
            }),
        }),

      getOrCreateCaseForDocument: getOrCreate,

      updateCase: (caseId, updates) =>
        Effect.try({
          try: () => {
            const existing = rowToCase(caseId);
            if (!existing) {
              throw new NotFoundError({ message: `Case ${caseId} not found`, resource: "case" });
            }
            const updated = {
              ...existing,
              ...updates,
              finalDecisions: updates.finalDecisions
                ? { ...existing.finalDecisions, ...updates.finalDecisions }
                : existing.finalDecisions,
              memory: updates.memory ? { ...existing.memory, ...updates.memory } : existing.memory,
              updatedAt: nowIso(),
            };
            writeCaseRow(updated);
            return rowToCase(caseId) ?? updated;
          },
          catch: (error) => {
            if (error instanceof NotFoundError) return error;
            return new DatabaseError({
              message: `Failed to update case: ${String(error)}`,
              operation: "updateCase",
              cause: error,
            });
          },
        }),

      addQuestion: (input) =>
        Effect.gen(function* () {
          const caseRecord = yield* getOrCreate(input.docId);
          const timestamp = nowIso();
          const metadataQuestionId = input.metadata?.["questionId"];
          const deterministicId =
            typeof metadataQuestionId === "string" && metadataQuestionId.trim().length > 0
              ? metadataQuestionId
              : null;
          const candidateKey = normalizeEntityKey(input.candidate.name);
          const existingQuestion = deterministicId
            ? rowToQuestion(deterministicId, store.getRow("caseQuestions", deterministicId))
            : (caseRecord.questions.find((candidate) => {
                if (candidate.status !== "open") return false;
                if (candidate.entityKind !== input.entityKind) return false;
                if (normalizeEntityKey(candidate.candidate.name) !== candidateKey) return false;
                return candidate.source === (input.source ?? "agent");
              }) ?? null);
          if (existingQuestion) {
            if (
              existingQuestion.status === "open" &&
              caseRecord.automationStatus !== "needs_input"
            ) {
              writeCaseRow({
                ...caseRecord,
                automationStatus: "needs_input",
                updatedAt: timestamp,
              });
            }
            return existingQuestion;
          }
          const question: CaseQuestion = {
            id: deterministicId ?? generateId("question"),
            caseId: caseRecord.id,
            docId: input.docId,
            kind: "metadata_proposal",
            entityKind: input.entityKind,
            candidate: input.candidate,
            alternatives: uniqueCandidates(input.alternatives ?? []),
            requestedAction: input.requestedAction ?? "create",
            evidence: input.evidence?.trim() ? input.evidence.trim() : null,
            status: "open",
            source: input.source ?? "agent",
            metadata: {
              kind: "metadata_proposal",
              ...(input.metadata ?? {}),
            },
            createdAt: timestamp,
            answeredAt: null,
          };
          store.setRow("caseQuestions", question.id, {
            id: question.id,
            caseId: question.caseId,
            docId: question.docId,
            kind: question.kind,
            entityKind: question.entityKind,
            candidate: JSON.stringify(question.candidate),
            alternatives: JSON.stringify(question.alternatives),
            requestedAction: question.requestedAction,
            evidence: question.evidence ?? "",
            status: question.status,
            source: question.source,
            metadata: JSON.stringify(question.metadata),
            createdAt: question.createdAt,
            answeredAt: "",
          });

          const transcript = [
            ...caseRecord.transcript,
            {
              id: generateId("msg"),
              role: "agent" as const,
              content: `Proposed ${input.entityKind.replaceAll("_", " ")}: ${input.candidate.name}`,
              createdAt: timestamp,
              metadata: { questionId: question.id },
            },
          ];
          writeCaseRow({
            ...caseRecord,
            automationStatus: "needs_input",
            transcript,
            updatedAt: timestamp,
          });
          return question;
        }).pipe(
          Effect.mapError(
            (error) =>
              new DatabaseError({
                message: `Failed to add case question: ${String(error)}`,
                operation: "addCaseQuestion",
                cause: error,
              }),
          ),
        ),

      answerQuestion: (questionId, input) =>
        Effect.gen(function* () {
          const question = rowToQuestion(questionId, store.getRow("caseQuestions", questionId));
          if (!question) {
            return yield* Effect.fail(
              new NotFoundError({
                message: `Question ${questionId} not found`,
                resource: "caseQuestion",
              }),
            );
          }
          const caseRecord = rowToCase(question.caseId);
          if (!caseRecord) {
            return yield* Effect.fail(
              new NotFoundError({
                message: `Case ${question.caseId} not found`,
                resource: "case",
              }),
            );
          }
          if (question.status !== "open") {
            return caseRecord;
          }

          let selectedCandidate: CaseProposalCandidate | null = null;
          let followUpCandidate: CaseProposalCandidate | null = null;
          if (input.answer === "apply") {
            if (question.entityKind === "tag" && looksLikeMetadataBundle(question.candidate.name)) {
              return yield* Effect.fail(
                new ValidationError({
                  message:
                    "This question is a malformed metadata review stored as a tag proposal. Reject it and rerun the document so the agent can create a structured metadata decision.",
                  field: "question",
                  value: question.candidate.name,
                }),
              );
            }
            const reverseMapTargetName =
              typeof question.metadata["reverseMapTargetName"] === "string"
                ? question.metadata["reverseMapTargetName"].trim()
                : "";
            if (reverseMapTargetName && !question.candidate.exists) {
              const reverseMapTarget = yield* resolveInputCandidate(
                question.entityKind,
                null,
                reverseMapTargetName,
              );
              if (reverseMapTarget?.exists && reverseMapTarget.id !== null) {
                if (question.entityKind === "correspondent") {
                  yield* paperless.renameCorrespondent(reverseMapTarget.id, question.candidate.name);
                } else if (question.entityKind === "document_type") {
                  yield* paperless.renameDocumentType(reverseMapTarget.id, question.candidate.name);
                }
                selectedCandidate = yield* applyCandidate(question.docId, question.entityKind, {
                  id: reverseMapTarget.id,
                  name: question.candidate.name,
                  exists: true,
                });
              }
            }
            if (!selectedCandidate) {
              const mapTarget =
                question.requestedAction === "map" && !question.candidate.exists
                  ? (question.alternatives.find((candidate) => candidate.exists && candidate.id) ??
                    null)
                  : null;
              selectedCandidate = yield* applyCandidate(
                question.docId,
                question.entityKind,
                mapTarget ?? question.candidate,
              );
            }
          } else if (input.answer === "use_another") {
            selectedCandidate = yield* resolveInputCandidate(
              question.entityKind,
              input.selectedEntityId,
              input.selectedEntityName,
            );
            if (selectedCandidate && question.entityKind === "tag" && !selectedCandidate.exists) {
              followUpCandidate = selectedCandidate;
            } else if (selectedCandidate) {
              selectedCandidate = yield* applyCandidate(
                question.docId,
                question.entityKind,
                selectedCandidate,
              );
            }
          } else if (input.answer === "edit_metadata") {
            yield* applyMetadataPatch(question.docId, input.metadataPatch);
          }

          const timestamp = nowIso();
          const answer: CaseAnswer = {
            id: generateId("answer"),
            caseId: question.caseId,
            questionId,
            docId: question.docId,
            answer: input.answer,
            guidance: input.guidance?.trim() ? input.guidance.trim() : null,
            selectedCandidate,
            metadataPatch: input.metadataPatch ?? null,
            createdAt: timestamp,
          };
          store.setRow("caseAnswers", answer.id, {
            id: answer.id,
            caseId: answer.caseId,
            questionId: answer.questionId,
            docId: answer.docId,
            answer: answer.answer,
            guidance: answer.guidance ?? "",
            selectedCandidate: JSON.stringify(answer.selectedCandidate),
            metadataPatch: JSON.stringify(answer.metadataPatch),
            createdAt: answer.createdAt,
          });
          store.setPartialRow("caseQuestions", questionId, {
            status: "answered",
            answeredAt: timestamp,
          });

          let followUpQuestionId: string | null = null;
          if (followUpCandidate) {
            const followUpQuestion: CaseQuestion = {
              id: generateId("question"),
              caseId: question.caseId,
              docId: question.docId,
              kind: "metadata_proposal",
              entityKind: question.entityKind,
              candidate: followUpCandidate,
              alternatives: [],
              requestedAction: "create",
              evidence: answer.guidance ?? `Requested while reviewing ${question.candidate.name}.`,
              status: "open",
              source: "user_guidance",
              metadata: {
                kind: "metadata_proposal",
                parentQuestionId: question.id,
              },
              createdAt: timestamp,
              answeredAt: null,
            };
            followUpQuestionId = followUpQuestion.id;
            store.setRow("caseQuestions", followUpQuestion.id, {
              id: followUpQuestion.id,
              caseId: followUpQuestion.caseId,
              docId: followUpQuestion.docId,
              kind: followUpQuestion.kind,
              entityKind: followUpQuestion.entityKind,
              candidate: JSON.stringify(followUpQuestion.candidate),
              alternatives: JSON.stringify(followUpQuestion.alternatives),
              requestedAction: followUpQuestion.requestedAction,
              evidence: followUpQuestion.evidence ?? "",
              status: followUpQuestion.status,
              source: followUpQuestion.source,
              metadata: JSON.stringify(followUpQuestion.metadata),
              createdAt: followUpQuestion.createdAt,
              answeredAt: "",
            });
          }

          const proposalLabel = `${question.entityKind.replaceAll("_", " ")}:${question.candidate.name}`;
          const guidanceEntry = {
            proposal: proposalLabel,
            answer: input.answer,
            selectedCandidate,
            metadataPatch: input.metadataPatch ?? null,
            guidance: answer.guidance,
            createdAt: timestamp,
          };
          const guidance = [
            ...(Array.isArray(caseRecord.memory["guidance"])
              ? (caseRecord.memory["guidance"] as unknown[])
              : []),
            guidanceEntry,
          ];
          const openQuestionCount = caseRecord.questions.filter(
            (candidate) => candidate.id !== questionId && candidate.status === "open",
          ).length;
          const transcript = [
            ...caseRecord.transcript,
            {
              id: generateId("msg"),
              role: "user" as const,
              content: answer.guidance ? `${input.answer}: ${answer.guidance}` : input.answer,
              createdAt: timestamp,
              metadata: {
                questionId,
                selectedCandidate,
                metadataPatch: input.metadataPatch ?? null,
              },
            },
            ...(followUpCandidate
              ? [
                  {
                    id: generateId("msg"),
                    role: "agent" as const,
                    content: `Proposed ${question.entityKind.replaceAll("_", " ")}: ${followUpCandidate.name}`,
                    createdAt: timestamp,
                    metadata: { questionId: followUpQuestionId },
                  },
                ]
              : []),
          ];
          const nextAutomationStatus: CaseAutomationStatus =
            openQuestionCount > 0 || followUpCandidate ? "needs_input" : "ready";
          const decision: HumanDecisionRecord = {
            id: generateId("decision"),
            type: question.entityKind,
            question: `Proposed ${question.entityKind.replaceAll("_", " ")}: ${question.candidate.name}`,
            suggestion: question.candidate.name,
            answer: toHumanDecisionAnswer(input.answer, question, selectedCandidate),
            value:
              input.answer === "edit_metadata"
                ? JSON.stringify(input.metadataPatch ?? {})
                : (selectedCandidate?.name ?? null),
            feedback: answer.guidance,
            decidedAt: timestamp,
          };
          const feedback: ReviewFeedbackRecord | null = answer.guidance
            ? {
                id: generateId("feedback"),
                feedback: answer.guidance,
                category: null,
                createdAt: timestamp,
              }
            : null;
          const humanDecisions = [
            ...(Array.isArray(caseRecord.memory["humanDecisions"])
              ? (caseRecord.memory["humanDecisions"] as unknown[])
              : []),
            decision,
          ];
          const reviewFeedback = [
            ...(Array.isArray(caseRecord.memory["reviewFeedback"])
              ? (caseRecord.memory["reviewFeedback"] as unknown[])
              : []),
            ...(feedback ? [feedback] : []),
          ];
          const updated: DocumentCase = {
            ...caseRecord,
            automationStatus: nextAutomationStatus,
            memory: { ...caseRecord.memory, guidance, humanDecisions, reviewFeedback },
            transcript,
            updatedAt: timestamp,
          };
          writeCaseRow(updated);

          const updatedCase = rowToCase(question.caseId) ?? updated;
          yield* tinybase.appendHumanDecision(question.docId, decision);
          if (feedback) {
            yield* tinybase.appendReviewFeedback(question.docId, feedback);
          }

          return updatedCase;
        }).pipe(
          Effect.mapError((error) => {
            if (error instanceof NotFoundError) return error;
            if (error instanceof ValidationError) return error;
            return new DatabaseError({
              message: `Failed to answer question: ${String(error)}`,
              operation: "answerCaseQuestion",
              cause: error,
            });
          }),
        ),

      appendTranscript: (caseId, message) =>
        Effect.try({
          try: () => {
            const existing = rowToCase(caseId);
            if (!existing) {
              throw new NotFoundError({ message: `Case ${caseId} not found`, resource: "case" });
            }
            const transcript = [
              ...existing.transcript,
              { ...message, id: generateId("msg"), createdAt: nowIso() },
            ];
            const updated = { ...existing, transcript, updatedAt: nowIso() };
            writeCaseRow(updated);
            return rowToCase(caseId) ?? updated;
          },
          catch: (error) => {
            if (error instanceof NotFoundError) return error;
            return new DatabaseError({
              message: `Failed to append transcript: ${String(error)}`,
              operation: "appendCaseTranscript",
              cause: error,
            });
          },
        }),

      appendRunSummary: (caseId, summary) =>
        Effect.try({
          try: () => {
            const existing = rowToCase(caseId);
            if (!existing) {
              throw new NotFoundError({ message: `Case ${caseId} not found`, resource: "case" });
            }
            const runSummaries = [...existing.runSummaries, summary];
            const updated = { ...existing, runSummaries, updatedAt: nowIso() };
            writeCaseRow(updated);
            return rowToCase(caseId) ?? updated;
          },
          catch: (error) => {
            if (error instanceof NotFoundError) return error;
            return new DatabaseError({
              message: `Failed to append run summary: ${String(error)}`,
              operation: "appendCaseRunSummary",
              cause: error,
            });
          },
        }),
    };
  }),
);
