"""Translation Service using Ollama for AI-powered translations."""

from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage
from langchain_ollama import ChatOllama

from config import get_settings
from services.database import get_database_service


class TranslationService:
    """Service for translating text using Ollama models."""

    def __init__(self):
        self.settings = get_settings()
        self.db = get_database_service()

        # Use translation model if set, otherwise fall back to large model
        model_name = (
            self.settings.ollama_model_translation
            if self.settings.ollama_model_translation
            else self.settings.ollama_model_large
        )

        self.model = ChatOllama(
            base_url=self.settings.ollama_url,
            model=model_name,
            temperature=0.3,  # Lower temperature for more consistent translations
        )

    async def translate_text(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        content_type: str = "general",
        content_key: str = "",
        use_cache: bool = True,
    ) -> dict[str, Any]:
        """Translate text from source language to target language.

        Args:
            text: Text to translate
            source_lang: Source language code (e.g., "en", "de")
            target_lang: Target language code
            content_type: Type of content (prompt, ui, tag_description)
            content_key: Unique key for caching
            use_cache: Whether to use cached translations

        Returns:
            Dict with translated_text and metadata
        """
        if source_lang == target_lang:
            return {"translated_text": text, "cached": False, "model": None}

        # Check cache if key is provided
        if use_cache and content_key:
            cached = self.db.get_translation(source_lang, target_lang, content_type, content_key)
            if cached:
                return {
                    "translated_text": cached.translated_text,
                    "cached": True,
                    "model": cached.model_used,
                }

        # Build translation prompt
        lang_names = {
            "en": "English",
            "de": "German",
            "fr": "French",
            "es": "Spanish",
            "it": "Italian",
            "pt": "Portuguese",
            "nl": "Dutch",
            "pl": "Polish",
            "ru": "Russian",
            "ja": "Japanese",
            "zh": "Chinese",
            "ko": "Korean",
        }

        source_name = lang_names.get(source_lang, source_lang)
        target_name = lang_names.get(target_lang, target_lang)

        prompt = f"""Translate the following text from {source_name} to {target_name}.

Rules:
- Maintain the original formatting (markdown, line breaks, etc.)
- Keep technical terms, variable placeholders like {{variable}}, and code blocks unchanged
- Preserve the original tone and style
- Only output the translation, no explanations

Text to translate:
{text}

Translation:"""

        messages = [HumanMessage(content=prompt)]
        response = await self.model.ainvoke(messages)
        translated_text = response.content.strip()

        # Get model name for tracking
        model_used = (
            self.settings.ollama_model_translation
            if self.settings.ollama_model_translation
            else self.settings.ollama_model_large
        )

        # Cache the translation if key is provided
        if content_key:
            self.db.upsert_translation(
                source_lang=source_lang,
                target_lang=target_lang,
                content_type=content_type,
                content_key=content_key,
                source_text=text,
                translated_text=translated_text,
                model_used=model_used,
            )

        return {
            "translated_text": translated_text,
            "cached": False,
            "model": model_used,
        }

    async def translate_prompt_file(
        self,
        prompt_name: str,
        source_lang: str,
        target_lang: str,
    ) -> dict[str, Any]:
        """Translate a prompt template file.

        Args:
            prompt_name: Name of the prompt (e.g., "tags", "title")
            source_lang: Source language code
            target_lang: Target language code

        Returns:
            Dict with translation status
        """
        prompts_dir = Path(__file__).parent.parent / "prompts"
        source_file = prompts_dir / source_lang / f"{prompt_name}.md"
        target_dir = prompts_dir / target_lang
        target_file = target_dir / f"{prompt_name}.md"

        if not source_file.exists():
            return {
                "success": False,
                "error": f"Source prompt not found: {source_file}",
            }

        # Read source content
        source_content = source_file.read_text(encoding="utf-8")

        # Translate
        result = await self.translate_text(
            text=source_content,
            source_lang=source_lang,
            target_lang=target_lang,
            content_type="prompt",
            content_key=prompt_name,
            use_cache=True,
        )

        # Ensure target directory exists
        target_dir.mkdir(parents=True, exist_ok=True)

        # Write translated content
        target_file.write_text(result["translated_text"], encoding="utf-8")

        return {
            "success": True,
            "prompt_name": prompt_name,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "cached": result["cached"],
            "model": result["model"],
        }

    async def translate_all_prompts(
        self,
        source_lang: str,
        target_lang: str,
    ) -> dict[str, Any]:
        """Translate all prompt files from source to target language.

        Args:
            source_lang: Source language code
            target_lang: Target language code

        Returns:
            Dict with translation results for all prompts
        """
        prompts_dir = Path(__file__).parent.parent / "prompts"
        source_dir = prompts_dir / source_lang

        if not source_dir.exists():
            return {
                "success": False,
                "error": f"Source language directory not found: {source_dir}",
            }

        # Find all prompt files
        prompt_files = list(source_dir.glob("*.md"))
        results = []

        for prompt_file in prompt_files:
            prompt_name = prompt_file.stem
            result = await self.translate_prompt_file(prompt_name, source_lang, target_lang)
            results.append(result)

        success_count = sum(1 for r in results if r.get("success"))
        return {
            "success": True,
            "total": len(results),
            "successful": success_count,
            "failed": len(results) - success_count,
            "results": results,
        }

    def get_cached_translations(
        self,
        target_lang: str,
        content_type: str | None = None,
    ) -> list[dict]:
        """Get all cached translations for a target language.

        Args:
            target_lang: Target language code
            content_type: Optional filter by content type

        Returns:
            List of cached translations
        """
        translations = self.db.get_translations_by_lang(target_lang, content_type)
        return [
            {
                "source_lang": t.source_lang,
                "target_lang": t.target_lang,
                "content_type": t.content_type,
                "content_key": t.content_key,
                "source_text": t.source_text[:100] + "..."
                if len(t.source_text) > 100
                else t.source_text,
                "translated_text": t.translated_text[:100] + "..."
                if len(t.translated_text) > 100
                else t.translated_text,
                "model_used": t.model_used,
                "created_at": t.created_at,
            }
            for t in translations
        ]

    def clear_translation_cache(
        self,
        target_lang: str | None = None,
        content_type: str | None = None,
    ) -> dict[str, Any]:
        """Clear cached translations.

        Args:
            target_lang: Optional language filter
            content_type: Optional content type filter

        Returns:
            Dict with status
        """
        self.db.clear_translations(target_lang, content_type)
        return {
            "success": True,
            "cleared_lang": target_lang,
            "cleared_type": content_type,
        }


# Singleton instance
_translation_service: TranslationService | None = None


def get_translation_service() -> TranslationService:
    """Get the singleton translation service instance."""
    global _translation_service
    if _translation_service is None:
        _translation_service = TranslationService()
    return _translation_service
