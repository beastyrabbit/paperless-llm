"""Paperless-ngx API Client."""

from typing import Any

import httpx


class PaperlessClient:
    """Client for Paperless-ngx API."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._headers = {"Authorization": f"Token {token}"}

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs,
    ) -> dict[str, Any] | list[Any] | None:
        """Make an API request."""
        url = f"{self.base_url}/api{endpoint}"
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method,
                url,
                headers=self._headers,
                timeout=30.0,
                **kwargs,
            )
            response.raise_for_status()
            if response.status_code == 204:
                return None
            return response.json()

    async def get_document(self, doc_id: int) -> dict[str, Any] | None:
        """Get a single document by ID."""
        try:
            doc = await self._request("GET", f"/documents/{doc_id}/")
            if doc:
                # Enrich with related data
                doc["tags_data"] = await self._get_tags_data(doc.get("tags", []))
                doc["correspondent_name"] = await self._get_correspondent_name(
                    doc.get("correspondent")
                )
            return doc
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                return None
            raise

    async def get_documents_by_tag(
        self,
        tag_name: str,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Get documents that have a specific tag."""
        # First, find the tag ID
        tag_id = await self._get_tag_id(tag_name)
        if tag_id is None:
            return []

        result = await self._request(
            "GET",
            "/documents/",
            params={"tags__id": tag_id, "page_size": limit},
        )

        docs = result.get("results", []) if result else []

        # Enrich with tag and correspondent data
        for doc in docs:
            doc["tags_data"] = await self._get_tags_data(doc.get("tags", []))
            doc["correspondent_name"] = await self._get_correspondent_name(doc.get("correspondent"))

        return docs

    async def get_queue_stats(
        self,
        tag_pending: str,
        tag_ocr_done: str,
        tag_title_done: str,
        tag_correspondent_done: str,
        tag_tags_done: str,
        tag_processed: str,
        tag_document_type_done: str | None = None,
    ) -> dict[str, int]:
        """Get document counts for each processing stage.

        Pipeline Order: OCR → Correspondent → Document Type → Title → Tags
        """
        stats = {
            "pending": 0,
            "ocr_done": 0,
            "correspondent_done": 0,
            "document_type_done": 0,
            "title_done": 0,
            "tags_done": 0,
            "processed": 0,
        }

        tag_mapping = {
            tag_pending: "pending",
            tag_ocr_done: "ocr_done",
            tag_correspondent_done: "correspondent_done",
            tag_title_done: "title_done",
            tag_tags_done: "tags_done",
            tag_processed: "processed",
        }

        # Add document_type_done if provided
        if tag_document_type_done:
            tag_mapping[tag_document_type_done] = "document_type_done"

        for tag_name, stat_key in tag_mapping.items():
            tag_id = await self._get_tag_id(tag_name)
            if tag_id:
                result = await self._request(
                    "GET",
                    "/documents/",
                    params={"tags__id": tag_id, "page_size": 1},
                )
                stats[stat_key] = result.get("count", 0) if result else 0

        stats["total_in_pipeline"] = sum(
            stats[k]
            for k in [
                "pending",
                "ocr_done",
                "correspondent_done",
                "document_type_done",
                "title_done",
                "tags_done",
            ]
        )

        # Get total documents count
        total_result = await self._request(
            "GET",
            "/documents/",
            params={"page_size": 1},
        )
        stats["total_documents"] = total_result.get("count", 0) if total_result else 0

        return stats

    async def update_document(
        self,
        doc_id: int,
        title: str | None = None,
        correspondent: int | None = None,
        document_type: int | None = None,
        tags: list[int] | None = None,
        custom_fields: list[dict] | None = None,
    ) -> dict[str, Any] | None:
        """Update a document's metadata."""
        data = {}
        if title is not None:
            data["title"] = title
        if correspondent is not None:
            data["correspondent"] = correspondent
        if document_type is not None:
            data["document_type"] = document_type
        if tags is not None:
            data["tags"] = tags
        if custom_fields is not None:
            data["custom_fields"] = custom_fields

        if not data:
            return None

        return await self._request("PATCH", f"/documents/{doc_id}/", json=data)

    async def add_tag_to_document(self, doc_id: int, tag_name: str) -> bool:
        """Add a tag to a document, creating the tag if needed."""
        tag_id = await self._get_or_create_tag(tag_name)
        doc = await self.get_document(doc_id)
        if not doc:
            return False

        current_tags = doc.get("tags", [])
        if tag_id not in current_tags:
            current_tags.append(tag_id)
            await self.update_document(doc_id, tags=current_tags)
        return True

    async def remove_tag_from_document(self, doc_id: int, tag_name: str) -> bool:
        """Remove a tag from a document."""
        tag_id = await self._get_tag_id(tag_name)
        if tag_id is None:
            return True  # Tag doesn't exist, nothing to remove

        doc = await self.get_document(doc_id)
        if not doc:
            return False

        current_tags = doc.get("tags", [])
        if tag_id in current_tags:
            current_tags.remove(tag_id)
            await self.update_document(doc_id, tags=current_tags)
        return True

    async def download_pdf(self, doc_id: int) -> bytes:
        """Download the original PDF document."""
        url = f"{self.base_url}/api/documents/{doc_id}/download/"
        async with httpx.AsyncClient() as client:
            response = await client.get(
                url,
                headers=self._headers,
                timeout=120.0,
            )
            response.raise_for_status()
            return response.content

    # Tags methods
    async def get_tags(self) -> list[dict[str, Any]]:
        """Get all tags."""
        result = await self._request("GET", "/tags/", params={"page_size": 1000})
        return result.get("results", []) if result else []

    async def create_tag(self, name: str, color: str | None = None) -> dict[str, Any]:
        """Create a new tag."""
        data = {"name": name}
        if color:
            data["color"] = color
        return await self._request("POST", "/tags/", json=data)

    async def _get_tag_id(self, tag_name: str) -> int | None:
        """Get tag ID by name."""
        tags = await self.get_tags()
        for tag in tags:
            if tag["name"] == tag_name:
                return tag["id"]
        return None

    async def _get_or_create_tag(self, tag_name: str) -> int:
        """Get tag ID, creating it if it doesn't exist."""
        tag_id = await self._get_tag_id(tag_name)
        if tag_id is not None:
            return tag_id
        result = await self.create_tag(tag_name)
        return result["id"]

    async def _get_tags_data(self, tag_ids: list[int]) -> list[dict[str, Any]]:
        """Get tag data for a list of tag IDs."""
        if not tag_ids:
            return []
        all_tags = await self.get_tags()
        return [tag for tag in all_tags if tag["id"] in tag_ids]

    # Correspondents methods
    async def get_correspondents(self) -> list[dict[str, Any]]:
        """Get all correspondents."""
        result = await self._request("GET", "/correspondents/", params={"page_size": 1000})
        return result.get("results", []) if result else []

    async def create_correspondent(self, name: str) -> dict[str, Any]:
        """Create a new correspondent."""
        return await self._request("POST", "/correspondents/", json={"name": name})

    async def _get_correspondent_name(self, correspondent_id: int | None) -> str | None:
        """Get correspondent name by ID."""
        if correspondent_id is None:
            return None
        correspondents = await self.get_correspondents()
        for corr in correspondents:
            if corr["id"] == correspondent_id:
                return corr["name"]
        return None

    async def get_or_create_correspondent(self, name: str) -> int:
        """Get correspondent ID, creating if needed."""
        correspondents = await self.get_correspondents()
        for corr in correspondents:
            if corr["name"].lower() == name.lower():
                return corr["id"]
        result = await self.create_correspondent(name)
        return result["id"]

    # Document Types methods
    async def get_document_types(self) -> list[dict[str, Any]]:
        """Get all document types."""
        result = await self._request("GET", "/document_types/", params={"page_size": 1000})
        return result.get("results", []) if result else []

    async def create_document_type(self, name: str) -> dict[str, Any]:
        """Create a new document type."""
        return await self._request("POST", "/document_types/", json={"name": name})

    async def get_or_create_document_type(self, name: str) -> int:
        """Get document type ID, creating if needed."""
        doc_types = await self.get_document_types()
        for dt in doc_types:
            if dt["name"].lower() == name.lower():
                return dt["id"]
        result = await self.create_document_type(name)
        return result["id"]

    async def get_document_type_name(self, doc_type_id: int | None) -> str | None:
        """Get document type name by ID."""
        if doc_type_id is None:
            return None
        doc_types = await self.get_document_types()
        for dt in doc_types:
            if dt["id"] == doc_type_id:
                return dt["name"]
        return None

    # Custom Fields methods
    async def get_custom_fields(self) -> list[dict[str, Any]]:
        """Get all custom field definitions."""
        result = await self._request("GET", "/custom_fields/", params={"page_size": 100})
        return result.get("results", []) if result else []
