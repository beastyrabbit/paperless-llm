import { apiRouteContracts } from "@repo/api-contracts";

type LabelValue = string | number | boolean;
export type MetricLabels = Record<string, LabelValue>;

type MetricKind = "counter" | "histogram";

interface BaseMetric {
  readonly name: string;
  readonly help: string;
  readonly labelNames: readonly string[];
  readonly kind: MetricKind;
}

interface CounterMetric extends BaseMetric {
  readonly kind: "counter";
  values: Map<string, number>;
}

interface HistogramMetric extends BaseMetric {
  readonly kind: "histogram";
  readonly buckets: readonly number[];
  values: Map<string, { buckets: number[]; count: number; sum: number }>;
}

const DEFAULT_HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const PIPELINE_BUCKETS = [0.1, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600];

const escapeLabelValue = (value: LabelValue): string =>
  String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');

const formatNumber = (value: number): string => {
  if (value === Number.POSITIVE_INFINITY) return "+Inf";
  return Number.isInteger(value) ? String(value) : String(value);
};

const keyFor = (labelNames: readonly string[], labels: MetricLabels): string =>
  labelNames.map((name) => `${name}=${String(labels[name] ?? "")}`).join("\u0001");

const renderLabels = (labelNames: readonly string[], labels: MetricLabels): string => {
  if (labelNames.length === 0) return "";
  return `{${labelNames.map((name) => `${name}="${escapeLabelValue(labels[name] ?? "")}"`).join(",")}}`;
};

const labelsFromKey = (labelNames: readonly string[], key: string): MetricLabels => {
  const parts = key ? key.split("\u0001") : [];
  const labels: MetricLabels = {};
  for (let index = 0; index < labelNames.length; index++) {
    const part = parts[index] ?? `${labelNames[index]}=`;
    labels[labelNames[index] ?? ""] = part.slice(part.indexOf("=") + 1);
  }
  return labels;
};

export class MetricsRegistry {
  private readonly metrics = new Map<string, CounterMetric | HistogramMetric>();

  counter(name: string, help: string, labelNames: readonly string[] = []) {
    const metric = this.getOrCreateCounter(name, help, labelNames);
    return {
      inc: (labels: MetricLabels = {}, value = 1) => this.increment(metric, labels, value),
    };
  }

  histogram(
    name: string,
    help: string,
    labelNames: readonly string[] = [],
    buckets: readonly number[] = DEFAULT_HTTP_BUCKETS,
  ) {
    const metric = this.getOrCreateHistogram(name, help, labelNames, buckets);
    return {
      observe: (labels: MetricLabels = {}, value: number) => this.observe(metric, labels, value),
    };
  }

  reset(): void {
    for (const metric of this.metrics.values()) {
      metric.values.clear();
    }
  }

