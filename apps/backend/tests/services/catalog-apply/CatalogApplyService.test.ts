import {
  type ApplyJournal,
  canonicalSha256,
  type HashPrecondition,
  type PaperlessTask,
} from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type CatalogApplyAssignmentBatchRequest,
  CatalogApplyConflict,
  type CatalogApplyDocumentMutationState,
  type CatalogApplyEntityState,
  CatalogApplyLedgerPort,
  type CatalogApplyLedgerPortType,
  CatalogApplyMutationPort,
  type CatalogApplyMutationPortType,
  CatalogApplyService,
  CatalogApplyServiceLive,
  catalogApplyFingerprintForLiveState,
} from "../../../src/services/catalog-apply/index.js";
import { OperationalLedgerConflictError } from "../../../src/services/OperationalLedgerService.js";
import type {
  CompactChairDecisionRecord,
  OperationalLedgerData,
  ProposalRecord,
} from "../../../src/services/operational-ledger/types.js";
import type { PaperlessAssignmentReceipt } from "../../../src/services/paperless/types.js";

const iso = "2026-07-22T10:00:00.000Z";
const hash = (value: unknown) => canonicalSha256({ test: "catalog-apply", value });
const precondition = (value: unknown): HashPrecondition => ({
  kind: "council_evidence",
  digest: hash(value),
});

const receipt = (entityId: number, documentIds: readonly number[]): PaperlessAssignmentReceipt => ({
  kind: "tag",
  entityId,
  filterDescriptor: { path: "/documents/", params: { tags__id: entityId } },
  expectedApiCount: documentIds.length,
  fetchedCount: documentIds.length,
  pageCount: documentIds.length > 0 ? 1 : 0,
  documentIds: [...documentIds],
  documents: documentIds.map((documentId) => ({
    documentId,
    modified: iso,
    stateHash: hash({ documentId, entityId }),
    verifiedMembership: true,
  })),
  capturedAt: iso,
  assignmentHash: hash({ entityId, documentIds }),
  complete: true,
});

const entityState = (
  entityId: number,
  name: string,
  overrides: Partial<CatalogApplyEntityState> = {},
): CatalogApplyEntityState => ({
  kind: "tag",
  entityId,
  exists: true,
  name,
  dependencyHash: hash({ entityId, name, dependencies: [] }),
  blockedReasons: [],
  ...overrides,
});

const proposal = (overrides: Partial<ProposalRecord> = {}): ProposalRecord => ({
  kind: "undecided_catalog_proposal_values",
  scope: "catalog",
  proposalId: "prop_merge",
  ownerId: "epoch_merge",
  proposalHash: hash("proposal-hash"),
  valueHash: hash("proposal-values"),
  proposedValues: {
    scope: "catalog",
    entityKind: "tag",
    intendedAction: "merge",
    sourceEntityId: 1,
    targetEntityId: 2,
    proposedValue: null,
    candidateIds: ["cand_merge"],
    evidenceDocumentIds: [1, 2, 3, 4, 5],
    expectedProposalFingerprint: hash("proposal-fingerprint"),
    expectedEvidenceFingerprint: hash("candidate-evidence"),
    candidateRiskFlags: [],
    coverageRiskFlags: [],
    requiresHumanReview: true,
    applicationBlockedReasons: [],
  },
  evidenceIds: ["evidence_1"],
  coverage: 1,
  rationale: "Human reviewed compact proposal.",
  preconditions: [precondition("source"), precondition("target")],
  decision: "approved",
  outcome: "approved",
  createdAt: iso,
  decidedAt: iso,
  compactedAt: null,
  ...overrides,
});

