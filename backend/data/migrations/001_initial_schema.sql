-- Migration 001: Initial Schema for Metadata Store
-- Created for Paperless Local LLM

-- Tag metadata for AI context
CREATE TABLE IF NOT EXISTS tag_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paperless_tag_id INTEGER NOT NULL UNIQUE,
    tag_name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    exclude_from_ai BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Custom field metadata for extraction hints
CREATE TABLE IF NOT EXISTS custom_field_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paperless_field_id INTEGER NOT NULL UNIQUE,
    field_name TEXT NOT NULL,
    description TEXT,
    extraction_hints TEXT,
    value_format TEXT,
    example_values TEXT,  -- JSON array
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Translation cache
CREATE TABLE IF NOT EXISTS translations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_lang TEXT NOT NULL,
    target_lang TEXT NOT NULL,
    content_type TEXT NOT NULL,  -- 'prompt', 'ui', 'tag_description'
    content_key TEXT NOT NULL,
    source_text TEXT NOT NULL,
    translated_text TEXT NOT NULL,
    model_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_lang, target_lang, content_type, content_key)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tag_metadata_paperless_id ON tag_metadata(paperless_tag_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_metadata_paperless_id ON custom_field_metadata(paperless_field_id);
CREATE INDEX IF NOT EXISTS idx_translations_lookup ON translations(target_lang, content_type, content_key);

-- Record this migration version
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
