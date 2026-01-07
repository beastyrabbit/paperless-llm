"""Settings API endpoints."""

from typing import Literal

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from config import Settings, clear_settings_cache, get_settings, save_settings_to_yaml
from services.paperless import PaperlessClient

router = APIRouter()


# =============================================================================
# Response Models
# =============================================================================


class SettingsResponse(BaseModel):
    """Full settings response model."""

    # External Services
    paperless_url: str
    paperless_token: str
    mistral_api_key: str
    mistral_model: str
    ollama_url: str
    ollama_model_large: str
    ollama_model_small: str
    ollama_model_translation: str
    ollama_embedding_model: str
    ollama_thinking_enabled: bool
    ollama_thinking_level: str
    qdrant_url: str
    qdrant_collection: str

    # Processing Settings
    auto_processing_enabled: bool
    auto_processing_interval_minutes: int
    auto_processing_pause_on_user_activity: bool
    confirmation_max_retries: int
    confirmation_require_user_for_new_entities: bool

    # Pipeline Settings
    pipeline_ocr: bool
    pipeline_correspondent: bool
    pipeline_document_type: bool
    pipeline_title: bool
    pipeline_tags: bool
    pipeline_custom_fields: bool

    # Vector Search Settings
    vector_search_enabled: bool
    vector_search_top_k: int
    vector_search_min_score: float

    # Language Settings
    prompt_language: str

    # Debug Settings
    debug_log_level: str
    debug_log_prompts: bool
    debug_log_responses: bool
    debug_save_processing_history: bool

    # Tags
    tags: dict[str, str]


class SettingsUpdate(BaseModel):
    """Settings update model - all fields optional."""

    # External Services
    paperless_url: str | None = None
    paperless_token: str | None = None
    mistral_api_key: str | None = None
    mistral_model: str | None = None
    ollama_url: str | None = None
    ollama_model_large: str | None = None
    ollama_model_small: str | None = None
    ollama_model_translation: str | None = None
    ollama_embedding_model: str | None = None
    ollama_thinking_enabled: bool | None = None
    ollama_thinking_level: Literal["low", "medium", "high"] | None = None
    qdrant_url: str | None = None
    qdrant_collection: str | None = None

    # Processing Settings
    auto_processing_enabled: bool | None = None
    auto_processing_interval_minutes: int | None = None
    auto_processing_pause_on_user_activity: bool | None = None
    confirmation_max_retries: int | None = None
    confirmation_require_user_for_new_entities: bool | None = None

    # Pipeline Settings
    pipeline_ocr: bool | None = None
    pipeline_correspondent: bool | None = None
    pipeline_document_type: bool | None = None
    pipeline_title: bool | None = None
    pipeline_tags: bool | None = None
    pipeline_custom_fields: bool | None = None

    # Vector Search Settings
    vector_search_enabled: bool | None = None
    vector_search_top_k: int | None = None
    vector_search_min_score: float | None = None

    # Language Settings
    prompt_language: str | None = None

    # Debug Settings
    debug_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] | None = None
    debug_log_prompts: bool | None = None
    debug_log_responses: bool | None = None
    debug_save_processing_history: bool | None = None

    # Tags
    tag_pending: str | None = None
    tag_ocr_done: str | None = None
    tag_schema_review: str | None = None
    tag_correspondent_done: str | None = None
    tag_document_type_done: str | None = None
    tag_title_done: str | None = None
    tag_tags_done: str | None = None
    tag_processed: str | None = None


class OllamaModel(BaseModel):
    """Ollama model info."""

    name: str
    size: str
    modified: str
    digest: str


class ModelsResponse(BaseModel):
    """Available models response."""

    models: list[OllamaModel]


# In-memory settings override (for runtime updates)
_runtime_settings: dict = {}


def _get_setting(key: str, settings: Settings):
    """Get setting value with runtime override."""
    return _runtime_settings.get(key, getattr(settings, key))


# =============================================================================
# Settings Endpoints
# =============================================================================


