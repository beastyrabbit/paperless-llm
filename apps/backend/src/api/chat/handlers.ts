/**
 * Chat API handlers for RAG-based document Q&A.
 */
import { Effect } from 'effect';
import { QdrantService, SearchResult } from '../../services/QdrantService.js';
import { OllamaService, OllamaChatMessage } from '../../services/OllamaService.js';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatResponse {
  message: string;
  sources: SearchResult[];
}

/**
 * Chat with documents using RAG (Retrieval-Augmented Generation).
 */
export const chatWithDocuments = (messages: ChatMessage[]) =>
  Effect.gen(function* () {
    if (!messages || messages.length === 0) {
      return { message: 'Please provide a message.', sources: [] };
    }

    const qdrant = yield* QdrantService;
    const ollama = yield* OllamaService;

    // Get the last user message for searching
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMessage) {
      return { message: 'No user message found.', sources: [] };
    }

    // Search for relevant documents (gracefully handle Qdrant errors)
    const docs = yield* qdrant.searchSimilar(lastUserMessage.content, {
      limit: 5,
      filterProcessed: false,
    }).pipe(
      Effect.catchAll((e) => {
        console.error('[Chat] Qdrant search failed:', e);
        return Effect.succeed([] as SearchResult[]);
      })
    );

    // Build context from document titles and metadata
    const context = docs
      .map((d, i) => {
        const parts = [`${i + 1}. "${d.title}"`];
        if (d.correspondent) parts.push(`(from: ${d.correspondent})`);
        if (d.documentType) parts.push(`[${d.documentType}]`);
        parts.push(`- relevance: ${(d.score * 100).toFixed(0)}%`);
        return parts.join(' ');
      })
      .join('\n');

    // Calculate confidence level based on top result
    const topScore = docs[0]?.score ?? 0;
    const hasGoodMatch = topScore >= 0.7;
    const hasSomeMatch = topScore >= 0.4;

    // Build RAG system prompt
    const systemPrompt = `You are a helpful assistant that helps users find documents in their Paperless-ngx archive.

## Available Documents
${context || 'No documents found matching your search.'}

## Important Context
- Relevance scores show how well each document matches (higher = better match)
- Best match score: ${(topScore * 100).toFixed(0)}%
- You can only see document titles and metadata, not the actual content inside documents

## How to Respond

${!hasSomeMatch ? `The search didn't find good matches. Ask the user to:
- Describe what they're looking for differently
- Provide specific details like names, dates, or document types` :
!hasGoodMatch ? `The matches aren't very strong. You should:
- Mention what you found, but express uncertainty
- Ask ONE focused clarifying question to narrow down the search
- For example: "Are you looking for [specific type]?" or "Do you mean documents from [specific source]?"
- Don't list multiple questions - pick the most helpful one` :
`Good matches found. You can:
- Confidently present the relevant documents
- Offer to help find more specific information`}

Keep responses concise and conversational.`;

    // Convert messages to Ollama format
    const ollamaMessages: OllamaChatMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ];

    // Get model and chat
    const model = ollama.getModel('large');
    const response = yield* ollama.chat(model, ollamaMessages, {
      temperature: 0.3,
      num_predict: 1024,
    }).pipe(
      Effect.catchAll((e) => {
        const errorMsg = e && typeof e === 'object' && 'message' in e ? (e as { message: string }).message : String(e);
        console.error('[Chat] Ollama chat failed:', errorMsg);
        return Effect.succeed({
          message: { content: `Sorry, I encountered an error while processing your request: ${errorMsg}` },
        });
      })
    );

    return {
      message: response.message.content,
      sources: docs,
    };
  });
