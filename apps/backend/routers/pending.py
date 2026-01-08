"""Pending Reviews API endpoints."""

from difflib import SequenceMatcher
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from config import Settings, get_settings
from models.blocked import BlockedSuggestionResponse, BlockType
from services.database import get_database_service
from services.paperless import PaperlessClient
from services.pending_reviews import (
    PendingReviewItem,
    PendingReviewsService,
    get_pending_reviews_service,
)

router = APIRouter()


class SearchableEntitiesResponse(BaseModel):
    """Response with all searchable entities."""

    correspondents: list[str]
    document_types: list[str]
    tags: list[str]


@router.get("/search-entities", response_model=SearchableEntitiesResponse)
async def get_searchable_entities(
    settings: Settings = Depends(get_settings),
):
    """Get all correspondents, document types, and tags for searching."""
    url = settings.paperless_url
    token = settings.paperless_token

    if not url or not token:
        return SearchableEntitiesResponse(correspondents=[], document_types=[], tags=[])

    try:
        client = PaperlessClient(url, token)
        correspondents = await client.get_correspondents()
        document_types = await client.get_document_types()
        tags = await client.get_tags()

        return SearchableEntitiesResponse(
            correspondents=[c["name"] for c in correspondents],
            document_types=[dt["name"] for dt in document_types],
            tags=[t["name"] for t in tags],
        )
    except Exception:
        return SearchableEntitiesResponse(correspondents=[], document_types=[], tags=[])


class BlockedItemsResponse(BaseModel):
    """Response with blocked items grouped by type."""

    global_blocks: list[BlockedSuggestionResponse]
    correspondent_blocks: list[BlockedSuggestionResponse]
    document_type_blocks: list[BlockedSuggestionResponse]
    tag_blocks: list[BlockedSuggestionResponse]
    total: int


@router.get("/blocked", response_model=BlockedItemsResponse)
async def get_blocked_items():
    """Get all blocked suggestions grouped by type."""
    db = get_database_service()
    all_blocked = db.get_blocked_suggestions()

    # Group by block type
    global_blocks = []
    correspondent_blocks = []
    document_type_blocks = []
    tag_blocks = []

    for item in all_blocked:
        response = BlockedSuggestionResponse.from_blocked_suggestion(item)
        if item.block_type == BlockType.GLOBAL:
            global_blocks.append(response)
        elif item.block_type == BlockType.CORRESPONDENT:
            correspondent_blocks.append(response)
        elif item.block_type == BlockType.DOCUMENT_TYPE:
            document_type_blocks.append(response)
        elif item.block_type == BlockType.TAG:
            tag_blocks.append(response)

    return BlockedItemsResponse(
        global_blocks=global_blocks,
        correspondent_blocks=correspondent_blocks,
        document_type_blocks=document_type_blocks,
        tag_blocks=tag_blocks,
        total=len(all_blocked),
    )


@router.delete("/blocked/{block_id}")
async def unblock_item(block_id: int):
    """Remove an item from the blocked list."""
    db = get_database_service()
    success = db.remove_blocked_suggestion(block_id)

    if not success:
        raise HTTPException(status_code=404, detail="Blocked item not found")

    return {"success": True, "unblocked_id": block_id}


# Schema-type prefixes that trigger schema review flow
SCHEMA_ITEM_TYPES = (
    "schema_correspondent",
    "schema_document_type",
    "schema_tag",
    "schema_custom_field",
)


async def _check_and_advance_schema_review(
    doc_id: int,
    item: PendingReviewItem,
    service: PendingReviewsService,
    client: PaperlessClient,
    settings: Settings,
) -> dict:
    """Check if all schema reviews for a document are complete and advance the pipeline.

    Returns a dict with information about whether the document was advanced.
    """
    result = {"schema_review_complete": False, "advanced_to": None}

    # Only apply to schema-type items
    if not item.type.startswith("schema_"):
        return result

    # Skip if no valid document ID (e.g., schema suggestions not tied to a document)
    if not doc_id or doc_id <= 0:
        return result

    # Check if there are remaining schema-type pending reviews for this document
    remaining = service.get_by_doc(doc_id)
    remaining_schema = [r for r in remaining if r.type.startswith("schema_")]

    if len(remaining_schema) == 0:
        # All schema reviews complete - advance the document
        result["schema_review_complete"] = True

        # Remove the schema review tag
        await client.remove_tag_from_document(doc_id, settings.tag_schema_review)

        # Apply the next tag to resume pipeline (stored in the item)
        if item.next_tag:
            await client.add_tag_to_document(doc_id, item.next_tag)
            result["advanced_to"] = item.next_tag

    return result


