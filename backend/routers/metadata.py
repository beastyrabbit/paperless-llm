"""Metadata API endpoints for tags and custom fields."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama
from pydantic import BaseModel

from config import Settings, get_settings
from services.database import (
    get_database_service,
)

router = APIRouter()


# =========================================================================
# Request/Response Models
# =========================================================================


class TagMetadataUpdate(BaseModel):
    """Request model for updating tag metadata."""

    tag_name: str
    description: str | None = None
    category: str | None = None
    exclude_from_ai: bool = False


class CustomFieldMetadataUpdate(BaseModel):
    """Request model for updating custom field metadata."""

    field_name: str
    description: str | None = None
    extraction_hints: str | None = None
    value_format: str | None = None
    example_values: list[str] | None = None


class TagMetadataResponse(BaseModel):
    """Response model for tag metadata."""

    id: int | None
    paperless_tag_id: int
    tag_name: str
    description: str | None
    category: str | None
    exclude_from_ai: bool


class CustomFieldMetadataResponse(BaseModel):
    """Response model for custom field metadata."""

    id: int | None
    paperless_field_id: int
    field_name: str
    description: str | None
    extraction_hints: str | None
    value_format: str | None
    example_values: list[str]


# =========================================================================
# Tag Metadata Endpoints
# =========================================================================


@router.get("/tags", response_model=list[TagMetadataResponse])
async def list_tag_metadata():
    """Get all tag metadata."""
    db = get_database_service()
    return db.get_all_tag_metadata()


@router.get("/tags/{tag_id}", response_model=TagMetadataResponse)
async def get_tag_metadata(tag_id: int):
    """Get metadata for a specific tag."""
    db = get_database_service()
    metadata = db.get_tag_metadata(tag_id)
    if not metadata:
        raise HTTPException(status_code=404, detail=f"No metadata for tag {tag_id}")
    return metadata


@router.put("/tags/{tag_id}", response_model=TagMetadataResponse)
async def upsert_tag_metadata(tag_id: int, data: TagMetadataUpdate):
    """Create or update tag metadata."""
    db = get_database_service()
    return db.upsert_tag_metadata(
        paperless_tag_id=tag_id,
        tag_name=data.tag_name,
        description=data.description,
        category=data.category,
        exclude_from_ai=data.exclude_from_ai,
    )


@router.delete("/tags/{tag_id}")
async def delete_tag_metadata(tag_id: int):
    """Delete tag metadata."""
    db = get_database_service()
    deleted = db.delete_tag_metadata(tag_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No metadata for tag {tag_id}")
    return {"deleted": True, "tag_id": tag_id}


@router.post("/tags/bulk", response_model=list[TagMetadataResponse])
async def bulk_upsert_tag_metadata(items: list[dict]):
    """Bulk create or update tag metadata.

    Expects list of dicts with:
    - paperless_tag_id: int
    - tag_name: str
    - description: str | None
    - category: str | None
    - exclude_from_ai: bool
    """
    db = get_database_service()
    results = []
    for item in items:
        result = db.upsert_tag_metadata(
            paperless_tag_id=item["paperless_tag_id"],
            tag_name=item["tag_name"],
            description=item.get("description"),
            category=item.get("category"),
            exclude_from_ai=item.get("exclude_from_ai", False),
        )
        results.append(result)
    return results


# =========================================================================
# Custom Field Metadata Endpoints
# =========================================================================


@router.get("/custom-fields", response_model=list[CustomFieldMetadataResponse])
async def list_custom_field_metadata():
    """Get all custom field metadata."""
    db = get_database_service()
    return db.get_all_custom_field_metadata()


@router.get("/custom-fields/{field_id}", response_model=CustomFieldMetadataResponse)
async def get_custom_field_metadata(field_id: int):
    """Get metadata for a specific custom field."""
    db = get_database_service()
    metadata = db.get_custom_field_metadata(field_id)
    if not metadata:
        raise HTTPException(status_code=404, detail=f"No metadata for field {field_id}")
    return metadata


@router.put("/custom-fields/{field_id}", response_model=CustomFieldMetadataResponse)
async def upsert_custom_field_metadata(field_id: int, data: CustomFieldMetadataUpdate):
    """Create or update custom field metadata."""
    db = get_database_service()
    return db.upsert_custom_field_metadata(
        paperless_field_id=field_id,
        field_name=data.field_name,
        description=data.description,
        extraction_hints=data.extraction_hints,
        value_format=data.value_format,
        example_values=data.example_values,
    )


@router.delete("/custom-fields/{field_id}")
async def delete_custom_field_metadata(field_id: int):
    """Delete custom field metadata."""
    db = get_database_service()
    deleted = db.delete_custom_field_metadata(field_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"No metadata for field {field_id}")
    return {"deleted": True, "field_id": field_id}


@router.post("/custom-fields/bulk", response_model=list[CustomFieldMetadataResponse])
async def bulk_upsert_custom_field_metadata(items: list[dict]):
    """Bulk create or update custom field metadata.

    Expects list of dicts with:
    - paperless_field_id: int
    - field_name: str
    - description: str | None
    - extraction_hints: str | None
    - value_format: str | None
    - example_values: list[str] | None
    """
    db = get_database_service()
    results = []
    for item in items:
        result = db.upsert_custom_field_metadata(
            paperless_field_id=item["paperless_field_id"],
            field_name=item["field_name"],
            description=item.get("description"),
            extraction_hints=item.get("extraction_hints"),
            value_format=item.get("value_format"),
            example_values=item.get("example_values"),
        )
        results.append(result)
    return results


# =========================================================================
# Tag Description Optimization & Translation
# =========================================================================


class OptimizeDescriptionRequest(BaseModel):
    """Request to optimize a tag description."""

    description: str
    tag_name: str


class OptimizeDescriptionResponse(BaseModel):
    """Response with optimized description."""

    original: str
    optimized: str
    model: str


class TranslateDescriptionRequest(BaseModel):
    """Request to translate a tag description to all languages."""

    description: str
    source_lang: str = "en"


class TagTranslation(BaseModel):
    """A single tag description translation."""

    lang: str
    text: str


class TranslateDescriptionResponse(BaseModel):
    """Response with all translations."""

    original: str
    source_lang: str
    translations: list[TagTranslation]
    model: str


class TagDescriptionTranslationsResponse(BaseModel):
    """Response with all stored translations for a tag."""

    tag_id: int
    source_description: str | None
    translations: dict[str, str]  # lang -> translated_text
    translated_langs: list[str]


@router.post("/tags/{tag_id}/optimize-description", response_model=OptimizeDescriptionResponse)
async def optimize_tag_description(
    tag_id: int,
    request: OptimizeDescriptionRequest,
    settings: Settings = Depends(get_settings),
):
    """Optimize a tag description using AI.

    The AI will rewrite the description to be clear, concise (1-2 sentences),
    and explicitly explain what the tag is used for.
    """
    model = ChatOllama(
        base_url=settings.ollama_url,
        model=settings.ollama_model_small,
        temperature=0.3,
    )

    prompt = f"""You are helping optimize a tag description for a document management system.
