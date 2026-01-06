"""Pending Reviews Storage Service.

Stores items that need user review before being applied:
- New correspondents
- New document types
- New tags
- Schema cleanup suggestions
- Metadata description suggestions
- Schema analysis suggestions (new correspondents, document types, tags, custom fields)
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

# Type alias for pending review item types
PendingReviewType = Literal[
    "correspondent",
    "document_type",
    "tag",
    "schema_cleanup",
    "metadata_description",
    # Schema analysis suggestion types
    "schema_correspondent",
    "schema_document_type",
    "schema_tag",
    "schema_custom_field",
]


class PendingReviewItem(BaseModel):
    """An item pending user review."""

    id: str
    doc_id: int
    doc_title: str
    type: PendingReviewType
    suggestion: str
    reasoning: str
    alternatives: list[str] = Field(default_factory=list)
    attempts: int = 1
    last_feedback: str | None = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    metadata: dict[str, Any] = Field(default_factory=dict)


class PendingReviewsService:
    """Service for managing pending review items.

    Uses a JSON file for persistence (can be replaced with database).
    """

    def __init__(self, storage_path: str | Path | None = None):
        if storage_path is None:
            storage_path = Path(__file__).parent.parent / "data" / "pending_reviews.json"
        self.storage_path = Path(storage_path)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_file_exists()

    def _ensure_file_exists(self):
        """Ensure the storage file exists."""
        if not self.storage_path.exists():
            self.storage_path.write_text("[]")

    def _load(self) -> list[dict]:
        """Load all pending items from storage."""
        try:
            return json.loads(self.storage_path.read_text())
        except (json.JSONDecodeError, FileNotFoundError):
            return []

    def _save(self, items: list[dict]):
        """Save items to storage."""
        self.storage_path.write_text(json.dumps(items, indent=2, ensure_ascii=False))

    def _generate_id(self, doc_id: int, item_type: str, suggestion: str) -> str:
        """Generate a unique ID for a pending item."""
        # Use a combination that allows finding duplicates
        import hashlib

        key = f"{doc_id}:{item_type}:{suggestion.lower()}"
        return hashlib.md5(key.encode()).hexdigest()[:12]

    def add(
        self,
        doc_id: int,
        doc_title: str,
        item_type: PendingReviewType,
        suggestion: str,
        reasoning: str,
        alternatives: list[str] | None = None,
        attempts: int = 1,
        last_feedback: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> PendingReviewItem:
        """Add a new pending review item.

        If an item with the same doc_id, type, and suggestion exists, update it.
        """
        items = self._load()
        item_id = self._generate_id(doc_id, item_type, suggestion)

        # Check if exists
        existing_idx = None
        for idx, item in enumerate(items):
            if item.get("id") == item_id:
                existing_idx = idx
                break

        new_item = PendingReviewItem(
            id=item_id,
            doc_id=doc_id,
            doc_title=doc_title,
            type=item_type,
            suggestion=suggestion,
            reasoning=reasoning,
            alternatives=alternatives or [],
            attempts=attempts,
            last_feedback=last_feedback,
            metadata=metadata or {},
        )

        if existing_idx is not None:
            # Update existing
            items[existing_idx] = new_item.model_dump()
        else:
            # Add new
            items.append(new_item.model_dump())

        self._save(items)
        return new_item

    def get_all(
        self,
        item_type: PendingReviewType | None = None,
    ) -> list[PendingReviewItem]:
        """Get all pending items, optionally filtered by type."""
        items = self._load()
        if item_type:
            items = [i for i in items if i.get("type") == item_type]
        return [PendingReviewItem(**item) for item in items]

    def get_by_doc(self, doc_id: int) -> list[PendingReviewItem]:
        """Get all pending items for a specific document."""
        items = self._load()
        return [PendingReviewItem(**i) for i in items if i.get("doc_id") == doc_id]

    def get_by_id(self, item_id: str) -> PendingReviewItem | None:
        """Get a specific pending item by ID."""
        items = self._load()
        for item in items:
            if item.get("id") == item_id:
                return PendingReviewItem(**item)
        return None

    def update_suggestion(self, item_id: str, new_suggestion: str) -> PendingReviewItem | None:
        """Update the selected suggestion for an item."""
        items = self._load()
        for idx, item in enumerate(items):
            if item.get("id") == item_id:
                # Swap current suggestion with new one in alternatives
                old_suggestion = item["suggestion"]
                items[idx]["suggestion"] = new_suggestion
                if new_suggestion in item["alternatives"]:
                    items[idx]["alternatives"].remove(new_suggestion)
                if old_suggestion not in items[idx]["alternatives"]:
                    items[idx]["alternatives"].insert(0, old_suggestion)
                self._save(items)
                return PendingReviewItem(**items[idx])
        return None

    def remove(self, item_id: str) -> bool:
        """Remove a pending item by ID."""
        items = self._load()
        original_len = len(items)
        items = [i for i in items if i.get("id") != item_id]
        if len(items) < original_len:
            self._save(items)
            return True
        return False

    def remove_by_doc(self, doc_id: int, item_type: str | None = None) -> int:
        """Remove all pending items for a document, optionally filtered by type."""
        items = self._load()
        original_len = len(items)
        if item_type:
            items = [
                i for i in items if not (i.get("doc_id") == doc_id and i.get("type") == item_type)
            ]
        else:
            items = [i for i in items if i.get("doc_id") != doc_id]
        removed = original_len - len(items)
        if removed > 0:
            self._save(items)
        return removed

    def get_counts(self) -> dict[str, int]:
        """Get counts by type."""
        items = self._load()
        counts = {
            "correspondent": 0,
            "document_type": 0,
            "tag": 0,
            "schema_cleanup": 0,
            "metadata_description": 0,
            "schema_correspondent": 0,
            "schema_document_type": 0,
            "schema_tag": 0,
            "schema_custom_field": 0,
            "total": len(items),
        }
        for item in items:
            item_type = item.get("type")
            if item_type in counts:
                counts[item_type] += 1
        return counts

    def clear_all(self):
        """Clear all pending items."""
        self._save([])


# Singleton instance
_pending_reviews_service: PendingReviewsService | None = None


def get_pending_reviews_service() -> PendingReviewsService:
    """Get the pending reviews service singleton."""
    global _pending_reviews_service
    if _pending_reviews_service is None:
        _pending_reviews_service = PendingReviewsService()
    return _pending_reviews_service
