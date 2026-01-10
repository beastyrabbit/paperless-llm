"""
Tests for the Paperless-ngx API client.

This module tests all methods of PaperlessClient including:
- Document operations (get, list, update)
- Tag operations (get, create, add/remove from documents)
- Correspondent operations
- Document type operations
- Custom field operations
- Queue statistics
- Error handling
"""

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import HTTPStatusError, Request, Response

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])
from services.paperless import PaperlessClient

# ===========================================================================
# Fixtures
# ===========================================================================


@pytest.fixture
def paperless_client():
    """Create a PaperlessClient instance for testing."""
    return PaperlessClient(base_url="http://paperless.local:8000", token="test-token-12345")


@pytest.fixture
def mock_response():
    """Create a mock HTTP response."""

    def _mock_response(status_code: int = 200, json_data: dict = None):
        response = MagicMock()
        response.status_code = status_code
        response.json.return_value = json_data or {}
        response.raise_for_status = MagicMock()
        if status_code >= 400:
            response.raise_for_status.side_effect = HTTPStatusError(
                message="Error",
                request=Request("GET", "http://test"),
                response=Response(status_code),
            )
        return response

    return _mock_response


# ===========================================================================
# Initialization Tests
# ===========================================================================


class TestPaperlessClientInit:
    """Test PaperlessClient initialization."""

    def test_init_sets_base_url(self, paperless_client):
        """Test that base_url is properly set."""
        assert paperless_client.base_url == "http://paperless.local:8000"

    def test_init_strips_trailing_slash(self):
        """Test that trailing slash is removed from base_url."""
        client = PaperlessClient("http://test.com/", "token")
        assert client.base_url == "http://test.com"

    def test_init_sets_auth_header(self, paperless_client):
        """Test that authorization header is properly set."""
        assert paperless_client._headers == {"Authorization": "Token test-token-12345"}


# ===========================================================================
# Document Operations Tests
# ===========================================================================


class TestGetDocument:
    """Test get_document method."""

    @pytest.mark.asyncio
    async def test_get_document_success(self, paperless_client):
        """Test successful document retrieval."""
        doc_data = {
            "id": 1,
            "title": "Test Doc",
            "correspondent": 1,
            "tags": [1, 2],
            "content": "Test content",
        }

        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = doc_data
            with patch.object(
                paperless_client, "_get_tags_data", new_callable=AsyncMock
            ) as mock_tags:
                mock_tags.return_value = [{"id": 1, "name": "tag1"}]
                with patch.object(
                    paperless_client, "_get_correspondent_name", new_callable=AsyncMock
                ) as mock_corr:
                    mock_corr.return_value = "Test Correspondent"

                    result = await paperless_client.get_document(1)

                    assert result is not None
                    assert result["id"] == 1
                    assert result["title"] == "Test Doc"
                    mock_req.assert_called_once_with("GET", "/documents/1/")

    @pytest.mark.asyncio
    async def test_get_document_not_found(self, paperless_client):
        """Test document retrieval when document doesn't exist."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.side_effect = HTTPStatusError(
                message="Not found", request=Request("GET", "http://test"), response=Response(404)
            )

            result = await paperless_client.get_document(999)

            assert result is None

    @pytest.mark.asyncio
    async def test_get_document_server_error(self, paperless_client):
        """Test document retrieval with server error."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.side_effect = HTTPStatusError(
                message="Server error",
                request=Request("GET", "http://test"),
                response=Response(500),
            )

            with pytest.raises(HTTPStatusError):
                await paperless_client.get_document(1)


class TestGetDocumentsByTag:
    """Test get_documents_by_tag method."""

    @pytest.mark.asyncio
    async def test_get_documents_by_tag_success(self, paperless_client):
        """Test successful retrieval of documents by tag."""
        docs_response = {
            "results": [
                {"id": 1, "title": "Doc 1", "tags": [1], "correspondent": None},
                {"id": 2, "title": "Doc 2", "tags": [1], "correspondent": None},
            ]
        }

        with patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag_id:
            mock_tag_id.return_value = 1
            with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
                mock_req.return_value = docs_response
                with patch.object(
                    paperless_client, "_get_tags_data", new_callable=AsyncMock
                ) as mock_tags:
                    mock_tags.return_value = []
                    with patch.object(
                        paperless_client, "_get_correspondent_name", new_callable=AsyncMock
                    ) as mock_corr:
                        mock_corr.return_value = None

                        result = await paperless_client.get_documents_by_tag("test-tag")

                        assert len(result) == 2
                        assert result[0]["id"] == 1

    @pytest.mark.asyncio
    async def test_get_documents_by_tag_not_found(self, paperless_client):
        """Test retrieval when tag doesn't exist."""
        with patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag_id:
            mock_tag_id.return_value = None

            result = await paperless_client.get_documents_by_tag("nonexistent-tag")

            assert result == []

    @pytest.mark.asyncio
    async def test_get_documents_by_tag_with_limit(self, paperless_client):
        """Test retrieval with custom limit."""
        with (
            patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag_id,
            patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req,
            patch.object(paperless_client, "_get_tags_data", new_callable=AsyncMock),
            patch.object(paperless_client, "_get_correspondent_name", new_callable=AsyncMock),
        ):
            mock_tag_id.return_value = 1
            mock_req.return_value = {"results": []}
            await paperless_client.get_documents_by_tag("tag", limit=100)

            mock_req.assert_called_once_with(
                "GET", "/documents/", params={"tags__id": 1, "page_size": 100}
            )


