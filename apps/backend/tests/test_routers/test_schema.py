"""
Tests for the schema router.

This module tests all endpoints in the schema router:
- GET /api/schema/blocked
- POST /api/schema/blocked
- DELETE /api/schema/blocked/{suggestion_id}
- GET /api/schema/blocked/check
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
# List Blocked Suggestions Tests
# ===========================================================================


class TestListBlockedSuggestions:
    """Test GET /api/schema/blocked endpoint."""

    def test_list_blocked_suggestions(self, client):
        """Test listing all blocked suggestions."""
        response = client.get("/api/schema/blocked")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_blocked_by_type_global(self, client):
        """Test listing blocked suggestions filtered by global type."""
        response = client.get("/api/schema/blocked?block_type=global")
        assert response.status_code == 200
        data = response.json()
        for item in data:
            assert item["block_type"] == "global"

    def test_list_blocked_by_type_correspondent(self, client):
        """Test listing blocked suggestions filtered by correspondent type."""
        response = client.get("/api/schema/blocked?block_type=correspondent")
        assert response.status_code == 200

    def test_list_blocked_by_type_document_type(self, client):
        """Test listing blocked suggestions filtered by document_type."""
        response = client.get("/api/schema/blocked?block_type=document_type")
        assert response.status_code == 200

    def test_list_blocked_by_type_tag(self, client):
        """Test listing blocked suggestions filtered by tag type."""
        response = client.get("/api/schema/blocked?block_type=tag")
        assert response.status_code == 200

    def test_list_blocked_invalid_type(self, client):
        """Test listing with invalid block type."""
        response = client.get("/api/schema/blocked?block_type=invalid")
        assert response.status_code == 422


# ===========================================================================
# Block Suggestion Tests
# ===========================================================================


class TestBlockSuggestion:
    """Test POST /api/schema/blocked endpoint."""

    def test_block_suggestion_global(self, client):
        """Test blocking a global suggestion."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Test Global Block",
                "block_type": "global",
                "rejection_reason": "Not appropriate",
                "rejection_category": "irrelevant",
            },
        )
        # May be 200 or 400 if already blocked
        assert response.status_code in [200, 400]

    def test_block_suggestion_correspondent(self, client):
        """Test blocking a correspondent suggestion."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Unknown Sender",
                "block_type": "correspondent",
                "rejection_reason": "Too generic",
                "rejection_category": "too_generic",
            },
        )
        assert response.status_code in [200, 400]

    def test_block_suggestion_document_type(self, client):
        """Test blocking a document type suggestion."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Misc Document",
                "block_type": "document_type",
                "rejection_reason": "Too vague",
            },
        )
        assert response.status_code in [200, 400]

    def test_block_suggestion_tag(self, client):
        """Test blocking a tag suggestion."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "test-tag",
                "block_type": "tag",
                "rejection_reason": "Test tags should not be suggested",
            },
        )
        assert response.status_code in [200, 400]

    def test_block_suggestion_with_doc_id(self, client):
        """Test blocking suggestion with document reference."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Doc Referenced Block",
                "block_type": "correspondent",
                "doc_id": 12345,
            },
        )
        assert response.status_code in [200, 400]

    def test_block_suggestion_missing_name(self, client):
        """Test blocking without suggestion name."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "block_type": "global",
            },
        )
        assert response.status_code == 422

    def test_block_suggestion_missing_type(self, client):
        """Test blocking without block type."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Test",
            },
        )
        assert response.status_code == 422

    def test_block_suggestion_invalid_type(self, client):
        """Test blocking with invalid block type."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Test",
                "block_type": "invalid_type",
            },
        )
        assert response.status_code == 422

    def test_block_suggestion_invalid_category(self, client):
        """Test blocking with invalid rejection category."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "Test",
                "block_type": "global",
                "rejection_category": "not_a_valid_category",
            },
        )
        assert response.status_code == 422


# ===========================================================================
# Unblock Suggestion Tests
# ===========================================================================


class TestUnblockSuggestion:
    """Test DELETE /api/schema/blocked/{suggestion_id} endpoint."""

    def test_unblock_not_found(self, client):
        """Test unblocking non-existent suggestion."""
        response = client.delete("/api/schema/blocked/999999")
        assert response.status_code == 404

    def test_unblock_invalid_id(self, client):
        """Test unblocking with invalid ID."""
        response = client.delete("/api/schema/blocked/invalid")
        assert response.status_code == 422

    def test_unblock_negative_id(self, client):
        """Test unblocking with negative ID."""
        response = client.delete("/api/schema/blocked/-1")
        assert response.status_code in [404, 422]


