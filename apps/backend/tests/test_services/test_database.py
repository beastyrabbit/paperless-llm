"""
Tests for the database service.

This module tests all DatabaseService methods:
- Tag metadata CRUD operations
- Custom field metadata CRUD operations
- Translation cache operations
- Blocked suggestions operations
"""

import sys
import tempfile
from pathlib import Path

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])

from models.blocked import BlockSuggestionRequest, BlockType, RejectionCategory
from services.database import (
    DatabaseService,
)


@pytest.fixture
def db_service():
    """Create a temporary database for testing with proper migrations."""
    # Create a temp directory structure that mimics the real one
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"

        # Get paths to real migration files
        backend_dir = Path(__file__).parent.parent.parent
        migrations_src = backend_dir / "data" / "migrations"

        # Create database and manually run migrations
        import sqlite3

        conn = sqlite3.connect(db_path)

        # Run migration 1 - initial schema
        migration1_file = migrations_src / "001_initial_schema.sql"
        if migration1_file.exists():
            sql1 = migration1_file.read_text()
            conn.executescript(sql1)

        # Run migration 2 - blocked suggestions
        migration2_file = migrations_src / "002_blocked_suggestions.sql"
        if migration2_file.exists():
            sql2 = migration2_file.read_text()
            conn.executescript(sql2)

        conn.commit()
        conn.close()

        # Now create the service with the pre-migrated database
        service = DatabaseService(db_path)
        yield service


# ===========================================================================
# Tag Metadata Tests
# ===========================================================================


class TestTagMetadata:
    """Test tag metadata CRUD operations."""

    def test_upsert_tag_metadata(self, db_service):
        """Test creating tag metadata."""
        result = db_service.upsert_tag_metadata(
            paperless_tag_id=1,
            tag_name="Invoice",
            description="Financial invoices",
            category="finance",
            exclude_from_ai=False,
        )
        assert result.paperless_tag_id == 1
        assert result.tag_name == "Invoice"
        assert result.description == "Financial invoices"
        assert result.category == "finance"
        assert result.exclude_from_ai is False

    def test_get_tag_metadata(self, db_service):
        """Test retrieving tag metadata."""
        db_service.upsert_tag_metadata(
            paperless_tag_id=2,
            tag_name="Contract",
            description="Legal contracts",
        )

        result = db_service.get_tag_metadata(2)
        assert result is not None
        assert result.tag_name == "Contract"
        assert result.description == "Legal contracts"

    def test_get_tag_metadata_not_found(self, db_service):
        """Test retrieving non-existent tag metadata."""
        result = db_service.get_tag_metadata(999)
        assert result is None

    def test_get_all_tag_metadata(self, db_service):
        """Test retrieving all tag metadata."""
        db_service.upsert_tag_metadata(paperless_tag_id=1, tag_name="Alpha")
        db_service.upsert_tag_metadata(paperless_tag_id=2, tag_name="Beta")
        db_service.upsert_tag_metadata(paperless_tag_id=3, tag_name="Gamma")

        results = db_service.get_all_tag_metadata()
        assert len(results) == 3
        # Should be ordered by tag_name
        assert results[0].tag_name == "Alpha"
        assert results[1].tag_name == "Beta"
        assert results[2].tag_name == "Gamma"

    def test_upsert_tag_metadata_update(self, db_service):
        """Test updating existing tag metadata."""
        db_service.upsert_tag_metadata(
            paperless_tag_id=1,
            tag_name="Invoice",
            description="Old description",
        )

        result = db_service.upsert_tag_metadata(
            paperless_tag_id=1,
            tag_name="Invoice",
            description="New description",
            exclude_from_ai=True,
        )

        assert result.description == "New description"
        assert result.exclude_from_ai is True

    def test_delete_tag_metadata(self, db_service):
        """Test deleting tag metadata."""
        db_service.upsert_tag_metadata(paperless_tag_id=1, tag_name="ToDelete")

        result = db_service.delete_tag_metadata(1)
        assert result is True

        # Verify deletion
        assert db_service.get_tag_metadata(1) is None

    def test_delete_tag_metadata_not_found(self, db_service):
        """Test deleting non-existent tag metadata."""
        result = db_service.delete_tag_metadata(999)
        assert result is False

    def test_tag_metadata_with_exclusion(self, db_service):
        """Test tag metadata with AI exclusion flag."""
        db_service.upsert_tag_metadata(
            paperless_tag_id=1,
            tag_name="Confidential",
            exclude_from_ai=True,
        )

        result = db_service.get_tag_metadata(1)
        assert result.exclude_from_ai is True


# ===========================================================================
# Custom Field Metadata Tests
# ===========================================================================


