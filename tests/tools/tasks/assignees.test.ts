/**
 * Tests for assignee operations
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { assignUsers, unassignUsers, listAssignees } from '../../../src/tools/tasks/assignees';
import { getClientFromContext } from '../../../src/client';
import { AuthManager } from '../../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../../src/types';
import { isAuthenticationError } from '../../../src/utils/auth-error-handler';
import { withRetry, circuitBreakerRegistry } from '../../../src/utils/retry';
import { parseMarkdown } from '../../utils/markdown';

jest.mock('../../../src/client');
jest.mock('../../../src/utils/auth-error-handler');
// Partial mock: only withRetry is overridden (assignUsers/unassignUsers tests
// drive it directly), while createCircuitBreaker/circuitBreakerRegistry stay
// real — listAssignees goes through the direct-REST helper
// (vikunjaRestRequest), which needs a working circuit breaker around the
// mocked global fetch below.
jest.mock('../../../src/utils/retry', () => {
  const actual = jest.requireActual('../../../src/utils/retry');
  return {
    ...(actual as object),
    withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  };
});
jest.mock('../../../src/utils/logger');

describe('Assignee operations', () => {
  // fetchTaskWithAssignees/verifyAssignees still read the task via
  // node-vikunja's client.tasks.getTask (a deliberate leftover — GET
  // /tasks/{id} is task CRUD, owned by a different wave item), so it's still
  // mocked here even though assign/unassign themselves now go through REST.
  const mockClient = {
    tasks: {
      getTask: jest.fn(),
    },
  };

  // assignUsers/unassignUsers/listAssignees all call the direct-REST helper
  // (vikunjaRestRequest) now, so tests drive a mocked global fetch and a real
  // AuthManager session rather than node-vikunja assignUserToTask/
  // removeUserFromTask mocks.
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

  beforeEach(() => {
    jest.clearAllMocks();
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    (withRetry as jest.Mock).mockImplementation((fn) => fn());

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

      mockClient.tasks.getTask.mockResolvedValue(mockTask);

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
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(123);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('assign');
      expect(markdown).toContain('Users assigned to task successfully');
    });

    it('should warn when assignees are not persisted (silent API failure)', async () => {
      // The REST PUT resolves, but the re-fetched task shows no assignees —
      // the defense-in-depth verification (adapted from PR #43) must surface it.
      const mockTaskNoAssignees = {
        id: 123,
        title: 'Test Task',
        assignees: [], // API reported success but nothing persisted
      };

      mockClient.tasks.getTask.mockResolvedValue(mockTaskNoAssignees);

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
      // The REST PUT succeeds; the verification re-fetch throws, but the
      // main fetch succeeds — verification must fail open (no false warning).
      const mockTask = {
        id: 123,
        title: 'Test Task',
        assignees: [{ id: 1, name: 'User 1' }, { id: 2, name: 'User 2' }],
      };

      mockClient.tasks.getTask
        .mockRejectedValueOnce(new Error('verification fetch failed'))
        .mockResolvedValueOnce(mockTask);

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

    it('should handle authentication errors with retry', async () => {
      const authError = new Error('Authentication failed');
      (isAuthenticationError as jest.Mock).mockReturnValue(true);
      (withRetry as jest.Mock).mockRejectedValue(authError);

      await expect(assignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Failed to assign users to task: Assignee operations may have authentication issues with certain Vikunja API versions. This is a known limitation that prevents assigning users to tasks. (Retried 3 times)'
      );
    });

    it('should handle non-authentication API errors', async () => {
      const apiError = new Error('API Error');
      (withRetry as jest.Mock).mockRejectedValue(apiError);

      await expect(assignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Failed to assign users to task: API Error'
      );
    });

    it('should handle unknown error types', async () => {
      const unknownError = { message: 'Unknown error' };
      (withRetry as jest.Mock).mockRejectedValue(unknownError);

      await expect(assignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Failed to assign users to task: [object Object]'
      );
    });

    it('should handle MCPError instances properly', async () => {
      const mcpError = new MCPError(ErrorCode.VALIDATION_ERROR, 'Validation failed');
      mockClient.tasks.getTask.mockRejectedValue(mcpError);

      await expect(assignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Failed to assign users to task: Validation failed'
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

      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await unassignUsers({
        id: 123,
        assignees: [1, 2],
      }, authManager);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/123/assignees/2',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(123);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
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

    it('should handle authentication errors during removal', async () => {
      const authError = new Error('Authentication failed');
      (isAuthenticationError as jest.Mock).mockReturnValue(true);
      (withRetry as jest.Mock).mockRejectedValue(authError);

      await expect(unassignUsers({ id: 123, assignees: [1] }, authManager)).rejects.toThrow(
        'Failed to remove users from task: Assignee removal operations may have authentication issues with certain Vikunja API versions. This is a known limitation that prevents removing users from tasks. (Retried 3 times)'
      );
    });

    it('should handle non-authentication errors during removal', async () => {
      const apiError = new Error('API Error');
      (withRetry as jest.Mock).mockRejectedValue(apiError);

      await expect(unassignUsers({ id: 123, assignees: [1] }, authManager)).rejects.toThrow(
        'Failed to remove users from task: API Error'
      );
    });

    it('should handle mixed success and failure during batch removal', async () => {
      const apiError = new Error('User not found');
      (withRetry as jest.Mock)
        .mockResolvedValueOnce({}) // First user succeeds
        .mockRejectedValueOnce(apiError); // Second user fails

      await expect(unassignUsers({ id: 123, assignees: [1, 2] }, authManager)).rejects.toThrow(
        'Failed to remove users from task: User not found'
      );

      // Verify that at least the first removal was attempted
      expect(withRetry).toHaveBeenCalledTimes(2);
    });
  });

  describe('listAssignees', () => {
    // Uses the dedicated GET /tasks/{taskID}/assignees endpoint directly
    // (see docs/API-COVERAGE.md's row for this endpoint) rather than reading
    // task.assignees off GET /tasks/{id} — so these tests assert against the
    // mocked global fetch, not mockClient.tasks.getTask.
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
      const parsed = parseMarkdown(markdown);
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
      const initialTask = {
        id: 123,
        title: 'Test Task',
        assignees: [],
      };
      
      const assignedTask = {
        id: 123,
        title: 'Test Task',
        assignees: [{ id: 1, name: 'User 1' }],
      };
      
      // Mock assignment
      mockClient.tasks.getTask.mockResolvedValue(assignedTask);

      const assignResult = await assignUsers({ id: 123, assignees: [1] }, authManager);

      const assignMarkdown = assignResult.content[0].text;
      expect(assignMarkdown).toContain('Users assigned to task successfully');

      // Mock unassignment
      mockClient.tasks.getTask.mockResolvedValue(initialTask);

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