const chairDecision = (
  mergeProposal = proposal(),
  overrides: Partial<CompactChairDecisionRecord> = {},
): CompactChairDecisionRecord => {
  if (mergeProposal.proposedValues?.scope !== "catalog") {
    throw new Error("expected catalog proposal");
  }
  return {
    kind: "compact_chair_decision",
    epochId: mergeProposal.ownerId,
    candidateIds: mergeProposal.proposedValues.candidateIds,
    proposalId: mergeProposal.proposalId,
    verdict: "approve",
    action: "request_review",
    sourceEntityId: mergeProposal.proposedValues.sourceEntityId,
    targetEntityId: mergeProposal.proposedValues.targetEntityId,
    rationale: "Chair approved compact review.",
    dissent: null,
    evidenceIds: ["council_vote_1"],
    confidence: 1,
    proposalFingerprint: mergeProposal.proposedValues.expectedProposalFingerprint,
    evidenceFingerprint: hash("chair-evidence"),
    coverageHash: hash("coverage"),
    coverageCount: mergeProposal.proposedValues.evidenceDocumentIds.length,
    inspectedDocumentCount: mergeProposal.proposedValues.evidenceDocumentIds.length,
    totalDocumentCount: mergeProposal.proposedValues.evidenceDocumentIds.length,
    createdAt: iso,
    decidedAt: iso,
    ...overrides,
  };
};

const applyRequest = ({
  mergeProposal = proposal(),
  chair = chairDecision(mergeProposal),
  sourceIds = [1, 2, 3, 4, 5],
  targetIds = [10],
  idempotencyKey = "idem-merge-0001",
  sourceEntity = entityState(
    mergeProposal.proposedValues?.scope === "catalog"
      ? mergeProposal.proposedValues.sourceEntityId
      : 1,
    "Source",
  ),
  targetEntity = mergeProposal.proposedValues?.scope === "catalog" &&
  mergeProposal.proposedValues.targetEntityId !== null
    ? entityState(mergeProposal.proposedValues.targetEntityId, "Target")
    : null,
}: {
  readonly mergeProposal?: ProposalRecord;
  readonly chair?: CompactChairDecisionRecord;
  readonly sourceIds?: readonly number[];
  readonly targetIds?: readonly number[];
  readonly idempotencyKey?: string;
  readonly sourceEntity?: CatalogApplyEntityState;
  readonly targetEntity?: CatalogApplyEntityState | null;
} = {}) => {
  if (mergeProposal.proposedValues?.scope !== "catalog") throw new Error("expected catalog values");
  const receipts = {
    kind: "tag",
    source: receipt(mergeProposal.proposedValues.sourceEntityId, sourceIds),
    target:
      mergeProposal.proposedValues.targetEntityId === null
        ? null
        : receipt(mergeProposal.proposedValues.targetEntityId, targetIds),
  } as const;
  const expectedCatalogFingerprint = catalogApplyFingerprintForLiveState({
    receipts,
    sourceEntity,
    targetEntity,
  });
  return {
    proposal: mergeProposal,
    chairDecision: chair,
    expectedProposalFingerprint: chair.proposalFingerprint,
    expectedEvidenceFingerprint: chair.evidenceFingerprint,
    expectedCatalogFingerprint,
    idempotencyKey,
    createdAt: iso,
    taskPollIntervalMs: 1,
    taskPollTimeoutMs: 20,
  };
};

const journalRecord = (journal: ApplyJournal) =>
  ({
    ...journal,
    kind: "apply_journal",
    idempotencyKeyHash: hash(journal.idempotencyKey),
    preconditionHashes: journal.preconditions.map((condition) => condition.digest),
    stepCount: journal.steps.length,
    compactedAt: null,
  }) as unknown as OperationalLedgerData["applyJournals"][string];

