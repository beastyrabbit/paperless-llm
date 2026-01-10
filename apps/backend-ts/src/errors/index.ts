/**
 * Application error types.
 */
import { Data } from 'effect';

/**
 * Base error class with common properties.
 */
export class AppError extends Data.TaggedError('AppError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Paperless API errors.
 */
export class PaperlessError extends Data.TaggedError('PaperlessError')<{
  readonly message: string;
  readonly statusCode?: number;
  readonly cause?: unknown;
}> {}

/**
 * Ollama service errors.
 */
export class OllamaError extends Data.TaggedError('OllamaError')<{
  readonly message: string;
  readonly model?: string;
  readonly cause?: unknown;
}> {}

/**
 * Mistral service errors.
 */
export class MistralError extends Data.TaggedError('MistralError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Qdrant service errors.
 */
export class QdrantError extends Data.TaggedError('QdrantError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Database/TinyBase errors.
 */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
  readonly message: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

/**
 * Validation errors.
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly field?: string;
  readonly value?: unknown;
}> {}

/**
 * Agent processing errors.
 */
export class AgentError extends Data.TaggedError('AgentError')<{
  readonly message: string;
  readonly agent?: string;
  readonly step?: string;
  readonly cause?: unknown;
}> {}

/**
 * Job errors.
 */
export class JobError extends Data.TaggedError('JobError')<{
  readonly message: string;
  readonly jobName?: string;
  readonly cause?: unknown;
}> {}

/**
 * Not found errors.
 */
export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly message: string;
  readonly resource?: string;
  readonly id?: string | number;
}> {}

/**
 * Type union of all application errors.
 */
export type AllErrors =
  | AppError
  | PaperlessError
  | OllamaError
  | MistralError
  | QdrantError
  | DatabaseError
  | ValidationError
  | AgentError
  | JobError
  | NotFoundError;
