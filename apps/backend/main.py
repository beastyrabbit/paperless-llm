"""FastAPI application for Paperless Local LLM."""

import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import get_settings
from routers import (
    documents,
    jobs,
    metadata,
    pending,
    processing,
    prompts,
    schema,
    settings,
    translation,
)
from services.job_scheduler import get_job_scheduler
from worker import get_worker

# Ensure logs directory exists
os.makedirs("logs", exist_ok=True)

# Configure logging with both console and file output
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        RotatingFileHandler(
            "logs/backend.log",
            maxBytes=10 * 1024 * 1024,  # 10MB per file
            backupCount=5,  # Keep 5 backup files
        ),
    ],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    # Startup
    print("🚀 Starting Paperless Local LLM Backend...")
    settings_instance = get_settings()
    print(f"   Paperless URL: {settings_instance.paperless_url}")
    print(f"   Ollama URL: {settings_instance.ollama_url}")
    print(f"   Qdrant URL: {settings_instance.qdrant_url}")
    print(f"   Auto-Processing: {settings_instance.auto_processing_enabled}")
    print("   Pipeline: OCR → Correspondent → Document Type → Title → Tags")

    # Start background worker if auto-processing is enabled
    worker = get_worker()
    if settings_instance.auto_processing_enabled:
        print("   Starting background worker...")
        await worker.start()

    # Start job scheduler
    scheduler = get_job_scheduler()
    print("   Starting job scheduler...")
    await scheduler.start()

    yield

    # Shutdown
    print("👋 Shutting down Paperless Local LLM Backend...")
    await scheduler.stop()
    await worker.stop()


app = FastAPI(
    title="Paperless Local LLM",
    description="KI-gestütztes Dokumentenanalyse-System für Paperless-ngx",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for Next.js frontend
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Global exception handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch all unhandled exceptions and log them."""
    logger.error(f"Unhandled exception on {request.method} {request.url.path}")
    logger.error(f"Exception type: {type(exc).__name__}")
    logger.error(f"Exception message: {exc}")
    logger.error(f"Traceback:\n{traceback.format_exc()}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


# Request logging middleware
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests."""
    logger.debug(f"Request: {request.method} {request.url.path}")
    try:
        response = await call_next(request)
        logger.debug(f"Response: {request.method} {request.url.path} - {response.status_code}")
        return response
    except Exception as e:
        logger.error(f"Request failed: {request.method} {request.url.path}")
        logger.error(f"Error: {type(e).__name__}: {e}")
        logger.error(f"Traceback:\n{traceback.format_exc()}")
        raise


# Include routers
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(processing.router, prefix="/api/processing", tags=["Processing"])
app.include_router(prompts.router, prefix="/api/prompts", tags=["Prompts"])
app.include_router(pending.router, prefix="/api/pending", tags=["Pending Reviews"])
app.include_router(metadata.router, prefix="/api/metadata", tags=["Metadata"])
app.include_router(translation.router, prefix="/api/translation", tags=["Translation"])
app.include_router(schema.router, prefix="/api/schema", tags=["Schema"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["Jobs"])


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "name": "Paperless Local LLM",
        "version": "0.1.0",
        "status": "running",
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "healthy"}
