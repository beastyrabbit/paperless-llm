"""Tests for Schema Cleanup functionality.

Tests the schema cleanup job and pending cleanup endpoints including:
- Similar name detection algorithms
- Merge suggestion creation
- Delete suggestion creation
- Pending cleanup endpoints (find similar, merge)
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from routers.pending import (
    MergePendingRequest,
    SimilarGroup,
    _calculate_similarity,
    _find_similar_groups,
)
from services.pending_reviews import PendingReviewItem


class TestSimilarityCalculation:
    """Tests for the similarity calculation algorithm."""

    def test_identical_strings(self):
        """Test that identical strings have 100% similarity."""
        assert _calculate_similarity("Amazon", "Amazon") == 1.0

    def test_case_insensitive(self):
        """Test that comparison is case-insensitive."""
        assert _calculate_similarity("Amazon", "amazon") == 1.0
        assert _calculate_similarity("AMAZON", "amazon") == 1.0

    def test_completely_different(self):
        """Test that completely different strings have low similarity."""
        similarity = _calculate_similarity("Amazon", "Google")
        assert similarity < 0.5

    def test_similar_names_typo(self):
        """Test that typos are detected as similar."""
        # "valve" vs "valvce" - common typo
        similarity = _calculate_similarity("valve", "valvce")
        assert similarity >= 0.7

    def test_similar_names_variation(self):
        """Test that name variations are detected."""
        # "Amazon" vs "Amazon GmbH"
        similarity = _calculate_similarity("Amazon", "Amazon GmbH")
        assert similarity >= 0.6

    def test_similar_names_with_suffix(self):
        """Test similarity with company suffixes."""
        similarity = _calculate_similarity("Deutsche Bank", "Deutsche Bank AG")
        assert similarity >= 0.7

    def test_empty_strings(self):
        """Test handling of empty strings."""
        assert _calculate_similarity("", "") == 1.0
        assert _calculate_similarity("test", "") == 0.0
        assert _calculate_similarity("", "test") == 0.0


class TestFindSimilarGroups:
    """Tests for finding similar groups in pending items."""

    def _create_pending_item(
        self,
        item_id: str,
        doc_id: int,
        item_type: str,
        suggestion: str,
    ) -> PendingReviewItem:
        """Helper to create a pending review item."""
        return PendingReviewItem(
            id=item_id,
            doc_id=doc_id,
            doc_title=f"Document {doc_id}",
            type=item_type,
            suggestion=suggestion,
            reasoning="Test reasoning",
        )

    def test_no_similar_items(self):
        """Test when there are no similar items."""
        items = [
            self._create_pending_item("1", 1, "correspondent", "Amazon"),
            self._create_pending_item("2", 2, "correspondent", "Google"),
            self._create_pending_item("3", 3, "correspondent", "Microsoft"),
        ]

        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 0

    def test_finds_similar_pair(self):
        """Test finding a similar pair."""
        items = [
            self._create_pending_item("1", 1, "correspondent", "valve corp"),
            self._create_pending_item("2", 2, "correspondent", "valvce corp"),  # typo
        ]

        # These are similar enough at 0.7 threshold
        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 1
        assert set(groups[0].suggestions) == {"valve corp", "valvce corp"}

    def test_finds_typo_variations(self):
        """Test finding typo variations."""
        items = [
            self._create_pending_item("1", 1, "correspondent", "Amazon"),
            self._create_pending_item("2", 2, "correspondent", "Amzon"),
            self._create_pending_item("3", 3, "correspondent", "Google"),
        ]

        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 1
        assert "Amazon" in groups[0].suggestions
        assert "Amzon" in groups[0].suggestions

    def test_groups_by_type(self):
        """Test that similar items are only grouped within the same type."""
        items = [
            self._create_pending_item("1", 1, "correspondent", "Invoice"),
            self._create_pending_item("2", 2, "document_type", "Invoice"),
            self._create_pending_item("3", 3, "correspondent", "Invoce"),  # typo
        ]

        groups = _find_similar_groups(items, threshold=0.7)

        # Should only find the correspondent group (Invoice/Invoce)
        assert len(groups) == 1
        assert groups[0].item_type == "correspondent"
        assert "Invoice" in groups[0].suggestions
        assert "Invoce" in groups[0].suggestions

    def test_ignores_schema_types(self):
        """Test that schema_ prefixed types are ignored."""
        items = [
            self._create_pending_item("1", 1, "schema_correspondent", "Amazon"),
            self._create_pending_item("2", 2, "schema_correspondent", "Amzon"),
        ]

        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 0

    def test_recommends_longest_name(self):
        """Test that the recommended name is the longest one."""
        items = [
            self._create_pending_item("1", 1, "tag", "finance"),
            self._create_pending_item("2", 2, "tag", "financials"),
        ]

        groups = _find_similar_groups(items, threshold=0.6)
        assert len(groups) == 1
        assert groups[0].recommended_name == "financials"

    def test_collects_all_doc_ids(self):
        """Test that all document IDs are collected."""
        items = [
            self._create_pending_item("1", 10, "tag", "urgent"),
            self._create_pending_item("2", 20, "tag", "urgant"),  # typo
            self._create_pending_item("3", 30, "tag", "urgentt"),  # typo
        ]

        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 1
        assert set(groups[0].doc_ids) == {10, 20, 30}

    def test_collects_all_item_ids(self):
        """Test that all item IDs are collected in a group."""
        items = [
            self._create_pending_item("item-1", 1, "correspondent", "Amazon Inc"),
            self._create_pending_item("item-2", 2, "correspondent", "Amazon Ink"),  # typo
        ]

        groups = _find_similar_groups(items, threshold=0.8)
        assert len(groups) == 1
        assert set(groups[0].item_ids) == {"item-1", "item-2"}

    def test_case_variations_grouped(self):
        """Test that case variations are grouped together."""
        items = [
            self._create_pending_item("item-1", 1, "correspondent", "hund"),
            self._create_pending_item("item-2", 2, "correspondent", "Hund"),
        ]

        # "hund" and "Hund" have 100% similarity when compared case-insensitively
        groups = _find_similar_groups(items, threshold=0.9)
        assert len(groups) == 1
        assert set(groups[0].suggestions) == {"hund", "Hund"}

    def test_multiple_items_same_suggestion(self):
        """Test handling multiple items with the exact same suggestion."""
        items = [
            self._create_pending_item("1", 10, "tag", "invoice"),
            self._create_pending_item("2", 20, "tag", "invoice"),  # duplicate
            self._create_pending_item("3", 30, "tag", "invocie"),  # typo
        ]

        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 1
        # Should include all 3 items since "invoice" and "invocie" are similar
        assert len(groups[0].item_ids) == 3

    def test_empty_items_list(self):
        """Test with empty items list."""
        groups = _find_similar_groups([], threshold=0.7)
        assert len(groups) == 0

    def test_single_item(self):
        """Test with single item."""
        items = [
            self._create_pending_item("1", 1, "correspondent", "Amazon"),
        ]
        groups = _find_similar_groups(items, threshold=0.7)
        assert len(groups) == 0


class TestSimilarGroupModel:
    """Tests for the SimilarGroup model."""

    def test_similar_group_creation(self):
        """Test creating a SimilarGroup."""
        group = SimilarGroup(
            suggestions=["Amazon", "Amzon"],
            item_ids=["1", "2"],
            item_type="correspondent",
            doc_ids=[10, 20],
            recommended_name="Amazon",
        )

        assert group.suggestions == ["Amazon", "Amzon"]
        assert group.item_ids == ["1", "2"]
        assert group.item_type == "correspondent"
        assert group.doc_ids == [10, 20]
        assert group.recommended_name == "Amazon"


class TestSchemaCleanupJob:
    """Tests for the SchemaCleanupJob class."""

    def test_find_similar_names_finds_duplicates(self):
        """Test that similar names are found."""
        from jobs.schema_cleanup import SchemaCleanupJob

        # Create job instance without full initialization
        job = SchemaCleanupJob.__new__(SchemaCleanupJob)
        job.similarity_threshold = 0.8

        entities = [
            {"id": 1, "name": "Amazon"},
            {"id": 2, "name": "Amzon"},  # typo
            {"id": 3, "name": "Google"},
        ]

        similar = job._find_similar_names(entities)

        assert len(similar) == 1
        names = {similar[0][0], similar[0][1]}
        assert names == {"Amazon", "Amzon"}

    def test_find_similar_names_skips_identical(self):
        """Test that identical names (case-insensitive) are skipped."""
        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob.__new__(SchemaCleanupJob)
        job.similarity_threshold = 0.8

        entities = [
            {"id": 1, "name": "Amazon"},
            {"id": 2, "name": "amazon"},  # same, different case
        ]

        similar = job._find_similar_names(entities)
        assert len(similar) == 0

    def test_find_similar_names_respects_threshold(self):
        """Test that threshold is respected."""
        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob.__new__(SchemaCleanupJob)

        entities = [
            {"id": 1, "name": "Amazon"},
            {"id": 2, "name": "Amazonia"},
        ]

        # High threshold - should not match
        job.similarity_threshold = 0.95
        similar = job._find_similar_names(entities)
        assert len(similar) == 0

        # Lower threshold - should match
        job.similarity_threshold = 0.7
        similar = job._find_similar_names(entities)
        assert len(similar) == 1

    def test_find_similar_names_returns_entities(self):
        """Test that full entity dicts are returned."""
        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob.__new__(SchemaCleanupJob)
        job.similarity_threshold = 0.8

        entities = [
            {"id": 1, "name": "Dr. Schmidt"},
            {"id": 2, "name": "Dr Schmidt"},  # no dot
        ]

        similar = job._find_similar_names(entities)

        assert len(similar) == 1
        name1, name2, entity1, entity2 = similar[0]

        # Check we get the full entities back
        assert entity1["id"] in [1, 2]
        assert entity2["id"] in [1, 2]
        assert entity1["id"] != entity2["id"]

    def test_suggest_deletion_creates_pending_item(self):
        """Test that deletion suggestions are created correctly."""
        from jobs.schema_cleanup import SchemaCleanupJob

        job = SchemaCleanupJob.__new__(SchemaCleanupJob)

        # Mock the pending service
        mock_pending = MagicMock()
        job.pending = mock_pending

        entity = {"id": 42, "name": "Unused Company"}
        job._suggest_deletion("correspondent", entity)

        # Verify the pending service was called
        mock_pending.add.assert_called_once()
        call_kwargs = mock_pending.add.call_args[1]

        assert call_kwargs["doc_id"] == 0
        assert "Delete" in call_kwargs["doc_title"]
        assert call_kwargs["item_type"] == "schema_cleanup"
        assert call_kwargs["suggestion"] == "Delete Unused Company"
        assert call_kwargs["metadata"]["cleanup_type"] == "delete"
        assert call_kwargs["metadata"]["entity_type"] == "correspondent"
        assert call_kwargs["metadata"]["entity_id"] == 42
        assert call_kwargs["metadata"]["entity_name"] == "Unused Company"


class TestMergeEndpoint:
    """Tests for the merge pending suggestions endpoint."""

    def _create_pending_item(
        self,
        item_id: str,
        suggestion: str,
    ) -> PendingReviewItem:
        """Helper to create a pending review item."""
        return PendingReviewItem(
            id=item_id,
            doc_id=1,
            doc_title="Test Doc",
            type="correspondent",
            suggestion=suggestion,
            reasoning="Test",
        )

    @pytest.mark.asyncio
    async def test_merge_updates_suggestions(self):
        """Test that merge updates all item suggestions."""
        from routers.pending import merge_pending_suggestions

        # Mock service
        mock_service = MagicMock()

        # Track items that get updated
        items = {
            "1": self._create_pending_item("1", "Amazon"),
            "2": self._create_pending_item("2", "Amzon"),
        }

        def mock_update(item_id: str, new_suggestion: str):
            if item_id in items:
                items[item_id].suggestion = new_suggestion
                return items[item_id]
            return None

        mock_service.update_suggestion = mock_update

        request = MergePendingRequest(
            item_ids=["1", "2"],
            final_name="Amazon Inc.",
        )

        result = await merge_pending_suggestions(request, mock_service)

        assert result.merged_count == 2
        assert result.final_name == "Amazon Inc."
        assert set(result.updated_item_ids) == {"1", "2"}

        # Verify items were updated
        assert items["1"].suggestion == "Amazon Inc."
        assert items["2"].suggestion == "Amazon Inc."

    @pytest.mark.asyncio
    async def test_merge_handles_missing_items(self):
        """Test that merge gracefully handles missing items."""
        from routers.pending import merge_pending_suggestions

        mock_service = MagicMock()
        mock_service.update_suggestion = MagicMock(return_value=None)

        request = MergePendingRequest(
            item_ids=["nonexistent-1", "nonexistent-2"],
            final_name="Test",
        )

        result = await merge_pending_suggestions(request, mock_service)

        # Should not fail, just report 0 merged
        assert result.merged_count == 0
        assert result.updated_item_ids == []

    @pytest.mark.asyncio
    async def test_merge_empty_items(self):
        """Test merge with empty items list."""
        from routers.pending import merge_pending_suggestions

        mock_service = MagicMock()

        request = MergePendingRequest(
            item_ids=[],
            final_name="Test",
        )

        result = await merge_pending_suggestions(request, mock_service)

        assert result.merged_count == 0
        assert result.final_name == "Test"

    @pytest.mark.asyncio
    async def test_merge_strips_whitespace(self):
        """Test that final name is stripped of whitespace."""
        from routers.pending import merge_pending_suggestions

        mock_service = MagicMock()
        mock_service.update_suggestion = MagicMock(
            return_value=self._create_pending_item("1", "Test")
        )

        request = MergePendingRequest(
            item_ids=["1"],
            final_name="  Amazon Inc.  ",
        )

        result = await merge_pending_suggestions(request, mock_service)

        assert result.final_name == "Amazon Inc."
        mock_service.update_suggestion.assert_called_with("1", "Amazon Inc.")


class TestSchemaCleanupApproval:
    """Tests for schema cleanup approval (merge/delete) endpoint."""

    @pytest.mark.asyncio
    async def test_approve_merge_transfers_documents(self):
        """Test that approving a merge transfers documents correctly."""
        from routers.pending import SchemaCleanupApproveRequest, approve_schema_cleanup

        # Create a schema_cleanup merge item
        mock_item = PendingReviewItem(
            id="cleanup-1",
            doc_id=0,
            doc_title="Merge correspondent: Amazon / Amzon",
            type="schema_cleanup",
            suggestion="Merge into: Amazon",
            reasoning="These appear to be the same company",
            metadata={
                "cleanup_type": "merge",
                "entity_type": "correspondent",
                "source_id": 2,
                "target_id": 1,
                "source_name": "Amzon",
                "target_name": "Amazon",
            },
        )

        mock_service = MagicMock()
        mock_service.get_by_id = MagicMock(return_value=mock_item)
        mock_service.remove = MagicMock()

        mock_client = AsyncMock()
        mock_client.merge_entities = AsyncMock(
            return_value={
                "target_renamed": False,
                "documents_transferred": 5,
                "source_deleted": True,
            }
        )

        request = SchemaCleanupApproveRequest(final_name="Amazon Inc.")

        result = await approve_schema_cleanup(
            item_id="cleanup-1",
            request=request,
            service=mock_service,
            client=mock_client,
        )

        # Verify merge was called with correct params
        mock_client.merge_entities.assert_called_once_with(
            entity_type="correspondent",
            source_id=2,
            target_id=1,
            target_name="Amazon Inc.",
        )

        assert result["success"] is True
        assert result["cleanup_type"] == "merge"
        assert result["removed"] is True

    @pytest.mark.asyncio
    async def test_approve_delete_only_when_unused(self):
        """Test that delete only works when entity is unused."""
        from routers.pending import SchemaCleanupApproveRequest, approve_schema_cleanup

        mock_item = PendingReviewItem(
            id="cleanup-2",
            doc_id=0,
            doc_title="Delete unused tag: old-tag",
            type="schema_cleanup",
            suggestion="Delete old-tag",
            reasoning="No documents use this tag",
            metadata={
                "cleanup_type": "delete",
                "entity_type": "tag",
                "entity_id": 42,
                "entity_name": "old-tag",
            },
        )

        mock_service = MagicMock()
        mock_service.get_by_id = MagicMock(return_value=mock_item)
        mock_service.remove = MagicMock()

        mock_client = AsyncMock()
        mock_client.delete_entity = AsyncMock(
            return_value={
                "deleted": True,
            }
        )

        request = SchemaCleanupApproveRequest()

        result = await approve_schema_cleanup(
            item_id="cleanup-2",
            request=request,
            service=mock_service,
            client=mock_client,
        )

        mock_client.delete_entity.assert_called_once_with(
            entity_type="tag",
            entity_id=42,
        )

        assert result["success"] is True
        assert result["cleanup_type"] == "delete"


class TestEdgeCases:
    """Tests for edge cases and error handling."""

    def test_similarity_with_unicode(self):
        """Test similarity calculation with unicode characters."""
        # German umlauts
        similarity = _calculate_similarity("Müller", "Muller")
        assert similarity >= 0.7

    def test_similarity_with_numbers(self):
        """Test similarity with numbers in names."""
        similarity = _calculate_similarity("Invoice 2024", "Invoice 2023")
        assert similarity >= 0.8

    def test_similarity_with_special_chars(self):
        """Test similarity with special characters."""
        similarity = _calculate_similarity("Amazon.com", "Amazon-com")
        assert similarity >= 0.8

    def test_find_groups_with_multiple_groups(self):
        """Test finding multiple distinct groups."""

        def create_item(item_id: str, suggestion: str) -> PendingReviewItem:
            return PendingReviewItem(
                id=item_id,
                doc_id=int(item_id),
                doc_title=f"Doc {item_id}",
                type="correspondent",
                suggestion=suggestion,
                reasoning="Test",
            )

        items = [
            # Group 1: Amazon variations
            create_item("1", "Amazon"),
            create_item("2", "Amzon"),
            # Group 2: Google variations
            create_item("3", "Google"),
            create_item("4", "Gogle"),
            # Not similar to anything
            create_item("5", "Microsoft"),
        ]

        groups = _find_similar_groups(items, threshold=0.7)

        assert len(groups) == 2

        # Get the group suggestions as sets for comparison
        group_suggestions = [set(g.suggestions) for g in groups]

        assert {"Amazon", "Amzon"} in group_suggestions
        assert {"Google", "Gogle"} in group_suggestions