@router.get("", response_model=SettingsResponse)
async def get_current_settings(settings: Settings = Depends(get_settings)):
    """Get current application settings."""
    return SettingsResponse(
        # External Services
        paperless_url=_get_setting("paperless_url", settings),
        paperless_token=_get_setting("paperless_token", settings),
        mistral_api_key=_get_setting("mistral_api_key", settings),
        mistral_model=_get_setting("mistral_model", settings),
        ollama_url=_get_setting("ollama_url", settings),
        ollama_model_large=_get_setting("ollama_model_large", settings),
        ollama_model_small=_get_setting("ollama_model_small", settings),
        ollama_model_translation=_get_setting("ollama_model_translation", settings),
        ollama_embedding_model=_get_setting("ollama_embedding_model", settings),
        ollama_thinking_enabled=_get_setting("ollama_thinking_enabled", settings),
        ollama_thinking_level=_get_setting("ollama_thinking_level", settings),
        qdrant_url=_get_setting("qdrant_url", settings),
        qdrant_collection=_get_setting("qdrant_collection", settings),
        # Processing Settings
        auto_processing_enabled=_get_setting("auto_processing_enabled", settings),
        auto_processing_interval_minutes=_get_setting("auto_processing_interval_minutes", settings),
        auto_processing_pause_on_user_activity=_get_setting(
            "auto_processing_pause_on_user_activity", settings
        ),
        confirmation_max_retries=_get_setting("confirmation_max_retries", settings),
        confirmation_require_user_for_new_entities=_get_setting(
            "confirmation_require_user_for_new_entities", settings
        ),
        # Pipeline Settings
        pipeline_ocr=_get_setting("pipeline_ocr", settings),
        pipeline_correspondent=_get_setting("pipeline_correspondent", settings),
        pipeline_document_type=_get_setting("pipeline_document_type", settings),
        pipeline_title=_get_setting("pipeline_title", settings),
        pipeline_tags=_get_setting("pipeline_tags", settings),
        pipeline_custom_fields=_get_setting("pipeline_custom_fields", settings),
        # Vector Search Settings
        vector_search_enabled=_get_setting("vector_search_enabled", settings),
        vector_search_top_k=_get_setting("vector_search_top_k", settings),
        vector_search_min_score=_get_setting("vector_search_min_score", settings),
        # Language Settings
        prompt_language=_get_setting("prompt_language", settings),
        # Debug Settings
        debug_log_level=_get_setting("debug_log_level", settings),
        debug_log_prompts=_get_setting("debug_log_prompts", settings),
        debug_log_responses=_get_setting("debug_log_responses", settings),
        debug_save_processing_history=_get_setting("debug_save_processing_history", settings),
        # Tags
        tags={
            "pending": _get_setting("tag_pending", settings),
            "ocr_done": _get_setting("tag_ocr_done", settings),
            "schema_review": _get_setting("tag_schema_review", settings),
            "correspondent_done": _get_setting("tag_correspondent_done", settings),
            "document_type_done": _get_setting("tag_document_type_done", settings),
            "title_done": _get_setting("tag_title_done", settings),
            "tags_done": _get_setting("tag_tags_done", settings),
            "processed": _get_setting("tag_processed", settings),
        },
    )


@router.patch("")
async def update_settings(update: SettingsUpdate):
    """Update application settings at runtime and persist to config.yaml."""
    updated = update.model_dump(exclude_none=True)

    # Update runtime settings
    for key, value in updated.items():
        _runtime_settings[key] = value

    # Persist to config.yaml
    try:
        config_path = save_settings_to_yaml(updated)
        # Clear the settings cache so next load gets fresh values
        clear_settings_cache()
        # Clear the pipeline cache so it picks up new settings (lazy import to avoid circular dependency)
        from routers.processing import clear_pipeline_cache

        clear_pipeline_cache()
        return {
            "status": "updated",
            "updated_fields": list(updated.keys()),
            "config_file": str(config_path) if config_path else None,
        }
    except Exception as e:
        # Still return success for runtime update even if file save fails
        # Still clear caches for runtime changes
        from routers.processing import clear_pipeline_cache

        clear_pipeline_cache()
        return {
            "status": "updated",
            "updated_fields": list(updated.keys()),
            "warning": f"Runtime updated but failed to save to config.yaml: {str(e)}",
        }


