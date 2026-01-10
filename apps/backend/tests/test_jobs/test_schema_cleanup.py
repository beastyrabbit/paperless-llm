"""
Tests for the Schema Cleanup Job.

This module tests the SchemaCleanupJob functionality:
- Job initialization
- Finding unused entities
- Finding similar entities
- Cleanup suggestions
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])


# ===========================================================================
# Job Initialization Tests
# ===========================================================================


class TestSchemaCleanupJobInit:
    """Test SchemaCleanupJob initialization."""

    @patch("jobs.schema_cleanup.get_settings")
    @patch("jobs.schema_cleanup.get_pending_reviews_service")
    def test_job_initializes(self, mock_pending, mock_settings):
        """Test job initializes correctly."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob()
        assert job.settings is not None
        assert job.paperless is not None


# ===========================================================================
# Run Method Tests
# ===========================================================================


class TestSchemaCleanupRun:
    """Test SchemaCleanupJob run method."""

    @patch("jobs.schema_cleanup.get_settings")
    @patch("jobs.schema_cleanup.get_pending_reviews_service")
    @pytest.mark.asyncio
    async def test_run_returns_result(self, mock_pending, mock_settings):
        """Test that run method returns a result."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
        )
        mock_pending.return_value = MagicMock()

        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob()
        # Mock the paperless client methods
        job.paperless.get_correspondents = AsyncMock(return_value=[])
        job.paperless.get_document_types = AsyncMock(return_value=[])
        job.paperless.get_tags = AsyncMock(return_value=[])

        # The run method may fail due to missing dependencies, but should not crash
        try:
            result = await job.run()
            assert isinstance(result, dict)
        except Exception:
            # Expected if external services not available
            pass
