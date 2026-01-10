"""
Tests for the Title Agent.

This module tests the TitleAgent functionality:
- Title analysis and generation
- Confirmation loop behavior
- Title application
- Similar document handling
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])


# ===========================================================================
# Agent Initialization Tests
# ===========================================================================


class TestTitleAgentInit:
    """Test TitleAgent initialization."""

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
    def test_agent_initializes_with_settings(self, mock_small, mock_large, mock_settings):
        """Test that agent initializes with correct settings."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.title_agent import TitleAgent

        agent = TitleAgent()
        assert agent.settings is not None
        assert agent.large_model is not None
        assert agent.small_model is not None

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
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

        from agents.title_agent import TitleAgent

        with patch("agents.title_agent.QdrantService"):
            agent = TitleAgent()
            assert agent.qdrant is not None

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
    def test_agent_skips_qdrant_when_disabled(self, mock_small, mock_large, mock_settings):
        """Test that Qdrant is not initialized when disabled."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.title_agent import TitleAgent

        agent = TitleAgent()
        assert agent.qdrant is None


# ===========================================================================
# Title Analysis Tests
# ===========================================================================


class TestTitleAnalysis:
    """Test title analysis functionality."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mocked TitleAgent."""
        with (
            patch("agents.title_agent.get_settings") as mock_settings,
            patch("agents.title_agent.get_large_model") as mock_large,
            patch("agents.title_agent.get_small_model") as mock_small,
        ):
            mock_settings.return_value = MagicMock(
                paperless_url="http://localhost:8000",
                paperless_token="test-token",
                vector_search_enabled=False,
                confirmation_max_retries=3,
                tag_document_type_done="llm-document-type-done",
                tag_title_done="llm-title-done",
            )
            mock_large.return_value = MagicMock()
            mock_small.return_value = MagicMock()

            from agents.title_agent import TitleAgent

            return TitleAgent()

    @pytest.mark.asyncio
    async def test_process_returns_dict_for_sync(self, mock_agent):
        """Test that sync process returns a dictionary."""
        # Mock the internal methods
        mock_agent._analyze_title = AsyncMock(
            return_value=MagicMock(
                suggested_title="Invoice 2024-001",
                reasoning="Based on document content",
                confidence=0.9,
            )
        )
        mock_agent._confirm_title = AsyncMock(
            return_value=MagicMock(
                confirmed=True,
                feedback=None,
            )
        )
        mock_agent._apply_title = AsyncMock()

        result = await mock_agent._process_sync(1, "Sample document content")

        assert isinstance(result, dict)
        assert "doc_id" in result
        assert "success" in result

    @pytest.mark.asyncio
    async def test_process_handles_confirmation_loop(self, mock_agent):
        """Test that process handles confirmation loop correctly."""
        # First attempt rejected, second confirmed
        mock_agent._analyze_title = AsyncMock(
            return_value=MagicMock(
                suggested_title="Invoice 2024-001",
                reasoning="Based on content",
                confidence=0.9,
            )
        )
        mock_agent._confirm_title = AsyncMock(
            side_effect=[
                MagicMock(confirmed=False, feedback="Title too generic"),
                MagicMock(confirmed=True, feedback=None),
            ]
        )
        mock_agent._apply_title = AsyncMock()

        result = await mock_agent._process_sync(1, "Content")

        assert result["success"] is True
        assert result["attempts"] == 2

    @pytest.mark.asyncio
    async def test_process_returns_needs_review_after_max_retries(self, mock_agent):
        """Test that process returns needs_review after max retries."""
        mock_agent._analyze_title = AsyncMock(
            return_value=MagicMock(
                suggested_title="Unclear Document",
                reasoning="Ambiguous content",
                confidence=0.5,
            )
        )
        mock_agent._confirm_title = AsyncMock(
            return_value=MagicMock(
                confirmed=False,
                feedback="Cannot determine appropriate title",
            )
        )

        result = await mock_agent._process_sync(1, "Ambiguous content")

        assert result["success"] is False
        assert result["needs_review"] is True
        assert result["attempts"] == 3  # max_retries


# ===========================================================================
# Default Prompt Tests
# ===========================================================================


class TestDefaultPrompts:
    """Test default prompt methods."""

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
    def test_default_title_prompt_content(self, mock_small, mock_large, mock_settings):
        """Test that default title prompt has expected content."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.title_agent import TitleAgent

        agent = TitleAgent()
        prompt = agent._default_title_prompt()

        assert "title" in prompt.lower()
        assert "document" in prompt.lower()

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
    def test_default_confirmation_prompt_content(self, mock_small, mock_large, mock_settings):
        """Test that default confirmation prompt has expected content."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.title_agent import TitleAgent

        agent = TitleAgent()
        prompt = agent._default_confirmation_prompt()

        assert "quality" in prompt.lower() or "review" in prompt.lower()


# ===========================================================================
# Streaming Tests
# ===========================================================================


class TestTitleAgentStreaming:
    """Test streaming functionality."""

    @patch("agents.title_agent.get_settings")
    @patch("agents.title_agent.get_large_model")
    @patch("agents.title_agent.get_small_model")
    def test_process_stream_returns_generator(self, mock_small, mock_large, mock_settings):
        """Test that stream mode returns async generator."""
        mock_settings.return_value = MagicMock(
            paperless_url="http://localhost:8000",
            paperless_token="test-token",
            vector_search_enabled=False,
        )
        mock_large.return_value = MagicMock()
        mock_small.return_value = MagicMock()

        from agents.title_agent import TitleAgent

        agent = TitleAgent()
        result = agent._process_stream(1, "Content")

        # Should be an async generator
        import inspect

        assert inspect.isasyncgen(result)
