"""
Tests for the metadata router.

This module tests all endpoints in the metadata router:
- GET/PUT/DELETE /api/metadata/tags
- GET/PUT/DELETE /api/metadata/custom-fields
- POST /api/metadata/tags/bulk
- POST /api/metadata/custom-fields/bulk
- POST /api/metadata/tags/{tag_id}/optimize-description
- POST /api/metadata/tags/{tag_id}/translate-description
- GET/PUT /api/metadata/tags/{tag_id}/translations
"""

import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])
from main import app


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app)


# ===========================================================================
# Tag Metadata Tests
# ===========================================================================


class TestListTagMetadata:
    """Test GET /api/metadata/tags endpoint."""

    def test_list_tags_empty(self, client):
        """Test listing tags when none exist."""
        response = client.get("/api/metadata/tags")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_tags_returns_list(self, client):
        """Test that tags are returned as a list."""
        response = client.get("/api/metadata/tags")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)


class TestGetTagMetadata:
    """Test GET /api/metadata/tags/{tag_id} endpoint."""

    def test_get_tag_not_found(self, client):
        """Test getting non-existent tag metadata."""
        response = client.get("/api/metadata/tags/999999")
        assert response.status_code == 404

    def test_get_tag_invalid_id(self, client):
        """Test getting tag with invalid ID."""
        response = client.get("/api/metadata/tags/invalid")
        assert response.status_code == 422


