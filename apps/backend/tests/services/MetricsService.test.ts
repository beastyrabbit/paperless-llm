import { beforeEach, describe, expect, it } from "vitest";
import {
  MetricsRegistry,
  metrics,
  metricsRegistry,
  normalizeMetricPath,
} from "../../src/services/MetricsService.js";

describe("MetricsService", () => {
  beforeEach(() => metricsRegistry.reset());

  it("renders counters and histograms in Prometheus text format", () => {
    metrics.httpRequests.inc({ method: "GET", path: "/metrics", status: "200" });
    metrics.llmRequestDuration.observe(
      { provider: "ollama", operation: "chat", model: "llama", outcome: "success" },
      0.2,
    );

    const rendered = metricsRegistry.render();

    expect(rendered).toContain("# TYPE paperless_llm_http_requests_total counter");
    expect(rendered).toContain(
      'paperless_llm_http_requests_total{method="GET",path="/metrics",status="200"} 1',
    );
    expect(rendered).toContain(
      'paperless_llm_llm_request_duration_seconds_count{provider="ollama",operation="chat",model="llama",outcome="success"} 1',
    );
    expect(rendered).toContain(
      'paperless_llm_llm_request_duration_seconds_bucket{provider="ollama",operation="chat",model="llama",outcome="success",le="0.5"} 1',
    );
  });

  it("escapes label values and resets observations", () => {
    const registry = new MetricsRegistry();
    const counter = registry.counter("test_counter_total", "test help", ["label"]);
    counter.inc({ label: 'line\\n"quoted"' });

    expect(registry.render()).toContain('test_counter_total{label="line\\\\n\\"quoted\\""} 1');
    registry.reset();
    expect(registry.render()).not.toContain("test_counter_total{");
  });

  it("normalizes dynamic backend route labels without exposing IDs", () => {
    expect(normalizeMetricPath("/api/pending/review-abc123")).toBe("/api/pending/:id");
    expect(normalizeMetricPath("/api/cases/case_01HQ8XYZ")).toBe("/api/cases/:caseId");
    expect(normalizeMetricPath("/api/cases/questions/question-9/answer")).toBe(
      "/api/cases/questions/:questionId/answer",
    );
    expect(normalizeMetricPath("/api/catalog/runs/run_01HQ8XYZ/stream")).toBe(
      "/api/catalog/runs/:runId/stream",
    );
    expect(normalizeMetricPath("/api/catalog/proposals/proposal_123/decision")).toBe(
      "/api/catalog/proposals/:proposalId/decision",
    );
    expect(normalizeMetricPath("/api/documents/123/pdf")).toBe("/api/documents/:id/pdf");
    expect(normalizeMetricPath("/api/metadata/tags/42/translations/fr")).toBe(
      "/api/metadata/tags/:tagId/translations/:lang",
    );
    expect(normalizeMetricPath("/api/search/index/987")).toBe("/api/search/index/:docId");
    expect(normalizeMetricPath("/api/settings/test-connection/ollama")).toBe(
      "/api/settings/test-connection/:service",
    );
  });

  it("keeps static routes that share prefixes with dynamic routes", () => {
    expect(normalizeMetricPath("/api/pending/counts")).toBe("/api/pending/counts");
    expect(normalizeMetricPath("/api/documents/pending")).toBe("/api/documents/pending");
    expect(normalizeMetricPath("/api/metadata/tags/bulk")).toBe("/api/metadata/tags/bulk");
    expect(normalizeMetricPath("/api/schema/blocked/check")).toBe(
      "/api/schema/blocked/check",
    );
  });

  it("renders HTTP metric labels with normalized paths only", () => {
    const pendingPath = normalizeMetricPath("/api/pending/review-secret-123");
    const runStreamPath = normalizeMetricPath("/api/catalog/runs/run-secret-123/stream");

    metrics.httpRequests.inc({ method: "GET", path: pendingPath, status: "200" });
    metrics.httpRequests.inc({ method: "GET", path: runStreamPath, status: "200" });
    metrics.httpRequestDuration.observe(
      { method: "GET", path: pendingPath, status: "200" },
      0.01,
    );

    const rendered = metricsRegistry.render();

    expect(rendered).toContain(
      'paperless_llm_http_requests_total{method="GET",path="/api/pending/:id",status="200"} 1',
    );
    expect(rendered).toContain(
      'paperless_llm_http_requests_total{method="GET",path="/api/catalog/runs/:runId/stream",status="200"} 1',
    );
    expect(rendered).toContain(
      'paperless_llm_http_request_duration_seconds_count{method="GET",path="/api/pending/:id",status="200"} 1',
    );
    expect(rendered).not.toContain("review-secret-123");
    expect(rendered).not.toContain("run-secret-123");
  });
});
