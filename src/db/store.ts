import { id, json, now } from "../util.js";
import type { DB } from "./db.js";

export type EntityKind = "correspondent" | "tag" | "document_type";
export interface Source {
  doc_id: number;
  source_version_id: number | null;
  source_sha256: string | null;
  ocr_recipe: string;
  output_version_id: number | null;
  ocr_status:
    | "discovered"
    | "running"
    | "result_saved"
    | "pending_write"
    | "done"
    | "uncertain"
    | "failed"
    | "skipped";
  content_hash: string | null;
  ocr_text: string | null;
  ocr_pages: number | null;
  previous_content: string | null;
  updated_at: string;
}
export interface Job {
  id: string;
  idempotency_key: string;
  doc_id: number;
  stage: "ocr" | "metadata" | "consolidation";
  state: "queued" | "running" | "retry_wait" | "uncertain" | "done" | "failed";
  attempts: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_attempt_at: string | null;
  provider_task_id: string | null;
  response_json: string | null;
  usage_json: string | null;
  config_hash: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface Change {
  id: string;
  doc_id: number | null;
  proposal_id: string | null;
  batch_id: string | null;
  kind: "document_field" | "entity_create" | "consolidation_merge";
  field_name: string;
  original_value_json: string | null;
  proposed_value_json: string | null;
  evidence_quote: string | null;
  confidence: number | null;
  check_results_json: string | null;
  status: "staged" | "applied" | "rejected" | "undone" | "failed";
  applied_at: string | null;
  verified_at: string | null;
  created_at: string;
}
export interface Proposal {
  id: string;
  proposal_kind: "new_entity" | "merge";
  entity_kind: EntityKind;
  dedup_key: string;
  payload_json: string;
  score: number | null;
  evidence_json: string | null;
  status: "pending" | "approved" | "rejected" | "undone";
  batch_id: string | null;
  created_at: string;
  resolved_at: string | null;
}
export interface Alias {
  id: string;
  entity_kind: EntityKind;
  canonical_id: number;
  canonical_name: string;
  alias_text: string;
  normalized_alias: string;
  key_kind: "name" | "iban" | "vat" | "domain" | "retired_id";
}
export const getSource = (db: DB, docId: number) =>
  db.prepare("SELECT * FROM sources WHERE doc_id=?").get(docId) as Source | undefined;
export const getJob = (db: DB, jobId: string) =>
  db.prepare("SELECT * FROM jobs WHERE id=?").get(jobId) as Job | undefined;
export function saveSource(
  db: DB,
  source: Pick<Source, "doc_id" | "ocr_status"> & Partial<Source>,
) {
  const previous = getSource(db, source.doc_id);
  const data: Source = {
    source_version_id: null,
    source_sha256: null,
    ocr_recipe: "mistral-ocr:v1",
    output_version_id: null,
    content_hash: null,
    ocr_text: null,
    ocr_pages: null,
    previous_content: null,
    ...previous,
    ...source,
    updated_at: now(),
  };
  const keys = Object.keys(data);
  db.prepare(
    "INSERT INTO sources (" +
      keys.join(",") +
      ") VALUES (" +
      keys.map(() => "?").join(",") +
      ") ON CONFLICT(doc_id) DO UPDATE SET " +
      keys
        .filter((key) => key !== "doc_id")
        .map((key) => `${key}=excluded.${key}`)
        .join(","),
  ).run(...keys.map((key) => data[key as keyof Source]));
}
export function enqueue(
  db: DB,
  docId: number,
  stage: Job["stage"],
  key: string,
  configHash: string,
) {
  db.prepare(
    "INSERT OR IGNORE INTO jobs(id,idempotency_key,doc_id,stage,state,config_hash,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?,?)",
  ).run(id(), key, docId, stage, configHash, now(), now());
  return db.prepare("SELECT * FROM jobs WHERE idempotency_key=?").get(key) as Job;
}
export function updateJob(db: DB, jobId: string, fields: Partial<Omit<Job, "id">>) {
  const data = { ...fields, updated_at: now() };
  const keys = Object.keys(data);
  db.prepare(`UPDATE jobs SET ${keys.map((key) => `${key}=?`).join(",")} WHERE id=?`).run(
    ...keys.map((key) => data[key as keyof typeof data]),
    jobId,
  );
}
export function recordChange(
  db: DB,
  change: {
    docId?: number;
    proposalId?: string;
    batchId?: string;
    kind?: Change["kind"];
    field: string;
    original: unknown;
    proposed: unknown;
    evidence?: string | null;
    confidence?: number;
    checks?: unknown;
    status?: Change["status"];
  },
) {
  const changeId = id();
  db.prepare(
    "INSERT INTO changes(id,doc_id,proposal_id,batch_id,kind,field_name,original_value_json,proposed_value_json,evidence_quote,confidence,check_results_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    changeId,
    change.docId ?? null,
    change.proposalId ?? null,
    change.batchId ?? null,
    change.kind ?? "document_field",
    change.field,
    json(change.original ?? null),
    json(change.proposed ?? null),
    change.evidence ?? null,
    change.confidence ?? null,
    json(change.checks ?? {}),
    change.status ?? "staged",
    now(),
  );
  return changeId;
}
export function propose(
  db: DB,
  kind: Proposal["proposal_kind"],
  entityKind: EntityKind,
  key: string,
  payload: unknown,
  score?: number,
  evidence?: unknown,
) {
  db.prepare(
    "INSERT OR IGNORE INTO proposals(id,proposal_kind,entity_kind,dedup_key,payload_json,score,evidence_json,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)",
  ).run(id(), kind, entityKind, key, json(payload), score ?? null, json(evidence ?? {}), now());
  return db.prepare("SELECT * FROM proposals WHERE dedup_key=?").get(key) as Proposal;
}
