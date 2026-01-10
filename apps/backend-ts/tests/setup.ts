/**
 * Test setup and fixtures for Paperless Local LLM TypeScript backend.
 *
 * This module provides:
 * - Mock services for external dependencies (Paperless, Ollama, Mistral)
 * - Sample data generators
 * - Effect-TS test helpers
 */
import { vi, beforeEach } from 'vitest';
import { Effect, Layer, Context } from 'effect';

// ===========================================================================
// Global Setup
// ===========================================================================

// Mock fetch globally for tests
global.fetch = vi.fn();

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// Sample Data Generators
// ===========================================================================

export function sampleDocument(docId: number = 1) {
  return {
    id: docId,
    title: `Test Document ${docId}`,
    correspondent: 1,
    correspondentName: 'Test Correspondent',
    documentType: 1,
    created: '2024-01-15T10:30:00Z',
    modified: '2024-01-15T10:30:00Z',
    added: '2024-01-15T10:30:00Z',
    tags: [1, 2],
    tagsData: [
      { id: 1, name: 'llm-pending' },
      { id: 2, name: 'important' },
    ],
    customFields: [],
    content: 'This is the full text content of the test document.',
    originalFileName: 'test_document.pdf',
    archiveSerialNumber: null,
  };
}

export function sampleQueueStats() {
  return {
    pending: 5,
    ocrDone: 3,
    correspondentDone: 2,
    documentTypeDone: 2,
    titleDone: 1,
    tagsDone: 1,
    processed: 10,
    totalInPipeline: 14,
    totalDocuments: 100,
  };
}

export function sampleCorrespondents() {
  return [
    { id: 1, name: 'Test Correspondent', document_count: 5 },
    { id: 2, name: 'Another Sender', document_count: 3 },
    { id: 3, name: 'Example Corp', document_count: 10 },
  ];
}

export function sampleDocumentTypes() {
  return [
    { id: 1, name: 'Invoice', document_count: 20 },
    { id: 2, name: 'Contract', document_count: 5 },
    { id: 3, name: 'Letter', document_count: 15 },
  ];
}

export function sampleTags() {
  return [
    { id: 1, name: 'llm-pending', color: '#FF0000', document_count: 5 },
    { id: 2, name: 'important', color: '#00FF00', document_count: 10 },
    { id: 3, name: 'archive', color: '#0000FF', document_count: 50 },
  ];
}

export function sampleCustomFields() {
  return [
    { id: 1, name: 'Invoice Number', data_type: 'string' },
    { id: 2, name: 'Due Date', data_type: 'date' },
    { id: 3, name: 'Amount', data_type: 'monetary' },
  ];
}

export function sampleSimilarDocs() {
  return [
    { id: 5, title: 'Similar Document 1', score: 0.95 },
    { id: 10, title: 'Similar Document 2', score: 0.87 },
    { id: 15, title: 'Similar Document 3', score: 0.82 },
  ];
}

export function samplePendingReviews() {
  return [
    {
      id: 'review-1',
      docId: 1,
      docTitle: 'Test Document',
      type: 'correspondent' as const,
      suggestion: 'New Correspondent',
      reasoning: 'Based on document analysis',
      alternatives: ['Alt 1', 'Alt 2'],
      attempts: 1,
      lastFeedback: null,
      createdAt: '2024-01-15T10:00:00Z',
      metadata: null,
      nextTag: 'llm-correspondent-done',
    },
    {
      id: 'review-2',
      docId: 2,
      docTitle: 'Another Document',
      type: 'document_type' as const,
      suggestion: 'Invoice',
      reasoning: 'Contains invoice details',
      alternatives: ['Receipt', 'Bill'],
      attempts: 2,
      lastFeedback: 'Try again with more context',
      createdAt: '2024-01-15T11:00:00Z',
      metadata: null,
      nextTag: 'llm-document-type-done',
    },
  ];
}

export function samplePendingCounts() {
  return {
    correspondent: 3,
    document_type: 2,
    tag: 1,
    total: 6,
    schema: 0,
  };
}

export function sampleTagMetadata() {
  return {
    id: 1,
    paperlessTagId: 1,
    tagName: 'important',
    description: 'Documents requiring attention',
    category: 'priority',
    excludeFromAi: false,
  };
}

export function sampleLlmResponse() {
  return JSON.stringify({
    suggestion: 'Test Correspondent',
    reasoning: 'Based on the document header and content analysis.',
    confidence: 0.85,
    alternatives: ['Alternative 1', 'Alternative 2'],
  });
}

export function sampleSettings() {
  return {
    paperlessUrl: 'http://localhost:8000',
    paperlessToken: 'test-token',
    ollamaUrl: 'http://localhost:11434',
    ollamaModelLarge: 'llama3:latest',
    ollamaModelSmall: 'llama3:8b',
    ollamaModelTranslation: '',
    qdrantUrl: 'http://localhost:6333',
    qdrantCollection: 'paperless-documents',
    autoProcessingEnabled: false,
    autoProcessingIntervalMinutes: 10,
    promptLanguage: 'en',
    pipelineOcr: true,
    pipelineTitle: true,
    pipelineCorrespondent: true,
    pipelineTags: true,
    pipelineCustomFields: false,
    confirmationMaxRetries: 3,
    tags: {
      pending: 'llm-pending',
      ocrDone: 'llm-ocr-done',
      correspondentDone: 'llm-correspondent-done',
      documentTypeDone: 'llm-document-type-done',
      titleDone: 'llm-title-done',
      tagsDone: 'llm-tags-done',
      processed: 'llm-processed',
    },
  };
}

// ===========================================================================
// Mock HTTP Response Helper
// ===========================================================================

export function mockFetchResponse(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: new Headers({ 'content-type': 'application/json' }),
  });
}

export function mockFetchError(status: number, message: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({ detail: message }),
    text: () => Promise.resolve(message),
    headers: new Headers(),
  });
}

// ===========================================================================
// Effect-TS Test Helpers
// ===========================================================================

/**
 * Run an Effect with a provided Layer.
 */
export function runWithLayer<R, E, A>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, layer));
}

/**
 * Run an Effect and expect it to fail.
 */
export async function runExpectFail<R, E, A>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>
): Promise<E> {
  const exit = await Effect.runPromiseExit(Effect.provide(effect, layer));
  if (exit._tag === 'Failure') {
    // Extract the error from the cause
    const cause = exit.cause;
    if (cause._tag === 'Fail') {
      return cause.error as E;
    }
  }
  throw new Error('Expected effect to fail');
}

// ===========================================================================
// Test Config
// ===========================================================================

export const testConfig = {
  paperless: {
    url: 'http://paperless.test:8000',
    token: 'test-token-12345',
  },
  ollama: {
    url: 'http://ollama.test:11434',
    modelLarge: 'llama3:latest',
    modelSmall: 'llama3:8b',
  },
  mistral: {
    apiKey: 'test-mistral-key',
    model: 'mistral-large-latest',
  },
  tags: {
    pending: 'llm-pending',
    ocrDone: 'llm-ocr-done',
    correspondentDone: 'llm-correspondent-done',
    documentTypeDone: 'llm-document-type-done',
    titleDone: 'llm-title-done',
    tagsDone: 'llm-tags-done',
    processed: 'llm-processed',
    failed: 'llm-failed',
  },
};
