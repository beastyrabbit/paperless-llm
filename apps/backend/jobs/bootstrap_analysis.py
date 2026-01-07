"""Bootstrap Analysis Job.

Analyzes ALL documents in Paperless to suggest schema improvements.
This is a one-time analysis for bootstrapping a new installation or
reviewing an existing document archive.

Key differences from per-document pipeline:
- Processes ALL documents regardless of tags
- Does NOT modify document tags
- Streams progress updates
- Can be cancelled mid-run
"""

import asyncio
import logging
from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field

from agents.schema_analysis_agent import SchemaAnalysisAgent
from config import get_settings
from services.paperless import PaperlessClient
from services.pending_reviews import get_pending_reviews_service

logger = logging.getLogger(__name__)


class BootstrapStatus(str, Enum):
    """Status of bootstrap analysis job."""

    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class SuggestionsByType(BaseModel):
    """Breakdown of suggestions by entity type."""

    correspondents: int = 0
    document_types: int = 0
    tags: int = 0


class ProgressUpdate(BaseModel):
    """Progress update for bootstrap analysis."""

    status: BootstrapStatus
    total: int = 0
    processed: int = 0
    current_doc_id: int | None = None
    current_doc_title: str | None = None
    suggestions_found: int = 0
    suggestions_by_type: SuggestionsByType = Field(default_factory=SuggestionsByType)
    errors: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None
    # ETA fields
    avg_seconds_per_doc: float | None = None
    estimated_remaining_seconds: int | None = None