class PendingCounts(BaseModel):
    """Counts of pending items by type."""

    correspondent: int
    document_type: int
    tag: int
    total: int
    # Schema analysis suggestion counts
    schema_correspondent: int = 0
    schema_document_type: int = 0
    schema_tag: int = 0
    schema_custom_field: int = 0
    schema_cleanup: int = 0
    metadata_description: int = 0


class ApproveRequest(BaseModel):
    """Request to approve a pending item."""

    create_entity: bool = True  # Whether to create the new entity in Paperless


class SchemaCleanupApproveRequest(BaseModel):
    """Request to approve a schema cleanup item (merge or delete)."""

    final_name: str | None = None  # For merges: the final name to use (can be custom)


class UpdateSuggestionRequest(BaseModel):
    """Request to update the selected suggestion."""

    new_suggestion: str


class RejectWithFeedbackRequest(BaseModel):
    """Request to reject a pending item with optional blocking feedback."""

    block_type: Literal["none", "global", "per_type"] = "none"
    rejection_reason: str | None = None
    rejection_category: (
        Literal["duplicate", "too_generic", "irrelevant", "wrong_format", "other"] | None
    ) = None


def get_paperless_client(settings: Settings = Depends(get_settings)) -> PaperlessClient:
    """Get Paperless client dependency."""
    return PaperlessClient(settings.paperless_url, settings.paperless_token)


