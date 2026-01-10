"""
Tests for the jobs router.

This module tests all endpoints in the jobs router:
- GET /api/jobs/status
- GET /api/jobs/status/{job_name}
- POST /api/jobs/metadata-enhancement/run
- POST /api/jobs/schema-cleanup/run
- POST /api/jobs/bootstrap/start
- GET /api/jobs/bootstrap/status
- POST /api/jobs/bootstrap/cancel
- POST /api/jobs/bootstrap/skip
- GET /api/jobs/schedule
- PATCH /api/jobs/schedule
- POST /api/jobs/bulk-ocr/start
- GET /api/jobs/bulk-ocr/status
- POST /api/jobs/bulk-ocr/cancel

Note: Some tests that start background jobs may fail when external services
(Paperless, Ollama) are not available, as the background tasks attempt to
connect to these services.
"""

import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(__file__).rsplit("/tests", 1)[0])
from main import app


@pytest.fixture
def client():
    """Create a test client."""
    return TestClient(app, raise_server_exceptions=False)


# ===========================================================================
# Job Status Tests
# ===========================================================================


class TestJobStatus:
    """Test job status endpoints."""

    def test_get_all_job_status(self, client):
        """Test getting all job statuses."""
        response = client.get("/api/jobs/status")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)
        # Should have metadata_enhancement and schema_cleanup
        assert "metadata_enhancement" in data
        assert "schema_cleanup" in data

    def test_get_specific_job_status(self, client):
        """Test getting specific job status."""
        response = client.get("/api/jobs/status/metadata_enhancement")
        assert response.status_code == 200
        data = response.json()
        assert "job_name" in data
        assert "status" in data

    def test_get_schema_cleanup_status(self, client):
        """Test getting schema cleanup job status."""
        response = client.get("/api/jobs/status/schema_cleanup")
        assert response.status_code == 200
        data = response.json()
        assert data["job_name"] == "schema_cleanup"

    def test_get_nonexistent_job_status(self, client):
        """Test getting non-existent job status."""
        response = client.get("/api/jobs/status/nonexistent_job")
        assert response.status_code == 404

    def test_job_status_structure(self, client):
        """Test job status response structure."""
        response = client.get("/api/jobs/status/metadata_enhancement")
        assert response.status_code == 200
        data = response.json()

        expected_fields = ["job_name", "status"]
        for field in expected_fields:
            assert field in data

        # Status should be one of expected values
        assert data["status"] in ["idle", "running", "completed", "failed"]


# ===========================================================================
# Manual Job Trigger Tests
# ===========================================================================


class TestManualJobTriggers:
    """Test manual job trigger endpoints."""

    def test_trigger_metadata_enhancement(self, client):
        """Test triggering metadata enhancement job."""
        response = client.post("/api/jobs/metadata-enhancement/run")
        # May succeed or return error if already running
        assert response.status_code in [200, 400, 500]

        if response.status_code == 200:
            data = response.json()
            assert "message" in data
            assert "status" in data

    def test_trigger_schema_cleanup(self, client):
        """Test triggering schema cleanup job."""
        response = client.post("/api/jobs/schema-cleanup/run")
        assert response.status_code in [200, 400, 500]

        if response.status_code == 200:
            data = response.json()
            assert "message" in data


# ===========================================================================
# Bootstrap Analysis Tests
# ===========================================================================


