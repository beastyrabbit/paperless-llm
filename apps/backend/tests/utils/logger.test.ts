import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/utils/logger.js";

describe("structured logger", () => {
  it("emits structured JSON with child context", () => {
    const lines: string[] = [];
    const log = createLogger({
      service: "test-service",
      sink: { write: (line) => lines.push(line) },
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      base: { component: "root", requestId: "req-1" },
      minLevel: "debug",
    });

    log.child({ component: "worker", docId: 42 }).info("processed", { status: "ok" });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      timestamp: "2026-05-15T10:00:00.000Z",
      level: "info",
      service: "test-service",
      message: "processed",
      component: "worker",
      requestId: "req-1",
      docId: 42,
      status: "ok",
    });
  });

  it("redacts secret-looking fields and serializes unsafe values", () => {
    const lines: string[] = [];
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const log = createLogger({
      sink: { write: (line) => lines.push(line) },
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      minLevel: "debug",
    });

    log.info("request", {
      headers: {
        authorization: "Bearer token",
        "x-api-key": "secret",
        cookie: "session=secret",
        accept: "application/json",
      },
      nested: { paperlessToken: "paperless-secret", count: 3n },
      circular,
    });

    const parsed = JSON.parse(lines[0] ?? "");
    expect(parsed.headers).toMatchObject({
      authorization: "***",
      "x-api-key": "***",
      cookie: "***",
      accept: "application/json",
    });
    expect(parsed.nested).toEqual({ paperlessToken: "***", count: "3" });
    expect(parsed.circular.self).toBe("[Circular]");
  });

  it("writes errors and fatal logs to the error sink with serialized causes", () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cause = new Error("root cause");
    const error = new Error("outer") as Error & { cause?: unknown };
    error.cause = cause;
    const log = createLogger({
      sink: { write: (line) => stdout.push(line) },
      errorSink: { write: (line) => stderr.push(line) },
      now: () => new Date("2026-05-15T10:00:00.000Z"),
      minLevel: "debug",
    });

    log.error("failed", { error });

    expect(stdout).toHaveLength(0);
    expect(stderr).toHaveLength(1);
    const parsed = JSON.parse(stderr[0] ?? "");
    expect(parsed.level).toBe("error");
    expect(parsed.error).toMatchObject({
      name: "Error",
      message: "outer",
      cause: { name: "Error", message: "root cause" },
    });
  });

  it("filters logs below the configured minimum level", () => {
    const lines: string[] = [];
    const log = createLogger({
      sink: { write: (line) => lines.push(line) },
      errorSink: { write: (line) => lines.push(line) },
      minLevel: "warn",
    });

    log.info("hidden");
    log.warn("visible");

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({
      level: "warn",
      message: "visible",
    });
  });
});
