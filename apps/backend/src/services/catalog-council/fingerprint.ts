import { type CatalogEntityKind, canonicalSha256, type Sha256Digest } from "@repo/api-contracts";
import type { CatalogProposalSafetyInputs } from "../operational-ledger/types.js";

export interface CatalogCouncilEntityFingerprintInput {
  readonly label: "source" | "target";
  readonly kind: CatalogEntityKind;
  readonly entityId: number;
  readonly currentNameHash: Sha256Digest;
  readonly receiptHash: Sha256Digest;
  readonly assignmentHash: Sha256Digest;
  readonly receiptCount: number;
  readonly documentIdsHash: Sha256Digest;
  readonly safetyInputs: CatalogProposalSafetyInputs;
}

export const catalogCouncilEntityFingerprint = ({
  label,
  kind,
  entityId,
  currentNameHash,
  receiptHash,
  assignmentHash,
  receiptCount,
  documentIdsHash,
  safetyInputs,
}: CatalogCouncilEntityFingerprintInput): Sha256Digest =>
  canonicalSha256({
    kind: `catalog_council_${label}_entity`,
    value: {
      kind,
      entityId,
      currentNameHash,
      receiptHash,
      assignmentHash,
      receiptCount,
      documentIdsHash,
      safetyInputs,
    },
  });
