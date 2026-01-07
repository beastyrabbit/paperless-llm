"""API router for background job management."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from jobs.bootstrap_analysis import BootstrapAnalysisJob, ProgressUpdate
from jobs.bulk_ocr import BulkOCRJob, BulkOCRProgress
from jobs.metadata_enhancement import MetadataEnhancementJob
from jobs.schema_cleanup import SchemaCleanupJob
from services.job_scheduler import get_job_scheduler


class JobStatus(BaseModel):
    """Status of a background job."""

    job_name: str
    status: str  # "idle", "running", "completed", "failed"
    last_run: str | None = None
    last_result: dict | None = None


class BootstrapStartRequest(BaseModel):
    """Request to start bootstrap analysis."""

    analysis_type: Literal["all", "correspondents", "document_types", "tags"] = "all"


class BulkOCRStartRequest(BaseModel):
    """Request to start bulk OCR processing."""

    docs_per_second: float = 1.0
    skip_existing: bool = True


class ScheduleUpdateRequest(BaseModel):
    """Request to update job schedule."""

    job_name: Literal["schema_cleanup", "metadata_enhancement"]
    enabled: bool
    schedule: Literal["daily", "weekly", "monthly", "cron"]
    cron: str | None = None


class ScheduleInfo(BaseModel):
    """Schedule information for a job."""

    enabled: bool
    schedule: str
    cron: str
    next_run: datetime | None = None
    last_run: datetime | None = None
    last_result: dict | None = None


# Track job status in memory (could be moved to database later)
_job_status: dict[str, JobStatus] = {
    "metadata_enhancement": JobStatus(job_name="metadata_enhancement", status="idle"),
    "schema_cleanup": JobStatus(job_name="schema_cleanup", status="idle"),
}


router = APIRouter()


async def run_metadata_enhancement_job():
    """Background task for metadata enhancement."""
    global _job_status
    try:
        _job_status["metadata_enhancement"].status = "running"
        job = MetadataEnhancementJob()
        result = await job.run()
        _job_status["metadata_enhancement"].status = "completed"
        _job_status["metadata_enhancement"].last_run = datetime.now().isoformat()
        _job_status["metadata_enhancement"].last_result = result
    except Exception as e:
        _job_status["metadata_enhancement"].status = "failed"
        _job_status["metadata_enhancement"].last_result = {"error": str(e)}


async def run_schema_cleanup_job():
    """Background task for schema cleanup."""
    global _job_status
    try:
        _job_status["schema_cleanup"].status = "running"
        job = SchemaCleanupJob()
        result = await job.run()
        _job_status["schema_cleanup"].status = "completed"
        _job_status["schema_cleanup"].last_run = datetime.now().isoformat()
        _job_status["schema_cleanup"].last_result = result
    except Exception as e:
        _job_status["schema_cleanup"].status = "failed"
        _job_status["schema_cleanup"].last_result = {"error": str(e)}


async def run_bootstrap_analysis(analysis_type: str):
    """Background task for bootstrap analysis."""
    job = BootstrapAnalysisJob(analysis_type=analysis_type)  # type: ignore
    await job.run()


# =============================================================================
# General Job Status Endpoints
# =============================================================================


@router.get("/status")
async def get_all_job_status() -> dict[str, JobStatus]:
    """Get status of all background jobs."""
    return _job_status


@router.get("/status/{job_name}")
async def get_job_status(job_name: str) -> JobStatus:
    """Get status of a specific job."""
    if job_name not in _job_status:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    return _job_status[job_name]


# =============================================================================
# Manual Job Triggers
# =============================================================================


@router.post("/metadata-enhancement/run")
async def trigger_metadata_enhancement(
    background_tasks: BackgroundTasks,
) -> dict:
    """Trigger the metadata enhancement job."""
    if _job_status["metadata_enhancement"].status == "running":
        raise HTTPException(status_code=400, detail="Job is already running")

    background_tasks.add_task(run_metadata_enhancement_job)
    return {"message": "Metadata enhancement job started", "status": "running"}


@router.post("/schema-cleanup/run")
async def trigger_schema_cleanup(
    background_tasks: BackgroundTasks,
) -> dict:
    """Trigger the schema cleanup job."""
    if _job_status["schema_cleanup"].status == "running":
        raise HTTPException(status_code=400, detail="Job is already running")

    background_tasks.add_task(run_schema_cleanup_job)
    return {"message": "Schema cleanup job started", "status": "running"}


# =============================================================================
# Bootstrap Analysis Endpoints
# =============================================================================


@router.post("/bootstrap/start")
async def start_bootstrap_analysis(
    request: BootstrapStartRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Start bootstrap analysis of all documents.

    This will analyze all documents in Paperless to suggest schema improvements.
    Results are queued to pending reviews for user approval.
    """
    if await BootstrapAnalysisJob.is_running():
        raise HTTPException(
            status_code=400,
            detail="Bootstrap analysis is already running",
        )

    background_tasks.add_task(run_bootstrap_analysis, request.analysis_type)

    return {
        "message": f"Bootstrap analysis started (type: {request.analysis_type})",
        "analysis_type": request.analysis_type,
        "status": "running",
    }