const createLedgerLayer = ({
  mergeProposal = proposal(),
  chair = chairDecision(mergeProposal),
  busyLease = false,
  busyResourceId = null as string | null,
  journals = {},
}: {
  readonly mergeProposal?: ProposalRecord;
  readonly chair?: CompactChairDecisionRecord;
  readonly busyLease?: boolean;
  readonly busyResourceId?: string | null;
  readonly journals?: OperationalLedgerData["applyJournals"];
} = {}) => {
  const proposals: Record<string, ProposalRecord> = { [mergeProposal.proposalId]: mergeProposal };
  const chairDecisions: Record<string, CompactChairDecisionRecord> = {
    chair_merge: chair,
  };
  const applyJournals = { ...journals };
  const decisions: Array<{ proposalId: string; decision: string }> = [];
  const leases: Record<string, { leaseId: string; runId: string; owner: string }> = {};
  const ledger = {
    paths: { dataDir: "memory", file: "memory/ledger.json" },
    getSnapshot: vi.fn(() =>
      Effect.succeed({
        applyJournals,
        proposals,
        chairDecisions,
        catalogEpochs: {},
        leases,
      } as unknown as OperationalLedgerData),
    ),
    getSnapshotJson: vi.fn(() => Effect.succeed("{}")),
    recordApplyJournal: vi.fn((journal: ApplyJournal) => {
      applyJournals[journal.journalId] = journalRecord(journal);
      return Effect.succeed(journal);
    }),
    acquireLease: vi.fn((input) => {
      const lease = {
        kind: "lease_record" as const,
        leaseId: `lease_${input.resourceId}`,
        scope: input.scope,
        resourceId: String(input.resourceId),
        owner: input.owner,
        runId: input.runId ?? "run",
        acquiredAt: iso,
        heartbeatAt: iso,
        expiresAt: "2026-07-22T10:10:00.000Z",
      };
      if (busyLease || input.resourceId === busyResourceId) {
        return Effect.succeed({ acquired: false, lease, staleRecovered: false });
      }
      leases[lease.leaseId] = lease;
      return Effect.succeed({ acquired: true, lease, staleRecovered: false });
    }),
    heartbeatLease: vi.fn((leaseId: string) => Effect.succeed(leases[leaseId] ?? null)),
    releaseLease: vi.fn((leaseId) => {
      delete leases[leaseId];
      return Effect.succeed(true);
    }),
    recordProposalDecision: vi.fn((proposalId, input) =>
      Effect.sync(() => {
        decisions.push({ proposalId, decision: input.decision });
        const existing = proposals[proposalId];
        if (!existing) {
          return mergeProposal;
        }
        if (existing.decision !== input.expectedDecision) {
          throw new OperationalLedgerConflictError(
            `expected ${input.expectedDecision}, found ${existing.decision}`,
            existing.decision,
            input.expectedDecision,
            input.decision,
          );
        }
        proposals[proposalId] = {
          ...existing,
          decision: input.decision,
          outcome: input.outcome ?? input.decision,
          decidedAt: input.decidedAt ?? iso,
        };
        return proposals[proposalId];
      }),
    ),
    setSetting: vi.fn(),
    appendLedgerEntry: vi.fn(),
    createAnalysisRun: vi.fn(),
    transitionAnalysisRunState: vi.fn(),
    recordAnalysisFailure: vi.fn(),
    createCatalogEpoch: vi.fn(),
    transitionCatalogEpochState: vi.fn(),
    recordProposal: vi.fn(),
    recordCouncilVote: vi.fn(),
    recordChairDecision: vi.fn(),
    recordProviderUsage: vi.fn(),
    recordRandomCycle: vi.fn(),
    compact: vi.fn(),
  } as unknown as CatalogApplyLedgerPortType;
  return {
    layer: Layer.succeed(CatalogApplyLedgerPort, ledger),
    mocks: { ledger, applyJournals, decisions, leases },
  };
};

