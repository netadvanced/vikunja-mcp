/**
 * Tests for the task by-index lookup operation (`get-by-index`).
 *
 * Covers validation of required ids, the resolved REST call/response
 * shape, and propagation of REST errors.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { getTaskByIndex } from '../../../src/tools/tasks/by-index';
import { MCPError, ErrorCode } from '../../../src/types';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the REST helper. */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text?: string;
}): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('getTaskByIndex', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('validation', () => {
    it('throws a VALIDATION_ERROR when projectId is missing', async () => {
      await expect(getTaskByIndex({ index: 42 }, authManager)).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'projectId is required for get-by-index operation',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws a VALIDATION_ERROR when index is missing', async () => {
      await expect(getTaskByIndex({ projectId: 5 }, authManager)).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'index is required for get-by-index operation',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when projectId is not a positive integer', async () => {
      await expect(
        getTaskByIndex({ projectId: 0, index: 1 }, authManager),
      ).rejects.toThrow('projectId must be a positive integer');
    });

    it('throws when index is not a positive integer', async () => {
      await expect(
        getTaskByIndex({ projectId: 5, index: -1 }, authManager),
      ).rejects.toThrow('index must be a positive integer');
    });
  });

  describe('resolution', () => {
    it('resolves a task by its per-project index', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify({ id: 99, title: 'Ship the release', project_id: 5 }),
        }),
      );

      const result = await getTaskByIndex({ projectId: 5, index: 42 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/projects/5/tasks/by-index/42');

      const text = result.content[0].text;
      expect(text).toContain('Resolved task at index 42 in project 5');
      expect(text).toContain('Success');
    });

    it('includes the session id in the response when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 1, title: 'T' }) }),
      );

      const result = await getTaskByIndex(
        { projectId: 5, index: 1, sessionId: 'sess-1' },
        authManager,
      );

      expect(result.content[0].type).toBe('text');
    });
  });

  describe('error propagation', () => {
    it('propagates a 404 from the by-index lookup', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: 'task not found',
        }),
      );

      await expect(
        getTaskByIndex({ projectId: 5, index: 999 }, authManager),
      ).rejects.toThrow(MCPError);
    });

    it('propagates a network error', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));

      await expect(
        getTaskByIndex({ projectId: 5, index: 1 }, authManager),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /projects/5/tasks/by-index/1): network down',
      );
    });
  });
});