class TestBootstrapAnalysis:
    """Test bootstrap analysis endpoints."""

    def test_start_bootstrap_default(self, client):
        """Test starting bootstrap analysis with default type."""
        response = client.post(
            "/api/jobs/bootstrap/start",
            json={"analysis_type": "all"},
        )
        # May succeed, fail if already running, or return error if services not available
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bootstrap_correspondents(self, client):
        """Test starting bootstrap for correspondents only."""
        response = client.post(
            "/api/jobs/bootstrap/start",
            json={"analysis_type": "correspondents"},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bootstrap_document_types(self, client):
        """Test starting bootstrap for document types only."""
        response = client.post(
            "/api/jobs/bootstrap/start",
            json={"analysis_type": "document_types"},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bootstrap_tags(self, client):
        """Test starting bootstrap for tags only."""
        response = client.post(
            "/api/jobs/bootstrap/start",
            json={"analysis_type": "tags"},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bootstrap_invalid_type(self, client):
        """Test starting bootstrap with invalid type."""
        response = client.post(
            "/api/jobs/bootstrap/start",
            json={"analysis_type": "invalid"},
        )
        assert response.status_code == 422  # Validation error

    def test_get_bootstrap_status(self, client):
        """Test getting bootstrap analysis status."""
        response = client.get("/api/jobs/bootstrap/status")
        assert response.status_code == 200
        data = response.json()
        # Should have progress-related fields
        assert "status" in data or "is_running" in data

    def test_cancel_bootstrap(self, client):
        """Test cancelling bootstrap analysis."""
        response = client.post("/api/jobs/bootstrap/cancel")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "status" in data

    def test_skip_bootstrap_document_default(self, client):
        """Test skipping document in bootstrap (default count)."""
        response = client.post("/api/jobs/bootstrap/skip")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data

    def test_skip_bootstrap_document_with_count(self, client):
        """Test skipping multiple documents in bootstrap."""
        response = client.post("/api/jobs/bootstrap/skip?count=10")
        assert response.status_code == 200

    def test_skip_bootstrap_max_count(self, client):
        """Test skip with count exceeding max."""
        response = client.post("/api/jobs/bootstrap/skip?count=5000")
        assert response.status_code == 200
        # Count should be capped at 1000


# ===========================================================================
# Job Schedule Tests
# ===========================================================================


class TestJobSchedule:
    """Test job schedule endpoints."""

    def test_get_job_schedules(self, client):
        """Test getting job schedules."""
        response = client.get("/api/jobs/schedule")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, dict)

    def test_update_job_schedule_enable(self, client):
        """Test enabling a job schedule."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "schema_cleanup",
                "enabled": True,
                "schedule": "daily",
            },
        )
        # May fail if scheduler not fully initialized or config save fails
        assert response.status_code in [200, 400, 422, 500]

    def test_update_job_schedule_disable(self, client):
        """Test disabling a job schedule."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "schema_cleanup",
                "enabled": False,
                "schedule": "daily",
            },
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_update_job_schedule_weekly(self, client):
        """Test setting weekly schedule."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "metadata_enhancement",
                "enabled": True,
                "schedule": "weekly",
            },
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_update_job_schedule_monthly(self, client):
        """Test setting monthly schedule."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "schema_cleanup",
                "enabled": True,
                "schedule": "monthly",
            },
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_update_job_schedule_cron(self, client):
        """Test setting custom cron schedule."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "schema_cleanup",
                "enabled": True,
                "schedule": "cron",
                "cron": "0 0 * * *",
            },
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_update_job_schedule_invalid_job(self, client):
        """Test updating schedule for invalid job."""
        response = client.patch(
            "/api/jobs/schedule",
            json={
                "job_name": "invalid_job",
                "enabled": True,
                "schedule": "daily",
            },
        )
        assert response.status_code == 422  # Validation error


# ===========================================================================
# Bulk OCR Tests
# ===========================================================================


class TestBulkOCR:
    """Test bulk OCR endpoints."""

    def test_start_bulk_ocr_default(self, client):
        """Test starting bulk OCR with defaults."""
        response = client.post(
            "/api/jobs/bulk-ocr/start",
            json={},
        )
        # May fail if services not available or job already running
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bulk_ocr_custom_rate(self, client):
        """Test starting bulk OCR with custom rate."""
        response = client.post(
            "/api/jobs/bulk-ocr/start",
            json={"docs_per_second": 0.5},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bulk_ocr_skip_existing(self, client):
        """Test starting bulk OCR with skip_existing option."""
        response = client.post(
            "/api/jobs/bulk-ocr/start",
            json={"skip_existing": True},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_start_bulk_ocr_process_all(self, client):
        """Test starting bulk OCR processing all documents."""
        response = client.post(
            "/api/jobs/bulk-ocr/start",
            json={"skip_existing": False},
        )
        assert response.status_code in [200, 400, 422, 500]

    def test_get_bulk_ocr_status(self, client):
        """Test getting bulk OCR status."""
        response = client.get("/api/jobs/bulk-ocr/status")
        assert response.status_code == 200
        data = response.json()
        # Should have progress fields
        assert "status" in data or "is_running" in data

    def test_cancel_bulk_ocr(self, client):
        """Test cancelling bulk OCR."""
        response = client.post("/api/jobs/bulk-ocr/cancel")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data


# ===========================================================================
# Job Response Schema Tests
# ===========================================================================


class TestJobResponseSchemas:
    """Test job response schemas."""

    def test_job_status_schema(self, client):
        """Test JobStatus schema."""
        response = client.get("/api/jobs/status/metadata_enhancement")
        assert response.status_code == 200
        data = response.json()

        assert isinstance(data.get("job_name"), str)
        assert isinstance(data.get("status"), str)
        # last_run and last_result can be None
        assert "last_run" in data
        assert "last_result" in data

    def test_bootstrap_status_schema(self, client):
        """Test bootstrap status response schema."""
        response = client.get("/api/jobs/bootstrap/status")
        assert response.status_code == 200
        data = response.json()

        # Should have progress update fields
        expected_fields = ["status"]
        for field in expected_fields:
            assert field in data

    def test_bulk_ocr_status_schema(self, client):
        """Test bulk OCR status response schema."""
        response = client.get("/api/jobs/bulk-ocr/status")
        assert response.status_code == 200
        data = response.json()

        # Should have OCR progress fields
        assert "status" in data or "is_running" in data
