#!/usr/bin/env node
import * as path from "node:path";
import { runCutoverMigration } from "../services/cutover/migration.js";

const args = process.argv.slice(2);

const readFlag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
};

const hasFlag = (name: string): boolean => args.includes(name);

const dataRoot = process.env["PAPERLESS_LLM_DATA_DIR"] ?? path.join(process.cwd(), "data");
const tinybaseDir =
  process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"] ?? path.join(dataRoot, "tinybase");
const ledgerDir =
  process.env["PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR"] ??
  path.join(dataRoot, "operational-ledger");
const cutoverDir = path.join(dataRoot, "cutover");

const dryRun = hasFlag("--dry-run") || !hasFlag("--migrate");
const report = runCutoverMigration({
  tinybaseFile: path.resolve(
    readFlag("--tinybase-file") ?? path.join(tinybaseDir, "tinybase.json"),
  ),
  ledgerFile: path.resolve(
    readFlag("--ledger-file") ?? path.join(ledgerDir, "operational-ledger.json"),
  ),
  backupDir: path.resolve(readFlag("--backup-dir") ?? path.join(cutoverDir, "backups")),
  archiveDir: path.resolve(readFlag("--archive-dir") ?? path.join(cutoverDir, "offline-archives")),
  reportFile: path.resolve(
    readFlag("--report-file") ??
      path.join(
        cutoverDir,
        dryRun ? "cutover-dry-run-report.json" : "cutover-migration-report.json",
      ),
  ),
  dryRun,
});

const summary = {
  schemaVersion: report.schemaVersion,
  dryRun: report.dryRun,
  generatedAt: report.generatedAt,
  tinybaseBackupPath: report.tinybaseBackupPath,
  offlineArchivePath: report.offlineArchivePath,
  ledgerPath: report.ledgerPath,
  migratedOperationalFacts: report.migratedOperationalFacts,
  tableDispositions: report.tableDispositions.map((entry) => ({
    table: entry.table,
    category: entry.category,
    rows: entry.rows,
    bytes: entry.bytes,
  })),
  unknownTables: report.unknownTables,
  malformedTables: report.malformedTables,
  unmappableTables: report.unmappableTables,
  reportPath: path.resolve(
    readFlag("--report-file") ??
      path.join(
        cutoverDir,
        dryRun ? "cutover-dry-run-report.json" : "cutover-migration-report.json",
      ),
  ),
};

process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
