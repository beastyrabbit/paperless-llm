import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { loadConfig } from "./config/index.js";
import { scan, undo } from "./consolidation/engine.js";
import { openDb } from "./db/db.js";
import { journal } from "./db/journal.js";
import { PaperlessClient } from "./paperless/client.js";
import type { Context } from "./pipeline/context.js";
import { reconcile } from "./pipeline/layer1Ocr.js";
import { classify } from "./pipeline/layer2Classify.js";
import { shortlist } from "./pipeline/shortlist.js";
import { Worker } from "./pipeline/worker.js";
import { JevClient } from "./providers/jev.js";
import { LlmClient } from "./providers/llm.js";
import { MistralClient } from "./providers/mistral.js";
import { json } from "./util.js";
import { createApp } from "./web/server.js";

export function createContext(): Context {
  const loaded = loadConfig();
  const db = openDb(process.env.PAPERLESS_LLM_DB ?? "./data/paperless.db");
  const { config, secrets } = loaded;
  return {
    ...loaded,
    db,
    paperless: new PaperlessClient(config.paperless, secrets.paperlessToken ?? ""),
    mistral: new MistralClient(config.ocr, secrets.mistralApiKey ?? ""),
    jev: new JevClient(config.jev, secrets.jevApiKey ?? ""),
    llm: new LlmClient(config.llm, secrets),
  };
}
export async function calibrate(ctx: Context) {
  const catalog = await ctx.paperless.catalog(),
    docs = await ctx.paperless.listDocuments();
  const report: Record<
    string,
    { total: number; matched: number; accepted: number; shortlistHits?: number }
  > = {};
  for (const doc of docs) {
    const layer2 = await classify(ctx, doc, catalog);
    for (const kind of ["correspondent", "document_type"] as const) {
      if (doc[kind] === null) continue;
      const entities = kind === "correspondent" ? catalog.correspondents : catalog.document_types;
      const field = layer2.fields.find((entry) => entry.field === kind);
      report[kind] ??= { total: 0, matched: 0, accepted: 0, shortlistHits: 0 };
      const row = report[kind];
      row.total++;
      if (field?.passed) row.accepted++;
      if (field?.passed && field.value === doc[kind]) row.matched++;
      if (
        shortlist(ctx.db, doc.content, entities, kind, ctx.config.jev.shortlistLimit).entities.some(
          (entry) => entry.id === doc[kind],
        )
      )
        row.shortlistHits = (row.shortlistHits ?? 0) + 1;
    }
    for (const field of layer2.fields.filter(
      (entry) => entry.field.startsWith("tag:") || entry.field.startsWith("custom:"),
    )) {
      const expected = field.field.startsWith("tag:")
        ? doc.tags.includes(Number(field.checks?.tagId))
        : doc.custom_fields.find((entry) => entry.field === field.checks?.customFieldId)?.value;
      if (expected === undefined) continue;
      report[field.field] ??= { total: 0, matched: 0, accepted: 0 };
      const row = report[field.field] ?? { total: 0, matched: 0, accepted: 0 };
      row.total++;
      if (field.passed) row.accepted++;
      if (field.passed && field.value === expected) row.matched++;
    }
  }
  return {
    documents: docs.length,
    fields: Object.fromEntries(
      Object.entries(report).map(([field, row]) => [
        field,
        {
          ...row,
          precisionAgainstExistingMetadata: row.accepted ? row.matched / row.accepted : null,
          ...(row.shortlistHits === undefined
            ? {}
            : { shortlistRecall: row.total ? row.shortlistHits / row.total : null }),
        },
      ]),
    ),
  };
}
export async function runCommand(args: string[], ctx: Context): Promise<unknown> {
  const command = args[0] ?? "serve";
  if (command === "calibrate") return journal(ctx, "calibrate", calibrate);
  if (command === "consolidate") return { proposals: await scan(ctx, args.includes("--suggest")) };
  if (command === "reconcile") return { sources: await reconcile(ctx) };
  if (command === "undo") {
    if (!args[1]) throw new Error("Usage: undo <batchId>");
    return undo(ctx, args[1]);
  }
  if (command !== "serve") throw new Error(`Unknown command: ${command}`);
  const worker = new Worker(ctx);
  const app = createApp(ctx, ctx.secrets);
  const server = serve({
    fetch: app.fetch,
    port: ctx.config.server.port,
    hostname: ctx.config.server.host,
  });
  if (ctx.config.polling.enabled)
    void worker.start().catch(() => {
      console.error("Worker initialization failed");
      process.exitCode = 1;
      server.close();
    });
  let shutdown: Promise<void> | undefined;
  const onSignal = () => {
    void stop();
  };
  const stop = () => {
    shutdown ??= (async () => {
      await Promise.all([
        worker.stop(),
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
      ]);
      process.removeListener("SIGTERM", onSignal);
      process.removeListener("SIGINT", onSignal);
      ctx.db.close();
    })();
    return shutdown;
  };
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  return { serving: true, stop };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let ctx: Context | undefined;
  try {
    ctx = createContext();
    const result = await runCommand(process.argv.slice(2), ctx);
    if ((process.argv[2] ?? "serve") !== "serve") {
      console.log(json(result));
      ctx.db.close();
    }
  } catch {
    console.error("Command failed. Check configuration and service connectivity.");
    ctx?.db.close();
    process.exitCode = 1;
  }
}
