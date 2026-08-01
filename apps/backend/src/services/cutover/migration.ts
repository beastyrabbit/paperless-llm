import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalSha256 } from "@repo/api-contracts";
import {
  emptyOperationalLedger,
  loadOperationalLedger,
  persistOperationalLedger,
} from "../operational-ledger/persistence.js";
import type { OperationalLedgerPaths } from "../operational-ledger/types.js";

export const CUTOVER_REPORT_SCHEMA_VERSION = "c1.cutover-readiness.v1" as const;

export interface CutoverMigrationOptions {
  readonly tinybaseFile: string;
  readonly ledgerFile: string;
  readonly backupDir: string;
  readonly archiveDir: string;
  readonly reportFile: string;
  readonly dryRun: boolean;
  readonly now?: string;
}

export interface CutoverTableDisposition {
  readonly table: string;
  readonly category:
    | "config_owned"
    | "offline_archive"
    | "compatible_operational_fact"
    | "unknown_or_unmappable"
    | "malformed";
  readonly rows: number;
  readonly bytes: number;
  readonly reason: string;
}

export interface CutoverMigrationReport {
  readonly schemaVersion: typeof CUTOVER_REPORT_SCHEMA_VERSION;
  readonly dryRun: boolean;
  readonly generatedAt: string;
  readonly tinybaseBackupPath: string;
  readonly offlineArchivePath: string;
  readonly ledgerPath: string;
  readonly migratedOperationalFacts: number;
  readonly ledgerInitialized: boolean;
  readonly tableDispositions: readonly CutoverTableDisposition[];
  readonly unknownTables: readonly string[];
  readonly malformedTables: readonly string[];
  readonly unmappableTables: readonly string[];
  readonly configKeyDisposition: {
    readonly rows: number;
    readonly bytes: number;
    readonly disposition: "config_owned_not_migrated";
  };
  readonly rollback: readonly string[];
}

const configOwnedTables = new Set(["settings"]);
const offlineArchiveTables = new Set([
  "caseAnswers",
  "caseQuestions",
  "catalogProposals",
  "catalogRuns",
  "documentCases",
  "pendingReviews",
  "processingLogs",
  "documentOcrContent",
  "documentMemory",
  "consolidationReports",
  "translations",
  "tagMetadata",
  "customFieldMetadata",
  "blockedSuggestions",
  "locks",
]);
const knownCompactOnlyTables = new Set(["ocrUsageEvents", "jobStatus", "schemaMetadata"]);

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value) ?? "null");

const ensurePrivateDir = (directory: string): void => {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
};

const writeAtomicJson = (file: string, value: unknown): void => {
  ensurePrivateDir(path.dirname(file));
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = path.join(
    path.dirname(file),
    `${path.basename(file)}.tmp-${process.pid}-${Date.now()}-${canonicalSha256(json).slice(0, 12)}`,
  );
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, json, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
};

const copyIfNeeded = (source: string, destination: string): void => {
  ensurePrivateDir(path.dirname(destination));
  if (fs.existsSync(destination)) return;
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
};

const readTinyBaseTables = (file: string): Record<string, Record<string, unknown>> => {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const tables = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!tables || typeof tables !== "object" || Array.isArray(tables)) {
    throw new Error("TinyBase file does not contain a table object.");
  }
  return tables as Record<string, Record<string, unknown>>;
};

const tableStats = (table: unknown): { readonly rows: number; readonly bytes: number } => ({
  rows: table && typeof table === "object" && !Array.isArray(table) ? Object.keys(table).length : 0,
  bytes: byteLength(table),
});

