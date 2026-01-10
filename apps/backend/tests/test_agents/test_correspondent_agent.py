"""
Tests for the Correspondent Agent.

This module tests the CorrespondentAgent functionality:
- Correspondent identification and matching
- Confirmation loop behavior
- New correspondent handling
- Similar document context
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])


# ===========================================================================
# Agent Initialization Tests
# ===========================================================================


class TestCorrespondentAgentInit:
    """Test CorrespondentAgent initialization."""

    @patch("agents.correspondent_agent.get_settings")
    @patch("agents.correspondent_agent.get_large_model")
    @patch("agents.correspondent_agent.get_small_model")
    def test_agent_initializes_with_settings(self, mock_small, mock_large, mock_settings):
        """Test that agent initializes with correct settings."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.correspondent_agent import CorrespondentAgent

        agent = CorrespondentAgent()
        assert agent.settings is not None
        assert agent.large_model is not None
        assert agent.small_model is not None
        assert agent.paperless is not None

    @patch("agents.correspondent_agent.get_settings")
    @patch("agents.correspondent_agent.get_large_model")
    @patch("agents.correspondent_agent.get_small_model")
    def test_agent_initializes_qdrant_when_enabled(self, mock_small, mock_large, mock_settings):
        """Test that Qdrant is initialized when vector search is enabled."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=True,
            qdrant_url="http://localhost:6333",
            qdrant_collection="documents",
            ollama_url="http://localhost:11434",
            ollama_embedding_model="nomic-embed-text",
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.correspondent_agent import CorrespondentAgent

        with patch("agents.correspondent_agent.QdrantService"):
            agent = CorrespondentAgent()
            assert agent.qdrant is not None


# ===========================================================================
# Correspondent Analysis Tests
# ===========================================================================


class TestCorrespondentAnalysis:
    """Test correspondent analysis functionality."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mocked CorrespondentAgent."""
        with (
            patch("agents.correspondent_agent.get_settings") as mock_settings,
            patch("agents.correspondent_agent.get_large_model") as mock_large,
            patch("agents.correspondent_agent.get_small_model") as mock_small,
        ):
            mock_settings.return_value = MagicMock(
                paperless_url="http://localhost:8000",
                paperless_token="test-token",
                vector_search_enabled=False,
                confirmation_max_retries=3,
                confirmation_require_user_for_new_entities=True,
                tag_ocr_done="llm-ocr-done",
                tag_correspondent_done="llm-correspondent-done",
            )
            mock_large.return_value = MagicMock()
            mock_small.return_value = MagicMock()

            from agents.correspondent_agent import CorrespondentAgent

            agent = CorrespondentAgent()
            # Mock the paperless client
            agent.paperless = MagicMock()
            agent.paperless.get_correspondents = AsyncMock(
                return_value=[
                    {"id": 1, "name": "Amazon"},
                    {"id": 2, "name": "Deutsche Bank"},
                ]
            )
            return agent

    @pytest.mark.asyncio
    async def test_process_matches_existing_correspondent(self, mock_agent):
        """Test matching an existing correspondent."""
        mock_agent._analyze_correspondent = AsyncMock(
            return_value=MagicMock(
                suggested_correspondent="Amazon",
                is_new=False,
                reasoning="Matches existing correspondent",
                confidence=0.95,
                alternatives=[],
            )
        )
        mock_agent._confirm_correspondent = AsyncMock(
            return_value=MagicMock(
                confirmed=True,
                feedback=None,
            )
        )
        mock_agent.paperless.update_document = AsyncMock()
        mock_agent.paperless.remove_tag_from_document = AsyncMock()
        mock_agent.paperless.add_tag_to_document = AsyncMock()

        result = await mock_agent.process(1, "Invoice from Amazon")

        assert result["success"] is True
        assert result["correspondent"] == "Amazon"
        assert result["is_new"] is False

    @pytest.mark.asyncio
    async def test_process_queues_new_correspondent_for_review(self, mock_agent):
        """Test that new correspondents are queued for review when required."""
        mock_agent._analyze_correspondent = AsyncMock(
            return_value=MagicMock(
                suggested_correspondent="New Company Inc",
                is_new=True,
                reasoning="No matching correspondent found",
                confidence=0.8,
                alternatives=["Another Company"],
            )
        )
        mock_agent._confirm_correspondent = AsyncMock(
            return_value=MagicMock(
                confirmed=True,
                feedback=None,
            )
        )
        mock_agent.paperless.get_document = AsyncMock(
            return_value={"id": 1, "title": "Test Document"}
        )

        with patch("agents.correspondent_agent.get_pending_reviews_service") as mock_pending:
            mock_service = MagicMock()
            mock_pending.return_value = mock_service

            result = await mock_agent.process(1, "Invoice from New Company Inc")

            assert result["needs_review"] is True
            assert result["queued_for_review"] is True

    @pytest.mark.asyncio
    async def test_process_handles_confirmation_rejection(self, mock_agent):
        """Test handling of confirmation rejection."""
        mock_agent._analyze_correspondent = AsyncMock(
            return_value=MagicMock(
                suggested_correspondent="Ambiguous Corp",
                is_new=False,
                reasoning="May be related",
                confidence=0.6,
                alternatives=["Other Corp"],
            )
        )
        mock_agent._confirm_correspondent = AsyncMock(
            return_value=MagicMock(
                confirmed=False,
                feedback="Correspondent unclear",
            )
        )

        result = await mock_agent.process(1, "Ambiguous content")

        assert result["success"] is False
        assert result["needs_review"] is True


