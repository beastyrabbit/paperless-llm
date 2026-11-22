import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { loadConfig, parseConfig, redactedConfig } from "../src/config/index.js";
import { migrate, openDb } from "../src/db/db.js";
import { enqueue, propose } from "../src/db/store.js";
import { testConfig } from "./helpers.js";

describe("configuration", () => {
  it("parses the checked-in example with spend disabled and deterministic hashes", () => {
    const raw = parse(readFileSync("config.example.yaml", "utf8"));
    const result = parseConfig(raw);
    expect(result.config.ocr.enabled).toBe(false);
    expect(result.config.polling.enabled).toBe(false);
    expect(parseConfig(Object.fromEntries(Object.entries(raw).reverse())).configHash).toBe(
      result.configHash,
    );
    const changed = structuredClone(result.config);
    changed.ocr.maxPagesPerDay++;
    expect(parseConfig(changed).configHash).not.toBe(result.configHash);
  });
  it.each([
    { jev: { shortlistLimit: 254 } },
    { ocr: { notBefore: "2026-99-99" } },
    { paperless: { token: "forbidden-in-yaml" } },
    { llm: { maxJsonRepairRetries: 2 } },
  ])("rejects unsafe config %j", (override) => {
    const { config } = testConfig();
    const raw = structuredClone(config) as Record<string, unknown>;
    for (const [key, value] of Object.entries(override))
      raw[key] = { ...(raw[key] as object), ...value };
    expect(() => parseConfig(raw)).toThrow();
  });
  it("rejects credential-bearing URLs and duplicate service tags", () => {
    expect(() =>
      testConfig((config) => {
        config.paperless.url = "https://user:pass@paperless.test";
      }),
    ).toThrow();
    expect(() =>
      testConfig((config) => {
        config.tags.review = config.tags.requested;
      }),
    ).toThrow();
  });
  it("loads secrets only from env and never exposes their values", () => {
    const path = join(mkdtempSync(join(tmpdir(), "paperless-config-")), "config.yaml");
    writeFileSync(path, readFileSync("config.example.yaml"));
    const loaded = loadConfig({
      PAPERLESS_LLM_CONFIG: path,
      PAPERLESS_TOKEN: "fixture-private",
      LLM_API_KEY: "fixture-cloud",
    });
    expect(JSON.stringify(redactedConfig(loaded.config, loaded.secrets))).not.toContain(
      "fixture-private",
    );
    expect(() => loadConfig({ PAPERLESS_LLM_CONFIG: path })).toThrow("PAPERLESS_TOKEN");
  });
});
describe("database", () => {
  it("has five core tables and runtime state, durable pragmas, and idempotent migrations", () => {
    const path = join(mkdtempSync(join(tmpdir(), "paperless-db-")), "test.db");
    const db = openDb(path);
    expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.pragma("synchronous", { simple: true })).toBe(2);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(6);
    migrate(db);
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });
  it("rolls back a broken migration transaction", () => {
    const db = openDb(":memory:");
    const directory = mkdtempSync(join(tmpdir(), "paperless-migration-"));
    writeFileSync(
      join(directory, "003_bad.sql"),
      "CREATE TABLE should_rollback(id INTEGER); INVALID SQL;",
    );
    expect(() => migrate(db, pathToFileURL(`${directory}/`))).toThrow();
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE name='should_rollback'").get(),
    ).toBeUndefined();
    expect(db.pragma("user_version", { simple: true })).toBe(2);
    db.close();
  });
  it("deduplicates jobs and rejected proposals", () => {
    const db = openDb(":memory:");
    const a = enqueue(db, 1, "metadata", "same", "hash");
    expect(enqueue(db, 1, "metadata", "same", "hash").id).toBe(a.id);
    const proposal = propose(db, "new_entity", "correspondent", "same", { name: "Acme" });
    db.prepare("UPDATE proposals SET status='rejected' WHERE id=?").run(proposal.id);
    expect(propose(db, "new_entity", "correspondent", "same", { name: "Acme" }).status).toBe(
      "rejected",
    );
    db.close();
  });
});
