/**
 * Durable lock service tests.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LockService, LockServiceLive, TinyBaseServiceLive } from "../../src/services/index.js";

describe("LockService", () => {
  const TestLayer = Layer.provideMerge(LockServiceLive, TinyBaseServiceLive);
  let testDataDir: string | null = null;

  const runEffect = <A, E>(effect: Effect.Effect<A, E, LockService>) =>
    Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-service-test-"));
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

  it("prevents duplicate active locks for the same document", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const locks = yield* LockService;
        const first = yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-a",
          runId: "run-a",
        });
        const second = yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-b",
          runId: "run-b",
        });
        const wrongRelease = yield* locks.release("document", 42, "run-b");
        const released = yield* locks.release("document", 42, first.lock.runId);
        const third = yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-c",
          runId: "run-c",
        });
        return { first, second, wrongRelease, released, third };
      }),
    );

    expect(result.first.acquired).toBe(true);
    expect(result.second.acquired).toBe(false);
    expect(result.second.lock.runId).toBe("run-a");
    expect(result.wrongRelease).toBe(false);
    expect(result.released).toBe(true);
    expect(result.third.acquired).toBe(true);
    expect(result.third.lock.runId).toBe("run-c");
  });

  it("does not release a lock with an empty run id guard", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const locks = yield* LockService;
        yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-a",
          runId: "run-a",
        });
        const released = yield* locks.release("document", 42, "");
        const current = yield* locks.get("document", 42);
        return { released, current };
      }),
    );

    expect(result.released).toBe(false);
    expect(result.current?.runId).toBe("run-a");
  });

  it("force releases a lock only through the explicit force release API", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const locks = yield* LockService;
        yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-a",
          runId: "run-a",
        });
        const released = yield* locks.forceRelease("document", 42);
        const current = yield* locks.get("document", 42);
        return { released, current };
      }),
    );

    expect(result.released).toBe(true);
    expect(result.current).toBeNull();
  });

  it("recovers stale locks and can prune expired locks", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const locks = yield* LockService;
        yield* locks.acquire({
          scope: "catalog",
          resourceId: "global",
          owner: "old-run",
          runId: "old-run",
          ttlMs: -1000,
        });
        const recovered = yield* locks.acquire({
          scope: "catalog",
          resourceId: "global",
          owner: "new-run",
          runId: "new-run",
        });
        yield* locks.acquire({
          scope: "document",
          resourceId: 99,
          owner: "expired-doc",
          runId: "expired-doc",
          ttlMs: -1000,
        });
        const pruned = yield* locks.pruneStale();
        const remaining = yield* locks.list();
        return { recovered, pruned, remaining };
      }),
    );

    expect(result.recovered.acquired).toBe(true);
    expect(result.recovered.staleRecovered).toBe(true);
    expect(result.recovered.lock.runId).toBe("new-run");
    expect(result.pruned).toBe(1);
    expect(result.remaining.map((lock) => lock.runId)).toEqual(["new-run"]);
  });

  it("extends an active lock heartbeat only for the owning run", async () => {
    const result = await runEffect(
      Effect.gen(function* () {
        const locks = yield* LockService;
        const acquired = yield* locks.acquire({
          scope: "document",
          resourceId: 42,
          owner: "run-a",
          runId: "run-a",
          ttlMs: 1000,
        });
        const wrongRun = yield* locks.heartbeat("document", 42, "run-b", 60_000);
        const refreshed = yield* locks.heartbeat("document", 42, "run-a", 60_000);
        const current = yield* locks.get("document", 42);
        return { acquired, wrongRun, refreshed, current };
      }),
    );

    expect(result.acquired.acquired).toBe(true);
    expect(result.wrongRun).toBeNull();
    expect(result.refreshed?.runId).toBe("run-a");
    expect(result.current?.expiresAt).toBe(result.refreshed?.expiresAt);
    expect(Date.parse(result.current?.expiresAt ?? "")).toBeGreaterThan(
      Date.parse(result.acquired.lock.expiresAt),
    );
  });
});