# ===========================================================================
# Default Prompt Tests
# ===========================================================================


class TestDefaultPrompts:
    """Test default prompt methods."""

    @patch("agents.correspondent_agent.get_settings")
    @patch("agents.correspondent_agent.get_large_model")
    @patch("agents.correspondent_agent.get_small_model")
    def test_default_prompt_content(self, mock_small, mock_large, mock_settings):
        """Test that default prompt has expected content."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.correspondent_agent import CorrespondentAgent

        agent = CorrespondentAgent()
        prompt = agent._default_prompt()

        assert "correspondent" in prompt.lower()
        assert "document" in prompt.lower()
        assert "sender" in prompt.lower() or "organization" in prompt.lower()

    @patch("agents.correspondent_agent.get_settings")
    @patch("agents.correspondent_agent.get_large_model")
    @patch("agents.correspondent_agent.get_small_model")
    def test_default_confirmation_prompt_content(self, mock_small, mock_large, mock_settings):
        """Test that default confirmation prompt has expected content."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.correspondent_agent import CorrespondentAgent

        agent = CorrespondentAgent()
        prompt = agent._default_confirmation_prompt()

        assert "quality" in prompt.lower() or "verify" in prompt.lower()


# ===========================================================================
# Apply Correspondent Tests
# ===========================================================================


class TestApplyCorrespondent:
    """Test correspondent application logic."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mocked CorrespondentAgent."""
        with (
            patch("agents.correspondent_agent.get_settings") as mock_settings,
            patch("agents.correspondent_agent.get_large_model") as mock_large,
            patch("agents.correspondent_agent.get_small_model") as mock_small,
        ):
            mock_settings.return_value = MagicMock(
                paperless_url="http://localhost:8000",
                paperless_token="test-token",
                vector_search_enabled=False,
                confirmation_require_user_for_new_entities=False,
                tag_ocr_done="llm-ocr-done",
                tag_correspondent_done="llm-correspondent-done",
            )
            mock_large.return_value = MagicMock()
            mock_small.return_value = MagicMock()

            from agents.correspondent_agent import CorrespondentAgent

            agent = CorrespondentAgent()
            agent.paperless = MagicMock()
            agent.paperless.update_document = AsyncMock()
            agent.paperless.remove_tag_from_document = AsyncMock()
            agent.paperless.add_tag_to_document = AsyncMock()
            agent.paperless.get_or_create_correspondent = AsyncMock(return_value=5)
            return agent

    @pytest.mark.asyncio
    async def test_apply_existing_correspondent(self, mock_agent):
        """Test applying an existing correspondent."""
        analysis = MagicMock(
            suggested_correspondent="Amazon",
            is_new=False,
        )
        existing = [
            {"id": 1, "name": "Amazon"},
            {"id": 2, "name": "Deutsche Bank"},
        ]

        result = await mock_agent._apply_correspondent(1, analysis, existing)

        assert result["applied"] is True
        assert result["correspondent_id"] == 1

    @pytest.mark.asyncio
    async def test_apply_new_correspondent_auto_create(self, mock_agent):
        """Test auto-creating a new correspondent when allowed."""
        analysis = MagicMock(
            suggested_correspondent="New Corp",
            is_new=True,
        )
        existing = []

        result = await mock_agent._apply_correspondent(1, analysis, existing)

        assert result["applied"] is True
        assert result["correspondent_id"] == 5  # From mock

    @pytest.mark.asyncio
    async def test_apply_correspondent_not_found(self, mock_agent):
        """Test when correspondent not found in existing list."""
        analysis = MagicMock(
            suggested_correspondent="Unknown Corp",
            is_new=False,  # Claims it's not new but not in list
        )
        existing = [
            {"id": 1, "name": "Amazon"},
        ]

        result = await mock_agent._apply_correspondent(1, analysis, existing)

        assert result["applied"] is False
        assert "not found" in result.get("reason", "").lower()
