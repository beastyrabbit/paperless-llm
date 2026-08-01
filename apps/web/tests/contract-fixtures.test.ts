/**
 * Frozen-contract conformance for the fixture files. These assertions mirror
 * the `@repo/api-contracts` schema constraints so a fixture that drifts from
 * the frozen contract shape fails here (in addition to the compile-time typing).
 */
import { describe, expect, it } from "vitest";
import {
  analysisProposal,
  analysisRuns,
  documentBaseline,
  failureQueue,
  reviewQueue,
} from "../components/workbench/fixtures";
import {
  catalogCandidates,
  catalogEpochs,
  catalogProposals,
  councilEvidence,
} from "../components/catalog-optimization/fixtures";

const SHA256 = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const isConfidence = (n: number) => n >= 0 && n <= 1;

describe("analysis fixtures conform to contract shapes", () => {
  it("proposal hashes and dates match contract patterns", () => {
    expect(analysisProposal.proposalHash).toMatch(SHA256);
    expect(analysisProposal.ocrPreview.previewHash).toMatch(SHA256);
    expect(analysisProposal.createdAt).toMatch(ISO);
    expect(analysisProposal.preconditions.length).toBeGreaterThanOrEqual(1);
  });

  it("proposal confidence values are bounded and evidence is non-empty", () => {
    expect(isConfidence(analysisProposal.confidence)).toBe(true);
    expect(analysisProposal.fieldEvidence.length).toBeGreaterThanOrEqual(1);
    for (const evidence of analysisProposal.fieldEvidence) {
      expect(isConfidence(evidence.confidence)).toBe(true);
      expect(evidence.references.length).toBeGreaterThanOrEqual(1);
      expect(evidence.references.length).toBeLessThanOrEqual(12);
      for (const reference of evidence.references) {
        expect(reference.pageNumber).toBeGreaterThan(0);
        expect(reference.quoteHash).toMatch(SHA256);
      }
    }
  });

  it("new tag candidates use the reserved key + hex color format", () => {
    for (const candidate of analysisProposal.proposed.newTagCandidates) {
      expect(candidate.candidateKey).toMatch(/^new_tag_[A-Za-z0-9_-]+$/);
      if (candidate.color != null) expect(candidate.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(candidate.evidence.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("runs carry valid ids, hashes and non-negative retry counts", () => {
    for (const run of analysisRuns) {
      expect(run.runId).toMatch(/^ana_run_[A-Za-z0-9_-]+$/);
      expect(run.documentStateHash).toMatch(SHA256);
      if (run.sourcePdfHash != null) expect(run.sourcePdfHash).toMatch(SHA256);
      expect(run.retryCount).toBeGreaterThanOrEqual(0);
      expect(run.createdAt).toMatch(ISO);
      if (run.failure != null) {
        expect(run.failure.failedAt).toMatch(ISO);
        expect(typeof run.failure.retryable).toBe("boolean");
      }
    }
  });

  it("review + failure queue items are well formed", () => {
    for (const item of reviewQueue.items) {
      expect(item.reasons.length).toBeGreaterThanOrEqual(1);
      expect(item.proposalHash).toMatch(SHA256);
    }
    for (const item of failureQueue.items) {
      expect(item.retryCount).toBeGreaterThanOrEqual(0);
      expect(item.updatedAt).toMatch(ISO);
    }
  });

  it("baseline references the same document as the proposal", () => {
    expect(documentBaseline.documentId).toBe(analysisProposal.documentId);
  });
});

describe("catalog fixtures conform to contract shapes", () => {
  it("epochs carry bounded counts and valid ids", () => {
    for (const epoch of catalogEpochs) {
      expect(epoch.epochId).toMatch(/^cat_epoch_[A-Za-z0-9_-]+$/);
      expect(epoch.paperlessCatalogHash).toMatch(SHA256);
      expect(epoch.candidateCount).toBeGreaterThanOrEqual(0);
      expect(epoch.scope.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("candidates carry receipts and at least one precondition", () => {
    for (const candidate of catalogCandidates) {
      expect(candidate.candidateId).toMatch(/^cand_[A-Za-z0-9_-]+$/);
      expect(candidate.x.nameHash).toMatch(SHA256);
      expect(candidate.preconditions.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("council evidence is bounded and hashes are valid", () => {
    for (const evidence of councilEvidence) {
      expect(evidence.evidenceId).toMatch(/^evidence_[A-Za-z0-9_-]+$/);
      expect(isConfidence(evidence.coverage)).toBe(true);
      expect(evidence.evidenceDocumentIds.length).toBeGreaterThanOrEqual(1);
      expect(evidence.evidenceDocumentIds.length).toBeLessThanOrEqual(250);
      expect(evidence.counterexamples.length).toBeLessThanOrEqual(25);
      expect(["support", "oppose", "abstain"]).toContain(evidence.verdict);
      for (const counterexample of evidence.counterexamples) {
        expect(counterexample.evidenceHash).toMatch(SHA256);
      }
    }
  });

  it("proposals conform to catalog_proposal_projection.v2", () => {
    for (const proposal of catalogProposals) {
      expect(proposal.projectionVersion).toBe("catalog_proposal_projection.v2");
      expect(proposal.proposalId).toMatch(/^prop_[A-Za-z0-9_-]+$/);
      expect(proposal.candidateIds.length).toBeGreaterThanOrEqual(1);
      expect(proposal.proposalHash).toMatch(SHA256);
      expect(proposal.expectedProposalFingerprint).toMatch(SHA256);
      expect(proposal.expectedEvidenceFingerprint).toMatch(SHA256);

      // Freshness projection is always present with >=1 expected precondition.
      expect(["fresh", "stale", "current_missing"]).toContain(proposal.freshness.status);
      expect(proposal.freshness.expectedPreconditions.length).toBeGreaterThanOrEqual(1);

      // Decision + apply projections carry legal statuses.
      expect([
        "undecided",
        "approved",
        "rejected",
        "deferred",
        "applied",
        "failed",
        "conflict",
        "canceled",
      ]).toContain(proposal.decision.status);
      expect([
        "not_started",
        "accepted",
        "applying",
        "succeeded",
        "failed",
        "conflict",
        "canceled",
      ]).toContain(proposal.apply.status);

      // The chair decision lives inside the available-evidence union.
      if (proposal.evidence.availability === "available") {
        expect(proposal.evidence.evidenceDocumentIds.length).toBeGreaterThanOrEqual(1);
        const { chair } = proposal.evidence;
        expect(chair.availability).toBe("decision_recorded");
        expect(chair.evidenceIds).toHaveLength(3);
        expect(["approve", "reject", "needs_human"]).toContain(chair.verdict);
        expect(["approve", "reject", "defer", "request_review"]).toContain(chair.action);
        expect(isConfidence(chair.confidence)).toBe(true);
        expect(chair.evidenceFingerprint).toMatch(SHA256);
      } else {
        expect(proposal.evidence.availability).toBe("evidence_expired");
        expect(proposal.evidence.requiresRefresh).toBe(true);
      }
    }
  });
});
