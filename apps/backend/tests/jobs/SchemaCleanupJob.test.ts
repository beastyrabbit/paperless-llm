/**
 * SchemaCleanupJob tests.
 *
 * The scheduled cleanup job now delegates to the manual Pi consolidation agent.
 * It generates reviewable proposals and never mutates Paperless catalogs itself.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
  type ConsolidationReport,
  PiConsolidationAgentService,
} from "../../src/agents/PiConsolidationAgent.js";
import {
  SchemaCleanupJobService,
  SchemaCleanupJobServiceLive,
} from "../../src/jobs/SchemaCleanupJob.js";

const sampleReport = (overrides: Partial<ConsolidationReport> = {}): ConsolidationReport => ({
  id: "report-1",
  status: "ready",
  createdAt: "2026-05-12T00:00:00.000Z",
  updatedAt: "2026-05-12T00:00:00.000Z",
  summary: "1 consolidation proposal generated.",
  proposals: [
    {
      id: "proposal-1",
      action: "merge",
      attributeType: "tag",
      sourceIds: [1],
      targetId: 2,
      names: ["Invoice", "Invoices"],
      proposedName: "Invoices",
      affectedDocumentCount: 4,
      exampleDocuments: [{ id: 10, title: "Example invoice" }],
      confidence: 0.9,
      reasoning: "Names are near duplicates.",
    },
  ],
  ...overrides,
});

const createMockConsolidationAgent = (overrides: Partial<PiConsolidationAgentService> = {}) => {
  const mocks = {
    name: "consolidation_agent" as const,
    generateReport: vi.fn(() => Effect.succeed(sampleReport())),
    ...overrides,
  };

  return {
    layer: Layer.succeed(PiConsolidationAgentService, mocks as PiConsolidationAgentService),
    mocks,
  };
};

describe("SchemaCleanupJobService", () => {
  it("starts with idle status", async () => {
    const { layer } = createMockConsolidationAgent();
    const TestLayer = Layer.provideMerge(SchemaCleanupJobServiceLive, layer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* SchemaCleanupJobService;
        return yield* job.getStatus();
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.status).toBe("idle");
    expect(result.total).toBe(0);
    expect(result.processed).toBe(0);
  });

  it("generates a consolidation report without applying catalog changes", async () => {
    const report = sampleReport();
    const { layer, mocks } = createMockConsolidationAgent({
      generateReport: vi.fn(() => Effect.succeed(report)),
    });
    const TestLayer = Layer.provideMerge(SchemaCleanupJobServiceLive, layer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* SchemaCleanupJobService;
        const runResult = yield* job.run();
        const status = yield* job.getStatus();
        return { runResult, status };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(mocks.generateReport).toHaveBeenCalledTimes(1);
    expect(result.runResult).toMatchObject({
      merged: 0,
      deleted: 0,
      errors: 0,
      reportId: report.id,
      proposals: 1,
    });
    expect(result.status).toMatchObject({
      status: "completed",
      total: 1,
      processed: 1,
      merged: 0,
      deleted: 0,
    });
  });

  it("records error status when report generation fails", async () => {
    const { layer } = createMockConsolidationAgent({
      generateReport: vi.fn(() => Effect.fail(new Error("catalog unavailable"))),
    });
    const TestLayer = Layer.provideMerge(SchemaCleanupJobServiceLive, layer);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const job = yield* SchemaCleanupJobService;
        const runResult = yield* Effect.either(job.run());
        const status = yield* job.getStatus();
        return { runResult, status };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.runResult._tag).toBe("Left");
    expect(result.status.status).toBe("error");
    expect(result.status.completedAt).toBeTruthy();
  });
});
