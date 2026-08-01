import {
  AnalysisProposalProjectionSchema,
  AnalysisProposalSchema,
  apiContractJsonSchemas,
  assertAllowedStorageArtifactKind,
  CatalogEpochStartBodySchema,
  CatalogProposalSchema,
  CompactChairDecisionLedgerContractSchema,
  canonicalSha256,
  codexStructuredOutputJsonSchemas,
  compareAndSetAnalysisRunState,
  compareAndSetCatalogState,
  generateOpenApiDocument,
  isAllowedStorageArtifactKind,
  PaperlessBulkOperationRequestSchema,
  paperlessDocumentStateHash,
  sha256Hex,
  sourcePdfHash,
  strictDecodeAnalysisProposal,
  strictDecodeAnalysisProposalProjection,
  strictDecodeAnalysisRunStartBody,
  strictDecodeCatalogProposal,
  strictDecodeCouncilEvidence,
  strictDecodePaperlessBulkOperationRequest,
  strictDecodeStorageLedgerEntry,
} from "@repo/api-contracts";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const digest = "0".repeat(64) as ReturnType<typeof sha256Hex>;
const iso = "2026-07-22T10:00:00.000Z";
const ref = { pageNumber: 1, blockId: "p1-b1", quoteHash: digest };
const precondition = { kind: "paperless_document_state", digest } as const;
const freshness = {
  status: "fresh",
  stale: false,
  currentMissing: false,
  expectedPreconditions: [precondition],
  currentPreconditions: [precondition],
} as const;

const validAnalysisProposal = {
  proposalId: "prop_analysis_bundle",
  runId: "ana_run_document_42",
  documentId: 42,
  proposalHash: digest,
  proposed: {
    title: "Invoice 2026-07",
    correspondentId: 7,
    documentTypeId: null,
    ordinaryTagIds: [1, 2, 3],
    newTagCandidates: [
      {
        candidateKey: "new_tag_vat",
        name: "VAT",
        color: "#336699",
        rationale: "VAT appears as a recurring receipt category.",
        evidence: [ref],
        confidence: 0.78,
      },
    ],
    customFields: [
      {
        customFieldId: 10,
        operation: "set",
        value: "INV-2026-07",
        valueHash: digest,
        evidence: {
          field: "custom_field",
          customFieldId: 10,
          references: [ref],
          rationale: "Invoice number appears near the header.",
          confidence: 0.91,
        },
      },
      {
        customFieldId: 11,
        operation: "remove",
        value: null,
        valueHash: null,
        evidence: {
          field: "custom_field",
          customFieldId: 11,
          references: [ref],
          rationale: "No due date appears in inspected blocks.",
          confidence: 0.67,
        },
      },
    ],
  },
  ocrPreview: {
    descriptor: "OCR preview covers 2 pages and 14 blocks.",
    previewHash: digest,
    pageCount: 2,
    blockCount: 14,
  },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [ref],
      rationale: "The invoice title appears in the first block.",
      confidence: 0.89,
    },
  ],
  review: {
    required: true,
    reasons: ["more_than_5_tags", "stale_precondition", "unusual_metadata"],
    rationale: "Human review is required because several review triggers fired.",
  },
  confidence: 0.84,
  rationale: "The bundle is consistent across the inspected document evidence.",
  preconditions: [precondition],
  createdAt: iso,
};

const availableAnalysisProjection = {
  ...validAnalysisProposal,
  evidenceAvailability: "available",
  freshness,
};

const expiredAnalysisProposal = {
  proposalId: "prop_analysis_bundle",
  runId: "ana_run_document_42",
  documentId: 42,
  proposalHash: digest,
  evidenceAvailability: "evidence_expired",
  evidence: {
    availability: "evidence_expired",
    requiresRefresh: true,
    refreshAction: "retry",
    reason: "process_restarted",
  },
  proposed: {
    title: "Invoice 2026-07",
    correspondentId: 7,
    documentTypeId: null,
    ordinaryTagIds: [1, 2, 3],
    newTagCandidates: [
      {
        candidateKey: "new_tag_vat",
        name: "VAT",
        color: "#336699",
        rationale: "VAT appears as a recurring receipt category.",
      },
    ],
    customFields: [
      {
        customFieldId: 10,
        operation: "set",
        value: "INV-2026-07",
        valueHash: digest,
      },
      {
        customFieldId: 11,
        operation: "remove",
        value: null,
        valueHash: null,
      },
    ],
  },
  review: {
    required: true,
    reasons: ["evidence_expired"],
    rationale: "Transient OCR evidence must be refreshed before applying.",
  },
  rationale: "The compact proposal values were retained after transient evidence expired.",
  preconditions: [precondition],
  freshness,
  createdAt: iso,
};