class TestCustomFieldMetadata:
    """Test custom field metadata CRUD operations."""

    def test_upsert_custom_field_metadata(self, db_service):
        """Test creating custom field metadata."""
        result = db_service.upsert_custom_field_metadata(
            paperless_field_id=1,
            field_name="Invoice Date",
            description="Date the invoice was issued",
            extraction_hints="Look for dates near 'Invoice Date' or 'Date:'",
            value_format="YYYY-MM-DD",
            example_values=["2024-01-15", "2024-02-20"],
        )

        assert result.paperless_field_id == 1
        assert result.field_name == "Invoice Date"
        assert result.description == "Date the invoice was issued"
        assert result.extraction_hints is not None
        assert result.value_format == "YYYY-MM-DD"
        assert result.example_values == ["2024-01-15", "2024-02-20"]

    def test_get_custom_field_metadata(self, db_service):
        """Test retrieving custom field metadata."""
        db_service.upsert_custom_field_metadata(
            paperless_field_id=2,
            field_name="Amount",
            description="Total amount",
            example_values=["100.00", "250.50"],
        )

        result = db_service.get_custom_field_metadata(2)
        assert result is not None
        assert result.field_name == "Amount"
        assert result.example_values == ["100.00", "250.50"]

    def test_get_custom_field_metadata_not_found(self, db_service):
        """Test retrieving non-existent custom field metadata."""
        result = db_service.get_custom_field_metadata(999)
        assert result is None

    def test_get_all_custom_field_metadata(self, db_service):
        """Test retrieving all custom field metadata."""
        db_service.upsert_custom_field_metadata(paperless_field_id=1, field_name="Alpha")
        db_service.upsert_custom_field_metadata(paperless_field_id=2, field_name="Beta")

        results = db_service.get_all_custom_field_metadata()
        assert len(results) == 2

    def test_upsert_custom_field_metadata_update(self, db_service):
        """Test updating existing custom field metadata."""
        db_service.upsert_custom_field_metadata(
            paperless_field_id=1,
            field_name="Date",
            description="Old description",
        )

        result = db_service.upsert_custom_field_metadata(
            paperless_field_id=1,
            field_name="Date",
            description="New description",
            example_values=["2024-01-01"],
        )

        assert result.description == "New description"
        assert result.example_values == ["2024-01-01"]

    def test_delete_custom_field_metadata(self, db_service):
        """Test deleting custom field metadata."""
        db_service.upsert_custom_field_metadata(
            paperless_field_id=1,
            field_name="ToDelete",
        )

        result = db_service.delete_custom_field_metadata(1)
        assert result is True
        assert db_service.get_custom_field_metadata(1) is None

    def test_delete_custom_field_metadata_not_found(self, db_service):
        """Test deleting non-existent custom field metadata."""
        result = db_service.delete_custom_field_metadata(999)
        assert result is False

    def test_custom_field_empty_example_values(self, db_service):
        """Test custom field with empty example values."""
        result = db_service.upsert_custom_field_metadata(
            paperless_field_id=1,
            field_name="Test",
        )
        assert result.example_values == []


# ===========================================================================
# Translation Cache Tests
# ===========================================================================


