import { describe, expect, it } from "vitest";
import type { CatalogProposalContract } from "@repo/api-contracts";
import {
  applyGate,
  applyStatusTone,
  chairDecision,
  coveragePercent,
  decisionTone,
  epochProgress,
  epochStateTone,
  evidenceForProposal,
  freshnessTone,
  inspectedDocumentIds,
  isDestructiveOperation,
  isEpochInProgress,
  isFresh,
  needsHumanDecision,
  operationTone,
  summarizeCouncil,
  summarizeCoverage,
  verdictTone,
} from "../components/catalog-optimization/council-model";
import { catalogProposals, councilEvidence } from "../components/catalog-optimization/fixtures";

const mergeProposal = catalogProposals.find((p) => p.intendedAction === "merge");
const deleteProposal = catalogProposals.find((p) => p.intendedAction === "delete");
const renameProposal = catalogProposals.find((p) => p.intendedAction === "rename");

if (!mergeProposal || !deleteProposal || !renameProposal) {
  throw new Error("fixtures missing merge/delete/rename proposals");
}

describe("summarizeCouncil (three reviewers)", () => {
  it("counts a split 2-1 vote and is not unanimous", () => {
    const summary = summarizeCouncil(evidenceForProposal(mergeProposal, councilEvidence));
    expect(summary.supportCount).toBe(2);
    expect(summary.opposeCount).toBe(1);
    expect(summary.abstainCount).toBe(0);
    expect(summary.unanimous).toBe(false);
    expect(summary.majority).toBe("support");
  });

  it("detects a unanimous vote", () => {
    const summary = summarizeCouncil(evidenceForProposal(deleteProposal, councilEvidence));
    expect(summary.supportCount).toBe(3);
    expect(summary.unanimous).toBe(true);
  });

  it("collects dissents and counterexamples for the merge", () => {
    const summary = summarizeCouncil(evidenceForProposal(mergeProposal, councilEvidence));
    expect(summary.dissents.length).toBeGreaterThanOrEqual(2);
    expect(summary.counterexampleCount).toBe(2);
  });

  it("selects only evidence for the proposal's candidates", () => {
    expect(evidenceForProposal(mergeProposal, councilEvidence)).toHaveLength(3);
    expect(evidenceForProposal(deleteProposal, councilEvidence)).toHaveLength(3);
    expect(evidenceForProposal(renameProposal, councilEvidence)).toHaveLength(3);
  });
});

describe("verdict + operation tones", () => {
  it("tones verdicts", () => {
    expect(verdictTone("support")).toBe("success");
    expect(verdictTone("oppose")).toBe("danger");
    expect(verdictTone("abstain")).toBe("neutral");
  });

  it("marks delete/merge as destructive with distinct tones", () => {
    expect(isDestructiveOperation("delete")).toBe(true);
    expect(isDestructiveOperation("merge")).toBe(true);
    expect(isDestructiveOperation("rename")).toBe(false);
    expect(isDestructiveOperation("describe")).toBe(false);
    expect(operationTone("delete")).toBe("danger");
    expect(operationTone("merge")).toBe("warn");
  });
});

describe("coverage", () => {
  it("rounds a single reviewer's coverage", () => {
    expect(coveragePercent({ coverage: 0.187 })).toBe(19);
  });

  it("reports the weakest coverage across reviewers", () => {
    const summary = summarizeCoverage(evidenceForProposal(mergeProposal, councilEvidence));
    expect(summary.weakestPercent).toBe(14);
    expect(summary.total).toBe(214);
    expect(summary.inspected).toBeGreaterThan(0);
  });

  it("handles empty evidence without dividing by zero", () => {
    const summary = summarizeCoverage([]);
    expect(summary.percent).toBe(0);
    expect(summary.weakestPercent).toBe(0);
  });
});

