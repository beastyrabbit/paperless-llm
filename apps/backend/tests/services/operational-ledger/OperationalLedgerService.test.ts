import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type ApplyJournal,
  canonicalSha256,
  type HashPrecondition,
  type StorageLedgerEntry,
} from "@repo/api-contracts";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadOperationalLedger,
  makeEmptyOperationalLedger,
  makeOperationalLedgerService,
  type OperationalLedgerData,
  type ProposalRecord,
  persistOperationalLedger,
  resolveOperationalLedgerPaths,
} from "../../../src/services/OperationalLedgerService.js";

const digest = (value: string) => canonicalSha256(value);
const iso = (value: string) => new Date(value).toISOString();

const precondition = (value: string): HashPrecondition => ({
  kind: "paperless_document_state",
  digest: digest(value),
});

const analysisProposalValues = () => ({
  scope: "analysis" as const,
  title: "Exact Proposed Invoice Title",
  correspondentId: 12,
  documentTypeId: null,
  ordinaryTagIds: [3, 5, 8],
  newTagCandidates: [
    {
      candidateKey: "new_tag_followup",
      name: "Follow Up",
      color: "#336699",
      rationale: "Compact candidate rationale.",
      evidenceIds: ["evidence_analysis_1"],
      confidence: 0.88,
    },
  ],
  customFields: [
    {
      customFieldId: 44,
      operation: "set" as const,
      value: { invoiceNo: "INV-2026-0042", dueDays: 14 },
      valueHash: digest("custom-field-value"),
    },
    {
      customFieldId: 45,
      operation: "remove" as const,
      value: null,
      valueHash: null,
    },
  ],
});

const catalogProposalValues = () => ({
  scope: "catalog" as const,
  entityKind: "tag" as const,
  intendedAction: "merge" as const,
  sourceEntityId: 10,
  targetEntityId: 20,
  proposedValue: "Merged Vendor Tag",
  candidateIds: ["cand_vendor_merge"],
  evidenceDocumentIds: [101, 202, 303],
  expectedProposalFingerprint: digest("expected-proposal"),
  expectedEvidenceFingerprint: digest("expected-evidence"),
  candidateRiskFlags: ["matching_rule", "dependency_risk", "matching_rule"],
  coverageRiskFlags: ["missing_semantic_signature", "forced_review_high_risk"],
  requiresHumanReview: true,
  applicationBlockedReasons: ["workflows", "permissions", "workflows"],
});

const proposalRecord = (
  overrides: Partial<ProposalRecord> & Pick<ProposalRecord, "proposalId" | "createdAt">,
): ProposalRecord => {
  const values = analysisProposalValues();
  return {
    kind: "undecided_analysis_proposal_values",
    scope: "analysis",
    proposalId: overrides.proposalId,
    ownerId: "ana_run_old",
    proposalHash: digest(`${overrides.proposalId}-proposal`),
    valueHash: digest(`${overrides.proposalId}-value`),
    proposedValues: values,
    evidenceIds: ["evidence_analysis_1"],
    coverage: 0.9,
    rationale: "Retained proposal rationale.",
    preconditions: [precondition(`${overrides.proposalId}-precondition`)],
    decision: "undecided",
    outcome: null,
    decidedAt: null,
    compactedAt: null,
    ...overrides,
  };
};

const chairDecision = (overrides: Record<string, unknown> = {}) => ({
  kind: "compact_chair_decision" as const,
  epochId: "cat_epoch_chair",
  candidateIds: ["cand_vendor_merge"],
  proposalId: "prop_chair",
  verdict: "approve" as const,
  action: "approve" as const,
  sourceEntityId: 10,
  targetEntityId: 20,
  rationale: "Concise chair rationale from compact evidence.",
  dissent: null,
  evidenceIds: ["evidence_vote_1", "evidence_vote_2"],
  confidence: 0.91,
  proposalFingerprint: digest("chair-proposal-fingerprint"),
  evidenceFingerprint: digest("chair-evidence-fingerprint"),
  coverageHash: digest("chair-coverage"),
  coverageCount: 7,
  inspectedDocumentCount: 9,
  totalDocumentCount: 30,
  createdAt: iso("2026-07-20T13:00:00.000Z"),
  decidedAt: iso("2026-07-20T13:01:00.000Z"),
  ...overrides,
});

const forbiddenKeys = [
  "ocrText",
  "documentContent",
  "currentPaperlessMetadata",
  "prompt",
  "transcript",
  "rawModelOutput",
  "requestBody",
  "responseBody",
  "body",
  "content",
  "catalogSnapshot",
  "rawProviderOutput",
];