class TestTranslations:
    """Test translation cache operations."""

    def test_upsert_translation(self, db_service):
        """Test creating a translation."""
        result = db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag_description",
            content_key="invoice",
            source_text="Financial invoices",
            translated_text="Finanzielle Rechnungen",
            model_used="gpt-4",
        )

        assert result.source_lang == "en"
        assert result.target_lang == "de"
        assert result.translated_text == "Finanzielle Rechnungen"
        assert result.model_used == "gpt-4"

    def test_get_translation(self, db_service):
        """Test retrieving a translation."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag_name",
            content_key="invoice",
            source_text="Invoice",
            translated_text="Facture",
        )

        result = db_service.get_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag_name",
            content_key="invoice",
        )

        assert result is not None
        assert result.translated_text == "Facture"

    def test_get_translation_not_found(self, db_service):
        """Test retrieving non-existent translation."""
        result = db_service.get_translation(
            source_lang="en",
            target_lang="zh",
            content_type="tag_name",
            content_key="nonexistent",
        )
        assert result is None

    def test_get_translations_by_lang(self, db_service):
        """Test retrieving translations by target language."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="test1",
            translated_text="Test1 DE",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key2",
            source_text="test2",
            translated_text="Test2 DE",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag",
            content_key="key1",
            source_text="test1",
            translated_text="Test1 FR",
        )

        results = db_service.get_translations_by_lang("de")
        assert len(results) == 2

    def test_get_translations_by_lang_and_type(self, db_service):
        """Test retrieving translations filtered by language and type."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="test1",
            translated_text="Test1",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="field",
            content_key="key2",
            source_text="test2",
            translated_text="Test2",
        )

        results = db_service.get_translations_by_lang("de", content_type="tag")
        assert len(results) == 1
        assert results[0].content_type == "tag"

    def test_upsert_translation_update(self, db_service):
        """Test updating existing translation."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="old",
            translated_text="Alt",
        )

        result = db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="new",
            translated_text="Neu",
        )

        assert result.translated_text == "Neu"
        assert result.source_text == "new"

    def test_delete_translation(self, db_service):
        """Test deleting a translation."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="test",
            translated_text="Test",
        )

        result = db_service.delete_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
        )
        assert result is True

        # Verify deletion
        assert (
            db_service.get_translation(
                source_lang="en",
                target_lang="de",
                content_type="tag",
                content_key="key1",
            )
            is None
        )

    def test_delete_translation_not_found(self, db_service):
        """Test deleting non-existent translation."""
        result = db_service.delete_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="nonexistent",
        )
        assert result is False

    def test_clear_all_translations(self, db_service):
        """Test clearing all translations."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="t1",
            translated_text="T1",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag",
            content_key="key1",
            source_text="t1",
            translated_text="T1 FR",
        )

        db_service.clear_translations()

        assert db_service.get_translations_by_lang("de") == []
        assert db_service.get_translations_by_lang("fr") == []

    def test_clear_translations_by_language(self, db_service):
        """Test clearing translations for a specific language."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="t1",
            translated_text="T1 DE",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag",
            content_key="key1",
            source_text="t1",
            translated_text="T1 FR",
        )

        db_service.clear_translations(target_lang="de")

        assert db_service.get_translations_by_lang("de") == []
        assert len(db_service.get_translations_by_lang("fr")) == 1

    def test_clear_translations_by_type(self, db_service):
        """Test clearing translations by content type."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="key1",
            source_text="t1",
            translated_text="T1",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="field",
            content_key="key2",
            source_text="t2",
            translated_text="T2",
        )

        db_service.clear_translations(content_type="tag")

        results = db_service.get_translations_by_lang("de")
        assert len(results) == 1
        assert results[0].content_type == "field"

    def test_get_translations_for_content(self, db_service):
        """Test getting all translations for a content item."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="invoice",
            source_text="Invoice",
            translated_text="Rechnung",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag",
            content_key="invoice",
            source_text="Invoice",
            translated_text="Facture",
        )

        results = db_service.get_translations_for_content("tag", "invoice")
        assert len(results) == 2

    def test_delete_translations_for_content(self, db_service):
        """Test deleting all translations for a content item."""
        db_service.upsert_translation(
            source_lang="en",
            target_lang="de",
            content_type="tag",
            content_key="invoice",
            source_text="Invoice",
            translated_text="Rechnung",
        )
        db_service.upsert_translation(
            source_lang="en",
            target_lang="fr",
            content_type="tag",
            content_key="invoice",
            source_text="Invoice",
            translated_text="Facture",
        )

        count = db_service.delete_translations_for_content("tag", "invoice")
        assert count == 2

        results = db_service.get_translations_for_content("tag", "invoice")
        assert len(results) == 0


# ===========================================================================
# Blocked Suggestions Tests
# ===========================================================================


class TestBlockedSuggestions:
    """Test blocked suggestions operations."""

    def test_add_blocked_suggestion_global(self, db_service):
        """Test adding a global block."""
        request = BlockSuggestionRequest(
            suggestion_name="Bad Company Inc",
            block_type=BlockType.GLOBAL,
            rejection_reason="Not a valid correspondent",
            rejection_category=RejectionCategory.IRRELEVANT,
        )

        result = db_service.add_blocked_suggestion(request)

        assert result.suggestion_name == "Bad Company Inc"
        assert result.block_type == BlockType.GLOBAL
        assert result.rejection_reason == "Not a valid correspondent"
        assert result.rejection_category == RejectionCategory.IRRELEVANT

    def test_add_blocked_suggestion_correspondent(self, db_service):
        """Test adding a correspondent-specific block."""
        request = BlockSuggestionRequest(
            suggestion_name="Unknown Sender",
            block_type=BlockType.CORRESPONDENT,
            rejection_reason="Too generic",
            rejection_category=RejectionCategory.TOO_GENERIC,
        )

        result = db_service.add_blocked_suggestion(request)
        assert result.block_type == BlockType.CORRESPONDENT

    def test_add_blocked_suggestion_document_type(self, db_service):
        """Test adding a document_type-specific block."""
        request = BlockSuggestionRequest(
            suggestion_name="Misc Document",
            block_type=BlockType.DOCUMENT_TYPE,
            rejection_reason="Too vague",
        )

        result = db_service.add_blocked_suggestion(request)
        assert result.block_type == BlockType.DOCUMENT_TYPE

    def test_add_blocked_suggestion_tag(self, db_service):
        """Test adding a tag-specific block."""
        request = BlockSuggestionRequest(
            suggestion_name="test",
            block_type=BlockType.TAG,
            rejection_reason="Test tag should not be suggested",
        )

        result = db_service.add_blocked_suggestion(request)
        assert result.block_type == BlockType.TAG

    def test_get_blocked_suggestions_all(self, db_service):
        """Test retrieving all blocked suggestions."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Block1",
                block_type=BlockType.GLOBAL,
            )
        )
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Block2",
                block_type=BlockType.CORRESPONDENT,
            )
        )

        results = db_service.get_blocked_suggestions()
        assert len(results) == 2

    def test_get_blocked_suggestions_by_type(self, db_service):
        """Test retrieving blocked suggestions filtered by type."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Global1",
                block_type=BlockType.GLOBAL,
            )
        )
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Corr1",
                block_type=BlockType.CORRESPONDENT,
            )
        )

        results = db_service.get_blocked_suggestions("global")
        assert len(results) == 1
        assert results[0].suggestion_name == "Global1"

    def test_remove_blocked_suggestion(self, db_service):
        """Test removing a blocked suggestion."""
        result = db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="ToRemove",
                block_type=BlockType.GLOBAL,
            )
        )

        removed = db_service.remove_blocked_suggestion(result.id)
        assert removed is True

        # Verify removal
        results = db_service.get_blocked_suggestions()
        assert len(results) == 0

    def test_remove_blocked_suggestion_not_found(self, db_service):
        """Test removing non-existent blocked suggestion."""
        result = db_service.remove_blocked_suggestion(999)
        assert result is False

    def test_is_suggestion_blocked_exact(self, db_service):
        """Test checking if a suggestion is blocked."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Blocked Name",
                block_type=BlockType.CORRESPONDENT,
            )
        )

        assert db_service.is_suggestion_blocked("Blocked Name", "correspondent") is True
        assert db_service.is_suggestion_blocked("Other Name", "correspondent") is False

    def test_is_suggestion_blocked_case_insensitive(self, db_service):
        """Test case-insensitive blocking check."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="BLOCKED NAME",
                block_type=BlockType.CORRESPONDENT,
            )
        )

        # Should match regardless of case
        assert db_service.is_suggestion_blocked("blocked name", "correspondent") is True
        assert db_service.is_suggestion_blocked("Blocked Name", "correspondent") is True
        assert db_service.is_suggestion_blocked("BLOCKED NAME", "correspondent") is True

    def test_is_suggestion_blocked_global_matches_all_types(self, db_service):
        """Test that global blocks match any type."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Globally Blocked",
                block_type=BlockType.GLOBAL,
            )
        )

        # Global block should match any type
        assert db_service.is_suggestion_blocked("Globally Blocked", "correspondent") is True
        assert db_service.is_suggestion_blocked("Globally Blocked", "document_type") is True
        assert db_service.is_suggestion_blocked("Globally Blocked", "tag") is True

    def test_blocked_suggestion_with_doc_id(self, db_service):
        """Test blocked suggestion with document ID reference."""
        request = BlockSuggestionRequest(
            suggestion_name="Doc-specific block",
            block_type=BlockType.CORRESPONDENT,
            doc_id=12345,
        )

        result = db_service.add_blocked_suggestion(request)
        assert result.doc_id == 12345

    def test_blocked_suggestion_update_on_conflict(self, db_service):
        """Test that adding same block updates existing."""
        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Duplicate",
                block_type=BlockType.GLOBAL,
                rejection_reason="First reason",
            )
        )

        db_service.add_blocked_suggestion(
            BlockSuggestionRequest(
                suggestion_name="Duplicate",
                block_type=BlockType.GLOBAL,
                rejection_reason="Updated reason",
            )
        )

        # Should update, not create duplicate
        results = db_service.get_blocked_suggestions("global")
        assert len(results) == 1
        assert results[0].rejection_reason == "Updated reason"


# ===========================================================================
# Database Initialization Tests
# ===========================================================================


class TestDatabaseInitialization:
    """Test database initialization and migrations."""

    def test_creates_database_file(self):
        """Test that database file is created."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "test.db"
            _ = DatabaseService(db_path)
            assert db_path.exists()

    def test_creates_parent_directory(self):
        """Test that parent directory is created."""
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = Path(tmpdir) / "subdir" / "test.db"

            _ = DatabaseService(db_path)
            assert db_path.exists()
            assert db_path.parent.exists()

    def test_default_path_used(self):
        """Test that default path is used when none provided."""
        # This test just ensures no exception is raised
        service = DatabaseService()
        assert service.db_path is not None
