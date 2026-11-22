CREATE TABLE sources (
  doc_id INTEGER PRIMARY KEY,
  source_version_id INTEGER,
  source_sha256 TEXT,
  ocr_recipe TEXT NOT NULL DEFAULT 'mistral-ocr:v1',
  output_version_id INTEGER,
  ocr_status TEXT NOT NULL CHECK (ocr_status IN ('discovered','running','result_saved','pending_write','done','uncertain','failed','skipped')),
  content_hash TEXT,
  ocr_text TEXT,
  ocr_pages INTEGER,
  previous_content TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  doc_id INTEGER NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('ocr','metadata','consolidation')),
  state TEXT NOT NULL CHECK (state IN ('queued','running','retry_wait','uncertain','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT,
  provider_task_id TEXT,
  response_json TEXT,
  usage_json TEXT,
  config_hash TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_ready ON jobs(state, next_attempt_at, lease_expires_at);
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  proposal_kind TEXT NOT NULL CHECK (proposal_kind IN ('new_entity','merge')),
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('correspondent','tag','document_type')),
  dedup_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  score REAL,
  evidence_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','undone')),
  batch_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  doc_id INTEGER,
  proposal_id TEXT REFERENCES proposals(id),
  batch_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('document_field','entity_create','consolidation_merge')),
  field_name TEXT NOT NULL,
  original_value_json TEXT,
  proposed_value_json TEXT,
  evidence_quote TEXT,
  confidence REAL,
  check_results_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('staged','applied','rejected','undone','failed')),
  applied_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX changes_document ON changes(doc_id,status);
CREATE INDEX changes_batch ON changes(batch_id);
CREATE TABLE aliases (
  id TEXT PRIMARY KEY,
  entity_kind TEXT NOT NULL CHECK (entity_kind IN ('correspondent','tag','document_type')),
  canonical_id INTEGER NOT NULL,
  canonical_name TEXT NOT NULL,
  alias_text TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  key_kind TEXT NOT NULL CHECK (key_kind IN ('name','iban','vat','domain','retired_id')),
  created_at TEXT NOT NULL,
  UNIQUE(entity_kind, normalized_alias, key_kind, canonical_id)
);