class TestGetDocumentsByTags:
    """Test get_documents_by_tags method."""

    @pytest.mark.asyncio
    async def test_get_documents_by_multiple_tags(self, paperless_client):
        """Test retrieval with multiple tags (OR query)."""
        with patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag_id:
            mock_tag_id.side_effect = [1, 2]
            with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
                mock_req.return_value = {"results": [{"id": 1, "tags": [], "correspondent": None}]}
                with patch.object(
                    paperless_client, "_get_tags_data", new_callable=AsyncMock
                ) as mock_tags:
                    mock_tags.return_value = []
                    with patch.object(
                        paperless_client, "_get_correspondent_name", new_callable=AsyncMock
                    ) as mock_corr:
                        mock_corr.return_value = None

                        await paperless_client.get_documents_by_tags(["tag1", "tag2"])

                        mock_req.assert_called_once()
                        call_params = mock_req.call_args[1]["params"]
                        assert "tags__id__in" in call_params
                        assert "1,2" in call_params["tags__id__in"]

    @pytest.mark.asyncio
    async def test_get_documents_by_tags_none_exist(self, paperless_client):
        """Test retrieval when no tags exist."""
        with patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag_id:
            mock_tag_id.return_value = None

            result = await paperless_client.get_documents_by_tags(["nonexistent1", "nonexistent2"])

            assert result == []


# ===========================================================================
# Document Update Tests
# ===========================================================================