class TestUpsertTagMetadata:
    """Test PUT /api/metadata/tags/{tag_id} endpoint."""

    def test_create_tag_metadata(self, client):
        """Test creating new tag metadata."""
        response = client.put(
            "/api/metadata/tags/1",
            json={
                "tag_name": "Invoice",
                "description": "Financial invoices",
                "category": "finance",
                "exclude_from_ai": False,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["tag_name"] == "Invoice"
        assert data["paperless_tag_id"] == 1

    def test_update_tag_metadata(self, client):
        """Test updating existing tag metadata."""
        # Create first
        client.put(
            "/api/metadata/tags/2",
            json={"tag_name": "Contract", "description": "Old"},
        )

        # Update
        response = client.put(
            "/api/metadata/tags/2",
            json={"tag_name": "Contract", "description": "New description"},
        )
        assert response.status_code == 200
        assert response.json()["description"] == "New description"

    def test_create_tag_exclude_from_ai(self, client):
        """Test creating tag with AI exclusion."""
        response = client.put(
            "/api/metadata/tags/3",
            json={
                "tag_name": "Confidential",
                "exclude_from_ai": True,
            },
        )
        assert response.status_code == 200
        assert response.json()["exclude_from_ai"] is True

    def test_create_tag_missing_name(self, client):
        """Test creating tag without required name."""
        response = client.put(
            "/api/metadata/tags/4",
            json={"description": "No name"},
        )
        assert response.status_code == 422


class TestDeleteTagMetadata:
    """Test DELETE /api/metadata/tags/{tag_id} endpoint."""

    def test_delete_tag_not_found(self, client):
        """Test deleting non-existent tag."""
        response = client.delete("/api/metadata/tags/999999")
        assert response.status_code == 404

    def test_delete_tag_success(self, client):
        """Test successfully deleting tag."""
        # Create first
        client.put(
            "/api/metadata/tags/10",
            json={"tag_name": "ToDelete"},
        )

        # Delete
        response = client.delete("/api/metadata/tags/10")
        assert response.status_code == 200
        assert response.json()["deleted"] is True


class TestBulkTagMetadata:
    """Test POST /api/metadata/tags/bulk endpoint."""

    def test_bulk_create_tags(self, client):
        """Test bulk creating tag metadata."""
        response = client.post(
            "/api/metadata/tags/bulk",
            json=[
                {"paperless_tag_id": 20, "tag_name": "Tag1"},
                {"paperless_tag_id": 21, "tag_name": "Tag2"},
            ],
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2

    def test_bulk_create_empty_list(self, client):
        """Test bulk create with empty list."""
        response = client.post("/api/metadata/tags/bulk", json=[])
        assert response.status_code == 200
        assert response.json() == []


# ===========================================================================
# Custom Field Metadata Tests
# ===========================================================================


class TestListCustomFieldMetadata:
    """Test GET /api/metadata/custom-fields endpoint."""

    def test_list_custom_fields(self, client):
        """Test listing custom fields."""
        response = client.get("/api/metadata/custom-fields")
        assert response.status_code == 200
        assert isinstance(response.json(), list)


class TestGetCustomFieldMetadata:
    """Test GET /api/metadata/custom-fields/{field_id} endpoint."""

    def test_get_custom_field_not_found(self, client):
        """Test getting non-existent custom field."""
        response = client.get("/api/metadata/custom-fields/999999")
        assert response.status_code == 404


class TestUpsertCustomFieldMetadata:
    """Test PUT /api/metadata/custom-fields/{field_id} endpoint."""

    def test_create_custom_field(self, client):
        """Test creating custom field metadata."""
        response = client.put(
            "/api/metadata/custom-fields/1",
            json={
                "field_name": "Invoice Date",
                "description": "Date the invoice was issued",
                "extraction_hints": "Look for dates near 'Invoice Date'",
                "value_format": "YYYY-MM-DD",
                "example_values": ["2024-01-15", "2024-02-20"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["field_name"] == "Invoice Date"
        assert data["example_values"] == ["2024-01-15", "2024-02-20"]

    def test_create_custom_field_minimal(self, client):
        """Test creating custom field with minimal data."""
        response = client.put(
            "/api/metadata/custom-fields/2",
            json={"field_name": "Amount"},
        )
        assert response.status_code == 200

    def test_create_custom_field_missing_name(self, client):
        """Test creating custom field without name."""
        response = client.put(
            "/api/metadata/custom-fields/3",
            json={"description": "No name"},
        )
        assert response.status_code == 422


class TestDeleteCustomFieldMetadata:
    """Test DELETE /api/metadata/custom-fields/{field_id} endpoint."""

    def test_delete_custom_field_not_found(self, client):
        """Test deleting non-existent custom field."""
        response = client.delete("/api/metadata/custom-fields/999999")
        assert response.status_code == 404

    def test_delete_custom_field_success(self, client):
        """Test successfully deleting custom field."""
        # Create first
        client.put(
            "/api/metadata/custom-fields/10",
            json={"field_name": "ToDelete"},
        )

        # Delete
        response = client.delete("/api/metadata/custom-fields/10")
        assert response.status_code == 200
        assert response.json()["deleted"] is True


class TestBulkCustomFieldMetadata:
    """Test POST /api/metadata/custom-fields/bulk endpoint."""

    def test_bulk_create_custom_fields(self, client):
        """Test bulk creating custom field metadata."""
        response = client.post(
            "/api/metadata/custom-fields/bulk",
            json=[
                {"paperless_field_id": 20, "field_name": "Field1"},
                {"paperless_field_id": 21, "field_name": "Field2"},
            ],
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 2


# ===========================================================================
# Description Optimization Tests
# ===========================================================================


class TestOptimizeDescription:
    """Test POST /api/metadata/tags/{tag_id}/optimize-description endpoint."""

    def test_optimize_description_request_structure(self, client):
        """Test optimize description endpoint accepts correct structure."""
        response = client.post(
            "/api/metadata/tags/1/optimize-description",
            json={
                "description": "invoices and stuff",
                "tag_name": "Invoice",
            },
        )
        # May fail if Ollama not connected, but should validate request
        assert response.status_code in [200, 500]

    def test_optimize_description_missing_fields(self, client):
        """Test optimize with missing required fields."""
        response = client.post(
            "/api/metadata/tags/1/optimize-description",
            json={"description": "test"},  # Missing tag_name
        )
        assert response.status_code == 422


# ===========================================================================
# Translation Tests
# ===========================================================================


class TestTranslateDescription:
    """Test POST /api/metadata/tags/{tag_id}/translate-description endpoint."""

    def test_translate_description_request_structure(self, client):
        """Test translate description endpoint accepts correct structure."""
        response = client.post(
            "/api/metadata/tags/1/translate-description",
            json={
                "description": "Financial invoices from vendors",
                "source_lang": "en",
            },
        )
        # May fail if Ollama not connected
        assert response.status_code in [200, 500]

    def test_translate_description_default_source(self, client):
        """Test translate with default source language."""
        response = client.post(
            "/api/metadata/tags/1/translate-description",
            json={"description": "Test description"},
        )
        assert response.status_code in [200, 500]


class TestGetTagTranslations:
    """Test GET /api/metadata/tags/{tag_id}/translations endpoint."""

    def test_get_translations(self, client):
        """Test getting tag translations."""
        response = client.get("/api/metadata/tags/1/translations")
        assert response.status_code == 200
        data = response.json()
        assert "tag_id" in data
        assert "translations" in data
        assert "translated_langs" in data

    def test_get_translations_response_structure(self, client):
        """Test translations response structure."""
        response = client.get("/api/metadata/tags/999/translations")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["translations"], dict)
        assert isinstance(data["translated_langs"], list)


class TestSaveTagTranslation:
    """Test PUT /api/metadata/tags/{tag_id}/translations/{lang} endpoint."""

    def test_save_translation(self, client):
        """Test saving a translation."""
        response = client.put(
            "/api/metadata/tags/1/translations/de",
            json={"lang": "de", "text": "Finanzielle Rechnungen"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["saved"] is True
        assert data["lang"] == "de"

    def test_save_translation_update(self, client):
        """Test updating an existing translation."""
        # Save first time
        client.put(
            "/api/metadata/tags/2/translations/fr",
            json={"lang": "fr", "text": "Original"},
        )

        # Update
        response = client.put(
            "/api/metadata/tags/2/translations/fr",
            json={"lang": "fr", "text": "Updated"},
        )
        assert response.status_code == 200


# ===========================================================================
# Response Schema Tests
# ===========================================================================


class TestMetadataResponseSchemas:
    """Test metadata response schemas."""

    def test_tag_metadata_response_schema(self, client):
        """Test TagMetadataResponse schema."""
        client.put(
            "/api/metadata/tags/100",
            json={"tag_name": "SchemaTest"},
        )

        response = client.get("/api/metadata/tags/100")
        assert response.status_code == 200
        data = response.json()

        expected_fields = [
            "id",
            "paperless_tag_id",
            "tag_name",
            "description",
            "category",
            "exclude_from_ai",
        ]
        for field in expected_fields:
            assert field in data

    def test_custom_field_response_schema(self, client):
        """Test CustomFieldMetadataResponse schema."""
        client.put(
            "/api/metadata/custom-fields/100",
            json={"field_name": "SchemaTest"},
        )

        response = client.get("/api/metadata/custom-fields/100")
        assert response.status_code == 200
        data = response.json()

        expected_fields = [
            "id",
            "paperless_field_id",
            "field_name",
            "description",
            "extraction_hints",
            "value_format",
            "example_values",
        ]
        for field in expected_fields:
            assert field in data
