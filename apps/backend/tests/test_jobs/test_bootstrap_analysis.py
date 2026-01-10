"""
Tests for the Bootstrap Analysis Job.

This module tests the BootstrapAnalysisJob functionality:
- Job initialization
- Running and status tracking
- Cancellation
- Skipping documents
- Progress updates
"""

import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])


# ===========================================================================
# Job Initialization Tests
# ===========================================================================


class TestBootstrapJobInit:
    """Test BootstrapAnalysisJob initialization."""

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    def test_job_initializes_with_defaults(self, mock_pending, mock_settings):
        """Test job initializes with default settings."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob, BootstrapStatus

        job = BootstrapAnalysisJob()

        assert job.analysis_type == "all"
        assert job._cancelled is False
        assert job._skip_count == 0
        assert job._progress.status == BootstrapStatus.IDLE

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    def test_job_initializes_with_specific_type(self, mock_pending, mock_settings):
        """Test job initializes with specific analysis type."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob

        job = BootstrapAnalysisJob(analysis_type="correspondents")
        assert job.analysis_type == "correspondents"

        job2 = BootstrapAnalysisJob(analysis_type="document_types")
        assert job2.analysis_type == "document_types"

        job3 = BootstrapAnalysisJob(analysis_type="tags")
        assert job3.analysis_type == "tags"


# ===========================================================================
# Status Management Tests
# ===========================================================================


class TestBootstrapStatusManagement:
    """Test job status management."""

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_is_running_false_when_idle(self, mock_pending, mock_settings):
        """Test is_running returns False when no job is running."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob

        # Reset class state
        BootstrapAnalysisJob._current_job = None

        assert await BootstrapAnalysisJob.is_running() is False

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_get_current_job_returns_none_when_idle(self, mock_pending, mock_settings):
        """Test get_current_job returns None when no job is running."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob

        # Reset class state
        BootstrapAnalysisJob._current_job = None

        result = await BootstrapAnalysisJob.get_current_job()
        assert result is None


# ===========================================================================
# Cancellation Tests
# ===========================================================================


class TestBootstrapCancellation:
    """Test job cancellation functionality."""

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_cancel_when_no_job(self, mock_pending, mock_settings):
        """Test cancellation returns False when no job is running."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob

        # Reset class state
        BootstrapAnalysisJob._current_job = None

        result = await BootstrapAnalysisJob.cancel_current()
        assert result is False


# ===========================================================================
# Skip Document Tests
# ===========================================================================


class TestBootstrapSkipDocument:
    """Test document skipping functionality."""

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_skip_when_no_job(self, mock_pending, mock_settings):
        """Test skipping returns False when no job is running."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob

        # Reset class state
        BootstrapAnalysisJob._current_job = None

        result = await BootstrapAnalysisJob.skip_current_document()
        assert result is False

    @patch("jobs.bootstrap_analysis.get_settings")
    @patch("jobs.bootstrap_analysis.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_skip_count_increments(self, mock_pending, mock_settings):
        """Test skip count increments correctly."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.bootstrap_analysis import BootstrapAnalysisJob, BootstrapStatus

        job = BootstrapAnalysisJob()
        job._progress.status = BootstrapStatus.RUNNING
        BootstrapAnalysisJob._current_job = job

        # Initial skip count
        assert job._skip_count == 0

        # Skip one
        await BootstrapAnalysisJob.skip_current_document(1)
        assert job._skip_count == 1

        # Skip 10
        await BootstrapAnalysisJob.skip_current_document(10)
        assert job._skip_count == 11

        # Cleanup
        BootstrapAnalysisJob._current_job = None


# ===========================================================================
# Progress Update Tests
# ===========================================================================


class TestProgressUpdate:
    """Test progress update model."""

    def test_progress_update_defaults(self):
        """Test ProgressUpdate has correct defaults."""
        from jobs.bootstrap_analysis import BootstrapStatus, ProgressUpdate

        progress = ProgressUpdate(status=BootstrapStatus.IDLE)

        assert progress.status == BootstrapStatus.IDLE
        assert progress.total == 0
        assert progress.processed == 0
        assert progress.skipped == 0
        assert progress.current_doc_id is None
        assert progress.suggestions_found == 0
        assert progress.errors == 0

    def test_suggestions_by_type_defaults(self):
        """Test SuggestionsByType has correct defaults."""
        from jobs.bootstrap_analysis import SuggestionsByType

        suggestions = SuggestionsByType()

        assert suggestions.correspondents == 0
        assert suggestions.document_types == 0
        assert suggestions.tags == 0


# ===========================================================================
# Bootstrap Status Enum Tests
# ===========================================================================


class TestBootstrapStatus:
    """Test BootstrapStatus enum."""

    def test_status_values(self):
        """Test all expected status values exist."""
        from jobs.bootstrap_analysis import BootstrapStatus

        assert BootstrapStatus.IDLE == "idle"
        assert BootstrapStatus.RUNNING == "running"
        assert BootstrapStatus.COMPLETED == "completed"
        assert BootstrapStatus.CANCELLED == "cancelled"
        assert BootstrapStatus.FAILED == "failed"
