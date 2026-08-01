import { Schema } from "effect";
import {
  CorrespondentIdSchema,
  CustomFieldIdSchema,
  DocumentIdSchema,
  DocumentTypeIdSchema,
  TagIdSchema,
} from "./ids.js";

export const Sha256DigestSchema = Schema.String.pipe(
  Schema.pattern(/^[a-f0-9]{64}$/),
  Schema.brand("Sha256Digest"),
).annotations({ identifier: "Sha256Digest" });
export type Sha256Digest = Schema.Schema.Type<typeof Sha256DigestSchema>;

export const IsoDateTimeSchema = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/),
).annotations({ identifier: "IsoDateTime" });

export const CatalogEpochIdSchema = Schema.String.pipe(
  Schema.pattern(/^cat_epoch_[A-Za-z0-9_-]+$/),
).annotations({ identifier: "CatalogEpochId" });
export type CatalogEpochId = Schema.Schema.Type<typeof CatalogEpochIdSchema>;

export const AnalysisRunIdSchema = Schema.String.pipe(Schema.pattern(/^ana_run_[A-Za-z0-9_-]+$/)).annotations({
  identifier: "AnalysisRunId",
});
export type AnalysisRunId = Schema.Schema.Type<typeof AnalysisRunIdSchema>;

export const ProposalIdSchema = Schema.String.pipe(Schema.pattern(/^prop_[A-Za-z0-9_-]+$/)).annotations({
  identifier: "ProposalId",
});
export type ProposalId = Schema.Schema.Type<typeof ProposalIdSchema>;

export const CandidateIdSchema = Schema.String.pipe(Schema.pattern(/^cand_[A-Za-z0-9_-]+$/)).annotations({
  identifier: "CandidateId",
});
export type CandidateId = Schema.Schema.Type<typeof CandidateIdSchema>;

export const CouncilEvidenceIdSchema = Schema.String.pipe(
  Schema.pattern(/^evidence_[A-Za-z0-9_-]+$/),
).annotations({ identifier: "CouncilEvidenceId" });
export type CouncilEvidenceId = Schema.Schema.Type<typeof CouncilEvidenceIdSchema>;

export const PaperlessCustomFieldStateSchema = Schema.Struct({
  field: CustomFieldIdSchema,
  valueHash: Sha256DigestSchema,
}).annotations({ identifier: "PaperlessCustomFieldState" });

export const PaperlessDocumentStateForHashSchema = Schema.Struct({
  documentId: DocumentIdSchema,
  modified: IsoDateTimeSchema,
  added: IsoDateTimeSchema.pipe(Schema.optional),
  titleHash: Sha256DigestSchema,
  correspondentId: Schema.NullOr(CorrespondentIdSchema),
  documentTypeId: Schema.NullOr(DocumentTypeIdSchema),
  tagIds: Schema.Array(TagIdSchema),
  customFields: Schema.Array(PaperlessCustomFieldStateSchema),
  archiveSerialNumber: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
  originalFileNameHash: Schema.NullOr(Sha256DigestSchema),
}).annotations({ identifier: "PaperlessDocumentStateForHash" });
export type PaperlessDocumentStateForHash = Schema.Schema.Type<
  typeof PaperlessDocumentStateForHashSchema
>;

export const HashPreconditionSchema = Schema.Struct({
  kind: Schema.Literal(
    "paperless_document_state",
    "source_pdf",
    "catalog_epoch",
    "council_evidence",
    "analysis_proposal",
  ),
  digest: Sha256DigestSchema,
}).annotations({ identifier: "HashPrecondition" });
export type HashPrecondition = Schema.Schema.Type<typeof HashPreconditionSchema>;

const textEncoder = new TextEncoder();

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const rightRotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));

const sha256Constants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
  0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
  0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
  0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
  0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

export const sha256Hex = (input: string | Uint8Array): Sha256Digest => {
  const data = typeof input === "string" ? textEncoder.encode(input) : input;
  const bitLength = data.length * 8;
  const paddedLength = Math.ceil((data.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let chunk = 0; chunk < paddedLength; chunk += 64) {
    for (let i = 0; i < 16; i += 1) {
      words[i] = view.getUint32(chunk + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rightRotate(words[i - 15] ?? 0, 7) ^ rightRotate(words[i - 15] ?? 0, 18) ^ ((words[i - 15] ?? 0) >>> 3);
      const s1 = rightRotate(words[i - 2] ?? 0, 17) ^ rightRotate(words[i - 2] ?? 0, 19) ^ ((words[i - 2] ?? 0) >>> 10);
      words[i] = (((words[i - 16] ?? 0) + s0 + (words[i - 7] ?? 0) + s1) >>> 0);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + (sha256Constants[i] ?? 0) + (words[i] ?? 0)) >>> 0;
      const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  const output = new Uint8Array(32);
  const outputView = new DataView(output.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((word, index) => {
    outputView.setUint32(index * 4, word, false);
  });
  return bytesToHex(output) as Sha256Digest;
};

export const canonicalJson = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const encode = (input: unknown): string => {
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input);
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("Cannot canonicalize non-finite numbers");
      return JSON.stringify(input);
    }
    if (Array.isArray(input)) return `[${input.map((item) => encode(item)).join(",")}]`;
    if (typeof input === "object") {
      if (seen.has(input)) throw new TypeError("Cannot canonicalize cyclic objects");
      seen.add(input);
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encode(item)}`).join(",")}}`;
    }
    throw new TypeError(`Cannot canonicalize ${typeof input}`);
  };
  return encode(value);
};

export const canonicalSha256 = (value: unknown): Sha256Digest => sha256Hex(canonicalJson(value));

export const paperlessDocumentStateHash = (state: PaperlessDocumentStateForHash): Sha256Digest =>
  canonicalSha256({
    kind: "paperless_document_state",
    state: {
      ...state,
      tagIds: [...state.tagIds].sort((left, right) => left - right),
      customFields: [...state.customFields].sort((left, right) => left.field - right.field),
    },
  });

export const sourcePdfHash = (bytes: Uint8Array): Sha256Digest => sha256Hex(bytes);

export const catalogEpochHash = (epoch: unknown): Sha256Digest =>
  canonicalSha256({ kind: "catalog_epoch", epoch });

export const councilEvidencePreconditionHash = (evidence: unknown): Sha256Digest =>
  canonicalSha256({ kind: "council_evidence_precondition", evidence });

export const proposalPreconditionHash = (proposal: unknown): Sha256Digest =>
  canonicalSha256({ kind: "analysis_proposal_precondition", proposal });
