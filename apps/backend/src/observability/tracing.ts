import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { type Context, Effect, Exit, Layer, Option, Tracer } from "effect";

export type TraceSink = "none" | "console" | "jsonl" | "memory" | "otlp";

export interface TracingConfig {
  readonly enabled: boolean;
  readonly sink: TraceSink;
  readonly serviceName: string;
  readonly otlpEndpoint?: string;
  readonly jsonlPath?: string;
  readonly exportIntervalMs: number;
}

export interface RecordedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: Tracer.SpanKind;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly durationMs: number;
  readonly status: "ok" | "error";
  readonly attributes: Record<string, unknown>;
}

const truthy = new Set(["1", "true", "yes", "on"]);
const allowedSinks = new Set<TraceSink>(["none", "console", "jsonl", "memory", "otlp"]);
const memorySpans: RecordedSpan[] = [];

const randomHex = (bytes: number): string => randomBytes(bytes).toString("hex");

const boolEnv = (value: string | undefined): boolean =>
  truthy.has(value?.trim().toLowerCase() ?? "");

export const parseTracingConfig = (env: NodeJS.ProcessEnv = process.env): TracingConfig => {
  const enabled = boolEnv(env["PAPERLESS_LLM_TRACING_ENABLED"] ?? env["OTEL_TRACES_ENABLED"]);
  const rawSink = (
    env["PAPERLESS_LLM_TRACE_SINK"] ??
    (env["PAPERLESS_LLM_OTLP_ENDPOINT"] || env["OTEL_EXPORTER_OTLP_ENDPOINT"] ? "otlp" : "none")
  )
    .trim()
    .toLowerCase();
  const sink = allowedSinks.has(rawSink as TraceSink) ? (rawSink as TraceSink) : "none";
  const parsedInterval = Number.parseInt(
    env["PAPERLESS_LLM_OTLP_EXPORT_INTERVAL_MS"] ?? "5000",
    10,
  );

  return {
    enabled,
    sink,
    serviceName:
      env["OTEL_SERVICE_NAME"] ??
      env["PAPERLESS_LLM_TRACE_SERVICE_NAME"] ??
      "paperless-local-llm-backend",
    otlpEndpoint: env["PAPERLESS_LLM_OTLP_ENDPOINT"] ?? env["OTEL_EXPORTER_OTLP_ENDPOINT"],
    jsonlPath: env["PAPERLESS_LLM_TRACE_JSONL_PATH"],
    exportIntervalMs: Number.isFinite(parsedInterval) && parsedInterval > 0 ? parsedInterval : 5000,
  };
};

const forbiddenKeyPattern =
  /(authorization|cookie|x-api-key|api[-_]?key|token|secret|password|credential|prompt|message|messages|content|body|args|result|pdf|base64|image|embedding|embeddings|vector|payload|document[_-]?content)/i;
const dangerousOcrKeyPattern =
  /^ocr[._-].*(text(?!_length)|content|body|args?|results?|payload|pdf|base64|image|document|prompt|messages?|tokens?)/i;
const safeOcrAttributeKeys = new Set([
  "ocr.pages",
  "ocr.text_length",
  "ocr.outcome",
  "ocr.mock",
  "ocr.force",
]);
const allowedScalarTypes = new Set(["string", "number", "boolean"]);

const sanitizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (allowedScalarTypes.has(typeof value)) {
    if (typeof value === "string" && value.length > 256) return `${value.slice(0, 253)}...`;
    return value;
  }
  return String(value);
};

export const sanitizeTraceAttributes = (
  attributes: Record<string, unknown> | ReadonlyMap<string, unknown> | undefined,
): Record<string, unknown> => {
  const entries =
    attributes instanceof Map ? attributes.entries() : Object.entries(attributes ?? {});
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!safeOcrAttributeKeys.has(key) && (forbiddenKeyPattern.test(key) || dangerousOcrKeyPattern.test(key))) {
      sanitized[key] = "[REDACTED]";
      continue;
    }
    sanitized[key] = sanitizeValue(value);
  }
  return sanitized;
};

class LocalSpan implements Tracer.Span {
  readonly _tag = "Span" as const;
  readonly spanId = randomHex(8);
  readonly traceId: string;
  readonly sampled = true;
  readonly attributes = new Map<string, unknown>();
  readonly links: ReadonlyArray<Tracer.SpanLink>;
  status: Tracer.SpanStatus;

