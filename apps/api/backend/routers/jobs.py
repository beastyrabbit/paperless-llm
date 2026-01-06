"""API router for background job management."""

from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from jobs.metadata_enhancement import MetadataEnhancementJob
from jobs.schema_cleanup import SchemaCleanupJob


class JobStatus(BaseModel):
    """Status of a background job."""

    job_name: str
    status: str  # "idle", "running", "completed", "failed"
    last_run: str | None = None
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
