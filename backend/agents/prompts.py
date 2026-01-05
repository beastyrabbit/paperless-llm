"""Shared prompt loading utilities for agents with language support."""

from pathlib import Path

from config import get_settings

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"
DEFAULT_LANGUAGE = "en"


def get_available_languages() -> list[str]:
    """Scan prompts directory for available language folders.

    Returns:
        List of available language codes (e.g., ['en', 'de'])
    """
    languages = []
    if PROMPTS_DIR.exists():
        for path in PROMPTS_DIR.iterdir():
            if path.is_dir() and not path.name.startswith((".", "_")):
                languages.append(path.name)
    return sorted(languages) if languages else [DEFAULT_LANGUAGE]


def load_prompt(name: str, lang: str | None = None) -> str:
    """Load a prompt template with language support and fallback.

    Args:
        name: Prompt name (e.g., 'title', 'correspondent_confirmation')
        lang: Language code (e.g., 'en', 'de'). If None, uses settings.

    Returns:
        Prompt content as string, or empty string if not found.

    Fallback chain:
        1. prompts/{lang}/{name}.md
        2. prompts/{DEFAULT_LANGUAGE}/{name}.md
        3. prompts/{name}.md (legacy flat structure)
        4. Empty string
    """
    settings = get_settings()
    lang = lang or settings.prompt_language or DEFAULT_LANGUAGE

    # Try requested language
    prompt_file = PROMPTS_DIR / lang / f"{name}.md"
    if prompt_file.exists():
        return prompt_file.read_text()

    # Fall back to default language (English)
    if lang != DEFAULT_LANGUAGE:
        fallback_file = PROMPTS_DIR / DEFAULT_LANGUAGE / f"{name}.md"
        if fallback_file.exists():
            return fallback_file.read_text()

    # Legacy fallback: flat structure (for backwards compatibility)
    legacy_file = PROMPTS_DIR / f"{name}.md"
    if legacy_file.exists():
        return legacy_file.read_text()

    return ""


def get_prompt_path(name: str, lang: str | None = None) -> Path | None:
    """Get the path to a prompt file with language support.

    Args:
        name: Prompt name (e.g., 'title')
        lang: Language code. If None, uses settings.

    Returns:
        Path to the prompt file, or None if not found.
    """
    settings = get_settings()
    lang = lang or settings.prompt_language or DEFAULT_LANGUAGE

    # Try requested language
    prompt_file = PROMPTS_DIR / lang / f"{name}.md"
    if prompt_file.exists():
        return prompt_file

    # Fall back to default language
    if lang != DEFAULT_LANGUAGE:
        fallback_file = PROMPTS_DIR / DEFAULT_LANGUAGE / f"{name}.md"
        if fallback_file.exists():
            return fallback_file

    # Legacy fallback
    legacy_file = PROMPTS_DIR / f"{name}.md"
    if legacy_file.exists():
        return legacy_file

    return None
