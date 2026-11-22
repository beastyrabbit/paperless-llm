import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;
export function openDb(path = "./data/paperless.db"): DB {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  try {
    migrate(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
export function migrate(db: DB, directory = new URL("./migrations/", import.meta.url)) {
  const files = readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  const current = db.pragma("user_version", { simple: true }) as number;
  const latest = Number(files.at(-1)?.split("_")[0] ?? 0);
  if (current > latest) throw new Error("Database schema is newer than this application");
  for (const file of files) {
    const version = Number(file.split("_")[0]);
    if (version <= current) continue;
    db.transaction(() => {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
      db.pragma(`user_version = ${version}`);
    })();
  }
}
