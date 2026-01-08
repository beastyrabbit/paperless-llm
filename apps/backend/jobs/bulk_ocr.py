"""Bulk OCR Job for processing all documents.

This job runs OCR on all documents (or documents without OCR content)
using the Mistral OCR agent.
"""

import asyncio
import logging
from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field

from agents.ocr_agent import OCRAgent
from config import get_settings
from services.paperless import PaperlessClient

logger = logging.getLogger(__name__)


class BulkOCRStatus(str, Enum):
    """Status of the bulk OCR job."""

    IDLE = "idle"
    RUNNING = "running"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class BulkOCRProgress(BaseModel):
    """Progress update for bulk OCR job."""

    status: BulkOCRStatus = BulkOCRStatus.IDLE
    total: int = 0
    processed: int = 0
    skipped: int = 0
    errors: int = 0
    current_doc_id: int | None = None
    current_doc_title: str | None = None
    docs_per_second: float = Field(default=1.0, description="Rate limit for OCR processing")
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error_message: str | None = None


class BulkOCRJob:
    """Job for running OCR on all documents."""

    _current_job: "BulkOCRJob | None" = None
    _lock: asyncio.Lock = asyncio.Lock()

    def __init__(self, docs_per_second: float = 1.0, skip_existing: bool = True):
        """Initialize the bulk OCR job.

        Args:
            docs_per_second: Rate limit - how many documents to process per second
            skip_existing: If True, skip documents that already have OCR content
        """
        self.settings = get_settings()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.docs_per_second = max(0.1, min(10.0, docs_per_second))  # Clamp between 0.1 and 10
        self.skip_existing = skip_existing
        self._progress = BulkOCRProgress(docs_per_second=self.docs_per_second)
        self._cancelled = False

    @classmethod
    def get_current_progress(cls) -> BulkOCRProgress:
        """Get progress of current or last job."""
        if cls._current_job is not None:
            return cls._current_job._progress
        return BulkOCRProgress()

    @classmethod
    def is_running(cls) -> bool:
        """Check if a job is currently running."""
        if cls._current_job is None:
            return False
        return cls._current_job._progress.status == BulkOCRStatus.RUNNING

    @classmethod
    def cancel(cls) -> bool:
        """Cancel the current job."""
        if (
            cls._current_job is not None
            and cls._current_job._progress.status == BulkOCRStatus.RUNNING
        ):
            cls._current_job._cancelled = True
            return True
        return False

    async def run(self) -> BulkOCRProgress:
        """Run the bulk OCR job.

        Returns:
            Final progress update with results
        """
        async with self._lock:
            if (
                BulkOCRJob._current_job is not None
                and BulkOCRJob._current_job._progress.status == BulkOCRStatus.RUNNING
            ):
                raise RuntimeError("A bulk OCR job is already running")

            BulkOCRJob._current_job = self

        try:
            self._progress = BulkOCRProgress(
                status=BulkOCRStatus.RUNNING,
                started_at=datetime.now(),
                docs_per_second=self.docs_per_second,
            )

            # Initialize OCR agent
            ocr_agent = OCRAgent()

            # Get all documents from Paperless
            logger.info("Fetching all documents from Paperless for OCR...")
            all_documents = await self._get_all_documents()

            self._progress.total = len(all_documents)
            logger.info(f"Found {self._progress.total} documents for OCR processing")

            # Calculate delay between documents based on rate limit
            delay_seconds = 1.0 / self.docs_per_second

            # Process each document
            for doc in all_documents:
                if self._cancelled:
                    self._progress.status = BulkOCRStatus.CANCELLED
                    self._progress.completed_at = datetime.now()
                    logger.info("Bulk OCR cancelled by user")
                    break

                doc_id = doc["id"]
                doc_title = doc.get("title", f"Document {doc_id}")

                self._progress.current_doc_id = doc_id
                self._progress.current_doc_title = doc_title

                try:
                    # Check if document already has content (skip if requested)
                    if self.skip_existing:
                        existing_content = doc.get("content", "")
                        if existing_content and len(existing_content.strip()) > 100:
                            logger.debug(f"Skipping document {doc_id} - already has OCR content")
                            self._progress.skipped += 1
                            self._progress.processed += 1
                            continue

                    # Download PDF and run OCR
                    logger.info(f"Running OCR on document {doc_id}: {doc_title}")
                    pdf_bytes = await self.paperless.download_pdf(doc_id)

                    # Run OCR using the OCR agent
                    result = await ocr_agent.process(doc_id, pdf_bytes)

                    if result.get("success"):
                        logger.info(f"OCR completed for document {doc_id}")
                    else:
                        logger.warning(f"OCR returned no content for document {doc_id}")
                        self._progress.errors += 1

                except Exception as e:
                    logger.error(f"Error running OCR on document {doc_id}: {e}")
                    self._progress.errors += 1

                self._progress.processed += 1

                # Rate limiting delay
                await asyncio.sleep(delay_seconds)

            # Mark completion
            if self._progress.status == BulkOCRStatus.RUNNING:
                self._progress.status = BulkOCRStatus.COMPLETED
                self._progress.completed_at = datetime.now()

            self._progress.current_doc_id = None
            self._progress.current_doc_title = None

            logger.info(
                f"Bulk OCR completed: "
                f"{self._progress.processed}/{self._progress.total} docs, "
                f"{self._progress.skipped} skipped, "
                f"{self._progress.errors} errors"
            )

            return self._progress

        except Exception as e:
            logger.error(f"Bulk OCR failed: {e}")
            self._progress.status = BulkOCRStatus.FAILED
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
