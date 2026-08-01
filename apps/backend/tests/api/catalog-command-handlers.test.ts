import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  CatalogActionAcceptedSchema,
  CatalogApplyAcceptedSchema,
  CatalogEpochAcceptedSchema,
  canonicalSha256,
  type HashPrecondition,
} from "@repo/api-contracts";
import { Effect, Layer, Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CatalogCommandRuntime,
  catalogEpochStateHash,
  makeCatalogCommandHandlers,
} from "../../src/api/catalog/command-handlers.js";
import { CatalogEvidenceService } from "../../src/services/CatalogEvidenceService.js";
import {
  type ApplyReviewedCatalogProposalRequest,
  CatalogApplyMutationPort,
  CatalogApplyService,
  catalogApplyFingerprintForLiveState,
} from "../../src/services/catalog-apply/index.js";
import { CatalogCouncilService } from "../../src/services/catalog-council/index.js";
import type { CatalogEvidenceEpoch } from "../../src/services/catalog-evidence/types.js";
import {
  makeOperationalLedgerService,
  OperationalLedgerService,
  type OperationalLedgerServiceApi,
} from "../../src/services/OperationalLedgerService.js";
import type { PaperlessAssignmentReceipt } from "../../src/services/paperless/types.js";

const now = "2026-07-22T12:00:00.000Z";
const hash = (value: unknown) => canonicalSha256({ test: "catalog-command", value });
const proposalFingerprint = hash("proposal-fingerprint");
const evidenceFingerprint = hash("evidence-fingerprint");

const precondition = (value: string): HashPrecondition => ({
  kind: "catalog_epoch",
  digest: hash(value),
});

