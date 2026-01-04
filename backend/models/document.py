"""Document-related Pydantic models."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class ProcessingState(str, Enum):
    """Document processing state.
    
    Order: PENDING → OCR_DONE → CORRESPONDENT_DONE → DOCUMENT_TYPE_DONE → TITLE_DONE → TAGS_DONE → PROCESSED
    """

    PENDING = "pending"
    OCR_DONE = "ocr_done"
    CORRESPONDENT_DONE = "correspondent_done"
    DOCUMENT_TYPE_DONE = "document_type_done"
    TITLE_DONE = "title_done"
    TAGS_DONE = "tags_done"
    PROCESSED = "processed"
    NEEDS_REVIEW = "needs_review"
    ERROR = "error"


class DocumentInfo(BaseModel):
    """Document information for processing."""

    id: int
    title: str
    content: str = Field(default="", description="OCR content of the document")
    original_filename: str | None = None
    created: datetime | None = None
    correspondent_id: int | None = None
    correspondent_name: str | None = None
    tags: list[dict] = Field(default_factory=list)
    custom_fields: list[dict] = Field(default_factory=list)
    processing_state: ProcessingState = ProcessingState.PENDING

    class Config:
        use_enum_values = True


class SimilarDocument(BaseModel):
    """A similar document found via vector search."""

    doc_id: int
    title: str
    correspondent: str | None = None
    tags: list[str] = Field(default_factory=list)
    similarity_score: float
    content_snippet: str = Field(default="", max_length=500)
