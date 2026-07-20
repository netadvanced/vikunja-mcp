/**
 * Tests for task creation race condition fix
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AuthManager } from '../../src/auth/AuthManager';
import { registerTasksTool } from '../../src/tools/tasks';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';

// Mock the main module and its dependencies. The tasks tool's session guard
// now calls getAuthManagerFromContext(); provide it so the guard resolves.
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
  hasRequestContext: jest.fn(() => false),
}));

// Migrated (Wave D, node-vikunja removal): create/get/delete's core calls AND
// the label/assignee sub-resource calls now all go through vikunjaRestRequest
// (direct REST). Base create is PUT /projects/{id}/tasks; per-label add is
// PUT /tasks/{id}/labels; per-user assign is PUT /tasks/{id}/assignees; rollback
// is DELETE /tasks/{id}. These race-condition/rollback scenarios drive those
// REST calls directly, so routing must discriminate by path, not just method.
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Avoid shared "anonymous" circuit breaker replaying stale ops across tests
jest.mock('../../src/utils/retry', () => {
  const actual = jest.requireActual('../../src/utils/retry');
  return {
    ...actual,
    withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  };
});

// Import the mocked functions
import { getClientFromContext, getAuthManagerFromContext } from '../../src/client';
import { vikunjaRestRequest } from '../../src/utils/vikunja-rest';

describe('Tasks Tool - Race Condition Fix', () => {
  let mockServer: MockServer;
  let mockAuthManager: MockAuthManager;
  let mockClient: MockVikunjaClient;
  let toolHandler: (args: any) => Promise<any>;
  let consoleErrorSpy: jest.SpyInstance;
  const mockRest = vikunjaRestRequest as jest.Mock;

  /** Sentinel wrapper marking a routeRest handler value as a rejection. */
  const REJECT = (value: unknown): { __reject: true; value: unknown } => ({ __reject: true, value });

  type RestHandler = unknown | ((path: string) => unknown);

  /**
   * Routes vikunjaRestRequest calls to per-HTTP-method fixtures/errors. Because
   * PUT is now used for both the base-task create (`/projects/{id}/tasks`) and
   * the label/assignee sub-resource adds (`/tasks/{id}/labels`,
   * `/tasks/{id}/assignees`), a method handler may be a function of the request
   * path so a single method can succeed for one path and fail for another.
   */
  function routeRest(handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', RestHandler>>): void {
    mockRest.mockImplementation((_auth: unknown, method: string, path: string) => {
      let handler = handlers[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
      if (typeof handler === 'function') {
        handler = (handler as (p: string) => unknown)(path);
      }
      if (handler && typeof handler === 'object' && (handler as { __reject?: true }).__reject === true) {
        return Promise.reject((handler as { value: unknown }).value);
      }
      return Promise.resolve(handler);
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up console.error spy
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // Create mock server
    mockServer = {
      tool: jest.fn(),
    } as MockServer;

    // Create mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockReturnValue({
        apiUrl: 'https://vikunja.example.com',
        apiToken: 'test-token',
        userId: 1,
      }),
      getAuthenticatedClient: jest.fn(),
      updateCredentials: jest.fn(),
      clearCredentials: jest.fn(),
      verifyCredentials: jest.fn(),
      getCredentials: jest.fn(),
      authenticate: jest.fn(),
      setSession: jest.fn(),
      clearSession: jest.fn(),
    } as MockAuthManager;

    // Create mock Vikunja client
    mockClient = {
      getToken: jest.fn(),
      projects: {} as any,
      labels: {} as any,
      users: {} as any,
      teams: {} as any,
      shares: {} as any,
      tasks: {
        getAllTasks: jest.fn(),
        getProjectTasks: jest.fn(),
        createTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        addLabelToTask: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
        getTask: jest.fn(),
        deleteTask: jest.fn(),
        updateTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        getTaskComments: jest.fn(),
        createTaskComment: jest.fn(),
        bulkUpdateTasks: jest.fn(),
      },
    } as MockVikunjaClient;

    (getClientFromContext as jest.Mock).mockReturnValue(mockClient);
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    // Session guard: getAuthManagerFromContext()'s result is discarded (ops use
    // the injected authManager), so resolving to any object passes the guard.
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue({});

    // Register the tool
    registerTasksTool(mockServer as any, mockAuthManager);

    // Capture the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_tasks',
      expect.any(String),  // description parameter
      expect.any(Object),  // schema parameter
      expect.any(Object), // ToolAnnotations
      expect.any(Function), // handler parameter
    );
    toolHandler = mockServer.tool.mock.calls[0][mockServer.tool.mock.calls[0].length - 1];  // Handler is always the last argument
  });

  afterEach(() => {
    // Restore console.error
    consoleErrorSpy.mockRestore();
  });

  describe('create subcommand - race condition handling', () => {
    it('should rollback task creation if label assignment fails', async () => {
      const createdTask = {
        id: 123,
        title: 'Test Task',
        project_id: 1,
      };

      // Base create succeeds; the first label add (PUT /tasks/123/labels) fails.
      routeRest({
        PUT: (path) =>
          path === '/projects/1/tasks'
            ? createdTask
            : REJECT(new Error('Label assignment failed')),
        DELETE: null,
      });

      const args = {
        subcommand: 'create',
        projectId: 1,
        title: 'Test Task',
        labels: [1, 2, 3],
      };

      // Should throw error with rollback success message
      await expect(toolHandler(args)).rejects.toThrow(MCPError);
      await expect(toolHandler(args)).rejects.toThrow(
        'Failed to complete task creation: Label assignment failed. Task was successfully rolled back.',
      );

      // Verify cleanup was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/123');
    });

    it('should rollback task creation if assignee assignment fails', async () => {
      const createdTask = {
        id: 456,
        title: 'Test Task',
        project_id: 1,
      };

      // Base create + label adds succeed; the assignee add (PUT
      // /tasks/456/assignees) fails.
      routeRest({
        PUT: (path) => {
          if (path === '/projects/1/tasks') return createdTask;
          if (path === '/tasks/456/assignees') return REJECT(new Error('User assignment failed'));
          return {}; // label adds (PUT /tasks/456/labels) succeed
        },
        DELETE: null,
      });

      const args = {
        subcommand: 'create',
        projectId: 1,
        title: 'Test Task',
        labels: [1, 2],
        assignees: [10, 20],
      };

      // Should throw error with rollback success message
      await expect(toolHandler(args)).rejects.toThrow(MCPError);
      await expect(toolHandler(args)).rejects.toThrow(
        'Failed to complete task creation: User assignment failed. Task was successfully rolled back.',
      );

      // Verify cleanup was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/456');
    });

    it('should include error details when rollback fails', async () => {
      const createdTask = {
        id: 789,
        title: 'Test Task',
        project_id: 1,
      };

      // Label add fails, and the rollback DELETE also fails.
      routeRest({
        PUT: (path) =>
          path === '/projects/1/tasks'
            ? createdTask
            : REJECT(new Error('Label assignment failed')),
        DELETE: REJECT(new Error('Delete failed')),
      });

      const args = {
        subcommand: 'create',
        projectId: 1,
        title: 'Test Task',
        labels: [1, 2, 3],
      };

      // Should still throw the original error with rollback status
      await expect(toolHandler(args)).rejects.toThrow(
        'Failed to complete task creation: Label assignment failed. Task rollback also failed - manual cleanup may be required.',
      );

      // Verify cleanup was attempted and error was logged
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/789');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Failed to clean up partially created task:'),
      );
    });

    it('should validate assignee IDs before creating task', async () => {
      const args = {
        subcommand: 'create',
        projectId: 1,
        title: 'Test Task',
        assignees: ['invalid', 'abc'],
      };

      // Should throw validation error before creating task
      await expect(toolHandler(args)).rejects.toThrow(MCPError);
      await expect(toolHandler(args)).rejects.toThrow('assignee ID must be a positive integer');

      // Verify task was NOT created
      expect(mockRest).not.toHaveBeenCalled();
    });

    it('should successfully create task with labels and assignees when all operations succeed', async () => {
      const createdTask = {
        id: 999,
        title: 'Test Task',
        project_id: 1,
      };

      const completeTask = {
        ...createdTask,
        labels: [{ id: 1, title: 'Label 1' }],
        assignees: [{ id: 10, username: 'user1' }],
      };

      // Base create returns the task; label/assignee adds (other PUT paths)
      // succeed; the refresh GET returns the fully-populated task.
      routeRest({
        PUT: (path) => (path === '/projects/1/tasks' ? createdTask : {}),
        GET: completeTask,
      });

      const args = {
        subcommand: 'create',
        projectId: 1,
        title: 'Test Task',
        labels: [1],
        assignees: [10],
      };

      const result = await toolHandler(args);
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-task');
      expect(markdown).toContain('Task created successfully');

      // Verify no cleanup was attempted
      expect(mockRest).not.toHaveBeenCalledWith(mockAuthManager, 'DELETE', expect.anything());
    });
  });
});
