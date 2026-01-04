"""Document Type Agent for classifying documents."""

from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from config import get_settings
from models.analysis import ConfirmationResult, DocumentTypeAnalysis
from services.paperless import PaperlessClient
from services.qdrant import QdrantService

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str) -> str:
    """Load a prompt template from file."""
    prompt_file = PROMPTS_DIR / f"{name}.md"
    if prompt_file.exists():
        return prompt_file.read_text()
    return ""


class DocumentTypeAgent:
    """Agent for classifying document types."""

    def __init__(self):
        self.settings = get_settings()
        self.large_model = get_large_model()
        self.small_model = get_small_model()
        self.paperless = PaperlessClient(
            self.settings.paperless_url,
            self.settings.paperless_token,
        )
        self.qdrant = QdrantService(
            qdrant_url=self.settings.qdrant_url,
            collection_name=self.settings.qdrant_collection,
            ollama_url=self.settings.ollama_url,
        )

    async def process(self, doc_id: int, content: str) -> dict[str, Any]:
        """Process document to identify document type.

        Args:
            doc_id: Document ID
            content: OCR content

        Returns:
            Result dict with document type info
        """
        # Get existing document types
        existing_doc_types = await self.paperless.get_document_types()
        doc_type_names = [dt["name"] for dt in existing_doc_types]

        # Get similar documents for context
        await self.qdrant.initialize()
        similar_docs = await self.qdrant.search_similar(content[:2000], k=5)

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Analyze document type
            analysis = await self._analyze_document_type(
                content,
                doc_type_names,
                similar_docs,
                feedback,
            )

            # Confirm with smaller model
            confirmation = await self._confirm_document_type(content, analysis)

            if confirmation.confirmed:
                # Apply document type
                result = await self._apply_document_type(doc_id, analysis, existing_doc_types)
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "document_type": analysis.suggested_document_type,
                    "is_new": analysis.is_new,
                    "reasoning": analysis.reasoning,
                    "attempts": attempt + 1,
                    **result,
                }

            feedback = confirmation.feedback

        # Needs user review
        return {
            "doc_id": doc_id,
            "success": False,
            "needs_review": True,
            "suggested_document_type": analysis.suggested_document_type,
            "is_new": analysis.is_new,
            "reasoning": analysis.reasoning,
            "alternatives": analysis.alternatives,
            "last_feedback": feedback,
            "attempts": max_retries,
        }

    async def _analyze_document_type(
        self,
        content: str,
        existing_doc_types: list[str],
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> DocumentTypeAnalysis:
        """Analyze document to identify document type."""
        prompt_template = load_prompt("document_type") or self._default_prompt()

        # Format existing document types
        doc_types_list = "\n".join(f"- {name}" for name in existing_doc_types[:50])

        # Format similar docs with their document types
        similar_info = "\n".join(
            f"- {doc['metadata'].get('title', 'Unknown')} -> {doc['metadata'].get('document_type', 'Unknown')}"
            for doc in similar_docs[:5]
        )

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            existing_types=doc_types_list or "No document types yet.",
            similar_docs=similar_info or "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.large_model.with_structured_output(DocumentTypeAnalysis)
        return await structured_model.ainvoke(messages)

    async def _confirm_document_type(
        self,
        content: str,
        analysis: DocumentTypeAnalysis,
    ) -> ConfirmationResult:
        """Confirm document type with smaller model."""
        confirmation_prompt = (
            load_prompt("document_type_confirmation")
            or load_prompt("confirmation")
            or self._default_confirmation_prompt()
        )

        # Format analysis result
        analysis_result = f"""**Suggested Document Type:** {analysis.suggested_document_type}
**Is New:** {analysis.is_new}
**Reasoning:** {analysis.reasoning}
**Confidence:** {analysis.confidence}
**Alternatives:** {', '.join(analysis.alternatives) if analysis.alternatives else 'None'}"""

        # Format the prompt with variables
        formatted_prompt = confirmation_prompt.format(
            analysis_result=analysis_result,
            document_excerpt=content[:1500],
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.small_model.with_structured_output(ConfirmationResult)
        return await structured_model.ainvoke(messages)

    async def _apply_document_type(
        self,
        doc_id: int,
        analysis: DocumentTypeAnalysis,
        existing_doc_types: list[dict],
    ) -> dict[str, Any]:
        """Apply document type to document."""
        doc_type_id = None

        if analysis.is_new:
            # Check if we should create automatically or queue for review
            if self.settings.confirmation_require_user_for_new_entities:
                return {
                    "applied": False,
                    "queued_for_review": True,
                    "reason": "New document type requires user confirmation",
                }
            # Auto-create if allowed
            doc_type_id = await self.paperless.get_or_create_document_type(
                analysis.suggested_document_type
            )
        else:
            # Find existing document type ID
            for dt in existing_doc_types:
                if dt["name"].lower() == analysis.suggested_document_type.lower():
                    doc_type_id = dt["id"]
                    break

        if doc_type_id:
            await self.paperless.update_document(doc_id, document_type=doc_type_id)
            await self.paperless.remove_tag_from_document(
                doc_id, self.settings.tag_correspondent_done
            )
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_document_type_done)
            return {"applied": True, "document_type_id": doc_type_id}

        return {"applied": False, "reason": "Document type not found"}

    def _default_prompt(self) -> str:
        return """You are a document classification specialist focused on identifying document types.

A document type categorizes the kind of document. Common types include:
- Invoice / Rechnung
- Contract / Vertrag
- Letter / Brief
- Bank Statement / Kontoauszug
- Tax Document / Steuerdokument
- Insurance Document / Versicherungsunterlagen
- Receipt / Quittung
- Certificate / Zertifikat
- Medical Document / Medizinisches Dokument
- ID Document / Ausweisdokument

Guidelines:
- Match to existing document types when possible
- Only suggest new types when no suitable match exists
- Be specific but not overly granular
- Consider the document's purpose and format

Output a structured analysis with your document type suggestion."""

    def _default_confirmation_prompt(self) -> str:
        return """You are a quality assurance assistant. Review the document type classification and verify it's correct.

Consider:
- Does the document type accurately describe the document?
- Is it consistent with how similar documents are classified?
- Is the type too broad or too specific?

Be thorough. Document type classification helps with organization and retrieval."""