const validCouncilEvidence = {
  evidenceId: "evidence_taxonomy_1",
  epochId: "cat_epoch_20260722",
  candidateId: "cand_merge_1",
  reviewer: "taxonomy_curator",
  evidenceDocumentIds: [1, 2],
  inspectedDocuments: 2,
  totalDocuments: 10,
  coverage: 0.2,
  xReceiptCount: 8,
  yReceiptCount: 3,
  xReceiptHash: digest,
  yReceiptHash: digest,
  verdict: "support",
  dissent: null,
  counterexamples: [],
  rationale: "The entities describe the same supplier in the sampled receipts.",
  evidenceFingerprint: digest,
  createdAt: iso,
};

const validCompactChairDecision = {
  kind: "compact_chair_decision",
  epochId: "cat_epoch_20260722",
  candidateIds: ["cand_merge_1"],
  proposalId: "prop_catalog_merge_1",
  verdict: "approve",
  action: "approve",
  sourceEntityId: 10,
  targetEntityId: 11,
  rationale: "The compact council record supports merging the duplicate supplier entities.",
  dissent: null,
  evidenceIds: ["evidence_taxonomy_1"],
  confidence: 0.82,
  proposalFingerprint: digest,
  evidenceFingerprint: digest,
  coverageHash: digest,
  coverageCount: 12,
  inspectedDocumentCount: 12,
  totalDocumentCount: 24,
  createdAt: iso,
  decidedAt: iso,
};

const validCatalogProposal = {
  projectionVersion: "catalog_proposal_projection.v2",
  proposalId: "prop_catalog_merge_1",
  epochId: "cat_epoch_20260722",
  kind: "tag",
  intendedAction: "merge",
  xEntityId: 10,
  yEntityId: 11,
  proposedValue: null,
  candidateIds: ["cand_merge_1"],
  evidence: {
    availability: "available",
    evidenceDocumentIds: [1, 2],
    chair: {
      availability: "decision_recorded",
      verdict: "approve",
      action: "approve",
      sourceEntityId: 10,
      targetEntityId: 11,
      rationale: "The compact council record supports merging the duplicate supplier entities.",
      dissent: null,
      evidenceIds: ["evidence_taxonomy_1"],
      confidence: 0.82,
      proposalFingerprint: digest,
      evidenceFingerprint: digest,
      coverageHash: digest,
      coverageCount: 12,
      inspectedDocumentCount: 12,
      totalDocumentCount: 24,
      decidedAt: iso,
    },
  },
  expectedProposalFingerprint: digest,
  expectedEvidenceFingerprint: digest,
  proposalHash: digest,
  preconditions: [{ kind: "catalog_epoch", digest }],
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "catalog_epoch", digest }],
    currentPreconditions: [{ kind: "catalog_epoch", digest }],
  },
  decision: {
    status: "approved",
    outcome: "approved",
    decidedAt: iso,
  },
  apply: {
    status: "applying",
    latestJournalId: "journal_catalog_apply_1",
    stepCount: 2,
    updatedAt: iso,
  },
  rationale: "The proposal keeps only compact identifiers and hashes.",
  createdAt: iso,
};

const expiredCatalogProposal = {
  ...validCatalogProposal,
  evidence: {
    availability: "evidence_expired",
    needsReview: true,
    requiresRefresh: true,
    reason: "chair_decision_missing",
  },
  freshness: {
    status: "current_missing",
    stale: false,
    currentMissing: true,
    expectedPreconditions: [{ kind: "catalog_epoch", digest }],
  },
};

