"""Tags Agent for assigning document tags."""

from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from config import get_settings
from models.analysis import ConfirmationResult, TagsAnalysis
from services.paperless import PaperlessClient
from services.qdrant import QdrantService

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str) -> str:
    """Load a prompt template from file."""
    prompt_file = PROMPTS_DIR / f"{name}.md"
    if prompt_file.exists():
        return prompt_file.read_text()
    return ""


class TagsAgent:
    """Agent for suggesting and assigning document tags."""

    def __init__(self):
        self.settings = get_settings()
        self.large_model = get_large_model()
        self.small_model = get_small_model()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.qdrant = QdrantService(
            qdrant_url=self.settings.qdrant_url,
            collection_name=self.settings.qdrant_collection,
            ollama_url=self.settings.ollama_url,
        )

    async def process(self, doc_id: int, content: str) -> dict[str, Any]:
        """Process document to suggest tags.

        Args:
            doc_id: Document ID
            content: OCR content

        Returns:
            Result dict with tag suggestions
        """
        # Get existing tags
        existing_tags = await self.paperless.get_tags()
        tag_names = [t["name"] for t in existing_tags]

        # Get similar documents
        await self.qdrant.initialize()
        similar_docs = await self.qdrant.search_similar(content[:2000], k=5)

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Analyze tags
            analysis = await self._analyze_tags(
                content,
                tag_names,
                similar_docs,
                feedback,
            )

            # Confirm
            confirmation = await self._confirm_tags(content, analysis)

            if confirmation.confirmed:
                result = await self._apply_tags(doc_id, analysis, existing_tags)
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "tags": [t.name for t in analysis.suggested_tags],
                    "new_tags": [t.name for t in analysis.suggested_tags if t.is_new],
                    "reasoning": analysis.reasoning,
                    "attempts": attempt + 1,
                    **result,
                }

            feedback = confirmation.feedback

        # Needs review
        return {
            "doc_id": doc_id,
            "success": False,
            "needs_review": True,
            "suggested_tags": [t.model_dump() for t in analysis.suggested_tags],
            "reasoning": analysis.reasoning,
            "last_feedback": feedback,
            "attempts": max_retries,
        }

    async def _analyze_tags(
        self,
        content: str,
        existing_tags: list[str],
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> TagsAnalysis:
        """Analyze document to suggest tags."""
        prompt_template = load_prompt("tags") or self._default_prompt()

        # Format existing tags (categorized if possible)
        tags_list = "\n".join(f"- {name}" for name in sorted(existing_tags)[:100])

        # Similar documents with their tags
        similar_info = []
        for doc in similar_docs[:5]:
            doc_tags = doc["metadata"].get("tags", [])
            if isinstance(doc_tags, list):
                tags_str = ", ".join(doc_tags)
            else:
                tags_str = str(doc_tags)
            similar_info.append(f"- {doc['metadata'].get('title', 'Unknown')}: [{tags_str}]")

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            existing_tags=tags_list or "No tags yet.",
            similar_docs=chr(10).join(similar_info)
            if similar_info
            else "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.large_model.with_structured_output(TagsAnalysis)
        return await structured_model.ainvoke(messages)

    async def _confirm_tags(
        self,
        content: str,
        analysis: TagsAnalysis,
    ) -> ConfirmationResult:
        """Confirm tags with smaller model."""
        confirmation_prompt = (
            load_prompt("tags_confirmation")
            or load_prompt("confirmation")
            or self._default_confirmation_prompt()
        )

        tag_summary = "\n".join(
            f"- {t.name} ({'NEW' if t.is_new else 'existing'}): {t.relevance}"
            for t in analysis.suggested_tags
        )

        # Format analysis result
        analysis_result = f"""**Suggested Tags:**
{tag_summary}

**Overall Reasoning:** {analysis.reasoning}
**Confidence:** {analysis.confidence}"""

        # Format the prompt with variables
        formatted_prompt = confirmation_prompt.format(
            analysis_result=analysis_result,
            document_excerpt=content[:1500],
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.small_model.with_structured_output(ConfirmationResult)
        return await structured_model.ainvoke(messages)

    async def _apply_tags(
        self,
        doc_id: int,
        analysis: TagsAnalysis,
        existing_tags: list[dict],
    ) -> dict[str, Any]:
        """Apply tags to document."""
        applied_tags = []
        new_tags_queued = []

        # Get current document tags
        doc = await self.paperless.get_document(doc_id)
        current_tag_ids = doc.get("tags", []) if doc else []

        # Build tag ID to name mapping
        tag_name_to_id = {t["name"].lower(): t["id"] for t in existing_tags}

        for tag_suggestion in analysis.suggested_tags:
            if tag_suggestion.is_new:
                # Queue new tags for user confirmation
                new_tags_queued.append(tag_suggestion.name)
            else:
                # Find and apply existing tag
                tag_id = tag_name_to_id.get(tag_suggestion.name.lower())
                if tag_id and tag_id not in current_tag_ids:
                    current_tag_ids.append(tag_id)
                    applied_tags.append(tag_suggestion.name)

        # Update document tags (preserving system tags)
        if applied_tags:
            await self.paperless.update_document(doc_id, tags=current_tag_ids)

        # Update workflow tags (Tags comes after Title in the pipeline)
        await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_title_done)
        await self.paperless.add_tag_to_document(doc_id, self.settings.tag_tags_done)

        return {
            "applied_tags": applied_tags,
            "new_tags_queued": new_tags_queued,
            "needs_tag_confirmation": len(new_tags_queued) > 0,
        }

    def _default_prompt(self) -> str:
        return """You are a document tagging specialist. Your task is to suggest relevant tags for documents.

Guidelines:
- Use existing tags when they apply (prefer consistency)
- Only suggest new tags when necessary for categorization
- Consider document type, content, and context
- Use 2-5 tags typically (be selective, not exhaustive)
- Follow the tagging patterns from similar documents

Output a structured analysis with your tag suggestions."""

    def _default_confirmation_prompt(self) -> str:
        return """You are a quality assurance assistant. Review the tag suggestions.

Consider:
- Are the tags relevant to the document content?
- Are they consistent with similar documents?
- Is the number of tags appropriate (not too many, not too few)?

Accept if the tags are reasonable. Reject only if there are clear issues."""
