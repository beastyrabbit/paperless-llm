-- Migration 002: Blocked Suggestions Table
-- Stores suggestions that should not be proposed again

CREATE TABLE IF NOT EXISTS blocked_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    suggestion_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    block_type TEXT NOT NULL CHECK (block_type IN (
        'global',
        'correspondent',
        'document_type',
        'tag'
    )),
    rejection_reason TEXT,
    rejection_category TEXT CHECK (rejection_category IN (
        'duplicate', 'too_generic', 'irrelevant', 'wrong_format', 'other'
    )),
    doc_id INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(normalized_name, block_type)
);

-- Index for efficient lookups by type and normalized name
CREATE INDEX IF NOT EXISTS idx_blocked_by_type ON blocked_suggestions(block_type, normalized_name);

-- Record this migration version
INSERT OR IGNORE INTO schema_version (version) VALUES (2);
