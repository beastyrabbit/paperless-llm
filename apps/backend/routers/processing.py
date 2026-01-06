"""Processing API endpoints with streaming support."""

import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.pipeline import ProcessingPipeline
from config import Settings, get_settings
from services.paperless import PaperlessClient
from worker import get_worker

router = APIRouter()

# Shared pipeline instance
_pipeline: ProcessingPipeline | None = None


def get_pipeline() -> ProcessingPipeline:
    """Get or create the processing pipeline."""
    global _pipeline
    if _pipeline is None:
        _pipeline = ProcessingPipeline()
    return _pipeline


def clear_pipeline_cache():
    """Clear the pipeline singleton to force recreation with fresh settings."""
    global _pipeline
    _pipeline = None


class ProcessRequest(BaseModel):
    """Request to process a document."""

    step: str | None = None  # None = full pipeline, or specific step


class ProcessResult(BaseModel):
    """Result of a processing step."""

    doc_id: int
    step: str
    success: bool
    result: dict | None = None
    error: str | None = None
    needs_confirmation: bool = False
    confirmation_data: dict | None = None


def get_paperless_client(settings: Settings = Depends(get_settings)) -> PaperlessClient:
    """Get Paperless client dependency."""
    return PaperlessClient(settings.paperless_url, settings.paperless_token)


@router.post("/{doc_id}/start")
async def start_processing(
    doc_id: int,
    request: ProcessRequest,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Start processing a document (non-streaming).

    Pipeline Order: OCR → Correspondent → Document Type → Title → Tags
    """
    try:
        doc = await client.get_document(doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        # Pause auto-processing while manual processing is active
        worker = get_worker()
        worker.pause()

        try:
            pipeline = get_pipeline()

            if request.step:
                # Process a single step
                result = await pipeline.process_step(doc_id, request.step)
            else:
                # Process full pipeline
                result = await pipeline.process_document(doc_id)

            return {
                "status": "completed",
                "doc_id": doc_id,
                "step": request.step or "full_pipeline",
                "result": result,
            }
        finally:
            # Resume auto-processing
            worker.resume()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{doc_id}/stream")
async def stream_processing(
    doc_id: int,
    step: str | None = None,
    settings: Settings = Depends(get_settings),
):
    """Stream LLM processing output via Server-Sent Events.

    Pipeline Order: OCR → Correspondent → Document Type → Title → Tags

    This endpoint streams the full processing pipeline with real-time
    output from both the analysis (120B) and confirmation (20B) models.
    """

    async def event_generator() -> AsyncGenerator[str, None]:
        """Generate SSE events for processing."""
        # Pause auto-processing while streaming
        worker = get_worker()
        worker.pause()

        try:
            # Send initial event
            yield _sse_event(
                "start",
                {
                    "doc_id": doc_id,
                    "step": step or "full_pipeline",
                    "model": settings.ollama_model_large,
                },
            )

            pipeline = get_pipeline()

            # Use the streaming pipeline
            stream_gen = await pipeline.process_document(doc_id, stream=True)
            async for event in stream_gen:
                yield _sse_event(event.get("type", "event"), event)

        except Exception as e:
            yield _sse_event("error", {"message": str(e)})
        finally:
            # Resume auto-processing
            worker.resume()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{doc_id}/confirm")
async def confirm_processing(
    doc_id: int,
    confirmed: bool,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Confirm or reject a processing result that needs user approval."""
    try:
        # TODO: Implement confirmation handling
        return {
            "status": "confirmed" if confirmed else "rejected",
            "doc_id": doc_id,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/status")
async def get_processing_status(
    settings: Settings = Depends(get_settings),
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get current processing status including queue stats."""
    worker = get_worker()
    worker_status = worker.get_status()

    # Get queue stats from Paperless
    queue_stats = await client.get_queue_stats(
        tag_pending=settings.tag_pending,
        tag_ocr_done=settings.tag_ocr_done,
        tag_correspondent_done=settings.tag_correspondent_done,
        tag_document_type_done=settings.tag_document_type_done,
        tag_title_done=settings.tag_title_done,
        tag_tags_done=settings.tag_tags_done,
        tag_processed=settings.tag_processed,
    )

    return {
        **worker_status,
        "queue_stats": queue_stats,
    }


@router.post("/worker/start")
async def start_worker():
    """Start the background worker."""
    worker = get_worker()
    await worker.start()
    return {"status": "started", **worker.get_status()}


@router.post("/worker/stop")
async def stop_worker():
    """Stop the background worker."""
    worker = get_worker()
    await worker.stop()
    return {"status": "stopped", **worker.get_status()}


@router.post("/worker/pause")
async def pause_worker():
    """Pause the background worker."""
    worker = get_worker()
    worker.pause()
    return {"status": "paused", **worker.get_status()}


@router.post("/worker/resume")
async def resume_worker():
    """Resume the background worker."""
    worker = get_worker()
    worker.resume()
    return {"status": "resumed", **worker.get_status()}


def _sse_event(event_type: str, data: dict) -> str:
    """Format data as SSE event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
