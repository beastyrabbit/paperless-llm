"""
Pytest fixtures and configuration for Paperless Local LLM backend tests.

This module provides:
- Mock clients for external services (Paperless, Ollama, Qdrant, Mistral)
- Fixtures for database setup and teardown
- Sample data generators
- FastAPI test client setup
"""

import asyncio

# Import the main app
import sys
from collections.abc import Generator
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])
from main import app

# ===========================================================================
# Event Loop Fixtures
# ===========================================================================


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create an instance of the default event loop for the test session."""
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


# ===========================================================================
# FastAPI Test Client
# ===========================================================================


@pytest.fixture
def test_client() -> Generator[TestClient, None, None]:
    """Create a test client for the FastAPI app."""
    with TestClient(app) as client:
        yield client


# ===========================================================================
# Mock Paperless Client
# ===========================================================================


@pytest.fixture
def mock_paperless_client() -> MagicMock:
    """Create a mock Paperless-ngx API client."""
    client = MagicMock()

    # Mock common methods
    client.get_document = AsyncMock(return_value=sample_document())
    client.get_documents_by_tag = AsyncMock(return_value=[sample_document()])
    client.get_documents_by_tags = AsyncMock(return_value=[sample_document()])
    client.get_queue_stats = AsyncMock(return_value=sample_queue_stats())
    client.update_document = AsyncMock(return_value=sample_document())
    client.add_tag_to_document = AsyncMock(return_value=None)
    client.remove_tag_from_document = AsyncMock(return_value=None)
    client.get_or_create_tag = AsyncMock(return_value={"id": 1, "name": "test-tag"})
    client.get_or_create_correspondent = AsyncMock(
        return_value={"id": 1, "name": "Test Correspondent"}
    )
    client.get_or_create_document_type = AsyncMock(return_value={"id": 1, "name": "Test Type"})
    client.get_correspondents = AsyncMock(return_value=sample_correspondents())
    client.get_document_types = AsyncMock(return_value=sample_document_types())
    client.get_tags = AsyncMock(return_value=sample_tags())
    client.get_custom_fields = AsyncMock(return_value=sample_custom_fields())
    client.download_pdf = AsyncMock(return_value=b"%PDF-1.4 test content")
    client.merge_entities = AsyncMock(return_value=None)
    client.delete_entity = AsyncMock(return_value=None)
    client.test_connection = AsyncMock(return_value=True)
    client._get_tag_id = AsyncMock(return_value=1)
    client._get_correspondent_name = AsyncMock(return_value="Test Correspondent")
    client._get_tags_data = AsyncMock(return_value=[{"id": 1, "name": "test-tag"}])

    return client


@pytest.fixture
def mock_paperless_client_error() -> MagicMock:
    """Create a mock Paperless client that raises errors."""
    from httpx import HTTPStatusError, Request, Response

    client = MagicMock()

    def raise_404(*args, **kwargs):
        response = Response(404)
        request = Request("GET", "http://test")
        raise HTTPStatusError("Not found", request=request, response=response)

    def raise_500(*args, **kwargs):
        response = Response(500)
        request = Request("GET", "http://test")
        raise HTTPStatusError("Server error", request=request, response=response)

    client.get_document = AsyncMock(side_effect=raise_404)
    client.get_documents_by_tag = AsyncMock(return_value=[])
    client.update_document = AsyncMock(side_effect=raise_500)

    return client


# ===========================================================================
# Mock Ollama Client
# ===========================================================================


@pytest.fixture
def mock_ollama_client() -> MagicMock:
    """Create a mock Ollama LLM client."""
    client = MagicMock()

    # Mock chat response
    async def mock_invoke(prompt: str, **kwargs) -> str:
        return sample_llm_response()

    client.ainvoke = AsyncMock(side_effect=mock_invoke)
    client.invoke = MagicMock(return_value=sample_llm_response())

    return client


# ===========================================================================
# Mock Qdrant Client
# ===========================================================================


@pytest.fixture
def mock_qdrant_client() -> MagicMock:
    """Create a mock Qdrant vector database client."""
    client = MagicMock()

    client.search_similar = AsyncMock(return_value=sample_similar_docs())
    client.upsert_document = AsyncMock(return_value=None)
    client.delete_document = AsyncMock(return_value=None)
    client.test_connection = AsyncMock(return_value=True)

    return client


# ===========================================================================
# Mock Mistral Client
# ===========================================================================


@pytest.fixture
def mock_mistral_client() -> MagicMock:
    """Create a mock Mistral AI client for OCR."""
    client = MagicMock()

    client.ocr = AsyncMock(return_value="Extracted document text content...")
    client.test_connection = AsyncMock(return_value=True)

    return client


# ===========================================================================
# Mock Database Service
# ===========================================================================


@pytest.fixture
def mock_database() -> MagicMock:
    """Create a mock database service."""
    db = MagicMock()

    db.get_pending_reviews = AsyncMock(return_value=sample_pending_reviews())
    db.add_pending_review = AsyncMock(return_value="review-123")
    db.update_pending_review = AsyncMock(return_value=None)
    db.remove_pending_review = AsyncMock(return_value=None)
    db.get_pending_counts = AsyncMock(return_value=sample_pending_counts())
    db.get_tag_metadata = AsyncMock(return_value=sample_tag_metadata())
    db.get_all_tag_metadata = AsyncMock(return_value=[sample_tag_metadata()])
    db.upsert_tag_metadata = AsyncMock(return_value=None)
    db.get_blocked_suggestions = AsyncMock(return_value=[])
    db.add_blocked_suggestion = AsyncMock(return_value=1)
    db.is_suggestion_blocked = AsyncMock(return_value=False)
    db.get_translation = AsyncMock(return_value=None)
    db.upsert_translation = AsyncMock(return_value=None)

    return db


# ===========================================================================
# Sample Data Generators
# ===========================================================================


def sample_document(doc_id: int = 1) -> dict[str, Any]:
    """Generate a sample document."""
    return {
        "id": doc_id,
        "title": f"Test Document {doc_id}",
        "correspondent": 1,
        "correspondent_name": "Test Correspondent",
        "document_type": 1,
        "created": "2024-01-15T10:30:00Z",
        "modified": "2024-01-15T10:30:00Z",
        "added": "2024-01-15T10:30:00Z",
        "tags": [1, 2],
        "tags_data": [
            {"id": 1, "name": "llm-pending"},
            {"id": 2, "name": "important"},
        ],
        "custom_fields": [],
        "content": "This is the full text content of the test document.",
        "original_file_name": "test_document.pdf",
        "archive_serial_number": None,
    }


def sample_queue_stats() -> dict[str, int]:
    """Generate sample queue statistics."""
    return {
        "pending": 5,
        "ocr_done": 3,
        "correspondent_done": 2,
        "document_type_done": 2,
        "title_done": 1,
        "tags_done": 1,
        "processed": 10,
        "total_in_pipeline": 14,
        "total_documents": 100,
    }


def sample_correspondents() -> list[dict[str, Any]]:
    """Generate sample correspondents list."""
    return [
        {"id": 1, "name": "Test Correspondent", "document_count": 5},
        {"id": 2, "name": "Another Sender", "document_count": 3},
        {"id": 3, "name": "Example Corp", "document_count": 10},
    ]


def sample_document_types() -> list[dict[str, Any]]:
    """Generate sample document types list."""
    return [
        {"id": 1, "name": "Invoice", "document_count": 20},
        {"id": 2, "name": "Contract", "document_count": 5},
        {"id": 3, "name": "Letter", "document_count": 15},
    ]


def sample_tags() -> list[dict[str, Any]]:
    """Generate sample tags list."""
    return [
        {"id": 1, "name": "llm-pending", "color": "#FF0000", "document_count": 5},
        {"id": 2, "name": "important", "color": "#00FF00", "document_count": 10},
        {"id": 3, "name": "archive", "color": "#0000FF", "document_count": 50},
    ]


def sample_custom_fields() -> list[dict[str, Any]]:
    """Generate sample custom fields list."""
    return [
        {"id": 1, "name": "Invoice Number", "data_type": "string"},
        {"id": 2, "name": "Due Date", "data_type": "date"},
        {"id": 3, "name": "Amount", "data_type": "monetary"},
    ]


def sample_similar_docs() -> list[dict[str, Any]]:
    """Generate sample similar documents from vector search."""
    return [
        {"id": 5, "title": "Similar Document 1", "score": 0.95},
        {"id": 10, "title": "Similar Document 2", "score": 0.87},
        {"id": 15, "title": "Similar Document 3", "score": 0.82},
    ]


def sample_pending_reviews() -> list[dict[str, Any]]:
    """Generate sample pending reviews."""
    return [
        {
            "id": "review-1",
            "doc_id": 1,
            "doc_title": "Test Document",
            "type": "correspondent",
            "suggestion": "New Correspondent",
            "reasoning": "Based on document analysis",
            "alternatives": ["Alt 1", "Alt 2"],
            "attempts": 1,
            "last_feedback": None,
            "created_at": "2024-01-15T10:00:00Z",
            "metadata": {},
        },
        {
            "id": "review-2",
            "doc_id": 2,
            "doc_title": "Another Document",
            "type": "document_type",
            "suggestion": "Invoice",
            "reasoning": "Contains invoice details",
            "alternatives": ["Receipt", "Bill"],
            "attempts": 2,
            "last_feedback": "Try again with more context",
            "created_at": "2024-01-15T11:00:00Z",
            "metadata": {},
        },
    ]


def sample_pending_counts() -> dict[str, int]:
    """Generate sample pending review counts."""
    return {
        "correspondent": 3,
        "document_type": 2,
        "tag": 1,
        "total": 6,
        "schema_correspondent": 0,
        "schema_document_type": 0,
        "schema_tag": 0,
        "schema_custom_field": 0,
        "schema_cleanup": 0,
        "metadata_description": 0,
    }


def sample_tag_metadata() -> dict[str, Any]:
    """Generate sample tag metadata."""
    return {
        "id": 1,
        "paperless_tag_id": 1,
        "tag_name": "important",
        "description": "Documents requiring attention",
        "category": "priority",
        "exclude_from_ai": False,
    }


def sample_llm_response() -> str:
    """Generate a sample LLM response."""
    return """{
        "suggestion": "Test Correspondent",
        "reasoning": "Based on the document header and content analysis.",
        "confidence": 0.85,
        "alternatives": ["Alternative 1", "Alternative 2"]
    }"""


def sample_settings() -> dict[str, Any]:
    """Generate sample application settings."""
    return {
        "paperless_url": "http://localhost:8000",
        "paperless_token": "test-token",
        "ollama_url": "http://localhost:11434",
        "ollama_model_large": "llama3:latest",
        "ollama_model_small": "llama3:8b",
        "ollama_model_translation": "",
        "qdrant_url": "http://localhost:6333",
        "qdrant_collection": "paperless-documents",
        "auto_processing_enabled": False,
        "auto_processing_interval_minutes": 10,
        "prompt_language": "en",
        "pipeline_ocr": True,
        "pipeline_title": True,
        "pipeline_correspondent": True,
        "pipeline_tags": True,
        "pipeline_custom_fields": False,
        "confirmation_max_retries": 3,
        "tags": {
            "pending": "llm-pending",
            "ocr_done": "llm-ocr-done",
            "correspondent_done": "llm-correspondent-done",
            "document_type_done": "llm-document-type-done",
            "title_done": "llm-title-done",
            "tags_done": "llm-tags-done",
            "processed": "llm-processed",
        },
    }


# ===========================================================================
# Utility Fixtures
# ===========================================================================


@pytest.fixture
def sample_doc() -> dict[str, Any]:
    """Provide a sample document for tests."""
    return sample_document()


@pytest.fixture
def sample_stats() -> dict[str, int]:
    """Provide sample queue stats for tests."""
    return sample_queue_stats()


@pytest.fixture
def sample_config() -> dict[str, Any]:
    """Provide sample settings for tests."""
    return sample_settings()
