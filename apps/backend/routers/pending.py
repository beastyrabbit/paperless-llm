"""Pending Reviews API endpoints."""

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
