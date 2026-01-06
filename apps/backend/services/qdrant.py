"""Qdrant Vector Store integration."""

import json
from typing import Any

from langchain_ollama import OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams


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


class QdrantService:
    """Service for Qdrant vector database operations."""

    def __init__(
        self,
        qdrant_url: str,
        collection_name: str,
        ollama_url: str,
        embedding_model: str = "nomic-embed-text",
    ):
        self.qdrant_url = qdrant_url
        self.collection_name = collection_name
        self.ollama_url = ollama_url
        self.embedding_model = embedding_model
        self._detected_dim: int | None = None

        # Initialize Qdrant client
        self.client = QdrantClient(url=qdrant_url)

        # Initialize embeddings
        self.embeddings = OllamaEmbeddings(
            base_url=ollama_url,
            model=embedding_model,
        )

        # Initialize vector store
        self.vector_store: QdrantVectorStore | None = None

    async def _get_embedding_dimension(self) -> int:
        """Detect embedding dimension by generating a test embedding."""
        if self._detected_dim is not None:
            return self._detected_dim

        # Generate a test embedding to detect dimension
        test_embedding = await self.embeddings.aembed_query("test")
        self._detected_dim = len(test_embedding)
        return self._detected_dim

    async def initialize(self, force_recreate: bool = False):
        """Initialize the collection, recreating if dimension mismatch."""
        # #region agent log
        _debug_log(
            "qdrant.py:initialize:start",
            "Initializing Qdrant",
            {"ollama_url": self.ollama_url, "model": self.embedding_model},
            "H2",
        )
        # #endregion

        # Detect the actual embedding dimension from the model
        vector_size = await self._get_embedding_dimension()
        # #region agent log
        _debug_log(
            "qdrant.py:initialize:dim_detected",
            "Embedding dimension detected",
            {"vector_size": vector_size},
            "H2",
        )
        # #endregion

        collections = self.client.get_collections()
        collection_names = [c.name for c in collections.collections]

        if self.collection_name in collection_names:
            # Check if existing collection has correct dimensions
            collection_info = self.client.get_collection(self.collection_name)
            existing_size = collection_info.config.params.vectors.size

            # #region agent log
            _debug_log(
                "qdrant.py:initialize:existing",
                "Collection exists",
                {"existing_size": existing_size, "required_size": vector_size},
                "H2",
            )
            # #endregion

            if existing_size != vector_size or force_recreate:
                # Dimension mismatch - recreate collection
                # #region agent log
                _debug_log(
                    "qdrant.py:initialize:recreate",
                    "Recreating collection due to dimension mismatch",
                    {"old": existing_size, "new": vector_size},
                    "H2",
                )
                # #endregion
                print(f"Recreating Qdrant collection: {existing_size}d -> {vector_size}d")
                self.client.delete_collection(self.collection_name)
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=VectorParams(
                        size=vector_size,
                        distance=Distance.COSINE,
                    ),
                )
        else:
            # Create new collection
            # #region agent log
            _debug_log(
                "qdrant.py:initialize:create",
                "Creating new collection",
                {"name": self.collection_name, "size": vector_size},
                "H2",
            )
            # #endregion
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=vector_size,
                    distance=Distance.COSINE,
                ),
            )

        self.vector_store = QdrantVectorStore(
            client=self.client,
            collection_name=self.collection_name,
            embedding=self.embeddings,
        )
        # #region agent log
        _debug_log("qdrant.py:initialize:complete", "Qdrant initialization complete", {}, "H2")
        # #endregion

    async def add_document(
        self,
        doc_id: int,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Add a document to the vector store."""
        if self.vector_store is None:
            await self.initialize()

        full_metadata = {
            "doc_id": doc_id,
            **(metadata or {}),
        }

        # #region agent log
        _debug_log(
            "qdrant.py:add_document:start",
            "Adding document to Qdrant",
            {"doc_id": doc_id, "content_length": len(content)},
            "H2",
        )
        # #endregion

        # Use doc_id as integer ID (Qdrant requires int or UUID, not string)
        ids = await self.vector_store.aadd_texts(
            texts=[content],
            metadatas=[full_metadata],
            ids=[str(doc_id)],  # langchain will convert to proper format
        )
        # #region agent log
        _debug_log(
            "qdrant.py:add_document:complete",
            "Document added to Qdrant",
            {"doc_id": doc_id, "returned_id": ids[0] if ids else None},
            "H2",
        )
        # #endregion
        return ids[0]

    async def search_similar(
        self,
        query: str,
        k: int = 5,
        filter_metadata: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """Search for similar documents."""
        if self.vector_store is None:
            await self.initialize()

        results = await self.vector_store.asimilarity_search_with_score(
            query=query,
            k=k,
            filter=filter_metadata,
        )

        return [
            {
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": score,
            }
            for doc, score in results
        ]

    async def get_document_embedding(self, doc_id: int) -> list[float] | None:
        """Get the embedding for a specific document."""
        result = self.client.retrieve(
            collection_name=self.collection_name,
            ids=[f"paperless-{doc_id}"],
            with_vectors=True,
        )
        if result and result[0].vector:
            return result[0].vector
        return None

    async def delete_document(self, doc_id: int) -> bool:
        """Delete a document from the vector store."""
        self.client.delete(
            collection_name=self.collection_name,
            points_selector=[f"paperless-{doc_id}"],
        )
        return True
