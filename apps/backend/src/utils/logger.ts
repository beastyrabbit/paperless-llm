type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
type ConfiguredLogLevel = LogLevel | "silent";

type LogContext = Record<string, unknown>;

interface LogSink {
  write: (line: string) => void;
}

interface LoggerOptions {
  service?: string;
  sink?: LogSink;
  errorSink?: LogSink;
  now?: () => Date;
  base?: LogContext;
  minLevel?: ConfiguredLogLevel;
}

export interface StructuredLogger {
  readonly child: (context: LogContext) => StructuredLogger;
  readonly debug: (message: string, context?: LogContext) => void;
  readonly info: (message: string, context?: LogContext) => void;
  readonly warn: (message: string, context?: LogContext) => void;
  readonly error: (message: string, context?: LogContext) => void;
  readonly fatal: (message: string, context?: LogContext) => void;
}

const secretKeyPattern =
  /authorization|api[-_]?key|token|secret|password|passwd|cookie|set-cookie|credential/i;

const logLevelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  fatal: 50,
};

const parseLogLevel = (value: string | undefined): ConfiguredLogLevel => {
  switch (value?.toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "fatal":
    case "silent":
      return value.toLowerCase() as ConfiguredLogLevel;
    default:
      return "info";
  }
};

const redactValue = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Date) return value.toISOString();
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) {
    const redactedArray = value.map((entry) => redactValue(entry, seen));
    seen.delete(value);
    return redactedArray;
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = secretKeyPattern.test(key) ? "***" : redactValue(entry, seen);
  }
  seen.delete(value);
  return redacted;
};

export const serializeError = (error: unknown): Record<string, unknown> => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }
  return { message: String(error) };
};

export const createLogger = (options: LoggerOptions = {}): StructuredLogger => {
  const service = options.service ?? "paperless-local-llm-backend";
  const sink = options.sink ?? { write: (line) => process.stdout.write(`${line}\n`) };
  const errorSink = options.errorSink ?? { write: (line) => process.stderr.write(`${line}\n`) };
  const now = options.now ?? (() => new Date());
  const base = options.base ?? {};
  const minLevel = options.minLevel ?? parseLogLevel(process.env["PAPERLESS_LLM_LOG_LEVEL"]);

  const log = (level: LogLevel, message: string, context: LogContext = {}) => {
    if (minLevel === "silent") return;
    if (logLevelPriority[level] < logLevelPriority[minLevel]) return;

    const entry = redactValue({
      timestamp: now().toISOString(),
      level,
      service,
      message,
      ...base,
      ...context,
    });
    const line = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      errorSink.write(line);
    } else {
      sink.write(line);
    }
  };

  return {
    child: (context) => createLogger({ ...options, base: { ...base, ...context } }),
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
    fatal: (message, context) => log("fatal", message, context),
  };
};

export const logger = createLogger();
