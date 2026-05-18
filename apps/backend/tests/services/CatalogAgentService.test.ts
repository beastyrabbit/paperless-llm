/**
 * Catalog agent service tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiConsolidationAgentService } from "../../src/agents/PiConsolidationAgent.js";
import { ConfigService } from "../../src/config/index.js";
import {
  CatalogAgentService,
  CatalogAgentServiceLive,
  LockService,
  PaperlessService,
  TinyBaseService,
  TinyBaseServiceLive,
} from "../../src/services/index.js";

const createConfigLayer = () =>
  Layer.succeed(ConfigService, {
    config: {
      tags: {
        todo: "ai-processing",
        ocr: "ai-processing",
        metadata: "ai-processing",
        review: "ai-needs-input",
        index: "ai-processing",
        done: "ai-done",
        failed: "ai-failed",
      },
    },
  } as unknown as ConfigService);

const createLockLayer = () => {
  const mocks = {
    acquire: vi.fn(() =>
      Effect.succeed({
        acquired: true,
        staleRecovered: false,
        lock: {
          id: "catalog:global",
          scope: "catalog" as const,
          resourceId: "global",
          owner: "catalog_agent",
          runId: "catalog-run-1",
          acquiredAt: "2026-05-13T10:00:00Z",
          heartbeatAt: "2026-05-13T10:00:00Z",
          expiresAt: "2026-05-13T10:15:00Z",
          metadata: {},
        },
      }),
    ),
    release: vi.fn(() => Effect.succeed(true)),
    get: vi.fn(() => Effect.succeed(null)),
    heartbeat: vi.fn(() => Effect.succeed(null)),
    list: vi.fn(() => Effect.succeed([])),
    pruneStale: vi.fn(() => Effect.succeed(0)),
  };
  return {
    layer: Layer.succeed(LockService, mocks as unknown as LockService),
    mocks,
  };
};

const createPaperlessLayer = () => {
  const mocks = {
    getTags: vi.fn(() =>
      Effect.succeed([
        { id: 1, name: "Unused Tag", slug: "unused-tag", document_count: 0 },
        { id: 2, name: "ai-processing", slug: "ai-processing", document_count: 0 },
        { id: 3, name: "Insurance", slug: "insurance", document_count: 5 },
      ]),
    ),
    getCorrespondents: vi.fn(() =>
      Effect.succeed([
        { id: 10, name: "Rundfunkbeitrag", slug: "rundfunkbeitrag", document_count: 6 },
        { id: 11, name: "SWR", slug: "swr", document_count: 2 },
        { id: 12, name: "Unused Sender", slug: "unused-sender", document_count: 0 },
        { id: 13, name: "COURTYARD BY MARRIOTT", slug: "courtyard", document_count: 3 },
        {
          id: 14,
          name: "Polsterwelt Engelhardt",
          slug: "polsterwelt-engelhardt",
          document_count: 1,
        },
      ]),
    ),
    getDocumentTypes: vi.fn(() =>
      Effect.succeed([{ id: 20, name: "Unused Type", slug: "unused-type", document_count: 0 }]),
    ),
    getCustomFields: vi.fn(() =>
      Effect.succeed([{ id: 30, name: "Invoice Number", data_type: "string" }]),
    ),
    deleteTag: vi.fn(() => Effect.succeed(undefined)),
    deleteCorrespondent: vi.fn(() => Effect.succeed(undefined)),
    deleteDocumentType: vi.fn(() => Effect.succeed(undefined)),
    mergeTags: vi.fn(() => Effect.succeed(undefined)),
    mergeCorrespondents: vi.fn(() => Effect.succeed(undefined)),
    mergeDocumentTypes: vi.fn(() => Effect.succeed(undefined)),
    renameTag: vi.fn((id: number, name: string) => Effect.succeed({ id, name, slug: name })),
    renameCorrespondent: vi.fn((id: number, name: string) =>
      Effect.succeed({ id, name, slug: name }),
    ),
    renameDocumentType: vi.fn((id: number, name: string) =>
      Effect.succeed({ id, name, slug: name }),
    ),
  };
  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

const createConsolidationLayer = () => {
  const mocks = {
    name: "consolidation_agent" as const,
    generateReport: vi.fn(() =>
      Effect.succeed({
        id: "report-1",
        status: "ready" as const,
        summary: "Pi reviewed the catalog.",
        createdAt: "2026-05-13T10:00:00Z",
        updatedAt: "2026-05-13T10:00:00Z",
        proposals: [
          {
            id: "proposal-from-pi-1",
            action: "merge" as const,
            attributeType: "correspondent" as const,
            sourceIds: [11],
            targetId: 10,
            names: ["SWR", "Rundfunkbeitrag"],
            proposedName: "Rundfunkbeitrag",
            affectedDocumentCount: 8,
            exampleDocuments: [{ id: 200, title: "Rundfunkbeitrag 2025" }],
            confidence: 0.84,
            reasoning: "The Pi agent found shared account wording across these correspondents.",
          },
        ],
      }),
    ),
  };
  return {
    layer: Layer.succeed(
      PiConsolidationAgentService,
      mocks as unknown as PiConsolidationAgentService,
    ),
    mocks,
  };
};

describe("CatalogAgentService", () => {
  let testDataDir: string | null = null;

  const createTestLayer = () => {
    const locks = createLockLayer();
    const paperless = createPaperlessLayer();
    const consolidation = createConsolidationLayer();
    const layer = Layer.provideMerge(
      CatalogAgentServiceLive,
      Layer.mergeAll(
        TinyBaseServiceLive,
        locks.layer,
        paperless.layer,
        consolidation.layer,
        createConfigLayer(),
      ),
    );
    return {
      layer,
      locks: locks.mocks,
      paperless: paperless.mocks,
      consolidation: consolidation.mocks,
    };
  };

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "catalog-agent-service-test-"));
    process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"] = testDataDir;
    process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"] = "true";
  });

  afterEach(() => {
    delete process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"];
    delete process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"];
    if (testDataDir) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
      testDataDir = null;
    }
  });

  it("persists proposals returned by the Pi consolidation agent without mutating Paperless", async () => {
    const { layer, locks, paperless, consolidation } = createTestLayer();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogAgentService;
        const run = yield* catalog.startRun();
        const proposals = yield* catalog.listProposals(run.id);
        return { run, proposals };
      }).pipe(Effect.provide(layer)),
    );

    expect(result.run.status).toBe("completed");
    expect(result.run.runtime).toBe("pi_agent");
    expect(result.run.summary).toContain("Pi catalog agent created 1 review proposal");
    expect(result.run.summary).toContain("No Paperless changes were applied");
    expect(result.proposals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "merge",
          entityKind: "correspondent",
          entityId: 11,
          entityName: "SWR",
          targetEntityId: 10,
          targetEntityName: "Rundfunkbeitrag",
        }),
      ]),
    );
    expect(consolidation.generateReport).toHaveBeenCalledWith({ persist: false });
    expect(paperless.deleteTag).not.toHaveBeenCalled();
    expect(paperless.deleteCorrespondent).not.toHaveBeenCalled();
    expect(paperless.deleteDocumentType).not.toHaveBeenCalled();
    expect(paperless.mergeCorrespondents).not.toHaveBeenCalled();
    expect(locks.release).toHaveBeenCalledWith("catalog", "global", "catalog-run-1");
  });

  it("routes legacy runtime requests through the Pi consolidation agent", async () => {
    const { layer, locks, consolidation } = createTestLayer();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogAgentService;
        return yield* catalog.startRun({ runtime: "openai_cli" });
      }).pipe(Effect.provide(layer)),
    );

    expect(result.runtime).toBe("pi_agent");
    expect(consolidation.generateReport).toHaveBeenCalledWith({ persist: false });
    expect(locks.acquire).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          requestedRuntime: "openai_cli",
          runtime: "pi_agent",
        }),
      }),
    );
  });

  it("rechecks usage before applying delete-unused proposals", async () => {
    const { layer, paperless } = createTestLayer();
    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const catalog = yield* CatalogAgentService;
        const tinybase = yield* TinyBaseService;
        tinybase.store.setRow("catalogProposals", "legacy-delete", {
          id: "legacy-delete",
          runId: "catalog-run-legacy",
          type: "delete_unused",
          entityKind: "tag",
          entityId: 1,
          entityName: "Unused Tag",
          targetEntityId: "",
          targetEntityName: "",
          reason: "Legacy delete-unused proposal.",
          confidence: 0.9,
          usageCount: 0,
          customFieldMode: "",
          payload: "{}",
          status: "approved",
          createdAt: "2026-05-13T10:00:00Z",
          updatedAt: "2026-05-13T10:00:00Z",
        });
        paperless.getTags.mockReturnValue(
          Effect.succeed([
            { id: 1, name: "Unused Tag", slug: "unused-tag", document_count: 2 },
            { id: 2, name: "ai-processing", slug: "ai-processing", document_count: 0 },
            { id: 3, name: "Insurance", slug: "insurance", document_count: 5 },
          ]),
        );
        return yield* Effect.flip(catalog.applyProposal("legacy-delete"));
      }).pipe(Effect.provide(layer)),
    );

    expect(error).toMatchObject({
      _tag: "AgentError",
      message: expect.stringContaining("now has 2 document"),
    });
    expect(paperless.deleteTag).not.toHaveBeenCalled();
  });
});
