/**
 * Tests for assignee operations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { assignUsers, unassignUsers, listAssignees } from '../../../src/tools/tasks/assignees';
import { AuthManager } from '../../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../../src/types';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

// Mock withRetry with a lightweight retry that HONORS the caller's shouldRetry
// predicate but skips the production backoff delays. This lets the tests drive
// real HTTP responses through the mocked fetch and actually exercise the
// 401-only retry predicate — so we can assert attempt counts (the #154
// regression guard: a resource 403 must be attempted exactly once, never
// retried as auth). createCircuitBreaker/circuitBreakerRegistry stay real:
// every op goes through vikunjaRestRequest, which needs a working breaker
// around the mocked global fetch.
jest.mock('../../../src/utils/retry', () => {
  const actual = jest.requireActual('../../../src/utils/retry');
  return {
    ...(actual as object),
    withRetry: async <T>(
      operation: () => Promise<T>,
      options?: { maxRetries?: number; shouldRetry?: (error: unknown) => boolean },
    ): Promise<T> => {
      const maxRetries = options?.maxRetries ?? 0;
      const shouldRetry = options?.shouldRetry ?? (() => false);
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      for (;;) {
        try {
          return await operation();
        } catch (error) {
          if (attempt < maxRetries && shouldRetry(error)) {
            attempt += 1;
            continue;
          }
          throw error;
        }
      }
    },
  };
});
jest.mock('../../../src/utils/logger');

describe('Assignee operations', () => {
  // assignUsers/unassignUsers/listAssignees all go through the direct-REST
  // helper (vikunjaRestRequest) now — including the task refresh/verification
  // reads (fetchTaskWithAssignees -> getTaskViaRest -> GET /tasks/{id}). So
  // tests drive a mocked global fetch and a real AuthManager session rather
  // than node-vikunja client method mocks.
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;
  let authManager: AuthManager;

  const restOk = (body: unknown = {}): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn(async () => JSON.stringify(body)),
    }) as unknown as Response;

  // Route GET /tasks/{id} (the verify + refresh reads) to a supplied task,
  // while PUT (assign) / DELETE (unassign) resolve to an empty success body.
  const routeTaskFetch = (taskProvider: unknown | (() => unknown)): void => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = new URL(url).pathname;
      if (method === 'GET' && /^\/api\/v1\/tasks\/\d+$/.test(path)) {
        const task = typeof taskProvider === 'function' ? (taskProvider as () => unknown)() : taskProvider;
        return restOk(task);
      }
      return restOk({});
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue(restOk({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('assignUsers', () => {
    it('should assign users to task successfully', async () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        assignees: [{ id: 1, name: 'User 1' }, { id: 2, name: 'User 2' }],
      };
      routeTaskFetch(mockTask);

      const result = await assignUsers({
        id: 123,
        assignees: [1, 2],
      }, authManager);

      // Uses the additive per-user endpoint (one PUT call per assignee), NOT
      // the bulk endpoint that would silently unassign everyone (upstream #15).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user_id: 1 }) }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user_id: 2 }) }),
      );
      const putCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCalls).toHaveLength(2);
      // Verification + refresh read the task back via GET /tasks/{id}.
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('assign');
      expect(markdown).toContain('Users assigned to task successfully');
    });

    it('assigns users one at a time, never overlapping two in-flight PUTs (post-#89 lock-contention fix)', async () => {
      // Regression test: assignUsersToTask used to fire all per-user PUTs
      // concurrently via Promise.all, which risks "database is locked" 500s
      // on SQLite-backed Vikunja when multiple writes hit the same task
      // at once (the same class of bug PR #89/#95 fixed for bulk-update's
      // assignee restore). This asserts the second PUT is only issued after
      // the first one's response has resolved.
      const mockTask = { id: 123, title: 'Test Task', assignees: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      let inFlight = 0;
      let maxConcurrentPuts = 0;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'PUT' && /\/assignees$/.test(path)) {
          inFlight++;
          maxConcurrentPuts = Math.max(maxConcurrentPuts, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          return restOk({});
        }
        if (method === 'GET' && /^\/api\/v1\/tasks\/\d+$/.test(path)) {
          return restOk(mockTask);
        }
        return restOk({});
      });

      await assignUsers({ id: 123, assignees: [1, 2, 3] }, authManager);

      expect(maxConcurrentPuts).toBe(1);
      const putCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCalls).toHaveLength(3);
    });

    it('should warn when assignees are not persisted (silent API failure)', async () => {
      // The REST PUT resolves, but the re-fetched task shows no assignees —
      // the defense-in-depth verification (adapted from PR #43) must surface it.
      const mockTaskNoAssignees = {
        id: 123,
        title: 'Test Task',
        assignees: [], // API reported success but nothing persisted
      };
      routeTaskFetch(mockTaskNoAssignees);

      const result = await assignUsers({
        id: 123,
        assignees: [1, 2],
      }, authManager);

      const markdown = result.content[0].text;
      expect(markdown).toContain('not persisted');
      expect(markdown).toContain('JWT authentication');
      expect(markdown).toContain('1, 2');
    });

    it('should not warn and should fail open when verification re-fetch errors', async () => {
      // The REST PUTs succeed; the first GET (verification) throws, but the
      // second GET (refresh) succeeds — verification must fail open (no false
      // warning) and the operation still reports success.
      const mockTask = {
        id: 123,
        title: 'Test Task',
        assignees: [{ id: 1, name: 'User 1' }, { id: 2, name: 'User 2' }],
      };
      let getCount = 0;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'GET' && /^\/api\/v1\/tasks\/\d+$/.test(path)) {
          getCount += 1;
          if (getCount === 1) throw new Error('verification fetch failed');
          return restOk(mockTask);
        }
        return restOk({});
      });

      const result = await assignUsers({
        id: 123,
        assignees: [1, 2],
      }, authManager);

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).not.toContain('not persisted');
    });

    it('should throw error when task id is missing', async () => {
      await expect(assignUsers({ assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Task id is required for assign operation'
      );
    });

    it('should throw error when task id is zero', async () => {
      await expect(assignUsers({ id: 0, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Task id is required for assign operation'
      );
    });

    it('should throw error when task id is negative', async () => {
      await expect(assignUsers({ id: -1, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'id must be a positive integer'
      );
    });

    it('should throw error when assignees array is missing', async () => {
      await expect(assignUsers({ id: 123 }, authManager)).rejects.toThrow(
        'At least one assignee (user id) is required'
      );
    });

    it('should throw error when assignees array is empty', async () => {
      await expect(assignUsers({ id: 123, assignees: [] }, authManager)).rejects.toThrow(
        'At least one assignee (user id) is required'
      );
    });

    it('should throw error when assignee id is invalid', async () => {
      await expect(assignUsers({ id: 123, assignees: [1, -2] }, authManager)).rejects.toThrow(
        'assignee ID must be a positive integer'
      );
    });

    it('retries a genuine 401 on assign and surfaces it as an auth error', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT') {
          return { ok: false, status: 401, statusText: 'Unauthorized', text: jest.fn(async () => '') } as unknown as Response;
        }
        return restOk({});
      });

      await expect(assignUsers({ id: 123, assignees: [1] }, authManager)).rejects.toThrow(
        /prevents assigning users to tasks\. \(Retried 3 times\)/
      );

      // A genuine 401 is retried by the outer auth-retry loop (1 initial + 3).
      const putCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCalls).toHaveLength(4);
    });

    it('surfaces a non-auth 403 on assign as the real error, attempted exactly once', async () => {
      // #154 class: a resource 403 must NOT be masked as auth or retried.
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'PUT') {
          return { ok: false, status: 403, statusText: 'Forbidden', text: jest.fn(async () => 'forbidden') } as unknown as Response;
        }
        return restOk({});
      });

      await expect(assignUsers({ id: 123, assignees: [1] }, authManager)).rejects.toThrow(/HTTP 403/);

      const putCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT');
      expect(putCalls).toHaveLength(1);
    });

    it('should handle MCPError instances propagated from the task read', async () => {
      // The assign PUTs succeed (withRetry default), then the task read throws
      // an MCPError; the REST layer wraps its message, and assignUsers surfaces
      // it under its own "Failed to assign users to task" prefix.
      const mcpError = new MCPError(ErrorCode.VALIDATION_ERROR, 'Validation failed');
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'GET' && /^\/api\/v1\/tasks\/\d+$/.test(path)) {
          throw mcpError;
        }
        return restOk({});
      });

      await expect(assignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        /Failed to assign users to task:.*Validation failed/
      );
    });
  });

  describe('unassignUsers', () => {
    it('should unassign users from task successfully', async () => {
      const mockTask = {
        id: 123,
        title: 'Test Task',
        assignees: [],
      };
      routeTaskFetch(mockTask);

      const result = await unassignUsers({
        id: 123,
        assignees: [1, 2],
      }, authManager);

      const deleteCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees/2',
        expect.objectContaining({ method: 'DELETE' }),
      );
      // Refresh reads the task back via GET /tasks/{id}.
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('unassign');
      expect(markdown).toContain('Users removed from task successfully');
    });

    it('should throw error when task id is missing', async () => {
      await expect(unassignUsers({ assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Task id is required for unassign operation'
      );
    });

    it('should throw error when task id is zero', async () => {
      await expect(unassignUsers({ id: 0, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Task id is required for unassign operation'
      );
    });

    it('should throw error when assignees array is missing', async () => {
      await expect(unassignUsers({ id: 123 }, authManager)).rejects.toThrow(
        'At least one assignee (user id) is required to unassign'
      );
    });

    it('should throw error when assignees array is empty', async () => {
      await expect(unassignUsers({ id: 123, assignees: [] }, authManager)).rejects.toThrow(
        'At least one assignee (user id) is required to unassign'
      );
    });

    it('retries a genuine 401 on unassign and surfaces it as an auth error', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'DELETE') {
          return { ok: false, status: 401, statusText: 'Unauthorized', text: jest.fn(async () => '') } as unknown as Response;
        }
        return restOk({});
      });

      await expect(unassignUsers({ id: 123, assignees: [1] }, authManager)).rejects.toThrow(
        /prevents removing users from tasks\. \(Retried 3 times\)/
      );

      // A genuine 401 is retried by the outer auth-retry loop (1 initial + 3).
      const deleteCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(4);
    });

    it('treats unassigning a user that is not assigned as an idempotent no-op (Vikunja 403)', async () => {
      // #154 twin: Vikunja returns 403 for a user that is not assigned. The old
      // code misclassified that as auth, retried it 3×, and surfaced a
      // misleading "(Retried 3 times)" error. It must be an idempotent no-op.
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'DELETE') {
          return { ok: false, status: 403, statusText: 'Forbidden', text: jest.fn(async () => '') } as unknown as Response;
        }
        // Reconcile: user 5 is genuinely not assigned.
        if (method === 'GET' && path === '/api/v1/tasks/123/assignees') {
          return restOk([]);
        }
        return restOk({ id: 123, title: 'T', assignees: [] });
      });

      const result = await unassignUsers({ id: 123, assignees: [5] }, authManager);
      expect(result.content[0].text).toContain('## ✅ Success');

      // The 403 must be attempted exactly once, never retried.
      const deleteCalls = fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
    });

    it('reports a clear, user/task-specific error when a user is still assigned after a failed removal', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'DELETE') {
          return { ok: false, status: 403, statusText: 'Forbidden', text: jest.fn(async () => '') } as unknown as Response;
        }
        // Reconcile: user 5 is STILL assigned (e.g. no write access).
        if (method === 'GET' && path === '/api/v1/tasks/123/assignees') {
          return restOk([{ id: 5, username: 'user5' }]);
        }
        return restOk({});
      });

      await expect(unassignUsers({ id: 123, assignees: [5] }, authManager)).rejects.toThrow(
        /Could not remove user 5 from task 123/
      );
    });

    it('removes assigned users while reporting ones that could not be removed', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const path = new URL(url).pathname;
        if (method === 'DELETE' && path.endsWith('/assignees/2')) {
          return { ok: false, status: 403, statusText: 'Forbidden', text: jest.fn(async () => '') } as unknown as Response;
        }
        if (method === 'DELETE') return restOk({}); // user 1 removed
        // Reconcile: user 2 is still assigned.
        if (method === 'GET' && path === '/api/v1/tasks/123/assignees') {
          return restOk([{ id: 2, username: 'user2' }]);
        }
        return restOk({});
      });

      await expect(unassignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        /Could not remove user 2 from task 123/
      );
    });
  });

  describe('listAssignees', () => {
    // Uses the dedicated GET /tasks/{taskID}/assignees endpoint directly
    // (see docs/API-COVERAGE.md's row for this endpoint) rather than reading
    // task.assignees off GET /tasks/{id} — so these tests assert against the
    // mocked global fetch.
    const restOk = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify(body)),
      }) as unknown as Response;

    it('should list assignees successfully', async () => {
      fetchMock.mockResolvedValue(
        restOk([
          { id: 1, username: 'user1', name: 'User 1' },
          { id: 2, username: 'user2', name: 'User 2' },
        ]),
      );

      const result = await listAssignees({ id: 123 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('get');
      expect(markdown).toContain('Task 123 has 2 assignee(s)');
    });

    it('should handle task with no assignees', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      const result = await listAssignees({ id: 123 }, authManager);

      const markdown = result.content[0].text;
      expect(markdown).toContain('Task 123 has 0 assignee(s)');
    });

    it('should treat a non-array response body as no assignees', async () => {
      // Defensive: fetchAssigneesViaRest coerces anything non-array (e.g. a
      // malformed/empty response) to [] rather than propagating it raw.
      fetchMock.mockResolvedValue(restOk(null));

      const result = await listAssignees({ id: 123 }, authManager);

      const markdown = result.content[0].text;
      expect(markdown).toContain('Task 123 has 0 assignee(s)');
    });

    it('forwards search/page/perPage as s/page/per_page query params', async () => {
      fetchMock.mockResolvedValue(restOk([{ id: 1, username: 'alice' }]));

      await listAssignees({ id: 123, search: 'ali', page: 2, perPage: 10 }, authManager);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe('/api/v1/tasks/123/assignees');
      expect(parsedUrl.searchParams.get('s')).toBe('ali');
      expect(parsedUrl.searchParams.get('page')).toBe('2');
      expect(parsedUrl.searchParams.get('per_page')).toBe('10');
    });

    it('omits query params entirely when none are supplied', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      await listAssignees({ id: 123 }, authManager);

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/tasks/123/assignees');
    });

    it('should throw error when task id is undefined', async () => {
      await expect(listAssignees({}, authManager)).rejects.toThrow(
        'Task id is required for list-assignees operation'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should handle zero task id', async () => {
      await expect(listAssignees({ id: 0 }, authManager)).rejects.toThrow(
        'id must be a positive integer'
      );
    });

    it('should handle negative task id', async () => {
      await expect(listAssignees({ id: -1 }, authManager)).rejects.toThrow(
        'id must be a positive integer'
      );
    });

    it('rejects a non-positive page', async () => {
      await expect(listAssignees({ id: 123, page: 0 }, authManager)).rejects.toThrow(
        'page must be a positive integer'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a non-positive perPage', async () => {
      await expect(listAssignees({ id: 123, perPage: -1 }, authManager)).rejects.toThrow(
        'perPage must be a positive integer'
      );
    });

    it('should handle a non-OK HTTP response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn(async () => 'task not found'),
      } as unknown as Response);

      await expect(listAssignees({ id: 123 }, authManager)).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/123/assignees): HTTP 404 Not Found — task not found',
      );
    });

    it('should preserve MCPError instances raised by the REST layer', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        text: jest.fn(async () => ''),
      } as unknown as Response);

      await expect(listAssignees({ id: 123 }, authManager)).rejects.toBeInstanceOf(MCPError);
    });

    it('should wrap network-level failures', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      await expect(listAssignees({ id: 123 }, authManager)).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/123/assignees): ECONNRESET',
      );
    });
  });

  // Integration tests
  describe('Integration scenarios', () => {
    it('should handle complete assign-unassign workflow', async () => {
      // A single mutable "current task" backs the GET /tasks/{id} reads for
      // both the assign (verify + refresh) and unassign (refresh) flows.
      let currentTask: unknown = {
        id: 123,
        title: 'Test Task',
        assignees: [{ id: 1, name: 'User 1' }],
      };
      routeTaskFetch(() => currentTask);

      const assignResult = await assignUsers({ id: 123, assignees: [1] }, authManager);
      const assignMarkdown = assignResult.content[0].text;
      expect(assignMarkdown).toContain('Users assigned to task successfully');

      currentTask = {
        id: 123,
        title: 'Test Task',
        assignees: [],
      };

      const unassignResult = await unassignUsers({ id: 123, assignees: [1] }, authManager);
      const unassignMarkdown = unassignResult.content[0].text;
      expect(unassignMarkdown).toContain('Users removed from task successfully');
    });

    it('should handle multiple assignees with mixed validation errors', async () => {
      await expect(assignUsers({
        id: 123,
        assignees: [1, 0, -1] // Mix of valid and invalid IDs
      }, authManager)).rejects.toThrow('assignee ID must be a positive integer');
    });
  });
});
