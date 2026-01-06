"""Tags Agent for assigning document tags."""

from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from agents.prompts import load_prompt
from config import get_settings
from models.analysis import ConfirmationResult, TagsAnalysis
from services.database import get_database_service
from services.paperless import PaperlessClient
from services.pending_reviews import get_pending_reviews_service
from services.qdrant import QdrantService


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
        # Qdrant is optional - only used for similar document context
        self.qdrant: QdrantService | None = None
        if self.settings.vector_search_enabled:
            self.qdrant = QdrantService(
                qdrant_url=self.settings.qdrant_url,
                collection_name=self.settings.qdrant_collection,
                ollama_url=self.settings.ollama_url,
                embedding_model=self.settings.ollama_embedding_model,
            )

    async def process(
        self,
        doc_id: int,
        content: str,
        document_type: str | None = None,
        current_tag_ids: list[int] | None = None,
    ) -> dict[str, Any]:
        """Process document to suggest tags.

        Args:
            doc_id: Document ID
            content: OCR content
            document_type: Name of the assigned document type (to prevent suggesting it as tag)
            current_tag_ids: IDs of tags already on the document

        Returns:
            Result dict with tag suggestions
        """
        # Get existing tags from Paperless
        existing_tags = await self.paperless.get_tags()
        tag_names = [t["name"] for t in existing_tags]
        tag_id_to_name = {t["id"]: t["name"] for t in existing_tags}

        # Build current tag names from IDs
        current_tag_names: list[str] = []
        if current_tag_ids:
            current_tag_names = [
                tag_id_to_name[tid] for tid in current_tag_ids if tid in tag_id_to_name
            ]

        # Get document types list (to prevent suggesting as tags)
        document_types = await self.paperless.get_document_types()
        document_type_names = [dt["name"] for dt in document_types]

        # Get tag metadata from database
        db = get_database_service()
        tag_metadata = db.get_all_tag_metadata()
        tag_descriptions = {
            tm.tag_name: tm.description
            for tm in tag_metadata
            if tm.description and not tm.exclude_from_ai
        }
        excluded_tags = [tm.tag_name for tm in tag_metadata if tm.exclude_from_ai]

        # Get similar documents (optional)
        similar_docs: list[dict] = []
        if self.qdrant:
            try:
                await self.qdrant.initialize()
                similar_docs = await self.qdrant.search_similar(content[:2000], k=5)
            except Exception:
                # Continue without similar docs - not critical
                pass

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Analyze tags with full context
            analysis = await self._analyze_tags(
                content,
                tag_names,
                similar_docs,
                feedback,
                document_type=document_type,
                current_tag_names=current_tag_names,
                document_type_names=document_type_names,
                tag_descriptions=tag_descriptions,
                excluded_tags=excluded_tags,
            )

            # Confirm
            confirmation = await self._confirm_tags(content, analysis)

            if confirmation.confirmed:
                result = await self._apply_tags(
                    doc_id, analysis, existing_tags, current_tag_ids or []
                )
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "tags": [t.name for t in analysis.suggested_tags],
                    "new_tags": [t.name for t in analysis.suggested_tags if t.is_new],
                    "tags_removed": [t.tag_name for t in analysis.tags_to_remove],
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
            "tags_to_remove": [t.model_dump() for t in analysis.tags_to_remove],
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
        document_type: str | None = None,
        current_tag_names: list[str] | None = None,
        document_type_names: list[str] | None = None,
        tag_descriptions: dict[str, str] | None = None,
        excluded_tags: list[str] | None = None,
    ) -> TagsAnalysis:
        """Analyze document to suggest tags."""
        prompt_template = load_prompt("tags") or self._default_prompt()

        # Format existing tags (exclude AI-excluded tags and filter out workflow tags)
        workflow_tag_prefixes = ("llm-", "LLM-")
        filtered_tags = [
            t
            for t in existing_tags
            if not t.startswith(workflow_tag_prefixes) and t not in (excluded_tags or [])
        ]
        tags_list = ", ".join(sorted(filtered_tags))

        # Similar documents with their tags
        similar_info = []
        for doc in similar_docs[:5]:
            doc_tags = doc["metadata"].get("tags", [])
            if isinstance(doc_tags, list):
                tags_str = ", ".join(doc_tags)
            else:
                tags_str = str(doc_tags)
            similar_info.append(f"- {doc['metadata'].get('title', 'Unknown')}: [{tags_str}]")

        # Format tag descriptions
        tag_desc_lines = []
        if tag_descriptions:
            for tag_name, desc in sorted(tag_descriptions.items()):
                tag_desc_lines.append(f"- **{tag_name}**: {desc}")

        # Format current tags on document
        current_tags_str = ", ".join(current_tag_names) if current_tag_names else "None"

        # Format document type names to exclude
        doc_type_names_str = ", ".join(document_type_names) if document_type_names else "None"

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            existing_tags=tags_list or "No tags yet.",
            similar_docs=chr(10).join(similar_info)
            if similar_info
            else "No similar documents found.",
            feedback=feedback or "None",
            document_type=document_type or "Not yet assigned",
            current_tags=current_tags_str,
            tag_descriptions=chr(10).join(tag_desc_lines)
            if tag_desc_lines
            else "No additional tag descriptions available.",
            document_type_names=doc_type_names_str,
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
        current_tag_ids: list[int],
    ) -> dict[str, Any]:
        """Apply tags to document (add new tags, remove suggested removals)."""
        applied_tags = []
        removed_tags = []
        new_tags_queued = []

        # Get current document for title
        doc = await self.paperless.get_document(doc_id)
        doc_title = doc.get("title", f"Document {doc_id}") if doc else f"Document {doc_id}"

        # Work with a copy of current tags
        updated_tag_ids = list(current_tag_ids)

        # Build tag mappings
        tag_name_to_id = {t["name"].lower(): t["id"] for t in existing_tags}

        # Get pending reviews service for new tags
        pending_service = get_pending_reviews_service()

        # Handle tag removals first
        for tag_removal in analysis.tags_to_remove:
            tag_id = tag_name_to_id.get(tag_removal.tag_name.lower())
            # Don't remove workflow tags
            if (
                tag_id
                and tag_id in updated_tag_ids
                and not tag_removal.tag_name.startswith(("llm-", "LLM-"))
            ):
                updated_tag_ids.remove(tag_id)
                removed_tags.append(tag_removal.tag_name)

        # Add new tags
        for tag_suggestion in analysis.suggested_tags:
            if tag_suggestion.is_new:
                # Queue new tags for user confirmation
                new_tags_queued.append(tag_suggestion.name)

                # Store in pending reviews
                pending_service.add(
                    doc_id=doc_id,
                    doc_title=doc_title,
                    item_type="tag",
                    suggestion=tag_suggestion.name,
                    reasoning=tag_suggestion.relevance or analysis.reasoning,
                    alternatives=[],  # Tags don't have alternatives
                    metadata={"confidence": analysis.confidence},
                )
            else:
                # Find and apply existing tag
                tag_id = tag_name_to_id.get(tag_suggestion.name.lower())
                if tag_id and tag_id not in updated_tag_ids:
                    updated_tag_ids.append(tag_id)
                    applied_tags.append(tag_suggestion.name)

        # Update document tags if there were changes
        if applied_tags or removed_tags:
            await self.paperless.update_document(doc_id, tags=updated_tag_ids)

        # Update workflow tags (Tags comes after Title in the pipeline)
        await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_title_done)
        await self.paperless.add_tag_to_document(doc_id, self.settings.tag_tags_done)

        return {
            "applied_tags": applied_tags,
            "removed_tags": removed_tags,
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