describe("G0 api contracts", () => {
  it("hashes canonical JSON and source bytes deterministically", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(canonicalSha256({ a: 1, b: 2 }));
    expect(sourcePdfHash(new Uint8Array([1, 2, 3]))).toBe(
      "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
  });

  it("strictly models official Paperless document bulk operations", () => {
    const modifyTags = {
      operation: "modify_tags",
      documentIds: [42, 43],
      preconditions: [{ kind: "catalog_epoch", digest }],
      payloadHash: digest,
      idempotencyKey: "paperless-bulk-1",
      parameters: { addTagIds: [7], removeTagIds: [8] },
    };
    const setCorrespondent = {
      ...modifyTags,
      operation: "set_correspondent",
      parameters: { correspondentId: 12 },
    };
    const setDocumentType = {
      ...modifyTags,
      operation: "set_document_type",
      parameters: { documentTypeId: 13 },
    };

    expect(Schema.decodeUnknownEither(PaperlessBulkOperationRequestSchema)(modifyTags)._tag).toBe(
      "Right",
    );
    expect(strictDecodePaperlessBulkOperationRequest(modifyTags)).toMatchObject({ ok: true });
    expect(strictDecodePaperlessBulkOperationRequest(setCorrespondent)).toMatchObject({ ok: true });
    expect(strictDecodePaperlessBulkOperationRequest(setDocumentType)).toMatchObject({ ok: true });
    expect(
      Schema.decodeUnknownEither(PaperlessBulkOperationRequestSchema)({
        ...modifyTags,
        operation: "add_tag",
      })._tag,
    ).toBe("Left");
    expect(
      strictDecodePaperlessBulkOperationRequest({
        ...modifyTags,
        payload: { tagId: 7 },
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_KEYS" })]),
    });
    expect(
      strictDecodePaperlessBulkOperationRequest({
        ...modifyTags,
        parameters: { ...modifyTags.parameters, tagId: 7 },
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_KEYS" })]),
    });
  });

  it("normalizes Paperless document state hashes across unordered ids", () => {
    const base = {
      documentId: 42,
      modified: iso,
      added: "2026-07-22T09:00:00.000Z",
      titleHash: digest,
      correspondentId: null,
      documentTypeId: null,
      tagIds: [3, 1, 2],
      customFields: [
        { field: 2, valueHash: digest },
        { field: 1, valueHash: digest },
      ],
      archiveSerialNumber: null,
      originalFileNameHash: null,
    };

    expect(paperlessDocumentStateHash(base)).toBe(
      paperlessDocumentStateHash({
        ...base,
        tagIds: [1, 2, 3],
        customFields: [...base.customFields].reverse(),
      }),
    );
  });

  it("models analysis as one undecided whole-bundle proposal", () => {
    expect(Schema.decodeUnknownEither(AnalysisProposalSchema)(validAnalysisProposal)._tag).toBe(
      "Right",
    );
    expect(strictDecodeAnalysisProposal(validAnalysisProposal, [10, 11])).toMatchObject({
      ok: true,
    });
    expect(validAnalysisProposal).not.toHaveProperty("ocrText");
    expect(validAnalysisProposal).not.toHaveProperty("evidenceAvailability");
    expect(validAnalysisProposal).not.toHaveProperty("freshness");
  });

  it("models public analysis projections as available or expired without weakening provider output", () => {
    expect(
      Schema.decodeUnknownEither(AnalysisProposalProjectionSchema)(availableAnalysisProjection)
        ._tag,
    ).toBe("Right");
    expect(
      Schema.decodeUnknownEither(AnalysisProposalProjectionSchema)(expiredAnalysisProposal)._tag,
    ).toBe("Right");
    expect(strictDecodeAnalysisProposal(expiredAnalysisProposal, [10, 11])).toMatchObject({
      ok: false,
    });
    expect(strictDecodeAnalysisProposalProjection(expiredAnalysisProposal, [10, 11])).toMatchObject(
      {
        ok: true,
      },
    );
    expect(expiredAnalysisProposal).not.toHaveProperty("ocrPreview");
    expect(expiredAnalysisProposal).not.toHaveProperty("fieldEvidence");
    expect(expiredAnalysisProposal).not.toHaveProperty("confidence");
  });

  it("rejects per-action, unknown-key, duplicate-id, and incomplete analysis bundles", () => {
    expect(
      strictDecodeAnalysisProposal({ ...validAnalysisProposal, action: "set_title" }, [10, 11]),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_KEYS" })]),
    });
    expect(
      strictDecodeAnalysisProposal(
        {
          ...validAnalysisProposal,
          proposed: { ...validAnalysisProposal.proposed, ordinaryTagIds: [1, 1] },
        },
        [10, 11],
      ),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "DUPLICATE_IDS" })] });
    expect(
      strictDecodeAnalysisProposal(
        {
          ...validAnalysisProposal,
          proposed: {
            ...validAnalysisProposal.proposed,
            customFields: [validAnalysisProposal.proposed.customFields[0]],
          },
        },
        [10, 11],
      ),
    ).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ code: "MISSING_CONFIGURED_IDS" })],
    });
  });

  it("rejects forged evidence fields on expired analysis proposals", () => {
    expect(
      strictDecodeAnalysisProposalProjection(
        { ...expiredAnalysisProposal, ocrPreview: validAnalysisProposal.ocrPreview },
        [10, 11],
      ),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_KEYS" })]),
    });
    expect(
      strictDecodeAnalysisProposalProjection(
        {
          ...expiredAnalysisProposal,
          proposed: {
            ...expiredAnalysisProposal.proposed,
            newTagCandidates: [
              {
                ...expiredAnalysisProposal.proposed.newTagCandidates[0],
                evidence: [ref],
                confidence: 0.5,
              },
            ],
          },
        },
        [10, 11],
      ),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.objectContaining({ code: "UNKNOWN_KEYS" })]),
    });
  });

  it("rejects non-Codex catalog runtimes", () => {
    expect(strictDecodeAnalysisRunStartBody({ documentId: 42, runtime: "pi_agent" })).toMatchObject(
      {
        ok: false,
        errors: [expect.objectContaining({ code: "UNKNOWN_KEYS" })],
      },
    );
    expect(
      Schema.decodeUnknownEither(CatalogEpochStartBodySchema)({
        scope: ["tag"],
        expectedPaperlessCatalogHash: digest,
        runtime: "pi_agent",
        idempotencyKey: "catalog-start-1",
      })._tag,
    ).toBe("Left");
  });

  it("rejects catalog evidence that cites unknown or duplicate Paperless documents", () => {
    expect(strictDecodeCouncilEvidence(validCouncilEvidence, [1, 2, 3])).toMatchObject({
      ok: true,
    });
    expect(
      strictDecodeCouncilEvidence(
        { ...validCouncilEvidence, evidenceDocumentIds: [1, 1] },
        [1, 2, 3],
      ),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "DUPLICATE_IDS" })] });
    expect(
      strictDecodeCouncilEvidence(
        { ...validCouncilEvidence, evidenceDocumentIds: [1, 99] },
        [1, 2, 3],
      ),
    ).toMatchObject({
      ok: false,
      errors: [expect.objectContaining({ message: "Unknown evidence document ID: 99" })],
    });
  });

  it("models catalog proposals with a real compact chair decision or explicit missing evidence", () => {
    expect(
      Schema.decodeUnknownEither(CompactChairDecisionLedgerContractSchema)(
        validCompactChairDecision,
      )._tag,
    ).toBe("Right");
    expect(Schema.decodeUnknownEither(CatalogProposalSchema)(validCatalogProposal)._tag).toBe(
      "Right",
    );
    expect(strictDecodeCatalogProposal(validCatalogProposal)).toMatchObject({ ok: true });
    expect(Schema.decodeUnknownEither(CatalogProposalSchema)(expiredCatalogProposal)._tag).toBe(
      "Right",
    );
    expect(strictDecodeCatalogProposal(expiredCatalogProposal)).toMatchObject({ ok: true });
  });

  it("rejects fake catalog chair records, padded evidence, and invented safety dependencies", () => {
    expect(
      strictDecodeCatalogProposal({
        ...expiredCatalogProposal,
        evidence: {
          ...expiredCatalogProposal.evidence,
          chair: validCatalogProposal.evidence.chair,
        },
      }),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_KEYS" })] });
    expect(
      strictDecodeCatalogProposal({
        ...validCatalogProposal,
        evidence: {
          ...validCatalogProposal.evidence,
          chair: {
            ...validCatalogProposal.evidence.chair,
            evidenceIds: ["evidence_taxonomy_1", "evidence_missing_prop_0"],
          },
        },
      }),
    ).toMatchObject({ ok: false });
    expect(
      strictDecodeCatalogProposal({ ...expiredCatalogProposal, safetyDependencies: [] }),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_KEYS" })] });
    expect(
      strictDecodeCatalogProposal({
        ...validCatalogProposal,
        decision: { ...validCatalogProposal.decision, inferredByUi: true },
      }),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_KEYS" })] });
    expect(
      strictDecodeCatalogProposal({
        ...validCatalogProposal,
        apply: { ...validCatalogProposal.apply, taskIds: ["task_1"] },
      }),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "UNKNOWN_KEYS" })] });
  });

  it("keeps the storage ledger allowlist exclusive and rejects forbidden fields", () => {
    expect(isAllowedStorageArtifactKind("settings")).toBe(true);
    expect(isAllowedStorageArtifactKind("compact_chair_decision")).toBe(true);
    expect(isAllowedStorageArtifactKind("paperless_capability_snapshot")).toBe(false);
    expect(isAllowedStorageArtifactKind("structured_output_schema")).toBe(false);
    expect(() => assertAllowedStorageArtifactKind("document_content")).toThrow(
      "Storage artifact kind is not allowed",
    );
    expect(
      strictDecodeStorageLedgerEntry({
        kind: "compact_rationale",
        timestamp: iso,
        rationale: "Concise reviewer rationale.",
        prompt: "must never persist",
      }),
    ).toMatchObject({ ok: false, errors: [expect.objectContaining({ code: "FORBIDDEN_FIELDS" })] });
  });

  it("enforces legal state transitions with compare-and-set conflicts", () => {
    expect(compareAndSetAnalysisRunState("queued", "queued", "reading_paperless")).toEqual({
      ok: true,
      state: "reading_paperless",
    });
    expect(compareAndSetAnalysisRunState("awaiting_review", "awaiting_review", "retrying")).toEqual(
      {
        ok: true,
        state: "retrying",
      },
    );
    expect(compareAndSetCatalogState("proposed", "proposed", "rejected")).toEqual({
      ok: true,
      state: "rejected",
    });
    expect(compareAndSetCatalogState("proposed", "queued", "approved")).toMatchObject({
      ok: false,
      error: { status: 409, code: "STATE_TRANSITION_CONFLICT" },
    });
  });

  it("keeps structured output JSON schemas in the shared schema registry", () => {
    const schemas = apiContractJsonSchemas();
    expect(schemas.CodexDocumentStructuredOutput).toEqual(
      codexStructuredOutputJsonSchemas.document,
    );
    expect(schemas.CodexReviewerStructuredOutput).toEqual(
      codexStructuredOutputJsonSchemas.reviewer,
    );
    expect(schemas.CodexChairStructuredOutput).toEqual(codexStructuredOutputJsonSchemas.chair);
  });

  it("publishes Paperless-first route status semantics", () => {
    const document = generateOpenApiDocument() as {
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: {
              content?: Record<string, { schema?: Record<string, unknown> }>;
            };
            responses: Record<string, unknown>;
          }
        >
      >;
      components: { schemas: Record<string, Record<string, unknown>> };
    };
    const paperlessBulkOperation = document.paths["/api/paperless/bulk-operations"]?.post;
    const paperlessBulkOperationSchema = document.components.schemas.PaperlessBulkOperationRequest;
    const paperlessBulkOperationDefs = paperlessBulkOperationSchema.$defs as Record<
      string,
      Record<string, unknown>
    >;
    const expectTypedCommandResponses = (responses: Record<string, unknown>) => {
      expect(responses["202"]).toBeDefined();
      expect(responses["409"]).toMatchObject({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/StalePreconditionError" } },
        },
      });
      expect(responses["502"]).toMatchObject({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/ProviderMalformedError" } },
        },
      });
      expect(responses["503"]).toMatchObject({
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/UnavailableError" } },
        },
      });
    };

    expect(document.paths["/api/analysis/runs"]?.post.responses["202"]).toBeDefined();
    expect(document.paths["/api/analysis/runs/{runId}/apply"]?.post.responses["409"]).toBeDefined();
    expect(document.paths["/api/analysis/runs/{runId}/apply"]?.post.responses["409"]).toMatchObject(
      {
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/StalePreconditionError" } },
        },
      },
    );
    expect(document.paths["/api/analysis/runs/{runId}/retry"]?.post.responses["502"]).toBeDefined();
    expect(
      document.paths["/api/analysis/runs/{runId}/force-ocr"]?.post.responses["503"],
    ).toBeDefined();
    expect(document.components.schemas.AnalysisAvailableProposal).toBeDefined();
    expect(document.components.schemas.AnalysisAvailableProposalProjection).toBeDefined();
    expect(document.components.schemas.AnalysisExpiredProposal).toBeDefined();
    expect(document.components.schemas.CatalogProposalEvidenceAvailable).toBeDefined();
    expect(document.components.schemas.CatalogProposalEvidenceExpired).toBeDefined();
    expect(document.components.schemas.CatalogProposalDecisionProjection).toBeDefined();
    expect(document.components.schemas.CatalogProposalApplyProjection).toBeDefined();
    expect(document.components.schemas.CompactChairDecisionLedgerContract).toBeDefined();
    expect(document.paths["/api/analysis/review"]?.get.responses["200"]).toBeDefined();
    expect(document.paths["/api/analysis/failed"]?.get.responses["200"]).toBeDefined();
    expect(
      document.paths["/api/analysis/random-cycle/select"]?.post.responses["202"],
    ).toBeDefined();
    expect(document.paths["/api/analysis/random-cycle/reset"]?.post.responses["202"]).toBeDefined();
    expect(
      paperlessBulkOperation?.requestBody?.content?.["application/json"]?.schema,
    ).toMatchObject({
      $ref: "#/components/schemas/PaperlessBulkOperationRequest",
    });
    expect(paperlessBulkOperation?.responses["409"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/StalePreconditionError" } },
      },
    });
    expect(paperlessBulkOperation?.responses["502"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ProviderMalformedError" } },
      },
    });
    expect(paperlessBulkOperation?.responses["503"]).toMatchObject({
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/UnavailableError" } },
      },
    });
    expect(paperlessBulkOperationDefs.PaperlessModifyTagsBulkOperationRequest).toMatchObject({
      additionalProperties: false,
      properties: {
        operation: { enum: ["modify_tags"] },
        parameters: {
          additionalProperties: false,
          properties: {
            addTagIds: { type: "array" },
            removeTagIds: { type: "array" },
          },
        },
      },
    });
    expect(paperlessBulkOperationDefs.PaperlessSetCorrespondentBulkOperationRequest).toMatchObject({
      additionalProperties: false,
      properties: {
        operation: { enum: ["set_correspondent"] },
        parameters: {
          additionalProperties: false,
          properties: { correspondentId: { type: "integer" } },
        },
      },
    });
    expect(paperlessBulkOperationDefs.PaperlessSetDocumentTypeBulkOperationRequest).toMatchObject({
      additionalProperties: false,
      properties: {
        operation: { enum: ["set_document_type"] },
        parameters: {
          additionalProperties: false,
          properties: { documentTypeId: { type: "integer" } },
        },
      },
    });
    expectTypedCommandResponses(document.paths["/api/catalog/epochs"]?.post.responses ?? {});
    expectTypedCommandResponses(
      document.paths["/api/catalog/epochs/{epochId}/cancel"]?.post.responses ?? {},
    );
    expectTypedCommandResponses(
      document.paths["/api/catalog/proposals/{proposalId}/approve"]?.post.responses ?? {},
    );
    expectTypedCommandResponses(
      document.paths["/api/catalog/proposals/{proposalId}/reject"]?.post.responses ?? {},
    );
    expectTypedCommandResponses(
      document.paths["/api/catalog/proposals/{proposalId}/apply"]?.post.responses ?? {},
    );
  });
});
