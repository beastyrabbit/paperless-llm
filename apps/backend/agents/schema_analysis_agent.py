"""Schema Analysis Agent for suggesting new entities.

This agent analyzes documents and suggests new correspondents, document types,
or tags that could be added to improve the schema.
"""

from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model
from agents.prompts import load_prompt
from config import get_settings
from models.schema_analysis import SchemaAnalysisResult, SchemaSuggestion
from services.database import get_database_service
from services.paperless import PaperlessClient
from services.qdrant import QdrantService


class SchemaAnalysisAgent:
    """Agent for analyzing documents and suggesting new schema entities."""

    def __init__(self):
        self.settings = get_settings()
        self.large_model = get_large_model()
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
        self.db = get_database_service()

    async def process(
        self,
        doc_id: int,
        content: str,
        pending_suggestions: dict[str, list[str]] | None = None,
    ) -> dict[str, Any]:
        """Process document to analyze schema and suggest new entities.

        Args:
            doc_id: Document ID
            content: OCR content
            pending_suggestions: Already suggested items during bootstrap, grouped by type:
                {"correspondent": ["Amazon", ...], "document_type": [...], "tag": [...]}
                The agent will avoid suggesting duplicates of these.

        Returns:
            Result dict with:
                - doc_id: The document ID
                - has_suggestions: Whether any suggestions were made
                - suggestions: List of SchemaSuggestion dicts
                - reasoning: Overall reasoning for the analysis
        """
        if pending_suggestions is None:
            pending_suggestions = {"correspondent": [], "document_type": [], "tag": []}
        # Get existing entities from Paperless
        existing_correspondents = await self.paperless.get_correspondents()
        existing_doc_types = await self.paperless.get_document_types()
        existing_tags = await self.paperless.get_tags()

        correspondent_names = [c["name"] for c in existing_correspondents]
        doc_type_names = [dt["name"] for dt in existing_doc_types]
        tag_names = [t["name"] for t in existing_tags]

        # Get blocked suggestions from database
        blocked_correspondents = self._get_blocked_names("correspondent")
        blocked_doc_types = self._get_blocked_names("document_type")
        blocked_tags = self._get_blocked_names("tag")
        blocked_global = self._get_blocked_names("global")

        # Get similar documents for context (optional)
        similar_docs: list[dict] = []
        if self.qdrant:
            try:
                await self.qdrant.initialize()
                similar_docs = await self.qdrant.search_similar(content[:2000], k=5)
            except Exception:
                # Continue without similar docs - not critical
                pass

        # Analyze with LLM
        analysis = await self._analyze_schema(
            content=content,
            correspondent_names=correspondent_names,
            doc_type_names=doc_type_names,
            tag_names=tag_names,
            similar_docs=similar_docs,
            blocked_correspondents=blocked_correspondents,
            blocked_doc_types=blocked_doc_types,
            blocked_tags=blocked_tags,
            blocked_global=blocked_global,
            pending_suggestions=pending_suggestions,
        )

        # Filter out blocked suggestions
        filtered_suggestions = self._filter_blocked_suggestions(
            suggestions=analysis.suggestions,
            blocked_correspondents=blocked_correspondents,
            blocked_doc_types=blocked_doc_types,
            blocked_tags=blocked_tags,
            blocked_global=blocked_global,
        )

        return {
            "doc_id": doc_id,
            "has_suggestions": len(filtered_suggestions) > 0,
            "suggestions": [s.model_dump() for s in filtered_suggestions],
            "matches_pending": [m.model_dump() for m in analysis.matches_pending],
            "reasoning": analysis.reasoning,
            "no_suggestions_reason": analysis.no_suggestions_reason,
        }

    def _get_blocked_names(self, block_type: str) -> set[str]:
        """Get normalized names of blocked suggestions for a given type.

        Args:
            block_type: Type of block ('correspondent', 'document_type', 'tag', 'global')

        Returns:
            Set of normalized (lowercase) blocked names
        """
        blocked = self.db.get_blocked_suggestions(block_type=block_type)
        return {b.normalized_name for b in blocked}

    def _filter_blocked_suggestions(
        self,
        suggestions: list[SchemaSuggestion],
        blocked_correspondents: set[str],
        blocked_doc_types: set[str],
        blocked_tags: set[str],
        blocked_global: set[str],
    ) -> list[SchemaSuggestion]:
        """Filter out suggestions that are blocked.

        Args:
            suggestions: List of suggestions from LLM
            blocked_correspondents: Set of blocked correspondent names (normalized)
            blocked_doc_types: Set of blocked document type names (normalized)
            blocked_tags: Set of blocked tag names (normalized)
            blocked_global: Set of globally blocked names (normalized)

        Returns:
            Filtered list of suggestions
        """
        filtered = []
        for suggestion in suggestions:
            normalized_name = suggestion.suggested_name.strip().lower()

            # Check global blocklist first
            if normalized_name in blocked_global:
                continue

            # Check type-specific blocklist
            if (
                suggestion.entity_type == "correspondent"
                and normalized_name in blocked_correspondents
            ):
                continue
            if suggestion.entity_type == "document_type" and normalized_name in blocked_doc_types:
                continue
            if suggestion.entity_type == "tag" and normalized_name in blocked_tags:
                continue

            filtered.append(suggestion)

        return filtered

    async def _analyze_schema(
        self,
        content: str,
        correspondent_names: list[str],
        doc_type_names: list[str],
        tag_names: list[str],
        similar_docs: list[dict],
        blocked_correspondents: set[str],
        blocked_doc_types: set[str],
        blocked_tags: set[str],
        blocked_global: set[str],
        pending_suggestions: dict[str, list[str]],
    ) -> SchemaAnalysisResult:
        """Analyze document to suggest new schema entities.

        Args:
            content: Document content
            correspondent_names: List of existing correspondent names
            doc_type_names: List of existing document type names
            tag_names: List of existing tag names
            similar_docs: List of similar documents with metadata
            blocked_correspondents: Set of blocked correspondent names
            blocked_doc_types: Set of blocked document type names
            blocked_tags: Set of blocked tag names
            blocked_global: Set of globally blocked names
            pending_suggestions: Already suggested items (to avoid duplicates)

        Returns:
            SchemaAnalysisResult with suggestions
        """
        prompt_template = load_prompt("schema_analysis") or self._default_prompt()

        # Format existing entities
        correspondents_list = ", ".join(correspondent_names) if correspondent_names else "None yet"
        doc_types_list = ", ".join(doc_type_names) if doc_type_names else "None yet"
        tags_list = ", ".join(tag_names) if tag_names else "None yet"

        # Format similar docs with their metadata
        similar_info = (
            "\n".join(
                f"- {doc['metadata'].get('title', 'Unknown')} "
                f"(Correspondent: {doc['metadata'].get('correspondent', 'Unknown')}, "
                f"Type: {doc['metadata'].get('document_type', 'Unknown')}, "
                f"Tags: {', '.join(doc['metadata'].get('tags', [])) or 'None'})"
                for doc in similar_docs[:5]
            )
            if similar_docs
            else "No similar documents found."
        )

        # Format blocked lists for prompt
        blocked_correspondents_list = (
            ", ".join(sorted(blocked_correspondents)) if blocked_correspondents else "None"
        )
        blocked_doc_types_list = (
            ", ".join(sorted(blocked_doc_types)) if blocked_doc_types else "None"
        )
        blocked_tags_list = ", ".join(sorted(blocked_tags)) if blocked_tags else "None"
        blocked_global_list = ", ".join(sorted(blocked_global)) if blocked_global else "None"

        # Format pending suggestions (already suggested during bootstrap)
        pending_correspondents_list = (
            ", ".join(pending_suggestions.get("correspondent", []))
            if pending_suggestions.get("correspondent")
            else "None"
        )
        pending_doc_types_list = (
            ", ".join(pending_suggestions.get("document_type", []))
            if pending_suggestions.get("document_type")
            else "None"
        )
        pending_tags_list = (
            ", ".join(pending_suggestions.get("tag", []))
            if pending_suggestions.get("tag")
            else "None"
        )

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:4000],
            existing_correspondents=correspondents_list,
            existing_document_types=doc_types_list,
            existing_tags=tags_list,
            similar_docs=similar_info,
            blocked_correspondents=blocked_correspondents_list,
            blocked_document_types=blocked_doc_types_list,
            blocked_tags=blocked_tags_list,
            blocked_global=blocked_global_list,
            pending_correspondents=pending_correspondents_list,
            pending_document_types=pending_doc_types_list,
            pending_tags=pending_tags_list,
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.large_model.with_structured_output(SchemaAnalysisResult)
        return await structured_model.ainvoke(messages)

    def _default_prompt(self) -> str:
        """Default prompt if no prompt file is found."""
        return """You are a schema improvement specialist for a document management system.

Analyze the following document and determine if any NEW entities should be created to better organize documents like this one.

## Existing Entities

**Correspondents (senders/organizations):**
{existing_correspondents}

**Document Types:**
{existing_document_types}

**Tags:**
{existing_tags}

## Already Suggested (pending review - do NOT duplicate)

These have already been suggested during this analysis session. Do NOT suggest these again, even with slight variations:

**Pending Correspondents:** {pending_correspondents}
**Pending Document Types:** {pending_document_types}
**Pending Tags:** {pending_tags}

## Blocked Suggestions (NEVER suggest these)

**Globally Blocked:** {blocked_global}
**Blocked Correspondents:** {blocked_correspondents}
**Blocked Document Types:** {blocked_document_types}
**Blocked Tags:** {blocked_tags}

## Similar Documents
{similar_docs}

## Document Content
{document_content}

## Your Task

Analyze the document and suggest NEW entities (correspondents, document types, or tags) that:
1. Do NOT already exist in the system (check the lists above carefully)
2. Are NOT in the pending suggestions (already suggested for review)
3. Are NOT in the blocked lists (NEVER suggest blocked items)
4. Would be genuinely useful for organizing this and similar documents
5. Are specific enough to be meaningful but general enough to apply to multiple documents

**Important:** If you see a similar item in "Already Suggested", do NOT suggest a variation. For example:
- If "Amazon" is pending, do NOT suggest "Amazon.de" or "Amazon EU"
- If "Rechnung" is pending, do NOT suggest "Rechnungen" (plural)
- If "Invoice" is pending, do NOT suggest "Bill" or "Receipt" as duplicates

**Instead, report matches in matches_pending!**
If this document matches a pending item, report it in the matches_pending field so we can count occurrences:
- entity_type: the type of entity matched
- matched_name: the exact name from the pending list

**Guidelines:**
- Only suggest NEW entities that are clearly missing AND not already pending
- If document matches a pending item, report in matches_pending (don't create new suggestion)
- Prefer matching to existing or pending entities when possible
- For correspondents: Look for sender information, letterheads, signatures
- For document types: Consider the document's purpose and format
- For tags: Consider topics, categories, or attributes that would help with retrieval

If the existing or pending entities are sufficient for this document, respond with no suggestions. But still report any matches_pending.

Output a structured analysis with your suggestions and matches_pending."""
