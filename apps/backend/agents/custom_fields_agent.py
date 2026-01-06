"""Custom Fields Agent for extracting structured data from documents."""

from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from agents.prompts import load_prompt
from config import get_settings
from models.analysis import ConfirmationResult, CustomFieldsAnalysis
from services.paperless import PaperlessClient
from services.qdrant import QdrantService


class CustomFieldsAgent:
    """Agent for extracting custom field values from documents."""

    def __init__(self):
        self.settings = get_settings()
        self.large_model = get_large_model()
        self.small_model = get_small_model()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        # Qdrant is optional - only used for similar document context
        self.qdrant: QdrantService | None = None
        if self.settings.vector_search_enabled:
            self.qdrant = QdrantService(
                qdrant_url=self.settings.qdrant_url,
                collection_name=self.settings.qdrant_collection,
                ollama_url=self.settings.ollama_url,
                embedding_model=self.settings.ollama_embedding_model,
            )

    async def process(self, doc_id: int, content: str) -> dict[str, Any]:
        """Process document to extract custom field values.

        Args:
            doc_id: Document ID
            content: OCR content

        Returns:
            Result dict with custom field values
        """
        # Get custom field definitions
        custom_fields = await self.paperless.get_custom_fields()
        if not custom_fields:
            # No custom fields defined, skip this step
            return {
                "doc_id": doc_id,
                "success": True,
                "skipped": True,
                "reason": "No custom fields defined in Paperless",
            }

        # Get document's current document type for context
        doc = await self.paperless.get_document(doc_id)
        document_type = None
        if doc and doc.get("document_type"):
            document_type = await self.paperless.get_document_type_name(doc["document_type"])

        # Get similar documents (optional)
        similar_docs: list[dict] = []
        if self.qdrant:
            try:
                await self.qdrant.initialize()
                similar_docs = await self.qdrant.search_similar(content[:2000], k=5)
            except Exception:
                # Continue without similar docs - not critical
                pass

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Analyze custom fields
            analysis = await self._analyze_custom_fields(
                content,
                custom_fields,
                document_type,
                similar_docs,
                feedback,
            )

            # If no fields suggested, we're done
            if not analysis.suggested_fields:
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "fields": [],
                    "reasoning": analysis.reasoning,
                    "attempts": attempt + 1,
                }

            # Confirm with smaller model
            confirmation = await self._confirm_custom_fields(content, analysis)

            if confirmation.confirmed:
                result = await self._apply_custom_fields(doc_id, analysis, custom_fields)
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "fields": [f.model_dump() for f in analysis.suggested_fields],
                    "reasoning": analysis.reasoning,
                    "attempts": attempt + 1,
                    **result,
                }

            feedback = confirmation.feedback

        # Needs review - but for custom fields we don't block the pipeline
        return {
            "doc_id": doc_id,
            "success": True,  # Still success, just not applied
            "needs_review": True,
            "suggested_fields": [f.model_dump() for f in analysis.suggested_fields],
            "reasoning": analysis.reasoning,
            "last_feedback": feedback,
            "attempts": max_retries,
        }

    async def _analyze_custom_fields(
        self,
        content: str,
        custom_fields: list[dict],
        document_type: str | None,
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> CustomFieldsAnalysis:
        """Analyze document to extract custom field values."""
        prompt_template = load_prompt("custom_fields") or self._default_prompt()

        # Format custom fields with their types
        fields_info = []
        for field in custom_fields:
            field_type = field.get("data_type", "string")
            fields_info.append(f"- ID: {field['id']}, Name: {field['name']}, Type: {field_type}")
        fields_list = "\n".join(fields_info)

        # Format similar docs with their custom fields
        similar_info = []
        for doc in similar_docs[:3]:
            doc_fields = doc.get("metadata", {}).get("custom_fields", [])
            if doc_fields:
                fields_str = ", ".join(f"{f.get('name')}: {f.get('value')}" for f in doc_fields)
                similar_info.append(f"- {doc['metadata'].get('title', 'Unknown')}: {fields_str}")

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            document_type=document_type or "Unknown",
            custom_fields=fields_list or "No custom fields defined.",
            similar_docs="\n".join(similar_info) if similar_info else "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.large_model.with_structured_output(CustomFieldsAnalysis)
        return await structured_model.ainvoke(messages)

    async def _confirm_custom_fields(
        self,
        content: str,
        analysis: CustomFieldsAnalysis,
    ) -> ConfirmationResult:
        """Confirm custom fields with smaller model."""
        confirmation_prompt = load_prompt("confirmation") or self._default_confirmation_prompt()

        # Format analysis result
        fields_summary = "\n".join(
            f"- {f.field_name}: {f.value} (Reason: {f.reasoning})"
            for f in analysis.suggested_fields
        )

        analysis_result = f"""**Suggested Custom Fields:**
{fields_summary if fields_summary else "No fields suggested"}

**Overall Reasoning:** {analysis.reasoning}"""

        # Format the prompt with variables
        formatted_prompt = confirmation_prompt.format(
            analysis_result=analysis_result,
            document_excerpt=content[:1500],
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.small_model.with_structured_output(ConfirmationResult)
        return await structured_model.ainvoke(messages)

    async def _apply_custom_fields(
        self,
        doc_id: int,
        analysis: CustomFieldsAnalysis,
        custom_fields: list[dict],
    ) -> dict[str, Any]:
        """Apply custom field values to document."""
        # Get current document custom fields
        doc = await self.paperless.get_document(doc_id)
        current_fields = doc.get("custom_fields", []) if doc else []

        # Build field ID mapping
        field_id_to_def = {f["id"]: f for f in custom_fields}

        # Update custom fields
        updated_fields = []
        for field_value in analysis.suggested_fields:
            field_def = field_id_to_def.get(field_value.field_id)
            if not field_def:
                continue

            # Find or create field entry
            found = False
            for cf in current_fields:
                if cf.get("field") == field_value.field_id:
                    cf["value"] = field_value.value
                    found = True
                    break

            if not found:
                current_fields.append(
                    {
                        "field": field_value.field_id,
                        "value": field_value.value,
                    }
                )

            updated_fields.append(field_value.field_name)

        # Update document
        if updated_fields:
            await self.paperless.update_document(doc_id, custom_fields=current_fields)

        return {
            "applied": bool(updated_fields),
            "updated_fields": updated_fields,
        }

    def _default_prompt(self) -> str:
        return """You are a document data extraction specialist. Extract structured information into custom fields.

Document Type: {document_type}

## Available Custom Fields

{custom_fields}

## Document Content

{document_content}

## Similar Documents

{similar_docs}

## Previous Feedback

{feedback}

Extract any values that match the available custom fields. Only extract values that are clearly present in the document."""

    def _default_confirmation_prompt(self) -> str:
        return """You are a quality assurance assistant. Review the custom field extraction.

Consider:
- Are the values actually present in the document?
- Are the values correctly formatted for the field type?
- Are there any extraction errors?

Accept if the values look reasonable. Reject only if there are clear errors."""
