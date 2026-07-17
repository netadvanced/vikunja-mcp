/**
 * Tests for the task position operation (`set-position`).
 *
 * Covers validation of required/optional ids, project and view
 * auto-resolution (default `list` view, explicit `viewKind`), explicit
 * project/view ids, and propagation of REST errors.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { setTaskPosition } from '../../../src/tools/tasks/position';
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

/** A views payload containing a list view (id 10) and a Kanban view (id 11). */
const projectViews = JSON.stringify([
  { id: 10, title: 'List', project_id: 5, view_kind: 'list' },
  { id: 11, title: 'Kanban', project_id: 5, view_kind: 'kanban' },
]);

describe('setTaskPosition', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('validation', () => {
    it('throws a VALIDATION_ERROR when the task id is missing', async () => {
      await expect(setTaskPosition({ position: 100 }, authManager)).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'Task id is required for set-position operation',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws a VALIDATION_ERROR when the task id is zero (falsy)', async () => {
      await expect(
        setTaskPosition({ id: 0, position: 100 }, authManager),
      ).rejects.toThrow('Task id is required for set-position operation');
    });

    it('throws a VALIDATION_ERROR when position is undefined', async () => {
      await expect(setTaskPosition({ id: 1 }, authManager)).rejects.toThrow(
        new MCPError(
          ErrorCode.VALIDATION_ERROR,
          'position is required for set-position operation',
        ),
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws a VALIDATION_ERROR when position is null', async () => {
      await expect(
        setTaskPosition({ id: 1, position: null as unknown as number }, authManager),
      ).rejects.toThrow('position is required for set-position operation');
    });

    it('treats a position of 0 as provided', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: projectViews }))
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await setTaskPosition(
        { id: 1, position: 0, projectId: 5 },
        authManager,
      );

      expect(result.content[0].text).toContain('Task 1 repositioned to 0');
    });

    it('throws when the task id is not a positive integer', async () => {
      await expect(
        setTaskPosition({ id: -2, position: 100 }, authManager),
      ).rejects.toThrow('id must be a positive integer');
    });

    it('throws when an explicit projectViewId is invalid', async () => {
      await expect(
        setTaskPosition({ id: 1, position: 100, projectViewId: -1 }, authManager),
      ).rejects.toThrow('projectViewId must be a positive integer');
    });

    it('throws when an explicit projectId is invalid', async () => {
      await expect(
        setTaskPosition({ id: 1, position: 100, projectId: 0 }, authManager),
      ).rejects.toThrow('projectId must be a positive integer');
    });
  });

  describe('project and view resolution', () => {
    it('resolves project and view ids from the API when both are omitted (default list view)', async () => {
      // 1) GET /tasks/:id  2) GET /projects/:id/views  3) POST position
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ id: 1, project_id: 5, title: 'T' }) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: projectViews }))
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await setTaskPosition({ id: 1, position: 65536 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const urls = mockFetch.mock.calls.map((c) => c[0]);
      expect(urls[0]).toBe('https://vikunja.test/api/v1/tasks/1');
      expect(urls[1]).toBe('https://vikunja.test/api/v1/projects/5/views');
      expect(urls[2]).toBe('https://vikunja.test/api/v1/tasks/1/position');

      // The POST body carries the full TaskPosition payload, resolved to
      // the list view (id 10) by default.
      const [, postInit] = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(postInit.method).toBe('POST');
      expect(postInit.body).toBe(
        JSON.stringify({ task_id: 1, project_view_id: 10, position: 65536 }),
      );

      const text = result.content[0].text;
      expect(text).toContain('Task 1 repositioned to 65536 in view 10');
      expect(text).toContain('Success');
    });

    it('resolves the Kanban view when viewKind is explicitly set to kanban', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ id: 1, project_id: 5 }) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: projectViews }))
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      await setTaskPosition(
        { id: 1, position: 5, viewKind: 'kanban' },
        authManager,
      );

      const [, postInit] = mockFetch.mock.calls[2] as [string, RequestInit];
      expect(postInit.body).toBe(
        JSON.stringify({ task_id: 1, project_view_id: 11, position: 5 }),
      );
    });

    it('does not fetch the task when projectId is supplied explicitly', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: projectViews }))
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      await setTaskPosition({ id: 1, position: 5, projectId: 5 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const urls = mockFetch.mock.calls.map((c) => c[0]);
      expect(urls[0]).toBe('https://vikunja.test/api/v1/projects/5/views');
      expect(urls[1]).toBe('https://vikunja.test/api/v1/tasks/1/position');
    });

    it('does not resolve the view when projectViewId is supplied explicitly', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ id: 1, project_id: 8 }) }),
        )
        .mockResolvedValueOnce(mockResponse({ text: '' }));

      await setTaskPosition({ id: 1, position: 5, projectViewId: 22 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const urls = mockFetch.mock.calls.map((c) => c[0]);
      expect(urls[0]).toBe('https://vikunja.test/api/v1/tasks/1');
      expect(urls[1]).toBe('https://vikunja.test/api/v1/tasks/1/position');

      const [, postInit] = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(postInit.body).toBe(
        JSON.stringify({ task_id: 1, project_view_id: 22, position: 5 }),
      );
    });

    it('issues only the position POST when both projectId and projectViewId are supplied', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await setTaskPosition(
        { id: 1, position: 5, projectId: 5, projectViewId: 10, sessionId: 'sess-1' },
        authManager,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/tasks/1/position');
      expect(result.content[0].type).toBe('text');
    });

    it('throws NOT_FOUND when the task lookup returns no body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      await expect(
        setTaskPosition({ id: 1, position: 5 }, authManager),
      ).rejects.toThrow(
        new MCPError(
          ErrorCode.NOT_FOUND,
          'Could not resolve the project of task 1',
        ),
      );
    });

    it('throws NOT_FOUND when the task has no numeric project_id', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 1, project_id: 'oops' }) }),
      );

      try {
        await setTaskPosition({ id: 1, position: 5 }, authManager);
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).code).toBe(ErrorCode.NOT_FOUND);
      }
    });

    it('throws NOT_FOUND when the project has no view of the requested kind', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ id: 1, project_id: 5 }) }),
        )
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([
              { id: 11, title: 'Kanban', project_id: 5, view_kind: 'kanban' },
            ]),
          }),
        );

      await expect(
        setTaskPosition({ id: 1, position: 5 }, authManager),
      ).rejects.toThrow('Project 5 has no list view');
    });
  });

  describe('error propagation', () => {
    it('propagates an HTTP error from the position POST', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: 'invalid task position object provided',
        }),
      );

      await expect(
        setTaskPosition(
          { id: 1, position: 5, projectId: 5, projectViewId: 10 },
          authManager,
        ),
      ).rejects.toThrow(MCPError);
    });

    it('propagates a network error raised while resolving the task', async () => {
      mockFetch.mockRejectedValue(new Error('network down'));

      await expect(
        setTaskPosition({ id: 1, position: 5 }, authManager),
      ).rejects.toThrow('Vikunja REST request failed (GET /tasks/1): network down');
    });
  });
});
