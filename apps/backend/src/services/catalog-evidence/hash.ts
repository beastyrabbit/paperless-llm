import { canonicalSha256, type Sha256Digest } from "@repo/api-contracts";

export const shortHash = (value: unknown, length = 16): string =>
  canonicalSha256(value).slice(0, length);

export const digest = (kind: string, value: unknown): Sha256Digest =>
  canonicalSha256({ kind, value });

export const idsHash = (ids: readonly number[]): Sha256Digest =>
  digest(
    "catalog_evidence_document_ids",
    [...ids].sort((left, right) => left - right),
  );
