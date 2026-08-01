/**
 * API Router tests.
 *
 * Tests for the HTTP routing and request handling layer.
 * Tests only health/root endpoints and 404 handling since other routes
 * require service dependencies.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CHAT_MAX_MESSAGES,
  CHAT_MESSAGE_MAX_LENGTH,
  USER_TEXT_MAX_LENGTH,
  apiRouteContracts,
} from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { getRegisteredRoutes, handleRequest } from "../../src/api/index.js";
import {
  MistralService,
  OllamaService,
  PaperlessService,
  QdrantService,
  type MistralService as MistralServiceType,
  type OllamaService as OllamaServiceType,
  type PaperlessService as PaperlessServiceType,
  type QdrantService as QdrantServiceType,
} from "../../src/services/index.js";

// ===========================================================================
// Mock Request/Response helpers
// ===========================================================================

function createMockRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    method,
    url,
    headers: { host: "localhost:8001", ...headers },
  } as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  return {} as ServerResponse;
}

const createHealthLayer = (overrides: {
  paperless?: () => Effect.Effect<boolean, unknown>;
  ollama?: () => Effect.Effect<boolean, unknown>;
  qdrant?: () => Effect.Effect<boolean, unknown>;
  mistral?: () => Effect.Effect<boolean, unknown>;
} = {}) =>
  Layer.mergeAll(
    Layer.succeed(PaperlessService, {
      testConnection: overrides.paperless ?? (() => Effect.succeed(true)),
    } as unknown as PaperlessServiceType),
    Layer.succeed(OllamaService, {
      testConnection: overrides.ollama ?? (() => Effect.succeed(true)),
    } as unknown as OllamaServiceType),
    Layer.succeed(QdrantService, {
      testConnection: overrides.qdrant ?? (() => Effect.succeed(true)),
    } as unknown as QdrantServiceType),
    Layer.succeed(MistralService, {
      testConnection: overrides.mistral ?? (() => Effect.succeed(true)),
    } as unknown as MistralServiceType),
  );

const runWithHealthLayer = (effect: Effect.Effect<unknown, unknown, unknown>, layer = createHealthLayer()) =>
  Effect.runPromise(Effect.provide(effect, layer));

// ===========================================================================
// Test Suites
// ===========================================================================

describe("API Router", () => {
  describe("Health Endpoints", () => {
    it("should handle GET / root endpoint", async () => {
      const req = createMockRequest("GET", "/");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toEqual({
        name: "Paperless Local LLM (TypeScript)",
        version: "0.1.0",
        status: "running",
      });
    });

    it("should handle GET /health endpoint with all dependencies up", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();

      const result = await runWithHealthLayer(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 200,
        health: "healthy",
        services: {
          paperless: { status: "up", required: true },
          ollama: { status: "up", required: false },
          qdrant: { status: "up", required: false },
          mistral: { status: "up", required: true },
        },
      });
      expect((result as { timestamp: string }).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect((result as { durationMs: number }).durationMs).toEqual(expect.any(Number));
      for (const service of Object.values(
        (result as { services: Record<string, { durationMs: number }> }).services,
      )) {
        expect(service.durationMs).toEqual(expect.any(Number));
      }
    });

    it("reports optional dependency failures without failing readiness", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();
      const layer = createHealthLayer({ qdrant: () => Effect.succeed(false) });

      const result = await runWithHealthLayer(handleRequest(req, res, null), layer);

      expect(result).toMatchObject({
        status: 200,
        health: "healthy",
        services: {
          paperless: { status: "up" },
          ollama: { status: "up" },
          qdrant: {
            status: "down",
            required: false,
            message: "Qdrant health check failed",
          },
          mistral: { status: "up" },
        },
      });
    });

    it("isolates dependency defects without leaking raw error details", async () => {
      const req = createMockRequest("GET", "/health");
      const res = createMockResponse();
      const layer = createHealthLayer({
        mistral: () => Effect.die(new Error("secret-token-stack-trace")),
      });

      const result = await runWithHealthLayer(handleRequest(req, res, null), layer);

      expect(result).toMatchObject({
        status: 503,
        health: "unhealthy",
        services: { mistral: { status: "down", message: "Mistral health check failed" } },
      });
      expect(JSON.stringify(result)).not.toContain("secret-token-stack-trace");
    });

    it("should serve generated OpenAPI from shared contracts", async () => {
      const req = createMockRequest("GET", "/openapi.json");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        openapi: "3.1.0",
        info: { title: "Paperless Local LLM API" },
        paths: {
          "/health": {
            get: {
              responses: {
                200: {
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/HealthResponse" },
                    },
                  },
                },
                503: {
                  content: {
                    "application/json": {
                      schema: { $ref: "#/components/schemas/HealthResponse" },
                    },
                  },
                },
              },
            },
          },
          "/api/pending/bulk": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/BulkPendingBody" },
                  },
                },
              },
            },
          },
          "/api/processing/{docId}/cancel": {
            post: {
              requestBody: {
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/ProcessingCancelBody" },
                  },
                },
              },
            },
          },
        },
      });
      const schemas = (result as { components?: { schemas?: Record<string, unknown> } }).components
        ?.schemas;
      expect(schemas).toHaveProperty("BulkPendingBody");
      expect(schemas).toHaveProperty("HealthResponse");
    });

    it("documents every registered backend route in the shared OpenAPI contracts", () => {
      const documentedRoutes = new Set(
        apiRouteContracts.map((route) => `${route.method} ${route.path}`),
      );
      const normalizedRegisteredRoutes = getRegisteredRoutes().map(
        (route) => `${route.method} ${route.path.replace(/:(\w+)/g, "{$1}")}`,
      );

      expect(documentedRoutes.size).toBeGreaterThanOrEqual(normalizedRegisteredRoutes.length);
      expect(normalizedRegisteredRoutes.filter((route) => !documentedRoutes.has(route))).toEqual(
        [],
      );
    });

    it("registers Paperless-first integration endpoints", () => {
      const registered = new Set(
        getRegisteredRoutes().map((route) => `${route.method} ${route.path}`),
      );

      expect([...registered]).toEqual(
        expect.arrayContaining([
          "GET /api/paperless/capabilities",
          "POST /api/analysis/runs",
          "GET /api/analysis/runs/:runId/progress",
          "POST /api/catalog/epochs",
          "GET /api/catalog/epochs/:epochId/events",
          "POST /api/catalog/proposals/:proposalId/apply",
        ]),
      );
    });

    it("serves Paperless capabilities without mutating provider state", async () => {
      const descriptor = {
        supportsOriginalContent: true,
        supportsVersionContent: true,
        supportsFullPagination: true,
        supportsBulkOperations: true,
        supportsTaskPolling: true,
        supportsNotes: true,
        supportsMutationRereads: true,
        supportsConditionalPreconditions: true,
      };
      const req = createMockRequest("GET", "/api/paperless/capabilities");
      const res = createMockResponse();
      const layer = Layer.succeed(PaperlessService, {
        capability: { descriptor },
      } as unknown as PaperlessServiceType);

      const result = await Effect.runPromise(Effect.provide(handleRequest(req, res, null), layer));

      expect(result).toEqual(descriptor);
    });

    it("hydrates custom-field labels from the live Paperless catalog", async () => {
      const getCustomFields = vi.fn(() =>
        Effect.succeed([
          { id: 36, name: "Echter Korrespondent", data_type: "string" },
          { id: 38, name: "Gesamtbetrag", data_type: "monetary" },
        ]),
      );
      const req = createMockRequest("GET", "/api/metadata/custom-fields");
      const res = createMockResponse();
      const layer = Layer.succeed(PaperlessService, {
        getCustomFields,
      } as unknown as PaperlessServiceType);

      const result = await Effect.runPromise(Effect.provide(handleRequest(req, res, null), layer));

      expect(result).toEqual([
        {
          id: 36,
          name: "Echter Korrespondent",
          data_type: "string",
          extra_data: null,
        },
        { id: 38, name: "Gesamtbetrag", data_type: "monetary", extra_data: null },
      ]);
      expect(getCustomFields).toHaveBeenCalledTimes(1);
    });
  });

  describe("Route Matching", () => {
    it("should return 404 for unknown routes", async () => {
      const req = createMockRequest("GET", "/unknown/path");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: "Not Found",
      });
    });

    it("should return 404 for wrong method", async () => {
      const req = createMockRequest("POST", "/health"); // health is GET only
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: "Not Found",
      });
    });

    it("should return 404 for deeply nested unknown path", async () => {
      const req = createMockRequest("GET", "/api/unknown/nested/path");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: "Not Found",
      });
    });

    it("should return 404 for partial path match", async () => {
      const req = createMockRequest("GET", "/api/setting"); // missing 's'
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: "Not Found",
      });
    });
  });

  describe("Special Route Handling", () => {
    it("should return error for unknown test-connection service", async () => {
      const req = createMockRequest("POST", "/api/settings/test-connection/unknown");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: "error",
        message: "Unknown service: unknown",
      });
    });

    it("should return error for invalid service names", async () => {
      const invalidServices = ["xyz", "test", "connection", ""];

      for (const service of invalidServices) {
        if (service === "") continue; // Skip empty - would not match route

        const req = createMockRequest("POST", `/api/settings/test-connection/${service}`);
        const res = createMockResponse();

        const result = await Effect.runPromise(handleRequest(req, res, null));

        expect(result).toMatchObject({
          status: "error",
          message: `Unknown service: ${service}`,
        });
      }
    });
  });

  describe("URL Parsing", () => {
    it("should handle URLs with trailing slashes as 404", async () => {
      const req = createMockRequest("GET", "/health/");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      // Trailing slash makes it a different route
      expect(result).toMatchObject({
        status: 404,
        error: "Not Found",
      });
    });

    it("should handle root path correctly", async () => {
      const req = createMockRequest("GET", "/");
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        name: "Paperless Local LLM (TypeScript)",
        status: "running",
      });
    });
  });

  describe("Validation", () => {
    it.each(["not-a-number", "0", "-1", "1.5", "9007199254740992"])(
      "rejects invalid document path parameter %s before handlers run",
      async (id) => {
        const req = createMockRequest("GET", `/api/documents/${id}`);
        const res = createMockResponse();

        const result = await Effect.runPromise(Effect.either(handleRequest(req, res, null)));

        expect(result._tag).toBe("Left");
        if (result._tag === "Left") {
          expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
        }
      },
    );

    it("rejects oversized metadata path ids before handlers run", async () => {
      const req = createMockRequest("GET", "/api/metadata/tags/9007199254740992");
      const res = createMockResponse();

      const result = await Effect.runPromise(Effect.either(handleRequest(req, res, null)));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });

    it("rejects oversized ids in request bodies at the HTTP boundary", async () => {
      const req = createMockRequest("POST", "/api/cases/questions/question-1/answer");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(
          handleRequest(req, res, {
            answer: "edit_metadata",
            metadataPatch: { tagIds: [9007199254740992] },
          }),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });

    it("rejects invalid release-lock document ids before handlers run", async () => {
      const req = createMockRequest("POST", "/api/processing/not-a-number/release-lock");
      const res = createMockResponse();

      const result = await Effect.runPromise(Effect.either(handleRequest(req, res, {})));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });

    it("rejects invalid release-lock request bodies at the HTTP boundary", async () => {
      const req = createMockRequest("POST", "/api/processing/42/release-lock");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(handleRequest(req, res, { runId: 42 })),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        const error = result.left as { _tag?: string; issues?: unknown[] };
        expect(error._tag).toBe("ValidationError");
        expect(error.issues?.length).toBeGreaterThan(0);
      }
    });

    it("rejects unknown processing steps at the HTTP boundary", async () => {
      const req = createMockRequest("POST", "/api/processing/42/start");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(handleRequest(req, res, { step: "bogus" })),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        const error = result.left as { _tag?: string; issues?: unknown[] };
        expect(error._tag).toBe("ValidationError");
        expect(error.issues?.length).toBeGreaterThan(0);
      }
    });

    it("rejects oversized chat prompts before handlers run", async () => {
      const req = createMockRequest("POST", "/api/chat");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(
          handleRequest(req, res, {
            messages: [{ role: "user", content: "x".repeat(CHAT_MESSAGE_MAX_LENGTH + 1) }],
          }),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        const error = result.left as { _tag?: string; issues?: Array<{ path?: unknown[] }> };
        expect(error._tag).toBe("ValidationError");
        expect(error.issues?.[0]?.path).toContain("content");
      }
    });

    it("rejects too many chat messages before handlers run", async () => {
      const req = createMockRequest("POST", "/api/chat");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(
          handleRequest(req, res, {
            messages: Array.from({ length: CHAT_MAX_MESSAGES + 1 }, () => ({
              role: "user",
              content: "hello",
            })),
          }),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });

    it("rejects oversized pending feedback before handlers run", async () => {
      const req = createMockRequest("POST", "/api/pending/review-1/reject");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(
          handleRequest(req, res, { feedback: "x".repeat(USER_TEXT_MAX_LENGTH + 1) }),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        const error = result.left as { _tag?: string; issues?: Array<{ path?: unknown[] }> };
        expect(error._tag).toBe("ValidationError");
        expect(error.issues?.[0]?.path).toContain("feedback");
      }
    });

    it("rejects oversized settings strings before handlers run", async () => {
      const req = createMockRequest("PATCH", "/api/settings");
      const res = createMockResponse();

      const result = await Effect.runPromise(
        Effect.either(
          handleRequest(req, res, { ollama_model: "x".repeat(USER_TEXT_MAX_LENGTH + 1) }),
        ),
      );

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });

    it("rejects oversized search queries before handlers run", async () => {
      const req = createMockRequest("GET", `/api/search?q=${"x".repeat(USER_TEXT_MAX_LENGTH + 1)}`);
      const res = createMockResponse();

      const result = await Effect.runPromise(Effect.either(handleRequest(req, res, null)));

      expect(result._tag).toBe("Left");
      if (result._tag === "Left") {
        expect((result.left as { _tag?: string })._tag).toBe("ValidationError");
      }
    });
  });
});
