import type { Config } from "../config/index.js";
import type { Change, Job, Proposal, Source } from "../db/store.js";
import type { Catalog, PaperlessDocument } from "../paperless/client.js";
import type { Context } from "../pipeline/context.js";
import { dailyPages } from "../providers/mistral.js";
import { now, parseJson } from "../util.js";
import type { Shell } from "./views/layout.js";

export interface ReviewData {
  changes: Change[];
  proposals: Proposal[];
  documents: Map<number, PaperlessDocument>;
  sources: Map<number, Source>;
  catalog?: Catalog;
  config: Config;
  shell: Shell;
}
export const pendingChanges = (ctx: Context) =>
  ctx.db
    .prepare(
      "SELECT * FROM changes WHERE status IN ('staged','failed') AND kind='document_field' ORDER BY created_at",
    )
    .all() as Change[];
export const nameProposals = (ctx: Context) =>
  ctx.db
    .prepare(
      "SELECT * FROM proposals WHERE status='pending' AND proposal_kind='new_entity' ORDER BY created_at",
    )
    .all() as Proposal[];
export const mergeProposals = (ctx: Context) =>
  ctx.db
    .prepare("SELECT * FROM proposals WHERE proposal_kind='merge' ORDER BY created_at DESC")
    .all() as Proposal[];
export function shellData(ctx: Context): Shell {
  const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  return {
    configHash: ctx.configHash,
    externalUrl:
      ctx.config.paperless.externalUrl ?? ctx.config.paperless.url.replace(/\/api\/?$/, ""),
    counts: {
      review: count(
        "SELECT count(DISTINCT doc_id) n FROM changes WHERE status IN ('staged','failed') AND kind='document_field'",
      ),
      consolidation: count(
        "SELECT count(*) n FROM proposals WHERE proposal_kind='merge' AND status='pending'",
      ),
      activity: count("SELECT count(*) n FROM jobs WHERE state IN ('failed','uncertain')"),
    },
  };
}
export async function reviewData(ctx: Context, remote = true): Promise<ReviewData> {
  const pending = pendingChanges(ctx);
  const ids = [...new Set(pending.flatMap((c) => (c.doc_id === null ? [] : [c.doc_id])))];
  const shell = shellData(ctx);
  const documents = new Map<number, PaperlessDocument>();
  let catalog: Catalog | undefined;
  if (remote && ids.length) {
    const results = await Promise.allSettled([
      ctx.paperless.catalog(),
      ...ids.map((id) => ctx.paperless.getDocument(id)),
    ]);
    const first = results[0];
    if (first?.status === "fulfilled") catalog = first.value as Catalog;
    for (const result of results.slice(1))
      if (result.status === "fulfilled") {
        const doc = result.value as PaperlessDocument;
        documents.set(doc.id, doc);
      }
    if (results.some((r) => r.status === "rejected"))
      shell.unavailable = `The archive request failed at ${now()}.`;
  }
  const all = ctx.db
    .prepare(
      "SELECT * FROM changes WHERE kind='document_field' ORDER BY created_at DESC,rowid DESC",
    )
    .all() as Change[];
  return {
    changes: all.filter((c) => c.doc_id !== null && ids.includes(c.doc_id)),
    proposals: nameProposals(ctx),
    documents,
    sources: new Map(
      (ctx.db.prepare("SELECT * FROM sources").all() as Source[]).map((s) => [s.doc_id, s]),
    ),
    catalog,
    shell,
    config: ctx.config,
  };
}
export function waitingIds(data: ReviewData) {
  return new Set(
    data.changes
      .filter((c) => c.status === "staged" && data.proposals.some((p) => p.id === c.proposal_id))
      .map((c) => Number(c.doc_id)),
  );
}
export function docTitle(ctx: Context, docId: number) {
  const title = ctx.db
    .prepare(
      "SELECT proposed_value_json FROM changes WHERE doc_id=? AND field_name='title' AND status='applied' ORDER BY applied_at DESC LIMIT 1",
    )
    .get(docId) as { proposed_value_json: string } | undefined;
  return title
    ? parseJson<string>(title.proposed_value_json, `Document ${docId}`)
    : `Document ${docId}`;
}
export interface StripData {
  used: number;
  limit: number;
  queued: number;
  review: number;
  failed: number;
  uncertain: number;
  reconcile: string | null;
  tags: Config["tags"];
}
export function stripData(ctx: Context): StripData {
  const count = (sql: string) => (ctx.db.prepare(sql).get() as { n: number }).n;
  // The provider reserves pages against the UTC date before calling Mistral.
  const used = dailyPages(ctx.db);
  const reconcile = ctx.db
    .prepare("SELECT value FROM runtime_state WHERE key='last_reconcile'")
    .get() as { value: string } | undefined;
  return {
    used,
    limit: ctx.config.ocr.maxPagesPerDay,
    queued: count(
      "SELECT count(DISTINCT doc_id) n FROM jobs WHERE state IN ('queued','running','retry_wait')",
    ),
    review: shellData(ctx).counts.review,
    failed: count("SELECT count(DISTINCT doc_id) n FROM jobs WHERE state='failed'"),
    uncertain: count("SELECT count(*) n FROM jobs WHERE stage='ocr' AND state='uncertain'"),
    reconcile: reconcile?.value ?? null,
    tags: ctx.config.tags,
  };
}
export interface RunFilters {
  status: string;
  stage: string;
  q: string;
}
export function filteredJobs(ctx: Context, filters: RunFilters) {
  const clauses: string[] = [],
    values: string[] = [];
  if (filters.status === "action") clauses.push("state IN ('failed','uncertain')");
  else if (filters.status === "requested")
    clauses.push("state IN ('queued','running','retry_wait')");
  else if (filters.status === "review")
    clauses.push("doc_id IN (SELECT doc_id FROM changes WHERE status IN ('staged','failed'))");
  else if (filters.status) {
    clauses.push("state=?");
    values.push(filters.status);
  }
  if (filters.stage) {
    clauses.push("stage=?");
    values.push(filters.stage);
  }
  if (filters.q) {
    clauses.push(
      "(CAST(doc_id AS TEXT) LIKE ? ESCAPE '\\' OR doc_id IN (SELECT doc_id FROM changes WHERE field_name='title' AND proposed_value_json LIKE ? ESCAPE '\\'))",
    );
    const query = `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`;
    values.push(query, query);
  }
  return ctx.db
    .prepare(
      `SELECT * FROM jobs${clauses.length ? " WHERE " + clauses.join(" AND ") : ""} ORDER BY created_at DESC,rowid DESC LIMIT 200`,
    )
    .all(...values) as Job[];
}