const expectNoForbiddenKeys = (value: unknown): void => {
  if (value === null || value === undefined || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(expectNoForbiddenKeys);
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    expect(forbiddenKeys).not.toContain(key);
    expectNoForbiddenKeys(child);
  }
};

describe("OperationalLedgerService", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "operational-ledger-test-"));
    process.env.PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR = tempDir;
  });

  afterEach(() => {
    delete process.env.PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("persists only compact allowed records and rejects forbidden content fields", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    await Effect.runPromise(
      service.createAnalysisRun({
        runId: "ana_run_policy",
        documentId: 42,
        documentStateHash: digest("document-state"),
        sourcePdfHash: digest("source-pdf"),
      }),
    );
    await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_policy",
        ownerId: "ana_run_policy",
        scope: "analysis",
        proposalHash: digest("proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_policy"],
        coverage: 0.75,
        rationale: "Compact rationale based on hashed evidence.",
        preconditions: [precondition("proposal-precondition")],
      }),
    );
    const run = await Effect.runPromise(
      service.recordAnalysisFailure("ana_run_policy", {
        code: "PROVIDER_FAILURE",
        message: "OCR text SECRET-INVOICE-CONTENT was present in the provider error.",
        retryable: true,
        provider: "ollama",
      }),
    );
    await Effect.runPromise(
      service.recordProviderUsage({
        provider: "ollama",
        model: "llama3",
        operation: "analysis",
        runId: "ana_run_policy",
        promptTokens: 7,
        completionTokens: 11,
      }),
    );

    expect(run.failure?.message).toBe("Failure details omitted by storage policy.");
    await expect(
      Effect.runPromise(
        service.recordProviderUsage({
          provider: "ollama",
          model: "llama3",
          operation: "analysis",
          prompt: "never persist this prompt",
        } as never),
      ),
    ).rejects.toThrow(/Forbidden storage field: prompt/);
    await expect(
      Effect.runPromise(
        service.appendLedgerEntry({
          kind: "ocr_text",
          timestamp: new Date().toISOString(),
        } as never),
      ),
    ).rejects.toThrow(/Storage artifact kind is not allowed|Forbidden storage artifact kind/);

    const serialized = fs.readFileSync(path.join(tempDir, "operational-ledger.json"), "utf-8");
    expect(serialized).not.toContain("SECRET-INVOICE-CONTENT");
    const parsed = JSON.parse(serialized) as OperationalLedgerData;
    expectNoForbiddenKeys(parsed);
    expect(parsed.providerUsage).toHaveLength(1);
    expect(parsed.proposals.prop_policy?.proposedValues?.scope).toBe("analysis");
    expect(parsed.proposals.prop_policy?.proposedValues?.valueHash).toBeUndefined();
  });

  it("round-trips undecided analysis and catalog proposal values until decision", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    await Effect.runPromise(
      service.createAnalysisRun({
        runId: "ana_run_values",
        documentId: 42,
        documentStateHash: digest("values-doc"),
      }),
    );
    const analysis = await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_analysis_values",
        ownerId: "ana_run_values",
        scope: "analysis",
        proposalHash: digest("analysis-values-proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_analysis_1"],
        coverage: 0.82,
        rationale: "Analysis proposal stores allowed metadata values.",
        preconditions: [precondition("analysis-values")],
      }),
    );
    const catalog = await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_catalog_values",
        ownerId: "cat_epoch_values",
        scope: "catalog",
        proposalHash: digest("catalog-values-proposal"),
        proposedValues: catalogProposalValues(),
        evidenceIds: ["evidence_catalog_1"],
        coverage: 1,
        rationale: "Catalog proposal stores source target and action IDs.",
        preconditions: [precondition("catalog-values")],
      }),
    );

    expect(analysis.decision).toBe("undecided");
    expect(analysis.outcome).toBeNull();
    expect(analysis.decidedAt).toBeNull();
    expect(analysis.proposedValues?.scope).toBe("analysis");
    if (analysis.proposedValues?.scope !== "analysis") throw new Error("expected analysis values");
    expect(analysis.proposedValues.title).toBe("Exact Proposed Invoice Title");
    expect(analysis.proposedValues.correspondentId).toBe(12);
    expect(analysis.proposedValues.documentTypeId).toBeNull();
    expect(analysis.proposedValues.ordinaryTagIds).toEqual([3, 5, 8]);
    expect(analysis.proposedValues.newTagCandidates[0]?.name).toBe("Follow Up");
    expect(analysis.proposedValues.customFields).toEqual([
      {
        customFieldId: 44,
        operation: "set",
        value: { invoiceNo: "INV-2026-0042", dueDays: 14 },
        valueHash: digest("custom-field-value"),
      },
      { customFieldId: 45, operation: "remove", value: null, valueHash: null },
    ]);

    if (catalog.proposedValues?.scope !== "catalog") throw new Error("expected catalog values");
    expect(catalog.proposedValues.entityKind).toBe("tag");
    expect(catalog.proposedValues.intendedAction).toBe("merge");
    expect(catalog.proposedValues.sourceEntityId).toBe(10);
    expect(catalog.proposedValues.targetEntityId).toBe(20);
    expect(catalog.proposedValues.candidateIds).toEqual(["cand_vendor_merge"]);
    expect(catalog.proposedValues.evidenceDocumentIds).toEqual([101, 202, 303]);
    expect(catalog.proposedValues.candidateRiskFlags).toEqual(["dependency_risk", "matching_rule"]);
    expect(catalog.proposedValues.coverageRiskFlags).toEqual([
      "forced_review_high_risk",
      "missing_semantic_signature",
    ]);
    expect(catalog.proposedValues.applicationBlockedReasons).toEqual(["permissions", "workflows"]);

    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(fromDisk.proposals.prop_analysis_values?.proposedValues).toEqual(
      analysis.proposedValues,
    );
    expect(fromDisk.proposals.prop_catalog_values?.proposedValues).toEqual(catalog.proposedValues);
  });

  it("validates catalog proposal safety enums without persisting unsafe arbitrary values", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    await expect(
      Effect.runPromise(
        service.recordProposal({
          proposalId: "prop_bad_safety",
          ownerId: "cat_epoch_values",
          scope: "catalog",
          proposalHash: digest("catalog-bad-safety"),
          proposedValues: {
            ...catalogProposalValues(),
            candidateRiskFlags: ["matching_rule", "unknown_risk"],
          } as never,
          evidenceIds: ["evidence_catalog_1"],
          coverage: 1,
          rationale: "Catalog proposal stores only known safety flags.",
          preconditions: [precondition("catalog-bad-safety")],
        }),
      ),
    ).rejects.toThrow(/Invalid catalog candidate risk flag: unknown_risk/);

    await expect(
      Effect.runPromise(
        service.recordProposal({
          proposalId: "prop_bad_blocker",
          ownerId: "cat_epoch_values",
          scope: "catalog",
          proposalHash: digest("catalog-bad-blocker"),
          proposedValues: {
            ...catalogProposalValues(),
            applicationBlockedReasons: ["permissions", "unknown_blocker"],
          } as never,
          evidenceIds: ["evidence_catalog_1"],
          coverage: 1,
          rationale: "Catalog proposal stores only known safety blockers.",
          preconditions: [precondition("catalog-bad-blocker")],
        }),
      ),
    ).rejects.toThrow(/Invalid catalog application blocked reason: unknown_blocker/);
  });

  it("enforces legal compare-and-set state transitions", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    await Effect.runPromise(
      service.createAnalysisRun({
        runId: "ana_run_cas",
        documentId: 7,
        documentStateHash: digest("cas-doc"),
      }),
    );

    const reading = await Effect.runPromise(
      service.transitionAnalysisRunState("ana_run_cas", "queued", "reading_paperless"),
    );
    expect(reading.state).toBe("reading_paperless");
    await expect(
      Effect.runPromise(
        service.transitionAnalysisRunState("ana_run_cas", "queued", "hashing_source"),
      ),
    ).rejects.toThrow(/expected queued, found reading_paperless/);
    await expect(
      Effect.runPromise(
        service.transitionAnalysisRunState("ana_run_cas", "reading_paperless", "succeeded"),
      ),
    ).rejects.toThrow(/Illegal state transition/);

    await Effect.runPromise(
      service.createCatalogEpoch({
        epochId: "cat_epoch_cas",
        scope: ["tag"],
        paperlessCatalogHash: digest("catalog"),
      }),
    );
    const collecting = await Effect.runPromise(
      service.transitionCatalogEpochState("cat_epoch_cas", "queued", "collecting"),
    );
    expect(collecting.state).toBe("collecting");
    await expect(
      Effect.runPromise(
        service.transitionCatalogEpochState("cat_epoch_cas", "collecting", "applied"),
      ),
    ).rejects.toThrow(/Illegal state transition/);
  });

  it("coordinates mutation leases by owner, run id, and expiry", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    const first = await Effect.runPromise(
      service.acquireLease({
        scope: "mutation",
        resourceId: "catalog",
        owner: "worker-a",
        runId: "run-a",
        ttlMs: 60_000,
      }),
    );
    expect(first.acquired).toBe(true);

    const denied = await Effect.runPromise(
      service.acquireLease({
        scope: "mutation",
        resourceId: "catalog",
        owner: "worker-b",
        runId: "run-b",
        ttlMs: 60_000,
      }),
    );
    expect(denied.acquired).toBe(false);
    expect(denied.lease.runId).toBe("run-a");

    await expect(
      Effect.runPromise(service.heartbeatLease(first.lease.leaseId, "wrong-run")),
    ).resolves.toBeNull();
    await expect(
      Effect.runPromise(service.releaseLease(first.lease.leaseId, "wrong-run")),
    ).resolves.toBe(false);
    await expect(
      Effect.runPromise(service.heartbeatLease(first.lease.leaseId, "run-a", 60_000)),
    ).resolves.toMatchObject({
      runId: "run-a",
    });
    await expect(
      Effect.runPromise(service.releaseLease(first.lease.leaseId, "run-a")),
    ).resolves.toBe(true);

    const stale = await Effect.runPromise(
      service.acquireLease({
        scope: "document",
        resourceId: 99,
        owner: "worker-a",
        runId: "expired-run",
        ttlMs: -1,
      }),
    );
    expect(stale.acquired).toBe(true);
    const recovered = await Effect.runPromise(
      service.acquireLease({
        scope: "document",
        resourceId: 99,
        owner: "worker-b",
        runId: "fresh-run",
        ttlMs: 60_000,
      }),
    );
    expect(recovered.acquired).toBe(true);
    expect(recovered.staleRecovered).toBe(true);
    expect(recovered.lease.runId).toBe("fresh-run");
  });

  it("recovers a complete temp file after an interrupted atomic write", async () => {
    const paths = resolveOperationalLedgerPaths();
    const recovered = {
      ...makeEmptyOperationalLedger(iso("2026-07-01T00:00:00.000Z")),
      settings: {
        ...makeEmptyOperationalLedger().settings,
        values: { "review.mode": "manual" },
      },
    };
    fs.writeFileSync(path.join(tempDir, "operational-ledger.json"), "{not-json", {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.writeFileSync(
      path.join(tempDir, "operational-ledger.json.tmp-test"),
      `${JSON.stringify(recovered, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );

    const service = await Effect.runPromise(makeOperationalLedgerService(paths));
    const snapshot = await Effect.runPromise(service.getSnapshot());

    expect(snapshot.settings.values["review.mode"]).toBe("manual");
    expect(fs.existsSync(path.join(tempDir, "operational-ledger.json"))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, "operational-ledger.json.tmp-test"))).toBe(false);
    expect(
      fs.readdirSync(tempDir).some((name) => name.startsWith("operational-ledger.json.corrupt-")),
    ).toBe(true);
  });

  it("migrates v1 ledgers by defaulting the chair decision repository", () => {
    const paths = resolveOperationalLedgerPaths();
    const legacy = {
      ...makeEmptyOperationalLedger(iso("2026-07-01T00:00:00.000Z")),
      schemaVersion: "operational-ledger.v1",
    };
    const { chairDecisions: _chairDecisions, ...legacyWithoutChairDecisions } = legacy;
    fs.writeFileSync(
      path.join(tempDir, "operational-ledger.json"),
      `${JSON.stringify(legacyWithoutChairDecisions, null, 2)}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );

    const loaded = loadOperationalLedger(paths);

    expect(loaded.schemaVersion).toBe("operational-ledger.v2");
    expect(loaded.chairDecisions).toEqual({});
  });

  it("backs up corrupt ledgers but refuses newer ledger schemas", () => {
    const paths = resolveOperationalLedgerPaths();
    fs.writeFileSync(path.join(tempDir, "operational-ledger.json"), "{not-json", {
      encoding: "utf-8",
      mode: 0o600,
    });

    const recovered = loadOperationalLedger(paths);
    expect(recovered.schemaVersion).toBe("operational-ledger.v2");
    expect(
      fs.readdirSync(tempDir).some((name) => name.startsWith("operational-ledger.json.corrupt-")),
    ).toBe(true);

    fs.writeFileSync(
      path.join(tempDir, "operational-ledger.json"),
      `${JSON.stringify({ ...makeEmptyOperationalLedger(), schemaVersion: "operational-ledger.v999" })}\n`,
      { encoding: "utf-8", mode: 0o600 },
    );

    expect(() => loadOperationalLedger(paths)).toThrow(
      /Unsupported operational ledger schema version/,
    );
  });

  it("rejects arbitrary or secret-like settings and accepts only allowed operational settings", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    await expect(
      Effect.runPromise(service.setSetting("paperless.documentTitle", "Invoice 123")),
    ).rejects.toThrow(/Unsupported operational ledger setting key/);
    await expect(Effect.runPromise(service.setSetting("paperlessToken", "secret"))).rejects.toThrow(
      /Unsupported operational ledger setting key/,
    );
    await expect(
      Effect.runPromise(service.setSetting("customFields.enabledIds", "1,2,3" as never)),
    ).rejects.toThrow(/Invalid operational ledger setting value/);

    const settings = await Effect.runPromise(
      service.setSetting("customFields.enabledIds", [9, 2, 5]),
    );
    await Effect.runPromise(service.setSetting("review.mode", "manual"));
    await Effect.runPromise(service.setSetting("model.effort", "high"));
    await Effect.runPromise(service.setSetting("limits.maxRetries", 3));

    expect(settings.values["customFields.enabledIds"]).toEqual([2, 5, 9]);
    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(fromDisk.settings.values["review.mode"]).toBe("manual");
    expect(fromDisk.settings.values["model.effort"]).toBe("high");
    expect(fromDisk.settings.values["limits.maxRetries"]).toBe(3);
    expectNoForbiddenKeys(fromDisk);
  });

  it("records proposal decision fields while retaining typed values until compaction", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_decision",
        ownerId: "ana_run_decision",
        scope: "analysis",
        proposalHash: digest("decision-proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_decision"],
        coverage: 1,
        rationale: "Decision-ready proposal.",
        preconditions: [precondition("decision")],
      }),
    );

    const decided = await Effect.runPromise(
      service.recordProposalDecision("prop_decision", {
        expectedDecision: "undecided",
        decision: "approved",
        decidedAt: iso("2026-07-20T10:00:00.000Z"),
      }),
    );

    expect(decided).toMatchObject({
      proposalId: "prop_decision",
      decision: "approved",
      outcome: "approved",
      decidedAt: iso("2026-07-20T10:00:00.000Z"),
    });
    expect(decided.proposedValues).toEqual(analysisProposalValues());
    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(fromDisk.proposals.prop_decision?.proposedValues).toEqual(analysisProposalValues());
  });

  it("enforces proposal decision compare-and-set transitions", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_cas_decision",
        ownerId: "ana_run_decision",
        scope: "analysis",
        proposalHash: digest("cas-decision-proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_decision"],
        coverage: 1,
        rationale: "CAS proposal.",
        preconditions: [precondition("cas-decision")],
      }),
    );

    await expect(
      Effect.runPromise(
        service.recordProposalDecision("prop_cas_decision", {
          expectedDecision: "approved",
          decision: "applied",
        }),
      ),
    ).rejects.toThrow(/compare-and-set failed/);

    const approved = await Effect.runPromise(
      service.recordProposalDecision("prop_cas_decision", {
        expectedDecision: "undecided",
        decision: "approved",
      }),
    );
    expect(approved.decision).toBe("approved");

    await expect(
      Effect.runPromise(
        service.recordProposalDecision("prop_cas_decision", {
          expectedDecision: "approved",
          decision: "approved",
        }),
      ),
    ).rejects.toThrow(/Illegal proposal decision transition/);

    const applied = await Effect.runPromise(
      service.recordProposalDecision("prop_cas_decision", {
        expectedDecision: "approved",
        decision: "applied",
      }),
    );
    expect(applied.decision).toBe("applied");

    await expect(
      Effect.runPromise(
        service.recordProposalDecision("prop_cas_decision", {
          expectedDecision: "applied",
          decision: "applied",
        }),
      ),
    ).rejects.toThrow(/Illegal proposal decision transition/);

    await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_terminal_reapproval",
        ownerId: "ana_run_decision",
        scope: "analysis",
        proposalHash: digest("terminal-reapproval-proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_decision"],
        coverage: 1,
        rationale: "Terminal proposal.",
        preconditions: [precondition("terminal-reapproval")],
      }),
    );
    await Effect.runPromise(
      service.recordProposalDecision("prop_terminal_reapproval", {
        expectedDecision: "undecided",
        decision: "rejected",
      }),
    );
    await expect(
      Effect.runPromise(
        service.recordProposalDecision("prop_terminal_reapproval", {
          expectedDecision: "rejected",
          decision: "approved",
        }),
      ),
    ).rejects.toThrow(/Illegal proposal decision transition/);
  });

  it("serializes concurrent proposal decisions so only one undecided transition wins", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    await Effect.runPromise(
      service.recordProposal({
        proposalId: "prop_concurrent_decision",
        ownerId: "ana_run_decision",
        scope: "analysis",
        proposalHash: digest("concurrent-decision-proposal"),
        proposedValues: analysisProposalValues(),
        evidenceIds: ["evidence_decision"],
        coverage: 1,
        rationale: "Concurrent proposal.",
        preconditions: [precondition("concurrent-decision")],
      }),
    );

    const results = await Promise.allSettled([
      Effect.runPromise(
        service.recordProposalDecision("prop_concurrent_decision", {
          expectedDecision: "undecided",
          decision: "approved",
        }),
      ),
      Effect.runPromise(
        service.recordProposalDecision("prop_concurrent_decision", {
          expectedDecision: "undecided",
          decision: "rejected",
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const snapshot = await Effect.runPromise(service.getSnapshot());
    expect(["approved", "rejected"]).toContain(
      snapshot.proposals.prop_concurrent_decision?.decision,
    );
  });

  it("records council evidence with frozen roles, coverage, receipts, fingerprints, and timestamps", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    const council = await Effect.runPromise(
      service.recordCouncilVote({
        evidenceId: "evidence_vote_1",
        epochId: "cat_epoch_council",
        candidateId: "cand_vendor_merge",
        proposalId: "prop_catalog_values",
        reviewer: "taxonomy_curator",
        verdict: "support",
        evidenceDocumentIds: [101, 202, 303],
        inspectedDocuments: 3,
        totalDocuments: 12,
        xReceiptCount: 7,
        yReceiptCount: 2,
        xReceiptHash: digest("x-receipts"),
        yReceiptHash: digest("y-receipts"),
        proposalFingerprint: digest("proposal-fingerprint"),
        evidenceFingerprint: digest("evidence-fingerprint"),
        rationale: "Names describe the same vendor taxonomy concept.",
        dissent: null,
        createdAt: iso("2026-07-20T12:00:00.000Z"),
        decidedAt: iso("2026-07-20T12:01:00.000Z"),
      }),
    );

    expect(council.reviewer).toBe("taxonomy_curator");
    expect(council.verdict).toBe("support");
    expect(council.evidenceDocumentIds).toEqual([101, 202, 303]);
    expect(council.inspectedDocuments).toBe(3);
    expect(council.totalDocuments).toBe(12);
    expect(council.coverage).toBe(0.25);
    expect(council.xReceiptHash).toBe(digest("x-receipts"));
    expect(council.yReceiptHash).toBe(digest("y-receipts"));
    expect(council.proposalFingerprint).toBe(digest("proposal-fingerprint"));
    expect(council.evidenceFingerprint).toBe(digest("evidence-fingerprint"));
    expect(council.decidedAt).toBe(iso("2026-07-20T12:01:00.000Z"));

    await expect(
      Effect.runPromise(
        service.recordCouncilVote({
          ...council,
          reviewer: "invalid_reviewer",
        } as never),
      ),
    ).rejects.toThrow(/Invalid council reviewer role/);

    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(fromDisk.councilRecords.evidence_vote_1?.coverageHash).toBe(council.coverageHash);
    expectNoForbiddenKeys(fromDisk);
  });

  it("records compact chair decisions and rejects conflicting replays or candidate relinks", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    const first = await Effect.runPromise(service.recordChairDecision(chairDecision()));
    const replay = await Effect.runPromise(service.recordChairDecision(chairDecision()));

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      kind: "compact_chair_decision",
      epochId: "cat_epoch_chair",
      candidateIds: ["cand_vendor_merge"],
      proposalId: "prop_chair",
      verdict: "approve",
      action: "approve",
      sourceEntityId: 10,
      targetEntityId: 20,
      evidenceIds: ["evidence_vote_1", "evidence_vote_2"],
      confidence: 0.91,
      coverageCount: 7,
      inspectedDocumentCount: 9,
      totalDocumentCount: 30,
      decidedAt: iso("2026-07-20T13:01:00.000Z"),
    });

    await expect(
      Effect.runPromise(
        service.recordChairDecision(
          chairDecision({ proposalFingerprint: digest("different-chair-proposal") }),
        ),
      ),
    ).rejects.toThrow(/Conflicting chair decision/);
    await expect(
      Effect.runPromise(
        service.recordChairDecision(
          chairDecision({
            proposalId: "prop_other",
            evidenceFingerprint: digest("other-evidence"),
          }),
        ),
      ),
    ).rejects.toThrow(/Chair candidate already linked to proposal/);

    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(Object.keys(fromDisk.chairDecisions)).toEqual(["prop_chair"]);
    expect(fromDisk.chairDecisions.prop_chair?.proposalFingerprint).toBe(
      digest("chair-proposal-fingerprint"),
    );
    expect(
      fromDisk.ledgerEntries.filter((entry) => entry.kind === "compact_chair_decision"),
    ).toHaveLength(1);
    expectNoForbiddenKeys(fromDisk);
  });

  it("keeps chair decisions compact and enforces storage allowlist sentinels", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    await Effect.runPromise(
      service.appendLedgerEntry({
        kind: "compact_chair_decision",
        proposalId: "prop_allowed",
        timestamp: iso("2026-07-20T13:01:00.000Z"),
        hashes: [digest("proposal"), digest("evidence"), digest("coverage")],
        evidenceIds: ["evidence_vote_1"],
        coverage: 0.91,
        valueHash: digest("chair-entry"),
      }),
    );
    await expect(
      Effect.runPromise(
        service.appendLedgerEntry({
          kind: "raw_model_output",
          timestamp: iso("2026-07-20T13:01:00.000Z"),
        } as never),
      ),
    ).rejects.toThrow(/Storage artifact kind is not allowed|Forbidden storage artifact kind/);
    await expect(
      Effect.runPromise(
        service.recordChairDecision(
          chairDecision({
            sourceEntityName: "Acme Vendor",
            dossier: "raw dossier",
          }) as never,
        ),
      ),
    ).rejects.toThrow(/Forbidden storage field: sourceEntityName|Forbidden storage field: dossier/);

    await Effect.runPromise(service.recordChairDecision(chairDecision()));
    const serialized = fs.readFileSync(path.join(tempDir, "operational-ledger.json"), "utf-8");
    expect(serialized).not.toContain("Acme Vendor");
    expect(serialized).not.toContain("raw dossier");
    expect(serialized).not.toContain("OCR");
    expect(serialized).not.toContain("prompt");
    expectNoForbiddenKeys(JSON.parse(serialized) as OperationalLedgerData);
  });

  it("compacts records older than the 30-day retention window without deleting proposal audits", async () => {
    const paths = resolveOperationalLedgerPaths();
    const oldDate = iso("2026-05-01T00:00:00.000Z");
    const recentDate = iso("2026-07-15T00:00:00.000Z");
    const oldRun = {
      kind: "ids_hashes_state" as const,
      runId: "ana_run_old",
      documentId: 1,
      forceOcr: false,
      state: "succeeded" as const,
      sourcePdfHash: null,
      documentStateHash: digest("old-run"),
      proposalIds: ["prop_old"],
      retryCount: 0,
      failure: null,
      createdAt: oldDate,
      updatedAt: oldDate,
      completedAt: oldDate,
    };
    const recentRun = {
      ...oldRun,
      runId: "ana_run_recent",
      documentId: 2,
      completedAt: recentDate,
    };
    const oldEntry: StorageLedgerEntry = {
      kind: "usage_record",
      runId: "ana_run_old",
      timestamp: oldDate,
      valueHash: digest("old-usage-entry"),
    };
    const recentEntry: StorageLedgerEntry = {
      kind: "usage_record",
      runId: "ana_run_recent",
      timestamp: recentDate,
      valueHash: digest("recent-usage-entry"),
    };
    persistOperationalLedger(
      {
        ...makeEmptyOperationalLedger(recentDate),
        ledgerEntries: [oldEntry, recentEntry],
        analysisRuns: {
          [oldRun.runId]: oldRun,
          [recentRun.runId]: recentRun,
        },
        proposals: {
          prop_old_decided: proposalRecord({
            proposalId: "prop_old_decided",
            createdAt: oldDate,
            decision: "approved",
            outcome: "approved",
            decidedAt: oldDate,
          }),
          prop_old_undecided: proposalRecord({
            proposalId: "prop_old_undecided",
            createdAt: oldDate,
          }),
        },
        providerUsage: [
          {
            kind: "usage_record",
            usageId: "usage_old",
            provider: "ollama",
            model: "llama3",
            operation: "analysis",
            runId: "ana_run_old",
            promptTokens: 1,
            completionTokens: 1,
            totalTokens: 2,
            costMicros: null,
            latencyMs: null,
            recordedAt: oldDate,
          },
          {
            kind: "usage_record",
            usageId: "usage_recent",
            provider: "ollama",
            model: "llama3",
            operation: "analysis",
            runId: "ana_run_recent",
            promptTokens: 2,
            completionTokens: 3,
            totalTokens: 5,
            costMicros: null,
            latencyMs: null,
            recordedAt: recentDate,
          },
        ],
      },
      paths,
    );

    const service = await Effect.runPromise(makeOperationalLedgerService(paths));
    const compaction = await Effect.runPromise(
      service.compact(new Date("2026-07-22T00:00:00.000Z")),
    );
    const snapshot = await Effect.runPromise(service.getSnapshot());

    expect(compaction.removedLedgerEntries).toBe(1);
    expect(compaction.removedProviderUsage).toBe(1);
    expect(compaction.removedRuns).toBe(1);
    expect(compaction.removedProposals).toBe(0);
    expect(compaction.compactedProposals).toBe(1);
    expect(snapshot.analysisRuns.ana_run_old).toBeUndefined();
    expect(snapshot.analysisRuns.ana_run_recent).toBeDefined();
    expect(snapshot.proposals.prop_old_decided).toMatchObject({
      proposalId: "prop_old_decided",
      proposalHash: digest("prop_old_decided-proposal"),
      valueHash: digest("prop_old_decided-value"),
      outcome: "approved",
      decidedAt: oldDate,
      proposedValues: null,
    });
    expect(snapshot.proposals.prop_old_decided?.compactedAt).toBe(iso("2026-07-22T00:00:00.000Z"));
    expect(snapshot.proposals.prop_old_undecided?.proposedValues).toEqual(analysisProposalValues());
    expect(snapshot.providerUsage.map((record) => record.usageId)).toEqual(["usage_recent"]);
    expect(
      snapshot.ledgerEntries.every(
        (entry) => Date.parse(entry.timestamp) >= Date.parse(compaction.cutoff),
      ),
    ).toBe(true);
    expect(snapshot.compactions).toHaveLength(1);
  });

  it("serializes concurrent writes through one writer", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());

    await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        Effect.runPromise(
          service.recordProviderUsage({
            usageId: `usage_${index}`,
            provider: "ollama",
            model: "llama3",
            operation: "analysis",
            promptTokens: index,
            completionTokens: 1,
          }),
        ),
      ),
    );

    const fromMemory = await Effect.runPromise(service.getSnapshot());
    const fromDisk = loadOperationalLedger(resolveOperationalLedgerPaths());
    expect(fromMemory.providerUsage).toHaveLength(25);
    expect(fromDisk.providerUsage).toHaveLength(25);
    expect(new Set(fromDisk.providerUsage.map((record) => record.usageId)).size).toBe(25);
  });

  it("records compact apply journals without Paperless bodies", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    const journal: ApplyJournal = {
      journalId: "journal_test",
      proposalId: "prop_apply",
      epochId: "cat_epoch_apply",
      idempotencyKey: "apply-key",
      status: "accepted",
      preconditions: [precondition("apply")],
      steps: [
        {
          stepId: "step-1",
          operation: "rename",
          paperlessTaskId: null,
          beforeHash: digest("before"),
          afterHash: null,
          status: "pending",
          recordedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await Effect.runPromise(service.recordApplyJournal(journal));
    const serialized = fs.readFileSync(path.join(tempDir, "operational-ledger.json"), "utf-8");
    const parsed = JSON.parse(serialized) as OperationalLedgerData;

    expect(parsed.applyJournals.journal_test?.steps[0]?.beforeHash).toBe(digest("before"));
    expectNoForbiddenKeys(parsed);
  });

  it("compacts old apply journals to minimum audit facts instead of deleting them", async () => {
    const service = await Effect.runPromise(makeOperationalLedgerService());
    const oldDate = iso("2026-05-01T00:00:00.000Z");
    const journal: ApplyJournal = {
      journalId: "journal_old",
      proposalId: "prop_apply",
      epochId: "cat_epoch_apply",
      idempotencyKey: "apply-key-old",
      status: "succeeded",
      preconditions: [precondition("apply-old")],
      steps: [
        {
          stepId: "step-1",
          operation: "rename",
          paperlessTaskId: "task-1",
          beforeHash: digest("before-old"),
          afterHash: digest("after-old"),
          status: "succeeded",
          recordedAt: oldDate,
        },
      ],
      createdAt: oldDate,
      updatedAt: oldDate,
    };
    await Effect.runPromise(service.recordApplyJournal(journal));
    const compaction = await Effect.runPromise(
      service.compact(new Date("2026-07-22T00:00:00.000Z")),
    );
    const snapshot = await Effect.runPromise(service.getSnapshot());

    expect(compaction.removedApplyJournals).toBe(0);
    expect(compaction.compactedApplyJournals).toBe(1);
    expect(snapshot.applyJournals.journal_old).toMatchObject({
      journalId: "journal_old",
      proposalId: "prop_apply",
      epochId: "cat_epoch_apply",
      status: "succeeded",
      preconditionHashes: [digest("apply-old")],
      stepCount: 1,
      steps: [],
      compactedAt: iso("2026-07-22T00:00:00.000Z"),
    });
  });
});
