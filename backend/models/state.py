"""LangGraph state models."""

from enum import Enum
from typing import Annotated, Any

from langgraph.graph.message import add_messages
from pydantic import BaseModel, Field


class ProcessingStep(str, Enum):
    """Current processing step."""

    OCR = "ocr"
    TITLE = "title"
    CORRESPONDENT = "correspondent"
    TAGS = "tags"
    CUSTOM_FIELDS = "custom_fields"
    COMPLETE = "complete"


class AgentState(BaseModel):
    """State for the processing agents."""

    # Document info
    doc_id: int
    doc_title: str = ""
    doc_content: str = ""

    # Current step
    current_step: ProcessingStep = ProcessingStep.OCR

    # Retry tracking
    retry_count: int = 0
    max_retries: int = 3

    # Analysis results
    title_analysis: dict | None = None
    correspondent_analysis: dict | None = None
    tags_analysis: dict | None = None
    custom_fields_analysis: dict | None = None

    # Confirmation state
    awaiting_confirmation: bool = False
    confirmation_type: str | None = None

    # Similar documents for context
    similar_docs: list[dict] = Field(default_factory=list)

    # Messages for agent conversation
    messages: Annotated[list[Any], add_messages] = Field(default_factory=list)

    # Error handling
    error: str | None = None
    needs_user_review: bool = False
    user_review_reason: str | None = None

    class Config:
        arbitrary_types_allowed = True