class BootstrapAnalysisJob:
    """Analyze all documents to suggest schema improvements.

    This job iterates through all documents in Paperless and runs
    schema analysis on each to identify potential improvements to
    correspondents, document types, and tags.
    """

    # Class-level state for singleton tracking
    _current_job: "BootstrapAnalysisJob | None" = None
    _lock = asyncio.Lock()

    def __init__(
        self,
        analysis_type: Literal["all", "correspondents", "document_types", "tags"] = "all",
    ):
        """Initialize bootstrap analysis job.

        Args:
            analysis_type: Type of analysis to run:
                - 'all': Analyze all entity types
                - 'correspondents': Only suggest new correspondents
                - 'document_types': Only suggest new document types
                - 'tags': Only suggest new tags
        """
        self.analysis_type = analysis_type
        self.settings = get_settings()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.pending = get_pending_reviews_service()

        # State
        self._cancelled = False
        self._progress = ProgressUpdate(status=BootstrapStatus.IDLE)

    @classmethod
    async def get_current_job(cls) -> "BootstrapAnalysisJob | None":
        """Get currently running job if any."""
        return cls._current_job

    @classmethod
    async def is_running(cls) -> bool:
        """Check if a job is currently running."""
        return (
            cls._current_job is not None
            and cls._current_job._progress.status == BootstrapStatus.RUNNING
        )

    @classmethod
    async def cancel_current(cls) -> bool:
        """Cancel the currently running job."""
        if cls._current_job and cls._current_job._progress.status == BootstrapStatus.RUNNING:
            cls._current_job._cancelled = True
            return True
        return False

    @classmethod
    async def get_status(cls) -> ProgressUpdate:
        """Get status of current or last job."""
        if cls._current_job:
            return cls._current_job._progress
        return ProgressUpdate(status=BootstrapStatus.IDLE)

    async def run(self) -> ProgressUpdate:
        """Run the bootstrap analysis.

        Returns:
            Final progress update with results
        """
        async with self._lock:
            if (
                BootstrapAnalysisJob._current_job is not None
                and BootstrapAnalysisJob._current_job._progress.status == BootstrapStatus.RUNNING
            ):
                raise RuntimeError("A bootstrap analysis job is already running")

            BootstrapAnalysisJob._current_job = self

        try:
            self._progress = ProgressUpdate(
                status=BootstrapStatus.RUNNING,
                started_at=datetime.now(),
            )

            # Initialize schema analysis agent
            agent = SchemaAnalysisAgent()

            # Track pending suggestions to pass to agent (avoid duplicates)
            # Format: {"correspondent": ["Amazon", ...], "document_type": [...], "tag": [...]}
            self._pending_suggestions: dict[str, list[str]] = {
                "correspondent": [],
                "document_type": [],
                "tag": [],
            }

            # Track suggestion counts for incrementing attempts
            # Format: {"correspondent:amazon": 5, ...}
            self._suggestion_counts: dict[str, int] = {}

            # Get all documents from Paperless
            logger.info("Fetching all documents from Paperless...")
            all_documents = await self._get_all_documents()

            self._progress.total = len(all_documents)
            logger.info(f"Found {self._progress.total} documents to analyze")

            # Process each document
            for doc in all_documents:
                if self._cancelled:
                    self._progress.status = BootstrapStatus.CANCELLED
                    self._progress.completed_at = datetime.now()
                    logger.info("Bootstrap analysis cancelled by user")
                    break

                doc_id = doc["id"]
                doc_title = doc.get("title", f"Document {doc_id}")

                self._progress.current_doc_id = doc_id
                self._progress.current_doc_title = doc_title

                try:
                    # Get document content
                    content = doc.get("content", "")
                    if not content:
                        # Try to fetch full document with content
                        full_doc = await self.paperless.get_document(doc_id)
                        content = full_doc.get("content", "") if full_doc else ""

                    if not content:
                        logger.debug(f"No content for document {doc_id}, skipping")
                        self._progress.processed += 1
                        continue

                    # Run schema analysis with pending suggestions context
                    result = await agent.process(
                        doc_id,
                        content,
                        pending_suggestions=self._pending_suggestions,
                    )

                    # Filter suggestions by analysis type
                    suggestions = self._filter_by_type(result.get("suggestions", []))

                    # Queue suggestions for review
                    for suggestion in suggestions:
                        await self._queue_suggestion(doc_id, doc_title, suggestion)
                        self._progress.suggestions_found += 1

                    # Process matches to pending items (increment counts)
                    matches = result.get("matches_pending", [])
                    for match in matches:
                        self._increment_pending_match(match)

                except Exception as e:
                    logger.error(f"Error analyzing document {doc_id}: {e}")
                    self._progress.errors += 1

                self._progress.processed += 1

                # Calculate ETA
                if self._progress.started_at and self._progress.processed > 0:
                    elapsed = (datetime.now() - self._progress.started_at).total_seconds()
                    self._progress.avg_seconds_per_doc = elapsed / self._progress.processed
                    remaining_docs = self._progress.total - self._progress.processed
                    self._progress.estimated_remaining_seconds = int(
                        remaining_docs * self._progress.avg_seconds_per_doc
                    )

                # Small delay to avoid overwhelming the system
                await asyncio.sleep(0.1)

            # Mark completion
            if self._progress.status == BootstrapStatus.RUNNING:
                self._progress.status = BootstrapStatus.COMPLETED
                self._progress.completed_at = datetime.now()

            self._progress.current_doc_id = None
            self._progress.current_doc_title = None

            logger.info(
                f"Bootstrap analysis completed: "
                f"{self._progress.processed}/{self._progress.total} docs, "
                f"{self._progress.suggestions_found} suggestions, "
                f"{self._progress.errors} errors"
            )

            return self._progress

        except Exception as e:
            logger.error(f"Bootstrap analysis failed: {e}")
            self._progress.status = BootstrapStatus.FAILED
            self._progress.error_message = str(e)
            self._progress.completed_at = datetime.now()
            raise

    async def _get_all_documents(self) -> list[dict[str, Any]]:
        """Fetch all documents from Paperless.

        Returns:
            List of document dicts
        """
        all_docs: list[dict[str, Any]] = []
        page = 1
        page_size = 100

        while True:
            # Use the list endpoint with pagination
            result = await self.paperless._request(
                "GET",
                "/documents/",
                params={"page": page, "page_size": page_size},
            )

            if not result:
                break

            docs = result.get("results", [])
            all_docs.extend(docs)

            # Check if there are more pages
            if not result.get("next"):
                break

            page += 1

        return all_docs

    def _filter_by_type(self, suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Filter suggestions by analysis type.

        Args:
            suggestions: List of suggestion dicts

        Returns:
            Filtered list based on analysis_type
        """
        if self.analysis_type == "all":
            return suggestions

        type_map = {
            "correspondents": "correspondent",
            "document_types": "document_type",
            "tags": "tag",
        }
        target_type = type_map.get(self.analysis_type)

        return [s for s in suggestions if s.get("entity_type") == target_type]

    async def _queue_suggestion(
        self, doc_id: int, doc_title: str, suggestion: dict[str, Any]
    ) -> bool:
        """Queue a suggestion for review, tracking duplicates and incrementing attempts.

        Args:
            doc_id: Document ID
            doc_title: Document title
            suggestion: Suggestion dict from schema analysis

        Returns:
            True if this is a new suggestion, False if it was a duplicate (attempts incremented)
        """
        entity_type = suggestion.get("entity_type", "unknown")
        suggested_name = suggestion.get("suggested_name", "")

        # Create a normalized key for tracking
        normalized_name = suggested_name.lower().strip()
        tracking_key = f"{entity_type}:{normalized_name}"

        # Check if we've already seen this suggestion
        if tracking_key in self._suggestion_counts:
            # Increment attempts count
            self._suggestion_counts[tracking_key] += 1
            attempts = self._suggestion_counts[tracking_key]

            logger.debug(
                f"Duplicate suggestion '{suggested_name}' ({entity_type}) - "
                f"now at {attempts} attempts"
            )

            # Update the existing pending review item with new attempts count
            # The pending.add will update if same id exists
            type_map = {
                "correspondent": "schema_correspondent",
                "document_type": "schema_document_type",
                "tag": "schema_tag",
            }
            item_type = type_map.get(entity_type, "schema_correspondent")

            # Use doc_id=0 for bootstrap suggestions (not tied to single doc)
            self.pending.add(
                doc_id=0,  # 0 indicates multi-document suggestion
                doc_title=f"Multiple documents ({attempts} occurrences)",
                item_type=item_type,  # type: ignore
                suggestion=suggested_name,
                reasoning=suggestion.get("reasoning", ""),
                alternatives=suggestion.get("similar_to_existing", []),
                attempts=attempts,
                metadata={
                    "entity_type": entity_type,
                    "confidence": suggestion.get("confidence", 0.0),
                    "source": "bootstrap_analysis",
                    "analysis_type": self.analysis_type,
                    "occurrence_count": attempts,
                },
            )
            return False

        # New suggestion - add to tracking
        self._suggestion_counts[tracking_key] = 1

        # Add to pending suggestions list (for passing to agent)
        if entity_type in self._pending_suggestions:
            self._pending_suggestions[entity_type].append(suggested_name)

        # Map entity types to valid PendingReviewType values
        type_map = {
            "correspondent": "schema_correspondent",
            "document_type": "schema_document_type",
            "tag": "schema_tag",
        }
        item_type = type_map.get(entity_type, "schema_correspondent")

        # Queue new suggestion
        self.pending.add(
            doc_id=0,  # 0 indicates multi-document/bootstrap suggestion
            doc_title=f"Bootstrap: {doc_title}",
            item_type=item_type,  # type: ignore
            suggestion=suggested_name,
            reasoning=suggestion.get("reasoning", ""),
            alternatives=suggestion.get("similar_to_existing", []),
            attempts=1,
            metadata={
                "entity_type": entity_type,
                "confidence": suggestion.get("confidence", 0.0),
                "source": "bootstrap_analysis",
                "analysis_type": self.analysis_type,
                "first_doc_id": doc_id,
                "occurrence_count": 1,
            },
        )

        # Increment per-type counter
        if entity_type == "correspondent":
            self._progress.suggestions_by_type.correspondents += 1
        elif entity_type == "document_type":
            self._progress.suggestions_by_type.document_types += 1
        elif entity_type == "tag":
            self._progress.suggestions_by_type.tags += 1

        logger.debug(f"New suggestion: '{suggested_name}' ({entity_type})")
        return True

    def _increment_pending_match(self, match: dict[str, Any]) -> None:
        """Increment the count for a matched pending suggestion.

        This is called when the agent reports that a document matches an
        already-pending suggestion without creating a new one.

        Args:
            match: Match dict with entity_type and matched_name
        """
        entity_type = match.get("entity_type", "unknown")
        matched_name = match.get("matched_name", "")

        if not matched_name:
            return

        # Create normalized key
        normalized_name = matched_name.lower().strip()
        tracking_key = f"{entity_type}:{normalized_name}"

        # Only increment if we're already tracking this
        if tracking_key not in self._suggestion_counts:
            logger.debug(f"Match for unknown pending item: '{matched_name}' ({entity_type})")
            return

        # Increment the count
        self._suggestion_counts[tracking_key] += 1
        attempts = self._suggestion_counts[tracking_key]

        logger.debug(
            f"Pending match '{matched_name}' ({entity_type}) - " f"now at {attempts} occurrences"
        )

        # Update the pending review item with new count
        type_map = {
            "correspondent": "schema_correspondent",
            "document_type": "schema_document_type",
            "tag": "schema_tag",
        }
        item_type = type_map.get(entity_type, "schema_correspondent")

        # Re-add to update the attempts count
        self.pending.add(
            doc_id=0,
            doc_title=f"Multiple documents ({attempts} occurrences)",
            item_type=item_type,  # type: ignore
            suggestion=matched_name,
            reasoning=f"Matched by {attempts} documents during bootstrap analysis",
            alternatives=[],
            attempts=attempts,
            metadata={
                "entity_type": entity_type,
                "confidence": 1.0,  # High confidence since multiple docs match
                "source": "bootstrap_analysis",
                "analysis_type": self.analysis_type,
                "occurrence_count": attempts,
            },
        )

    def get_progress(self) -> ProgressUpdate:
        """Get current progress."""
        return self._progress
