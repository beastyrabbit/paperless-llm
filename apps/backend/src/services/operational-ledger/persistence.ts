import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalSha256 } from "@repo/api-contracts";
import { assertStoragePolicySafe } from "./policy.js";
import {
  DEFAULT_OPERATIONAL_LEDGER_RETENTION_DAYS,
  LEGACY_OPERATIONAL_LEDGER_SCHEMA_VERSIONS,
  OPERATIONAL_LEDGER_SCHEMA_VERSION,
  type OperationalLedgerData,
  type OperationalLedgerPaths,
} from "./types.js";

const tempPrefix = "operational-ledger.json.tmp-";

export class UnsupportedOperationalLedgerSchemaError extends Error {
  constructor(readonly schemaVersion: string) {
    super(`Unsupported operational ledger schema version: ${schemaVersion}`);
    this.name = "UnsupportedOperationalLedgerSchemaError";
  }
}

export const resolveOperationalLedgerPaths = (): OperationalLedgerPaths => {
  const dataDir = process.env.PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR
    ? path.resolve(process.env.PAPERLESS_LLM_OPERATIONAL_LEDGER_DATA_DIR)
    : process.env.PAPERLESS_LLM_TINYBASE_DATA_DIR
      ? path.resolve(process.env.PAPERLESS_LLM_TINYBASE_DATA_DIR)
      : path.join(process.cwd(), "data");
  return { dataDir, file: path.join(dataDir, "operational-ledger.json") };
};

export const emptyOperationalLedger = (now = new Date().toISOString()): OperationalLedgerData => ({
  schemaVersion: OPERATIONAL_LEDGER_SCHEMA_VERSION,
  createdAt: now,
  updatedAt: now,
  settings: {
    kind: "settings",
    retentionDays: DEFAULT_OPERATIONAL_LEDGER_RETENTION_DAYS,
    updatedAt: now,
    values: {},
  },
  ledgerEntries: [],
  analysisRuns: {},
  catalogEpochs: {},
  proposals: {},
  councilRecords: {},
  chairDecisions: {},
  applyJournals: {},
  providerUsage: [],
  randomCycles: {},
  leases: {},
  compactions: [],
});

const ensureDataDir = (dataDir: string): void => {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dataDir, 0o700);
};

const parseLedgerJson = (json: string): OperationalLedgerData => {
  const parsed = JSON.parse(json) as OperationalLedgerData & { readonly schemaVersion?: string };
  if (parsed.schemaVersion !== OPERATIONAL_LEDGER_SCHEMA_VERSION) {
    if (
      (LEGACY_OPERATIONAL_LEDGER_SCHEMA_VERSIONS as readonly string[]).includes(
        parsed.schemaVersion ?? "",
      )
    ) {
      const migrated: OperationalLedgerData = {
        ...parsed,
        schemaVersion: OPERATIONAL_LEDGER_SCHEMA_VERSION,
        chairDecisions: {},
      };
      assertStoragePolicySafe(migrated);
      return migrated;
    }
    throw new UnsupportedOperationalLedgerSchemaError(String(parsed.schemaVersion));
  }
  assertStoragePolicySafe(parsed);
  return parsed;
};

const readLedgerFile = (file: string): OperationalLedgerData =>
  parseLedgerJson(fs.readFileSync(file, "utf-8"));

const tempFiles = (paths: OperationalLedgerPaths): readonly string[] =>
  fs.existsSync(paths.dataDir)
    ? fs
        .readdirSync(paths.dataDir)
        .filter((name) => name.startsWith(tempPrefix))
        .map((name) => path.join(paths.dataDir, name))
        .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)
    : [];

const recoverFromTemp = (paths: OperationalLedgerPaths): OperationalLedgerData | null => {
  for (const tempFile of tempFiles(paths)) {
    try {
      const recovered = readLedgerFile(tempFile);
      fs.renameSync(tempFile, paths.file);
      fs.chmodSync(paths.file, 0o600);
      return recovered;
    } catch {
      try {
        fs.rmSync(tempFile, { force: true });
      } catch {
        // Best effort cleanup only.
      }
    }
  }
  return null;
};

export const loadOperationalLedger = (
  paths = resolveOperationalLedgerPaths(),
): OperationalLedgerData => {
  ensureDataDir(paths.dataDir);
  if (!fs.existsSync(paths.file)) {
    return recoverFromTemp(paths) ?? emptyOperationalLedger();
  }

  try {
    const loaded = readLedgerFile(paths.file);
    for (const tempFile of tempFiles(paths)) {
      try {
        fs.rmSync(tempFile, { force: true });
      } catch {
        // Stale temp files should not prevent startup.
      }
    }
    return loaded;
  } catch (error) {
    if (error instanceof UnsupportedOperationalLedgerSchemaError) throw error;
    const recovered = recoverFromTemp(paths);
    const backupPath = `${paths.file}.corrupt-${Date.now()}`;
    try {
      if (fs.existsSync(paths.file)) {
        fs.copyFileSync(paths.file, backupPath);
        fs.chmodSync(backupPath, 0o600);
      }
    } catch {
      // A failed backup should not prevent recovery to an empty ledger.
    }
    return recovered ?? emptyOperationalLedger();
  }
};

const fsyncDirectory = (directory: string): void => {
  try {
    const directoryFd = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(directoryFd);
    } finally {
      fs.closeSync(directoryFd);
    }
  } catch {
    // Directory fsync is not available on every platform/filesystem.
  }
};

export const persistOperationalLedger = (
  data: OperationalLedgerData,
  paths = resolveOperationalLedgerPaths(),
): void => {
  ensureDataDir(paths.dataDir);
  assertStoragePolicySafe(data);
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const tempFile = path.join(
    paths.dataDir,
    `${tempPrefix}${process.pid}-${Date.now()}-${canonicalSha256(json).slice(0, 12)}`,
  );
  const fd = fs.openSync(tempFile, "wx", 0o600);
  try {
    fs.writeFileSync(fd, json, { encoding: "utf-8" });
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tempFile, 0o600);
  fs.renameSync(tempFile, paths.file);
  fs.chmodSync(paths.file, 0o600);
  fsyncDirectory(paths.dataDir);
};
