"""FastAPI application for Paperless Local LLM."""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routers import documents, processing, prompts, settings
from worker import get_worker


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

    yield

    # Shutdown
    print("👋 Shutting down Paperless Local LLM Backend...")
    await worker.stop()


app = FastAPI(
    title="Paperless Local LLM",
    description="KI-gestütztes Dokumentenanalyse-System für Paperless-ngx",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(settings.router, prefix="/api/settings", tags=["Settings"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(processing.router, prefix="/api/processing", tags=["Processing"])
app.include_router(prompts.router, prefix="/api/prompts", tags=["Prompts"])


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