const createPaperlessLayer = ({
  sourceIds = [1, 2, 3, 4, 5],
  targetIds = [10],
  skipTargetWrites = false,
  deleteStillPresent = false,
  sourceName = "Source",
  targetName = "Target",
  blockedReasons = [] as readonly string[],
  taskStatus = "succeeded" as PaperlessTask["status"],
  pollThrows = false,
}: {
  readonly sourceIds?: readonly number[];
  readonly targetIds?: readonly number[];
  readonly skipTargetWrites?: boolean;
  readonly deleteStillPresent?: boolean;
  readonly sourceName?: string;
  readonly targetName?: string;
  readonly blockedReasons?: readonly string[];
  readonly taskStatus?: PaperlessTask["status"];
  readonly pollThrows?: boolean;
} = {}) => {
  const source = new Set(sourceIds);
  const target = new Set(targetIds);
  const events: string[] = [];
  const submitted: CatalogApplyAssignmentBatchRequest[] = [];
  const pending = new Map<string, CatalogApplyAssignmentBatchRequest>();
  let taskIndex = 0;
  let deleted = false;
  let name = sourceName;
  const targetEntityName = targetName;
  const mutation = {
    readEntity: vi.fn((_kind, entityId: number) => {
      if (entityId === 1) {
        return Effect.succeed(
          deleted && !deleteStillPresent
            ? null
            : entityState(1, name, { exists: !(deleted && !deleteStillPresent), blockedReasons }),
        );
      }
      return Effect.succeed(entityState(entityId, targetEntityName, { blockedReasons }));
    }),
    findEntityByName: vi.fn((_kind, lookupName: string) => {
      if (lookupName === targetEntityName) return Effect.succeed(entityState(2, targetEntityName));
      if (lookupName === name) return Effect.succeed(entityState(1, name));
      return Effect.succeed(null);
    }),
    readAssignmentReceipt: vi.fn((_kind, entityId: number) =>
      Effect.succeed(receipt(entityId, entityId === 1 ? [...source] : [...target])),
    ),
    readDocumentMutationState: vi.fn((_kind, documentId: number) =>
      Effect.succeed({
        documentId,
        assignmentHash: hash({
          documentId,
          source: source.has(documentId),
          target: target.has(documentId),
        }),
        hasSourceAssignment: source.has(documentId),
        hasTargetAssignment: target.has(documentId),
      } satisfies CatalogApplyDocumentMutationState),
    ),
    submitAssignmentBatch: vi.fn((request: CatalogApplyAssignmentBatchRequest) => {
      const taskId = `task-${taskIndex++}`;
      submitted.push(request);
      pending.set(taskId, request);
      events.push(`submit:${request.operation}:${request.documentIds.join(",")}`);
      return Effect.succeed({
        taskId,
        status: "queued",
        submittedAt: iso,
        updatedAt: iso,
        resultHash: null,
      } satisfies PaperlessTask);
    }),
    pollTask: vi.fn((taskId: string) => {
      if (pollThrows) return Effect.fail(new Error("poll crashed after task acceptance"));
      const request = pending.get(taskId);
      events.push(`poll:${taskId}`);
      if (request && taskStatus === "succeeded") {
        if (request.operation === "modify_tags") {
          if (
            "addTagIds" in request.parameters &&
            request.parameters.addTagIds.length > 0 &&
            !skipTargetWrites
          ) {
            for (const id of request.documentIds) target.add(id);
          }
          if ("removeTagIds" in request.parameters && request.parameters.removeTagIds.length > 0) {
            for (const id of request.documentIds) source.delete(id);
          }
        }
        if (
          request.operation === "set_correspondent" ||
          request.operation === "set_document_type"
        ) {
          for (const id of request.documentIds) {
            source.delete(id);
            target.add(id);
          }
        }
      }
      return Effect.succeed({
        taskId,
        status: taskStatus,
        submittedAt: iso,
        updatedAt: iso,
        errorCode: taskStatus === "failed" ? "PAPERLESS_TASK_FAILED" : undefined,
        resultHash: hash({ taskId, status: taskStatus }),
      } satisfies PaperlessTask);
    }),
    deleteEntity: vi.fn((_kind, entityId: number) => {
      events.push(`delete:${entityId}`);
      deleted = true;
      return Effect.void;
    }),
    renameEntity: vi.fn((_kind, entityId: number, nextName: string) => {
      events.push(`rename:${entityId}:${nextName}`);
      name = nextName;
      return Effect.succeed({ id: entityId, name, slug: name.toLowerCase() });
    }),
    invalidateCatalogCache: vi.fn(() => {
      events.push("invalidate");
      return Effect.void;
    }),
  } as unknown as CatalogApplyMutationPortType;
  return {
    layer: Layer.succeed(CatalogApplyMutationPort, mutation),
    mocks: {
      mutation,
      events,
      submitted,
      sourceIds: () => [...source].sort((left, right) => left - right),
      targetIds: () => [...target].sort((left, right) => left - right),
      deleted: () => deleted,
      name: () => name,
    },
  };
};

const runApply = <A, E, R>(
  layer: Layer.Layer<R>,
  effect: Effect.Effect<A, E, R | CatalogApplyService>,
) => Effect.runPromise(effect.pipe(Effect.provide(Layer.mergeAll(CatalogApplyServiceLive, layer))));

