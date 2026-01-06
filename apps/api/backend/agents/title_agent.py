"""Title Agent for generating document titles."""

from collections.abc import AsyncGenerator
from typing import Any

from langchain_core.messages import HumanMessage

from agents.base import get_large_model, get_small_model
from agents.prompts import load_prompt
from config import get_settings
from models.analysis import ConfirmationResult, TitleAnalysis
from services.paperless import PaperlessClient
from services.qdrant import QdrantService


class TitleAgent:
    """Agent for generating document titles with confirmation loop."""

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

    async def process(
        self,
        doc_id: int,
        content: str,
        stream: bool = False,
    ) -> dict[str, Any] | AsyncGenerator[dict, None]:
        """Process document to generate title.

        Args:
            doc_id: Document ID
            content: OCR content
            stream: Whether to stream the response

        Returns:
            Result dict or async generator if streaming
        """
        if stream:
            return self._process_stream(doc_id, content)
        return await self._process_sync(doc_id, content)

    async def _process_sync(self, doc_id: int, content: str) -> dict[str, Any]:
        """Non-streaming title processing."""
        # Get similar documents for context (optional)
        similar_docs: list[dict] = []
        if self.qdrant:
            try:
                await self.qdrant.initialize()
                similar_docs = await self.qdrant.search_similar(content[:2000], k=5)
            except Exception:
                # Continue without similar docs - not critical
                pass

        # Run analysis with confirmation loop
        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            # Generate title
            analysis = await self._analyze_title(content, similar_docs, feedback)

            # Confirm with smaller model
            confirmation = await self._confirm_title(content, analysis)

            if confirmation.confirmed:
                # Apply the title
                await self._apply_title(doc_id, analysis.suggested_title)
                return {
                    "doc_id": doc_id,
                    "success": True,
                    "title": analysis.suggested_title,
                    "reasoning": analysis.reasoning,
                    "attempts": attempt + 1,
                }

            feedback = confirmation.feedback

        # Max retries reached - needs user review
        return {
            "doc_id": doc_id,
            "success": False,
            "needs_review": True,
            "suggested_title": analysis.suggested_title,
            "reasoning": analysis.reasoning,
            "last_feedback": feedback,
            "attempts": max_retries,
        }

    async def _process_stream(
        self,
        doc_id: int,
        content: str,
    ) -> AsyncGenerator[dict, None]:
        """Streaming title processing."""
        # Get similar documents (optional)
        similar_docs: list[dict] = []
        if self.qdrant:
            try:
                await self.qdrant.initialize()
                similar_docs = await self.qdrant.search_similar(content[:2000], k=5)
            except Exception:
                # Continue without similar docs - not critical
                pass

        yield {"type": "similar_docs", "count": len(similar_docs)}

        max_retries = self.settings.confirmation_max_retries
        feedback = None

        for attempt in range(max_retries):
            yield {
                "type": "attempt_start",
                "attempt": attempt + 1,
                "model": self.settings.ollama_model_large,
            }

            # Stream title analysis
            analysis = None
            async for chunk in self._analyze_title_stream(content, similar_docs, feedback):
                if chunk.get("type") == "token":
                    yield chunk
                elif chunk.get("type") == "result":
                    analysis = chunk["analysis"]

            yield {
                "type": "analysis_complete",
                "title": analysis.suggested_title,
                "reasoning": analysis.reasoning,
            }

            # Confirmation
            yield {
                "type": "confirmation_start",
                "model": self.settings.ollama_model_small,
            }

            confirmation = await self._confirm_title(content, analysis)

            yield {
                "type": "confirmation_result",
                "confirmed": confirmation.confirmed,
                "feedback": confirmation.feedback,
            }

            if confirmation.confirmed:
                await self._apply_title(doc_id, analysis.suggested_title)
                yield {
                    "type": "complete",
                    "success": True,
                    "title": analysis.suggested_title,
                }
                return

            feedback = confirmation.feedback

        # Max retries
        yield {
            "type": "complete",
            "success": False,
            "needs_review": True,
            "suggested_title": analysis.suggested_title,
            "last_feedback": feedback,
        }

    async def _analyze_title(
        self,
        content: str,
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> TitleAnalysis:
        """Analyze document and suggest title."""
        prompt_template = load_prompt("title") or self._default_title_prompt()

        # Format similar docs
        similar_titles = "\n".join(
            f"- {doc['metadata'].get('title', 'Unknown')}" for doc in similar_docs[:5]
        )

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            similar_titles=similar_titles or "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        # Get structured output
        structured_model = self.large_model.with_structured_output(TitleAnalysis)
        result = await structured_model.ainvoke(messages)
        return result

    async def _analyze_title_stream(
        self,
        content: str,
        similar_docs: list[dict],
        feedback: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream title analysis tokens."""
        prompt_template = load_prompt("title") or self._default_title_prompt()

        similar_titles = "\n".join(
            f"- {doc['metadata'].get('title', 'Unknown')}" for doc in similar_docs[:5]
        )

        # Format the prompt with variables
        formatted_prompt = prompt_template.format(
            document_content=content[:3000],
            similar_titles=similar_titles or "No similar documents found.",
            feedback=feedback or "None",
        )

        messages = [HumanMessage(content=formatted_prompt)]

        # Stream raw tokens first
        full_response = ""
        async for chunk in self.large_model.astream(messages):
            if chunk.content:
                full_response += chunk.content
                yield {"type": "token", "content": chunk.content}

        # Parse into structured output
        structured_model = self.large_model.with_structured_output(TitleAnalysis)
        analysis = await structured_model.ainvoke(messages)
        yield {"type": "result", "analysis": analysis}

    async def _confirm_title(
        self,
        content: str,
        analysis: TitleAnalysis,
    ) -> ConfirmationResult:
        """Confirm title with smaller model."""
        confirmation_prompt = (
            load_prompt("title_confirmation")
            or load_prompt("confirmation")
            or self._default_confirmation_prompt()
        )

        # Format analysis result
        analysis_result = f"""**Suggested Title:** {analysis.suggested_title}
**Reasoning:** {analysis.reasoning}
**Confidence:** {analysis.confidence}"""

        # Format the prompt with variables
        formatted_prompt = confirmation_prompt.format(
            analysis_result=analysis_result,
            document_excerpt=content[:1500],
        )

        messages = [HumanMessage(content=formatted_prompt)]

        structured_model = self.small_model.with_structured_output(ConfirmationResult)
        return await structured_model.ainvoke(messages)

    async def _apply_title(self, doc_id: int, title: str):
        """Apply the title and update tags.

        Title comes after Document Type in the pipeline.
        """
        await self.paperless.update_document(doc_id, title=title)
        await self.paperless.remove_tag_from_document(doc_id, self.settings.tag_document_type_done)
        await self.paperless.add_tag_to_document(doc_id, self.settings.tag_title_done)

    def _default_title_prompt(self) -> str:
        return """You are a document title specialist. Your task is to analyze documents and suggest clear, descriptive titles.

Guidelines:
- Titles should be concise but informative (3-10 words typically)
- Include key identifying information (company name, document type, date if relevant)
- Follow patterns from similar documents when appropriate
- Use consistent formatting

Output a structured analysis with your suggested title and reasoning."""

    def _default_confirmation_prompt(self) -> str:
        return """You are a quality assurance assistant. Review the title suggestion and determine if it's accurate and appropriate.

Consider:
- Does the title accurately describe the document content?
- Is it consistent with similar documents?
- Is the length and format appropriate?

Be fair but thorough. Only reject if there are clear issues."""