  render(): string {
    const lines: string[] = [];
    for (const metric of [...this.metrics.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.kind}`);
      if (metric.kind === "counter") {
        for (const [key, value] of [...metric.values.entries()].sort()) {
          lines.push(`${metric.name}${renderLabels(metric.labelNames, labelsFromKey(metric.labelNames, key))} ${formatNumber(value)}`);
        }
      } else {
        for (const [key, value] of [...metric.values.entries()].sort()) {
          const labels = labelsFromKey(metric.labelNames, key);
          for (let index = 0; index < metric.buckets.length; index++) {
            lines.push(`${metric.name}_bucket${renderLabels([...metric.labelNames, "le"], { ...labels, le: metric.buckets[index] ?? "" })} ${value.buckets[index] ?? 0}`);
          }
          lines.push(`${metric.name}_bucket${renderLabels([...metric.labelNames, "le"], { ...labels, le: "+Inf" })} ${value.count}`);
          lines.push(`${metric.name}_sum${renderLabels(metric.labelNames, labels)} ${formatNumber(value.sum)}`);
          lines.push(`${metric.name}_count${renderLabels(metric.labelNames, labels)} ${value.count}`);
        }
      }
    }
    return `${lines.join("\n")}\n`;
  }

  private getOrCreateCounter(
    name: string,
    help: string,
    labelNames: readonly string[],
  ): CounterMetric {
    const existing = this.metrics.get(name);
    if (existing) return existing as CounterMetric;
    const metric: CounterMetric = { name, help, labelNames, kind: "counter", values: new Map() };
    this.metrics.set(name, metric);
    return metric;
  }

  private getOrCreateHistogram(
    name: string,
    help: string,
    labelNames: readonly string[],
    buckets: readonly number[],
  ): HistogramMetric {
    const existing = this.metrics.get(name);
    if (existing) return existing as HistogramMetric;
    const metric: HistogramMetric = {
      name,
      help,
      labelNames,
      kind: "histogram",
      buckets: [...buckets].sort((a, b) => a - b),
      values: new Map(),
    };
    this.metrics.set(name, metric);
    return metric;
  }

  private increment(metric: CounterMetric, labels: MetricLabels, value: number): void {
    const key = keyFor(metric.labelNames, labels);
    metric.values.set(key, (metric.values.get(key) ?? 0) + value);
  }

  private observe(metric: HistogramMetric, labels: MetricLabels, value: number): void {
    const key = keyFor(metric.labelNames, labels);
    const entry = metric.values.get(key) ?? {
      buckets: metric.buckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    for (let index = 0; index < metric.buckets.length; index++) {
      if (value <= (metric.buckets[index] ?? Number.POSITIVE_INFINITY)) {
        entry.buckets[index] = (entry.buckets[index] ?? 0) + 1;
      }
    }
    entry.count += 1;
    entry.sum += value;
    metric.values.set(key, entry);
  }
}

export const metricsRegistry = new MetricsRegistry();

const escapeRoutePatternSegment = (segment: string): string =>
  segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const staticMetricPaths = new Set(
  apiRouteContracts.filter((route) => !route.path.includes("{")).map((route) => route.path),
);

const metricPathPatterns = apiRouteContracts
  .filter((route) => route.path.includes("{"))
  .map((route) => {
    const normalizedPath = route.path.replace(/\{(\w+)\}/g, ":$1");
    const pattern = new RegExp(
      `^${route.path
        .split("/")
        .map((segment) => (segment.startsWith("{") && segment.endsWith("}") ? "[^/]+" : escapeRoutePatternSegment(segment)))
        .join("/")}$`,
    );
    return { pattern, normalizedPath };
  });

export const normalizeMetricPath = (path: string): string => {
  if (staticMetricPaths.has(path)) return path;

  for (const { pattern, normalizedPath } of metricPathPatterns) {
    if (pattern.test(path)) return normalizedPath;
  }
  return path;
};

export const classifyMetricsErrorOutcome = (error: unknown): "timeout" | "error" =>
  /timeout|timed out|AbortError|HttpTimeoutError/i.test(error instanceof Error ? error.message : String(error))
    ? "timeout"
    : "error";

export const metricReasonFromError = (error: { statusCode?: number } | unknown): string => {
  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : undefined;
  if (statusCode) return `http_${statusCode}`;
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|timed out|AbortError|HttpTimeoutError/i.test(message)) return "timeout";
  return "error";
};

export const metrics = {
  httpRequests: metricsRegistry.counter("paperless_llm_http_requests_total", "HTTP requests handled by the backend.", ["method", "path", "status"]),
  httpRequestDuration: metricsRegistry.histogram("paperless_llm_http_request_duration_seconds", "HTTP request duration in seconds.", ["method", "path", "status"]),
  pipelinePhaseStarted: metricsRegistry.counter("paperless_llm_pipeline_phase_started_total", "Pipeline phase starts.", ["phase", "mode"]),
  pipelinePhaseCompleted: metricsRegistry.counter("paperless_llm_pipeline_phase_completed_total", "Pipeline phase completions by outcome.", ["phase", "outcome", "mode"]),
  pipelinePhaseDuration: metricsRegistry.histogram("paperless_llm_pipeline_phase_duration_seconds", "Pipeline phase duration in seconds.", ["phase", "outcome", "mode"], PIPELINE_BUCKETS),
  pipelineErrors: metricsRegistry.counter("paperless_llm_pipeline_errors_total", "Pipeline errors by bounded classification.", ["phase", "kind", "retryable"]),
  retries: metricsRegistry.counter("paperless_llm_retries_total", "Retries by component, operation, and reason.", ["component", "operation", "reason"]),
  llmRequestDuration: metricsRegistry.histogram("paperless_llm_llm_request_duration_seconds", "LLM and OCR request duration in seconds.", ["provider", "operation", "model", "outcome"], PIPELINE_BUCKETS),
};

export const observeDuration = (startedAt: number): number => (Date.now() - startedAt) / 1000;