const epoch = {
  epochId: "cat_epoch_command",
  scope: ["tag"],
  createdAt: now,
  catalogFingerprint: hash("paperless-catalog"),
  freshnessFingerprint: hash("freshness"),
  epochFingerprint: hash("epoch"),
  scanStart: {
    observedAt: now,
    catalogFingerprint: hash("paperless-catalog"),
    freshnessFingerprint: hash("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 2,
  },
  scanEnd: {
    observedAt: now,
    catalogFingerprint: hash("paperless-catalog"),
    freshnessFingerprint: hash("freshness"),
    entityCounts: { tag: 2, correspondent: 0, document_type: 0 },
    totalDocuments: 2,
  },
  scanAttempts: 1,
  unstable: false,
  totalDocuments: 2,
  entities: { tag: [], correspondent: [], document_type: [] },
  snapshots: [],
  policy: {},
} satisfies CatalogEvidenceEpoch;

const receipt = (entityId: number, documentIds: readonly number[]): PaperlessAssignmentReceipt => ({
  kind: "tag",
  entityId,
  filterDescriptor: { path: "/documents/", params: { tags__id: entityId } },
  expectedApiCount: documentIds.length,
  fetchedCount: documentIds.length,
  pageCount: 1,
  documentIds,
  documents: documentIds.map((documentId) => ({
    documentId,
    modified: now,
    stateHash: hash(`doc-${documentId}`),
    verifiedMembership: true,
  })),
  capturedAt: now,
  assignmentHash: hash({ entityId, documentIds }),
  complete: true,
});

const proposalValues = () => ({
  scope: "catalog" as const,
  entityKind: "tag" as const,
  intendedAction: "merge" as const,
  sourceEntityId: 10,
  targetEntityId: 20,
  proposedValue: null,
  candidateIds: ["cand_command"],
  evidenceDocumentIds: [101, 202],
  expectedProposalFingerprint: proposalFingerprint,
  expectedEvidenceFingerprint: evidenceFingerprint,
  candidateRiskFlags: [],
  coverageRiskFlags: [],
  requiresHumanReview: true,
  applicationBlockedReasons: [],
});

const createRuntime = () => {
  const scheduled: { taskId: string; effect: Effect.Effect<void, never, unknown> }[] = [];
  const canceled: string[] = [];
  const runtime: CatalogCommandRuntime = {
    schedule: vi.fn((taskId, effect) => {
      scheduled.push({ taskId, effect });
      return Effect.void;
    }),
    cancel: vi.fn((taskId) => {
      canceled.push(taskId);
      return Effect.succeed(true);
    }),
  };
  return { runtime, scheduled, canceled };
};

const decode = <S extends Schema.Schema.AnyNoContext>(schema: S, value: unknown) => {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  if (decoded._tag === "Left") throw new Error("response failed schema decode");
  return decoded.right;
};

describe("catalog command handlers", () => {
  let tempDir: string;
  let ledger: OperationalLedgerServiceApi;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-command-test-"));
    ledger = await Effect.runPromise(
      makeOperationalLedgerService({
        dataDir: tempDir,
        file: path.join(tempDir, "operational-ledger.json"),
      }),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const baseLayer = (extra: Layer.Layer<never, never, never> = Layer.empty) =>
    Layer.mergeAll(Layer.succeed(OperationalLedgerService, ledger), extra);

  const makeEvidenceLayer = (overrides: Partial<CatalogEvidenceService> = {}) => {
    const service = {
      buildEpoch: vi.fn((options?: { readonly epochId?: string; readonly createdAt?: string }) =>
        Effect.succeed({
          ...epoch,
          epochId: options?.epochId ?? epoch.epochId,
          createdAt: options?.createdAt ?? epoch.createdAt,
        }),
      ),
      blockCandidates: vi.fn(() => Effect.succeed([])),
      collectEvidence: vi.fn(),
      expandEvidence: vi.fn(),
      listUnusedReviews: vi.fn(() => Effect.succeed([])),
      validateCitationIds: vi.fn(),
      ...overrides,
    } as unknown as CatalogEvidenceService;
    return { layer: Layer.succeed(CatalogEvidenceService, service), service };
  };

  const councilLayer = Layer.succeed(CatalogCouncilService, {
    optimizeCatalog: vi.fn(),
    runCandidate: vi.fn(),
    scoutMergeDossiers: vi.fn(),
    reviewMergeDossier: vi.fn(),
    reviewNewEntity: vi.fn(),
  } as unknown as CatalogCouncilService);

  const createProposal = async (
    options: { readonly chairEvidenceFingerprint?: typeof evidenceFingerprint } = {},
  ) => {
    await Effect.runPromise(
      ledger.createCatalogEpoch({
        epochId: epoch.epochId,
        scope: ["tag"],
        paperlessCatalogHash: epoch.catalogFingerprint,
        createdAt: now,
      }),
    );
    const proposal = await Effect.runPromise(
      ledger.recordProposal({
        proposalId: "prop_command",
        ownerId: epoch.epochId,
        scope: "catalog",
        proposalHash: hash("proposal"),
        proposedValues: proposalValues(),
        evidenceIds: ["evidence_1"],
        coverage: 1,
        rationale: "Compact catalog proposal for command tests.",
        preconditions: [precondition("proposal")],
        createdAt: now,
      }),
    );
    const chair = await Effect.runPromise(
      ledger.recordChairDecision({
        kind: "compact_chair_decision",
        epochId: epoch.epochId,
        candidateIds: ["cand_command"],
        proposalId: proposal.proposalId,
        verdict: "approve",
        action: "request_review",
        sourceEntityId: 10,
        targetEntityId: 20,
        rationale: "Human review is required before apply.",
        dissent: null,
        evidenceIds: ["evidence_1"],
        confidence: 1,
        proposalFingerprint,
        evidenceFingerprint: options.chairEvidenceFingerprint ?? evidenceFingerprint,
        coverageHash: hash("coverage"),
        coverageCount: 2,
        inspectedDocumentCount: 2,
        totalDocumentCount: 2,
        createdAt: now,
        decidedAt: now,
      }),
    );
    return { proposal, chair };
  };

  it("starts catalog optimization asynchronously and preserves idempotency", async () => {
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);
    const evidence = makeEvidenceLayer({
      buildEpoch: vi.fn(() => Effect.die("start must not build evidence before 202")),
    });

    const first = await Effect.runPromise(
      handlers
        .startCatalogOptimization({
          scope: ["tag"],
          expectedPaperlessCatalogHash: epoch.catalogFingerprint,
          idempotencyKey: "start-command-1",
        })
        .pipe(Effect.provide(baseLayer(evidence.layer))),
    );
    const second = await Effect.runPromise(
      handlers
        .startCatalogOptimization({
          scope: ["tag"],
          expectedPaperlessCatalogHash: epoch.catalogFingerprint,
          idempotencyKey: "start-command-1",
        })
        .pipe(Effect.provide(baseLayer(evidence.layer))),
    );
    const accepted = decode(CatalogEpochAcceptedSchema, first);

    expect(accepted).toMatchObject({
      status: 202,
      state: "queued",
    });
    expect(accepted.epochId).toMatch(/^cat_epoch_cmd_/);
    expect(second).toEqual(first);
    expect(scheduled).toHaveLength(1);
    expect(evidence.service.buildEpoch).not.toHaveBeenCalled();
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    expect(snapshot.catalogEpochs[accepted.epochId]?.state).toBe("queued");
    expect(snapshot.catalogEpochs[accepted.epochId]?.paperlessCatalogHash).toBe(
      epoch.catalogFingerprint,
    );
    expect(snapshot.ledgerEntries.filter((entry) => entry.state === "accepted:start")).toHaveLength(
      1,
    );
  });

  it("records background optimization failure after a legal queued transition", async () => {
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);
    const evidence = makeEvidenceLayer({
      blockCandidates: vi.fn(() => Effect.fail(new Error("Paperless scan failed"))),
    });
    const accepted = decode(
      CatalogEpochAcceptedSchema,
      await Effect.runPromise(
        handlers
          .startCatalogOptimization({
            scope: ["tag"],
            expectedPaperlessCatalogHash: epoch.catalogFingerprint,
            idempotencyKey: "start-fail-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );

    const scheduledOptimization = scheduled[0];
    expect(scheduledOptimization).toBeDefined();
    if (scheduledOptimization === undefined) {
      throw new Error("expected scheduled optimization task");
    }
    await Effect.runPromise(
      scheduledOptimization.effect.pipe(
        Effect.provide(baseLayer(Layer.mergeAll(evidence.layer, councilLayer))),
      ),
    );
    expect(evidence.service.buildEpoch).toHaveBeenCalledWith(
      expect.objectContaining({ epochId: accepted.epochId }),
    );
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    expect(snapshot.catalogEpochs[accepted.epochId]?.state).toBe("failed");
    expect(snapshot.ledgerEntries.map((entry) => entry.state)).toEqual(
      expect.arrayContaining(["collecting", "failed"]),
    );
  });

  it("rejects missing, extra, null, empty, duplicate, and unknown catalog command inputs", async () => {
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);
    const invalidStarts = [
      {},
      {
        scope: [],
        expectedPaperlessCatalogHash: epoch.catalogFingerprint,
        idempotencyKey: "bad-start-1",
      },
      {
        scope: ["tag", "tag"],
        expectedPaperlessCatalogHash: epoch.catalogFingerprint,
        idempotencyKey: "bad-start-2",
      },
      { scope: ["tag"], expectedPaperlessCatalogHash: null, idempotencyKey: "bad-start-3" },
      {
        scope: ["tag"],
        expectedPaperlessCatalogHash: epoch.catalogFingerprint,
        idempotencyKey: "bad-start-4",
        payload: {},
      },
    ];

    for (const body of invalidStarts) {
      const result = await Effect.runPromise(
        Effect.either(handlers.startCatalogOptimization(body).pipe(Effect.provide(baseLayer()))),
      );
      expect(result).toMatchObject({
        _tag: "Left",
        left: { status: 502, code: "PROVIDER_MALFORMED" },
      });
    }

    const missingProposal = await Effect.runPromise(
      Effect.either(
        handlers
          .approveCatalogProposal("prop_missing", {
            expectedProposalFingerprint: proposalFingerprint,
            reason: "Human reviewed the missing proposal path.",
            idempotencyKey: "approve-missing-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );

    expect(missingProposal).toMatchObject({
      _tag: "Left",
      left: { status: 409, code: "STALE_PRECONDITION" },
    });
    expect(scheduled).toHaveLength(0);
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    expect(Object.keys(snapshot.catalogEpochs)).toHaveLength(0);
  });

  it("cancels with a state hash and interrupts only the requested epoch task idempotently", async () => {
    const { runtime, canceled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);
    const firstStart = decode(
      CatalogEpochAcceptedSchema,
      await Effect.runPromise(
        handlers
          .startCatalogOptimization({
            scope: ["tag"],
            expectedPaperlessCatalogHash: epoch.catalogFingerprint,
            idempotencyKey: "start-cancel-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );
    const secondStart = decode(
      CatalogEpochAcceptedSchema,
      await Effect.runPromise(
        handlers
          .startCatalogOptimization({
            scope: ["tag"],
            expectedPaperlessCatalogHash: hash("other-paperless-catalog"),
            idempotencyKey: "start-cancel-2",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    const catalogEpoch = snapshot.catalogEpochs[firstStart.epochId];
    expect(catalogEpoch).toBeDefined();
    if (catalogEpoch === undefined) {
      throw new Error("expected test catalog epoch");
    }
    const stateHash = catalogEpochStateHash(catalogEpoch);

    const first = await Effect.runPromise(
      handlers
        .cancelCatalogOptimization(firstStart.epochId, {
          expectedEpochStateHash: stateHash,
          reason: "Human canceled the optimization.",
          idempotencyKey: "cancel-command-1",
        })
        .pipe(Effect.provide(baseLayer())),
    );
    const second = await Effect.runPromise(
      handlers
        .cancelCatalogOptimization(firstStart.epochId, {
          expectedEpochStateHash: stateHash,
          reason: "Human canceled the optimization.",
          idempotencyKey: "cancel-command-1",
        })
        .pipe(Effect.provide(baseLayer())),
    );

    expect(decode(CatalogActionAcceptedSchema, first)).toMatchObject({
      status: 202,
      epochId: firstStart.epochId,
      action: "cancel",
    });
    expect(second).toEqual(first);
    expect(canceled).toEqual([`catalog:optimize:${firstStart.epochId}`]);
    const after = await Effect.runPromise(ledger.getSnapshot());
    expect(after.catalogEpochs[firstStart.epochId]?.state).toBe("canceled");
    expect(after.catalogEpochs[secondStart.epochId]?.state).toBe("queued");

    const staleCancel = await Effect.runPromise(
      Effect.either(
        handlers
          .cancelCatalogOptimization(secondStart.epochId, {
            expectedEpochStateHash: hash("wrong-epoch-state"),
            reason: "Human canceled the optimization.",
            idempotencyKey: "cancel-stale-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );
    expect(staleCancel).toMatchObject({
      _tag: "Left",
      left: { status: 409, code: "STALE_PRECONDITION" },
    });
  });

  it("requires human-authored proposal decisions and records approve/reject idempotently", async () => {
    const { proposal } = await createProposal();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, createRuntime().runtime);

    const missingReason = await Effect.runPromise(
      Effect.either(
        handlers
          .approveCatalogProposal(proposal.proposalId, {
            expectedProposalFingerprint: proposalFingerprint,
            idempotencyKey: "approve-command-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );
    expect(missingReason._tag).toBe("Left");
    if (missingReason._tag === "Left") {
      expect(missingReason.left).toMatchObject({
        status: 409,
        code: "HUMAN_DECISION_REQUIRED",
      });
    }

    const first = await Effect.runPromise(
      handlers
        .approveCatalogProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposalFingerprint,
          reason: "Human approved the cleanup after reviewing evidence.",
          idempotencyKey: "approve-command-1",
        })
        .pipe(Effect.provide(baseLayer())),
    );
    const second = await Effect.runPromise(
      handlers
        .approveCatalogProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposalFingerprint,
          reason: "Human approved the cleanup after reviewing evidence.",
          idempotencyKey: "approve-command-1",
        })
        .pipe(Effect.provide(baseLayer())),
    );

    expect(decode(CatalogActionAcceptedSchema, first)).toMatchObject({
      status: 202,
      proposalId: proposal.proposalId,
      action: "approve",
    });
    expect(second).toEqual(first);
    const snapshot = await Effect.runPromise(ledger.getSnapshot());
    expect(snapshot.proposals[proposal.proposalId]?.decision).toBe("approved");
  });

  it("accepts apply with proposal/evidence fingerprints and never applies during the command call", async () => {
    const { proposal, chair } = await createProposal();
    await Effect.runPromise(
      ledger.recordProposalDecision(proposal.proposalId, {
        expectedDecision: "undecided",
        decision: "approved",
        outcome: "approved",
        decidedAt: now,
      }),
    );
    const source = receipt(10, [101]);
    const target = receipt(20, [202]);
    const sourceEntity = {
      kind: "tag" as const,
      entityId: 10,
      exists: true,
      name: "Vendor GmbH",
      dependencyHash: hash("source-dependency"),
      blockedReasons: [],
    };
    const targetEntity = {
      kind: "tag" as const,
      entityId: 20,
      exists: true,
      name: "Vendor",
      dependencyHash: hash("target-dependency"),
      blockedReasons: [],
    };
    const applyRequests: ApplyReviewedCatalogProposalRequest[] = [];
    const mutationLayer = Layer.succeed(CatalogApplyMutationPort, {
      readEntity: vi.fn((_kind, entityId: number) =>
        Effect.succeed(entityId === 10 ? sourceEntity : targetEntity),
      ),
      findEntityByName: vi.fn(),
      readAssignmentReceipt: vi.fn((_kind, entityId: number) =>
        Effect.succeed(entityId === 10 ? source : target),
      ),
      readDocumentMutationState: vi.fn(),
      submitAssignmentBatch: vi.fn(),
      pollTask: vi.fn(),
      deleteEntity: vi.fn(),
      renameEntity: vi.fn(),
      invalidateCatalogCache: vi.fn(),
    });
    const applyLayer = Layer.succeed(CatalogApplyService, {
      applyReviewedProposal: vi.fn((request: ApplyReviewedCatalogProposalRequest) => {
        applyRequests.push(request);
        return Effect.succeed({
          status: "accepted",
          proposalId: request.proposal.proposalId,
          journal: {
            journalId: "journal_command",
            proposalId: request.proposal.proposalId,
            epochId: request.proposal.ownerId,
            idempotencyKey: request.idempotencyKey,
            status: "accepted",
            preconditions: request.proposal.preconditions,
            steps: [],
            createdAt: now,
            updatedAt: now,
          },
          leaseId: null,
          sourceEntityId: 10,
          targetEntityId: 20,
          migrationDocumentIds: [101, 202],
          paperlessTasks: [],
          preApplyCatalogFingerprint: request.expectedCatalogFingerprint,
          postApplyCatalogFingerprint: null,
        });
      }),
      recoverInterruptedApplies: vi.fn(),
    } as unknown as CatalogApplyService);
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);

    const response = await Effect.runPromise(
      handlers
        .applyCatalogProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposalFingerprint,
          expectedEvidenceFingerprint: evidenceFingerprint,
          idempotencyKey: "apply-command-1",
        })
        .pipe(Effect.provide(baseLayer(Layer.mergeAll(mutationLayer, applyLayer)))),
    );

    expect(decode(CatalogApplyAcceptedSchema, response)).toMatchObject({
      status: 202,
      proposalId: proposal.proposalId,
      action: "apply",
    });
    expect(applyRequests).toHaveLength(0);
    expect(scheduled).toHaveLength(1);

    const scheduledApply = scheduled[0];
    expect(scheduledApply).toBeDefined();
    if (scheduledApply === undefined) {
      throw new Error("expected scheduled apply task");
    }
    await Effect.runPromise(scheduledApply.effect);
    expect(applyRequests).toHaveLength(1);
    const applyRequest = applyRequests[0];
    expect(applyRequest).toBeDefined();
    if (applyRequest === undefined) {
      throw new Error("expected apply request");
    }
    expect(applyRequest).toMatchObject({
      proposal: { proposalId: proposal.proposalId },
      chairDecision: { proposalId: chair.proposalId },
      expectedProposalFingerprint: proposalFingerprint,
      expectedEvidenceFingerprint: evidenceFingerprint,
      idempotencyKey: "apply-command-1",
    });
    expect(applyRequest.expectedCatalogFingerprint).toBe(
      catalogApplyFingerprintForLiveState({
        receipts: { kind: "tag", source, target },
        sourceEntity,
        targetEntity,
      }),
    );
  });

  it("rejects apply immediately when the persisted proposal is not approved", async () => {
    const { proposal } = await createProposal();
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);

    const result = await Effect.runPromise(
      Effect.either(
        handlers
          .applyCatalogProposal(proposal.proposalId, {
            expectedProposalFingerprint: proposalFingerprint,
            expectedEvidenceFingerprint: evidenceFingerprint,
            idempotencyKey: "apply-unapproved-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        status: 409,
        code: "STATE_TRANSITION_CONFLICT",
      });
    }
    expect(scheduled).toHaveLength(0);
  });

  it("rejects apply immediately when the persisted chair fingerprints do not match", async () => {
    const { proposal } = await createProposal({ chairEvidenceFingerprint: hash("forged-chair") });
    await Effect.runPromise(
      ledger.recordProposalDecision(proposal.proposalId, {
        expectedDecision: "undecided",
        decision: "approved",
        outcome: "approved",
        decidedAt: now,
      }),
    );
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);

    const result = await Effect.runPromise(
      Effect.either(
        handlers
          .applyCatalogProposal(proposal.proposalId, {
            expectedProposalFingerprint: proposalFingerprint,
            expectedEvidenceFingerprint: evidenceFingerprint,
            idempotencyKey: "apply-chair-mismatch-1",
          })
          .pipe(Effect.provide(baseLayer())),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left).toMatchObject({
        status: 409,
        code: "STALE_PRECONDITION",
      });
    }
    expect(scheduled).toHaveLength(0);
  });

  it("accepts dry-run apply without scheduling the apply service", async () => {
    const { proposal } = await createProposal();
    await Effect.runPromise(
      ledger.recordProposalDecision(proposal.proposalId, {
        expectedDecision: "undecided",
        decision: "approved",
        outcome: "approved",
        decidedAt: now,
      }),
    );
    const mutationLayer = Layer.succeed(CatalogApplyMutationPort, {
      readEntity: vi.fn((_kind, entityId: number) =>
        Effect.succeed({
          kind: "tag" as const,
          entityId,
          exists: true,
          name: `tag-${entityId}`,
          dependencyHash: hash(`dependency-${entityId}`),
          blockedReasons: [],
        }),
      ),
      readAssignmentReceipt: vi.fn((_kind, entityId: number) =>
        Effect.succeed(receipt(entityId, entityId === 10 ? [101] : [202])),
      ),
    } as unknown as typeof CatalogApplyMutationPort.Service);
    const apply = { applyReviewedProposal: vi.fn(), recoverInterruptedApplies: vi.fn() };
    const applyLayer = Layer.succeed(CatalogApplyService, apply as unknown as CatalogApplyService);
    const { runtime, scheduled } = createRuntime();
    const handlers = makeCatalogCommandHandlers({ now: () => now }, runtime);

    await Effect.runPromise(
      handlers
        .applyCatalogProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposalFingerprint,
          expectedEvidenceFingerprint: evidenceFingerprint,
          idempotencyKey: "apply-dryrun-1",
          dryRun: true,
        })
        .pipe(Effect.provide(baseLayer(Layer.mergeAll(mutationLayer, applyLayer)))),
    );

    expect(scheduled).toHaveLength(0);
    expect(apply.applyReviewedProposal).not.toHaveBeenCalled();
  });
});
