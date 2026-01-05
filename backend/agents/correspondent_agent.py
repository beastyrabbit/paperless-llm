"""Correspondent Agent for assigning document senders/receivers."""

from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from agents.prompts import load_prompt
from config import get_settings
from models.analysis import ConfirmationResult, CorrespondentAnalysis
from services.paperless import PaperlessClient
from services.qdrant import QdrantService


class CorrespondentAgent:
    """Agent for identifying and assigning document correspondents."""

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
        """Process document to identify correspondent.

        Args:
            doc_id: Document ID
            content: OCR content

        Returns:
            Result dict with correspondent info
        """
        # Get existing correspondents
        existing_correspondents = await self.paperless.get_correspondents()
        correspondent_names = [c["name"] for c in existing_correspondents]

        # Get similar documents for context
        await self.qdrant.initialize()
        similar_docs = await self.qdrant.search_similar(content[:2000], k=5)

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Analyze correspondent
            analysis = await self._analyze_correspondent(
                content,
                correspondent_names,
                similar_docs,
                feedback,
            )

            # Confirm with smaller model
            confirmation = await self._confirm_correspondent(content, analysis)

            if confirmation.confirmed:
                # Apply correspondent
                result = await self._apply_correspondent(doc_id, analysis, existing_correspondents)
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "correspondent": analysis.suggested_correspondent,
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
            "suggested_correspondent": analysis.suggested_correspondent,
            "is_new": analysis.is_new,
            "reasoning": analysis.reasoning,
            "alternatives": analysis.alternatives,
            "last_feedback": feedback,
            "attempts": max_retries,
        }

    async def _analyze_correspondent(
        self,
        content: str,
        existing_correspondents: list[str],
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> CorrespondentAnalysis:
        """Analyze document to identify correspondent."""
        prompt_template = load_prompt("correspondent") or self._default_prompt()

        # Format existing correspondents
        correspondents_list = "\n".join(f"- {name}" for name in existing_correspondents[:50])

        # Format similar docs with their correspondents
        similar_info = "\n".join(
            f"- {doc['metadata'].get('title', 'Unknown')} -> {doc['metadata'].get('correspondent', 'Unknown')}"
            for doc in similar_docs[:5]
        )

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            existing_correspondents=correspondents_list or "No correspondents yet.",
            similar_docs=similar_info or "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.large_model.with_structured_output(CorrespondentAnalysis)
        return await structured_model.ainvoke(messages)

    async def _confirm_correspondent(
        self,
        content: str,
        analysis: CorrespondentAnalysis,
    ) -> ConfirmationResult:
        """Confirm correspondent with smaller model."""
        confirmation_prompt = (
            load_prompt("correspondent_confirmation")
            or load_prompt("confirmation")
            or self._default_confirmation_prompt()
        )

        # Format analysis result
        analysis_result = f"""**Suggested Correspondent:** {analysis.suggested_correspondent}
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

    async def _apply_correspondent(
        self,
        doc_id: int,
        analysis: CorrespondentAnalysis,
        existing_correspondents: list[dict],
    ) -> dict[str, Any]:
        """Apply correspondent to document."""
        correspondent_id = None

        if analysis.is_new:
            # Check if we should create automatically or queue for review
            if self.settings.confirmation_require_user_for_new_entities:
                return {
                    "applied": False,
                    "queued_for_review": True,
                    "reason": "New correspondent requires user confirmation",
                }
            # Auto-create if allowed
            correspondent_id = await self.paperless.get_or_create_correspondent(
                analysis.suggested_correspondent
            )
        else:
            # Find existing correspondent ID
            for corr in existing_correspondents:
                if corr["name"].lower() == analysis.suggested_correspondent.lower():
                    correspondent_id = corr["id"]
                    break

        if correspondent_id:
            await self.paperless.update_document(doc_id, correspondent=correspondent_id)
            # Correspondent comes after OCR in the pipeline
            await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_ocr_done)
            await self.paperless.add_tag_to_document(doc_id, self.settings.tag_correspondent_done)
            return {"applied": True, "correspondent_id": correspondent_id}

        return {"applied": False, "reason": "Correspondent not found"}

    def _default_prompt(self) -> str:
        return """You are a document analysis specialist focused on identifying correspondents.

A correspondent is the sender, creator, or originating organization of a document. This could be:
- A company (e.g., "Amazon", "Deutsche Bank")
- A government agency (e.g., "Finanzamt München")
- An individual (e.g., "Dr. Max Mustermann")
- An organization (e.g., "Verein für Tierschutz")

Guidelines:
- Look for letterheads, sender information, signatures
- Match to existing correspondents when possible (prefer exact matches)
- Only suggest new correspondents when no suitable match exists
- Use official/formal names, not abbreviations

Output a structured analysis with your correspondent suggestion."""

    def _default_confirmation_prompt(self) -> str:
        return """You are a quality assurance assistant. Review the correspondent identification and verify it's correct.

Consider:
- Is the correspondent clearly identified in the document?
- Does it match an existing correspondent exactly?
- Is the name formatted correctly?

Be thorough. Correspondent assignment affects document organization."""