@router.get("/bootstrap/status")
async def get_bootstrap_status() -> ProgressUpdate:
    """Get current bootstrap analysis status and progress."""
    return await BootstrapAnalysisJob.get_status()


@router.post("/bootstrap/cancel")
async def cancel_bootstrap_analysis() -> dict:
    """Cancel the currently running bootstrap analysis."""
    cancelled = await BootstrapAnalysisJob.cancel_current()

    if cancelled:
        return {"message": "Bootstrap analysis cancellation requested", "status": "cancelling"}

    return {"message": "No running bootstrap analysis to cancel", "status": "idle"}


@router.post("/bootstrap/skip")
async def skip_current_document(count: int = 1) -> dict:
    """Skip document(s) in bootstrap analysis.

    Args:
        count: Number of documents to skip (default 1, max 1000)
    """
    # Limit count to prevent abuse
    count = max(1, min(count, 1000))

    skipped = await BootstrapAnalysisJob.skip_current_document(count)

    if skipped:
        return {
            "message": f"Skip requested for {count} document(s)",
            "status": "skipping",
            "count": count,
        }

    return {"message": "No running bootstrap analysis to skip", "status": "idle"}


# =============================================================================
# Job Schedule Configuration Endpoints
# =============================================================================


@router.get("/schedule")
async def get_job_schedules() -> dict:
    """Get scheduled jobs configuration and status."""
    scheduler = get_job_scheduler()
    return scheduler.get_status()


@router.patch("/schedule")
async def update_job_schedule(request: ScheduleUpdateRequest) -> dict:
    """Update a job's schedule configuration.

    This updates both the runtime scheduler and persists to config.
    """
    from config import get_settings, save_settings

    scheduler = get_job_scheduler()
    settings = get_settings()

    # Determine cron expression
    cron_expr = request.cron if request.schedule == "cron" and request.cron else ""
    if request.schedule != "cron":
        # Use predefined schedule
        from services.job_scheduler import SCHEDULE_CRON_MAP

        cron_expr = SCHEDULE_CRON_MAP.get(request.schedule, SCHEDULE_CRON_MAP["daily"])

    # Update scheduler
    success = scheduler.update_job_schedule(
        job_name=request.job_name,
        enabled=request.enabled,
        schedule_type=request.schedule,
        cron_expr=cron_expr,
    )

    if not success:
        raise HTTPException(
            status_code=400, detail=f"Failed to update schedule for {request.job_name}"
        )

    # Persist to settings
    if request.job_name == "schema_cleanup":
        settings.schema_cleanup_enabled = request.enabled
        settings.schema_cleanup_schedule = request.schedule
        if request.cron:
            settings.schema_cleanup_cron = request.cron
    elif request.job_name == "metadata_enhancement":
        settings.metadata_enhancement_enabled = request.enabled
        settings.metadata_enhancement_schedule = request.schedule
        if request.cron:
            settings.metadata_enhancement_cron = request.cron

    # Save settings
    save_settings(settings)

    return {
        "message": f"Schedule updated for {request.job_name}",
        "job_name": request.job_name,
        "enabled": request.enabled,
        "schedule": request.schedule,
        "cron": cron_expr,
        "next_run": scheduler.get_next_run(request.job_name),
    }


# =============================================================================
# Bulk OCR Endpoints
# =============================================================================


async def run_bulk_ocr(docs_per_second: float, skip_existing: bool):
    """Background task for bulk OCR processing."""
    job = BulkOCRJob(docs_per_second=docs_per_second, skip_existing=skip_existing)
    await job.run()


@router.post("/bulk-ocr/start")
async def start_bulk_ocr(
    request: BulkOCRStartRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Start bulk OCR processing of all documents.

    This will run OCR on all documents using Mistral AI.
    Documents that already have content can be skipped.
    """
    if BulkOCRJob.is_running():
        raise HTTPException(
            status_code=400,
            detail="Bulk OCR is already running",
        )

    background_tasks.add_task(run_bulk_ocr, request.docs_per_second, request.skip_existing)

    return {
        "message": f"Bulk OCR started ({request.docs_per_second} docs/sec)",
        "docs_per_second": request.docs_per_second,
        "skip_existing": request.skip_existing,
        "status": "running",
    }


@router.get("/bulk-ocr/status")
async def get_bulk_ocr_status() -> BulkOCRProgress:
    """Get current bulk OCR status and progress."""
    return BulkOCRJob.get_current_progress()


@router.post("/bulk-ocr/cancel")
async def cancel_bulk_ocr() -> dict:
    """Cancel the currently running bulk OCR job."""
    cancelled = BulkOCRJob.cancel()

    if cancelled:
        return {"message": "Bulk OCR cancellation requested", "status": "cancelling"}

    return {"message": "No running bulk OCR job to cancel", "status": "idle"}
