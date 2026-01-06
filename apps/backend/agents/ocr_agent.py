"""OCR Agent using Mistral AI."""

import base64
import json
from typing import Any

import httpx
from mistralai import Mistral

from config import get_settings
from services.paperless import PaperlessClient

# Threshold for switching to file upload method (pages)
MAX_PAGES_FOR_BASE64 = 60


# #region agent log
def _debug_log(location: str, message: str, data: dict, hypothesis_id: str = ""):
    import os

    log_path = "/mnt/storage/workspace/projects/paperless_local_llm/.cursor/debug.log"
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "a") as f:
        f.write(
            json.dumps(
                {
                    "location": location,
                    "message": message,
                    "data": data,
                    "hypothesisId": hypothesis_id,
                    "timestamp": __import__("time").time(),
                }
            )
            + "\n"
        )


# #endregion


class OCRAgent:
    """Agent for OCR processing using Mistral AI.

    This agent handles ONLY the OCR step:
    1. Download PDF from Paperless
    2. Send to Mistral OCR API
    3. Update Paperless document content (if needed)
    4. Update document tags

    Note: Qdrant vector embedding is handled separately by the pipeline
    when vector_search_enabled is True.
    """

    def __init__(self, mock_mode: bool = False):
        self.settings = get_settings()
        self.mock_mode = mock_mode
        if not mock_mode:
            self.mistral = Mistral(api_key=self.settings.mistral_api_key)
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )

    async def process(self, doc_id: int) -> dict[str, Any]:
        """Process a document with OCR.

        Steps:
        1. Check if document already has content (skip OCR if so)
        2. Download PDF from Paperless
        3. Send to Mistral OCR API
        4. Update document tags

        Returns:
            Dict with OCR results and status
        """
        # #region agent log
        _debug_log(
            "ocr_agent.py:process:start",
            "Starting OCR",
            {"doc_id": doc_id, "mock_mode": self.mock_mode},
            "H1",
        )
        # #endregion

        # Mock mode: use existing content, skip Mistral API
        if self.mock_mode:
            doc = await self.paperless.get_document(doc_id)
            existing_content = doc.get("content", "") if doc else ""
            # #region agent log
            _debug_log(
                "ocr_agent.py:process:mock",
                "Mock mode - using existing content",
                {"doc_id": doc_id, "content_length": len(existing_content)},
                "H1",
            )
            # #endregion

            # Update tags: remove pending, add ocr-done
            await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_pending)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_ocr_done)

            return {
                "doc_id": doc_id,
                "success": True,
                "text_length": len(existing_content),
                "pages": 1,
                "mock": True,
            }

        # Download PDF
        pdf_bytes = await self.paperless.download_pdf(doc_id)
        # #region agent log
        _debug_log(
            "ocr_agent.py:process:downloaded",
            "PDF downloaded",
            {"doc_id": doc_id, "pdf_size": len(pdf_bytes)},
            "H1",
        )
        # #endregion

        # Always run Mistral OCR - it provides better quality than Paperless built-in OCR
        ocr_result = await self._run_mistral_ocr(pdf_bytes)
        # #region agent log
        _debug_log(
            "ocr_agent.py:process:ocr_done",
            "Mistral OCR complete",
            {
                "doc_id": doc_id,
                "text_length": len(ocr_result.get("text", "")),
                "pages": ocr_result.get("pages", 0),
            },
            "H1",
        )
        # #endregion

        # Update tags: remove pending, add ocr-done
        await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_pending)
        await self.paperless.add_tag_to_document(doc_id, self.settings.tag_ocr_done)
        # #region agent log
        _debug_log(
            "ocr_agent.py:process:tags_updated",
            "Tags updated",
            {
                "doc_id": doc_id,
                "removed": self.settings.tag_pending,
                "added": self.settings.tag_ocr_done,
            },
            "H1",
        )
        # #endregion

        return {
            "doc_id": doc_id,
            "success": True,
            "text_length": len(ocr_result["text"]),
            "pages": ocr_result.get("pages", 1),
        }

    async def _run_mistral_ocr(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Run Mistral OCR on a PDF document.

        Uses Mistral's dedicated OCR API for document processing.
        For PDFs > 60 pages, uses file upload method instead of base64.
        """
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")

        # Try the base64 method first (simpler, works for most documents)
        response = self.mistral.ocr.process(
            model=self.settings.mistral_model,
            document={
                "type": "document_url",
                "document_url": f"data:application/pdf;base64,{pdf_base64}",
            },
            include_image_base64=True,
        )

        # Check if we need to use file upload method for large documents
        if len(response.pages) > MAX_PAGES_FOR_BASE64:
            print(f"Document has {len(response.pages)} pages, using file upload method")
            return await self._run_mistral_ocr_with_upload(pdf_bytes)

        # Extract text from OCR response
        extracted_text = ""
        pages = 0
        for page in response.pages:
            extracted_text += page.markdown + "\n\n"
            pages += 1

        return {
            "text": extracted_text.strip(),
            "pages": pages,
        }

    async def _run_mistral_ocr_with_upload(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Run Mistral OCR using file upload method for large PDFs."""
        # Upload PDF to Mistral files API
        async with httpx.AsyncClient(timeout=60.0) as client:
            # Step 1: Upload file
            upload_response = await client.post(
                "https://api.mistral.ai/v1/files",
                headers={"Authorization": f"Bearer {self.settings.mistral_api_key}"},
                files={"file": ("document.pdf", pdf_bytes, "application/pdf")},
                data={"purpose": "ocr"},
            )
            upload_response.raise_for_status()
            file_id = upload_response.json()["id"]

            # Step 2: Get signed URL
            url_response = await client.get(
                f"https://api.mistral.ai/v1/files/{file_id}/url?expiry=24",
                headers={
                    "Authorization": f"Bearer {self.settings.mistral_api_key}",
                    "Accept": "application/json",
                },
            )
            url_response.raise_for_status()
            signed_url = url_response.json()["url"]

        # Step 3: Call OCR with signed URL
        response = self.mistral.ocr.process(
            model=self.settings.mistral_model,
            document={
                "type": "document_url",
                "document_url": signed_url,
            },
            include_image_base64=True,
        )

        # Extract text from OCR response
        extracted_text = ""
        pages = 0
        for page in response.pages:
            extracted_text += page.markdown + "\n\n"
            pages += 1

        return {
            "text": extracted_text.strip(),
            "pages": pages,
        }
