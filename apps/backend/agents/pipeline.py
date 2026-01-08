"""Document Processing Pipeline orchestrating all agents.

Pipeline Order: OCR → Schema Analysis → Correspondent → Document Type → Title → Tags → Custom Fields
"""

import json
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Any

from agents.correspondent_agent import CorrespondentAgent
from agents.custom_fields_agent import CustomFieldsAgent
from agents.document_type_agent import DocumentTypeAgent
from agents.ocr_agent import OCRAgent
from agents.tags_agent import TagsAgent
from agents.title_agent import TitleAgent
from config import get_settings
from models.document import ProcessingState
from services.paperless import PaperlessClient
from services.qdrant import QdrantService

if TYPE_CHECKING:
    from agents.schema_analysis_agent import SchemaAnalysisAgent


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


class ProcessingPipeline:
    """Orchestrates document processing through all agents.

    Pipeline Order: OCR → Schema Analysis → Correspondent → Document Type → Title → Tags → Custom Fields

    Optional: After OCR, if vector_search_enabled, embed content into Qdrant.
    Optional: After OCR, if schema_analysis_enabled, analyze document for schema improvements.
    """

    def __init__(self, mock_ocr: bool = False):
        self.settings = get_settings()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.ocr_agent = OCRAgent(mock_mode=mock_ocr)
        self.correspondent_agent = CorrespondentAgent()
        self.document_type_agent = DocumentTypeAgent()
        self.title_agent = TitleAgent()
        self.tags_agent = TagsAgent()
        self.custom_fields_agent = CustomFieldsAgent()

        # Optional schema analysis agent
        self.schema_analysis_agent: "SchemaAnalysisAgent | None" = None  # noqa: UP037
        if self.settings.schema_analysis_enabled:
            from agents.schema_analysis_agent import SchemaAnalysisAgent

            self.schema_analysis_agent = SchemaAnalysisAgent()

        # Optional Qdrant service for vector search
        self.qdrant: QdrantService | None = None
        if self.settings.vector_search_enabled:
            self.qdrant = QdrantService(
                qdrant_url=self.settings.qdrant_url,
                collection_name=self.settings.qdrant_collection,
                ollama_url=self.settings.ollama_url,
                embedding_model=self.settings.ollama_embedding_model,
            )

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

        Order: OCR → Schema Analysis → Correspondent → Document Type → Title → Tags → Custom Fields
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

        # Step 2: Schema Analysis (optional, after OCR)
        if current_state == ProcessingState.OCR_DONE and self.schema_analysis_agent:
            result = await self.schema_analysis_agent.process(doc_id, content)
            results["steps"]["schema_analysis"] = result

            if result.get("has_suggestions"):
                # Queue suggestions for review with next_tag tracking
                await self._queue_schema_suggestions(
                    doc_id, result, next_tag=self.settings.tag_schema_analysis_done
                )

                # Apply schema review tag and remove OCR done tag
                await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_ocr_done)
                await self.paperless.add_tag_to_document(doc_id, self.settings.tag_schema_review)

                results["needs_review"] = True
                results["schema_review_needed"] = True
                return results

            # No suggestions - skip schema review, continue to next step
            await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_ocr_done)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_schema_analysis_done)
            current_state = ProcessingState.SCHEMA_ANALYSIS_DONE
        elif current_state == ProcessingState.OCR_DONE:
            # Skip schema analysis if not enabled - move to next state
            current_state = ProcessingState.SCHEMA_ANALYSIS_DONE

        # Step 2.5: Check if waiting for schema review
        if current_state == ProcessingState.SCHEMA_REVIEW:
            # Document is parked for schema review - pipeline should not run until reviews are complete
            results["needs_review"] = True
            results["schema_review_needed"] = True
            return results

        # Step 3: Correspondent
        if current_state == ProcessingState.SCHEMA_ANALYSIS_DONE:
            result = await self.correspondent_agent.process(doc_id, content)
            results["steps"]["correspondent"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.CORRESPONDENT_DONE

        # Step 4: Document Type
        if current_state == ProcessingState.CORRESPONDENT_DONE:
            result = await self.document_type_agent.process(doc_id, content)
            results["steps"]["document_type"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.DOCUMENT_TYPE_DONE

        # Step 5: Title
        if current_state == ProcessingState.DOCUMENT_TYPE_DONE:
            result = await self.title_agent.process(doc_id, content)
            results["steps"]["title"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.TITLE_DONE

        # Step 6: Tags
        if current_state == ProcessingState.TITLE_DONE:
            # Get document type and current tags for context
            doc = await self.paperless.get_document(doc_id)
            doc_type_id = doc.get("document_type") if doc else None
            doc_type_name = None
            if doc_type_id:
                doc_types = await self.paperless.get_document_types()
                doc_type_map = {dt["id"]: dt["name"] for dt in doc_types}
                doc_type_name = doc_type_map.get(doc_type_id)
            current_tag_ids = doc.get("tags", []) if doc else []

            result = await self.tags_agent.process(
                doc_id,
                content,
                document_type=doc_type_name,
                current_tag_ids=current_tag_ids,
            )
            results["steps"]["tags"] = result
            if result.get("needs_review"):
                results["needs_review"] = True
                return results
            current_state = ProcessingState.TAGS_DONE

        # Step 7: Custom Fields (if enabled)
        if current_state == ProcessingState.TAGS_DONE:
            if self.settings.pipeline_custom_fields:
                result = await self.custom_fields_agent.process(doc_id, content)
                results["steps"]["custom_fields"] = result
                if result.get("needs_review"):
                    results["needs_review"] = True
                    return results
                # Update tags
                await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_tags_done)
                await self.paperless.add_tag_to_document(
                    doc_id, self.settings.tag_custom_fields_done
                )
            current_state = ProcessingState.CUSTOM_FIELDS_DONE

        # Complete
        if current_state == ProcessingState.CUSTOM_FIELDS_DONE:
            # Mark as fully processed
            final_tag = (
                self.settings.tag_custom_fields_done
                if self.settings.pipeline_custom_fields
                else self.settings.tag_tags_done
            )
            await self.paperless.remove_tag_from_document(doc_id, final_tag)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_processed)
            results["steps"]["complete"] = {"success": True}

        return results

    async def _process_stream(self, doc_id: int) -> AsyncGenerator[dict, None]:
        """Process document with streaming output.

        Order: OCR → Schema Analysis → Correspondent → Document Type → Title → Tags → Custom Fields
        """
        yield {"type": "pipeline_start", "doc_id": doc_id}

        doc = await self.paperless.get_document(doc_id)
        if not doc:
            yield {"type": "error", "message": "Document not found"}
            return

        tag_names = [t["name"] for t in doc.get("tags_data", [])]
        current_state = self._get_current_state(tag_names)
        content = doc.get("content", "")

        # #region agent log
        _debug_log(
            "pipeline.py:stream:init",
            "Pipeline initialized",
            {
                "doc_id": doc_id,
                "current_state": current_state.name,
                "tags": tag_names,
                "content_length": len(content),
            },
            "H1",
        )
        # #endregion

        # Step 1: OCR
        if current_state == ProcessingState.PENDING:
            # #region agent log
            _debug_log("pipeline.py:ocr:start", "Starting OCR step", {"doc_id": doc_id}, "H1")
            # #endregion
            yield {"type": "step_start", "step": "ocr"}
            try:
                result = await self.ocr_agent.process(doc_id)
                # #region agent log
                _debug_log(
                    "pipeline.py:ocr:complete",
                    "OCR step complete",
                    {
                        "doc_id": doc_id,
                        "success": result.get("success"),
                        "text_length": result.get("text_length", 0),
                    },
                    "H1",
                )
                # #endregion
                yield {"type": "step_complete", "step": "ocr", "result": result}
                if not result.get("success"):
                    yield {"type": "error", "step": "ocr", "message": "OCR failed"}
                    return
                doc = await self.paperless.get_document(doc_id)
                content = doc.get("content", "") if doc else ""

                # Optional: Embed into Qdrant for vector search
                if self.qdrant and content:
                    try:
                        # #region agent log
                        _debug_log(
                            "pipeline.py:qdrant:start",
                            "Starting Qdrant embedding",
                            {"doc_id": doc_id},
                            "H2",
                        )
                        # #endregion
                        yield {"type": "step_start", "step": "vector_embed"}
                        await self.qdrant.initialize()
                        await self.qdrant.add_document(
                            doc_id=doc_id,
                            content=content,
                            metadata={
                                "title": doc["title"] if doc else f"Document {doc_id}",
                                "original_filename": doc.get("original_file_name") if doc else None,
                            },
                        )
                        # #region agent log
                        _debug_log(
                            "pipeline.py:qdrant:complete",
                            "Qdrant embedding complete",
                            {"doc_id": doc_id},
                            "H2",
                        )
                        # #endregion
                        yield {
                            "type": "step_complete",
                            "step": "vector_embed",
                            "result": {"success": True},
                        }
                    except Exception as embed_error:
                        # #region agent log
                        _debug_log(
                            "pipeline.py:qdrant:error",
                            "Qdrant embedding failed",
                            {"doc_id": doc_id, "error": str(embed_error)},
                            "H2",
                        )
                        # #endregion
                        # Vector embedding is optional - log but don't fail the pipeline
                        yield {
                            "type": "warning",
                            "step": "vector_embed",
                            "message": f"Vector embedding skipped: {embed_error}",
                        }

                current_state = ProcessingState.OCR_DONE
            except Exception as e:
                # #region agent log
                _debug_log(
                    "pipeline.py:ocr:error",
                    "OCR step failed",
                    {"doc_id": doc_id, "error": str(e)},
                    "H1",
                )
                # #endregion
                yield {"type": "error", "step": "ocr", "message": str(e)}
                return

        # Step 2: Schema Analysis (optional, after OCR)
        if current_state == ProcessingState.OCR_DONE:
            if self.schema_analysis_agent:
                yield {"type": "step_start", "step": "schema_analysis"}
                try:
                    result = await self.schema_analysis_agent.process(doc_id, content)

                    if result.get("has_suggestions"):
                        # Queue suggestions for review with next_tag tracking
                        await self._queue_schema_suggestions(
                            doc_id, result, next_tag=self.settings.tag_schema_analysis_done
                        )

                        # Apply schema review tag and remove OCR done tag
                        await self.paperless.remove_tag_from_document(
                            doc_id, self.settings.tag_ocr_done
                        )
                        await self.paperless.add_tag_to_document(
                            doc_id, self.settings.tag_schema_review
                        )

                        yield {
                            "type": "schema_review_needed",
                            "step": "schema_analysis",
                            "result": result,
                        }

                        yield {"type": "pipeline_paused", "reason": "schema_review_needed"}
                        return  # Stop pipeline here - resume after schema review

                    # No suggestions - continue to next step
                    yield {"type": "step_complete", "step": "schema_analysis", "result": result}

                    # Update tags to mark schema analysis as done
                    await self.paperless.remove_tag_from_document(
                        doc_id, self.settings.tag_ocr_done
                    )
                    await self.paperless.add_tag_to_document(
                        doc_id, self.settings.tag_schema_analysis_done
                    )
                except Exception as e:
                    # Schema analysis is optional - log warning but continue pipeline
                    yield {
                        "type": "warning",
                        "step": "schema_analysis",
                        "message": f"Schema analysis skipped: {e}",
                    }
            # Move to next state (whether schema analysis ran or not)
            current_state = ProcessingState.SCHEMA_ANALYSIS_DONE

        # Step 2.5: Check if waiting for schema review
        if current_state == ProcessingState.SCHEMA_REVIEW:
            yield {"type": "pipeline_paused", "reason": "schema_review_needed"}
            return  # Document is parked for schema review

        # Step 3: Correspondent
        if current_state == ProcessingState.SCHEMA_ANALYSIS_DONE:
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

        # Step 4: Document Type
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

        # Step 5: Title
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

        # Step 6: Tags
        if current_state == ProcessingState.TITLE_DONE:
            yield {"type": "step_start", "step": "tags"}
            try:
                # Get document type and current tags for context
                doc = await self.paperless.get_document(doc_id)
                doc_type_id = doc.get("document_type") if doc else None
                doc_type_name = None
                if doc_type_id:
                    doc_types = await self.paperless.get_document_types()
                    doc_type_map = {dt["id"]: dt["name"] for dt in doc_types}
                    doc_type_name = doc_type_map.get(doc_type_id)
                current_tag_ids = doc.get("tags", []) if doc else []

                result = await self.tags_agent.process(
                    doc_id,
                    content,
                    document_type=doc_type_name,
                    current_tag_ids=current_tag_ids,
                )
                yield {"type": "step_complete", "step": "tags", "result": result}
                if result.get("needs_review"):
                    yield {"type": "needs_review", "step": "tags", "result": result}
                    return
                current_state = ProcessingState.TAGS_DONE
            except Exception as e:
                yield {"type": "error", "step": "tags", "message": str(e)}
                return

        # Step 7: Custom Fields (if enabled)
        if current_state == ProcessingState.TAGS_DONE:
            if self.settings.pipeline_custom_fields:
                yield {"type": "step_start", "step": "custom_fields"}
                try:
                    result = await self.custom_fields_agent.process(doc_id, content)
                    yield {"type": "step_complete", "step": "custom_fields", "result": result}
                    if result.get("needs_review"):
                        yield {"type": "needs_review", "step": "custom_fields", "result": result}
                        return
                    # Update tags
                    await self.paperless.remove_tag_from_document(
                        doc_id, self.settings.tag_tags_done
                    )
                    await self.paperless.add_tag_to_document(
                        doc_id, self.settings.tag_custom_fields_done
                    )
                except Exception as e:
                    yield {"type": "error", "step": "custom_fields", "message": str(e)}
                    return
            current_state = ProcessingState.CUSTOM_FIELDS_DONE

        # Complete
        if current_state == ProcessingState.CUSTOM_FIELDS_DONE:
            final_tag = (
                self.settings.tag_custom_fields_done
                if self.settings.pipeline_custom_fields
                else self.settings.tag_tags_done
            )
            await self.paperless.remove_tag_from_document(doc_id, final_tag)
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
            # Get document type and current tags for context
            doc_type_id = doc.get("document_type") if doc else None
            doc_type_name = None
            if doc_type_id:
                doc_types = await self.paperless.get_document_types()
                doc_type_map = {dt["id"]: dt["name"] for dt in doc_types}
                doc_type_name = doc_type_map.get(doc_type_id)
            current_tag_ids = doc.get("tags", []) if doc else []

            return await self.tags_agent.process(
                doc_id,
                content,
                document_type=doc_type_name,
                current_tag_ids=current_tag_ids,
            )
        elif step == "schema_analysis":
            if self.schema_analysis_agent:
                return await self.schema_analysis_agent.process(doc_id, content)
            return {"success": True, "skipped": True, "reason": "Schema analysis not enabled"}
        elif step == "custom_fields":
            return await self.custom_fields_agent.process(doc_id, content)
        else:
            return {"success": False, "error": f"Unknown step: {step}"}

    def _get_current_state(self, tag_names: list[str]) -> ProcessingState:
        """Determine current processing state from tags.

        Order: PENDING → OCR_DONE → SCHEMA_REVIEW → SCHEMA_ANALYSIS_DONE → CORRESPONDENT_DONE → DOCUMENT_TYPE_DONE → TITLE_DONE → TAGS_DONE → CUSTOM_FIELDS_DONE → PROCESSED
        """
        if self.settings.tag_processed in tag_names:
            return ProcessingState.PROCESSED
        if self.settings.tag_custom_fields_done in tag_names:
            return ProcessingState.CUSTOM_FIELDS_DONE
        if self.settings.tag_tags_done in tag_names:
            return ProcessingState.TAGS_DONE
        if self.settings.tag_title_done in tag_names:
            return ProcessingState.TITLE_DONE
        if self.settings.tag_document_type_done in tag_names:
            return ProcessingState.DOCUMENT_TYPE_DONE
        if self.settings.tag_correspondent_done in tag_names:
            return ProcessingState.CORRESPONDENT_DONE
        if self.settings.tag_schema_analysis_done in tag_names:
            return ProcessingState.SCHEMA_ANALYSIS_DONE
        if self.settings.tag_schema_review in tag_names:
            return ProcessingState.SCHEMA_REVIEW  # Parked for schema review
        if self.settings.tag_ocr_done in tag_names:
            return ProcessingState.OCR_DONE
        if self.settings.tag_pending in tag_names:
            return ProcessingState.PENDING
        return ProcessingState.PENDING

    async def _queue_schema_suggestions(
        self, doc_id: int, result: dict, next_tag: str | None = None
    ) -> None:
        """Queue schema suggestions for user review.

        Args:
            doc_id: The document ID
            result: Schema analysis result with suggestions
            next_tag: Tag to apply when all schema reviews for this doc are complete
        """
        from services.pending_reviews import get_pending_reviews_service

        pending = get_pending_reviews_service()
        doc = await self.paperless.get_document(doc_id)
        doc_title = doc.get("title", f"Document {doc_id}") if doc else f"Document {doc_id}"

        for suggestion in result.get("suggestions", []):
            # Only queue suggestions meeting minimum confidence
            confidence = suggestion.get("confidence", 0)
            if confidence < self.settings.schema_analysis_min_confidence:
                continue

            pending.add(
                doc_id=doc_id,
                doc_title=doc_title,
                item_type=f"schema_{suggestion['entity_type']}",
                suggestion=suggestion["suggested_name"],
                reasoning=suggestion["reasoning"],
                alternatives=suggestion.get("similar_to_existing", []),
                metadata={
                    "entity_type": suggestion["entity_type"],
                    "confidence": confidence,
                },
                next_tag=next_tag,
            )
