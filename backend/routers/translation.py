"""Translation API endpoints."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.translation import get_translation_service

router = APIRouter()


# =========================================================================
# Request/Response Models
# =========================================================================


class TranslateTextRequest(BaseModel):
    """Request model for text translation."""

    text: str
    source_lang: str
    target_lang: str
    content_type: str = "general"
    content_key: str = ""
    use_cache: bool = True


class TranslateTextResponse(BaseModel):
    """Response model for text translation."""

    translated_text: str
    cached: bool
    model: str | None


class TranslatePromptsRequest(BaseModel):
    """Request model for translating all prompts."""

    source_lang: str
    target_lang: str


class TranslatePromptsResponse(BaseModel):
    """Response model for prompt translation."""

    success: bool
    total: int
    successful: int
    failed: int
    results: list[dict]


class ClearCacheRequest(BaseModel):
    """Request model for clearing translation cache."""

    target_lang: str | None = None
    content_type: str | None = None


# =========================================================================
# Endpoints
# =========================================================================


@router.post("/translate", response_model=TranslateTextResponse)
async def translate_text(request: TranslateTextRequest):
    """Translate text from source to target language."""
    service = get_translation_service()
    result = await service.translate_text(
        text=request.text,
        source_lang=request.source_lang,
        target_lang=request.target_lang,
        content_type=request.content_type,
        content_key=request.content_key,
        use_cache=request.use_cache,
    )
    return result


@router.post("/translate/prompts", response_model=TranslatePromptsResponse)
async def translate_prompts(request: TranslatePromptsRequest):
    """Translate all prompt files from source to target language."""
    service = get_translation_service()
    result = await service.translate_all_prompts(
        source_lang=request.source_lang,
        target_lang=request.target_lang,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error"))
    return result


@router.get("/translations/{target_lang}")
async def get_translations(target_lang: str, content_type: str | None = None):
    """Get cached translations for a target language."""
    service = get_translation_service()
    translations = service.get_cached_translations(target_lang, content_type)
    return {"translations": translations}


@router.post("/cache/clear")
async def clear_translation_cache(request: ClearCacheRequest):
    """Clear translation cache."""
    service = get_translation_service()
    result = service.clear_translation_cache(
        target_lang=request.target_lang,
        content_type=request.content_type,
    )
    return result


@router.get("/languages")
async def get_available_languages():
    """Get list of available languages."""
    return {
        "languages": [
            {"code": "en", "name": "English"},
            {"code": "de", "name": "German"},
            {"code": "fr", "name": "French"},
            {"code": "es", "name": "Spanish"},
            {"code": "it", "name": "Italian"},
            {"code": "pt", "name": "Portuguese"},
            {"code": "nl", "name": "Dutch"},
            {"code": "pl", "name": "Polish"},
            {"code": "ru", "name": "Russian"},
            {"code": "ja", "name": "Japanese"},
            {"code": "zh", "name": "Chinese"},
            {"code": "ko", "name": "Korean"},
        ]
    }
