"""Background Worker for automatic document processing."""

import asyncio
from datetime import datetime
from typing import Any

from agents.pipeline import ProcessingPipeline
from config import get_settings
from services.paperless import PaperlessClient


class BackgroundWorker:
    """Background worker that processes documents automatically."""

    def __init__(self):
        self.settings = get_settings()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.pipeline = ProcessingPipeline()
        self._running = False
        self._paused = False
        self._current_doc_id: int | None = None
        self._task: asyncio.Task | None = None
        self._last_check: datetime | None = None
        self._next_check: datetime | None = None

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def is_paused(self) -> bool:
        return self._paused

    @property
    def current_document(self) -> int | None:
        return self._current_doc_id

    def get_status(self) -> dict[str, Any]:
        """Get current worker status."""
        return {
            "running": self._running,
            "paused": self._paused,
            "current_document": self._current_doc_id,
            "last_check": self._last_check.isoformat() if self._last_check else None,
            "next_check": self._next_check.isoformat() if self._next_check else None,
            "interval_minutes": self.settings.auto_processing_interval_minutes,
            "auto_processing_enabled": self.settings.auto_processing_enabled,
        }

    async def start(self):
        """Start the background worker."""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._run_loop())

    async def stop(self):
        """Stop the background worker."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def pause(self):
        """Pause processing (e.g., when user is doing manual processing)."""
        self._paused = True

    def resume(self):
        """Resume processing."""
        self._paused = False

    async def _run_loop(self):
        """Main processing loop."""
        while self._running:
            try:
                # Calculate next check time
                interval_seconds = self.settings.auto_processing_interval_minutes * 60
                self._next_check = datetime.now()

                # Check if auto-processing is enabled
                if not self.settings.auto_processing_enabled:
                    await asyncio.sleep(60)  # Check every minute if settings changed
                    continue

                # Check if paused
                if self._paused:
                    await asyncio.sleep(10)  # Check every 10 seconds when paused
                    continue

                # Process pending documents
                await self._process_queue()

                self._last_check = datetime.now()

                # Wait for next interval
                await asyncio.sleep(interval_seconds)

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Worker error: {e}")
                await asyncio.sleep(60)  # Wait before retrying

    async def _process_queue(self):
        """Process all pending documents in queue."""
        try:
            # Get pending documents
            pending_docs = await self.paperless.get_documents_by_tag(
                self.settings.tag_pending,
                limit=50,
            )

            if not pending_docs:
                return

            print(f"Found {len(pending_docs)} pending documents")

            for doc in pending_docs:
                if not self._running or self._paused:
                    break

                doc_id = doc["id"]
                self._current_doc_id = doc_id

                try:
                    print(f"Processing document {doc_id}: {doc['title']}")
                    result = await self.pipeline.process_document(doc_id)

                    if result.get("needs_review"):
                        print(f"Document {doc_id} needs review")
                    elif result.get("success"):
                        print(f"Document {doc_id} processed successfully")
                    else:
                        print(f"Document {doc_id} processing failed")

                except Exception as e:
                    print(f"Error processing document {doc_id}: {e}")

                finally:
                    self._current_doc_id = None

        except Exception as e:
            print(f"Error getting pending documents: {e}")

    async def process_single(self, doc_id: int) -> dict[str, Any]:
        """Process a single document immediately (for manual processing)."""
        self._current_doc_id = doc_id
        try:
            return await self.pipeline.process_document(doc_id)
        finally:
            self._current_doc_id = None


# Global worker instance
_worker: BackgroundWorker | None = None


def get_worker() -> BackgroundWorker:
    """Get or create the global worker instance."""
    global _worker
    if _worker is None:
        _worker = BackgroundWorker()
    return _worker
