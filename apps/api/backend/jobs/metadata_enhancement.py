"""Background job for suggesting metadata descriptions.

This job analyzes entities (tags, document types, correspondents) that lack
descriptions and suggests appropriate descriptions based on the documents
that use them.
"""

import logging
from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model
from agents.prompts import load_prompt
from config import get_settings
from services.paperless import PaperlessClient
from services.pending_reviews import get_pending_reviews_service

logger = logging.getLogger(__name__)


class MetadataEnhancementJob:
    """Analyzes entities and suggests descriptions.

    This job runs in the background and:
    1. Finds tags, document types, and correspondents without descriptions
    2. Analyzes documents using those entities
    3. Generates description suggestions using the LLM
    4. Queues suggestions for user review
    """

    # Minimum number of documents required to generate a meaningful description
    MIN_DOCUMENTS_FOR_ANALYSIS = 3
    # Maximum number of sample documents to include in the prompt
    MAX_SAMPLE_DOCUMENTS = 5

    def __init__(self) -> None:
        self.settings = get_settings()
        self.model = get_large_model()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.pending = get_pending_reviews_service()

    async def run(self) -> dict[str, Any]:
        """Run the metadata enhancement job.

        Returns:
            Dictionary with statistics about the job run.
        """
        results: dict[str, Any] = {
            "tags_analyzed": 0,
            "document_types_analyzed": 0,
            "correspondents_analyzed": 0,
            "suggestions_created": 0,
            "errors": [],
        }

        try:
            # 1. Analyze tags without match patterns (descriptions)
            tags = await self.paperless.get_tags()
            for tag in tags:
                # Skip system tags (workflow tags)
                if self._is_system_tag(tag.get("name", "")):
                    continue
                # Only process tags without a match pattern
                if not tag.get("match"):
                    try:
                        suggestion_created = await self._analyze_tag(tag)
                        results["tags_analyzed"] += 1
                        if suggestion_created:
                            results["suggestions_created"] += 1
                    except Exception as e:
                        error_msg = f"Error analyzing tag '{tag.get('name')}': {e}"
                        logger.error(error_msg)
                        results["errors"].append(error_msg)

            # 2. Analyze document types without match patterns
            doc_types = await self.paperless.get_document_types()
            for dt in doc_types:
                if not dt.get("match"):
                    try:
                        suggestion_created = await self._analyze_document_type(dt)
                        results["document_types_analyzed"] += 1
                        if suggestion_created:
                            results["suggestions_created"] += 1
                    except Exception as e:
                        error_msg = f"Error analyzing document type '{dt.get('name')}': {e}"
                        logger.error(error_msg)
                        results["errors"].append(error_msg)

            # 3. Analyze correspondents without match patterns
            correspondents = await self.paperless.get_correspondents()
            for corr in correspondents:
                if not corr.get("match"):
                    try:
                        suggestion_created = await self._analyze_correspondent(corr)
                        results["correspondents_analyzed"] += 1
                        if suggestion_created:
                            results["suggestions_created"] += 1
                    except Exception as e:
                        error_msg = f"Error analyzing correspondent '{corr.get('name')}': {e}"
                        logger.error(error_msg)
                        results["errors"].append(error_msg)

        except Exception as e:
            error_msg = f"Fatal error in metadata enhancement job: {e}"
            logger.exception(error_msg)
            results["errors"].append(error_msg)

        return results

    def _is_system_tag(self, tag_name: str) -> bool:
        """Check if a tag is a system/workflow tag that should be skipped."""
        system_tags = [
            self.settings.tag_pending,
            self.settings.tag_ocr_done,
            self.settings.tag_correspondent_done,
            self.settings.tag_document_type_done,
            self.settings.tag_title_done,
            self.settings.tag_tags_done,
            self.settings.tag_custom_fields_done,
            self.settings.tag_processed,
        ]
        return tag_name in system_tags

    async def _get_documents_by_tag(self, tag_id: int, limit: int = 10) -> list[dict[str, Any]]:
        """Get documents that have a specific tag by ID."""
        result = await self.paperless._request(
            "GET",
            "/documents/",
            params={"tags__id": tag_id, "page_size": limit},
        )
        return result.get("results", []) if result else []

    async def _get_documents_by_correspondent(
        self, correspondent_id: int, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Get documents with a specific correspondent."""
        result = await self.paperless._request(
            "GET",
            "/documents/",
            params={"correspondent__id": correspondent_id, "page_size": limit},
        )
        return result.get("results", []) if result else []

    async def _get_documents_by_document_type(
        self, doc_type_id: int, limit: int = 10
    ) -> list[dict[str, Any]]:
        """Get documents with a specific document type."""
        result = await self.paperless._request(
            "GET",
            "/documents/",
            params={"document_type__id": doc_type_id, "page_size": limit},
        )
        return result.get("results", []) if result else []

    async def _analyze_tag(self, tag: dict[str, Any]) -> bool:
        """Analyze a tag and suggest description.

        Args:
            tag: Tag data from Paperless API

        Returns:
            True if a suggestion was created, False otherwise.
        """
        tag_id = tag["id"]
        tag_name = tag["name"]

        # Get documents with this tag
        docs = await self._get_documents_by_tag(tag_id)
        doc_count = len(docs)

        if doc_count < self.MIN_DOCUMENTS_FOR_ANALYSIS:
            logger.debug(
                f"Skipping tag '{tag_name}': only {doc_count} documents "
                f"(minimum: {self.MIN_DOCUMENTS_FOR_ANALYSIS})"
            )
            return False

        # Generate description
        description = await self._generate_description(
            "tag", tag_name, docs[: self.MAX_SAMPLE_DOCUMENTS]
        )

        if not description:
            return False

        # Queue for user review
        self.pending.add(
            doc_id=0,  # No specific document
            doc_title=f"Tag: {tag_name}",
            item_type="metadata_description",
            suggestion=description,
            reasoning=f"Based on analysis of {doc_count} documents using this tag",
            alternatives=[],
            metadata={
                "entity_type": "tag",
                "entity_id": tag_id,
                "entity_name": tag_name,
                "document_count": doc_count,
            },
        )

        logger.info(f"Created description suggestion for tag '{tag_name}'")
        return True

    async def _analyze_document_type(self, doc_type: dict[str, Any]) -> bool:
        """Analyze a document type and suggest description.

        Args:
            doc_type: Document type data from Paperless API

        Returns:
            True if a suggestion was created, False otherwise.
        """
        doc_type_id = doc_type["id"]
        doc_type_name = doc_type["name"]

        # Get documents with this document type
        docs = await self._get_documents_by_document_type(doc_type_id)
        doc_count = len(docs)

        if doc_count < self.MIN_DOCUMENTS_FOR_ANALYSIS:
            logger.debug(
                f"Skipping document type '{doc_type_name}': only {doc_count} documents "
                f"(minimum: {self.MIN_DOCUMENTS_FOR_ANALYSIS})"
            )
            return False

        # Generate description
        description = await self._generate_description(
            "document_type", doc_type_name, docs[: self.MAX_SAMPLE_DOCUMENTS]
        )

        if not description:
            return False

        # Queue for user review
        self.pending.add(
            doc_id=0,
            doc_title=f"Document Type: {doc_type_name}",
            item_type="metadata_description",
            suggestion=description,
            reasoning=f"Based on analysis of {doc_count} documents with this type",
            alternatives=[],
            metadata={
                "entity_type": "document_type",
                "entity_id": doc_type_id,
                "entity_name": doc_type_name,
                "document_count": doc_count,
            },
        )

        logger.info(f"Created description suggestion for document type '{doc_type_name}'")
        return True

    async def _analyze_correspondent(self, correspondent: dict[str, Any]) -> bool:
        """Analyze a correspondent and suggest description.

        Args:
            correspondent: Correspondent data from Paperless API

        Returns:
            True if a suggestion was created, False otherwise.
        """
        correspondent_id = correspondent["id"]
        correspondent_name = correspondent["name"]

        # Get documents from this correspondent
        docs = await self._get_documents_by_correspondent(correspondent_id)
        doc_count = len(docs)

        if doc_count < self.MIN_DOCUMENTS_FOR_ANALYSIS:
            logger.debug(
                f"Skipping correspondent '{correspondent_name}': only {doc_count} documents "
                f"(minimum: {self.MIN_DOCUMENTS_FOR_ANALYSIS})"
            )
            return False

        # Generate description
        description = await self._generate_description(
            "correspondent", correspondent_name, docs[: self.MAX_SAMPLE_DOCUMENTS]
        )

        if not description:
            return False

        # Queue for user review
        self.pending.add(
            doc_id=0,
            doc_title=f"Correspondent: {correspondent_name}",
            item_type="metadata_description",
            suggestion=description,
            reasoning=f"Based on analysis of {doc_count} documents from this correspondent",
            alternatives=[],
            metadata={
                "entity_type": "correspondent",
                "entity_id": correspondent_id,
                "entity_name": correspondent_name,
                "document_count": doc_count,
            },
        )

        logger.info(f"Created description suggestion for correspondent '{correspondent_name}'")
        return True

    async def _generate_description(
        self,
        entity_type: str,
        entity_name: str,
        sample_docs: list[dict[str, Any]],
    ) -> str | None:
        """Generate a description using the LLM.

        Args:
            entity_type: Type of entity (tag, document_type, correspondent)
            entity_name: Name of the entity
            sample_docs: Sample documents using this entity

        Returns:
            Generated description string, or None if generation failed.
        """
        # Load prompt template (with language fallback)
        prompt_template = load_prompt("metadata_description")
        if not prompt_template:
            prompt_template = self._default_prompt()

        # Format sample documents
        doc_summaries = "\n".join(
            f"- {doc.get('title', 'Unknown')} (created: {doc.get('created', 'unknown')})"
            for doc in sample_docs
        )

        # Map entity_type to human-readable label
        entity_type_labels = {
            "tag": "tag",
            "document_type": "document type",
            "correspondent": "correspondent",
        }
        entity_label = entity_type_labels.get(entity_type, entity_type)

        try:
            formatted_prompt = prompt_template.format(
                entity_type=entity_label,
                entity_name=entity_name,
                sample_documents=doc_summaries,
                document_count=len(sample_docs),
            )
        except KeyError as e:
            logger.warning(f"Missing template variable in metadata_description prompt: {e}")
            # Fall back to default prompt
            formatted_prompt = self._default_prompt().format(
                entity_type=entity_label,
                entity_name=entity_name,
                sample_documents=doc_summaries,
                document_count=len(sample_docs),
            )

        try:
            messages = [HumanMessage(content=formatted_prompt)]
            response = await self.model.ainvoke(messages)

            # Extract description from response
            if response.content:
                description = response.content.strip()
                # Clean up common LLM response patterns
                description = self._clean_description(description)
                return description if description else None
            return None

        except Exception as e:
            logger.error(f"Error generating description for {entity_type} '{entity_name}': {e}")
            return None

    def _clean_description(self, description: str) -> str:
        """Clean up the generated description.

        Removes common LLM artifacts like quotes, prefixes, etc.
        """
        # Remove surrounding quotes
        description = description.strip("\"'")

        # Remove common prefixes
        prefixes_to_remove = [
            "Description:",
            "Here is a description:",
            "Here's a description:",
            "Suggested description:",
        ]
        for prefix in prefixes_to_remove:
            if description.lower().startswith(prefix.lower()):
                description = description[len(prefix) :].strip()

        # Limit length (Paperless match field has a limit)
        max_length = 255
        if len(description) > max_length:
            description = description[: max_length - 3] + "..."

        return description

    def _default_prompt(self) -> str:
        """Return the default prompt template if no prompt file exists."""
        return """Generate a brief description for this {entity_type}.

Name: {entity_name}

Sample documents using this {entity_type} ({document_count} shown):
{sample_documents}

Based on these documents, write a 1-2 sentence description that explains what this {entity_type} represents or is used for.

Guidelines:
- Be concise and informative
- Focus on the common theme or purpose
- Use professional language
- Do not include quotes around the description

Write only the description, nothing else."""
