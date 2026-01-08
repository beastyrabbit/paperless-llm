"""Prompts API endpoints."""

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from agents.prompts import DEFAULT_LANGUAGE, PROMPTS_DIR, get_available_languages
from config import get_settings
from services.paperless import PaperlessClient

router = APIRouter()

# Human-readable language names
LANGUAGE_NAMES = {
    "en": "English",
    "de": "Deutsch",
    "fr": "Français",
    "es": "Español",
    "it": "Italiano",
    "nl": "Nederlands",
    "pt": "Português",
    "pl": "Polski",
    "ru": "Русский",
    "ja": "日本語",
    "zh": "中文",
}

# Define prompt groups (main prompt -> confirmation prompt)
# Use None for prompts without a confirmation step
PROMPT_GROUPS = {
    # Pipeline prompts (with confirmation)
    "title": "title_confirmation",
    "correspondent": "correspondent_confirmation",
    "document_type": "document_type_confirmation",
    "tags": "tags_confirmation",
    # Standalone prompts (no confirmation)
    "schema_analysis": None,
    "schema_cleanup": None,
    "metadata_description": None,
    "custom_fields": None,
}


class PromptInfo(BaseModel):
    """Prompt information."""

    name: str
    filename: str
    content: str
    variables: list[str]
    description: str | None = None


class PromptGroup(BaseModel):
    """Grouped prompt with main and confirmation."""

    name: str
    main: PromptInfo
    confirmation: PromptInfo | None = None


class PromptUpdate(BaseModel):
    """Request to update a prompt."""

    content: str


class PreviewData(BaseModel):
    """Real data for prompt preview."""

    document_content: str
    existing_correspondents: str
    existing_types: str
    existing_tags: str
    similar_docs: str
    similar_titles: str
    feedback: str
    analysis_result: str
    document_excerpt: str


class LanguageInfo(BaseModel):
    """Information about an available language."""

    code: str
    name: str
    prompt_count: int
    is_complete: bool


class AvailableLanguagesResponse(BaseModel):
    """Response containing available languages."""

    languages: list[LanguageInfo]
    default: str
    current: str


# Expected prompts for completeness check
EXPECTED_PROMPTS = [
    "title",
    "title_confirmation",
    "correspondent",
    "correspondent_confirmation",
    "document_type",
    "document_type_confirmation",
    "tags",
    "tags_confirmation",
    "confirmation",
    "custom_fields",
]


def _get_prompts_dir(lang: str | None = None) -> Path:
    """Get the prompts directory for a specific language."""
    settings = get_settings()
    lang = lang or settings.prompt_language or DEFAULT_LANGUAGE

    lang_dir = PROMPTS_DIR / lang
    if lang_dir.exists():
        return lang_dir

    # Fall back to default language
    default_dir = PROMPTS_DIR / DEFAULT_LANGUAGE
    if default_dir.exists():
        return default_dir

    # Legacy fallback (flat structure)
    return PROMPTS_DIR


@router.get("/languages", response_model=AvailableLanguagesResponse)
async def list_available_languages():
    """List all available prompt languages."""
    settings = get_settings()
    languages = get_available_languages()

    lang_infos = []
    for lang in languages:
        lang_dir = PROMPTS_DIR / lang
        existing = [p for p in EXPECTED_PROMPTS if (lang_dir / f"{p}.md").exists()]
        lang_infos.append(
            LanguageInfo(
                code=lang,
                name=LANGUAGE_NAMES.get(lang, lang.upper()),
                prompt_count=len(existing),
                is_complete=len(existing) == len(EXPECTED_PROMPTS),
            )
        )

    return AvailableLanguagesResponse(
        languages=lang_infos,
        default=DEFAULT_LANGUAGE,
        current=settings.prompt_language,
    )


@router.get("", response_model=list[PromptInfo])
async def list_prompts(
    lang: str | None = Query(None, description="Language code (e.g., 'en', 'de')"),
):
    """List all available prompts for a specific language."""
    prompts = []

    prompts_dir = _get_prompts_dir(lang)
    if not prompts_dir.exists():
        return prompts

    for prompt_file in sorted(prompts_dir.glob("*.md")):
        content = prompt_file.read_text()
        variables = _extract_variables(content)
        description = _extract_description(content)

        prompts.append(
            PromptInfo(
                name=prompt_file.stem.replace("_", " ").title(),
                filename=prompt_file.name,
                content=content,
                variables=variables,
                description=description,
            )
        )

    return prompts


@router.get("/groups", response_model=list[PromptGroup])
async def list_prompt_groups(
    lang: str | None = Query(None, description="Language code (e.g., 'en', 'de')"),
):
    """List prompts grouped by main + confirmation for a specific language."""
    groups = []
    prompts_dir = _get_prompts_dir(lang)

    for main_name, confirmation_name in PROMPT_GROUPS.items():
        main_file = prompts_dir / f"{main_name}.md"

        if not main_file.exists():
            continue

        main_content = main_file.read_text()
        main_prompt = PromptInfo(
            name=main_name.replace("_", " ").title(),
            filename=main_file.name,
            content=main_content,
            variables=_extract_variables(main_content),
            description=_extract_description(main_content),
        )

        confirmation_prompt = None
        if confirmation_name:
            confirmation_file = prompts_dir / f"{confirmation_name}.md"
            if confirmation_file.exists():
                conf_content = confirmation_file.read_text()
                confirmation_prompt = PromptInfo(
                    name=confirmation_name.replace("_", " ").title(),
                    filename=confirmation_file.name,
                    content=conf_content,
                    variables=_extract_variables(conf_content),
                    description=_extract_description(conf_content),
                )

        groups.append(
            PromptGroup(
                name=main_name.replace("_", " ").title(),
                main=main_prompt,
                confirmation=confirmation_prompt,
            )
        )

    # Add the generic confirmation prompt as a standalone group
    generic_conf = prompts_dir / "confirmation.md"
    if generic_conf.exists():
        conf_content = generic_conf.read_text()
        groups.append(
            PromptGroup(
                name="Generic Confirmation",
                main=PromptInfo(
                    name="Confirmation",
                    filename="confirmation.md",
                    content=conf_content,
                    variables=_extract_variables(conf_content),
                    description=_extract_description(conf_content),
                ),
                confirmation=None,
            )
        )

    return groups


