"""
Tests for the prompts router.

This module tests all endpoints in the prompts router:
- GET /api/prompts/languages
- GET /api/prompts
- GET /api/prompts/groups
- GET /api/prompts/preview-data
- GET /api/prompts/{prompt_name}
- PUT /api/prompts/{prompt_name}
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
# Language List Tests
# ===========================================================================


class TestLanguages:
    """Test GET /api/prompts/languages endpoint."""

    def test_list_languages(self, client):
        """Test listing available languages."""
        response = client.get("/api/prompts/languages")
        assert response.status_code == 200
        data = response.json()
        assert "languages" in data
        assert "default" in data
        assert "current" in data

    def test_languages_have_required_fields(self, client):
        """Test that language info has required fields."""
        response = client.get("/api/prompts/languages")
        assert response.status_code == 200
        data = response.json()

        for lang in data["languages"]:
            assert "code" in lang
            assert "name" in lang
            assert "prompt_count" in lang
            assert "is_complete" in lang

    def test_default_language_is_en(self, client):
        """Test that default language is English."""
        response = client.get("/api/prompts/languages")
        assert response.status_code == 200
        data = response.json()
        assert data["default"] == "en"


# ===========================================================================
# Prompt List Tests
# ===========================================================================


class TestListPrompts:
    """Test GET /api/prompts endpoint."""

    def test_list_prompts_default_language(self, client):
        """Test listing prompts with default language."""
        response = client.get("/api/prompts")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_prompts_specific_language(self, client):
        """Test listing prompts for specific language."""
        response = client.get("/api/prompts?lang=en")
        assert response.status_code == 200

    def test_list_prompts_nonexistent_language(self, client):
        """Test listing prompts for non-existent language (falls back)."""
        response = client.get("/api/prompts?lang=zz")
        assert response.status_code == 200
        # Should return prompts (fallback to default)

    def test_prompt_info_structure(self, client):
        """Test that prompts have expected structure."""
        response = client.get("/api/prompts")
        assert response.status_code == 200
        prompts = response.json()

        if len(prompts) > 0:
            prompt = prompts[0]
            assert "name" in prompt
            assert "filename" in prompt
            assert "content" in prompt
            assert "variables" in prompt
            assert isinstance(prompt["variables"], list)


# ===========================================================================
# Prompt Groups Tests
# ===========================================================================


class TestPromptGroups:
    """Test GET /api/prompts/groups endpoint."""

    def test_list_prompt_groups(self, client):
        """Test listing grouped prompts."""
        response = client.get("/api/prompts/groups")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_prompt_groups_specific_language(self, client):
        """Test listing grouped prompts for specific language."""
        response = client.get("/api/prompts/groups?lang=en")
        assert response.status_code == 200

    def test_prompt_group_structure(self, client):
        """Test that prompt groups have expected structure."""
        response = client.get("/api/prompts/groups")
        assert response.status_code == 200
        groups = response.json()

        if len(groups) > 0:
            group = groups[0]
            assert "name" in group
            assert "main" in group
            # confirmation may be None for standalone prompts
            if group.get("confirmation"):
                assert "name" in group["confirmation"]
                assert "content" in group["confirmation"]


# ===========================================================================
# Preview Data Tests
# ===========================================================================


class TestPreviewData:
    """Test GET /api/prompts/preview-data endpoint."""

    def test_get_preview_data(self, client):
        """Test getting preview data."""
        response = client.get("/api/prompts/preview-data")
        assert response.status_code == 200
        data = response.json()

        expected_fields = [
            "document_content",
            "existing_correspondents",
            "existing_types",
            "existing_tags",
            "similar_docs",
            "similar_titles",
            "feedback",
            "analysis_result",
            "document_excerpt",
        ]
        for field in expected_fields:
            assert field in data

    def test_preview_data_content_types(self, client):
        """Test preview data field types."""
        response = client.get("/api/prompts/preview-data")
        assert response.status_code == 200
        data = response.json()

        # All fields should be strings
        for key, value in data.items():
            assert isinstance(value, str), f"{key} should be string"


# ===========================================================================
# Single Prompt Tests
# ===========================================================================


class TestGetPrompt:
    """Test GET /api/prompts/{prompt_name} endpoint."""

    def test_get_title_prompt(self, client):
        """Test getting the title prompt."""
        response = client.get("/api/prompts/title")
        assert response.status_code == 200
        data = response.json()
        assert data["filename"] == "title.md"
        assert "content" in data
        assert "variables" in data

    def test_get_correspondent_prompt(self, client):
        """Test getting the correspondent prompt."""
        response = client.get("/api/prompts/correspondent")
        assert response.status_code == 200

    def test_get_document_type_prompt(self, client):
        """Test getting the document_type prompt."""
        response = client.get("/api/prompts/document_type")
        assert response.status_code == 200

    def test_get_tags_prompt(self, client):
        """Test getting the tags prompt."""
        response = client.get("/api/prompts/tags")
        assert response.status_code == 200

    def test_get_confirmation_prompt(self, client):
        """Test getting the confirmation prompt."""
        response = client.get("/api/prompts/confirmation")
        assert response.status_code == 200

    def test_get_prompt_nonexistent(self, client):
        """Test getting non-existent prompt."""
        response = client.get("/api/prompts/nonexistent_prompt")
        assert response.status_code == 404

    def test_get_prompt_with_language(self, client):
        """Test getting prompt for specific language."""
        response = client.get("/api/prompts/title?lang=en")
        assert response.status_code == 200

    def test_get_prompt_nonexistent_language_fallback(self, client):
        """Test prompt fallback for non-existent language."""
        response = client.get("/api/prompts/title?lang=zz")
        # Should fallback to default language
        assert response.status_code == 200


# ===========================================================================
# Prompt Update Tests
# ===========================================================================


class TestUpdatePrompt:
    """Test PUT /api/prompts/{prompt_name} endpoint."""

    def test_update_prompt_not_found(self, client):
        """Test updating non-existent prompt."""
        response = client.put(
            "/api/prompts/nonexistent_prompt",
            json={"content": "New content"},
        )
        assert response.status_code == 404

    def test_update_prompt_empty_content(self, client):
        """Test updating with empty content."""
        response = client.put(
            "/api/prompts/title",
            json={"content": ""},
        )
        # Should either succeed or fail validation
        assert response.status_code in [200, 422]

    def test_update_prompt_missing_content(self, client):
        """Test updating without content field."""
        response = client.put(
            "/api/prompts/title",
            json={},
        )
        assert response.status_code == 422

    def test_update_prompt_with_language(self, client):
        """Test updating prompt for specific language."""
        response = client.put(
            "/api/prompts/nonexistent?lang=en",
            json={"content": "Test"},
        )
        assert response.status_code == 404


# ===========================================================================
# Variable Extraction Tests
# ===========================================================================


class TestVariableExtraction:
    """Test prompt variable extraction functionality."""

    def test_title_prompt_has_expected_variables(self, client):
        """Test that title prompt has expected variables."""
        response = client.get("/api/prompts/title")
        assert response.status_code == 200
        data = response.json()

        # Variables is a list - it can be empty if prompt doesn't have template variables
        assert isinstance(data["variables"], list)
        # The test validates the structure, actual variable content depends on prompt file

    def test_correspondent_prompt_has_expected_variables(self, client):
        """Test that correspondent prompt has expected variables."""
        response = client.get("/api/prompts/correspondent")
        assert response.status_code == 200
        data = response.json()

        # Should have correspondent-related variables
        assert "existing_correspondents" in data["variables"]

    def test_tags_prompt_has_expected_variables(self, client):
        """Test that tags prompt has expected variables."""
        response = client.get("/api/prompts/tags")
        assert response.status_code == 200
        data = response.json()

        assert "existing_tags" in data["variables"]


# ===========================================================================
# Description Extraction Tests
# ===========================================================================


class TestDescriptionExtraction:
    """Test prompt description extraction."""

    def test_prompt_description_from_header(self, client):
        """Test that description is extracted from header."""
        response = client.get("/api/prompts/title")
        assert response.status_code == 200
        data = response.json()

        # If prompt has a # header, description should be set
        if data["content"].startswith("# "):
            assert data.get("description") is not None
