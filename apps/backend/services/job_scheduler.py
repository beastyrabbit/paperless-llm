"""Job Scheduler Service.

Manages scheduled execution of background jobs using APScheduler.
"""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from datetime import datetime
from typing import Any

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import get_settings

logger = logging.getLogger(__name__)


# Predefined schedule mappings
SCHEDULE_CRON_MAP = {
    "daily": "0 3 * * *",  # 3 AM daily
    "weekly": "0 3 * * 0",  # 3 AM on Sundays
    "monthly": "0 3 1 * *",  # 3 AM on 1st of month
}


class JobScheduler:
    """Background scheduler for system jobs.

    Wraps APScheduler to provide:
    - Schedule configuration from settings
    - Dynamic job updates without restart
    - Status tracking for next/last run times
    """

    def __init__(self) -> None:
        self.scheduler = AsyncIOScheduler()
        self._job_functions: dict[str, Callable[[], Coroutine[Any, Any, Any]]] = {}
        self._last_runs: dict[str, datetime] = {}
        self._last_results: dict[str, dict[str, Any]] = {}
        self._running = False

    async def start(self) -> None:
        """Start the scheduler with configured jobs."""
        if self._running:
            logger.warning("Scheduler already running")
            return

        settings = get_settings()

        # Register job functions (lazy import to avoid circular dependencies)
        from jobs.metadata_enhancement import MetadataEnhancementJob
        from jobs.schema_cleanup import SchemaCleanupJob

        async def run_schema_cleanup() -> dict[str, Any]:
            logger.info("Running scheduled schema cleanup job")
            job = SchemaCleanupJob()
            result = await job.run()
            self._last_runs["schema_cleanup"] = datetime.now()
            self._last_results["schema_cleanup"] = result
            logger.info(f"Schema cleanup completed: {result}")
            return result

        async def run_metadata_enhancement() -> dict[str, Any]:
            logger.info("Running scheduled metadata enhancement job")
            job = MetadataEnhancementJob()
            result = await job.run()
            self._last_runs["metadata_enhancement"] = datetime.now()
            self._last_results["metadata_enhancement"] = result
            logger.info(f"Metadata enhancement completed: {result}")
            return result

        self._job_functions["schema_cleanup"] = run_schema_cleanup
        self._job_functions["metadata_enhancement"] = run_metadata_enhancement

        # Schedule jobs based on settings
        if settings.schema_cleanup_enabled:
            self._schedule_job(
                "schema_cleanup",
                settings.schema_cleanup_schedule,
                settings.schema_cleanup_cron,
            )

        if settings.metadata_enhancement_enabled:
            self._schedule_job(
                "metadata_enhancement",
                settings.metadata_enhancement_schedule,
                settings.metadata_enhancement_cron,
            )

        self.scheduler.start()
        self._running = True
        logger.info("Job scheduler started")

    async def stop(self) -> None:
        """Gracefully stop the scheduler."""
        if not self._running:
            return

        self.scheduler.shutdown(wait=True)
        self._running = False
        logger.info("Job scheduler stopped")

    def _schedule_job(self, job_name: str, schedule_type: str, cron_expr: str) -> None:
        """Add or update a scheduled job.

        Args:
            job_name: Unique identifier for the job
            schedule_type: One of 'daily', 'weekly', 'monthly', 'cron'
            cron_expr: Cron expression (used if schedule_type is 'cron')
        """
        if job_name not in self._job_functions:
            logger.error(f"Unknown job: {job_name}")
            return

        # Remove existing job if present
        if self.scheduler.get_job(job_name):
            self.scheduler.remove_job(job_name)

        # Determine cron expression
        if schedule_type == "cron":
            cron = cron_expr
        else:
            cron = SCHEDULE_CRON_MAP.get(schedule_type, SCHEDULE_CRON_MAP["daily"])

        # Parse cron and create trigger
        try:
            trigger = CronTrigger.from_crontab(cron)
        except ValueError as e:
            logger.error(f"Invalid cron expression '{cron}' for {job_name}: {e}")
            return

        # Wrap async function for APScheduler
        job_func = self._job_functions[job_name]

        def sync_wrapper() -> None:
            asyncio.create_task(job_func())

        self.scheduler.add_job(
            sync_wrapper,
            trigger=trigger,
            id=job_name,
            name=job_name,
            replace_existing=True,
        )
        logger.info(f"Scheduled job '{job_name}' with cron '{cron}'")

    def update_job_schedule(
        self, job_name: str, enabled: bool, schedule_type: str, cron_expr: str
    ) -> bool:
        """Update a job's schedule dynamically.

        Args:
            job_name: Job identifier
            enabled: Whether the job should be scheduled
            schedule_type: Schedule type (daily, weekly, monthly, cron)
            cron_expr: Cron expression for custom schedules

        Returns:
            True if update was successful
        """
        if job_name not in self._job_functions:
            logger.error(f"Unknown job: {job_name}")
            return False

        # Remove existing job
        if self.scheduler.get_job(job_name):
            self.scheduler.remove_job(job_name)
            logger.info(f"Removed existing schedule for '{job_name}'")

        # Add new schedule if enabled
        if enabled:
            self._schedule_job(job_name, schedule_type, cron_expr)

        return True

    def get_next_run(self, job_name: str) -> datetime | None:
        """Get next scheduled run time for a job."""
        job = self.scheduler.get_job(job_name)
        if job and job.next_run_time:
            return job.next_run_time
        return None

    def get_last_run(self, job_name: str) -> datetime | None:
        """Get last run time for a job."""
        return self._last_runs.get(job_name)

    def get_last_result(self, job_name: str) -> dict[str, Any] | None:
        """Get last run result for a job."""
        return self._last_results.get(job_name)

    def get_status(self) -> dict[str, Any]:
        """Get status of all scheduled jobs."""
        settings = get_settings()

        return {
            "running": self._running,
            "jobs": {
                "schema_cleanup": {
                    "enabled": settings.schema_cleanup_enabled,
                    "schedule": settings.schema_cleanup_schedule,
                    "cron": settings.schema_cleanup_cron,
                    "next_run": self.get_next_run("schema_cleanup"),
                    "last_run": self.get_last_run("schema_cleanup"),
                    "last_result": self.get_last_result("schema_cleanup"),
                },
                "metadata_enhancement": {
                    "enabled": settings.metadata_enhancement_enabled,
                    "schedule": settings.metadata_enhancement_schedule,
                    "cron": settings.metadata_enhancement_cron,
                    "next_run": self.get_next_run("metadata_enhancement"),
                    "last_run": self.get_last_run("metadata_enhancement"),
                    "last_result": self.get_last_result("metadata_enhancement"),
                },
            },
        }

    async def run_job_now(self, job_name: str) -> dict[str, Any] | None:
        """Run a job immediately (manual trigger).

        Returns the job result or None if job not found.
        """
        if job_name not in self._job_functions:
            logger.error(f"Unknown job: {job_name}")
            return None

        logger.info(f"Manual trigger for job '{job_name}'")
        return await self._job_functions[job_name]()


# Singleton instance
_scheduler: JobScheduler | None = None


def get_job_scheduler() -> JobScheduler:
    """Get the job scheduler singleton."""
    global _scheduler
    if _scheduler is None:
        _scheduler = JobScheduler()
    return _scheduler