The tag name is: "{request.tag_name}"
The current description is: "{request.description}"

Rewrite this description to be:
1. Clear and explicit about what this tag is used for
2. Concise - maximum 1-2 sentences
3. Precise and specific

The description should help an AI system understand when to apply this tag to documents.

Return ONLY the optimized description text, nothing else. No quotes, no explanation."""

    try:
        messages = [HumanMessage(content=prompt)]
        response = await model.ainvoke(messages)
        optimized = response.content.strip()
        # Remove any quotes that might have been added
        optimized = optimized.strip("\"'")

        return OptimizeDescriptionResponse(
            original=request.description,
            optimized=optimized,
            model=settings.ollama_model_small,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to optimize description: {e}")


@router.post("/tags/{tag_id}/translate-description", response_model=TranslateDescriptionResponse)
async def translate_tag_description(
    tag_id: int,
    request: TranslateDescriptionRequest,
    settings: Settings = Depends(get_settings),
):
    """Translate a tag description to all available UI and prompt languages.

    Translations are stored in the database for later retrieval.
    """
    db = get_database_service()

    prompts_dir = Path(__file__).parent.parent / "prompts"
    available_langs = set()

    # Add prompt languages
    if prompts_dir.exists():
        for lang_dir in prompts_dir.iterdir():
            if lang_dir.is_dir() and len(lang_dir.name) == 2:
                available_langs.add(lang_dir.name)

    # Add common UI languages
    available_langs.update(["en", "de"])

    # Remove source language
    target_langs = available_langs - {request.source_lang}

    # Use translation model if configured, otherwise use small model
    model_name = settings.ollama_model_translation or settings.ollama_model_small

    llm = ChatOllama(
        base_url=settings.ollama_url,
        model=model_name,
        temperature=0.3,
    )

    translations = []

    for target_lang in sorted(target_langs):
        # Check if we already have a translation
        existing = db.get_translation(
            source_lang=request.source_lang,
            target_lang=target_lang,
            content_type="tag_description",
            content_key=str(tag_id),
        )

        if existing and existing.source_text == request.description:
            # Use cached translation
            translations.append(TagTranslation(lang=target_lang, text=existing.translated_text))
            continue

        # Translate using LLM
        prompt = f"""Translate the following text from {request.source_lang} to {target_lang}.
