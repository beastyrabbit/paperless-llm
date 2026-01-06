"""Documents API endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from config import Settings, get_settings
from services.paperless import PaperlessClient

router = APIRouter()


class DocumentSummary(BaseModel):
    """Document summary for list view."""

    id: int
    title: str
    correspondent: str | None
    created: str
    tags: list[str]
    processing_status: str | None


class DocumentDetail(BaseModel):
    """Full document details."""

    id: int
    title: str
    correspondent: str | None
    correspondent_id: int | None
    created: str
    modified: str
    added: str
    tags: list[dict]
    custom_fields: list[dict]
    content: str | None
    original_file_name: str | None
    archive_serial_number: int | None


class QueueStats(BaseModel):
    """Processing queue statistics."""

    pending: int
    ocr_done: int
    correspondent_done: int
    document_type_done: int
    title_done: int
    tags_done: int
    processed: int
    total_in_pipeline: int
    total_documents: int


def get_paperless_client(settings: Settings = Depends(get_settings)) -> PaperlessClient:
    """Get Paperless client dependency."""
    return PaperlessClient(settings.paperless_url, settings.paperless_token)


@router.get("/queue", response_model=QueueStats)
async def get_queue_stats(
    client: PaperlessClient = Depends(get_paperless_client),
    settings: Settings = Depends(get_settings),
):
    """Get document processing queue statistics."""
    try:
        stats = await client.get_queue_stats(
            tag_pending=settings.tag_pending,
            tag_ocr_done=settings.tag_ocr_done,
            tag_correspondent_done=settings.tag_correspondent_done,
            tag_document_type_done=settings.tag_document_type_done,
            tag_title_done=settings.tag_title_done,
            tag_tags_done=settings.tag_tags_done,
            tag_processed=settings.tag_processed,
        )
        return QueueStats(**stats)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pending", response_model=list[DocumentSummary])
async def get_pending_documents(
    tag: str = Query(default=None, description="Filter by specific tag"),
    limit: int = Query(default=50, le=100),
    client: PaperlessClient = Depends(get_paperless_client),
    settings: Settings = Depends(get_settings),
):
    """Get documents pending processing."""
    try:
        filter_tag = tag or settings.tag_pending
        docs = await client.get_documents_by_tag(filter_tag, limit=limit)
        return [
            DocumentSummary(
                id=doc["id"],
                title=doc["title"],
                correspondent=doc.get("correspondent_name"),
                created=doc["created"],
                tags=[t["name"] for t in doc.get("tags_data", [])],
                processing_status=_get_processing_status(doc, settings),
            )
            for doc in docs
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{doc_id}", response_model=DocumentDetail)
async def get_document(
    doc_id: int,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get detailed document information."""
    try:
        doc = await client.get_document(doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return DocumentDetail(
            id=doc["id"],
            title=doc["title"],
            correspondent=doc.get("correspondent_name"),
            correspondent_id=doc.get("correspondent"),
            created=doc["created"],
            modified=doc["modified"],
            added=doc["added"],
            tags=doc.get("tags_data", []),
            custom_fields=doc.get("custom_fields", []),
            content=doc.get("content"),
            original_file_name=doc.get("original_file_name"),
            archive_serial_number=doc.get("archive_serial_number"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{doc_id}/content")
async def get_document_content(
    doc_id: int,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Get document OCR content."""
    try:
        doc = await client.get_document(doc_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        return {"id": doc_id, "content": doc.get("content", "")}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{doc_id}/pdf")
async def get_document_pdf(
    doc_id: int,
    client: PaperlessClient = Depends(get_paperless_client),
):
    """Proxy PDF from Paperless for frontend embedding."""
    try:
        pdf_bytes = await client.download_pdf(doc_id)
        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={"Content-Disposition": f"inline; filename=document_{doc_id}.pdf"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _get_processing_status(doc: dict, settings: Settings) -> str | None:
    """Determine the current processing status based on tags."""
    tag_names = [t["name"] for t in doc.get("tags_data", [])]

    if settings.tag_processed in tag_names:
        return "processed"
    if settings.tag_tags_done in tag_names:
        return "tags_done"
    if settings.tag_title_done in tag_names:
        return "title_done"
    if settings.tag_document_type_done in tag_names:
        return "document_type_done"
    if settings.tag_correspondent_done in tag_names:
        return "correspondent_done"
    if settings.tag_ocr_done in tag_names:
        return "ocr_done"
    if settings.tag_pending in tag_names:
        return "pending"
    return None
