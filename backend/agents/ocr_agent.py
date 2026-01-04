"""OCR Agent using Mistral AI."""

import base64
from typing import Any

from mistralai import Mistral

from config import get_settings
from services.paperless import PaperlessClient
from services.qdrant import QdrantService


class OCRAgent:
    """Agent for OCR processing using Mistral AI."""

    def __init__(self):
        self.settings = get_settings()
        self.mistral = Mistral(api_key=self.settings.mistral_api_key)
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.qdrant = QdrantService(
            qdrant_url=self.settings.qdrant_url,
            collection_name=self.settings.qdrant_collection,
            ollama_url=self.settings.ollama_url,
        )

    async def process(self, doc_id: int) -> dict[str, Any]:
        """Process a document with OCR.

        Steps:
        1. Download PDF from Paperless
        2. Send to Mistral OCR API
        3. Store OCR text in Qdrant
        4. Update document tags

        Returns:
            Dict with OCR results and status
        """
        # Download PDF
        pdf_bytes = await self.paperless.download_pdf(doc_id)

        # Encode for Mistral API
        pdf_base64 = base64.b64encode(pdf_bytes).decode("utf-8")

        # Run OCR with Mistral
        ocr_result = await self._run_mistral_ocr(pdf_base64)

        # Get document info for metadata
        doc = await self.paperless.get_document(doc_id)

        # Store in Qdrant
        await self.qdrant.initialize()
        await self.qdrant.add_document(
            doc_id=doc_id,
            content=ocr_result["text"],
            metadata={
                "title": doc["title"] if doc else f"Document {doc_id}",
                "original_filename": doc.get("original_file_name") if doc else None,
            },
        )

        # Update tags: remove pending, add ocr-done
        await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_pending)
        await self.paperless.add_tag_to_document(doc_id, self.settings.tag_ocr_done)

        return {
            "doc_id": doc_id,
            "success": True,
            "text_length": len(ocr_result["text"]),
            "pages": ocr_result.get("pages", 1),
        }

    async def _run_mistral_ocr(self, pdf_base64: str) -> dict[str, Any]:
        """Run Mistral OCR on a PDF document.

        Uses Mistral's dedicated OCR API for document processing.
        """
        # Try the dedicated OCR API first (mistral-ocr-latest)
        try:
            # Use Mistral's OCR capability via the files/ocr endpoint
            response = self.mistral.files.ocr(
                model=self.settings.mistral_model,
                document={
                    "type": "document_url",
                    "document_url": f"data:application/pdf;base64,{pdf_base64}",
                },
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
        except Exception:
            # Fallback to chat completion with vision model
            response = self.mistral.chat.complete(
                model="pixtral-large-latest",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": "Extract all text from this document. Preserve the structure and formatting as much as possible. Include headers, paragraphs, lists, tables, and any other text content. Output as markdown.",
                            },
                            {
                                "type": "image_url",
                                "image_url": f"data:application/pdf;base64,{pdf_base64}",
                            },
                        ],
                    }
                ],
            )

            extracted_text = response.choices[0].message.content

            return {
                "text": extracted_text,
                "pages": 1,
            }

    async def get_similar_documents(
        self,
        content: str,
        k: int = 5,
    ) -> list[dict[str, Any]]:
        """Find similar documents based on content."""
        await self.qdrant.initialize()
        return await self.qdrant.search_similar(query=content, k=k)