  constructor(
    readonly name: string,
    readonly parent: Option.Option<Tracer.AnySpan>,
    readonly context: Context.Context<never>,
    links: ReadonlyArray<Tracer.SpanLink>,
    startTime: bigint,
    readonly kind: Tracer.SpanKind,
    private readonly emit: (span: RecordedSpan) => void,
  ) {
    this.traceId = Option.isSome(parent) ? parent.value.traceId : randomHex(16);
    this.links = Array.from(links);
    this.status = { _tag: "Started", startTime };
  }

  end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    if (this.status._tag === "Ended") return;
    const startTime = this.status.startTime;
    this.status = { _tag: "Ended", startTime, endTime, exit };
    this.emit({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: Option.isSome(this.parent) ? this.parent.value.spanId : undefined,
      name: this.name,
      kind: this.kind,
      startTimeUnixNano: startTime.toString(),
      endTimeUnixNano: endTime.toString(),
      durationMs: Number(endTime - startTime) / 1_000_000,
      status: Exit.isSuccess(exit) ? "ok" : "error",
      attributes: sanitizeTraceAttributes(this.attributes),
    });
  }

  attribute(key: string, value: unknown): void {
    this.attributes.set(key, value);
  }

  event(name: string, _startTime: bigint, attributes?: Record<string, unknown>): void {
    this.attributes.set(`event.${name}`, sanitizeTraceAttributes(attributes));
  }

  addLinks(_links: ReadonlyArray<Tracer.SpanLink>): void {
    // Links are intentionally not exported by the local sink to keep output small and sanitized.
  }
}

export const getMemoryTraceSpans = (): ReadonlyArray<RecordedSpan> => memorySpans;
export const clearMemoryTraceSpans = (): void => {
  memorySpans.length = 0;
};

const makeEmitter = (config: TracingConfig): ((span: RecordedSpan) => void) => {
  switch (config.sink) {
    case "console":
      return (span) => console.log(JSON.stringify({ service: config.serviceName, ...span }));
    case "jsonl":
      return (span) => {
        if (!config.jsonlPath) return;
        appendFileSync(
          config.jsonlPath,
          `${JSON.stringify({ service: config.serviceName, ...span })}\n`,
        );
      };
    case "memory":
      return (span) => {
        memorySpans.push(span);
      };
    case "otlp":
      return (span) =>
        console.log(
          JSON.stringify({
            service: config.serviceName,
            sink: "otlp-compatible-local",
            endpoint: config.otlpEndpoint,
            ...span,
          }),
        );
    default:
      return () => undefined;
  }
};

export const makeLocalTracer = (config: TracingConfig): Tracer.Tracer => {
  const emit = makeEmitter(config);
  return Tracer.make({
    span: (name, parent, context, links, startTime, kind, options) => {
      const span = new LocalSpan(name, parent, context, links, startTime, kind, emit);
      for (const [key, value] of Object.entries(sanitizeTraceAttributes(options?.attributes))) {
        span.attribute(key, value);
      }
      return span;
    },
    context: (f) => f(),
  });
};

export const makeTracingLayer = (
  config: TracingConfig = parseTracingConfig(),
): Layer.Layer<never> => {
  if (!config.enabled || config.sink === "none") {
    return Layer.setTracerEnabled(false);
  }
  return Layer.mergeAll(
    Layer.setTracer(makeLocalTracer(config)),
    Layer.setTracerEnabled(true),
    Layer.setTracerTiming(true),
  );
};

export const TracingLayer = makeTracingLayer();

const withSpan = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  name: string,
  kind: Tracer.SpanKind,
  attributes?: Record<string, unknown>,
): Effect.Effect<A, E, Exclude<R, Tracer.ParentSpan>> =>
  Effect.withSpan(effect, name, { kind, attributes: sanitizeTraceAttributes(attributes) });

export const withInternalSpan =
  <A, E, R>(
    name: string,
    attributes?: Record<string, unknown>,
  ): ((effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Tracer.ParentSpan>>) =>
  (effect) =>
    withSpan(effect, name, "internal", attributes);

export const withClientSpan =
  <A, E, R>(
    name: string,
    attributes?: Record<string, unknown>,
  ): ((effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Tracer.ParentSpan>>) =>
  (effect) =>
    withSpan(effect, name, "client", attributes);

export const withServerSpan =
  <A, E, R>(
    name: string,
    attributes?: Record<string, unknown>,
  ): ((effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Tracer.ParentSpan>>) =>
  (effect) =>
    withSpan(effect, name, "server", attributes);

export const annotateSpan = (attributes: Record<string, unknown>): Effect.Effect<void> =>
  Effect.annotateCurrentSpan(sanitizeTraceAttributes(attributes));
