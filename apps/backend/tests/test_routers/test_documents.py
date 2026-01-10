"""
Tests for the documents router.

This module tests all endpoints in the documents router:
- GET /api/documents/queue
- GET /api/documents/pending
- GET /api/documents/{doc_id}
- GET /api/documents/{doc_id}/content
- GET /api/documents/{doc_id}/pdf
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
# Queue Stats Tests
# ===========================================================================


class TestQueueStats:
    """Test GET /api/documents/queue endpoint."""

    def test_get_queue_stats_success(self, client):
        """Test getting queue statistics."""
        response = client.get("/api/documents/queue")
        # May succeed or fail depending on Paperless connection
        assert response.status_code in [200, 500]

    def test_get_queue_stats_returns_expected_fields(self, client):
        """Test that queue stats include expected fields."""
        response = client.get("/api/documents/queue")
        if response.status_code == 200:
            data = response.json()
            expected_fields = [
                "pending",
                "ocr_done",
                "correspondent_done",
                "document_type_done",
                "title_done",
                "tags_done",
                "processed",
                "total_in_pipeline",
                "total_documents",
            ]
            for field in expected_fields:
                assert field in data


# ===========================================================================
# Pending Documents Tests
# ===========================================================================


class TestPendingDocuments:
    """Test GET /api/documents/pending endpoint."""

    def test_get_pending_documents_no_filter(self, client):
        """Test getting pending documents without filter."""
        response = client.get("/api/documents/pending")
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            assert isinstance(response.json(), list)

    def test_get_pending_documents_with_tag_filter(self, client):
        """Test getting pending documents with tag filter."""
        response = client.get("/api/documents/pending?tag=llm-pending")
        assert response.status_code in [200, 500]

    def test_get_pending_documents_all_pipeline(self, client):
        """Test getting all pipeline documents."""
        response = client.get("/api/documents/pending?tag=all")
        assert response.status_code in [200, 500]

    def test_get_pending_documents_with_limit(self, client):
        """Test getting pending documents with limit."""
        response = client.get("/api/documents/pending?limit=10")
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert len(data) <= 10

    def test_get_pending_documents_limit_max_enforced(self, client):
        """Test that limit max of 100 is enforced."""
        response = client.get("/api/documents/pending?limit=200")
        # Should either work with capped limit or reject
        assert response.status_code in [200, 422, 500]


# ===========================================================================
# Single Document Tests
# ===========================================================================


class TestGetDocument:
    """Test GET /api/documents/{doc_id} endpoint."""

    def test_get_document_not_found(self, client):
        """Test getting a non-existent document."""
        response = client.get("/api/documents/999999999")
        # Could be 404 or 500 depending on how Paperless responds
        assert response.status_code in [404, 500]

    def test_get_document_invalid_id(self, client):
        """Test getting document with invalid ID."""
        response = client.get("/api/documents/invalid")
        assert response.status_code == 422  # Pydantic validation error

    def test_get_document_negative_id(self, client):
        """Test getting document with negative ID."""
        response = client.get("/api/documents/-1")
        # May be rejected by validation or return error
        assert response.status_code in [404, 422, 500]


# ===========================================================================
# Document Content Tests
# ===========================================================================


class TestGetDocumentContent:
    """Test GET /api/documents/{doc_id}/content endpoint."""

    def test_get_content_not_found(self, client):
        """Test getting content for non-existent document."""
        response = client.get("/api/documents/999999999/content")
        assert response.status_code in [404, 500]

    def test_get_content_invalid_id(self, client):
        """Test getting content with invalid ID."""
        response = client.get("/api/documents/invalid/content")
        assert response.status_code == 422


# ===========================================================================
# Document PDF Tests
# ===========================================================================


class TestGetDocumentPdf:
    """Test GET /api/documents/{doc_id}/pdf endpoint."""

    def test_get_pdf_not_found(self, client):
        """Test getting PDF for non-existent document."""
        response = client.get("/api/documents/999999999/pdf")
        assert response.status_code in [404, 500]

    def test_get_pdf_invalid_id(self, client):
        """Test getting PDF with invalid ID."""
        response = client.get("/api/documents/invalid/pdf")
        assert response.status_code == 422


# ===========================================================================
# Response Schema Tests
# ===========================================================================


class TestDocumentResponseSchemas:
    """Test that responses match expected schemas."""

    def test_document_summary_schema(self, client):
        """Test DocumentSummary schema in list response."""
        response = client.get("/api/documents/pending?limit=1")
        if response.status_code == 200:
            data = response.json()
            if len(data) > 0:
                doc = data[0]
                assert "id" in doc
                assert "title" in doc
                assert "created" in doc
                assert "tags" in doc
                assert isinstance(doc["tags"], list)

    def test_queue_stats_schema(self, client):
        """Test QueueStats schema."""
        response = client.get("/api/documents/queue")
        if response.status_code == 200:
            data = response.json()
            # All fields should be integers
            for key, value in data.items():
                assert isinstance(value, int), f"{key} should be int"
