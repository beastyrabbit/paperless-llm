"""Tests for Bootstrap Analysis Job."""

from unittest.mock import MagicMock

import pytest

from jobs.bootstrap_analysis import (
    BootstrapAnalysisJob,
    BootstrapStatus,
    ProgressUpdate,
)
from services.pending_reviews import PendingReviewItem


class TestBootstrapAnalysisJob:
    """Tests for BootstrapAnalysisJob class."""

    def test_queue_suggestion_uses_valid_types(self):
        """Test that _queue_suggestion uses valid PendingReviewType values."""
        # Valid PendingReviewType values for schema suggestions
        valid_types = [
            "schema_correspondent",
            "schema_document_type",
            "schema_tag",
            "schema_custom_field",
        ]

        # Entity types from schema analysis
        entity_types = ["correspondent", "document_type", "tag"]

        # Map used in bootstrap analysis
        type_map = {
            "correspondent": "schema_correspondent",
            "document_type": "schema_document_type",
            "tag": "schema_tag",
        }

        # Verify all mapped types are valid
        for entity_type in entity_types:
            mapped_type = type_map.get(entity_type)
            assert mapped_type in valid_types, (
                f"Entity type '{entity_type}' maps to '{mapped_type}' "
                f"which is not a valid PendingReviewType"
            )

    def test_pending_review_type_validation(self):
        """Test that PendingReviewItem accepts schema_ prefixed types."""
        # This should not raise a validation error
        item = PendingReviewItem(
            id="test123",
            doc_id=1,
            doc_title="Test Document",
            type="schema_correspondent",
            suggestion="Test Correspondent",
            reasoning="Test reasoning",
        )
        assert item.type == "schema_correspondent"

        item2 = PendingReviewItem(
            id="test456",
            doc_id=2,
            doc_title="Test Document 2",
            type="schema_document_type",
            suggestion="Test Document Type",
            reasoning="Test reasoning",
        )
        assert item2.type == "schema_document_type"

        item3 = PendingReviewItem(
            id="test789",
            doc_id=3,
            doc_title="Test Document 3",
            type="schema_tag",
            suggestion="Test Tag",
            reasoning="Test reasoning",
        )
        assert item3.type == "schema_tag"

    def test_pending_review_type_rejects_invalid_types(self):
        """Test that PendingReviewItem rejects invalid types like bootstrap_."""
        from pydantic import ValidationError

        # This should raise a validation error
        with pytest.raises(ValidationError) as exc_info:
            PendingReviewItem(
                id="test123",
                doc_id=1,
                doc_title="Test Document",
                type="bootstrap_correspondent",  # Invalid type
                suggestion="Test",
                reasoning="Test",
            )

        assert "type" in str(exc_info.value)
        assert "literal_error" in str(exc_info.value)

    def test_filter_by_type_all(self):
        """Test filtering when analysis_type is 'all'."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.analysis_type = "all"

        suggestions = [
            {"entity_type": "correspondent", "suggested_name": "Test1"},
            {"entity_type": "document_type", "suggested_name": "Test2"},
            {"entity_type": "tag", "suggested_name": "Test3"},
        ]

        filtered = job._filter_by_type(suggestions)
        assert len(filtered) == 3

    def test_filter_by_type_correspondents(self):
        """Test filtering when analysis_type is 'correspondents'."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.analysis_type = "correspondents"

        suggestions = [
            {"entity_type": "correspondent", "suggested_name": "Test1"},
            {"entity_type": "document_type", "suggested_name": "Test2"},
            {"entity_type": "tag", "suggested_name": "Test3"},
        ]

        filtered = job._filter_by_type(suggestions)
        assert len(filtered) == 1
        assert filtered[0]["entity_type"] == "correspondent"

    def test_filter_by_type_document_types(self):
        """Test filtering when analysis_type is 'document_types'."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.analysis_type = "document_types"

        suggestions = [
            {"entity_type": "correspondent", "suggested_name": "Test1"},
            {"entity_type": "document_type", "suggested_name": "Test2"},
            {"entity_type": "tag", "suggested_name": "Test3"},
        ]

        filtered = job._filter_by_type(suggestions)
        assert len(filtered) == 1
        assert filtered[0]["entity_type"] == "document_type"

    def test_filter_by_type_tags(self):
        """Test filtering when analysis_type is 'tags'."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.analysis_type = "tags"

        suggestions = [
            {"entity_type": "correspondent", "suggested_name": "Test1"},
            {"entity_type": "document_type", "suggested_name": "Test2"},
            {"entity_type": "tag", "suggested_name": "Test3"},
        ]

        filtered = job._filter_by_type(suggestions)
        assert len(filtered) == 1
        assert filtered[0]["entity_type"] == "tag"

    def test_progress_update_model(self):
        """Test ProgressUpdate model defaults."""
        progress = ProgressUpdate(status=BootstrapStatus.IDLE)
        assert progress.status == BootstrapStatus.IDLE
        assert progress.total == 0
        assert progress.processed == 0
        assert progress.suggestions_found == 0
        assert progress.errors == 0

    def test_is_running_class_method(self):
        """Test is_running class method when no job exists."""
        # Reset class state
        BootstrapAnalysisJob._current_job = None

        # Should not be running when no job exists
        import asyncio

        result = asyncio.get_event_loop().run_until_complete(BootstrapAnalysisJob.is_running())
        assert result is False


