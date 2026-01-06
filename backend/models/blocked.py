"""Pydantic models for blocked suggestions."""

from enum import Enum

from pydantic import BaseModel, Field, field_validator


class BlockType(str, Enum):
    """Type of suggestion being blocked."""

    GLOBAL = "global"
    CORRESPONDENT = "correspondent"
    DOCUMENT_TYPE = "document_type"
    TAG = "tag"


class RejectionCategory(str, Enum):
    """Category describing why a suggestion was rejected."""

    DUPLICATE = "duplicate"
    TOO_GENERIC = "too_generic"
    IRRELEVANT = "irrelevant"
    WRONG_FORMAT = "wrong_format"
    OTHER = "other"


class BlockedSuggestion(BaseModel):
    """Database model representation for a blocked suggestion."""

    id: int | None = None
    suggestion_name: str
    normalized_name: str
    block_type: BlockType
    rejection_reason: str | None = None
    rejection_category: RejectionCategory | None = None
    doc_id: int | None = None
    created_at: str | None = None


class BlockSuggestionRequest(BaseModel):
    """Request model for blocking a suggestion."""

    suggestion_name: str = Field(..., min_length=1, description="The suggestion name to block")
    block_type: BlockType = Field(..., description="Type of suggestion being blocked")
    rejection_reason: str | None = Field(
        default=None, description="Optional reason for blocking this suggestion"
    )
    rejection_category: RejectionCategory | None = Field(
        default=None, description="Category of rejection"
    )
    doc_id: int | None = Field(
        default=None, description="Document ID where this suggestion was rejected"
    )

    @field_validator("suggestion_name")
    @classmethod
    def strip_suggestion_name(cls, v: str) -> str:
        """Strip whitespace from suggestion name."""
        return v.strip()


class BlockedSuggestionResponse(BaseModel):
    """Response model for blocked suggestion operations."""

    id: int
    suggestion_name: str
    normalized_name: str
    block_type: BlockType
    rejection_reason: str | None = None
    rejection_category: RejectionCategory | None = None
    doc_id: int | None = None
    created_at: str | None = None

    @classmethod
    def from_blocked_suggestion(cls, suggestion: BlockedSuggestion) -> "BlockedSuggestionResponse":
        """Create response from database model."""
        return cls(
            id=suggestion.id,  # type: ignore
            suggestion_name=suggestion.suggestion_name,
            normalized_name=suggestion.normalized_name,
            block_type=suggestion.block_type,
            rejection_reason=suggestion.rejection_reason,
            rejection_category=suggestion.rejection_category,
            doc_id=suggestion.doc_id,
            created_at=suggestion.created_at,
        )
