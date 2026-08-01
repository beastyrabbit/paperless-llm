import { canonicalSha256 } from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { Document } from "../../../src/models/index.js";
import {
  CatalogEvidenceReadPort,
  CatalogEvidenceReadPortFromPaperlessLive,
  CatalogEvidenceService,
  CatalogEvidenceServiceLive,
  makeCatalogEvidenceReadPortFromPaperlessLive,
} from "../../../src/services/CatalogEvidenceService.js";
import { nameSignals, normalizeCatalogName } from "../../../src/services/catalog-evidence/index.js";
import type { CatalogEvidenceReadPort as CatalogEvidenceReadPortType } from "../../../src/services/catalog-evidence/read-port.js";
import {
  PaperlessService,
  type PaperlessService as PaperlessServiceType,
} from "../../../src/services/PaperlessService.js";
import type {
  PaperlessAssignmentKind,
  PaperlessAssignmentReceipt,
} from "../../../src/services/paperless/types.js";

const stateHash = (value: unknown) => canonicalSha256({ test: "catalog-evidence", value });

const doc = (
  id: number,
  overrides: Partial<Document> & Pick<Document, "correspondent" | "document_type" | "tags">,
): Document => ({
  id,
  title: overrides.title ?? `Document ${id}`,
  content:
    overrides.content ??
    `start ${id} `.repeat(20) + `middle ${id} `.repeat(20) + `end ${id} `.repeat(20),
  correspondent_name: null,
  document_type_name: null,
  correspondent: overrides.correspondent,
  document_type: overrides.document_type,
  tags: overrides.tags,
  created: overrides.created ?? `2026-01-${String((id % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  modified: overrides.modified ?? `2026-02-${String((id % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  added: `2026-03-${String((id % 28) + 1).padStart(2, "0")}T00:00:00Z`,
  archive_serial_number: null,
  original_file_name: `document-${id}.pdf`,
  archived_file_name: `archive/document-${id}.pdf`,
});

interface FakeOptions {
  readonly forgedAssignment?: boolean;
  readonly movingReceipt?: boolean;
  readonly movingEpoch?: boolean;
  readonly manyEntities?: boolean;
  readonly missingContentSignature?: boolean;
  readonly tinyWeakPair?: boolean;
}

const buildDocuments = (options: FakeOptions = {}) => {
  const documents: Document[] = [];
  for (let id = 1; id <= 240; id += 1) {
    const tags: number[] = [];
    if (id <= 130) tags.push(1);
    if (id >= 101 && id <= 220) tags.push(2);
    const correspondent =
      options.tinyWeakPair && id === 1
        ? 14
        : options.tinyWeakPair && id === 2
          ? 15
          : options.tinyWeakPair && id <= 130
            ? 10
            : options.tinyWeakPair && id <= 220
              ? 11
              : id >= 141 && id <= 180
                ? 14
                : id >= 181 && id <= 220
                  ? 15
                  : id <= 130
                    ? 10
                    : id <= 220
                      ? 11
                      : null;
    const documentType = correspondent === 14 || correspondent === 15 ? 22 : 20;
    documents.push(
      doc(id, {
        tags,
        correspondent,
        document_type: documentType,
        title:
          id === 17
            ? "Telekom satellite metadata outlier"
            : id === 205
              ? "Deutsche Telekom roaming metadata outlier"
              : correspondent === 14
                ? `North Bakery delivery ${id}`
                : correspondent === 15
                  ? `South Hardware order ${id}`
                  : `Telekom Deutsche Telekom bill ${id}`,
      }),
    );
  }
  return documents;
};

const filterDescriptor = (kind: PaperlessAssignmentKind, entityId: number) => {
  if (kind === "tag") return { path: "/documents/" as const, params: { tags__id: entityId } };
  if (kind === "correspondent") {
    return { path: "/documents/" as const, params: { correspondent: entityId } };
  }
  return { path: "/documents/" as const, params: { document_type: entityId } };
};

const createReadPortLayer = (options: FakeOptions = {}) => {
  const documents = buildDocuments(options);
  const receiptCalls: Array<{ kind: PaperlessAssignmentKind; entityId: number }> = [];
  const bodyFetches: number[] = [];
  let observationCalls = 0;

  const idsFor = (kind: PaperlessAssignmentKind, entityId: number) =>
    documents
      .filter((document) =>
        kind === "tag"
          ? document.tags.includes(entityId)
          : kind === "correspondent"
            ? document.correspondent === entityId
            : document.document_type === entityId,
      )
      .map((document) => document.id)
      .sort((left, right) => left - right);

  const receiptFor = (
    kind: PaperlessAssignmentKind,
    entityId: number,
  ): PaperlessAssignmentReceipt => {
    receiptCalls.push({ kind, entityId });
    const moved =
      options.movingReceipt && receiptCalls.length > 2 && kind === "tag" && entityId === 2;
    const ids = moved ? [...idsFor(kind, entityId), 221] : idsFor(kind, entityId);
    const receiptDocuments = ids.map((documentId, index) => {
      const document = documents.find((item) => item.id === documentId);
      if (!document) throw new Error(`missing receipt document ${documentId}`);
      return {
        documentId,
        modified: document.modified,
        stateHash: stateHash({ id: document.id, modified: document.modified }),
        verifiedMembership: !(options.forgedAssignment && index === 0 && entityId === 1),
      };
    });
    return {
      kind,
      entityId,
      filterDescriptor: filterDescriptor(kind, entityId),
      expectedApiCount: ids.length,
      fetchedCount: ids.length,
      pageCount: Math.ceil(ids.length / 50),
      documentIds: ids,
      documents: receiptDocuments,
      capturedAt: "2026-07-22T10:00:00Z",
      assignmentHash: stateHash({ kind, entityId, ids, receiptDocuments }),
      complete: true,
    } as PaperlessAssignmentReceipt;
  };

  const entitiesFor = (kind: PaperlessAssignmentKind) => {
    if (kind === "tag") {
      const noise = options.manyEntities
        ? Array.from({ length: 1_050 }, (_, index) => ({
            id: 1_000 + index,
            name: `UniqueEntity${index}`,
            slug: `unique-entity-${index}`,
            document_count: 1,
          }))
        : [];
      return [
        { id: 1, name: "Telekom", slug: "telekom", document_count: 130 },
        { id: 2, name: "Deutsche Telekom AG", slug: "deutsche-telekom", document_count: 120 },
        { id: 3, name: "Invoice", slug: "invoice", document_count: 0 },
        { id: 4, name: "Rechnung", slug: "rechnung", document_count: 0 },
        { id: 90, name: "ai-processing", slug: "ai-processing", document_count: 40 },
        { id: 91, name: "Inbox", slug: "inbox", document_count: 40, is_inbox_tag: true },
        { id: 92, name: "Projects/Client", slug: "projects/client", document_count: 40 },
        { id: 93, name: "Tax Legal", slug: "tax-legal", document_count: 40 },
        { id: 94, name: "Tax Legal GmbH", slug: "tax-legal-gmbh", document_count: 40 },
        { id: 95, name: "System Queue", slug: "system-queue", document_count: 40 },
        { id: 96, name: "Dependency Queue", slug: "dependency-queue", document_count: 40 },
        { id: 97, name: "Projects Client", slug: "projects-client", document_count: 40 },
        ...noise,
        ...(options.manyEntities
          ? [
              { id: 2_200, name: "Late Match", slug: "late-match", document_count: 2 },
              { id: 2_201, name: "Late Match GmbH", slug: "late-match-gmbh", document_count: 2 },
            ]
          : []),
      ];
    }
    if (kind === "correspondent") {
      return [
        { id: 10, name: "ARD ZDF Deutschlandradio", slug: "ard-zdf", document_count: 130 },
        { id: 11, name: "ARD/ZDF Beitragsservice", slug: "beitragsservice", document_count: 90 },
        {
          id: 14,
          name: "North Bakery",
          slug: "north-bakery",
          document_count: options.tinyWeakPair ? 1 : 40,
        },
        {
          id: 15,
          name: "South Hardware",
          slug: "south-hardware",
          document_count: options.tinyWeakPair ? 1 : 40,
        },
      ];
    }
    return [
      { id: 20, name: "Invoice", slug: "invoice", document_count: 140 },
      { id: 21, name: "Rechnung", slug: "rechnung", document_count: 0 },
      { id: 22, name: "Contract", slug: "contract", document_count: 80 },
    ];
  };

  const snapshotsPage = (request: { cursor?: string; limit?: number }) => {
    const limit = request.limit ?? 50;
    const page = request.cursor ? Number(request.cursor) : 1;
    const start = (page - 1) * limit;
    const items = documents.slice(start, start + limit).map((document) => ({
      documentId: document.id,
      stateHash: stateHash({ id: document.id, modified: document.modified }),
      modified: document.modified,
      created: document.created,
      tagIds: document.tags,
      correspondentId: document.correspondent,
      documentTypeId: document.document_type,
      metadataSignature: stateHash({
        correspondent: document.correspondent,
        documentType: document.document_type,
        tags: document.tags,
        titleFamily: document.title.replace(/\d+/g, "#"),
      }),
      contentSignature: options.missingContentSignature
        ? undefined
        : document.id === 17 || document.id === 205
          ? stateHash({ outlier: document.title, id: document.id })
          : stateHash({ family: document.content.slice(0, 20), idModulo: document.id % 7 }),
    }));
    const nextCursor = start + limit < documents.length ? String(page + 1) : null;
    return { items, page: { nextCursor, hasNextPage: nextCursor !== null, limit } };
  };

  const catalogObservation = (scope: readonly PaperlessAssignmentKind[]) => {
    observationCalls += 1;
    const entityCounts = {
      tag: scope.includes("tag") ? entitiesFor("tag").length : 0,
      correspondent: scope.includes("correspondent") ? entitiesFor("correspondent").length : 0,
      document_type: scope.includes("document_type") ? entitiesFor("document_type").length : 0,
    };
    const allSnapshots = snapshotsPage({ limit: documents.length }).items;
    const moveVersion = options.movingEpoch ? observationCalls : 0;
    const catalogFingerprint = stateHash({
      scope,
      entityCounts,
      moveVersion,
      entities: scope.map((kind) => ({ kind, ids: entitiesFor(kind).map((entity) => entity.id) })),
    });
    const freshnessFingerprint = stateHash({
      totalDocuments: documents.length,
      moveVersion,
      states: allSnapshots.map((snapshot) => ({
        documentId: snapshot.documentId,
        modified: snapshot.modified,
        stateHash: snapshot.stateHash,
      })),
    });
    return {
      observedAt: `2026-07-22T10:00:${String(observationCalls).padStart(2, "0")}Z`,
      catalogFingerprint,
      freshnessFingerprint,
      entityCounts,
      totalDocuments: documents.length,
    };
  };

  const readPort = {
    observeCatalog: vi.fn((scope) => Effect.succeed(catalogObservation(scope))),
    getPolicy: vi.fn(() =>
      Effect.succeed({
        workflowEntityIds: { tag: [90] },
        systemEntityIds: { tag: [95] },
        dependencyEntityIds: { tag: [96] },
        highRiskEntityIds: { tag: [94] },
      }),
    ),
    listEntities: vi.fn((kind) => Effect.succeed(entitiesFor(kind))),
    listDocumentSnapshotsPage: vi.fn((request: { cursor?: string; limit?: number }) => {
      return Effect.succeed(snapshotsPage(request));
    }),
    readAssignmentReceipt: vi.fn((kind, entityId) => Effect.succeed(receiptFor(kind, entityId))),
    getDocumentCitationSource: vi.fn((documentId: number) => {
      bodyFetches.push(documentId);
      const document = documents.find((item) => item.id === documentId);
      if (!document) return Effect.fail(new Error(`missing document ${documentId}`));
      return Effect.succeed(document);
    }),
  } satisfies CatalogEvidenceReadPortType;

  return {
    layer: Layer.succeed(CatalogEvidenceReadPort, readPort),
    mocks: { readPort, receiptCalls, bodyFetches },
  };
};

const runWith = <A, E>(
  layer: Layer.Layer<CatalogEvidenceReadPortType>,
  effect: Effect.Effect<A, E, CatalogEvidenceService>,
) =>
  Effect.runPromise(effect.pipe(Effect.provide(Layer.provide(CatalogEvidenceServiceLive, layer))));

const collectTagDossier = (layer: Layer.Layer<CatalogEvidenceReadPortType>) =>
  runWith(
    layer,
    Effect.gen(function* () {
      const service = yield* CatalogEvidenceService;
      const epoch = yield* service.buildEpoch({
        scope: ["tag"],
        createdAt: "2026-07-22T10:00:00Z",
      });
      const candidates = yield* service.blockCandidates(epoch);
      const candidate = candidates.find((item) => item.xEntityId === 1 && item.yEntityId === 2);
      if (!candidate) throw new Error("missing tag candidate");
      return yield* service.collectEvidence(epoch, candidate);
    }),
  );

describe("CatalogEvidenceService", () => {
  it("uses read-port epochs, excludes configured operational entities, flags risks, and emits zero-use reviews", async () => {
    expect(normalizeCatalogName("Deutsche Telekom AG")).toBe("deutsche telekom ag");
    expect(nameSignals("Invoice", "Rechnung")).toContain("language_variant");
    const { layer } = createReadPortLayer();
    const result = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const epoch = yield* service.buildEpoch({
          createdAt: "2026-07-22T10:00:00Z",
          pageLimit: 60,
        });
        return {
          candidates: yield* service.blockCandidates(epoch),
          unused: yield* service.listUnusedReviews(epoch),
        };
      }),
    );

    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "tag", xEntityId: 1, yEntityId: 2 }),
      ]),
    );
    expect(result.candidates[0]).not.toHaveProperty("decisive");
    expect(result.candidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ xEntityId: 3, yEntityId: 4 }),
        expect.objectContaining({ xEntityId: 90 }),
        expect.objectContaining({ xEntityId: 91 }),
        expect.objectContaining({ xEntityId: 95 }),
        expect.objectContaining({ xEntityId: 96 }),
      ]),
    );
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tag",
          xEntityId: 92,
          yEntityId: 97,
          requiresHumanReview: true,
          riskFlags: expect.arrayContaining(["hierarchical"]),
        }),
        expect.objectContaining({
          kind: "tag",
          xEntityId: 93,
          yEntityId: 94,
          requiresHumanReview: true,
          riskFlags: expect.arrayContaining(["forced_review_high_risk"]),
        }),
      ]),
    );
    expect(result.unused).toEqual(
      expect.arrayContaining([expect.objectContaining({ entityId: 3 })]),
    );
  });

  it("propagates a coordinator-provided epoch ID into candidates and dossiers", async () => {
    const { layer } = createReadPortLayer();
    const result = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const epoch = yield* service.buildEpoch({
          epochId: "cat_epoch_queued_background_20260722",
          scope: ["tag"],
          createdAt: "2026-07-22T10:00:00Z",
        });
        const candidates = yield* service.blockCandidates(epoch);
        const candidate = candidates.find((item) => item.xEntityId === 1 && item.yEntityId === 2);
        if (!candidate) throw new Error("missing tag candidate");
        const dossier = yield* service.collectEvidence(epoch, candidate);
        const unused = yield* service.listUnusedReviews(epoch);
        return { epoch, candidate, dossier, unused };
      }),
    );

    expect(result.epoch.epochId).toBe("cat_epoch_queued_background_20260722");
    expect(result.candidate.epochId).toBe("cat_epoch_queued_background_20260722");
    expect(result.dossier.candidate.epochId).toBe("cat_epoch_queued_background_20260722");
    expect(result.unused).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ epochId: "cat_epoch_queued_background_20260722" }),
      ]),
    );
  });

  it("keeps deterministic derived epoch IDs by default and rejects invalid overrides", async () => {
    const { layer } = createReadPortLayer();
    const [first, second] = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const options = {
          scope: ["tag"] as const,
          createdAt: "2026-07-22T10:00:00Z",
        };
        return [yield* service.buildEpoch(options), yield* service.buildEpoch(options)] as const;
      }),
    );

    expect(first.epochId).toMatch(/^cat_epoch_[A-Za-z0-9_-]+$/);
    expect(second.epochId).toBe(first.epochId);
    await expect(
      runWith(
        layer,
        Effect.gen(function* () {
          const service = yield* CatalogEvidenceService;
          return yield* service.buildEpoch({
            epochId: "queued_background_20260722",
            scope: ["tag"],
            createdAt: "2026-07-22T10:00:00Z",
          });
        }),
      ),
    ).rejects.toThrow("Invalid catalog evidence epoch ID");
  });

  it("fails closed when catalog epoch observations move during the scan", async () => {
    const { layer, mocks } = createReadPortLayer({ movingEpoch: true });
    await expect(
      runWith(
        layer,
        Effect.gen(function* () {
          const service = yield* CatalogEvidenceService;
          return yield* service.buildEpoch({
            scope: ["tag"],
            createdAt: "2026-07-22T10:00:00Z",
            maxScanAttempts: 2,
          });
        }),
      ),
    ).rejects.toThrow("Catalog evidence epoch unstable after 2 scan attempts");
    expect(mocks.readPort.observeCatalog).toHaveBeenCalledTimes(4);
  });

  it("builds high-recall blocks over more than 1000 entities without making later IDs undiscoverable", async () => {
    const { layer } = createReadPortLayer({ manyEntities: true });
    const candidates = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const epoch = yield* service.buildEpoch({
          scope: ["tag"],
          createdAt: "2026-07-22T10:00:00Z",
        });
        return yield* service.blockCandidates(epoch);
      }),
    );

    expect(candidates).toEqual(
      expect.arrayContaining([expect.objectContaining({ xEntityId: 2_200, yEntityId: 2_201 })]),
    );
  });

  it("initial collection fetches only the first deterministic <=30 body batch for a >100 union", async () => {
    const { layer, mocks } = createReadPortLayer();
    const dossier = await collectTagDossier(layer);

    expect(mocks.receiptCalls).toEqual([
      { kind: "tag", entityId: 1 },
      { kind: "tag", entityId: 2 },
    ]);
    expect(dossier.assignmentSets.unionDocumentIds).toHaveLength(220);
    expect(dossier.batch.documentIds).toHaveLength(30);
    expect(dossier.batch.createdOldestDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.createdNewestDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.modifiedOldestDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.modifiedNewestDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.evenDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.xOnlyDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.yOnlyDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.bothDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.metadataClusterDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.documentSignatureClusterDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.batch.semanticOutlierDocumentIds.length).toBeGreaterThan(0);
    expect(dossier.coveragePolicy.riskFlags).not.toContain("missing_semantic_signature");
    expect(dossier.inspectedDocumentIds).toEqual(dossier.batch.documentIds);
    expect(mocks.bodyFetches).toHaveLength(30);
    expect(dossier.nextBatch.documentIds.length).toBeGreaterThan(0);
    expect(dossier.coveragePolicy.policy).toBe("needs_expansion");
    expect(dossier.finalFreshness.performed).toBe(false);
    expect(dossier.citations[0]?.excerpt.delimiter).toBe("UNTRUSTED_DOCUMENT_TEXT");
    expect(dossier).not.toHaveProperty("councilEvidence");
  });

  it("does not fabricate semantic outliers when catalog snapshots have no semantic signatures", async () => {
    const { layer, mocks } = createReadPortLayer({ missingContentSignature: true });
    const dossier = await collectTagDossier(layer);

    expect(dossier.batch.semanticOutlierDocumentIds).toEqual([]);
    expect(dossier.nextBatch.semanticOutlierDocumentIds).toEqual([]);
    expect(dossier.coveragePolicy.riskFlags).toContain("missing_semantic_signature");
    expect(mocks.bodyFetches).toHaveLength(30);
  });

  it("expands explicitly in immutable batches and performs freshness only after exhaustive coverage", async () => {
    const { layer, mocks } = createReadPortLayer();
    const first = await collectTagDossier(layer);
    const serviceLayer = Layer.provide(CatalogEvidenceServiceLive, layer);
    const second = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        return yield* service.expandEvidence(first, { documentIds: first.nextBatch.documentIds });
      }).pipe(Effect.provide(serviceLayer)),
    );
    expect(first.citations).toHaveLength(30);
    expect(second.citations.length).toBeGreaterThan(first.citations.length);
    expect(second.citations.length).toBeLessThanOrEqual(60);
    expect(mocks.bodyFetches).toHaveLength(second.citations.length);
    expect(second.finalFreshness.performed).toBe(false);

    const remaining = second.assignmentSets.unionDocumentIds.filter(
      (documentId) => !second.inspectedDocumentIds.includes(documentId),
    );
    const exhaustive = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        return yield* service.expandEvidence(second, { documentIds: remaining });
      }).pipe(Effect.provide(serviceLayer)),
    );
    expect(exhaustive.citations).toHaveLength(220);
    expect(exhaustive.coveragePolicy.policy).toBe("exhaustive_fresh");
    expect(exhaustive.finalFreshness.complete).toBe(true);
    expect(mocks.receiptCalls.filter((call) => call.kind === "tag")).toHaveLength(4);
  });

  it("keeps final gate stale when exhaustive expansion sees moved receipts", async () => {
    const { layer } = createReadPortLayer({ movingReceipt: true });
    const first = await collectTagDossier(layer);
    const exhaustive = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const remaining = first.assignmentSets.unionDocumentIds.filter(
          (documentId) => !first.inspectedDocumentIds.includes(documentId),
        );
        return yield* service.expandEvidence(first, { documentIds: remaining });
      }),
    );

    expect(exhaustive.finalFreshness.performed).toBe(true);
    expect(exhaustive.finalFreshness.complete).toBe(false);
    expect(exhaustive.coveragePolicy.policy).toBe("stale_after_exhaustive");
  });

  it("rejects forged assignments, forged expansion IDs, and forged citation IDs", async () => {
    await expect(
      collectTagDossier(createReadPortLayer({ forgedAssignment: true }).layer),
    ).rejects.toThrow("unverified assignment membership");

    const { layer } = createReadPortLayer();
    const dossier = await collectTagDossier(layer);
    const invalid = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        return yield* Effect.flip(service.expandEvidence(dossier, { documentIds: [9999] }));
      }),
    );
    expect(String(invalid)).toContain("outside candidate receipts");

    const citationDossier = await collectTagDossier(layer);
    const citationInvalid = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        return yield* Effect.flip(
          service.validateCitationIds(
            citationDossier.candidate.candidateId,
            ["citation_policy"],
            citationDossier,
          ),
        );
      }),
    );
    expect(String(citationInvalid)).toContain("Citation ID is not present");
  });

  it("does not fetch remaining bodies while dossier still needs expansion", async () => {
    const { layer, mocks } = createReadPortLayer();
    const dossier = await collectTagDossier(layer);
    expect(dossier.coveragePolicy.policy).toBe("needs_expansion");
    expect(mocks.bodyFetches).toHaveLength(30);
    expect(mocks.bodyFetches).not.toEqual(dossier.assignmentSets.unionDocumentIds);
  });

  it("Paperless adapter calls separate receipt methods for X and Y", async () => {
    const readTagAssignmentReceipt = vi.fn((entityId: number) =>
      Effect.succeed({
        kind: "tag" as const,
        entityId,
        filterDescriptor: filterDescriptor("tag", entityId),
        expectedApiCount: 0,
        fetchedCount: 0,
        pageCount: 0,
        documentIds: [],
        documents: [],
        capturedAt: "2026-07-22T10:00:00Z",
        assignmentHash: stateHash({ entityId }),
        complete: true as const,
      }),
    );
    const paperless = {
      getTags: vi.fn(() =>
        Effect.succeed([
          { id: 1, name: "Telekom", slug: "telekom", document_count: 1 },
          { id: 2, name: "Deutsche Telekom", slug: "deutsche-telekom", document_count: 1 },
        ]),
      ),
      getCorrespondents: vi.fn(() => Effect.succeed([])),
      getDocumentTypes: vi.fn(() => Effect.succeed([])),
      listDocumentsPage: vi.fn(() =>
        Effect.succeed({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 50 } }),
      ),
      readTagAssignmentReceipt,
      readCorrespondentAssignmentReceipt: vi.fn(),
      readDocumentTypeAssignmentReceipt: vi.fn(),
      getDocument: vi.fn(),
    } as unknown as PaperlessServiceType;
    const paperlessLayer = Layer.succeed(PaperlessService, paperless);
    const layer = Layer.provide(makeCatalogEvidenceReadPortFromPaperlessLive({}), paperlessLayer);

    await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const epoch = yield* service.buildEpoch({
          scope: ["tag"],
          createdAt: "2026-07-22T10:00:00Z",
        });
        const candidates = yield* service.blockCandidates(epoch);
        const candidate = candidates.find((item) => item.xEntityId === 1 && item.yEntityId === 2);
        if (!candidate) throw new Error("missing candidate");
        return yield* service.collectEvidence(epoch, candidate);
      }),
    );

    expect(readTagAssignmentReceipt).toHaveBeenCalledWith(1);
    expect(readTagAssignmentReceipt).toHaveBeenCalledWith(2);
  });

  it("Paperless adapter applies injected production policy exclusions for ai-analyse/workflow tags", async () => {
    const paperless = {
      getTags: vi.fn(() =>
        Effect.succeed([
          { id: 90, name: "Telekom", slug: "ai-analyse", document_count: 1 },
          { id: 2, name: "Telekom AG", slug: "telekom-ag", document_count: 1 },
        ]),
      ),
      getCorrespondents: vi.fn(() => Effect.succeed([])),
      getDocumentTypes: vi.fn(() => Effect.succeed([])),
      listDocumentsPage: vi.fn(() =>
        Effect.succeed({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 50 } }),
      ),
      readTagAssignmentReceipt: vi.fn(),
      readCorrespondentAssignmentReceipt: vi.fn(),
      readDocumentTypeAssignmentReceipt: vi.fn(),
      getDocument: vi.fn(),
    } as unknown as PaperlessServiceType;
    const paperlessLayer = Layer.succeed(PaperlessService, paperless);
    const layer = Layer.provide(
      makeCatalogEvidenceReadPortFromPaperlessLive({ workflowEntityIds: { tag: [90] } }),
      paperlessLayer,
    );

    const candidates = await runWith(
      layer,
      Effect.gen(function* () {
        const service = yield* CatalogEvidenceService;
        const epoch = yield* service.buildEpoch({
          scope: ["tag"],
          createdAt: "2026-07-22T10:00:00Z",
        });
        return yield* service.blockCandidates(epoch);
      }),
    );

    expect(candidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ xEntityId: 90 })]),
    );
    expect(candidates).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ yEntityId: 90 })]),
    );
  });

  it("zero-argument Paperless adapter fails closed until a resolved policy is supplied", async () => {
    const paperless = {
      getTags: vi.fn(),
      getCorrespondents: vi.fn(),
      getDocumentTypes: vi.fn(),
      listDocumentsPage: vi.fn(),
      readTagAssignmentReceipt: vi.fn(),
      readCorrespondentAssignmentReceipt: vi.fn(),
      readDocumentTypeAssignmentReceipt: vi.fn(),
      getDocument: vi.fn(),
    } as unknown as PaperlessServiceType;
    const layer = Layer.provide(
      CatalogEvidenceReadPortFromPaperlessLive,
      Layer.succeed(PaperlessService, paperless),
    );

    await expect(
      runWith(
        layer,
        Effect.gen(function* () {
          const service = yield* CatalogEvidenceService;
          return yield* service.buildEpoch({
            scope: ["tag"],
            createdAt: "2026-07-22T10:00:00Z",
          });
        }),
      ),
    ).rejects.toThrow("requires a resolved CatalogEvidencePolicy");
  });
});
