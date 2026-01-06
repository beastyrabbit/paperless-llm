"""API router for schema management (blocked suggestions)."""

from fastapi import APIRouter, HTTPException, Query

from models.blocked import (
    BlockedSuggestionResponse,
    BlockSuggestionRequest,
    BlockType,
)
from services.database import get_database_service

router = APIRouter()


@router.get("/blocked", response_model=list[BlockedSuggestionResponse])
async def list_blocked_suggestions(
    block_type: BlockType | None = Query(default=None, description="Filter by block type"),
) -> list[BlockedSuggestionResponse]:
    """List all blocked suggestions, optionally filtered by type."""
    db = get_database_service()
    suggestions = db.get_blocked_suggestions(block_type=block_type.value if block_type else None)
    return [BlockedSuggestionResponse.from_blocked_suggestion(s) for s in suggestions]


@router.post("/blocked", response_model=BlockedSuggestionResponse)
async def block_suggestion(
    request: BlockSuggestionRequest,
) -> BlockedSuggestionResponse:
    """Block a suggestion from being suggested again."""
    db = get_database_service()

    # Check if already blocked
    if db.is_suggestion_blocked(request.suggestion_name, request.block_type.value):
        raise HTTPException(
            status_code=400,
            detail=f"Suggestion '{request.suggestion_name}' is already blocked for {request.block_type.value}",
        )

    suggestion = db.add_blocked_suggestion(request)

    return BlockedSuggestionResponse.from_blocked_suggestion(suggestion)


@router.delete("/blocked/{suggestion_id}")
async def unblock_suggestion(suggestion_id: int) -> dict:
    """Remove a blocked suggestion."""
    db = get_database_service()
    success = db.remove_blocked_suggestion(suggestion_id)

    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Blocked suggestion with id {suggestion_id} not found",
        )

    return {"success": True, "message": f"Unblocked suggestion {suggestion_id}"}


@router.get("/blocked/check")
async def check_if_blocked(
    name: str = Query(..., description="Suggestion name to check"),
    block_type: BlockType = Query(..., description="Block type to check"),
) -> dict:
    """Check if a suggestion name is blocked for a specific type."""
    db = get_database_service()
    is_blocked = db.is_suggestion_blocked(name, block_type.value)
    return {"name": name, "block_type": block_type.value, "is_blocked": is_blocked}