class TestQueueSuggestionIntegration:
    """Integration tests for queue suggestion with PendingReviewsService."""

    @pytest.fixture
    def mock_pending_service(self):
        """Create a mock pending reviews service."""
        return MagicMock()

    @pytest.mark.asyncio
    async def test_queue_correspondent_suggestion(self, mock_pending_service):
        """Test queuing a correspondent suggestion."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        suggestion = {
            "entity_type": "correspondent",
            "suggested_name": "Test Company",
            "reasoning": "Found in document header",
            "confidence": 0.9,
            "similar_to_existing": ["Similar Co"],
        }

        await job._queue_suggestion(
            doc_id=123,
            doc_title="Test Invoice",
            suggestion=suggestion,
        )

        # Verify the pending service was called with correct type
        mock_pending_service.add.assert_called_once()
        call_kwargs = mock_pending_service.add.call_args[1]

        # Bootstrap uses doc_id=0 to indicate multi-document suggestions
        assert call_kwargs["doc_id"] == 0
        assert "Bootstrap: Test Invoice" in call_kwargs["doc_title"]
        assert call_kwargs["item_type"] == "schema_correspondent"
        assert call_kwargs["suggestion"] == "Test Company"
        assert call_kwargs["reasoning"] == "Found in document header"
        assert call_kwargs["alternatives"] == ["Similar Co"]
        assert call_kwargs["attempts"] == 1
        assert call_kwargs["metadata"]["entity_type"] == "correspondent"
        assert call_kwargs["metadata"]["source"] == "bootstrap_analysis"
        assert call_kwargs["metadata"]["first_doc_id"] == 123
        assert call_kwargs["metadata"]["occurrence_count"] == 1

    @pytest.mark.asyncio
    async def test_queue_document_type_suggestion(self, mock_pending_service):
        """Test queuing a document type suggestion."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        suggestion = {
            "entity_type": "document_type",
            "suggested_name": "Contract",
            "reasoning": "Legal document format",
            "confidence": 0.85,
            "similar_to_existing": [],
        }

        await job._queue_suggestion(
            doc_id=456,
            doc_title="Agreement.pdf",
            suggestion=suggestion,
        )

        call_kwargs = mock_pending_service.add.call_args[1]
        assert call_kwargs["item_type"] == "schema_document_type"

    @pytest.mark.asyncio
    async def test_queue_tag_suggestion(self, mock_pending_service):
        """Test queuing a tag suggestion."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        suggestion = {
            "entity_type": "tag",
            "suggested_name": "urgent",
            "reasoning": "Document mentions deadline",
            "confidence": 0.75,
            "similar_to_existing": ["important"],
        }

        await job._queue_suggestion(
            doc_id=789,
            doc_title="Deadline Notice",
            suggestion=suggestion,
        )

        call_kwargs = mock_pending_service.add.call_args[1]
        assert call_kwargs["item_type"] == "schema_tag"

    @pytest.mark.asyncio
    async def test_queue_duplicate_suggestion_increments_attempts(self, mock_pending_service):
        """Test that duplicate suggestions increment the attempts counter."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        suggestion = {
            "entity_type": "correspondent",
            "suggested_name": "Amazon",
            "reasoning": "Found in document",
            "confidence": 0.9,
            "similar_to_existing": [],
        }

        # First call - should be new
        result1 = await job._queue_suggestion(
            doc_id=1,
            doc_title="Invoice 1",
            suggestion=suggestion,
        )
        assert result1 is True  # New suggestion

        # Verify tracking was updated
        assert "correspondent:amazon" in job._suggestion_counts
        assert job._suggestion_counts["correspondent:amazon"] == 1
        assert "Amazon" in job._pending_suggestions["correspondent"]

        # Second call with same suggestion - should be duplicate
        result2 = await job._queue_suggestion(
            doc_id=2,
            doc_title="Invoice 2",
            suggestion=suggestion,
        )
        assert result2 is False  # Duplicate

        # Verify attempts were incremented
        assert job._suggestion_counts["correspondent:amazon"] == 2

        # Third call
        result3 = await job._queue_suggestion(
            doc_id=3,
            doc_title="Invoice 3",
            suggestion=suggestion,
        )
        assert result3 is False
        assert job._suggestion_counts["correspondent:amazon"] == 3

        # Verify the last call had the correct occurrence count
        last_call_kwargs = mock_pending_service.add.call_args[1]
        assert last_call_kwargs["attempts"] == 3
        assert last_call_kwargs["metadata"]["occurrence_count"] == 3
        assert "Multiple documents (3 occurrences)" in last_call_kwargs["doc_title"]

    @pytest.mark.asyncio
    async def test_pending_suggestions_passed_to_tracking(self, mock_pending_service):
        """Test that new suggestions are added to pending_suggestions for agent context."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        # Queue different types
        await job._queue_suggestion(
            doc_id=1,
            doc_title="Test",
            suggestion={
                "entity_type": "correspondent",
                "suggested_name": "Company A",
                "reasoning": "Test",
                "confidence": 0.9,
                "similar_to_existing": [],
            },
        )
        await job._queue_suggestion(
            doc_id=2,
            doc_title="Test",
            suggestion={
                "entity_type": "document_type",
                "suggested_name": "Invoice",
                "reasoning": "Test",
                "confidence": 0.9,
                "similar_to_existing": [],
            },
        )
        await job._queue_suggestion(
            doc_id=3,
            doc_title="Test",
            suggestion={
                "entity_type": "tag",
                "suggested_name": "finance",
                "reasoning": "Test",
                "confidence": 0.9,
                "similar_to_existing": [],
            },
        )

        # Verify pending_suggestions was populated for each type
        assert "Company A" in job._pending_suggestions["correspondent"]
        assert "Invoice" in job._pending_suggestions["document_type"]
        assert "finance" in job._pending_suggestions["tag"]

    @pytest.mark.asyncio
    async def test_increment_pending_match(self, mock_pending_service):
        """Test that matches_pending from agent correctly increment counts."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        job._progress = ProgressUpdate(status=BootstrapStatus.RUNNING)

        # First, create an initial suggestion
        await job._queue_suggestion(
            doc_id=1,
            doc_title="Invoice 1",
            suggestion={
                "entity_type": "correspondent",
                "suggested_name": "Amazon",
                "reasoning": "Found in document",
                "confidence": 0.9,
                "similar_to_existing": [],
            },
        )
        assert job._suggestion_counts["correspondent:amazon"] == 1

        # Now simulate the agent reporting a match (instead of a new suggestion)
        job._increment_pending_match(
            {
                "entity_type": "correspondent",
                "matched_name": "Amazon",
            }
        )
        assert job._suggestion_counts["correspondent:amazon"] == 2

        # Another match
        job._increment_pending_match(
            {
                "entity_type": "correspondent",
                "matched_name": "Amazon",
            }
        )
        assert job._suggestion_counts["correspondent:amazon"] == 3

        # Verify pending service was called to update
        # Last call should have attempts=3
        last_call_kwargs = mock_pending_service.add.call_args[1]
        assert last_call_kwargs["attempts"] == 3
        assert last_call_kwargs["metadata"]["occurrence_count"] == 3

    def test_increment_pending_match_ignores_unknown(self, mock_pending_service):
        """Test that matches for unknown items are ignored."""
        job = BootstrapAnalysisJob.__new__(BootstrapAnalysisJob)
        job.pending = mock_pending_service
        job.analysis_type = "all"
        job._suggestion_counts = {}
        job._pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}

        # Try to increment a match that was never suggested
        job._increment_pending_match(
            {
                "entity_type": "correspondent",
                "matched_name": "Unknown Company",
            }
        )

        # Should not have added anything
        assert "correspondent:unknown company" not in job._suggestion_counts
        mock_pending_service.add.assert_not_called()
