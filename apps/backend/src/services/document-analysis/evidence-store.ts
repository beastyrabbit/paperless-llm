import type { AnalysisAvailableProposal, Sha256Digest } from "@repo/api-contracts";

/**
 * Provider evidence is intentionally process-local. The operational ledger keeps
 * only the compact proposal values needed for a decision and never persists OCR
 * previews, provider output, or evidence rationale.
 */
interface AnalysisEvidenceProcessGlobal {
  __paperlessAnalysisEvidenceByProposalId?: Map<string, AnalysisAvailableProposal>;
}

const processGlobal = globalThis as typeof globalThis & AnalysisEvidenceProcessGlobal;
if (!processGlobal.__paperlessAnalysisEvidenceByProposalId) {
  processGlobal.__paperlessAnalysisEvidenceByProposalId = new Map<
    string,
    AnalysisAvailableProposal
  >();
}
const evidenceByProposalId = processGlobal.__paperlessAnalysisEvidenceByProposalId;
const MAX_TRANSIENT_PROPOSALS = 256;

export const rememberAnalysisProposalEvidence = (proposal: AnalysisAvailableProposal): void => {
  evidenceByProposalId.delete(proposal.proposalId);
  evidenceByProposalId.set(proposal.proposalId, proposal);

  while (evidenceByProposalId.size > MAX_TRANSIENT_PROPOSALS) {
    const oldestProposalId = evidenceByProposalId.keys().next().value;
    if (oldestProposalId === undefined) break;
    evidenceByProposalId.delete(oldestProposalId);
  }
};

export const getAnalysisProposalEvidence = (
  proposalId: string,
  expected: {
    readonly runId: string;
    readonly documentId: number;
    readonly proposalHash: Sha256Digest;
  },
): AnalysisAvailableProposal | null => {
  const proposal = evidenceByProposalId.get(proposalId);
  if (
    !proposal ||
    proposal.runId !== expected.runId ||
    proposal.documentId !== expected.documentId ||
    proposal.proposalHash !== expected.proposalHash
  ) {
    return null;
  }
  return proposal;
};

export const clearAnalysisProposalEvidence = (): void => {
  evidenceByProposalId.clear();
};
