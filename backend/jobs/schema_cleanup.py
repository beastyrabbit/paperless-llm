"""Background job for schema cleanup suggestions.

This job identifies potential issues in the schema such as:
- Duplicate/similar entity names that could be merged
- Unused entities that could be deleted
- Inconsistent naming patterns

All suggestions are queued through the pending reviews system for user approval.
"""

from difflib import SequenceMatcher
from typing import Any

from langchain_core.messages import HumanMessage
from pydantic import BaseModel, Field

from agents.base import get_large_model
from agents.prompts import load_prompt
from config import get_settings
from services.paperless import PaperlessClient
from services.pending_reviews import get_pending_reviews_service


class MergeAnalysis(BaseModel):
    """LLM output schema for merge analysis."""

    should_merge: bool = Field(description="Whether these two entities should be merged")
    reasoning: str = Field(description="Explanation for the merge decision")
    keep_name: str = Field(
        description="Which name to keep if merging (the more formal/complete one)"
    )


class SchemaCleanupJob:
    """Background job that identifies schema cleanup opportunities.

    This job scans all correspondents, tags, and document types to find:
    1. Similar names that might be duplicates (using fuzzy string matching)
    2. Unused entities with no associated documents
    3. Entities that could benefit from renaming

    All suggestions are queued through the pending reviews system,
    allowing users to approve or reject each suggestion.
    """

    def __init__(self, similarity_threshold: float = 0.8):
        """Initialize the schema cleanup job.

        Args:
            similarity_threshold: Minimum similarity ratio (0-1) for
                considering two names as potential duplicates.
                Default is 0.8 (80% similar).
        """
        self.settings = get_settings()
        self.model = get_large_model()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.pending = get_pending_reviews_service()
        self.similarity_threshold = similarity_threshold

    async def run(self) -> dict[str, Any]:
        """Run the schema cleanup job.

        Returns:
            Dictionary with statistics about the cleanup run:
            - correspondents_checked: Number of correspondents analyzed
            - tags_checked: Number of tags analyzed
            - document_types_checked: Number of document types analyzed
            - merge_suggestions: Number of merge suggestions created
            - delete_suggestions: Number of delete suggestions created
        """
        results = {
            "correspondents_checked": 0,
            "tags_checked": 0,
            "document_types_checked": 0,
            "merge_suggestions": 0,
            "delete_suggestions": 0,
        }

        # Check correspondents
        correspondents = await self.paperless.get_correspondents()
        results["correspondents_checked"] = len(correspondents)

        similar_correspondent_pairs = self._find_similar_names(correspondents)
        for name1, name2, item1, item2 in similar_correspondent_pairs:
            merged = await self._analyze_merge("correspondent", name1, name2, item1, item2)
            if merged:
                results["merge_suggestions"] += 1

        # Check for unused correspondents
        for corr in correspondents:
            doc_count = await self._get_entity_document_count("correspondent", corr["id"])
            if doc_count == 0:
                self._suggest_deletion("correspondent", corr)
                results["delete_suggestions"] += 1

        # Check tags
        tags = await self.paperless.get_tags()
        results["tags_checked"] = len(tags)

        # Filter out system tags (llm-* tags used for pipeline)
        user_tags = [t for t in tags if not t["name"].startswith("llm-")]

        similar_tag_pairs = self._find_similar_names(user_tags)
        for name1, name2, item1, item2 in similar_tag_pairs:
            merged = await self._analyze_merge("tag", name1, name2, item1, item2)
            if merged:
                results["merge_suggestions"] += 1

        # Check for unused tags (excluding system tags)
        for tag in user_tags:
            doc_count = await self._get_entity_document_count("tag", tag["id"])
            if doc_count == 0:
                self._suggest_deletion("tag", tag)
                results["delete_suggestions"] += 1

        # Check document types
        doc_types = await self.paperless.get_document_types()
        results["document_types_checked"] = len(doc_types)

        similar_type_pairs = self._find_similar_names(doc_types)
        for name1, name2, item1, item2 in similar_type_pairs:
            merged = await self._analyze_merge("document_type", name1, name2, item1, item2)
            if merged:
                results["merge_suggestions"] += 1

        # Check for unused document types
        for doc_type in doc_types:
            doc_count = await self._get_entity_document_count("document_type", doc_type["id"])
            if doc_count == 0:
                self._suggest_deletion("document_type", doc_type)
                results["delete_suggestions"] += 1

        return results

    def _find_similar_names(
        self,
        entities: list[dict[str, Any]],
        threshold: float | None = None,
    ) -> list[tuple[str, str, dict[str, Any], dict[str, Any]]]:
        """Find entities with similar names using fuzzy string matching.

        Uses the SequenceMatcher algorithm to find entity names that are
        similar but not identical, which may indicate duplicates or
        variations of the same entity.

        Args:
            entities: List of entity dictionaries with 'name' key
            threshold: Similarity threshold (0-1). Uses instance default if None.

        Returns:
            List of tuples: (name1, name2, entity1, entity2) for similar pairs
        """
        if threshold is None:
            threshold = self.similarity_threshold

        similar: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = []
        seen: set[tuple[str, str]] = set()

        for i, e1 in enumerate(entities):
            for e2 in entities[i + 1 :]:
                name1 = e1["name"]
                name2 = e2["name"]

                # Skip if names are identical
                if name1.lower() == name2.lower():
                    continue

                # Skip if already processed this pair
                key = tuple(sorted([name1, name2]))
                if key in seen:
                    continue
                seen.add(key)

                # Calculate similarity using SequenceMatcher
                ratio = SequenceMatcher(
                    None,
                    name1.lower(),
                    name2.lower(),
                ).ratio()

                if ratio >= threshold:
                    similar.append((name1, name2, e1, e2))

        return similar

    async def _analyze_merge(
        self,
        entity_type: str,
        name1: str,
        name2: str,
        item1: dict[str, Any],
        item2: dict[str, Any],
    ) -> bool:
        """Analyze if two entities should be merged using LLM.

        Calls the LLM to determine if two similar entities are actually
        duplicates that should be merged, or distinct entities that
        just happen to have similar names.

        Args:
            entity_type: Type of entity (correspondent, tag, document_type)
            name1: First entity name
            name2: Second entity name
            item1: First entity data dict
            item2: Second entity data dict

        Returns:
            True if a merge suggestion was created, False otherwise
        """
        # Load prompt template
        prompt_template = load_prompt("schema_cleanup")
        if not prompt_template:
            prompt_template = self._default_prompt()

        # Get document counts for context
        doc_count_1 = await self._get_entity_document_count(entity_type, item1["id"])
        doc_count_2 = await self._get_entity_document_count(entity_type, item2["id"])

        # Format the prompt
        formatted_prompt = prompt_template.format(
            entity_type=entity_type.replace("_", " "),
            name1=name1,
            name2=name2,
            doc_count_1=doc_count_1,
            doc_count_2=doc_count_2,
        )

        # Call LLM with structured output
        messages = [HumanMessage(content=formatted_prompt)]
        structured_model = self.model.with_structured_output(MergeAnalysis)
        analysis: MergeAnalysis = await structured_model.ainvoke(messages)

        if analysis.should_merge:
            # Determine source and target based on which name to keep
            if analysis.keep_name.lower() == name1.lower():
                source_id = item2["id"]
                target_id = item1["id"]
                source_name = name2
                target_name = name1
            else:
                source_id = item1["id"]
                target_id = item2["id"]
                source_name = name1
                target_name = name2

            self.pending.add(
                doc_id=0,  # Not associated with a specific document
                doc_title=f"Merge {entity_type.replace('_', ' ')}: {name1} / {name2}",
                item_type="schema_cleanup",
                suggestion=f"Merge into: {analysis.keep_name}",
                reasoning=analysis.reasoning,
                alternatives=[name1, name2],
                metadata={
                    "cleanup_type": "merge",
                    "entity_type": entity_type,
                    "source_id": source_id,
                    "target_id": target_id,
                    "source_name": source_name,
                    "target_name": target_name,
                    "doc_count_source": doc_count_2
                    if analysis.keep_name.lower() == name1.lower()
                    else doc_count_1,
                    "doc_count_target": doc_count_1
                    if analysis.keep_name.lower() == name1.lower()
                    else doc_count_2,
                },
            )
            return True

        return False

    def _suggest_deletion(
        self,
        entity_type: str,
        entity: dict[str, Any],
    ) -> None:
        """Suggest deleting an unused entity.

        Creates a pending review item for an entity that has no
        associated documents and could potentially be deleted.

        Args:
            entity_type: Type of entity (correspondent, tag, document_type)
            entity: Entity data dict with 'id' and 'name' keys
        """
        self.pending.add(
            doc_id=0,  # Not associated with a specific document
            doc_title=f"Delete unused {entity_type.replace('_', ' ')}: {entity['name']}",
            item_type="schema_cleanup",
            suggestion=f"Delete {entity['name']}",
            reasoning="No documents are using this entity. It can be safely deleted to keep your schema clean.",
            alternatives=[],
            metadata={
                "cleanup_type": "delete",
                "entity_type": entity_type,
                "entity_id": entity["id"],
                "entity_name": entity["name"],
            },
        )

    async def _get_entity_document_count(
        self,
        entity_type: str,
        entity_id: int,
    ) -> int:
        """Get the number of documents associated with an entity.

        Args:
            entity_type: Type of entity (correspondent, tag, document_type)
            entity_id: ID of the entity

        Returns:
            Number of documents using this entity
        """
        try:
            if entity_type == "correspondent":
                result = await self.paperless._request(
                    "GET",
                    "/documents/",
                    params={"correspondent__id": entity_id, "page_size": 1},
                )
            elif entity_type == "tag":
                result = await self.paperless._request(
                    "GET",
                    "/documents/",
                    params={"tags__id": entity_id, "page_size": 1},
                )
            elif entity_type == "document_type":
                result = await self.paperless._request(
                    "GET",
                    "/documents/",
                    params={"document_type__id": entity_id, "page_size": 1},
                )
            else:
                return 0

            return result.get("count", 0) if result else 0
        except Exception:
            return 0

    def _default_prompt(self) -> str:
        """Return default prompt if template file is not found."""
        return """Analyze these two {entity_type} names and determine if they should be merged.

Name 1: {name1} (used by {doc_count_1} documents)
Name 2: {name2} (used by {doc_count_2} documents)

Consider:
- Are they the same entity with different spellings or variations?
- Is one a variant of the other (e.g., "Amazon" vs "Amazon.de")?
- Are they truly different entities that happen to have similar names?

If they should be merged, specify which name to keep (usually the more formal/complete one).

Examples of entities that SHOULD be merged:
- "Amazon" and "Amazon EU" - same company
- "Dr. Schmidt" and "Dr Schmidt" - same person, just formatting difference
- "Deutsche Bank AG" and "Deutsche Bank" - same company

Examples that should NOT be merged:
- "Amazon" and "Amazon Web Services" - different services
- "Finanzamt Berlin" and "Finanzamt Munich" - different offices
- "Invoice" and "Invoice (Draft)" - different document states"""
