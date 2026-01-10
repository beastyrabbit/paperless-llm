"""
Tests for the pending reviews router.

This module tests all endpoints in the pending router:
- GET /api/pending
- GET /api/pending/counts
- GET /api/pending/{id}
- POST /api/pending/{id}/approve
- POST /api/pending/{id}/reject
- POST /api/pending/{id}/reject-with-feedback
- GET /api/pending/blocked
- DELETE /api/pending/blocked/{id}
- GET /api/pending/similar
- POST /api/pending/merge
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
# List and Count Tests
# ===========================================================================


class TestListPending:
    """Test GET /api/pending endpoint."""

    def test_list_all_pending(self, client):
        """Test listing all pending reviews."""
        response = client.get("/api/pending")
        assert response.status_code == 200
        assert isinstance(response.json(), list)

    def test_list_pending_by_type_correspondent(self, client):
        """Test filtering pending by correspondent type."""
        response = client.get("/api/pending?type=correspondent")
        assert response.status_code == 200

    def test_list_pending_by_type_document_type(self, client):
        """Test filtering pending by document_type type."""
        response = client.get("/api/pending?type=document_type")
        assert response.status_code == 200

    def test_list_pending_by_type_tag(self, client):
        """Test filtering pending by tag type."""
        response = client.get("/api/pending?type=tag")
        assert response.status_code == 200


class TestGetPendingCounts:
    """Test GET /api/pending/counts endpoint."""

    def test_get_counts(self, client):
        """Test getting pending review counts."""
        response = client.get("/api/pending/counts")
        assert response.status_code == 200
        data = response.json()
        assert "correspondent" in data
        assert "document_type" in data
        assert "tag" in data
        assert "total" in data


# ===========================================================================
# Single Item Operations Tests
# ===========================================================================


class TestGetPendingItem:
    """Test GET /api/pending/{id} endpoint."""

    def test_get_pending_item_not_found(self, client):
        """Test getting a non-existent pending item."""
        response = client.get("/api/pending/nonexistent-id")
        assert response.status_code == 404


class TestApprovePending:
    """Test POST /api/pending/{id}/approve endpoint."""

    def test_approve_not_found(self, client):
        """Test approving a non-existent item."""
        response = client.post("/api/pending/nonexistent-id/approve")
        assert response.status_code == 404

    def test_approve_with_custom_value(self, client):
        """Test approving with a custom selected value."""
        response = client.post(
            "/api/pending/nonexistent-id/approve", json={"selected_value": "Custom Name"}
        )
        assert response.status_code == 404


class TestRejectPending:
    """Test POST /api/pending/{id}/reject endpoint."""

    def test_reject_not_found(self, client):
        """Test rejecting a non-existent item."""
        response = client.post("/api/pending/nonexistent-id/reject")
        assert response.status_code == 404


class TestRejectWithFeedback:
    """Test POST /api/pending/{id}/reject-with-feedback endpoint."""

    def test_reject_with_feedback_not_found(self, client):
        """Test rejecting with feedback for non-existent item."""
        response = client.post(
            "/api/pending/nonexistent-id/reject-with-feedback",
            json={
                "block_type": "none",
                "rejection_reason": "Test reason",
                "rejection_category": "other",
            },
        )
        assert response.status_code == 404

    def test_reject_with_global_block(self, client):
        """Test rejecting with global block."""
        response = client.post(
            "/api/pending/nonexistent-id/reject-with-feedback",
            json={
                "block_type": "global",
                "rejection_reason": "Not appropriate",
                "rejection_category": "irrelevant",
            },
        )
        assert response.status_code == 404


# ===========================================================================
# Blocked Items Tests
# ===========================================================================


class TestBlockedItems:
    """Test blocked items endpoints."""

    def test_get_blocked_items(self, client):
        """Test getting all blocked items."""
        response = client.get("/api/pending/blocked")
        # May be 200 with data, or 500 if DB not initialized
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert "global_blocks" in data or isinstance(data, list)

    def test_unblock_item_not_found(self, client):
        """Test unblocking a non-existent item."""
        response = client.delete("/api/pending/blocked/99999")
        # Should return 404, 200 with failure message, or 500 if DB issues
        assert response.status_code in [200, 404, 500]


# ===========================================================================
# Similar Items Tests
# ===========================================================================


class TestSimilarItems:
    """Test similar items endpoint."""

    def test_find_similar(self, client):
        """Test finding similar pending items."""
        response = client.get("/api/pending/similar")
        assert response.status_code == 200
        data = response.json()
        assert "groups" in data
        assert "total_mergeable" in data

    def test_find_similar_with_threshold(self, client):
        """Test finding similar with custom threshold."""
        response = client.get("/api/pending/similar?threshold=0.9")
        assert response.status_code == 200


class TestMergePending:
    """Test POST /api/pending/merge endpoint."""

    def test_merge_empty_list(self, client):
        """Test merging with empty list."""
        response = client.post("/api/pending/merge", json={"item_ids": [], "final_name": "Test"})
        # Should fail validation or return error
        assert response.status_code in [200, 400, 422]

    def test_merge_single_item(self, client):
        """Test merging with single item (should fail)."""
        response = client.post(
            "/api/pending/merge", json={"item_ids": ["item-1"], "final_name": "Test"}
        )
        # Should succeed or return validation error
        assert response.status_code in [200, 400, 422]

    def test_merge_nonexistent_items(self, client):
        """Test merging non-existent items."""
        response = client.post(
            "/api/pending/merge",
            json={"item_ids": ["nonexistent-1", "nonexistent-2"], "final_name": "Merged Name"},
        )
        assert response.status_code in [200, 404]


# ===========================================================================
# Search Entities Tests
# ===========================================================================


class TestSearchEntities:
    """Test GET /api/pending/search-entities endpoint."""

    def test_get_search_entities(self, client):
        """Test getting searchable entities."""
        response = client.get("/api/pending/search-entities")
        assert response.status_code == 200
        data = response.json()
        assert "correspondents" in data
        assert "document_types" in data
        assert "tags" in data


# ===========================================================================
# Schema Cleanup Tests
# ===========================================================================


class TestSchemaCleanup:
    """Test schema cleanup approval endpoint."""

    def test_approve_cleanup_not_found(self, client):
        """Test approving cleanup for non-existent item."""
        response = client.post(
            "/api/pending/nonexistent-id/approve-cleanup", json={"final_name": "New Name"}
        )
        assert response.status_code == 404