const runApplyConflict = async <R>(
  layer: Layer.Layer<R>,
  request: Parameters<CatalogApplyService["applyReviewedProposal"]>[0],
) => {
  const result = await runApply(
    layer,
    Effect.gen(function* () {
      const service = yield* CatalogApplyService;
      return yield* Effect.either(service.applyReviewedProposal(request));
    }),
  );
  expect(result._tag).toBe("Left");
  if (result._tag !== "Left") throw new Error("expected catalog apply conflict");
  expect(result.left).toBeInstanceOf(CatalogApplyConflict);
  return result.left;
};

describe("CatalogApplyService", () => {
  it("migrates tag assignments in bounded task batches, polls tasks, journals phases, then deletes", async () => {
    const paperless = createPaperlessLayer();
    const ledger = createLedgerLayer();
    const request = applyRequest();
    const result = await runApply(
      Layer.mergeAll(paperless.layer, ledger.layer),
      Effect.gen(function* () {
        const service = yield* CatalogApplyService;
        return yield* service.applyReviewedProposal({ ...request, batchSize: 2 });
      }),
    );

    expect(result.status).toBe("applied");
    expect(result.migrationDocumentIds).toEqual([1, 2, 3, 4, 5]);
    expect(paperless.mocks.submitted.map((request) => request.operation)).toEqual([
      "modify_tags",
      "modify_tags",
      "modify_tags",
    ]);
    expect(
      paperless.mocks.submitted.every(
        (request) =>
          "addTagIds" in request.parameters &&
          request.parameters.addTagIds[0] === 2 &&
          request.parameters.removeTagIds[0] === 1,
      ),
    ).toBe(true);
    expect(paperless.mocks.mutation.pollTask).toHaveBeenCalledTimes(3);
    expect(paperless.mocks.sourceIds()).toEqual([]);
    expect(paperless.mocks.targetIds()).toEqual([1, 2, 3, 4, 5, 10]);
    expect(paperless.mocks.events).toContain("delete:1");
    expect(ledger.mocks.decisions).toEqual([{ proposalId: "prop_merge", decision: "applied" }]);
    const finalJournal = Object.values(ledger.mocks.applyJournals)[0];
    expect(finalJournal?.status).toBe("succeeded");
    expect(finalJournal?.steps.map((entry) => entry.stepId)).toEqual(
      expect.arrayContaining([
        "preread",
        "migrate-0",
        "verify-before-delete",
        "delete-verified-source",
      ]),
    );
    expect(finalJournal?.steps.some((entry) => entry.status === "pending")).toBe(true);
    expect(
      finalJournal?.steps.some((entry) => entry.status === "running" && entry.paperlessTaskId),
    ).toBe(true);
  });

  it("refuses moving catalog receipts before writing", async () => {
    const paperless = createPaperlessLayer({ sourceIds: [1, 2, 3, 4, 5, 99] });
    const ledger = createLedgerLayer();

    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest(),
    );
    expect(conflict.code).toBe("STALE_CATALOG");
    expect(paperless.mocks.mutation.submitAssignmentBatch).not.toHaveBeenCalled();
    expect(paperless.mocks.mutation.deleteEntity).not.toHaveBeenCalled();
    expect(Object.values(ledger.mocks.applyJournals)[0]?.status).toBe("conflict");
  });

  it("refuses stale proposal and evidence fingerprints before acquiring a lease", async () => {
    const paperless = createPaperlessLayer();
    const ledger = createLedgerLayer();
    const request = applyRequest();

    const staleProposal = await runApplyConflict(Layer.mergeAll(paperless.layer, ledger.layer), {
      ...request,
      expectedProposalFingerprint: hash("wrong-proposal"),
    });
    expect(staleProposal.code).toBe("STALE_PROPOSAL");

    const staleEvidence = await runApplyConflict(Layer.mergeAll(paperless.layer, ledger.layer), {
      ...request,
      expectedEvidenceFingerprint: hash("wrong-evidence"),
    });
    expect(staleEvidence.code).toBe("STALE_EVIDENCE");
    expect(ledger.mocks.ledger.acquireLease).not.toHaveBeenCalled();
  });

  it("loads persisted proposal and chair records instead of trusting forged caller records", async () => {
    const forgedProposal = proposal({
      proposalId: "prop_merge",
      decision: "approved",
      outcome: "approved",
    });
    const persistedProposal = proposal({
      proposalId: "prop_merge",
      decision: "undecided",
      outcome: null,
    });
    const ledger = createLedgerLayer({
      mergeProposal: persistedProposal,
      chair: chairDecision(persistedProposal),
    });
    const conflict = await runApplyConflict(
      Layer.mergeAll(createPaperlessLayer().layer, ledger.layer),
      applyRequest({ mergeProposal: forgedProposal, chair: chairDecision(forgedProposal) }),
    );

    expect(conflict.code).toBe("NOT_HUMAN_APPROVED");
    expect(ledger.mocks.ledger.acquireLease).not.toHaveBeenCalled();
  });

  it("refuses unsafe dependencies and busy mutation leases", async () => {
    const request = applyRequest();
    const unsafeProposal = proposal({
      proposedValues: {
        ...proposal().proposedValues,
        scope: "catalog",
        applicationBlockedReasons: ["matching_rules"],
      },
    });
    const unsafe = createLedgerLayer({
      mergeProposal: unsafeProposal,
      chair: chairDecision(unsafeProposal),
    });
    const unsafeConflict = await runApplyConflict(
      Layer.mergeAll(createPaperlessLayer().layer, unsafe.layer),
      applyRequest({ mergeProposal: unsafeProposal, chair: chairDecision(unsafeProposal) }),
    );
    expect(unsafeConflict.code).toBe("UNSAFE_DEPENDENCY");

    const busy = createLedgerLayer({ busyLease: true });
    const busyConflict = await runApplyConflict(
      Layer.mergeAll(createPaperlessLayer().layer, busy.layer),
      request,
    );
    expect(busyConflict).toMatchObject({ code: "LEASE_BUSY", retryable: true });
  });

  it("refuses apply when any mutated document lease is held by analysis", async () => {
    const paperless = createPaperlessLayer();
    const ledger = createLedgerLayer({ busyResourceId: "doc:3" });
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest(),
    );

    expect(conflict).toMatchObject({ code: "LEASE_BUSY", retryable: true });
    expect(paperless.mocks.mutation.submitAssignmentBatch).not.toHaveBeenCalled();
    expect(Object.keys(ledger.mocks.leases)).toEqual([]);
  });

  it("does not delete the source entity when post-task target coverage is not verified", async () => {
    const paperless = createPaperlessLayer({ skipTargetWrites: true });
    const ledger = createLedgerLayer();
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest(),
    );
    expect(conflict.code).toBe("POSTREAD_VERIFICATION_FAILED");

    expect(paperless.mocks.submitted.map((request) => request.operation)).toEqual(["modify_tags"]);
    expect(paperless.mocks.mutation.deleteEntity).not.toHaveBeenCalled();
  });

  it("surfaces retryable Paperless task failures without deleting", async () => {
    const paperless = createPaperlessLayer({ taskStatus: "failed" });
    const ledger = createLedgerLayer();
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest(),
    );
    expect(conflict).toMatchObject({ code: "TASK_FAILED", retryable: true });
    expect(paperless.mocks.mutation.deleteEntity).not.toHaveBeenCalled();
  });

  it("persists task acceptance before polling when a worker crashes after submit", async () => {
    const paperless = createPaperlessLayer({ pollThrows: true });
    const ledger = createLedgerLayer();
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest(),
    );

    expect(conflict).toMatchObject({ code: "AMBIGUOUS_WRITE" });
    const journal = Object.values(ledger.mocks.applyJournals)[0];
    expect(journal?.steps.some((entry) => entry.status === "pending")).toBe(true);
    expect(
      journal?.steps.some((entry) => entry.status === "running" && entry.paperlessTaskId),
    ).toBe(true);
    expect(paperless.mocks.mutation.deleteEntity).not.toHaveBeenCalled();
  });

  it("renames only after human approval and records an idempotent journal", async () => {
    const renameProposal = proposal({
      proposalId: "prop_rename",
      proposedValues: {
        ...proposal().proposedValues,
        scope: "catalog",
        intendedAction: "rename",
        targetEntityId: null,
        proposedValue: "Renamed",
        evidenceDocumentIds: [],
      },
    });
    const chair = chairDecision(renameProposal, { targetEntityId: null });
    const paperless = createPaperlessLayer({ sourceIds: [], targetIds: [] });
    const ledger = createLedgerLayer({ mergeProposal: renameProposal, chair });
    const request = applyRequest({
      mergeProposal: renameProposal,
      chair,
      sourceIds: [],
      targetIds: [],
      idempotencyKey: "idem-rename-0001",
    });
    const result = await runApply(
      Layer.mergeAll(paperless.layer, ledger.layer),
      Effect.gen(function* () {
        const service = yield* CatalogApplyService;
        return yield* service.applyReviewedProposal(request);
      }),
    );

    expect(result.status).toBe("applied");
    expect(paperless.mocks.name()).toBe("Renamed");
    expect(paperless.mocks.mutation.renameEntity).toHaveBeenCalledWith("tag", 1, "Renamed");
    expect(
      Object.values(ledger.mocks.applyJournals)[0]?.steps.map((entry) => entry.operation),
    ).toEqual(["describe", "rename"]);
  });

  it("treats rename to the current exact name as an idempotent no-op", async () => {
    const renameProposal = proposal({
      proposalId: "prop_rename_noop",
      proposedValues: {
        ...proposal().proposedValues,
        scope: "catalog",
        intendedAction: "rename",
        targetEntityId: null,
        proposedValue: "Source",
        evidenceDocumentIds: [],
      },
    });
    const chair = chairDecision(renameProposal, { targetEntityId: null });
    const paperless = createPaperlessLayer({ sourceIds: [], targetIds: [] });
    const ledger = createLedgerLayer({ mergeProposal: renameProposal, chair });
    const result = await runApply(
      Layer.mergeAll(paperless.layer, ledger.layer),
      Effect.gen(function* () {
        const service = yield* CatalogApplyService;
        return yield* service.applyReviewedProposal(
          applyRequest({
            mergeProposal: renameProposal,
            chair,
            sourceIds: [],
            targetIds: [],
            idempotencyKey: "idem-rename-noop",
            targetEntity: null,
          }),
        );
      }),
    );

    expect(result.status).toBe("already_applied");
    expect(paperless.mocks.mutation.renameEntity).not.toHaveBeenCalled();
  });

  it("refuses to delete a source that still has assignments", async () => {
    const deleteProposal = proposal({
      proposalId: "prop_delete",
      proposedValues: {
        ...proposal().proposedValues,
        scope: "catalog",
        intendedAction: "delete",
        targetEntityId: null,
        evidenceDocumentIds: [1],
      },
    });
    const chair = chairDecision(deleteProposal, { targetEntityId: null });
    const paperless = createPaperlessLayer({ sourceIds: [1], targetIds: [] });
    const ledger = createLedgerLayer({ mergeProposal: deleteProposal, chair });
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest({
        mergeProposal: deleteProposal,
        chair,
        sourceIds: [1],
        targetIds: [],
        idempotencyKey: "idem-delete-0001",
      }),
    );
    expect(conflict.code).toBe("POSTREAD_VERIFICATION_FAILED");
    expect(paperless.mocks.mutation.deleteEntity).not.toHaveBeenCalled();
  });

  it("fails closed when Paperless still returns an entity after delete", async () => {
    const deleteProposal = proposal({
      proposalId: "prop_delete_still_present",
      proposedValues: {
        ...proposal().proposedValues,
        scope: "catalog",
        intendedAction: "delete",
        targetEntityId: null,
        evidenceDocumentIds: [],
      },
    });
    const chair = chairDecision(deleteProposal, { targetEntityId: null });
    const paperless = createPaperlessLayer({
      sourceIds: [],
      targetIds: [],
      deleteStillPresent: true,
    });
    const ledger = createLedgerLayer({ mergeProposal: deleteProposal, chair });
    const conflict = await runApplyConflict(
      Layer.mergeAll(paperless.layer, ledger.layer),
      applyRequest({
        mergeProposal: deleteProposal,
        chair,
        sourceIds: [],
        targetIds: [],
        idempotencyKey: "idem-delete-still-present",
        targetEntity: null,
      }),
    );

    expect(conflict.code).toBe("POSTREAD_VERIFICATION_FAILED");
    expect(paperless.mocks.mutation.deleteEntity).toHaveBeenCalled();
    expect(Object.values(ledger.mocks.applyJournals)[0]?.status).toBe("conflict");
  });

  it("recovers an interrupted ambiguous write by rereading final target/source state", async () => {
    const mergeProposal = proposal();
    const chair = chairDecision(mergeProposal);
    const interrupted: ApplyJournal = {
      journalId: "journal_interrupted",
      proposalId: mergeProposal.proposalId,
      epochId: mergeProposal.ownerId,
      idempotencyKey: "journal_interrupted",
      status: "applying",
      preconditions: mergeProposal.preconditions,
      steps: [
        {
          stepId: "migrate-0",
          operation: "merge",
          paperlessTaskId: "task-old",
          beforeHash: hash("before"),
          afterHash: null,
          status: "running",
          recordedAt: iso,
        },
      ],
      createdAt: iso,
      updatedAt: iso,
    };
    const paperless = createPaperlessLayer({ sourceIds: [], targetIds: [1, 2, 3, 4, 5, 10] });
    const ledger = createLedgerLayer({
      mergeProposal,
      chair,
      journals: { [interrupted.journalId]: journalRecord(interrupted) },
    });
    const result = await runApply(
      Layer.mergeAll(paperless.layer, ledger.layer),
      Effect.gen(function* () {
        const service = yield* CatalogApplyService;
        return yield* service.recoverInterruptedApplies({ recoveredAt: iso });
      }),
    );

    expect(result).toEqual([
      {
        journalId: "journal_interrupted",
        proposalId: "prop_merge",
        status: "resumed_applied",
      },
    ]);
    expect(Object.values(ledger.mocks.applyJournals)[0]?.status).toBe("succeeded");
    expect(ledger.mocks.decisions).toEqual([{ proposalId: "prop_merge", decision: "applied" }]);
  });

  it("resumes partial migration after polling an accepted task from the journal", async () => {
    const mergeProposal = proposal();
    const chair = chairDecision(mergeProposal);
    const interrupted: ApplyJournal = {
      journalId: "journal_partial",
      proposalId: mergeProposal.proposalId,
      epochId: mergeProposal.ownerId,
      idempotencyKey: "journal_partial",
      status: "applying",
      preconditions: mergeProposal.preconditions,
      steps: [
        {
          stepId: "migrate-0",
          operation: "merge",
          paperlessTaskId: "task-old",
          beforeHash: hash("before"),
          afterHash: null,
          status: "running",
          recordedAt: iso,
        },
      ],
      createdAt: iso,
      updatedAt: iso,
    };
    const paperless = createPaperlessLayer({ sourceIds: [3, 4, 5], targetIds: [1, 2, 10] });
    const ledger = createLedgerLayer({
      mergeProposal,
      chair,
      journals: { [interrupted.journalId]: journalRecord(interrupted) },
    });
    const result = await runApply(
      Layer.mergeAll(paperless.layer, ledger.layer),
      Effect.gen(function* () {
        const service = yield* CatalogApplyService;
        return yield* service.recoverInterruptedApplies({
          recoveredAt: iso,
          taskPollIntervalMs: 1,
          taskPollTimeoutMs: 20,
        });
      }),
    );

    expect(result).toEqual([
      {
        journalId: "journal_partial",
        proposalId: "prop_merge",
        status: "resumed_applied",
      },
    ]);
    expect(paperless.mocks.submitted.map((request) => request.documentIds)).toEqual([[3, 4, 5]]);
    expect(paperless.mocks.targetIds()).toEqual([1, 2, 3, 4, 5, 10]);
    expect(Object.values(ledger.mocks.applyJournals)[0]?.status).toBe("succeeded");
  });
});
