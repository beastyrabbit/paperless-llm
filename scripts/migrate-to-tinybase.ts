#!/usr/bin/env tsx
/**
 * Idempotent TinyBase persistence migration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createStore } from "tinybase";
import {
  CURRENT_TINYBASE_SCHEMA_VERSION,
  getTinyBaseSchemaVersion,
  migrateTinyBaseStoreToCurrentSchema,
  verifyTinyBaseStoreSchema,
} from "../apps/backend/src/services/TinyBaseService.js";

interface CliOptions {
  readonly file: string;
  readonly dryRun: boolean;
  readonly verifyOnly: boolean;
}

const usage = `Usage: pnpm migrate [--dry-run] [--verify-only] [--file path/to/tinybase.json]`;

const defaultPersistenceFile = (): string => {
  const dataDir = process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"]
    ? path.resolve(process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"])
    : path.join(process.cwd(), "data");
  return path.join(dataDir, "tinybase.json");
};

const parseArgs = (argv: string[]): CliOptions => {
  let file = defaultPersistenceFile();
  let dryRun = false;
  let verifyOnly = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--verify-only") {
      verifyOnly = true;
    } else if (arg === "--file") {
      const next = argv[index + 1];
      if (!next) throw new Error("--file requires a path");
      file = path.resolve(next);
      index++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { file, dryRun, verifyOnly };
};

const loadStore = (file: string) => {
  const store = createStore();
  if (!fs.existsSync(file)) return { store, existed: false };
  const json = fs.readFileSync(file, "utf-8");
  if (json.trim().length > 0) {
    JSON.parse(json);
    store.setJson(json);
  }
  return { store, existed: true };
};

const writeStoreAtomically = (file: string, json: string): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (fs.existsSync(file)) {
    const backup = `${file}.bak-${Date.now()}`;
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
  }

  const tempFile = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tempFile, json, { encoding: "utf-8", mode: 0o600 });
  fs.renameSync(tempFile, file);
  fs.chmodSync(file, 0o600);
};

const main = (): void => {
  const options = parseArgs(process.argv.slice(2));
  const { store, existed } = loadStore(options.file);
  const beforeVersion = getTinyBaseSchemaVersion(store);
  const beforeJson = store.getJson();

  if (options.verifyOnly) {
    verifyTinyBaseStoreSchema(store);
    console.log(
      `TinyBase schema verified: version ${CURRENT_TINYBASE_SCHEMA_VERSION} (${options.file})`,
    );
    return;
  }

  const migrated = migrateTinyBaseStoreToCurrentSchema(store);
  verifyTinyBaseStoreSchema(store);
  const afterVersion = getTinyBaseSchemaVersion(store);
  const afterJson = store.getJson();
  const changed = beforeJson !== afterJson;

  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          file: options.file,
          existed,
          beforeVersion,
          afterVersion,
          migrated,
          changed,
          dryRun: true,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (changed) {
    writeStoreAtomically(options.file, afterJson);
    const { store: verifiedStore } = loadStore(options.file);
    verifyTinyBaseStoreSchema(verifiedStore);
  }

  console.log(
    JSON.stringify(
      {
        file: options.file,
        existed,
        beforeVersion,
        afterVersion,
        migrated,
        changed,
        dryRun: false,
      },
      null,
      2,
    ),
  );
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage);
  process.exit(1);
}
