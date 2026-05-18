import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { makeConfigService } from "../../src/config/index.js";

describe("ConfigService", () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string | null = null;

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it("discovers config.yaml from a backend working directory", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    const backendDir = path.join(tempDir, "apps/backend");
    fs.mkdirSync(backendDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["paperless:", "  url: http://paperless.example", "ollama:", "  model: llama-test"].join(
        "\n",
      ),
    );
    process.chdir(backendDir);

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.paperless.url).toBe("http://paperless.example");
    expect(service.config.ollama.model).toBe("llama-test");
  });

  it("does not let undefined env sections clobber defaults", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    delete process.env["PAPERLESS_URL"];
    delete process.env["PAPERLESS_TOKEN"];
    delete process.env["OLLAMA_URL"];
    delete process.env["DEBUG"];

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.paperless.url).toBe("http://localhost:8000");
    expect(service.config.ollama.url).toBe("http://localhost:11434");
    expect(service.config.pipeline.maxSteps).toBe(10);
    expect(service.config.debug).toBe(false);
  });

  it("fails fast for missing production secrets", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    process.env["NODE_ENV"] = "production";
    delete process.env["PAPERLESS_TOKEN"];
    delete process.env["MISTRAL_API_KEY"];
    delete process.env["PAPERLESS_LLM_API_TOKEN"];
    delete process.env["LOCAL_LLM_API_KEY"];

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Missing required secret configuration");
    }
  });

  it("requires an API auth token in production", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    process.env["NODE_ENV"] = "production";
    process.env["PAPERLESS_TOKEN"] = "paperless-token";
    process.env["MISTRAL_API_KEY"] = "mistral-key";
    delete process.env["PAPERLESS_LLM_API_TOKEN"];
    delete process.env["LOCAL_LLM_API_KEY"];

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("PAPERLESS_LLM_API_TOKEN");
    }
  });

  it("does not walk parent directories for config.yaml in production", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    const backendDir = path.join(tempDir, "apps/backend");
    fs.mkdirSync(backendDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["paperless:", "  url: http://parent-config.example"].join("\n"),
    );
    process.chdir(backendDir);
    process.env["NODE_ENV"] = "production";
    process.env["PAPERLESS_TOKEN"] = "paperless-token";
    process.env["MISTRAL_API_KEY"] = "mistral-key";
    process.env["PAPERLESS_LLM_API_TOKEN"] = "api-token";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.paperless.url).toBe("http://localhost:8000");
  });

  it("requires PAPERLESS_LLM_CONFIG to be absolute in production", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    process.env["NODE_ENV"] = "production";
    process.env["PAPERLESS_LLM_CONFIG"] = "relative-config.yaml";
    process.env["PAPERLESS_TOKEN"] = "paperless-token";
    process.env["MISTRAL_API_KEY"] = "mistral-key";
    process.env["PAPERLESS_LLM_API_TOKEN"] = "api-token";

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Production config path must be absolute");
    }
  });

  it("loads an absolute PAPERLESS_LLM_CONFIG path in production", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    const configPath = path.join(tempDir, "runtime-config.yaml");
    fs.writeFileSync(
      configPath,
      [
        "paperless:",
        "  url: http://absolute-config.example",
        "  token: paperless-token",
        "mistral:",
        "  api_key: mistral-key",
      ].join("\n"),
    );
    process.chdir(tempDir);
    process.env["NODE_ENV"] = "production";
    process.env["PAPERLESS_LLM_CONFIG"] = configPath;
    process.env["PAPERLESS_LLM_API_TOKEN"] = "api-token";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.paperless.url).toBe("http://absolute-config.example");
  });

  it("loads HTTP rate limit settings from YAML and env overrides", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      [
        "http:",
        "  rate_limit_enabled: false",
        "  rate_limit_window_ms: 30000",
        "  rate_limit_max_requests: 10",
        "  rate_limit_trust_proxy: true",
      ].join("\n"),
    );
    process.env["PAPERLESS_LLM_RATE_LIMIT_MAX_REQUESTS"] = "25";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.http.rateLimitEnabled).toBe(false);
    expect(service.config.http.rateLimitWindowMs).toBe(30000);
    expect(service.config.http.rateLimitMaxRequests).toBe(25);
    expect(service.config.http.rateLimitTrustProxy).toBe(true);
  });

  it("loads pipeline max steps from YAML", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(path.join(tempDir, "config.yaml"), ["pipeline:", "  max_steps: 4"].join("\n"));

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.pipeline.maxSteps).toBe(4);
  });

  it("normalizes legacy language and debug object sections from YAML", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      [
        "language:",
        "  prompt: de",
        "debug:",
        "  log_level: INFO",
        "  log_prompts: false",
        "  save_processing_history: true",
      ].join("\n"),
    );

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.language).toBe("de");
    expect(service.config.debug).toBe(false);
  });

  it("loads OCR budget caps from YAML and env overrides", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      [
        "ocr_budget:",
        "  daily_page_limit: 10",
        "  run_page_limit: 3",
        "  daily_token_limit: 1000",
        "  run_token_limit: 200",
      ].join("\n"),
    );
    process.env["PAPERLESS_LLM_OCR_RUN_PAGE_LIMIT"] = "5";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.ocrBudget.dailyPageLimit).toBe(10);
    expect(service.config.ocrBudget.runPageLimit).toBe(5);
    expect(service.config.ocrBudget.dailyTokenLimit).toBe(1000);
    expect(service.config.ocrBudget.runTokenLimit).toBe(200);
  });

  it("rejects invalid OCR budget limits from YAML", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["ocr_budget:", "  daily_page_limit: -1", "  run_token_limit: 1.5"].join("\n"),
    );

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigLoadError");
    }
  });

  it("rejects invalid OCR budget limits from env instead of silently disabling caps", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    process.env["PAPERLESS_LLM_OCR_DAILY_TOKEN_LIMIT"] = "not-a-number";

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigLoadError");
    }
  });

  it("rejects blank OCR budget env values instead of silently disabling YAML caps", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["ocr_budget:", "  daily_page_limit: 10"].join("\n"),
    );
    process.env["PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT"] = "   ";

    const result = await Effect.runPromise(Effect.either(makeConfigService()));

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left._tag).toBe("ConfigLoadError");
    }
  });

  it("treats null OCR budget YAML and explicit env values as unlimited", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["ocr_budget:", "  daily_page_limit: null"].join("\n"),
    );
    process.env["PAPERLESS_LLM_OCR_RUN_PAGE_LIMIT"] = "null";
    process.env["PAPERLESS_LLM_OCR_RUN_TOKEN_LIMIT"] = "unlimited";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.ocrBudget.dailyPageLimit).toBeNull();
    expect(service.config.ocrBudget.runPageLimit).toBeNull();
    expect(service.config.ocrBudget.runTokenLimit).toBeNull();
  });

  it("loads concurrency caps from YAML and env overrides", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      [
        "concurrency:",
        "  ollama_max_concurrent: 2",
        "  mistral_max_concurrent: 3",
        "  ocr_max_concurrent: 4",
      ].join("\n"),
    );
    process.env["PAPERLESS_LLM_MISTRAL_MAX_CONCURRENT"] = "5";

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.concurrency.ollamaMaxConcurrent).toBe(2);
    expect(service.config.concurrency.mistralMaxConcurrent).toBe(5);
    expect(service.config.concurrency.ocrMaxConcurrent).toBe(4);
  });

  it("uses one Ollama model config", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperless-config-test-"));
    process.chdir(tempDir);
    fs.writeFileSync(
      path.join(tempDir, "config.yaml"),
      ["ollama:", "  model: gpt-oss:120b", "confirmation:", "  min_confidence: 0.82"].join("\n"),
    );

    const service = await Effect.runPromise(makeConfigService());

    expect(service.config.ollama.model).toBe("gpt-oss:120b");
    expect(service.config.autoProcessing.confirmationMinConfidence).toBe(0.82);
  });
});
