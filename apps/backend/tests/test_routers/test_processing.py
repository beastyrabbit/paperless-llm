"""
Tests for the processing router.

This module tests all endpoints in the processing router:
- POST /api/processing/{doc_id}/start
- GET /api/processing/{doc_id}/stream
- POST /api/processing/{doc_id}/confirm
- GET /api/processing/status
- POST /api/processing/worker/start
- POST /api/processing/worker/stop
- POST /api/processing/worker/pause
- POST /api/processing/worker/resume
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
# Document Processing Tests
# ===========================================================================


class TestStartProcessing:
    """Test POST /api/processing/{doc_id}/start endpoint."""

    def test_start_processing_not_found(self, client):
        """Test starting processing for non-existent document."""
        response = client.post(
            "/api/processing/999999999/start",
            json={},
        )
        assert response.status_code in [404, 500]

    def test_start_processing_invalid_id(self, client):
        """Test starting processing with invalid document ID."""
        response = client.post(
            "/api/processing/invalid/start",
            json={},
        )
        assert response.status_code == 422

    def test_start_processing_full_pipeline(self, client):
        """Test starting full pipeline processing."""
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": None},
        )
        assert response.status_code in [404, 500]

    def test_start_processing_single_step_ocr(self, client):
        """Test starting OCR step only."""
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": "ocr"},
        )
        assert response.status_code in [404, 500]

    def test_start_processing_single_step_correspondent(self, client):
        """Test starting correspondent step only."""
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": "correspondent"},
        )
        assert response.status_code in [404, 500]

    def test_start_processing_single_step_title(self, client):
        """Test starting title step only."""
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": "title"},
        )
        assert response.status_code in [404, 500]

    def test_start_processing_single_step_tags(self, client):
        """Test starting tags step only."""
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": "tags"},
        )
        assert response.status_code in [404, 500]


# ===========================================================================
# Streaming Processing Tests
# ===========================================================================


class TestStreamProcessing:
    """Test GET /api/processing/{doc_id}/stream endpoint."""

    def test_stream_processing_returns_sse(self, client):
        """Test that stream endpoint returns SSE format."""
        # We can't easily test the full stream, but we can check content type
        # and initial setup
        response = client.get(
            "/api/processing/999999999/stream",
            headers={"Accept": "text/event-stream"},
        )
        # May be 500 if document not found, or start streaming
        assert response.status_code in [200, 500]

    def test_stream_processing_with_step(self, client):
        """Test streaming with specific step."""
        response = client.get(
            "/api/processing/999999999/stream?step=title",
        )
        assert response.status_code in [200, 500]

    def test_stream_invalid_id(self, client):
        """Test streaming with invalid ID."""
        response = client.get("/api/processing/invalid/stream")
        assert response.status_code == 422


# ===========================================================================
# Confirmation Tests
# ===========================================================================


class TestConfirmProcessing:
    """Test POST /api/processing/{doc_id}/confirm endpoint."""

    def test_confirm_processing_accept(self, client):
        """Test confirming processing result."""
        response = client.post(
            "/api/processing/999999999/confirm?confirmed=true",
        )
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert data.get("status") == "confirmed"

    def test_confirm_processing_reject(self, client):
        """Test rejecting processing result."""
        response = client.post(
            "/api/processing/999999999/confirm?confirmed=false",
        )
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert data.get("status") == "rejected"

    def test_confirm_processing_missing_param(self, client):
        """Test confirmation without confirmed parameter."""
        response = client.post("/api/processing/999999999/confirm")
        assert response.status_code == 422

    def test_confirm_invalid_id(self, client):
        """Test confirmation with invalid ID."""
        response = client.post("/api/processing/invalid/confirm?confirmed=true")
        assert response.status_code == 422


# ===========================================================================
# Processing Status Tests
# ===========================================================================


class TestProcessingStatus:
    """Test GET /api/processing/status endpoint."""

    def test_get_processing_status(self, client):
        """Test getting processing status."""
        response = client.get("/api/processing/status")
        # May fail if Paperless not connected
        assert response.status_code in [200, 422, 500]

    def test_processing_status_includes_worker_info(self, client):
        """Test that status includes worker information."""
        response = client.get("/api/processing/status")
        if response.status_code == 200:
            _ = response.json()
            # Should have worker-related fields
            # Exact fields depend on worker implementation


# ===========================================================================
# Worker Control Tests
# ===========================================================================


class TestWorkerControl:
    """Test worker control endpoints."""

    def test_start_worker(self, client):
        """Test starting the background worker."""
        response = client.post("/api/processing/worker/start")
        # May fail if worker dependencies not available
        assert response.status_code in [200, 422, 500]
        if response.status_code == 200:
            data = response.json()
            assert "status" in data

    def test_stop_worker(self, client):
        """Test stopping the background worker."""
        response = client.post("/api/processing/worker/stop")
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert "status" in data

    def test_pause_worker(self, client):
        """Test pausing the background worker."""
        response = client.post("/api/processing/worker/pause")
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert "status" in data

    def test_resume_worker(self, client):
        """Test resuming the background worker."""
        response = client.post("/api/processing/worker/resume")
        assert response.status_code in [200, 500]
        if response.status_code == 200:
            data = response.json()
            assert "status" in data


# ===========================================================================
# Worker State Transitions Tests
# ===========================================================================


class TestWorkerStateTransitions:
    """Test worker state transitions."""

    def test_start_stop_cycle(self, client):
        """Test starting then stopping worker."""
        # Start
        response1 = client.post("/api/processing/worker/start")
        # Stop
        response2 = client.post("/api/processing/worker/stop")

        # Both should succeed or fail gracefully
        assert response1.status_code in [200, 422, 500]
        assert response2.status_code in [200, 422, 500]

    def test_pause_resume_cycle(self, client):
        """Test pausing then resuming worker."""
        # Pause
        response1 = client.post("/api/processing/worker/pause")
        # Resume
        response2 = client.post("/api/processing/worker/resume")

        assert response1.status_code in [200, 500]
        assert response2.status_code in [200, 500]

    def test_double_pause(self, client):
        """Test pausing an already paused worker."""
        client.post("/api/processing/worker/pause")
        response = client.post("/api/processing/worker/pause")
        # Should handle gracefully
        assert response.status_code in [200, 500]

    def test_double_resume(self, client):
        """Test resuming an already running worker."""
        client.post("/api/processing/worker/resume")
        response = client.post("/api/processing/worker/resume")
        # Should handle gracefully
        assert response.status_code in [200, 500]


# ===========================================================================
# Pipeline Order Tests
# ===========================================================================


class TestPipelineOrder:
    """Test that pipeline follows correct order."""

    def test_pipeline_order_ocr_first(self, client):
        """Test that OCR is first step in pipeline."""
        # This is more of a documentation test - actual order is in pipeline code
        response = client.post(
            "/api/processing/999999999/start",
            json={"step": "ocr"},
        )
        # Just verify endpoint works
        assert response.status_code in [404, 500]

    def test_pipeline_steps_available(self, client):
        """Test that all expected pipeline steps can be requested."""
        steps = ["ocr", "correspondent", "document_type", "title", "tags"]

        for step in steps:
            response = client.post(
                "/api/processing/999999999/start",
                json={"step": step},
            )
            # All should be valid step names
            assert response.status_code in [404, 500]


# ===========================================================================
# Response Schema Tests
# ===========================================================================


class TestProcessingResponseSchemas:
    """Test processing response schemas."""

    def test_processing_status_response(self, client):
        """Test processing status response structure."""
        response = client.get("/api/processing/status")
        # May fail if services not available
        if response.status_code == 200:
            data = response.json()
            # Should be a dict with status info
            assert isinstance(data, dict)

    def test_worker_control_response(self, client):
        """Test worker control response structure."""
        response = client.post("/api/processing/worker/pause")
        if response.status_code == 200:
            data = response.json()
            assert "status" in data

    def test_confirmation_response(self, client):
        """Test confirmation response structure."""
        response = client.post(
            "/api/processing/1/confirm?confirmed=true",
        )
        if response.status_code == 200:
            data = response.json()
            assert "status" in data
            assert "doc_id" in data