describe("chair decision", () => {
  it("routes the split merge to a human", () => {
    expect(chairDecision(mergeProposal)?.verdict).toBe("needs_human");
    expect(needsHumanDecision(mergeProposal)).toBe(true);
  });

  it("does not route the unanimous delete to a human", () => {
    expect(chairDecision(deleteProposal)?.verdict).toBe("approve");
    expect(needsHumanDecision(deleteProposal)).toBe(false);
  });

  it("carries chair evidence ids for every available proposal", () => {
    for (const proposal of [mergeProposal, deleteProposal, renameProposal]) {
      expect(chairDecision(proposal)?.evidenceIds).toHaveLength(3);
    }
  });
});

describe("freshness + inspected documents", () => {
  it("marks the fresh delete fresh and the stale rename stale", () => {
    expect(isFresh(deleteProposal)).toBe(true);
    expect(isFresh(renameProposal)).toBe(false);
    expect(freshnessTone(deleteProposal.freshness)).toBe("success");
    expect(freshnessTone(renameProposal.freshness)).toBe("warn");
  });

  it("exposes the inspected Paperless document ids", () => {
    expect(inspectedDocumentIds(mergeProposal).length).toBeGreaterThan(0);
  });
});

describe("applyGate (unsafe-dependency blocking)", () => {
  it("blocks the deferred merge until a human decides", () => {
    const gate = applyGate(mergeProposal);
    expect(gate.canApply).toBe(false);
    expect(gate.reason).toMatch(/approve/i);
  });

  it("blocks the stale rename with a drift/recompute reason (409 risk)", () => {
    const gate = applyGate(renameProposal);
    expect(gate.canApply).toBe(false);
    expect(gate.reason).toMatch(/recompute|changed/i);
  });

  it("allows an approved, fresh delete to be applied", () => {
    const gate = applyGate(deleteProposal);
    expect(gate.canApply).toBe(true);
    expect(gate.reason).toBeNull();
  });

  it("blocks a proposal whose council evidence expired", () => {
    const expired: CatalogProposalContract = {
      ...deleteProposal,
      evidence: {
        availability: "evidence_expired",
        needsReview: true,
        requiresRefresh: true,
        reason: "retention_compacted",
      },
    };
    const gate = applyGate(expired);
    expect(gate.canApply).toBe(false);
    expect(gate.reason).toMatch(/expired/i);
    expect(chairDecision(expired)).toBeNull();
    expect(inspectedDocumentIds(expired)).toHaveLength(0);
  });

  it("blocks a proposal with an in-flight apply", () => {
    const applying: CatalogProposalContract = {
      ...deleteProposal,
      apply: { status: "applying", latestJournalId: "journal_x1", stepCount: 1, updatedAt: null },
    };
    expect(applyGate(applying).canApply).toBe(false);
  });
});

describe("decision + apply tones", () => {
  it("tones the recorded decision and apply status", () => {
    expect(decisionTone(deleteProposal.decision)).toBe("success");
    expect(decisionTone(mergeProposal.decision)).toBe("neutral");
    expect(applyStatusTone(mergeProposal.apply)).toBe("neutral");
  });
});

describe("epoch progress", () => {
  it("tones terminal and active states", () => {
    expect(epochStateTone("applied")).toBe("success");
    expect(epochStateTone("failed")).toBe("danger");
    expect(epochStateTone("collecting")).toBe("info");
    expect(epochStateTone("proposed")).toBe("warn");
  });

  it("projects an in-progress epoch onto the lifecycle with a single current step", () => {
    expect(isEpochInProgress("council_review")).toBe(true);
    expect(isEpochInProgress("applied")).toBe(false);
    const cells = epochProgress("council_review");
    expect(cells.filter((c) => c.status === "current")).toHaveLength(1);
    expect(cells.filter((c) => c.status === "done").length).toBeGreaterThan(0);
    expect(cells.filter((c) => c.status === "pending").length).toBeGreaterThan(0);
  });

  it("marks every step done for an applied epoch", () => {
    const cells = epochProgress("applied");
    expect(cells.every((c) => c.status === "done")).toBe(true);
  });

  it("marks the interrupted step failed for a failed epoch", () => {
    const cells = epochProgress("failed");
    expect(cells.some((c) => c.status === "failed")).toBe(true);
  });
});