This is a tag description for a document management system.
Return ONLY the translated text, nothing else.

Text to translate:
{request.description}"""

        try:
            messages = [HumanMessage(content=prompt)]
            response = await llm.ainvoke(messages)
            translated = response.content.strip()

            # Store translation
            db.upsert_translation(
                source_lang=request.source_lang,
                target_lang=target_lang,
                content_type="tag_description",
                content_key=str(tag_id),
                source_text=request.description,
                translated_text=translated,
                model_used=model_name,
            )

            translations.append(TagTranslation(lang=target_lang, text=translated))
        except Exception as e:
            # Log error but continue with other translations
            print(f"Failed to translate to {target_lang}: {e}")

    # Also store the source description as a "translation" to itself for consistency
    db.upsert_translation(
        source_lang=request.source_lang,
        target_lang=request.source_lang,
        content_type="tag_description",
        content_key=str(tag_id),
        source_text=request.description,
        translated_text=request.description,
        model_used=None,
    )

    return TranslateDescriptionResponse(
        original=request.description,
        source_lang=request.source_lang,
        translations=translations,
        model=model_name,
    )


@router.get("/tags/{tag_id}/translations", response_model=TagDescriptionTranslationsResponse)
async def get_tag_translations(tag_id: int):
    """Get all stored translations for a tag description."""
    db = get_database_service()

    # Get the tag metadata for source description
    tag_meta = db.get_tag_metadata(tag_id)
    source_description = tag_meta.description if tag_meta else None

    # Get all translations
    translations = db.get_translations_for_content("tag_description", str(tag_id))

    translation_dict = {t.target_lang: t.translated_text for t in translations}
    translated_langs = list(translation_dict.keys())

    return TagDescriptionTranslationsResponse(
        tag_id=tag_id,
        source_description=source_description,
        translations=translation_dict,
        translated_langs=translated_langs,
    )


class SaveTranslationRequest(BaseModel):
    """Request to save a single translation."""

    lang: str
    text: str


class SaveTranslationResponse(BaseModel):
    """Response after saving a translation."""

    tag_id: int
    lang: str
    saved: bool


@router.put("/tags/{tag_id}/translations/{lang}", response_model=SaveTranslationResponse)
async def save_tag_translation(tag_id: int, lang: str, request: SaveTranslationRequest):
    """Save a single translation for a tag description.

    This stores the translation without triggering AI translation.
    """
    db = get_database_service()

    # Store the translation (source and target are the same - it's a manual entry)
    db.upsert_translation(
        source_lang=lang,
        target_lang=lang,
        content_type="tag_description",
        content_key=str(tag_id),
        source_text=request.text,
        translated_text=request.text,
        model_used=None,  # Manual entry
    )

    return SaveTranslationResponse(
        tag_id=tag_id,
        lang=lang,
        saved=True,
    )
