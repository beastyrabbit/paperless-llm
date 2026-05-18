import { describe, expect, it, beforeEach } from "vitest";
import { Effect, Layer } from "effect";
import {
  clearMemoryTraceSpans,
  getMemoryTraceSpans,
  makeTracingLayer,
  parseTracingConfig,
  sanitizeTraceAttributes,
  withClientSpan,
} from "../../src/observability/tracing.js";

describe("tracing", () => {
  beforeEach(() => clearMemoryTraceSpans());

  it("is disabled by default", () => {
    const config = parseTracingConfig({});

    expect(config.enabled).toBe(false);
    expect(config.sink).toBe("none");
  });

  it("parses OTLP-compatible config when explicitly enabled", () => {
    const config = parseTracingConfig({
      PAPERLESS_LLM_TRACING_ENABLED: "true",
      PAPERLESS_LLM_TRACE_SINK: "otlp",
      PAPERLESS_LLM_OTLP_ENDPOINT: "http://localhost:4318",
      PAPERLESS_LLM_TRACE_SERVICE_NAME: "paperless-test",
      PAPERLESS_LLM_OTLP_EXPORT_INTERVAL_MS: "1000",
    });

    expect(config).toMatchObject({
      enabled: true,
      sink: "otlp",
      otlpEndpoint: "http://localhost:4318",
      serviceName: "paperless-test",
      exportIntervalMs: 1000,
    });
  });

  it("sanitizes forbidden attributes", () => {
    const sanitized = sanitizeTraceAttributes({
      Authorization: "Bearer secret",
      prompt: "summarize this document",
      content: "ocr text",
      embedding: [1, 2, 3],
      "http.request.method": "GET",
      "url.path": "/api/documents/:id",
    });

    expect(sanitized).toMatchObject({
      Authorization: "[REDACTED]",
      prompt: "[REDACTED]",
      content: "[REDACTED]",
      embedding: "[REDACTED]",
      "http.request.method": "GET",
      "url.path": "/api/documents/:id",
    });
  });

  it("keeps safe OCR summary attributes and redacts OCR content attributes", () => {
    const sanitized = sanitizeTraceAttributes({
      "ocr.pages": 3,
      "ocr.text_length": 1200,
      "ocr.outcome": "success",
      "ocr.mock": false,
      "ocr.force": true,
      "ocr.text": "raw document text",
      "ocr.raw_text": "raw document text",
      "ocr.content": "raw OCR content",
      "ocr.document_content": "raw document content",
      "ocr.pdf_base64": "JVBERi0xLjQ=",
      "ocr.payload": { image: "base64" },
      "document_content": "raw document text",
    });

    expect(sanitized).toMatchObject({
      "ocr.pages": 3,
      "ocr.text_length": 1200,
      "ocr.outcome": "success",
      "ocr.mock": false,
      "ocr.force": true,
      "ocr.text": "[REDACTED]",
      "ocr.raw_text": "[REDACTED]",
      "ocr.content": "[REDACTED]",
      "ocr.document_content": "[REDACTED]",
      "ocr.pdf_base64": "[REDACTED]",
      "ocr.payload": "[REDACTED]",
      "document_content": "[REDACTED]",
    });
  });

  it("records sanitized spans to the memory sink", async () => {
    const layer = makeTracingLayer({
      enabled: true,
      sink: "memory",
      serviceName: "test",
      exportIntervalMs: 1000,
    });

    await Effect.runPromise(
      Effect.succeed("ok").pipe(
        withClientSpan("client.call", {
          "peer.service": "ollama",
          prompt: "do not record me",
          "url.path": "/api/chat",
        }),
        Effect.provide(Layer.mergeAll(layer)),
      ),
    );

    expect(getMemoryTraceSpans()).toHaveLength(1);
    expect(getMemoryTraceSpans()[0]).toMatchObject({
      name: "client.call",
      kind: "client",
      status: "ok",
      attributes: {
        "peer.service": "ollama",
        prompt: "[REDACTED]",
        "url.path": "/api/chat",
      },
    });
  });
});
