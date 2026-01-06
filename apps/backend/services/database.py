"""SQLite Database Service for Metadata Storage.

Stores:
- Tag metadata (descriptions, AI exclusion flags)
- Custom field metadata (extraction hints)
- Translation cache
"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from models.blocked import (
    BlockedSuggestion,
    BlockSuggestionRequest,
    BlockType,
    RejectionCategory,
)


class TagMetadata(BaseModel):
    """Tag metadata for AI context."""

    id: int | None = None
    paperless_tag_id: int
    tag_name: str
    description: str | None = None
    category: str | None = None
    exclude_from_ai: bool = False
    created_at: str | None = None
    updated_at: str | None = None


class CustomFieldMetadata(BaseModel):
    """Custom field metadata for extraction hints."""

    id: int | None = None
    paperless_field_id: int
    field_name: str
    description: str | None = None
    extraction_hints: str | None = None
    value_format: str | None = None
    example_values: list[str] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class Translation(BaseModel):
    """Cached translation entry."""

    id: int | None = None
    source_lang: str
    target_lang: str
    content_type: str
    content_key: str
    source_text: str
    translated_text: str
    model_used: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class DatabaseService:
    """SQLite database service for metadata storage."""

    CURRENT_VERSION = 2

    def __init__(self, db_path: str | Path | None = None):
        if db_path is None:
            db_path = Path(__file__).parent.parent / "data" / "metadata.db"
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_initialized()

    @contextmanager
    def _get_connection(self):
        """Get a database connection with context management."""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _ensure_initialized(self):
        """Run migrations if needed."""
        with self._get_connection() as conn:
            cursor = conn.cursor()

            # Check if schema_version table exists
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
            )
            if not cursor.fetchone():
                # Run initial migration
                self._run_migration(conn, 1)
            else:
                # Check current version
                cursor.execute("SELECT MAX(version) FROM schema_version")
                row = cursor.fetchone()
                current = row[0] if row and row[0] else 0

                # Run any pending migrations
                for version in range(current + 1, self.CURRENT_VERSION + 1):
                    self._run_migration(conn, version)

    def _run_migration(self, conn: sqlite3.Connection, version: int):
        """Run a specific migration."""
        migrations_dir = Path(__file__).parent.parent / "data" / "migrations"

        # Map version numbers to migration file names
        migration_files = {
            1: "001_initial_schema.sql",
            2: "002_blocked_suggestions.sql",
        }

        migration_filename = migration_files.get(version)
        if migration_filename:
            migration_file = migrations_dir / migration_filename
            if migration_file.exists():
                sql = migration_file.read_text()
                conn.executescript(sql)

    # =========================================================================
    # Tag Metadata Methods
    # =========================================================================

    def get_tag_metadata(self, paperless_tag_id: int) -> TagMetadata | None:
        """Get metadata for a specific tag."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM tag_metadata WHERE paperless_tag_id = ?",
                (paperless_tag_id,),
            )
            row = cursor.fetchone()
            if row:
                return TagMetadata(**dict(row))
            return None

    def get_all_tag_metadata(self) -> list[TagMetadata]:
        """Get all tag metadata."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM tag_metadata ORDER BY tag_name")
            return [TagMetadata(**dict(row)) for row in cursor.fetchall()]

    def upsert_tag_metadata(
        self,
        paperless_tag_id: int,
        tag_name: str,
        description: str | None = None,
        category: str | None = None,
        exclude_from_ai: bool = False,
    ) -> TagMetadata:
        """Insert or update tag metadata."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO tag_metadata (paperless_tag_id, tag_name, description, category, exclude_from_ai, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paperless_tag_id) DO UPDATE SET
                    tag_name = excluded.tag_name,
                    description = excluded.description,
                    category = excluded.category,
                    exclude_from_ai = excluded.exclude_from_ai,
                    updated_at = excluded.updated_at
                """,
                (paperless_tag_id, tag_name, description, category, exclude_from_ai, now, now),
            )
            # Fetch the result in the same connection
            cursor.execute(
                "SELECT * FROM tag_metadata WHERE paperless_tag_id = ?",
                (paperless_tag_id,),
            )
            row = cursor.fetchone()
            return TagMetadata(**dict(row)) if row else None  # type: ignore

    def delete_tag_metadata(self, paperless_tag_id: int) -> bool:
        """Delete tag metadata."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM tag_metadata WHERE paperless_tag_id = ?",
                (paperless_tag_id,),
            )
            return cursor.rowcount > 0

    # =========================================================================
    # Custom Field Metadata Methods
    # =========================================================================

    def get_custom_field_metadata(self, paperless_field_id: int) -> CustomFieldMetadata | None:
        """Get metadata for a specific custom field."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM custom_field_metadata WHERE paperless_field_id = ?",
                (paperless_field_id,),
            )
            row = cursor.fetchone()
            if row:
                data = dict(row)
                # Parse JSON for example_values
                if data.get("example_values"):
                    try:
                        data["example_values"] = json.loads(data["example_values"])
                    except json.JSONDecodeError:
                        data["example_values"] = []
                else:
                    data["example_values"] = []
                return CustomFieldMetadata(**data)
            return None

    def get_all_custom_field_metadata(self) -> list[CustomFieldMetadata]:
        """Get all custom field metadata."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM custom_field_metadata ORDER BY field_name")
            results = []
            for row in cursor.fetchall():
                data = dict(row)
                if data.get("example_values"):
                    try:
                        data["example_values"] = json.loads(data["example_values"])
                    except json.JSONDecodeError:
                        data["example_values"] = []
                else:
                    data["example_values"] = []
                results.append(CustomFieldMetadata(**data))
            return results

    def upsert_custom_field_metadata(
        self,
        paperless_field_id: int,
        field_name: str,
        description: str | None = None,
        extraction_hints: str | None = None,
        value_format: str | None = None,
        example_values: list[str] | None = None,
    ) -> CustomFieldMetadata:
        """Insert or update custom field metadata."""
        now = datetime.now().isoformat()
        example_values_json = json.dumps(example_values or [])
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO custom_field_metadata (paperless_field_id, field_name, description, extraction_hints, value_format, example_values, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(paperless_field_id) DO UPDATE SET
                    field_name = excluded.field_name,
                    description = excluded.description,
                    extraction_hints = excluded.extraction_hints,
                    value_format = excluded.value_format,
                    example_values = excluded.example_values,
                    updated_at = excluded.updated_at
                """,
                (
                    paperless_field_id,
                    field_name,
                    description,
                    extraction_hints,
                    value_format,
                    example_values_json,
                    now,
                    now,
                ),
            )
            # Fetch the result in the same connection
            cursor.execute(
                "SELECT * FROM custom_field_metadata WHERE paperless_field_id = ?",
                (paperless_field_id,),
            )
            row = cursor.fetchone()
            if row:
                data = dict(row)
                if data.get("example_values"):
                    try:
                        data["example_values"] = json.loads(data["example_values"])
                    except json.JSONDecodeError:
                        data["example_values"] = []
                else:
                    data["example_values"] = []
                return CustomFieldMetadata(**data)
            return None  # type: ignore

    def delete_custom_field_metadata(self, paperless_field_id: int) -> bool:
        """Delete custom field metadata."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM custom_field_metadata WHERE paperless_field_id = ?",
                (paperless_field_id,),
            )
            return cursor.rowcount > 0

    # =========================================================================
    # Translation Methods
    # =========================================================================

    def get_translation(
        self,
        source_lang: str,
        target_lang: str,
        content_type: str,
        content_key: str,
    ) -> Translation | None:
        """Get a cached translation."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                SELECT * FROM translations
                WHERE source_lang = ? AND target_lang = ? AND content_type = ? AND content_key = ?
                """,
                (source_lang, target_lang, content_type, content_key),
            )
            row = cursor.fetchone()
            if row:
                return Translation(**dict(row))
            return None

    def get_translations_by_lang(
        self,
        target_lang: str,
        content_type: str | None = None,
    ) -> list[Translation]:
        """Get all translations for a target language."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if content_type:
                cursor.execute(
                    "SELECT * FROM translations WHERE target_lang = ? AND content_type = ? ORDER BY content_key",
                    (target_lang, content_type),
                )
            else:
                cursor.execute(
                    "SELECT * FROM translations WHERE target_lang = ? ORDER BY content_type, content_key",
                    (target_lang,),
                )
            return [Translation(**dict(row)) for row in cursor.fetchall()]

    def upsert_translation(
        self,
        source_lang: str,
        target_lang: str,
        content_type: str,
        content_key: str,
        source_text: str,
        translated_text: str,
        model_used: str | None = None,
    ) -> Translation:
        """Insert or update a translation."""
        now = datetime.now().isoformat()
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO translations (source_lang, target_lang, content_type, content_key, source_text, translated_text, model_used, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_lang, target_lang, content_type, content_key) DO UPDATE SET
                    source_text = excluded.source_text,
                    translated_text = excluded.translated_text,
                    model_used = excluded.model_used,
                    updated_at = excluded.updated_at
                """,
                (
                    source_lang,
                    target_lang,
                    content_type,
                    content_key,
                    source_text,
                    translated_text,
                    model_used,
                    now,
                    now,
                ),
            )
            # Fetch the result in the same connection
            cursor.execute(
                """
                SELECT * FROM translations
                WHERE source_lang = ? AND target_lang = ? AND content_type = ? AND content_key = ?
                """,
                (source_lang, target_lang, content_type, content_key),
            )
            row = cursor.fetchone()
            return Translation(**dict(row)) if row else None  # type: ignore

    def delete_translation(
        self,
        source_lang: str,
        target_lang: str,
        content_type: str,
        content_key: str,
    ) -> bool:
        """Delete a cached translation."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                DELETE FROM translations
                WHERE source_lang = ? AND target_lang = ? AND content_type = ? AND content_key = ?
                """,
                (source_lang, target_lang, content_type, content_key),
            )
            return cursor.rowcount > 0

    def clear_translations(self, target_lang: str | None = None, content_type: str | None = None):
        """Clear translations, optionally filtered by language or type."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if target_lang and content_type:
                cursor.execute(
                    "DELETE FROM translations WHERE target_lang = ? AND content_type = ?",
                    (target_lang, content_type),
                )
            elif target_lang:
                cursor.execute("DELETE FROM translations WHERE target_lang = ?", (target_lang,))
            elif content_type:
                cursor.execute("DELETE FROM translations WHERE content_type = ?", (content_type,))
            else:
                cursor.execute("DELETE FROM translations")

    def get_translations_for_content(
        self,
        content_type: str,
        content_key: str,
    ) -> list[Translation]:
        """Get all translations for a specific content item."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT * FROM translations WHERE content_type = ? AND content_key = ? ORDER BY target_lang",
                (content_type, content_key),
            )
            return [Translation(**dict(row)) for row in cursor.fetchall()]

    def delete_translations_for_content(self, content_type: str, content_key: str) -> int:
        """Delete all translations for a specific content item."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM translations WHERE content_type = ? AND content_key = ?",
                (content_type, content_key),
            )
            return cursor.rowcount

    # =========================================================================
    # Blocked Suggestions Methods
    # =========================================================================

    def _normalize_name(self, name: str) -> str:
        """Normalize a suggestion name for case-insensitive matching."""
        return name.strip().lower()

    def get_blocked_suggestions(self, block_type: str | None = None) -> list[BlockedSuggestion]:
        """Get all blocked suggestions, optionally filtered by type."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            if block_type:
                cursor.execute(
                    "SELECT * FROM blocked_suggestions WHERE block_type = ? ORDER BY suggestion_name",
                    (block_type,),
                )
            else:
                cursor.execute(
                    "SELECT * FROM blocked_suggestions ORDER BY block_type, suggestion_name"
                )
            results = []
            for row in cursor.fetchall():
                data = dict(row)
                # Convert string values to enums
                data["block_type"] = BlockType(data["block_type"])
                if data.get("rejection_category"):
                    data["rejection_category"] = RejectionCategory(data["rejection_category"])
                results.append(BlockedSuggestion(**data))
            return results

    def add_blocked_suggestion(self, suggestion: BlockSuggestionRequest) -> BlockedSuggestion:
        """Add a blocked suggestion to the database."""
        normalized_name = self._normalize_name(suggestion.suggestion_name)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                """
                INSERT INTO blocked_suggestions (
                    suggestion_name, normalized_name, block_type,
                    rejection_reason, rejection_category, doc_id
                )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(normalized_name, block_type) DO UPDATE SET
                    suggestion_name = excluded.suggestion_name,
                    rejection_reason = excluded.rejection_reason,
                    rejection_category = excluded.rejection_category,
                    doc_id = excluded.doc_id
                """,
                (
                    suggestion.suggestion_name,
                    normalized_name,
                    suggestion.block_type.value,
                    suggestion.rejection_reason,
                    suggestion.rejection_category.value if suggestion.rejection_category else None,
                    suggestion.doc_id,
                ),
            )
            # Fetch the result in the same connection
            cursor.execute(
                "SELECT * FROM blocked_suggestions WHERE normalized_name = ? AND block_type = ?",
                (normalized_name, suggestion.block_type.value),
            )
            row = cursor.fetchone()
            if row:
                data = dict(row)
                data["block_type"] = BlockType(data["block_type"])
                if data.get("rejection_category"):
                    data["rejection_category"] = RejectionCategory(data["rejection_category"])
                return BlockedSuggestion(**data)
            return None  # type: ignore

    def remove_blocked_suggestion(self, id: int) -> bool:
        """Remove a blocked suggestion by ID."""
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "DELETE FROM blocked_suggestions WHERE id = ?",
                (id,),
            )
            return cursor.rowcount > 0

    def is_suggestion_blocked(self, name: str, block_type: str) -> bool:
        """Check if a suggestion is blocked (case-insensitive)."""
        normalized_name = self._normalize_name(name)
        with self._get_connection() as conn:
            cursor = conn.cursor()
            # Check for exact match on block_type OR global block
            cursor.execute(
                """
                SELECT 1 FROM blocked_suggestions
                WHERE normalized_name = ? AND (block_type = ? OR block_type = 'global')
                LIMIT 1
                """,
                (normalized_name, block_type),
            )
            return cursor.fetchone() is not None


# Singleton instance
_database_service: DatabaseService | None = None


def get_database_service() -> DatabaseService:
    """Get the singleton database service instance."""
    global _database_service
    if _database_service is None:
        _database_service = DatabaseService()
    return _database_service