# ===========================================================================
# Check Blocked Tests
# ===========================================================================


class TestCheckBlocked:
    """Test GET /api/schema/blocked/check endpoint."""

    def test_check_not_blocked(self, client):
        """Test checking a name that isn't blocked."""
        response = client.get(
            "/api/schema/blocked/check?name=RandomUnblocked&block_type=correspondent"
        )
        assert response.status_code == 200
        data = response.json()
        assert "is_blocked" in data
        assert data["name"] == "RandomUnblocked"
        assert data["block_type"] == "correspondent"

    def test_check_blocked_correspondent(self, client):
        """Test checking correspondent block status."""
        response = client.get("/api/schema/blocked/check?name=TestName&block_type=correspondent")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data["is_blocked"], bool)

    def test_check_blocked_document_type(self, client):
        """Test checking document_type block status."""
        response = client.get("/api/schema/blocked/check?name=TestType&block_type=document_type")
        assert response.status_code == 200

    def test_check_blocked_tag(self, client):
        """Test checking tag block status."""
        response = client.get("/api/schema/blocked/check?name=TestTag&block_type=tag")
        assert response.status_code == 200

    def test_check_blocked_global(self, client):
        """Test checking global block status."""
        response = client.get("/api/schema/blocked/check?name=TestGlobal&block_type=global")
        assert response.status_code == 200

    def test_check_blocked_missing_name(self, client):
        """Test checking without name parameter."""
        response = client.get("/api/schema/blocked/check?block_type=global")
        assert response.status_code == 422

    def test_check_blocked_missing_type(self, client):
        """Test checking without block_type parameter."""
        response = client.get("/api/schema/blocked/check?name=Test")
        assert response.status_code == 422

    def test_check_blocked_invalid_type(self, client):
        """Test checking with invalid block type."""
        response = client.get("/api/schema/blocked/check?name=Test&block_type=invalid")
        assert response.status_code == 422


# ===========================================================================
# Integration Tests
# ===========================================================================


class TestBlockUnblockCycle:
    """Test full block/unblock cycles."""

    def test_block_then_check(self, client):
        """Test blocking then checking status."""
        unique_name = "TestBlockCheck123"

        # Block it
        block_response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": unique_name,
                "block_type": "correspondent",
            },
        )

        if block_response.status_code == 200:
            # Check it
            check_response = client.get(
                f"/api/schema/blocked/check?name={unique_name}&block_type=correspondent"
            )
            assert check_response.status_code == 200
            assert check_response.json()["is_blocked"] is True

    def test_block_list_unblock(self, client):
        """Test block, list, then unblock."""
        unique_name = "TestFullCycle456"

        # Block
        block_response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": unique_name,
                "block_type": "tag",
            },
        )

        if block_response.status_code == 200:
            block_id = block_response.json()["id"]

            # List
            list_response = client.get("/api/schema/blocked?block_type=tag")
            assert list_response.status_code == 200

            # Unblock
            unblock_response = client.delete(f"/api/schema/blocked/{block_id}")
            assert unblock_response.status_code == 200

            # Verify unblocked
            check_response = client.get(
                f"/api/schema/blocked/check?name={unique_name}&block_type=tag"
            )
            assert check_response.json()["is_blocked"] is False


# ===========================================================================
# Response Schema Tests
# ===========================================================================


class TestSchemaResponseSchemas:
    """Test schema response schemas."""

    def test_blocked_suggestion_response_schema(self, client):
        """Test BlockedSuggestionResponse schema."""
        response = client.post(
            "/api/schema/blocked",
            json={
                "suggestion_name": "SchemaTestBlock",
                "block_type": "global",
                "rejection_reason": "Testing schema",
            },
        )

        if response.status_code == 200:
            data = response.json()
            expected_fields = ["id", "suggestion_name", "block_type"]
            for field in expected_fields:
                assert field in data

    def test_check_blocked_response_schema(self, client):
        """Test check blocked response schema."""
        response = client.get("/api/schema/blocked/check?name=Test&block_type=global")
        assert response.status_code == 200
        data = response.json()

        assert "name" in data
        assert "block_type" in data
        assert "is_blocked" in data
        assert isinstance(data["is_blocked"], bool)
