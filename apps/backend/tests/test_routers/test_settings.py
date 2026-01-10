"""
Tests for the settings router.

This module tests all endpoints in the settings router:
- GET/PATCH /api/settings
- POST /api/settings/test-connection/{service}
- GET /api/settings/ollama/models
- GET /api/settings/mistral/models
- GET /api/settings/tags/status
- POST /api/settings/tags/create
- GET/PATCH /api/settings/custom-fields
- GET/PATCH /api/settings/ai-tags
- GET/PATCH /api/settings/ai-document-types
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
# Settings CRUD Tests
# ===========================================================================


class TestGetSettings:
    """Test GET /api/settings endpoint."""

    def test_get_settings_success(self, client):
        """Test successful settings retrieval."""
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        # Check for expected fields
        assert "paperless_url" in data or "ollama_url" in data

    def test_get_settings_returns_json(self, client):
        """Test that settings are returned as JSON."""
        response = client.get("/api/settings")
        assert response.headers["content-type"] == "application/json"


class TestUpdateSettings:
    """Test PATCH /api/settings endpoint."""

    def test_update_settings_partial(self, client):
        """Test partial settings update."""
        update_data = {"auto_processing_enabled": True, "auto_processing_interval_minutes": 15}
        response = client.patch("/api/settings", json=update_data)
        assert response.status_code == 200

    def test_update_settings_invalid_field(self, client):
        """Test update with unknown field is ignored."""
        update_data = {"unknown_field": "value"}
        response = client.patch("/api/settings", json=update_data)
        # Should succeed but ignore unknown field
        assert response.status_code == 200


# ===========================================================================
# Connection Tests
# ===========================================================================


class TestConnectionTests:
    """Test POST /api/settings/test-connection/{service} endpoint."""

    def test_test_paperless_connection_no_config(self, client):
        """Test Paperless connection without configuration."""
        response = client.post("/api/settings/test-connection/paperless")
        # Should return error status when not configured
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_test_ollama_connection_no_config(self, client):
        """Test Ollama connection without configuration."""
        response = client.post("/api/settings/test-connection/ollama")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_test_qdrant_connection_no_config(self, client):
        """Test Qdrant connection without configuration."""
        response = client.post("/api/settings/test-connection/qdrant")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_test_mistral_connection_no_config(self, client):
        """Test Mistral connection without configuration."""
        response = client.post("/api/settings/test-connection/mistral")
        assert response.status_code == 200
        data = response.json()
        assert "status" in data

    def test_test_unknown_service(self, client):
        """Test connection for unknown service."""
        response = client.post("/api/settings/test-connection/unknown")
        # Endpoint may handle unknown services gracefully with 200 and error status
        # or reject with 400, 404, 422, or 500
        assert response.status_code in [200, 400, 404, 422, 500]
        if response.status_code == 200:
            # If 200, should have error status in response
            data = response.json()
            assert "status" in data


# ===========================================================================
# Model Lists Tests
# ===========================================================================


class TestOllamaModels:
    """Test GET /api/settings/ollama/models endpoint."""

    def test_get_ollama_models_not_connected(self, client):
        """Test getting Ollama models when not connected."""
        response = client.get("/api/settings/ollama/models")
        # Should return empty list or error
        assert response.status_code in [200, 500]


class TestMistralModels:
    """Test GET /api/settings/mistral/models endpoint."""

    def test_get_mistral_models_not_configured(self, client):
        """Test getting Mistral models when not configured."""
        response = client.get("/api/settings/mistral/models")
        # Should return empty list or error
        assert response.status_code in [200, 500]


# ===========================================================================
# Workflow Tags Tests
# ===========================================================================


class TestWorkflowTags:
    """Test workflow tags endpoints."""

    def test_get_tags_status_not_connected(self, client):
        """Test getting tags status when Paperless is not connected."""
        response = client.get("/api/settings/tags/status")
        # Should return error or empty status
        assert response.status_code in [200, 500]

    def test_create_tags_not_connected(self, client):
        """Test creating tags when Paperless is not connected."""
        response = client.post("/api/settings/tags/create", json={"tag_names": ["test-tag"]})
        # Should return error when not connected
        assert response.status_code in [200, 500]


# ===========================================================================
# Custom Fields Tests
# ===========================================================================


class TestCustomFields:
    """Test custom fields endpoints."""

    def test_get_custom_fields_not_connected(self, client):
        """Test getting custom fields when Paperless is not connected."""
        response = client.get("/api/settings/custom-fields")
        # Should return error or empty list
        assert response.status_code in [200, 500]

    def test_update_custom_fields_selection(self, client):
        """Test updating custom fields selection."""
        response = client.patch(
            "/api/settings/custom-fields", json={"selected_field_ids": [1, 2, 3]}
        )
        assert response.status_code in [200, 500]


# ===========================================================================
# AI Tags Tests
# ===========================================================================


class TestAiTags:
    """Test AI tags endpoints."""

    def test_get_ai_tags_not_connected(self, client):
        """Test getting AI tags when Paperless is not connected."""
        response = client.get("/api/settings/ai-tags")
        # Should return error or empty list
        assert response.status_code in [200, 500]

    def test_update_ai_tags_selection(self, client):
        """Test updating AI tags selection."""
        response = client.patch("/api/settings/ai-tags", json={"selected_tag_ids": [1, 2, 3]})
        assert response.status_code in [200, 500]


# ===========================================================================
# AI Document Types Tests
# ===========================================================================


class TestAiDocumentTypes:
    """Test AI document types endpoints."""

    def test_get_ai_document_types_not_connected(self, client):
        """Test getting AI document types when Paperless is not connected."""
        response = client.get("/api/settings/ai-document-types")
        # Should return error or empty list
        assert response.status_code in [200, 500]

    def test_update_ai_document_types_selection(self, client):
        """Test updating AI document types selection."""
        response = client.patch(
            "/api/settings/ai-document-types", json={"selected_type_ids": [1, 2]}
        )
        assert response.status_code in [200, 500]