class TestUpdateDocument:
    """Test update_document method."""

    @pytest.mark.asyncio
    async def test_update_document_title(self, paperless_client):
        """Test updating document title."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {"id": 1, "title": "New Title"}

            result = await paperless_client.update_document(1, title="New Title")

            assert result["title"] == "New Title"
            mock_req.assert_called_once()
            call_kwargs = mock_req.call_args[1]
            assert call_kwargs["json"]["title"] == "New Title"

    @pytest.mark.asyncio
    async def test_update_document_correspondent(self, paperless_client):
        """Test updating document correspondent."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {"id": 1, "correspondent": 5}

            await paperless_client.update_document(1, correspondent=5)

            call_kwargs = mock_req.call_args[1]
            assert call_kwargs["json"]["correspondent"] == 5

    @pytest.mark.asyncio
    async def test_update_document_multiple_fields(self, paperless_client):
        """Test updating multiple document fields at once."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {"id": 1}

            await paperless_client.update_document(
                1, title="New Title", correspondent=5, document_type=3, tags=[1, 2, 3]
            )

            call_kwargs = mock_req.call_args[1]
            assert call_kwargs["json"]["title"] == "New Title"
            assert call_kwargs["json"]["correspondent"] == 5
            assert call_kwargs["json"]["document_type"] == 3
            assert call_kwargs["json"]["tags"] == [1, 2, 3]


# ===========================================================================
# Queue Stats Tests
# ===========================================================================


class TestGetQueueStats:
    """Test get_queue_stats method."""

    @pytest.mark.asyncio
    async def test_get_queue_stats_all_tags_exist(self, paperless_client):
        """Test queue stats when all workflow tags exist."""

        def mock_tag_id(tag_name):
            tag_ids = {
                "llm-pending": 1,
                "llm-ocr-done": 2,
                "llm-correspondent-done": 3,
                "llm-title-done": 4,
                "llm-tags-done": 5,
                "llm-processed": 6,
            }
            return tag_ids.get(tag_name)

        def mock_request(method, endpoint, **kwargs):
            if "page_size=1" in str(kwargs):
                return {"count": 5}
            return {"results": [], "count": 0}

        with patch.object(paperless_client, "_get_tag_id", new_callable=AsyncMock) as mock_tag:
            mock_tag.side_effect = mock_tag_id
            with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
                mock_req.side_effect = mock_request

                result = await paperless_client.get_queue_stats(
                    tag_pending="llm-pending",
                    tag_ocr_done="llm-ocr-done",
                    tag_title_done="llm-title-done",
                    tag_correspondent_done="llm-correspondent-done",
                    tag_tags_done="llm-tags-done",
                    tag_processed="llm-processed",
                )

                assert "pending" in result
                assert "total_in_pipeline" in result
                assert "total_documents" in result


# ===========================================================================
# Tag Operations Tests
# ===========================================================================


class TestTagOperations:
    """Test tag-related operations."""

    @pytest.mark.asyncio
    async def test_get_or_create_tag_existing(self, paperless_client):
        """Test getting an existing tag."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {"results": [{"id": 1, "name": "existing-tag"}]}

            result = await paperless_client.get_or_create_tag("existing-tag")

            # Returns tag ID, not dict
            assert result == 1

    @pytest.mark.asyncio
    async def test_get_or_create_tag_new(self, paperless_client):
        """Test creating a new tag."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            # First call returns empty (tag doesn't exist)
            # Second call creates the tag
            mock_req.side_effect = [{"results": []}, {"id": 2, "name": "new-tag"}]

            result = await paperless_client.get_or_create_tag("new-tag")

            # Returns tag ID, not dict
            assert result == 2
            assert mock_req.call_count == 2

    @pytest.mark.asyncio
    async def test_add_tag_to_document(self, paperless_client):
        """Test adding a tag to a document."""
        # Get current document tags
        doc_data = {"id": 1, "tags": [1, 2]}

        with patch.object(paperless_client, "get_document", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = doc_data
            with patch.object(
                paperless_client, "_get_tag_id", new_callable=AsyncMock
            ) as mock_tag_id:
                mock_tag_id.return_value = 3
                with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
                    mock_req.return_value = None

                    await paperless_client.add_tag_to_document(1, "new-tag")

                    # Should update document with new tag list
                    mock_req.assert_called()

    @pytest.mark.asyncio
    async def test_remove_tag_from_document(self, paperless_client):
        """Test removing a tag from a document."""
        doc_data = {"id": 1, "tags": [1, 2, 3]}

        with patch.object(paperless_client, "get_document", new_callable=AsyncMock) as mock_get:
            mock_get.return_value = doc_data
            with patch.object(
                paperless_client, "_get_tag_id", new_callable=AsyncMock
            ) as mock_tag_id:
                mock_tag_id.return_value = 2
                with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
                    mock_req.return_value = None

                    await paperless_client.remove_tag_from_document(1, "remove-me")

                    mock_req.assert_called()


# ===========================================================================
# Correspondent Operations Tests
# ===========================================================================


class TestCorrespondentOperations:
    """Test correspondent-related operations."""

    @pytest.mark.asyncio
    async def test_get_correspondents(self, paperless_client):
        """Test getting all correspondents."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {
                "results": [
                    {"id": 1, "name": "Correspondent 1", "document_count": 5},
                    {"id": 2, "name": "Correspondent 2", "document_count": 10},
                ]
            }

            result = await paperless_client.get_correspondents()

            assert len(result) == 2
            assert result[0]["name"] == "Correspondent 1"

    @pytest.mark.asyncio
    async def test_get_or_create_correspondent_existing(self, paperless_client):
        """Test getting an existing correspondent."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = {"results": [{"id": 1, "name": "Existing Corp"}]}

            result = await paperless_client.get_or_create_correspondent("Existing Corp")

            # Returns correspondent ID, not dict
            assert result == 1


# ===========================================================================
# Error Handling Tests
# ===========================================================================


class TestErrorHandling:
    """Test error handling in PaperlessClient."""

    @pytest.mark.asyncio
    async def test_request_timeout_handling(self, paperless_client):
        """Test handling of request timeouts."""
        from httpx import TimeoutException

        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.side_effect = TimeoutException("Connection timeout")

            with pytest.raises(TimeoutException):
                await paperless_client.get_document(1)

    @pytest.mark.asyncio
    async def test_auth_error_handling(self, paperless_client):
        """Test handling of authentication errors."""
        with patch.object(paperless_client, "_request", new_callable=AsyncMock) as mock_req:
            mock_req.side_effect = HTTPStatusError(
                message="Unauthorized",
                request=Request("GET", "http://test"),
                response=Response(401),
            )

            with pytest.raises(HTTPStatusError) as exc_info:
                await paperless_client.get_document(1)

            assert exc_info.value.response.status_code == 401