const dispositionForTable = (table: string, rows: unknown): CutoverTableDisposition => {
  const stats = tableStats(rows);
  if (!rows || typeof rows !== "object" || Array.isArray(rows)) {
    return {
      table,
      category: "malformed",
      ...stats,
      reason: "Table is not a TinyBase row object.",
    };
  }
  if (configOwnedTables.has(table)) {
    return {
      table,
      category: "config_owned",
      ...stats,
      reason:
        "Configuration remains owned by env/YAML/config storage and is not written to the ledger.",
    };
  }
  if (offlineArchiveTables.has(table)) {
    return {
      table,
      category: "offline_archive",
      ...stats,
      reason:
        "Legacy document/OCR/memory/transcript/question/proposal data is archived offline only.",
    };
  }
  if (knownCompactOnlyTables.has(table)) {
    return {
      table,
      category: "unknown_or_unmappable",
      ...stats,
      reason:
        "Rows do not exactly match a ledger-allowed provider usage record without document/content fields.",
    };
  }
  return {
    table,
    category: "unknown_or_unmappable",
    ...stats,
    reason: "No cutover mapping exists for this table.",
  };
};

const archivePayload = (
  tables: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> =>
  Object.fromEntries(Object.entries(tables).filter(([table]) => offlineArchiveTables.has(table)));

const rollbackInstructions = (backupPath: string) =>
  [
    "Stop the new backend container before restoring any state.",
    "Redeploy the previous backend image and point it at the original TinyBase data volume.",
    `Restore the legacy TinyBase backup from ${backupPath} if the volume changed during rehearsal.`,
    "Use Paperless document history to revert any Paperless-side mutations made after cutover.",
    "Start exactly one backend writer after the rollback state is in place.",
  ] as const;

export const runCutoverMigration = (options: CutoverMigrationOptions): CutoverMigrationReport => {
  if (!fs.existsSync(options.tinybaseFile)) {
    throw new Error(`TinyBase file not found: ${options.tinybaseFile}`);
  }
  const now = options.now ?? new Date().toISOString();
  const tinybaseBytes = fs.readFileSync(options.tinybaseFile);
  const sourceHash = canonicalSha256(tinybaseBytes.toString("base64"));
  const backupPath = path.join(options.backupDir, `tinybase-${sourceHash}.json`);
  const archivePath = path.join(options.archiveDir, `legacy-offline-archive-${sourceHash}.json`);
  const ledgerPaths: OperationalLedgerPaths = {
    dataDir: path.dirname(options.ledgerFile),
    file: options.ledgerFile,
  };
  const tables = readTinyBaseTables(options.tinybaseFile);
  const dispositions = Object.entries(tables)
    .map(([table, rows]) => dispositionForTable(table, rows))
    .sort((left, right) => left.table.localeCompare(right.table));
  const archive = archivePayload(tables);
  const settingsStats = tableStats(tables["settings"] ?? {});

  if (!options.dryRun) {
    copyIfNeeded(options.tinybaseFile, backupPath);
    writeAtomicJson(archivePath, {
      schemaVersion: "c1.legacy-offline-archive.v1",
      createdAt: now,
      sourceTinyBaseHash: sourceHash,
      tables: archive,
    });
    if (fs.existsSync(options.ledgerFile)) {
      loadOperationalLedger(ledgerPaths);
    } else {
      persistOperationalLedger(emptyOperationalLedger(now), ledgerPaths);
    }
  }

  const report: CutoverMigrationReport = {
    schemaVersion: CUTOVER_REPORT_SCHEMA_VERSION,
    dryRun: options.dryRun,
    generatedAt: now,
    tinybaseBackupPath: backupPath,
    offlineArchivePath: archivePath,
    ledgerPath: options.ledgerFile,
    migratedOperationalFacts: 0,
    ledgerInitialized: !options.dryRun && fs.existsSync(options.ledgerFile),
    tableDispositions: dispositions,
    unknownTables: dispositions
      .filter((entry) => entry.category === "unknown_or_unmappable")
      .map((entry) => entry.table),
    malformedTables: dispositions
      .filter((entry) => entry.category === "malformed")
      .map((entry) => entry.table),
    unmappableTables: dispositions
      .filter((entry) => entry.category === "unknown_or_unmappable")
      .map((entry) => entry.table),
    configKeyDisposition: {
      rows: settingsStats.rows,
      bytes: settingsStats.bytes,
      disposition: "config_owned_not_migrated",
    },
    rollback: rollbackInstructions(backupPath),
  };
  writeAtomicJson(options.reportFile, report);
  return report;
};