# =============================================================================
# Model Discovery Endpoints
# =============================================================================


@router.get("/ollama/models")
async def get_ollama_models(settings: Settings = Depends(get_settings)):
    """Get available models from Ollama server."""
    url = _get_setting("ollama_url", settings)
    if not url:
        return {"models": [], "error": "Ollama URL not configured"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{url}/api/tags", timeout=30.0)
            if response.status_code == 200:
                data = response.json()
                models = []
                for model in data.get("models", []):
                    # Parse size to human readable
                    size_bytes = model.get("size", 0)
                    if size_bytes > 1e9:
                        size_str = f"{size_bytes / 1e9:.1f} GB"
                    elif size_bytes > 1e6:
                        size_str = f"{size_bytes / 1e6:.1f} MB"
                    else:
                        size_str = f"{size_bytes} B"

                    models.append(
                        {
                            "name": model.get("name", ""),
                            "size": size_str,
                            "modified": model.get("modified_at", ""),
                            "digest": model.get("digest", "")[:12],
                            "details": model.get("details", {}),
                        }
                    )
                # Sort by name
                models.sort(key=lambda x: x["name"])
                return {"models": models}
            return {"models": [], "error": f"HTTP {response.status_code}"}
    except httpx.TimeoutException:
        return {"models": [], "error": "Connection timeout"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@router.get("/mistral/models")
async def get_mistral_models(settings: Settings = Depends(get_settings)):
    """Get available models from Mistral API."""
    api_key = _get_setting("mistral_api_key", settings)
    if not api_key:
        return {"models": [], "error": "Mistral API key not configured"}

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://api.mistral.ai/v1/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=30.0,
            )
            if response.status_code == 200:
                data = response.json()
                models = [
                    {
                        "id": m.get("id", ""),
                        "name": m.get("id", "").replace("-", " ").title(),
                        "created": m.get("created", 0),
                    }
                    for m in data.get("data", [])
                ]
                # Filter for OCR-capable models and sort
                models.sort(key=lambda x: x["id"])
                return {"models": models}
            return {"models": [], "error": f"HTTP {response.status_code}"}
    except httpx.TimeoutException:
        return {"models": [], "error": "Connection timeout"}
    except Exception as e:
        return {"models": [], "error": str(e)}


# =============================================================================
# Connection Test Endpoints
# =============================================================================


@router.post("/test-connection/{service}")
async def test_connection(service: str, settings: Settings = Depends(get_settings)):
    """Test connection to external services."""
    if service == "paperless":
        url = _get_setting("paperless_url", settings)
        token = _get_setting("paperless_token", settings)
        if not url or not token:
            return {"status": "error", "service": service, "detail": "URL or token not configured"}
        try:
            async with httpx.AsyncClient(follow_redirects=True) as client:
                response = await client.get(
                    f"{url}/api/",
                    headers={"Authorization": f"Token {token}"},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    return {"status": "connected", "service": service}
                return {
                    "status": "error",
                    "service": service,
                    "detail": f"HTTP {response.status_code}",
                }
        except Exception as e:
            return {"status": "error", "service": service, "detail": str(e)}

    elif service == "ollama":
        url = _get_setting("ollama_url", settings)
        if not url:
            return {"status": "error", "service": service, "detail": "URL not configured"}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{url}/api/tags", timeout=10.0)
                if response.status_code == 200:
                    models = response.json().get("models", [])
                    return {
                        "status": "connected",
                        "service": service,
                        "models_count": len(models),
                    }
                return {
                    "status": "error",
                    "service": service,
                    "detail": f"HTTP {response.status_code}",
                }
        except Exception as e:
            return {"status": "error", "service": service, "detail": str(e)}

    elif service == "qdrant":
        url = _get_setting("qdrant_url", settings)
        if not url:
            return {"status": "error", "service": service, "detail": "URL not configured"}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(f"{url}/collections", timeout=10.0)
                if response.status_code == 200:
                    collections = response.json().get("result", {}).get("collections", [])
                    return {
                        "status": "connected",
                        "service": service,
                        "collections_count": len(collections),
                    }
                return {
                    "status": "error",
                    "service": service,
                    "detail": f"HTTP {response.status_code}",
                }
        except Exception as e:
            return {"status": "error", "service": service, "detail": str(e)}

    elif service == "mistral":
        api_key = _get_setting("mistral_api_key", settings)
        if not api_key:
            return {"status": "error", "service": service, "detail": "API key not configured"}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    "https://api.mistral.ai/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=10.0,
                )
                if response.status_code == 200:
                    models = response.json().get("data", [])
                    return {
                        "status": "connected",
                        "service": service,
                        "models_count": len(models),
                    }
                return {
                    "status": "error",
                    "service": service,
                    "detail": f"HTTP {response.status_code}",
                }
        except Exception as e:
            return {"status": "error", "service": service, "detail": str(e)}

    return {"status": "error", "service": service, "detail": "Unknown service"}


# =============================================================================
# Workflow Tags Endpoints
# =============================================================================


class TagStatus(BaseModel):
    """Status of a single workflow tag."""

    key: str
    name: str
    exists: bool
    tag_id: int | None = None


class TagsStatusResponse(BaseModel):
    """Response for workflow tags status check."""

    tags: list[TagStatus]
    all_exist: bool
    missing_count: int


class CreateTagsRequest(BaseModel):
    """Request to create missing tags."""

    tag_names: list[str]


class CreateTagsResponse(BaseModel):
    """Response for tag creation."""

    created: list[str]
    failed: list[str]
    errors: dict[str, str]


@router.get("/tags/status", response_model=TagsStatusResponse)
async def check_workflow_tags_status(settings: Settings = Depends(get_settings)):
    """Check if all configured workflow tags exist in Paperless."""
    url = _get_setting("paperless_url", settings)
    token = _get_setting("paperless_token", settings)

    if not url or not token:
        return TagsStatusResponse(tags=[], all_exist=False, missing_count=0)

    # Get configured workflow tags
    workflow_tags = {
        "pending": _get_setting("tag_pending", settings),
        "ocr_done": _get_setting("tag_ocr_done", settings),
        "schema_review": _get_setting("tag_schema_review", settings),
        "correspondent_done": _get_setting("tag_correspondent_done", settings),
        "document_type_done": _get_setting("tag_document_type_done", settings),
        "title_done": _get_setting("tag_title_done", settings),
        "tags_done": _get_setting("tag_tags_done", settings),
        "processed": _get_setting("tag_processed", settings),
    }

    try:
        client = PaperlessClient(url, token)
        existing_tags = await client.get_tags()
        existing_tag_map = {t["name"]: t["id"] for t in existing_tags}

        tag_statuses = []
        missing_count = 0

        for key, tag_name in workflow_tags.items():
            exists = tag_name in existing_tag_map
            tag_id = existing_tag_map.get(tag_name)
            if not exists:
                missing_count += 1
            tag_statuses.append(TagStatus(key=key, name=tag_name, exists=exists, tag_id=tag_id))

        return TagsStatusResponse(
            tags=tag_statuses,
            all_exist=missing_count == 0,
            missing_count=missing_count,
        )
    except Exception:
        return TagsStatusResponse(
            tags=[
                TagStatus(key=key, name=name, exists=False) for key, name in workflow_tags.items()
            ],
            all_exist=False,
            missing_count=len(workflow_tags),
        )


@router.post("/tags/create", response_model=CreateTagsResponse)
async def create_workflow_tags(
    request: CreateTagsRequest, settings: Settings = Depends(get_settings)
):
    """Create missing workflow tags in Paperless."""
    url = _get_setting("paperless_url", settings)
    token = _get_setting("paperless_token", settings)

    if not url or not token:
        return CreateTagsResponse(
            created=[],
            failed=request.tag_names,
            errors={"connection": "Paperless URL or token not configured"},
        )

    client = PaperlessClient(url, token)
    created = []
    failed = []
    errors = {}

    # Use a workflow tag color (e.g., blue for system tags)
    workflow_tag_color = "#1e88e5"

    for tag_name in request.tag_names:
        try:
            result = await client.create_tag(tag_name, color=workflow_tag_color)
            if result and "id" in result:
                created.append(tag_name)
            else:
                failed.append(tag_name)
                errors[tag_name] = "Unknown error during creation"
        except Exception as e:
            failed.append(tag_name)
            errors[tag_name] = str(e)

    return CreateTagsResponse(created=created, failed=failed, errors=errors)


# =============================================================================
# Custom Fields Endpoints
# =============================================================================


class CustomFieldDefinition(BaseModel):
    """Custom field definition from Paperless."""

    id: int
    name: str
    data_type: str
    extra_data: dict | None = None


class CustomFieldsResponse(BaseModel):
    """Response for custom fields."""

    fields: list[CustomFieldDefinition]
    selected_fields: list[int]  # IDs of fields enabled for LLM processing


@router.get("/custom-fields", response_model=CustomFieldsResponse)
async def get_custom_fields(settings: Settings = Depends(get_settings)):
    """Get all custom field definitions from Paperless."""
    url = _get_setting("paperless_url", settings)
    token = _get_setting("paperless_token", settings)

    if not url or not token:
        return CustomFieldsResponse(fields=[], selected_fields=[])

    try:
        client = PaperlessClient(url, token)
        fields = await client.get_custom_fields()

        field_defs = [
            CustomFieldDefinition(
                id=f["id"],
                name=f["name"],
                data_type=f["data_type"],
                extra_data=f.get("extra_data"),
            )
            for f in fields
        ]

        # Get selected fields from runtime settings first, then config
        selected = _runtime_settings.get("custom_fields_enabled")
        if selected is None:
            # Try from config
            selected = getattr(settings, "custom_fields_enabled", [])
            if not selected:
                # Default: all fields enabled if nothing configured
                selected = [f.id for f in field_defs]

        return CustomFieldsResponse(fields=field_defs, selected_fields=selected)
    except Exception:
        return CustomFieldsResponse(fields=[], selected_fields=[])


class UpdateCustomFieldsRequest(BaseModel):
    """Request to update selected custom fields."""

    selected_field_ids: list[int]


@router.patch("/custom-fields")
async def update_custom_fields_selection(request: UpdateCustomFieldsRequest):
    """Update which custom fields are enabled for LLM processing."""
    _runtime_settings["custom_fields_enabled"] = request.selected_field_ids

    # Persist to config.yaml
    try:
        config_path = save_settings_to_yaml({"custom_fields_enabled": request.selected_field_ids})
        clear_settings_cache()
        # Clear pipeline cache so it picks up changes
        from routers.processing import clear_pipeline_cache

        clear_pipeline_cache()
        return {
            "status": "updated",
            "selected_fields": request.selected_field_ids,
            "config_file": str(config_path) if config_path else None,
        }
    except Exception as e:
        return {
            "status": "updated",
            "selected_fields": request.selected_field_ids,
            "warning": f"Runtime updated but failed to save to config.yaml: {str(e)}",
        }


# =============================================================================
# AI Tags Endpoints - Tags available for AI suggestions
# =============================================================================


class PaperlessTagInfo(BaseModel):
    """Tag information from Paperless."""

    id: int
    name: str
    color: str
    matching_algorithm: int
    document_count: int


class AiTagsResponse(BaseModel):
    """Response for AI tags endpoint."""

    tags: list[PaperlessTagInfo]
    selected_tag_ids: list[int]  # IDs of tags the AI can suggest


class UpdateAiTagsRequest(BaseModel):
    """Request to update AI-enabled tags."""

    selected_tag_ids: list[int]


@router.get("/ai-tags", response_model=AiTagsResponse)
async def get_ai_tags(settings: Settings = Depends(get_settings)):
    """Get all tags from Paperless and which ones are enabled for AI suggestions."""
    url = _get_setting("paperless_url", settings)
    token = _get_setting("paperless_token", settings)

    if not url or not token:
        return AiTagsResponse(tags=[], selected_tag_ids=[])

    try:
        client = PaperlessClient(url, token)
        tags = await client.get_tags()

        tag_infos = [
            PaperlessTagInfo(
                id=t["id"],
                name=t["name"],
                color=t.get("color", "") or "",
                matching_algorithm=t.get("matching_algorithm", 0),
                document_count=t.get("document_count", 0),
            )
            for t in tags
        ]

        # Sort tags by name for consistent display
        tag_infos.sort(key=lambda x: x.name.lower())

        # Get selected tags from runtime settings first, then config
        selected = _runtime_settings.get("ai_tags_enabled")
        if selected is None:
            # Try from config
            selected = getattr(settings, "ai_tags_enabled", [])
            if not selected:
                # Default: all tags are enabled for AI
                selected = [t.id for t in tag_infos]

        return AiTagsResponse(tags=tag_infos, selected_tag_ids=selected)
    except Exception:
        return AiTagsResponse(tags=[], selected_tag_ids=[])


@router.patch("/ai-tags")
async def update_ai_tags_selection(request: UpdateAiTagsRequest):
    """Update which tags the AI can suggest when processing documents."""
    _runtime_settings["ai_tags_enabled"] = request.selected_tag_ids

    # Persist to config.yaml
    try:
        config_path = save_settings_to_yaml({"ai_tags_enabled": request.selected_tag_ids})
        clear_settings_cache()
        return {
            "status": "updated",
            "selected_tag_ids": request.selected_tag_ids,
            "config_file": str(config_path) if config_path else None,
        }
    except Exception as e:
        return {
            "status": "updated",
            "selected_tag_ids": request.selected_tag_ids,
            "warning": f"Runtime updated but failed to save to config.yaml: {str(e)}",
        }


# =============================================================================
# AI Document Types Endpoints - Document types available for AI suggestions
# =============================================================================


class DocumentTypeInfo(BaseModel):
    """Document type information from Paperless."""

    id: int
    name: str
    document_count: int


class AiDocumentTypesResponse(BaseModel):
    """Response for AI document types endpoint."""

    document_types: list[DocumentTypeInfo]
    selected_type_ids: list[int]  # IDs of document types the AI can suggest


class UpdateAiDocumentTypesRequest(BaseModel):
    """Request to update AI-enabled document types."""

    selected_type_ids: list[int]


@router.get("/ai-document-types", response_model=AiDocumentTypesResponse)
async def get_ai_document_types(settings: Settings = Depends(get_settings)):
    """Get all document types from Paperless and which ones are enabled for AI suggestions."""
    url = _get_setting("paperless_url", settings)
    token = _get_setting("paperless_token", settings)

    if not url or not token:
        return AiDocumentTypesResponse(document_types=[], selected_type_ids=[])

    try:
        client = PaperlessClient(url, token)
        doc_types = await client.get_document_types()

        type_infos = [
            DocumentTypeInfo(
                id=dt["id"],
                name=dt["name"],
                document_count=dt.get("document_count", 0),
            )
            for dt in doc_types
        ]

        # Sort by name for consistent display
        type_infos.sort(key=lambda x: x.name.lower())

        # Get selected types from runtime settings first, then config
        selected = _runtime_settings.get("ai_document_types_enabled")
        if selected is None:
            # Try from config
            selected = getattr(settings, "ai_document_types_enabled", [])
            if not selected:
                # Default: all document types are enabled for AI
                selected = [dt.id for dt in type_infos]

        return AiDocumentTypesResponse(document_types=type_infos, selected_type_ids=selected)
    except Exception:
        return AiDocumentTypesResponse(document_types=[], selected_type_ids=[])


@router.patch("/ai-document-types")
async def update_ai_document_types_selection(request: UpdateAiDocumentTypesRequest):
    """Update which document types the AI can suggest when processing documents."""
    _runtime_settings["ai_document_types_enabled"] = request.selected_type_ids

    # Persist to config.yaml
    try:
        config_path = save_settings_to_yaml(
            {"ai_document_types_enabled": request.selected_type_ids}
        )
        clear_settings_cache()
        return {
            "status": "updated",
            "selected_type_ids": request.selected_type_ids,
            "config_file": str(config_path) if config_path else None,
        }
    except Exception as e:
        return {
            "status": "updated",
            "selected_type_ids": request.selected_type_ids,
            "warning": f"Runtime updated but failed to save to config.yaml: {str(e)}",
        }
