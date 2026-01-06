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

    async def process(self, doc_id: int, content: str) -> dict[str, Any]:
        """Process document to analyze schema and suggest new entities.

        Args:
            doc_id: Document ID
            content: OCR content

        Returns:
            Result dict with:
                - doc_id: The document ID
                - has_suggestions: Whether any suggestions were made
                - suggestions: List of SchemaSuggestion dicts
                - reasoning: Overall reasoning for the analysis
        """
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
    ) -> SchemaAnalysisResult:
        """Analyze document to suggest new schema entities.

        Args:
            content: Document content
            correspondent_names: List of existing correspondent names
            doc_type_names: List of existing document type names
            tag_names: List of existing tag names
            similar_docs: List of similar documents with metadata

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

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:4000],
            existing_correspondents=correspondents_list,
            existing_document_types=doc_types_list,
            existing_tags=tags_list,
            similar_docs=similar_info,
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

## Similar Documents
{similar_docs}

## Document Content
{document_content}

## Your Task

Analyze the document and suggest NEW entities (correspondents, document types, or tags) that:
1. Do NOT already exist in the system (check the lists above carefully)
2. Would be genuinely useful for organizing this and similar documents
3. Are specific enough to be meaningful but general enough to apply to multiple documents

**Guidelines:**
- Only suggest entities that are clearly missing
- Prefer matching to existing entities when possible
- For correspondents: Look for sender information, letterheads, signatures
- For document types: Consider the document's purpose and format
- For tags: Consider topics, categories, or attributes that would help with retrieval

If the existing entities are sufficient for this document, respond with no suggestions and explain why.

Output a structured analysis with your suggestions."""
