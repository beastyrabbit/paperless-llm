import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCutoverMigration } from "../../../src/services/cutover/migration.js";

describe("cutover migration rehearsal", () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  });

  const withTemp = () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutover-migration-"));
    return tempDir;
  };

  const writeTinyBase = (dir: string) => {
    const file = path.join(dir, "tinybase.json");
    fs.writeFileSync(
      file,
      `${JSON.stringify([
        {
          settings: {
            paperless: { key: "paperless.token", value: "secret-token" },
            mode: { key: "auto_processing.enabled", value: "true" },
          },
          documentOcrContent: {
            "42": { docId: 42, content: "OCR content must stay offline", pages: 1 },
          },
          documentMemory: {
            "42": { docId: 42, transcript: "[raw transcript]", extractedFacts: "{}" },
          },
          pendingReviews: {
            q1: { docId: 42, docTitle: "Sensitive title", suggestion: "Old proposal" },
          },
          caseQuestions: {
            q1: { docId: 42, question: "Sensitive question", answer: "Sensitive answer" },
          },
          catalogProposals: {
            p1: { sourceId: 5, targetId: 6, rationale: "Legacy council rationale" },
          },
          ocrUsageEvents: {
            usage1: { docId: 42, model: "mistral", tokens: 10 },
          },
          unknownTable: {
            row: { value: "not imported" },
          },
        },
        {},
      ])}\n`,
    );
    return file;
  };

  it("dry-runs without writing backup/archive/ledger and never imports config rows", () => {
    const dir = withTemp();
    const tinybaseFile = writeTinyBase(dir);
    const reportFile = path.join(dir, "report.json");

    const report = runCutoverMigration({
      tinybaseFile,
      ledgerFile: path.join(dir, "ledger", "operational-ledger.json"),
      backupDir: path.join(dir, "backups"),
      archiveDir: path.join(dir, "archives"),
      reportFile,
      dryRun: true,
      now: "2026-07-22T10:00:00.000Z",
    });
    const reportJson = fs.readFileSync(reportFile, "utf8");

    expect(report.dryRun).toBe(true);
    expect(report.migratedOperationalFacts).toBe(0);
    expect(report.configKeyDisposition.disposition).toBe("config_owned_not_migrated");
    expect(report.tableDispositions.find((entry) => entry.table === "settings")?.category).toBe(
      "config_owned",
    );
    expect(fs.existsSync(report.tinybaseBackupPath)).toBe(false);
    expect(fs.existsSync(report.offlineArchivePath)).toBe(false);
    expect(fs.existsSync(report.ledgerPath)).toBe(false);
    expect(reportJson).not.toContain("secret-token");
    expect(reportJson).not.toContain("OCR content");
    expect(reportJson).not.toContain("Sensitive title");
    expect(reportJson).not.toContain("raw transcript");
  });

  it("migrates idempotently to an empty ledger and archives excluded rows offline", () => {
    const dir = withTemp();
    const tinybaseFile = writeTinyBase(dir);
    const options = {
      tinybaseFile,
      ledgerFile: path.join(dir, "ledger", "operational-ledger.json"),
      backupDir: path.join(dir, "backups"),
      archiveDir: path.join(dir, "archives"),
      reportFile: path.join(dir, "report.json"),
      dryRun: false,
      now: "2026-07-22T10:00:00.000Z",
    };

    const first = runCutoverMigration(options);
    const second = runCutoverMigration(options);
    const ledgerJson = fs.readFileSync(options.ledgerFile, "utf8");
    const archiveJson = fs.readFileSync(first.offlineArchivePath, "utf8");
    const reportJson = fs.readFileSync(options.reportFile, "utf8");

    expect(first.tinybaseBackupPath).toBe(second.tinybaseBackupPath);
    expect(first.offlineArchivePath).toBe(second.offlineArchivePath);
    expect(ledgerJson).toContain("operational-ledger.v2");
    expect(ledgerJson).not.toContain("secret-token");
    expect(ledgerJson).not.toContain("OCR content");
    expect(ledgerJson).not.toContain("auto_processing.enabled");
    expect(archiveJson).toContain("OCR content must stay offline");
    expect(archiveJson).toContain("raw transcript");
    expect(archiveJson).toContain("Sensitive question");
    expect(archiveJson).toContain("Legacy council rationale");
    expect(reportJson).not.toContain("secret-token");
    expect(reportJson).not.toContain("OCR content must stay offline");
  });

  it("refuses a newer existing operational ledger version", () => {
    const dir = withTemp();
    const tinybaseFile = writeTinyBase(dir);
    const ledgerFile = path.join(dir, "ledger", "operational-ledger.json");
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
    fs.writeFileSync(ledgerFile, JSON.stringify({ schemaVersion: "operational-ledger.v999" }));

    expect(() =>
      runCutoverMigration({
        tinybaseFile,
        ledgerFile,
        backupDir: path.join(dir, "backups"),
        archiveDir: path.join(dir, "archives"),
        reportFile: path.join(dir, "report.json"),
        dryRun: false,
      }),
    ).toThrow(/Unsupported operational ledger schema version/);
  });
});
