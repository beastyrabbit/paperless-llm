"""Analysis result models for structured LLM output."""

from pydantic import BaseModel, Field


class TitleAnalysis(BaseModel):
    """Result of title analysis."""

    suggested_title: str = Field(description="The suggested title for the document")
    reasoning: str = Field(description="Explanation for why this title was chosen")
    confidence: float = Field(ge=0, le=1, description="Confidence score (0-1)")
    based_on_similar: list[str] = Field(
        default_factory=list,
        description="Titles of similar documents that influenced this suggestion",
    )


class CorrespondentAnalysis(BaseModel):
    """Result of correspondent analysis."""

    suggested_correspondent: str = Field(description="Name of the suggested correspondent")
    is_new: bool = Field(description="Whether this is a new correspondent not in the system")
    existing_correspondent_id: int | None = Field(
        default=None,
        description="ID of existing correspondent if matched",
    )
    reasoning: str = Field(description="Explanation for this suggestion")
    confidence: float = Field(ge=0, le=1, description="Confidence score (0-1)")
    alternatives: list[str] = Field(
        default_factory=list,
        description="Alternative correspondent suggestions",
    )


class DocumentTypeAnalysis(BaseModel):
    """Result of document type analysis."""

    suggested_document_type: str = Field(description="Name of the suggested document type")
    is_new: bool = Field(description="Whether this is a new document type not in the system")
    existing_document_type_id: int | None = Field(
        default=None,
        description="ID of existing document type if matched",
    )
    reasoning: str = Field(description="Explanation for this suggestion")
    confidence: float = Field(ge=0, le=1, description="Confidence score (0-1)")
    alternatives: list[str] = Field(
        default_factory=list,
        description="Alternative document type suggestions",
    )


class TagSuggestion(BaseModel):
    """A single tag suggestion."""

    name: str = Field(description="Tag name")
    is_new: bool = Field(description="Whether this tag needs to be created")
    existing_tag_id: int | None = Field(default=None, description="ID if existing")
    relevance: str = Field(description="Why this tag is relevant")


class TagsAnalysis(BaseModel):
    """Result of tags analysis."""

    suggested_tags: list[TagSuggestion] = Field(description="List of suggested tags")
    reasoning: str = Field(description="Overall reasoning for tag selection")
    confidence: float = Field(ge=0, le=1, description="Confidence score (0-1)")


class CustomFieldValue(BaseModel):
    """A custom field value suggestion."""

    field_id: int = Field(description="Custom field ID")
    field_name: str = Field(description="Custom field name")
    value: str | int | float | bool = Field(description="Suggested value")
    reasoning: str = Field(description="Why this value was extracted")


class CustomFieldsAnalysis(BaseModel):
    """Result of custom fields analysis."""

    suggested_fields: list[CustomFieldValue] = Field(
        default_factory=list,
        description="List of custom field values to set",
    )
    reasoning: str = Field(description="Overall reasoning")


class ConfirmationResult(BaseModel):
    """Result of the confirmation step (smaller model)."""

    confirmed: bool = Field(description="Whether the analysis is confirmed")
    feedback: str = Field(description="Feedback on the analysis, especially if not confirmed")
    suggested_changes: str | None = Field(
        default=None,
        description="Specific changes suggested if not confirmed",
    )
