"""Document Processing Pipeline orchestrating all agents.

Pipeline Order: OCR → Correspondent → Document Type → Title → Tags → Custom Fields
"""

from collections.abc import AsyncGenerator
from typing import Any

from agents.correspondent_agent import CorrespondentAgent
from agents.document_type_agent import DocumentTypeAgent
from agents.ocr_agent import OCRAgent
from agents.tags_agent import TagsAgent
from agents.title_agent import TitleAgent
from config import get_settings
from models.document import ProcessingState
from services.paperless import PaperlessClient


class ProcessingPipeline:
    """Orchestrates document processing through all agents.

    Pipeline Order: OCR → Correspondent → Document Type → Title → Tags
    """

    def __init__(self):
        self.settings = get_settings()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.ocr_agent = OCRAgent()
        self.correspondent_agent = CorrespondentAgent()
        self.document_type_agent = DocumentTypeAgent()
        self.title_agent = TitleAgent()
        self.tags_agent = TagsAgent()

    async def process_document(
        self,
        doc_id: int,
        stream: bool = False,
    ) -> dict[str, Any] | AsyncGenerator[dict, None]:
        """Process a document through the full pipeline.

        Args:
            doc_id: Document ID to process
            stream: Whether to stream processing output

        Returns:
            Final result or async generator if streaming
        """
        if stream:
            return self._process_stream(doc_id)
        return await self._process_sync(doc_id)

    async def _process_sync(self, doc_id: int) -> dict[str, Any]:
        """Process document synchronously.

        Order: OCR → Correspondent → Document Type → Title → Tags
        """
        results = {
            "doc_id": doc_id,
            "steps": {},
            "success": True,
            "needs_review": False,
        }

        # Determine current state
        doc = await self.paperless.get_document(doc_id)
        if not doc:
            return {"doc_id": doc_id, "success": False, "error": "Document not found"}

        tag_names = [t["name"] for t in doc.get("tags_data", [])]
        current_state = self._get_current_state(tag_names)

        content = doc.get("content", "")

        # Step 1: OCR
        if current_state == ProcessingState.PENDING:
            result = await self.ocr_agent.process(doc_id)
            results["steps"]["ocr"] = result
            if not result.get("success"):
                results["success"] = False
                return results
            # Refresh content after OCR
            doc = await self.paperless.get_document(doc_id)
            content = doc.get("content", "") if doc else ""
            current_state = ProcessingState.OCR_DONE

        # Step 2: Correspondent
        if current_state == ProcessingState.OCR_DONE:
            result = await self.correspondent_agent.process(doc_id, content)
            results["steps"]["correspondent"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.CORRESPONDENT_DONE

        # Step 3: Document Type
        if current_state == ProcessingState.CORRESPONDENT_DONE:
            result = await self.document_type_agent.process(doc_id, content)
            results["steps"]["document_type"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.DOCUMENT_TYPE_DONE

        # Step 4: Title
        if current_state == ProcessingState.DOCUMENT_TYPE_DONE:
            result = await self.title_agent.process(doc_id, content)
            results["steps"]["title"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.TITLE_DONE

        # Step 5: Tags
        if current_state == ProcessingState.TITLE_DONE:
            result = await self.tags_agent.process(doc_id, content)
            results["steps"]["tags"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.TAGS_DONE

        # Complete
        if current_state == ProcessingState.TAGS_DONE:
            # Mark as fully processed
            await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_tags_done)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_processed)
            results["steps"]["complete"] = {"success": True}

        return results

    async def _process_stream(self, doc_id: int) -> AsyncGenerator[dict, None]:
        """Process document with streaming output.

        Order: OCR → Correspondent → Document Type → Title → Tags
        """
        yield {"type": "pipeline_start", "doc_id": doc_id}

        doc = await self.paperless.get_document(doc_id)
        if not doc:
            yield {"type": "error", "message": "Document not found"}
            return

        tag_names = [t["name"] for t in doc.get("tags_data", [])]
        current_state = self._get_current_state(tag_names)
        content = doc.get("content", "")

        # Step 1: OCR
        if current_state == ProcessingState.PENDING:
            yield {"type": "step_start", "step": "ocr"}
            try:
                result = await self.ocr_agent.process(doc_id)
                yield {"type": "step_complete", "step": "ocr", "result": result}
                if not result.get("success"):
                    yield {"type": "error", "step": "ocr", "message": "OCR failed"}
                    return
                doc = await self.paperless.get_document(doc_id)
                content = doc.get("content", "") if doc else ""
                current_state = ProcessingState.OCR_DONE
            except Exception as e:
                yield {"type": "error", "step": "ocr", "message": str(e)}
                return

        # Step 2: Correspondent
        if current_state == ProcessingState.OCR_DONE:
            yield {"type": "step_start", "step": "correspondent"}
            try:
                result = await self.correspondent_agent.process(doc_id, content)
                yield {"type": "step_complete", "step": "correspondent", "result": result}
                if result.get("needs_review"):
                    yield {"type": "needs_review", "step": "correspondent", "result": result}
                    return
                current_state = ProcessingState.CORRESPONDENT_DONE
            except Exception as e:
                yield {"type": "error", "step": "correspondent", "message": str(e)}
                return

        # Step 3: Document Type
        if current_state == ProcessingState.CORRESPONDENT_DONE:
            yield {"type": "step_start", "step": "document_type"}
            try:
                result = await self.document_type_agent.process(doc_id, content)
                yield {"type": "step_complete", "step": "document_type", "result": result}
                if result.get("needs_review"):
                    yield {"type": "needs_review", "step": "document_type", "result": result}
                    return
                current_state = ProcessingState.DOCUMENT_TYPE_DONE
            except Exception as e:
                yield {"type": "error", "step": "document_type", "message": str(e)}
                return

        # Step 4: Title
        if current_state == ProcessingState.DOCUMENT_TYPE_DONE:
            yield {"type": "step_start", "step": "title"}
            try:
                result = await self.title_agent.process(doc_id, content)
                yield {"type": "step_complete", "step": "title", "result": result}
                if result.get("needs_review"):
                    yield {"type": "needs_review", "step": "title", "result": result}
                    return
                current_state = ProcessingState.TITLE_DONE
            except Exception as e:
                yield {"type": "error", "step": "title", "message": str(e)}
                return

        # Step 5: Tags
        if current_state == ProcessingState.TITLE_DONE:
            yield {"type": "step_start", "step": "tags"}
            try:
                result = await self.tags_agent.process(doc_id, content)
                yield {"type": "step_complete", "step": "tags", "result": result}
                if result.get("needs_review"):
                    yield {"type": "needs_review", "step": "tags", "result": result}
                    return
                current_state = ProcessingState.TAGS_DONE
            except Exception as e:
                yield {"type": "error", "step": "tags", "message": str(e)}
                return

        # Complete
        if current_state == ProcessingState.TAGS_DONE:
            await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_tags_done)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_processed)
            yield {"type": "pipeline_complete", "doc_id": doc_id, "success": True}

    async def process_step(
        self,
        doc_id: int,
        step: str,
    ) -> dict[str, Any]:
        """Process a single step for a document.

        Args:
            doc_id: Document ID
            step: Step name (ocr, correspondent, document_type, title, tags)

        Returns:
            Step result
        """
        doc = await self.paperless.get_document(doc_id)
        if not doc:
            return {"success": False, "error": "Document not found"}

        content = doc.get("content", "")

        if step == "ocr":
            return await self.ocr_agent.process(doc_id)
        elif step == "correspondent":
            return await self.correspondent_agent.process(doc_id, content)
        elif step == "document_type":
            return await self.document_type_agent.process(doc_id, content)
        elif step == "title":
            return await self.title_agent.process(doc_id, content)
        elif step == "tags":
            return await self.tags_agent.process(doc_id, content)
        else:
            return {"success": False, "error": f"Unknown step: {step}"}

    def _get_current_state(self, tag_names: list[str]) -> ProcessingState:
        """Determine current processing state from tags.

        Order: PENDING → OCR_DONE → CORRESPONDENT_DONE → DOCUMENT_TYPE_DONE → TITLE_DONE → TAGS_DONE → PROCESSED
        """
        if self.settings.tag_processed in tag_names:
            return ProcessingState.PROCESSED
        if self.settings.tag_tags_done in tag_names:
            return ProcessingState.TAGS_DONE
        if self.settings.tag_title_done in tag_names:
            return ProcessingState.TITLE_DONE
        if self.settings.tag_document_type_done in tag_names:
            return ProcessingState.DOCUMENT_TYPE_DONE
        if self.settings.tag_correspondent_done in tag_names:
            return ProcessingState.CORRESPONDENT_DONE
        if self.settings.tag_ocr_done in tag_names:
            return ProcessingState.OCR_DONE
        if self.settings.tag_pending in tag_names:
            return ProcessingState.PENDING
        return ProcessingState.PENDING