@router.get("", response_model=list[PendingReviewItem])
async def get_pending_items(
    type: Literal["correspondent", "document_type", "tag"] | None = None,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Get all pending review items, optionally filtered by type."""
    return service.get_all(item_type=type)


@router.get("/counts", response_model=PendingCounts)
async def get_pending_counts(
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Get counts of pending items by type."""
    counts = service.get_counts()
    return PendingCounts(**counts)


# --- Pending Cleanup routes (must be before /{item_id} to avoid being caught) ---


class SimilarGroup(BaseModel):
    """A group of similar pending suggestions."""

    suggestions: list[str]  # The similar suggestion names
    item_ids: list[str]  # IDs of pending items with these suggestions
    item_type: str  # correspondent, document_type, tag, etc.
    doc_ids: list[int]  # Document IDs affected
    recommended_name: str  # Suggested merged name (longest/most complete)


class SimilarGroupsResponse(BaseModel):
    """Response with groups of similar pending suggestions."""

    groups: list[SimilarGroup]
    total_mergeable: int


class MergePendingRequest(BaseModel):
    """Request to merge pending suggestions."""

    item_ids: list[str]  # IDs of pending items to merge
    final_name: str  # The name to use for all merged items


class MergePendingResponse(BaseModel):
    """Response from merging pending suggestions."""

    merged_count: int
    final_name: str
    updated_item_ids: list[str]


def _calculate_similarity(s1: str, s2: str) -> float:
    """Calculate similarity ratio between two strings."""
    return SequenceMatcher(None, s1.lower(), s2.lower()).ratio()


def _find_similar_groups(
    items: list[PendingReviewItem],
    threshold: float = 0.7,
) -> list[SimilarGroup]:
    """Find groups of similar pending suggestions.

    Uses fuzzy string matching to find suggestions that might be duplicates
    or variations of each other.
    """
    # Group items by type first
    by_type: dict[str, list[PendingReviewItem]] = {}
    for item in items:
        # Only process regular pending types, not schema types
        if item.type in ("correspondent", "document_type", "tag"):
            if item.type not in by_type:
                by_type[item.type] = []
            by_type[item.type].append(item)

    groups: list[SimilarGroup] = []

    for item_type, type_items in by_type.items():
        # Get unique suggestions
        suggestions_map: dict[str, list[PendingReviewItem]] = {}
        for item in type_items:
            suggestion = item.suggestion
            if suggestion not in suggestions_map:
                suggestions_map[suggestion] = []
            suggestions_map[suggestion].append(item)

        unique_suggestions = list(suggestions_map.keys())
        processed: set[str] = set()

        for i, s1 in enumerate(unique_suggestions):
            if s1 in processed:
                continue

            # Find all similar suggestions
            similar = [s1]
            for s2 in unique_suggestions[i + 1 :]:
                if s2 in processed:
                    continue
                if _calculate_similarity(s1, s2) >= threshold:
                    similar.append(s2)
                    processed.add(s2)

            # Only create a group if there are multiple similar suggestions
            if len(similar) > 1:
                processed.add(s1)
                # Collect all items and doc_ids
                all_items: list[PendingReviewItem] = []
                for s in similar:
                    all_items.extend(suggestions_map[s])

                item_ids = [item.id for item in all_items]
                doc_ids = list({item.doc_id for item in all_items})

                # Recommend the longest name as it's usually most complete
                recommended = max(similar, key=len)

                groups.append(
                    SimilarGroup(
                        suggestions=similar,
                        item_ids=item_ids,
                        item_type=item_type,
                        doc_ids=doc_ids,
                        recommended_name=recommended,
                    )
                )

    return groups


@router.get("/similar", response_model=SimilarGroupsResponse)
async def find_similar_pending(
    threshold: float = 0.7,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Find groups of similar pending suggestions that could be merged.

    This helps clean up pending reviews by identifying duplicate or
    near-duplicate suggestions across different documents.

    Args:
        threshold: Similarity threshold (0-1). Default 0.7 (70% similar).
    """
    items = service.get_all()
    groups = _find_similar_groups(items, threshold)

    return SimilarGroupsResponse(
        groups=groups,
        total_mergeable=sum(len(g.item_ids) for g in groups),
    )


@router.post("/merge", response_model=MergePendingResponse)
async def merge_pending_suggestions(
    request: MergePendingRequest,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Merge multiple pending suggestions into one.

    Updates all specified pending items to use the same suggestion name.
    This doesn't create or modify entities in Paperless - it just
    consolidates the pending suggestions so they can be reviewed together.

    Note: Some items may have been removed since the similar groups were
    calculated. This endpoint will update as many items as it can find.
    """
    if not request.item_ids:
        return MergePendingResponse(
            merged_count=0,
            final_name=request.final_name,
            updated_item_ids=[],
        )

    if not request.final_name or not request.final_name.strip():
        raise HTTPException(status_code=400, detail="Final name cannot be empty")

    updated_ids: list[str] = []

    for item_id in request.item_ids:
        item = service.update_suggestion(item_id, request.final_name.strip())
        if item:
            updated_ids.append(item_id)

    # Don't fail if some items weren't found - they may have been
    # approved/rejected between finding similar and merging
    return MergePendingResponse(
        merged_count=len(updated_ids),
        final_name=request.final_name.strip(),
        updated_item_ids=updated_ids,
    )


# --- End of Pending Cleanup routes ---


@router.get("/{item_id}", response_model=PendingReviewItem)
async def get_pending_item(
    item_id: str,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Get a specific pending item."""
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pending item not found")
    return item


@router.put("/{item_id}/suggestion", response_model=PendingReviewItem)
async def update_pending_suggestion(
    item_id: str,
    request: UpdateSuggestionRequest,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Update the selected suggestion for a pending item."""
    item = service.update_suggestion(item_id, request.new_suggestion)
    if not item:
        raise HTTPException(status_code=404, detail="Pending item not found")
    return item


@router.post("/{item_id}/approve-cleanup")
async def approve_schema_cleanup(
    item_id: str,
    request: SchemaCleanupApproveRequest = SchemaCleanupApproveRequest(),
    service: PendingReviewsService = Depends(get_pending_reviews_service),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Approve a schema cleanup item (merge or delete).

    For merges:
    - Transfers all documents from source entity to target entity
    - Optionally renames target to final_name
    - Deletes the source entity

    For deletes:
    - Deletes the entity (only if no documents use it)
    """
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pending item not found")

    if item.type != "schema_cleanup":
        raise HTTPException(
            status_code=400,
            detail="This endpoint is only for schema_cleanup items",
        )

    metadata = item.metadata or {}
    cleanup_type = metadata.get("cleanup_type")
    entity_type = metadata.get("entity_type")

    if not cleanup_type or not entity_type:
        raise HTTPException(
            status_code=400,
            detail="Invalid schema_cleanup item: missing cleanup_type or entity_type",
        )

    result = {
        "id": item_id,
        "type": "schema_cleanup",
        "cleanup_type": cleanup_type,
        "entity_type": entity_type,
    }

    try:
        if cleanup_type == "merge":
            source_id = metadata.get("source_id")
            target_id = metadata.get("target_id")

            if not source_id or not target_id:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid merge item: missing source_id or target_id",
                )

            # Use final_name from request, or fall back to target_name from metadata
            final_name = request.final_name or metadata.get("target_name")

            merge_result = await client.merge_entities(
                entity_type=entity_type,
                source_id=source_id,
                target_id=target_id,
                target_name=final_name,
            )
            result["merge_result"] = merge_result
            result["success"] = merge_result.get("source_deleted", False)

        elif cleanup_type == "delete":
            entity_id = metadata.get("entity_id")

            if not entity_id:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid delete item: missing entity_id",
                )

            delete_result = await client.delete_entity(
                entity_type=entity_type,
                entity_id=entity_id,
            )
            result["delete_result"] = delete_result
            result["success"] = delete_result.get("deleted", False)

            if not result["success"] and "error" in delete_result:
                raise HTTPException(
                    status_code=400,
                    detail=delete_result["error"],
                )

        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown cleanup_type: {cleanup_type}",
            )

        # Remove from pending queue
        service.remove(item_id)
        result["removed"] = True

        return result

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply cleanup: {str(e)}")


@router.post("/{item_id}/approve")
async def approve_pending_item(
    item_id: str,
    request: ApproveRequest = ApproveRequest(),
    service: PendingReviewsService = Depends(get_pending_reviews_service),
    client: PaperlessClient = Depends(get_paperless_client),
    settings: Settings = Depends(get_settings),
):
    """Approve a pending item and apply it.

    This will:
    1. Create the new entity in Paperless (if create_entity=True)
    2. Assign it to the document
    3. Remove from pending queue
    4. Continue the processing pipeline
    """
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pending item not found")

    result = {"id": item_id, "type": item.type, "applied": False}

    try:
        if item.type == "correspondent":
            if request.create_entity:
                # Create and assign correspondent
                correspondent_id = await client.get_or_create_correspondent(item.suggestion)
                await client.update_document(item.doc_id, correspondent=correspondent_id)
                result["correspondent_id"] = correspondent_id
                result["applied"] = True

            # Update pipeline tag to continue processing
            await client.remove_tag_from_document(item.doc_id, settings.tag_ocr_done)
            await client.add_tag_to_document(item.doc_id, settings.tag_correspondent_done)

        elif item.type == "document_type":
            if request.create_entity:
                # Create and assign document type
                doc_type_id = await client.get_or_create_document_type(item.suggestion)
                await client.update_document(item.doc_id, document_type=doc_type_id)
                result["document_type_id"] = doc_type_id
                result["applied"] = True

            # Update pipeline tag
            await client.remove_tag_from_document(item.doc_id, settings.tag_correspondent_done)
            await client.add_tag_to_document(item.doc_id, settings.tag_document_type_done)

        elif item.type == "tag":
            if request.create_entity:
                # Create and assign tag
                tag_id = await client.get_or_create_tag(item.suggestion)
                doc = await client.get_document(item.doc_id)
                current_tags = doc.get("tags", []) if doc else []
                if tag_id not in current_tags:
                    current_tags.append(tag_id)
                    await client.update_document(item.doc_id, tags=current_tags)
                result["tag_id"] = tag_id
                result["applied"] = True

        # Handle schema-type items (from schema analysis)
        # Note: doc_id may be 0 for suggestions to create new entities without
        # applying them to a specific document
        elif item.type == "schema_correspondent":
            if request.create_entity:
                correspondent_id = await client.get_or_create_correspondent(item.suggestion)
                result["correspondent_id"] = correspondent_id
                # Only apply to document if we have a valid doc_id
                if item.doc_id and item.doc_id > 0:
                    await client.update_document(item.doc_id, correspondent=correspondent_id)
                result["applied"] = True

        elif item.type == "schema_document_type":
            if request.create_entity:
                doc_type_id = await client.get_or_create_document_type(item.suggestion)
                result["document_type_id"] = doc_type_id
                # Only apply to document if we have a valid doc_id
                if item.doc_id and item.doc_id > 0:
                    await client.update_document(item.doc_id, document_type=doc_type_id)
                result["applied"] = True

        elif item.type == "schema_tag":
            if request.create_entity:
                tag_id = await client.get_or_create_tag(item.suggestion)
                result["tag_id"] = tag_id
                # Only apply to document if we have a valid doc_id
                if item.doc_id and item.doc_id > 0:
                    doc = await client.get_document(item.doc_id)
                    current_tags = doc.get("tags", []) if doc else []
                    if tag_id not in current_tags:
                        current_tags.append(tag_id)
                        await client.update_document(item.doc_id, tags=current_tags)
                result["applied"] = True

        elif item.type == "schema_custom_field":
            # Custom fields are handled separately - just mark as approved
            result["applied"] = True

        # Remove from pending queue
        service.remove(item_id)
        result["removed"] = True

        # Check if there are more pending items for this document
        remaining = service.get_by_doc(item.doc_id)
        result["remaining_items"] = len(remaining)

        # For schema-type items, check if all schema reviews are complete
        # and advance the document to the next pipeline stage
        advance_result = await _check_and_advance_schema_review(
            item.doc_id, item, service, client, settings
        )
        result.update(advance_result)

        return result

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to apply: {str(e)}")


@router.post("/{item_id}/reject")
async def reject_pending_item(
    item_id: str,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
    client: PaperlessClient = Depends(get_paperless_client),
    settings: Settings = Depends(get_settings),
):
    """Reject a pending item without applying it.

    The document will still progress through the pipeline,
    just without this entity being created/assigned.
    """
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pending item not found")

    result = {"id": item_id, "rejected": True, "type": item.type}

    # Update pipeline tag to continue processing (skip this step)
    # Only for non-schema types - schema types use the schema review flow
    if item.type == "correspondent":
        await client.remove_tag_from_document(item.doc_id, settings.tag_ocr_done)
        await client.add_tag_to_document(item.doc_id, settings.tag_correspondent_done)
    elif item.type == "document_type":
        await client.remove_tag_from_document(item.doc_id, settings.tag_correspondent_done)
        await client.add_tag_to_document(item.doc_id, settings.tag_document_type_done)
    # Tags and schema-type items don't block the pipeline directly

    # Remove from pending queue
    service.remove(item_id)

    # For schema-type items, check if all schema reviews are complete
    # and advance the document to the next pipeline stage
    advance_result = await _check_and_advance_schema_review(
        item.doc_id, item, service, client, settings
    )
    result.update(advance_result)

    return result


@router.post("/{item_id}/reject-with-feedback")
async def reject_with_feedback(
    item_id: str,
    request: RejectWithFeedbackRequest,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
    client: PaperlessClient = Depends(get_paperless_client),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Reject a pending review with optional blocking feedback.

    This will:
    1. Optionally add the suggestion to the blocked list
    2. Update pipeline tags to continue processing
    3. Remove from pending reviews
    """
    from models.blocked import BlockSuggestionRequest, BlockType, RejectionCategory
    from services.database import get_database_service

    # Get the pending review first
    item = service.get_by_id(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Pending review not found")

    # If blocking requested, add to blocked suggestions
    if request.block_type != "none":
        db = get_database_service()

        # Determine the actual block type
        if request.block_type == "global":
            actual_block_type = BlockType.GLOBAL
        else:  # per_type
            # Get entity type from the review's type field
            type_mapping = {
                "correspondent": BlockType.CORRESPONDENT,
                "document_type": BlockType.DOCUMENT_TYPE,
                "tag": BlockType.TAG,
            }
            actual_block_type = type_mapping.get(item.type, BlockType.GLOBAL)

        # Convert rejection category string to enum if provided
        rejection_category = None
        if request.rejection_category:
            rejection_category = RejectionCategory(request.rejection_category)

        block_request = BlockSuggestionRequest(
            suggestion_name=item.suggestion,
            block_type=actual_block_type,
            rejection_reason=request.rejection_reason,
            rejection_category=rejection_category,
            doc_id=item.doc_id,
        )
        db.add_blocked_suggestion(block_request)

    # Update pipeline tag to continue processing (skip this step)
    # Only for non-schema types - schema types use the schema review flow
    if item.type == "correspondent":
        await client.remove_tag_from_document(item.doc_id, settings.tag_ocr_done)
        await client.add_tag_to_document(item.doc_id, settings.tag_correspondent_done)
    elif item.type == "document_type":
        await client.remove_tag_from_document(item.doc_id, settings.tag_correspondent_done)
        await client.add_tag_to_document(item.doc_id, settings.tag_document_type_done)
    # Tags and schema-type items don't block the pipeline directly

    # Remove from pending reviews
    service.remove(item_id)

    result = {
        "success": True,
        "blocked": request.block_type != "none",
        "block_type": request.block_type if request.block_type != "none" else None,
    }

    # For schema-type items, check if all schema reviews are complete
    # and advance the document to the next pipeline stage
    advance_result = await _check_and_advance_schema_review(
        item.doc_id, item, service, client, settings
    )
    result.update(advance_result)

    return result


@router.delete("/{item_id}")
async def delete_pending_item(
    item_id: str,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Delete a pending item without any action."""
    if not service.remove(item_id):
        raise HTTPException(status_code=404, detail="Pending item not found")
    return {"id": item_id, "deleted": True}


@router.delete("/document/{doc_id}")
async def delete_pending_for_document(
    doc_id: int,
    type: Literal["correspondent", "document_type", "tag"] | None = None,
    service: PendingReviewsService = Depends(get_pending_reviews_service),
):
    """Delete all pending items for a document."""
    removed = service.remove_by_doc(doc_id, item_type=type)
    return {"doc_id": doc_id, "removed": removed}
