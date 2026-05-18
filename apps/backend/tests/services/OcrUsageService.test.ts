import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigServiceLive } from "../../src/config/index.js";
import { OcrUsageService, OcrUsageServiceLive } from "../../src/services/OcrUsageService.js";
import { TinyBaseService, TinyBaseServiceLive } from "../../src/services/TinyBaseService.js";

const makeTestLayer = () =>
  Layer.provide(OcrUsageServiceLive, Layer.mergeAll(ConfigServiceLive(), TinyBaseServiceLive));

const run = <A, E>(effect: Effect.Effect<A, E, OcrUsageService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(makeTestLayer())));

describe("OcrUsageService", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  let tempDir: string | null = null;

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  const useTempStore = () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-usage-test-"));
    process.chdir(tempDir);
    process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"] = tempDir;
    process.env["PAPERLESS_LLM_CONFIG"] = path.join(tempDir, "missing-config.yaml");
  };

  it("allows reservations when limits are disabled", async () => {
    useTempStore();
    const snapshot = await run(
      Effect.gen(function* () {
        const usage = yield* OcrUsageService;
        const reservation = yield* usage.reserve({ runId: "run-a", source: "bulk_ocr", estimatedPages: 3 });
        yield* usage.commit(reservation, { pages: 3, tokens: 9 });
        return yield* usage.getSnapshot("run-a");
      }),
    );

    expect(snapshot.runPagesUsed).toBe(3);
    expect(snapshot.dailyPageLimit).toBeNull();
  });

  it("rejects daily page reservations that would exceed the cap", async () => {
    useTempStore();
    process.env["PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT"] = "2";

    const result = await run(
      Effect.either(
        Effect.gen(function* () {
          const usage = yield* OcrUsageService;
          yield* usage.reserve({ runId: "run-a", source: "bulk_ocr", estimatedPages: 3 });
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("daily_pages");
    }
  });

  it("rejects token reservations before OCR calls that would exceed the cap", async () => {
    useTempStore();
    process.env["PAPERLESS_LLM_OCR_DAILY_TOKEN_LIMIT"] = "100";

    const result = await run(
      Effect.either(
        Effect.gen(function* () {
          const usage = yield* OcrUsageService;
          yield* usage.reserve({
            runId: "run-a",
            source: "bulk_ocr",
            estimatedPages: 1,
            estimatedTokens: 101,
          });
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("daily_tokens");
    }
  });

  it("requires a positive token estimate when token caps are configured", async () => {
    useTempStore();
    process.env["PAPERLESS_LLM_OCR_RUN_TOKEN_LIMIT"] = "100";

    const result = await run(
      Effect.either(
        Effect.gen(function* () {
          const usage = yield* OcrUsageService;
          yield* usage.reserve({ runId: "run-a", source: "bulk_ocr", estimatedPages: 1 });
        }),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("cannot be enforced");
    }
  });

  it("does not let invalid persisted settings disable configured token caps", async () => {
    useTempStore();
    process.env["PAPERLESS_LLM_OCR_DAILY_TOKEN_LIMIT"] = "100";

    const layer = Layer.merge(
      makeTestLayer(),
      Layer.provide(TinyBaseServiceLive, ConfigServiceLive()),
    );
    const result = await Effect.runPromise(
      Effect.either(
        Effect.gen(function* () {
          const tinybase = yield* TinyBaseService;
          yield* tinybase.setSetting("ocr_budget.daily_token_limit", "-1");
          const usage = yield* OcrUsageService;
          yield* usage.reserve({
            runId: "run-a",
            source: "bulk_ocr",
            estimatedPages: 1,
            estimatedTokens: 101,
          });
        }).pipe(Effect.provide(layer)),
      ),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("daily_tokens");
    }
  });

  it("estimates OCR tokens conservatively from PDF bytes and prompt", async () => {
    useTempStore();
    const estimate = await run(
      Effect.gen(function* () {
        const usage = yield* OcrUsageService;
        return usage.estimateOcrTokens(Buffer.alloc(300), "prompt text");
      }),
    );

    expect(estimate).toBeGreaterThan(200);
  });

  it("releases reserved pages back to the budget", async () => {
    useTempStore();
    process.env["PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT"] = "2";

    const result = await run(
      Effect.gen(function* () {
        const usage = yield* OcrUsageService;
        const first = yield* usage.reserve({ runId: "run-a", source: "bulk_ocr", estimatedPages: 2 });
        yield* usage.release(first, "test");
        const second = yield* usage.reserve({ runId: "run-b", source: "bulk_ocr", estimatedPages: 2 });
        yield* usage.commit(second, { pages: 2 });
        return yield* usage.getSnapshot("run-b");
      }),
    );

    expect(result.dailyPagesUsed).toBe(2);
    expect(result.runPagesUsed).toBe(2);
  });

  it("estimates PDF pages without counting /Pages nodes", async () => {
    useTempStore();
    const pages = await run(
      Effect.gen(function* () {
        const usage = yield* OcrUsageService;
        return usage.estimatePdfPages(
          Buffer.from("/Type /Pages /Count 2\n/Type /Page\n/Type /Page\n", "latin1"),
        );
      }),
    );

    expect(pages).toBe(2);
  });
});