@router.get("/preview-data", response_model=PreviewData)
async def get_preview_data():
    """Get real data from Paperless for prompt preview."""
    settings = get_settings()

    paperless = PaperlessClient(
        settings.paperless_url,
        settings.paperless_token,
    )

    # Fetch each type of data independently so failures don't cascade

    # Correspondents
    correspondents_list = "No correspondents yet."
    try:
        correspondents = await paperless.get_correspondents()
        if correspondents:
            correspondents_list = "\n".join(f"- {c['name']}" for c in correspondents[:20])
    except Exception:
        correspondents_list = "[Could not fetch correspondents]"

    # Document Types
    types_list = "No document types yet."
    try:
        document_types = await paperless.get_document_types()
        if document_types:
            types_list = "\n".join(f"- {dt['name']}" for dt in document_types[:20])
    except Exception:
        types_list = "[Could not fetch document types]"

    # Tags
    tags_list = "No tags yet."
    try:
        tags = await paperless.get_tags()
        if tags:
            tags_list = "\n".join(
                f"- {t['name']}" for t in sorted(tags, key=lambda x: x["name"])[:30]
            )
    except Exception:
        tags_list = "[Could not fetch tags]"

    # Sample document content (optional - OK if this fails)
    sample_content = ""
    try:
        documents = await paperless.get_documents(limit=1)
        if documents:
            doc = documents[0]
            content_result = await paperless.get_document_content(doc["id"])
            sample_content = content_result[:3000] if content_result else ""
    except Exception:
        pass

    # Document content placeholder
    doc_content_display = (
        sample_content
        if sample_content
        else (
            "[Document content will appear here during processing]\n\n"
            "This is where the first 3000 characters of the OCR'd document\n"
            "content will be inserted when the agent processes a document."
        )
    )

    doc_excerpt_display = (
        sample_content[:1500]
        if sample_content
        else (
            "[Document excerpt will appear here during processing]\n\n"
            "This is where the first 1500 characters of the document\n"
            "will be shown for confirmation review."
        )
    )

    # Similar docs placeholder (would need Qdrant + actual document for real similar docs)
    similar_docs = (
        "[Similar documents will appear here during processing]\n\n"
        "During actual processing, this will show documents with\n"
        "similar content found via vector search."
    )
    similar_titles = (
        "[Similar titles will appear here during processing]\n\n"
        "During actual processing, this will show titles from\n"
        "similar documents found via vector search."
    )

    # Sample analysis result for confirmation preview
    analysis_result = (
        "**Suggested:** [Analysis result will appear here]\n"
        "**Reasoning:** The primary LLM's analysis and reasoning\n"
        "**Confidence:** 0.85"
    )

    return PreviewData(
        document_content=doc_content_display,
        existing_correspondents=correspondents_list,
        existing_types=types_list,
        existing_tags=tags_list,
        similar_docs=similar_docs,
        similar_titles=similar_titles,
        feedback="None",
        analysis_result=analysis_result,
        document_excerpt=doc_excerpt_display,
    )


@router.get("/{prompt_name}", response_model=PromptInfo)
async def get_prompt(
    prompt_name: str, lang: str | None = Query(None, description="Language code (e.g., 'en', 'de')")
):
    """Get a specific prompt by name for a specific language."""
    prompts_dir = _get_prompts_dir(lang)
    prompt_file = prompts_dir / f"{prompt_name}.md"

    if not prompt_file.exists():
        raise HTTPException(status_code=404, detail=f"Prompt '{prompt_name}' not found")

    content = prompt_file.read_text()
    variables = _extract_variables(content)
    description = _extract_description(content)

    return PromptInfo(
        name=prompt_name.replace("_", " ").title(),
        filename=prompt_file.name,
        content=content,
        variables=variables,
        description=description,
    )


@router.put("/{prompt_name}", response_model=PromptInfo)
async def update_prompt(
    prompt_name: str,
    update: PromptUpdate,
    lang: str | None = Query(None, description="Language code (e.g., 'en', 'de')"),
):
    """Update a prompt's content for a specific language."""
    prompts_dir = _get_prompts_dir(lang)
    prompt_file = prompts_dir / f"{prompt_name}.md"

    if not prompt_file.exists():
        raise HTTPException(status_code=404, detail=f"Prompt '{prompt_name}' not found")

    # Write the new content
    prompt_file.write_text(update.content)

    # Return the updated prompt info
    variables = _extract_variables(update.content)
    description = _extract_description(update.content)

    return PromptInfo(
        name=prompt_name.replace("_", " ").title(),
        filename=prompt_file.name,
        content=update.content,
        variables=variables,
        description=description,
    )


def _extract_variables(content: str) -> list[str]:
    """Extract template variables from prompt content."""
    # Match {variable_name} patterns
    variables = re.findall(r"\{(\w+)\}", content)
    return sorted(set(variables))


def _extract_description(content: str) -> str | None:
    """Extract description from first line if it starts with #."""
    lines = content.strip().split("\n")
    if lines and lines[0].startswith("# "):
        return lines[0][2:].strip()
    return None
