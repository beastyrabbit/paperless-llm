"""Pydantic models for schema analysis suggestions."""

from typing import Literal

from pydantic import BaseModel, Field


class SchemaSuggestion(BaseModel):
    """A single schema improvement suggestion."""

    entity_type: Literal["correspondent", "document_type", "tag"] = Field(
        description="Type of entity being suggested"
    )
    suggested_name: str = Field(description="The suggested name for the new entity")
    reasoning: str = Field(description="Explanation for why this entity should be created")
    confidence: float = Field(ge=0, le=1, description="Confidence score for this suggestion (0-1)")
    similar_to_existing: list[str] = Field(
        default_factory=list,
        description="Names of existing entities that are similar to this suggestion",
    )


class PendingMatch(BaseModel):
    """A match to an already-pending suggestion."""

    entity_type: Literal["correspondent", "document_type", "tag"] = Field(
        description="Type of entity matched"
    )
    matched_name: str = Field(description="The pending suggestion name that this document matches")


class SchemaAnalysisResult(BaseModel):
    """Result of schema analysis for a document."""

    suggestions: list[SchemaSuggestion] = Field(
        default_factory=list,
        description="List of suggested new entities",
    )
    matches_pending: list[PendingMatch] = Field(
        default_factory=list,
        description="List of pending suggestions that this document also matches (increment their count)",
    )
    reasoning: str = Field(description="Overall reasoning for the schema analysis")
    no_suggestions_reason: str | None = Field(
        default=None,
        description="Explanation if no suggestions were made",
    )
