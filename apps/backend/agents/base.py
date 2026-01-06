"""Base configuration for all agents."""

from functools import lru_cache

from langchain_ollama import ChatOllama
from langgraph.checkpoint.memory import MemorySaver
from langgraph.checkpoint.sqlite import SqliteSaver

from config import get_settings


@lru_cache
def get_large_model() -> ChatOllama:
    """Get the large analysis model (120B)."""
    settings = get_settings()
    return ChatOllama(
        base_url=settings.ollama_url,
        model=settings.ollama_model_large,
        temperature=0.1,
        # Enable thinking mode
        extra_body={"think": True, "think_level": "high"},
    )


@lru_cache
def get_small_model() -> ChatOllama:
    """Get the small confirmation model (20B)."""
    settings = get_settings()
    return ChatOllama(
        base_url=settings.ollama_url,
        model=settings.ollama_model_small,
        temperature=0.0,
        extra_body={"think": True, "think_level": "medium"},
    )


def get_memory_saver() -> MemorySaver:
    """Get in-memory checkpointer for development."""
    return MemorySaver()


def get_sqlite_saver(db_path: str = "langgraph.db") -> SqliteSaver:
    """Get SQLite checkpointer for production."""
    return SqliteSaver.from_conn_string(db_path)


# Shared prompts for confirmation
CONFIRMATION_SYSTEM_PROMPT = """You are a quality assurance assistant. Your job is to verify the analysis made by the primary AI.

Review the analysis and determine if it is:
1. Accurate based on the document content
2. Consistent with similar documents
3. Following the established patterns

Be critical but fair. If the analysis is mostly correct, confirm it.
Only reject if there are clear errors or better alternatives exist."""


async def run_with_confirmation(
    analysis_fn,
    confirmation_fn,
    state: dict,
    max_retries: int = 3,
) -> dict:
    """Run an analysis with confirmation loop.

    Args:
        analysis_fn: Async function that performs the analysis
        confirmation_fn: Async function that confirms the analysis
        state: Current agent state
        max_retries: Maximum number of retry attempts

    Returns:
        Updated state with results
    """
    retry_count = 0
    feedback = None

    while retry_count < max_retries:
        # Run analysis (with feedback if this is a retry)
        analysis_result = await analysis_fn(state, feedback)

        # Run confirmation
        confirmation_result = await confirmation_fn(state, analysis_result)

        if confirmation_result.confirmed:
            return {
                **state,
                "result": analysis_result,
                "confirmed": True,
                "retry_count": retry_count,
            }

        # Not confirmed - prepare for retry
        feedback = confirmation_result.feedback
        retry_count += 1

    # Max retries reached
    return {
        **state,
        "result": analysis_result,
        "confirmed": False,
        "needs_user_review": True,
        "user_review_reason": f"Failed confirmation after {max_retries} attempts. Last feedback: {feedback}",
        "retry_count": retry_count,
    }
