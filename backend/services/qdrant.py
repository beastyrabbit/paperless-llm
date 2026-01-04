"""Qdrant Vector Store integration."""

from typing import Any

from langchain_ollama import OllamaEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.models import Distance, VectorParams


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

        # Initialize Qdrant client
        self.client = QdrantClient(url=qdrant_url)

        # Initialize embeddings
        self.embeddings = OllamaEmbeddings(
            base_url=ollama_url,
            model=embedding_model,
        )

        # Initialize vector store
        self.vector_store: QdrantVectorStore | None = None

    async def initialize(self, vector_size: int = 768):
        """Initialize the collection if it doesn't exist."""
        collections = self.client.get_collections()
        collection_names = [c.name for c in collections.collections]

        if self.collection_name not in collection_names:
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

        # Use doc_id as part of the ID to enable updates
        ids = await self.vector_store.aadd_texts(
            texts=[content],
            metadatas=[full_metadata],
            ids=[f"paperless-{doc_id}"],
        )
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
