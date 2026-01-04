"""Application configuration using Pydantic Settings with YAML support."""

from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def load_yaml_config() -> dict[str, Any]:
    """Load configuration from config.yaml if it exists."""
    # Check multiple locations for config.yaml
    config_paths = [
        Path("config.yaml"),
        Path("../config.yaml"),
        Path(__file__).parent.parent / "config.yaml",
    ]

    for config_path in config_paths:
        if config_path.exists():
            with open(config_path) as f:
                return yaml.safe_load(f) or {}

    return {}


class Settings(BaseSettings):
    """Application settings loaded from config.yaml and environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # =========================================================================
    # External Services
    # =========================================================================

    # Paperless-ngx
    paperless_url: str = Field(default="http://localhost:8000")
    paperless_token: str = Field(default="")

    # Mistral AI (OCR)
    mistral_api_key: str = Field(default="")
    mistral_model: str = Field(default="mistral-ocr-latest")

    # Ollama
    ollama_url: str = Field(default="")
    ollama_model_large: str = Field(default="gpt-oss:120b")
    ollama_model_small: str = Field(default="gpt-oss:20b")
    ollama_embedding_model: str = Field(default="nomic-embed-text")

    # Ollama Thinking Mode
    ollama_thinking_enabled: bool = Field(default=True)
    ollama_thinking_level: Literal["low", "medium", "high"] = Field(default="high")

    # Qdrant
    qdrant_url: str = Field(default="http://localhost:6333")
    qdrant_collection: str = Field(default="paperless-documents")

    # =========================================================================
    # Processing Settings
    # =========================================================================

    # Auto-Processing
    auto_processing_enabled: bool = Field(default=False)
    auto_processing_interval_minutes: int = Field(default=10)
    auto_processing_pause_on_user_activity: bool = Field(default=True)

    # Confirmation Loop
    confirmation_max_retries: int = Field(default=3)
    confirmation_require_user_for_new_entities: bool = Field(default=True)

    # =========================================================================
    # Workflow Tags
    # =========================================================================

    tag_pending: str = Field(default="llm-pending")
    tag_ocr_done: str = Field(default="llm-ocr-done")
    tag_correspondent_done: str = Field(default="llm-correspondent-done")
    tag_document_type_done: str = Field(default="llm-document-type-done")
    tag_title_done: str = Field(default="llm-title-done")
    tag_tags_done: str = Field(default="llm-tags-done")
    tag_processed: str = Field(default="llm-processed")

    # =========================================================================
    # Processing Pipeline
    # =========================================================================

    pipeline_ocr: bool = Field(default=True)
    pipeline_correspondent: bool = Field(default=True)
    pipeline_document_type: bool = Field(default=True)
    pipeline_title: bool = Field(default=True)
    pipeline_tags: bool = Field(default=True)
    pipeline_custom_fields: bool = Field(default=True)

    # =========================================================================
    # Vector Search Settings
    # =========================================================================

    vector_search_enabled: bool = Field(default=True)
    vector_search_top_k: int = Field(default=5)
    vector_search_min_score: float = Field(default=0.7)

    # =========================================================================
    # Debug Settings
    # =========================================================================

    debug_log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(default="INFO")
    debug_log_prompts: bool = Field(default=False)
    debug_log_responses: bool = Field(default=False)
    debug_save_processing_history: bool = Field(default=True)

    def __init__(self, **kwargs):
        # Load YAML config first
        yaml_config = load_yaml_config()

        # Flatten nested YAML structure to match our flat settings
        flat_config = _flatten_yaml_config(yaml_config)

        # Remove None values
        flat_config = {k: v for k, v in flat_config.items() if v is not None}

        # Merge: kwargs > yaml_config > defaults
        merged = {**flat_config, **kwargs}
        super().__init__(**merged)


def _flatten_yaml_config(yaml_config: dict[str, Any]) -> dict[str, Any]:
    """Flatten nested YAML config to flat settings dict."""
    flat = {}

    # Paperless
    if "paperless" in yaml_config:
        flat["paperless_url"] = yaml_config["paperless"].get("url")
        flat["paperless_token"] = yaml_config["paperless"].get("token")

    # Mistral
    if "mistral" in yaml_config:
        flat["mistral_api_key"] = yaml_config["mistral"].get("api_key")
        flat["mistral_model"] = yaml_config["mistral"].get("model")

    # Ollama
    if "ollama" in yaml_config:
        ollama = yaml_config["ollama"]
        flat["ollama_url"] = ollama.get("url")
        flat["ollama_model_large"] = ollama.get("model_large")
        flat["ollama_model_small"] = ollama.get("model_small")
        flat["ollama_embedding_model"] = ollama.get("embedding_model")
        if "thinking" in ollama:
            flat["ollama_thinking_enabled"] = ollama["thinking"].get("enabled")
            flat["ollama_thinking_level"] = ollama["thinking"].get("level")

    # Qdrant
    if "qdrant" in yaml_config:
        flat["qdrant_url"] = yaml_config["qdrant"].get("url")
        flat["qdrant_collection"] = yaml_config["qdrant"].get("collection")

    # Auto-Processing
    if "auto_processing" in yaml_config:
        ap = yaml_config["auto_processing"]
        flat["auto_processing_enabled"] = ap.get("enabled")
        flat["auto_processing_interval_minutes"] = ap.get("interval_minutes")
        flat["auto_processing_pause_on_user_activity"] = ap.get("pause_on_user_activity")

    # Confirmation
    if "confirmation" in yaml_config:
        conf = yaml_config["confirmation"]
        flat["confirmation_max_retries"] = conf.get("max_retries")
        flat["confirmation_require_user_for_new_entities"] = conf.get(
            "require_user_for_new_entities"
        )

    # Tags
    if "tags" in yaml_config:
        for key, value in yaml_config["tags"].items():
            flat[f"tag_{key}"] = value

    # Pipeline
    if "pipeline" in yaml_config:
        for key, value in yaml_config["pipeline"].items():
            flat[f"pipeline_{key}"] = value

    # Vector Search
    if "vector_search" in yaml_config:
        vs = yaml_config["vector_search"]
        flat["vector_search_enabled"] = vs.get("enabled")
        flat["vector_search_top_k"] = vs.get("top_k")
        flat["vector_search_min_score"] = vs.get("min_score")

    # Debug
    if "debug" in yaml_config:
        debug = yaml_config["debug"]
        flat["debug_log_level"] = debug.get("log_level")
        flat["debug_log_prompts"] = debug.get("log_prompts")
        flat["debug_log_responses"] = debug.get("log_responses")
        flat["debug_save_processing_history"] = debug.get("save_processing_history")

    return flat


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


def clear_settings_cache():
    """Clear the settings cache to force reload."""
    get_settings.cache_clear()


def _unflatten_to_yaml(flat_settings: dict[str, Any]) -> dict[str, Any]:
    """Convert flat settings dict to nested YAML structure."""
    yaml_config: dict[str, Any] = {}

    # Paperless
    if any(k.startswith("paperless_") for k in flat_settings):
        yaml_config["paperless"] = {}
        if "paperless_url" in flat_settings:
            yaml_config["paperless"]["url"] = flat_settings["paperless_url"]
        if "paperless_token" in flat_settings:
            yaml_config["paperless"]["token"] = flat_settings["paperless_token"]

    # Mistral
    if any(k.startswith("mistral_") for k in flat_settings):
        yaml_config["mistral"] = {}
        if "mistral_api_key" in flat_settings:
            yaml_config["mistral"]["api_key"] = flat_settings["mistral_api_key"]
        if "mistral_model" in flat_settings:
            yaml_config["mistral"]["model"] = flat_settings["mistral_model"]

    # Ollama
    if any(k.startswith("ollama_") for k in flat_settings):
        yaml_config["ollama"] = {}
        if "ollama_url" in flat_settings:
            yaml_config["ollama"]["url"] = flat_settings["ollama_url"]
        if "ollama_model_large" in flat_settings:
            yaml_config["ollama"]["model_large"] = flat_settings["ollama_model_large"]
        if "ollama_model_small" in flat_settings:
            yaml_config["ollama"]["model_small"] = flat_settings["ollama_model_small"]
        if "ollama_embedding_model" in flat_settings:
            yaml_config["ollama"]["embedding_model"] = flat_settings["ollama_embedding_model"]
        if any(k.startswith("ollama_thinking") for k in flat_settings):
            yaml_config["ollama"]["thinking"] = {}
            if "ollama_thinking_enabled" in flat_settings:
                yaml_config["ollama"]["thinking"]["enabled"] = flat_settings[
                    "ollama_thinking_enabled"
                ]
            if "ollama_thinking_level" in flat_settings:
                yaml_config["ollama"]["thinking"]["level"] = flat_settings["ollama_thinking_level"]

    # Qdrant
    if any(k.startswith("qdrant_") for k in flat_settings):
        yaml_config["qdrant"] = {}
        if "qdrant_url" in flat_settings:
            yaml_config["qdrant"]["url"] = flat_settings["qdrant_url"]
        if "qdrant_collection" in flat_settings:
            yaml_config["qdrant"]["collection"] = flat_settings["qdrant_collection"]

    # Auto-processing
    if any(k.startswith("auto_processing_") for k in flat_settings):
        yaml_config["auto_processing"] = {}
        if "auto_processing_enabled" in flat_settings:
            yaml_config["auto_processing"]["enabled"] = flat_settings["auto_processing_enabled"]
        if "auto_processing_interval_minutes" in flat_settings:
            yaml_config["auto_processing"]["interval_minutes"] = flat_settings[
                "auto_processing_interval_minutes"
            ]
        if "auto_processing_pause_on_user_activity" in flat_settings:
            yaml_config["auto_processing"]["pause_on_user_activity"] = flat_settings[
                "auto_processing_pause_on_user_activity"
            ]

    # Confirmation
    if any(k.startswith("confirmation_") for k in flat_settings):
        yaml_config["confirmation"] = {}
        if "confirmation_max_retries" in flat_settings:
            yaml_config["confirmation"]["max_retries"] = flat_settings["confirmation_max_retries"]
        if "confirmation_require_user_for_new_entities" in flat_settings:
            yaml_config["confirmation"]["require_user_for_new_entities"] = flat_settings[
                "confirmation_require_user_for_new_entities"
            ]

    # Tags
    tag_keys = [k for k in flat_settings if k.startswith("tag_")]
    if tag_keys:
        yaml_config["tags"] = {}
        for key in tag_keys:
            tag_name = key[4:]  # Remove "tag_" prefix
            yaml_config["tags"][tag_name] = flat_settings[key]

    # Pipeline
    pipeline_keys = [k for k in flat_settings if k.startswith("pipeline_")]
    if pipeline_keys:
        yaml_config["pipeline"] = {}
        for key in pipeline_keys:
            pipeline_name = key[9:]  # Remove "pipeline_" prefix
            yaml_config["pipeline"][pipeline_name] = flat_settings[key]

    # Vector Search
    if any(k.startswith("vector_search_") for k in flat_settings):
        yaml_config["vector_search"] = {}
        if "vector_search_enabled" in flat_settings:
            yaml_config["vector_search"]["enabled"] = flat_settings["vector_search_enabled"]
        if "vector_search_top_k" in flat_settings:
            yaml_config["vector_search"]["top_k"] = flat_settings["vector_search_top_k"]
        if "vector_search_min_score" in flat_settings:
            yaml_config["vector_search"]["min_score"] = flat_settings["vector_search_min_score"]

    # Debug
    if any(k.startswith("debug_") for k in flat_settings):
        yaml_config["debug"] = {}
        if "debug_log_level" in flat_settings:
            yaml_config["debug"]["log_level"] = flat_settings["debug_log_level"]
        if "debug_log_prompts" in flat_settings:
            yaml_config["debug"]["log_prompts"] = flat_settings["debug_log_prompts"]
        if "debug_log_responses" in flat_settings:
            yaml_config["debug"]["log_responses"] = flat_settings["debug_log_responses"]
        if "debug_save_processing_history" in flat_settings:
            yaml_config["debug"]["save_processing_history"] = flat_settings[
                "debug_save_processing_history"
            ]

    return yaml_config


def save_settings_to_yaml(updates: dict[str, Any]) -> Path | None:
    """Save settings updates to config.yaml, merging with existing config."""
    # Find existing config file or use default location
    config_paths = [
        Path("config.yaml"),
        Path("../config.yaml"),
        Path(__file__).parent.parent / "config.yaml",
    ]

    config_path = None
    existing_config = {}

    for path in config_paths:
        if path.exists():
            config_path = path
            with open(path) as f:
                existing_config = yaml.safe_load(f) or {}
            break

    # If no config exists, create in the first location
    if config_path is None:
        config_path = config_paths[0]

    # Convert updates to nested YAML structure
    updates_yaml = _unflatten_to_yaml(updates)

    # Deep merge updates into existing config
    def deep_merge(base: dict, updates: dict) -> dict:
        result = base.copy()
        for key, value in updates.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = deep_merge(result[key], value)
            else:
                result[key] = value
        return result

    merged_config = deep_merge(existing_config, updates_yaml)

    # Write back to YAML
    with open(config_path, "w") as f:
        yaml.dump(merged_config, f, default_flow_style=False, sort_keys=False)

    return config_path
