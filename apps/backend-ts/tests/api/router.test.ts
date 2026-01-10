/**
 * API Router tests.
 *
 * Tests for the HTTP routing and request handling layer.
 * Tests only health/root endpoints and 404 handling since other routes
 * require service dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Effect } from 'effect';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleRequest } from '../../src/api/index.js';

// ===========================================================================
// Mock Request/Response helpers
// ===========================================================================

function createMockRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): IncomingMessage {
  return {
    method,
    url,
    headers: { host: 'localhost:8001', ...headers },
  } as IncomingMessage;
}

function createMockResponse(): ServerResponse {
  return {} as ServerResponse;
}

// ===========================================================================
// Test Suites
// ===========================================================================

describe('API Router', () => {
  describe('Health Endpoints', () => {
    it('should handle GET / root endpoint', async () => {
      const req = createMockRequest('GET', '/');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toEqual({
        name: 'Paperless Local LLM (TypeScript)',
        version: '0.1.0',
        status: 'running',
      });
    });

    it('should handle GET /health endpoint', async () => {
      const req = createMockRequest('GET', '/health');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toEqual({ status: 'healthy' });
    });
  });

  describe('Route Matching', () => {
    it('should return 404 for unknown routes', async () => {
      const req = createMockRequest('GET', '/unknown/path');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: 'Not Found',
      });
    });

    it('should return 404 for wrong method', async () => {
      const req = createMockRequest('POST', '/health'); // health is GET only
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: 'Not Found',
      });
    });

    it('should return 404 for deeply nested unknown path', async () => {
      const req = createMockRequest('GET', '/api/unknown/nested/path');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: 'Not Found',
      });
    });

    it('should return 404 for partial path match', async () => {
      const req = createMockRequest('GET', '/api/setting'); // missing 's'
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 404,
        error: 'Not Found',
      });
    });
  });

  describe('Special Route Handling', () => {
    it('should return error for unknown test-connection service', async () => {
      const req = createMockRequest('POST', '/api/settings/test-connection/unknown');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        status: 'error',
        message: 'Unknown service: unknown',
      });
    });

    it('should return error for invalid service names', async () => {
      const invalidServices = ['xyz', 'test', 'connection', ''];

      for (const service of invalidServices) {
        if (service === '') continue; // Skip empty - would not match route

        const req = createMockRequest('POST', `/api/settings/test-connection/${service}`);
        const res = createMockResponse();

        const result = await Effect.runPromise(handleRequest(req, res, null));

        expect(result).toMatchObject({
          status: 'error',
          message: `Unknown service: ${service}`,
        });
      }
    });
  });

  describe('URL Parsing', () => {
    it('should handle URLs with trailing slashes as 404', async () => {
      const req = createMockRequest('GET', '/health/');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      // Trailing slash makes it a different route
      expect(result).toMatchObject({
        status: 404,
        error: 'Not Found',
      });
    });

    it('should handle root path correctly', async () => {
      const req = createMockRequest('GET', '/');
      const res = createMockResponse();

      const result = await Effect.runPromise(handleRequest(req, res, null));

      expect(result).toMatchObject({
        name: 'Paperless Local LLM (TypeScript)',
        status: 'running',
      });
    });
  });
});
