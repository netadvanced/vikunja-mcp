import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { createMockTestableAuthManager } from '../utils/test-utils';
import {
  registerTasksTool,
  registerTaskBulkTool,
  registerTaskAssigneesTool,
  registerTaskCommentsTool,
  registerTaskRemindersTool,
  registerTaskLabelsTool,
  registerTaskRelationsTool
} from '../../src/tools/index';
import { MCPError, ErrorCode } from '../../src/types';
import type { Task, User } from 'node-vikunja';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';

// Import the function we're mocking
import { getClientFromContext, getAuthManagerFromContext } from '../../src/client';

// Import AORP test helpers
import { extractTasksData, extractTaskData, expectAorpSuccess, expectAorpError, getAorpData, getAorpMetadata } from '../utils/aorp-test-helpers';
import { parseMarkdown } from '../utils/markdown';
import * as retryUtils from '../../src/utils/retry';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Mock the modules. getAuthManagerFromContext is used by setTaskLabels
// (src/utils/label-bulk.ts, migrated to direct REST) — any test that
// updates a task's labels via TaskUpdateService/TaskCreationService/
// bulk-operations-simplified needs it resolved (see beforeEach below).
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');

// Migrated (Wave D, tasks-core): the core create/get/update/delete/list
// calls in TaskCreationService/TaskReadService/TaskUpdateService/
// TaskDeletionService/ClientSideFilteringStrategy/ServerSideFilteringStrategy/
// RestCrossProjectFilteringStrategy/bulk-operations-simplified.ts go through
// vikunjaRestRequest -> fetch now, instead of the node-vikunja client.
// Labels/assignees/comments/reminders/relations remain on the node-vikunja
// client (sub-resource, sibling item M-B); the 'list-assignees' describe
// block below already mocks global.fetch itself for its own dedicated
// REST calls and overrides/restores globalThis.fetch around this file-level
// default.
const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object for the REST helper. */
function mockRestResponse(opts: { ok?: boolean; status?: number; statusText?: string; text?: string }): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

function jsonResponse(data: unknown): Response {
  return mockRestResponse({ text: JSON.stringify(data) });
}

// Avoid shared "anonymous" circuit breaker replaying stale ops across tests
jest.mock('../../src/utils/retry', () => {
  const actual = jest.requireActual('../../src/utils/retry');
  return {
    ...actual,
    withRetry: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  };
});

describe('Tasks Tool', () => {
  let mockClient: MockVikunjaClient;
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}): Promise<any> {
    return toolHandler({
      subcommand,
      ...args,
    });
  }

  /**
   * Builds a fetch router for the bulk describe blocks. Bulk core CRUD
   * (create/get/update/delete) went through vikunjaRestRequest -> fetch in
   * the #70 migration, so those fetches are delegated back to the
   * node-vikunja `mockClient.tasks` methods each test already configures and
   * asserts on. setTaskLabels' POST /tasks/{id}/labels/bulk (#71) is routed
   * to `labelWrite`, letting label-write failures be simulated without
   * affecting the core create/update fetches.
   */
  function makeTaskCrudFetchRouter(labelWrite: jest.Mock): jest.Mock {
    return jest.fn(async (url: string, init?: { method?: string; body?: string }) => {
      const pathname = new URL(url).pathname.replace(/^\/api\/v\d+/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;

      const labelBulkMatch = /^\/tasks\/(\d+)\/labels\/bulk$/.exec(pathname);
      if (method === 'POST' && labelBulkMatch?.[1] !== undefined) {
        await labelWrite(Number(labelBulkMatch[1]), body);
        return jsonResponse({ labels: [] });
      }
      const taskIdMatch = /^\/tasks\/(\d+)$/.exec(pathname);
      if (taskIdMatch?.[1] !== undefined) {
        const taskId = Number(taskIdMatch[1]);
        if (method === 'GET') return jsonResponse(await mockClient.tasks.getTask(taskId));
        if (method === 'POST') return jsonResponse(await mockClient.tasks.updateTask(taskId, body));
        if (method === 'DELETE') return jsonResponse(await mockClient.tasks.deleteTask(taskId));
      }
      const projectTasksMatch = /^\/projects\/(-?\d+)\/tasks$/.exec(pathname);
      if (method === 'PUT' && projectTasksMatch?.[1] !== undefined) {
        return jsonResponse(await mockClient.tasks.createTask(Number(projectTasksMatch[1]), body));
      }
      throw new Error(`makeTaskCrudFetchRouter: unhandled ${method} ${pathname}`);
    });
  }

  // Mock data
  const mockTask: Task = {
    id: 1,
    title: 'Test Task',
    description: 'Test Description',
    done: false,
    doneAt: null,
    priority: 5,
    labels: [],
    assignees: [],
    dueDate: null,
    startDate: null,
    endDate: null,
    repeatAfter: 0,
    repeatFromCurrentDate: false,
    reminderDates: [],
    hexColor: '',
    percentDone: 0,
    relatedTasks: {},
    attachments: [],
    coverImageAttachmentId: null,
    identifier: 'TASK-1',
    index: 1,
    isFavorite: false,
    subscription: null,
    position: 0,
    kanbanPosition: 0,
    reactions: {},
    createdBy: {
      id: 1,
      username: 'user1',
      email: 'user1@example.com',
      name: 'User One',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    bucketId: 0,
    projectId: 1,
    project_id: 1,
  } as any;

  const mockUser: User = {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    name: 'Test User',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  const mockComment = {
    id: 1,
    comment: 'Test comment',
    author: mockUser,
    taskId: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    reactions: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client
    mockClient = {
      getToken: jest.fn().mockReturnValue('test-token'),
      tasks: {
        getAllTasks: jest.fn(),
        getProjectTasks: jest.fn(),
        createTask: jest.fn(),
        getTask: jest.fn(),
        updateTask: jest.fn(),
        deleteTask: jest.fn(),
        getTaskComments: jest.fn(),
        createTaskComment: jest.fn(),
        updateTaskLabels: jest.fn(),
        addLabelToTask: jest.fn(),
        removeLabelFromTask: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        bulkUpdateTasks: jest.fn(),
      },
      projects: {
        getProjects: jest.fn(),
        createProject: jest.fn(),
        getProject: jest.fn(),
        updateProject: jest.fn(),
        deleteProject: jest.fn(),
        createLinkShare: jest.fn(),
        getLinkShares: jest.fn(),
        getLinkShare: jest.fn(),
        deleteLinkShare: jest.fn(),
      },
      labels: {
        getLabels: jest.fn(),
        getLabel: jest.fn(),
        createLabel: jest.fn(),
        updateLabel: jest.fn(),
        deleteLabel: jest.fn(),
      },
      users: {
        getAll: jest.fn(),
      },
      teams: {
        getAll: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      shares: {
        getShareAuth: jest.fn(),
      },
    } as MockVikunjaClient;

    // Proxy the migrated core REST calls (GET/POST/DELETE /tasks/{id}, PUT
    // /projects/{id}/tasks, GET /projects, GET /projects/{id}/tasks,
    // GET /tasks/all) through the existing mockClient.{tasks,projects}
    // mocks above, so every test's per-scenario mock configuration (and
    // call-count/args assertions on those node-vikunja-shaped methods)
    // keeps driving behavior unchanged. The bare cross-project GET /tasks
    // (RestCrossProjectFilteringStrategy's direct-REST primary path) always
    // rejects fast here so tests exercise the per-project aggregation
    // fallback they were written against. A rejected mockClient method call
    // propagates as a genuine fetch()-layer rejection, which the real
    // vikunjaRestRequest wraps into an MCPError, same as a real network
    // failure would.
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    mockFetch.mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname.replace(/^\/api\/v\d+/, '');
      const method = init?.method ?? 'GET';
      const body = init?.body !== undefined ? JSON.parse(init.body) : undefined;

      if (pathname === '/tasks') {
        throw new Error('mock: direct REST GET /tasks unavailable');
      }

      const parseParams = (): Record<string, unknown> => {
        const params: Record<string, unknown> = {};
        const page = parsedUrl.searchParams.get('page');
        const perPage = parsedUrl.searchParams.get('per_page');
        const s = parsedUrl.searchParams.get('s');
        const sortBy = parsedUrl.searchParams.get('sort_by');
        const filter = parsedUrl.searchParams.get('filter');
        if (page !== null) params.page = Number(page);
        if (perPage !== null) params.per_page = Number(perPage);
        if (s !== null) params.s = s;
        if (sortBy !== null) params.sort_by = sortBy;
        if (filter !== null) params.filter = filter;
        return params;
      };

      if (pathname === '/projects') {
        return jsonResponse(await mockClient.projects.getProjects({ per_page: 1000 }));
      }
      if (pathname === '/tasks/all') {
        return jsonResponse(await mockClient.tasks.getAllTasks(parseParams()));
      }
      const projectTasksMatch = /^\/projects\/(-?\d+)\/tasks$/.exec(pathname);
      if (projectTasksMatch?.[1] !== undefined) {
        if (method === 'PUT') {
          return jsonResponse(await mockClient.tasks.createTask(Number(projectTasksMatch[1]), body));
        }
        return jsonResponse(
          await mockClient.tasks.getProjectTasks(Number(projectTasksMatch[1]), parseParams()),
        );
      }

      const taskIdMatch = /^\/tasks\/(\d+)$/.exec(pathname);
      if (taskIdMatch?.[1] !== undefined) {
        const taskId = Number(taskIdMatch[1]);
        if (method === 'GET') return jsonResponse(await mockClient.tasks.getTask(taskId));
        if (method === 'POST') return jsonResponse(await mockClient.tasks.updateTask(taskId, body));
        if (method === 'DELETE') return jsonResponse(await mockClient.tasks.deleteTask(taskId));
      }

      throw new Error(`mockFetch: unhandled ${method} ${pathname}`);
    });

    // Setup mock auth manager
    mockAuthManager = createMockTestableAuthManager();
    mockAuthManager.isAuthenticated.mockReturnValue(true);
    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
      authType: 'api-token' as const,
      userId: 'test-user-123'
    });
    mockAuthManager.getAuthType.mockReturnValue('api-token');

    // Mock getClientFromContext
    (getClientFromContext as jest.Mock).mockReturnValue(mockClient);
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);

    // setTaskLabels (src/utils/label-bulk.ts) now calls the direct-REST
    // helper rather than node-vikunja's updateTaskLabels — resolve the same
    // mockAuthManager session so any test that writes labels (update,
    // bulk-update, bulk-create) can mock global fetch locally. Deliberately
    // NOT setting a blanket default `globalThis.fetch` mock here: several
    // other subcommands (e.g. cross-project `list`) also go through
    // vikunjaRestRequest, and a file-wide default would silently short-
    // circuit their own error-path tests.
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockAuthManager);

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Register the comprehensive tasks tool
    registerTasksTool(mockServer, mockAuthManager);

    // Get the tasks tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_tasks',
      'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, set position, lookup by per-project index). download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead.',
      expect.any(Object),
      expect.any(Function),
    );
    const calls = mockServer.tool.mock.calls;
    if (calls.length > 0 && calls[0] && calls[0].length > 3) {
      toolHandler = calls[0][3];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('list subcommand', () => {
    it('should filter tasks by done status', async () => {
      const mockTasks: Task[] = [
        { ...mockTask, done: true },
        { ...mockTask, id: 2, done: false },
      ];
      // `done` is folded into a filter expression, so this goes through the
      // hybrid strategy: server-side getAllTasks is attempted first (and
      // rejects, matching modern Vikunja's HTTP 400 on GET /tasks/all - see
      // PR #22), then falls back to per-project aggregation via
      // getProjects + getProjectTasks rather than the unreliable getAllTasks
      // endpoint.
      mockClient.tasks.getAllTasks.mockRejectedValue(new Error('Invalid model provided'));
      mockClient.projects.getProjects.mockResolvedValue([{ id: 1, title: 'Project 1' }]);
      mockClient.tasks.getProjectTasks.mockResolvedValue(mockTasks);

      const result = await callTool('list', { done: true });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
            const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('list-tasks');
      expect(markdown).toContain('**count:**');
      expect(markdown).toContain('1');
      // Task data now in markdown with rich formatting
      expect(markdown).toContain('**Status:**');
    });

    it('should include labels and assignees in response', async () => {
      const taskWithDetails = {
        ...mockTask,
        labels: [{ id: 1, title: 'Important' }],
        assignees: [{ id: 1, username: 'user1' }],
      };
      mockClient.projects.getProjects.mockResolvedValue([{ id: 1, title: 'Project 1' }]);
      mockClient.tasks.getProjectTasks.mockResolvedValue([taskWithDetails]);

      const result = await callTool('list');

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      // Now task details SHOULD be in markdown with rich formatting
      expect(markdown).toContain('Test Task'); // Title
      expect(markdown).toContain('**Labels:**');
      expect(markdown).toContain('Important');
      expect(markdown).toContain('**Assignees:**');
      expect(markdown).toContain('user1');
      expect(markdown).toContain('**Status:**'); // Should show status
    });
    it('should list tasks with default options', async () => {
      const mockTasks: Task[] = [mockTask];
      mockClient.projects.getProjects.mockResolvedValue([{ id: 1, title: 'Project 1' }]);
      mockClient.tasks.getProjectTasks.mockResolvedValue(mockTasks);

      const result = await callTool('list');

      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({ per_page: 1000 });
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(1, {
        page: 1,
        per_page: 1000,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
            const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('list-tasks');
      expect(markdown).toContain('**count:**');
    });

    it('should list tasks with all options specified', async () => {
      const mockTasks: Task[] = [mockTask];
      mockClient.tasks.getProjectTasks.mockResolvedValue(mockTasks);

      const result = await callTool('list', {
        projectId: 1,
        page: 2,
        perPage: 25,
        sort: 'dueDate',
        filter: 'priority >= 5',
        search: 'urgent',
      });

      // Server-side filtering is attempted first: the raw filter string is
      // passed straight through to the API alongside pagination.
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(1, {
        filter: 'priority >= 5',
        page: 2,
        per_page: 25,
        sort_by: 'dueDate',
        s: 'urgent',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
            const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('list-tasks');
      expect(markdown).toContain('**count:**');
    });

    it('should handle multiple sort fields', async () => {
      const mockTasks: Task[] = [mockTask];
      mockClient.projects.getProjects.mockResolvedValue([{ id: 1, title: 'Project 1' }]);
      mockClient.tasks.getProjectTasks.mockResolvedValue(mockTasks);

      const result = await callTool('list', {
        sort: 'priority,dueDate',
      });

      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(1, {
        page: 1,
        per_page: 1000,
        sort_by: 'priority,dueDate',
      });

      expect(result).toBeDefined();
    });

    it('should handle authentication errors', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(callTool('list')).rejects.toThrow(
        'Authentication required to access task management features. Please connect first:\n' +
        'vikunja_auth.connect({\n' +
        '  apiUrl: \'https://your-vikunja.com/api/v1\',\n' +
        '  apiToken: \'your-api-token\'\n' +
        '})\n\n' +
        'Get your API token from Vikunja Settings > API Access.'
      );
    });

    it('should handle API errors', async () => {
      // Cross-project aggregation calls getProjects first; a failure there
      // (unlike a single project's getProjectTasks, which is caught and
      // skipped per-project) fails the whole listing. The GET /projects
      // call now goes through vikunjaRestRequest, which wraps the
      // underlying failure into an MCPError (propagated as-is by
      // listTasks) rather than a bare "Failed to list tasks" wrapper.
      mockClient.projects.getProjects.mockRejectedValue(new Error('API Error'));

      await expect(callTool('list')).rejects.toThrow('Vikunja REST request failed (GET /projects?per_page=1000): API Error');
    });

    it('should handle non-Error API errors', async () => {
      mockClient.projects.getProjects.mockRejectedValue('String error');

      await expect(callTool('list')).rejects.toThrow(
        'Vikunja REST request failed (GET /projects?per_page=1000): String error',
      );
    });
  });

  describe('create subcommand', () => {
    it('should validate date format', async () => {
      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          dueDate: 'invalid-date',
        }),
      ).rejects.toThrow('dueDate must be a valid ISO 8601 date string');
    });
    it('should create a task with required fields', async () => {
      // Mock createTask to return a task with an id
      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask });
      // Mock getTask to return the complete task
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await callTool('create', {
        title: 'New Task',
        projectId: 1,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'New Task',
        project_id: 1,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
            const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');    });

    it('should create a task with all optional fields', async () => {
      const fullTask = {
        title: 'Full Task',
        projectId: 1,
        description: 'Full description',
        done: false,
        priority: 5, // Changed from 10 to 5 (max allowed)
        labels: [1, 2],
        assignees: [1, 2],
        dueDate: '2025-01-01T00:00:00Z',
        startDate: '2024-12-01T00:00:00Z',
        endDate: '2025-01-31T00:00:00Z',
        repeatAfter: 86400,
        repeatFromCurrentDate: true,
        reminderDates: ['2024-12-25T00:00:00Z'],
        hexColor: '#FF0000',
        relatedTasks: { related: [2, 3] },
        bucketId: 1,
        position: 100,
      };

      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.getTask.mockResolvedValue({
        ...mockTask,
        ...fullTask,
        labels: [
          { id: 1, title: 'Label 1' },
          { id: 2, title: 'Label 2' },
        ],
      });
      mockClient.tasks.addLabelToTask.mockResolvedValue(undefined);
      mockClient.tasks.assignUserToTask.mockResolvedValue(undefined);

      await callTool('create', fullTask);

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: 'Full Task',
          project_id: 1,
        }),
      );
      expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledWith(1, {
        task_id: 1,
        label_id: 1,
      });
      expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledWith(1, {
        task_id: 1,
        label_id: 2,
      });
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 1);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 2);
    });

    it('should apply labels on create and fail if they do not stick', async () => {
      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.addLabelToTask.mockResolvedValue(undefined);
      // API reports success but labels are missing on refetch
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, id: 1, labels: [] });
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          labels: [4, 3],
        }),
      ).rejects.toThrow('Labels were requested but not attached');

      expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledWith(1, {
        task_id: 1,
        label_id: 4,
      });
      expect(mockClient.tasks.addLabelToTask).toHaveBeenCalledWith(1, {
        task_id: 1,
        label_id: 3,
      });
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });

    it('should fail create when labels are requested but task has no id', async () => {
      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: undefined });

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          labels: [1],
        }),
      ).rejects.toThrow('did not return a task id');
    });

    it('should validate required fields', async () => {
      await expect(callTool('create', {})).rejects.toThrow();
      await expect(callTool('create', { title: 'Test' })).rejects.toThrow();
      await expect(callTool('create', { projectId: 1 })).rejects.toThrow();
    });

    it('should validate priority range', async () => {
      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          priority: -1,
        }),
      ).rejects.toThrow();

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          priority: 6, // Changed from 11 to 6 (just above max)
        }),
      ).rejects.toThrow();
    });

    it('should handle API errors', async () => {
      mockClient.tasks.createTask.mockRejectedValue(new Error('Creation failed'));

      // PUT /projects/{id}/tasks now goes through vikunjaRestRequest, which
      // wraps the underlying failure into an MCPError (propagated as-is by
      // createTask rather than re-wrapped generically).
      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
        }),
      ).rejects.toThrow('Vikunja REST request failed (PUT /projects/1/tasks): Creation failed');
    });

    it('should handle non-Error API errors in create', async () => {
      mockClient.tasks.createTask.mockRejectedValue({ status: 500, message: 'Server error' });

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
        }),
      ).rejects.toThrow('Vikunja REST request failed (PUT /projects/1/tasks)');
    });

    it('should rollback task creation when label assignment fails', async () => {
      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.addLabelToTask.mockRejectedValue(new Error('Label assignment failed'));
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          labels: [1, 2],
        }),
      ).rejects.toThrow('Failed to complete task creation: Label assignment failed');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });

    it('should handle failed rollback when assignee assignment fails', async () => {
      // Spy on console.error to suppress expected error output
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.addLabelToTask.mockResolvedValue(undefined);
      mockClient.tasks.assignUserToTask.mockRejectedValue(
        new Error('Assignee assignment failed'),
      );
      mockClient.tasks.deleteTask.mockRejectedValue(new Error('Delete failed'));

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          labels: [1],
          assignees: [1, 2],
        }),
      ).rejects.toThrow('Failed to complete task creation: Assignee assignment failed');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR] Failed to clean up partially created task:'),
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle task creation with no ID returned', async () => {
      // Mock createTask to return a task without an id
      const taskWithoutId = { ...mockTask, id: undefined };
      mockClient.tasks.createTask.mockResolvedValue(taskWithoutId);

      const result = await callTool('create', {
        title: 'New Task',
        projectId: 1,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'New Task',
        project_id: 1,
      });

      // Should not call getTask when there's no ID
      expect(mockClient.tasks.getTask).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');    });

    it('should handle non-Error failures during label assignment', async () => {
      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.addLabelToTask.mockRejectedValue('Label update failed');
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          labels: [1, 2],
        }),
      ).rejects.toThrow('Failed to complete task creation: Label update failed');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });

    it('should create task with recurring settings', async () => {
      const recurringTask = {
        title: 'Daily Standup',
        projectId: 1,
        repeatAfter: 1,
        repeatMode: 'day' as const,
      };

      mockClient.tasks.createTask.mockResolvedValue({ ...mockTask, id: 1 });
      mockClient.tasks.getTask.mockResolvedValue({
        ...mockTask,
        id: 1,
        title: 'Daily Standup',
        repeat_after: 1,
        repeat_mode: 'day',
      });

      const result = await callTool('create', recurringTask);

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          title: 'Daily Standup',
          project_id: 1,
          repeat_after: 1 * 24 * 60 * 60, // 1 day in seconds
          repeat_mode: 0, // Default mode
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
    });

    it('should validate repeatAfter is non-negative', async () => {
      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          repeatAfter: -1,
          repeatMode: 'day',
        }),
      ).rejects.toThrow();
    });

    it('should validate repeatMode values', async () => {
      await expect(
        callTool('create', {
          title: 'Test',
          projectId: 1,
          repeatAfter: 1,
          repeatMode: 'invalid',
        }),
      ).rejects.toThrow();
    });
  });

  describe('get subcommand', () => {
    it('should return full task details including all fields', async () => {
      const detailedTask = {
        ...mockTask,
        hex_color: '#FF0000',
        labels: [{ id: 1, title: 'Label1', hex_color: '#00FF00' }],
        assignees: [{ id: 1, username: 'user1', email: 'user1@test.com' }],
        attachments: [{ id: 1, file_name: 'test.pdf', file_size: 1024, created_by: 1 }],
        created_by: 1,
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-02T00:00:00Z',
      };
      mockClient.tasks.getTask.mockResolvedValue(detailedTask);

      const result = await callTool('get', { id: 1 });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get-task');
    });
    it('should get a task by ID', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      const result = await callTool('get', { id: 1 });

      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(1);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Retrieved task');
    });

    it('should handle task not found', async () => {
      mockClient.tasks.getTask.mockRejectedValue(new Error('Task not found'));

      // GET /tasks/{id} now goes through vikunjaRestRequest, which wraps
      // the underlying failure into an MCPError (propagated as-is by
      // getTask rather than re-wrapped generically).
      await expect(callTool('get', { id: 999 })).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/999): Task not found',
      );
    });

    it('should handle non-Error API errors in get', async () => {
      mockClient.tasks.getTask.mockRejectedValue({ code: 404 });

      await expect(callTool('get', { id: 1 })).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1)',
      );
    });

    it('should validate task ID', async () => {
      await expect(callTool('get', {})).rejects.toThrow();
      await expect(callTool('get', { id: 'invalid' })).rejects.toThrow();
    });
  });

  describe('update subcommand', () => {
    it('should validate date format when updating', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);

      await expect(
        callTool('update', {
          id: 1,
          dueDate: 'not-a-date',
        }),
      ).rejects.toThrow('dueDate must be a valid ISO 8601 date string');
    });

    it('should handle boolean false for done field', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);
      mockClient.tasks.updateTask.mockResolvedValue({ ...mockTask, done: false });

      const result = await callTool('update', {
        id: 1,
        done: false,
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(1, 
        expect.objectContaining({ done: false })
      );
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
    });

    it('should handle invalid done values', async () => {
      // The schema validation should reject non-boolean values
      await expect(
        callTool('update', {
          id: 1,
          done: 'invalid' as any,
        }),
      ).rejects.toThrow();
    });
    it('should update a task with simple fields', async () => {
      const updatedTask = { ...mockTask, title: 'Updated Title' };
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask).mockResolvedValueOnce(updatedTask);
      mockClient.tasks.updateTask.mockResolvedValue(updatedTask);

      const result = await callTool('update', {
        id: 1,
        title: 'Updated Title',
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(1, {
        ...mockTask,
        title: 'Updated Title',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('updated');
    });

    it('should update a task with all optional fields', async () => {
      const updatedTask = {
        ...mockTask,
        title: 'Updated Title',
        description: 'Updated Description',
        dueDate: '2025-01-01T00:00:00Z',
        priority: 3,
        percentDone: 0.5,
        done: true,
      };
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask).mockResolvedValueOnce(updatedTask);
      mockClient.tasks.updateTask.mockResolvedValue(updatedTask);

      const result = await callTool('update', {
        id: 1,
        title: 'Updated Title',
        description: 'Updated Description',
        dueDate: '2025-01-01T00:00:00Z',
        priority: 3,
        percentDone: 0.5,
        done: true,
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(1, {
        ...mockTask,
        title: 'Updated Title',
        description: 'Updated Description',
        due_date: '2025-01-01T00:00:00Z',
        priority: 3,
        percent_done: 0.5,
        done: true,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');    });

    it('should handle assignee updates with diff logic', async () => {
      const taskWithAssignees = {
        ...mockTask,
        assignees: [
          {
            id: 1,
            username: 'user1',
            email: 'user1@example.com',
            name: 'User One',
            created: '',
            updated: '',
          },
          {
            id: 2,
            username: 'user2',
            email: 'user2@example.com',
            name: 'User Two',
            created: '',
            updated: '',
          },
        ],
      };

      mockClient.tasks.getTask.mockResolvedValue(taskWithAssignees);
      mockClient.tasks.updateTask.mockResolvedValue(taskWithAssignees);

      // Test adding new assignees
      await callTool('update', {
        id: 1,
        assignees: [1, 2, 3],
      });

      // Should additively assign only the new user (3) via the per-user endpoint
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 3);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();

      // Test removing assignees
      jest.clearAllMocks();
      mockClient.tasks.getTask.mockResolvedValue(taskWithAssignees);

      await callTool('update', {
        id: 1,
        assignees: [1],
      });

      // Should remove user 2
      expect(mockClient.tasks.removeUserFromTask).toHaveBeenCalledWith(1, 2);
    });

    it('should preserve all fields when marking task as done', async () => {
      // This tests the specific issue from #29
      const taskWithDetails = {
        ...mockTask,
        description: 'Important description',
        priority: 4,
        done: false,
      };

      const doneTask = {
        ...taskWithDetails,
        done: true,
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(taskWithDetails)
        .mockResolvedValueOnce(doneTask);
      mockClient.tasks.updateTask.mockResolvedValue(doneTask);

      const result = await callTool('update', {
        id: 1,
        done: true,
      });

      // Should send the complete task object, not just the done field
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(1, {
        ...taskWithDetails,
        done: true,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should move a task to another project via projectId', async () => {
      // GitHub #37 / Vikunja #442 — projectId was previously ignored on update
      const taskInProjectA = {
        ...mockTask,
        project_id: 8,
        description: 'Keep me',
        priority: 3,
        done: false,
      };
      const movedTask = {
        ...taskInProjectA,
        project_id: 5,
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(taskInProjectA)
        .mockResolvedValueOnce(movedTask);
      mockClient.tasks.updateTask.mockResolvedValue(movedTask);

      const result = await callTool('update', {
        id: 1,
        projectId: 5,
      });

      // Full-model merge must include project_id so Vikunja applies the move
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(1, {
        ...taskInProjectA,
        project_id: 5,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(parsed.getAorpStatus().type).toBe('success');
      expect(markdown).toContain('projectId');
    });

    it('should fail loudly if project move does not stick', async () => {
      const taskInProjectA = {
        ...mockTask,
        project_id: 8,
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(taskInProjectA)
        // API acknowledges update but task stays in original project
        .mockResolvedValueOnce(taskInProjectA);
      mockClient.tasks.updateTask.mockResolvedValue(taskInProjectA);

      await expect(
        callTool('update', {
          id: 1,
          projectId: 5,
        }),
      ).rejects.toThrow('Failed to move task 1 to project 5');
    });

    it('should validate projectId when moving a task', async () => {
      await expect(
        callTool('update', {
          id: 1,
          projectId: -1,
        }),
      ).rejects.toThrow('projectId must be a positive integer');
    });

    it('should handle label updates', async () => {
      const taskWithLabels = {
        ...mockTask,
        labels: [
          {
            id: 1,
            title: 'Label 1',
            description: '',
            hexColor: '#FF0000',
            createdById: 1,
            projectId: 1,
            created: '',
            updated: '',
          },
        ],
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValueOnce(taskWithLabels);
      mockClient.tasks.updateTask.mockResolvedValue(taskWithLabels);

      // setTaskLabels (src/utils/label-bulk.ts) now calls the direct-REST
      // helper for POST /tasks/{id}/labels/bulk rather than node-vikunja's
      // updateTaskLabels — mock global fetch locally, scoped to this test,
      // rather than for the whole 'update subcommand' block.
      const originalFetch = globalThis.fetch;
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify({ labels: [] })),
      } as unknown as Response);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();

      try {
        await callTool('update', {
          id: 1,
          labels: [1, 2],
        });

        // Labels are updated via the direct-REST helper.
        expect(fetchMock).toHaveBeenCalledWith(
          'https://api.vikunja.test/api/v1/tasks/1/labels/bulk',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
          }),
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('should handle assignee removal failures during update', async () => {
      // Mock task with existing assignees
      const taskWithAssignees = {
        ...mockTask,
        id: 1,
        assignees: [{ id: 1, username: 'user1' }, { id: 2, username: 'user2' }],
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(taskWithAssignees) // For initial fetch
        .mockResolvedValueOnce(taskWithAssignees); // For assignee diff calculation
      mockClient.tasks.updateTask.mockResolvedValue(taskWithAssignees);
      
      // Mock removeUserFromTask to fail
      mockClient.tasks.removeUserFromTask.mockRejectedValue(new Error('Failed to remove user'));

      await expect(
        callTool('update', {
          id: 1,
          assignees: [2], // Remove user 1, keep user 2
        }),
      ).rejects.toThrow('Failed to update task: Failed to remove user');

      expect(mockClient.tasks.removeUserFromTask).toHaveBeenCalledWith(1, 1);
    });

    it('should handle assignee updates when current task has no assignees', async () => {
      const taskWithoutAssignees = {
        ...mockTask,
        assignees: undefined,
      };

      mockClient.tasks.getTask.mockResolvedValue(taskWithoutAssignees);
      mockClient.tasks.updateTask.mockResolvedValue(taskWithoutAssignees);

      await callTool('update', {
        id: 1,
        assignees: [1, 2],
      });

      // Should add both assignees via the additive per-user endpoint
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 1);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 2);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle update without ID', async () => {
      await expect(
        callTool('update', {
          title: 'Test',
        }),
      ).rejects.toThrow();
    });

    it('should handle non-Error API errors in update', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);
      mockClient.tasks.updateTask.mockRejectedValue('Update failed');

      // POST /tasks/{id} now goes through vikunjaRestRequest, which wraps
      // the underlying failure into an MCPError (propagated as-is by
      // updateTask rather than re-wrapped generically).
      await expect(
        callTool('update', {
          id: 1,
          title: 'Test',
        }),
      ).rejects.toThrow('Vikunja REST request failed (POST /tasks/1): Update failed');
    });

    it('should update recurring task settings', async () => {
      const currentTask = {
        ...mockTask,
        repeat_after: 1 * 24 * 60 * 60, // 1 day in seconds
        repeat_mode: 0, // Default mode
      };

      const updatedTask = {
        ...currentTask,
        repeat_after: 7 * 7 * 24 * 60 * 60, // 7 weeks in seconds
        repeat_mode: 0, // Default mode
      };

      mockClient.tasks.getTask
        .mockResolvedValueOnce(currentTask)
        .mockResolvedValueOnce(updatedTask);
      mockClient.tasks.updateTask.mockResolvedValue(updatedTask);

      const result = await callTool('update', {
        id: 1,
        repeatAfter: 7,
        repeatMode: 'week',
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          repeat_after: 7 * 7 * 24 * 60 * 60, // 7 weeks in seconds
          repeat_mode: 0, // Default mode
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
    });

    it('should track recurring fields in previousState', async () => {
      const currentTask = {
        ...mockTask,
        repeat_after: 1,
        repeat_mode: 'day',
      };

      mockClient.tasks.getTask.mockResolvedValue(currentTask);
      mockClient.tasks.updateTask.mockResolvedValue(currentTask);

      const result = await callTool('update', {
        id: 1,
        title: 'Updated Title',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
    });
  });

  describe('delete subcommand', () => {
    it('should delete a task', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      const result = await callTool('delete', { id: 1 });

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('delete-task');
      expect(markdown).toContain('Task "Test Task" deleted successfully');    });

    it('should handle deletion errors', async () => {
      mockClient.tasks.deleteTask.mockRejectedValue(new Error('Cannot delete task'));

      // DELETE /tasks/{id} now goes through vikunjaRestRequest, which wraps
      // the underlying failure into an MCPError (propagated as-is by
      // deleteTask rather than re-wrapped generically).
      await expect(callTool('delete', { id: 1 })).rejects.toThrow(
        'Vikunja REST request failed (DELETE /tasks/1): Cannot delete task',
      );
    });

    it('should continue with deletion even if getting task details fails', async () => {
      mockClient.tasks.getTask.mockRejectedValue(new Error('Task not found'));
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      const result = await callTool('delete', { id: 1 });

      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(1);
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('delete-task');    });

    it('should handle non-Error API errors in delete', async () => {
      mockClient.tasks.deleteTask.mockRejectedValue(500);

      // DELETE /tasks/{id} now goes through vikunjaRestRequest, which wraps
      // any rejection value (String(error), for non-Error/non-string
      // shapes) into an MCPError, propagated as-is by deleteTask.
      await expect(callTool('delete', { id: 1 })).rejects.toThrow(
        'Vikunja REST request failed (DELETE /tasks/1): 500',
      );
    });

    it('should validate task ID', async () => {
      await expect(callTool('delete', {})).rejects.toThrow();
      await expect(callTool('delete', { id: 'invalid' })).rejects.toThrow();
    });
  });

  describe('assign subcommand', () => {
    // assign/unassign call the direct-REST helper (vikunjaRestRequest) for
    // the PUT/DELETE /tasks/{id}/assignees[/{userID}] calls now, so these
    // tests mock global fetch. mockClient.tasks.getTask is still used to
    // refresh the response payload (a deliberate node-vikunja leftover).
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch;

    const restOk = (body: unknown = {}): Response =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify(body)),
      }) as unknown as Response;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = jest.fn().mockResolvedValue(restOk({}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should assign users to a task', async () => {
      const updatedTask = { ...mockTask, assignees: [mockUser] };

      mockClient.tasks.getTask.mockResolvedValue(updatedTask);

      const result = await callTool('assign', {
        id: 1,
        assignees: [1],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user_id: 1 }) }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Users assigned to task successfully');
    });

    it('should handle bulk assign errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn(async () => 'Failed to assign'),
      } as unknown as Response);

      await expect(
        callTool('assign', {
          id: 1,
          assignees: [1],
        }),
      ).rejects.toThrow('Failed to assign users to task:');
    });

    it('should handle non-Error API errors in assign', async () => {
      fetchMock.mockRejectedValue(null);

      await expect(
        callTool('assign', {
          id: 1,
          assignees: [1],
        }),
      ).rejects.toThrow('Failed to assign users to task:');
    });

    it('should assign multiple users at once', async () => {
      const taskWithMultipleAssignees = {
        ...mockTask,
        assignees: [mockUser, { ...mockUser, id: 2, username: 'user2' }],
      };

      mockClient.tasks.getTask.mockResolvedValue(taskWithMultipleAssignees);

      const result = await callTool('assign', {
        id: 1,
        assignees: [1, 2],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user_id: 1 }) }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ user_id: 2 }) }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
    });

    it('should validate parameters', async () => {
      await expect(callTool('assign', {})).rejects.toThrow();
      await expect(callTool('assign', { id: 1 })).rejects.toThrow();
      await expect(callTool('assign', { id: 1, assignees: [] })).rejects.toThrow();
    });
  });

  describe('unassign subcommand', () => {
    // unassign calls the direct-REST helper for
    // DELETE /tasks/{id}/assignees/{userID} now, so these tests mock global
    // fetch. mockClient.tasks.getTask is still used to refresh the response
    // payload (a deliberate node-vikunja leftover).
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch;

    const restOk = (body: unknown = {}): Response =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify(body)),
      }) as unknown as Response;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = jest.fn().mockResolvedValue(restOk({}));
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should unassign users from a task', async () => {
      const updatedTask = { ...mockTask, assignees: [] };

      mockClient.tasks.getTask.mockResolvedValue(updatedTask);

      const result = await callTool('unassign', {
        id: 1,
        assignees: [1],
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees/1',
        expect.objectContaining({ method: 'DELETE' }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Users removed from task successfully');
    });

    it('should unassign multiple users from a task', async () => {
      const updatedTask = { ...mockTask, assignees: [] };

      mockClient.tasks.getTask.mockResolvedValue(updatedTask);

      const result = await callTool('unassign', {
        id: 1,
        assignees: [1, 2, 3],
      });

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees/2',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees/3',
        expect.objectContaining({ method: 'DELETE' }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('unassign');
    });

    it('should handle unassign errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn(async () => 'Failed to remove user'),
      } as unknown as Response);

      await expect(
        callTool('unassign', {
          id: 1,
          assignees: [1],
        }),
      ).rejects.toThrow('Failed to remove users from task:');
    });

    it('should handle non-Error API errors in unassign', async () => {
      fetchMock.mockRejectedValue('Server error');

      await expect(
        callTool('unassign', {
          id: 1,
          assignees: [1],
        }),
      ).rejects.toThrow('Failed to remove users from task:');
    });

    it('should validate parameters', async () => {
      await expect(callTool('unassign', {})).rejects.toThrow(
        'Task id is required for unassign operation',
      );
      await expect(callTool('unassign', { id: 1 })).rejects.toThrow(
        'At least one assignee (user id) is required to unassign',
      );
      await expect(callTool('unassign', { id: 1, assignees: [] })).rejects.toThrow(
        'At least one assignee (user id) is required to unassign',
      );
    });

    it('should validate assignee IDs', async () => {
      await expect(callTool('unassign', { id: 1, assignees: [0] })).rejects.toThrow(
        'assignee ID must be a positive integer',
      );
      await expect(callTool('unassign', { id: 1, assignees: [-1] })).rejects.toThrow(
        'assignee ID must be a positive integer',
      );
      await expect(callTool('unassign', { id: 1, assignees: [1.5] })).rejects.toThrow(
        'assignee ID must be a positive integer',
      );
    });
  });

  describe('list-assignees subcommand', () => {
    // list-assignees calls the dedicated GET /tasks/{taskID}/assignees
    // endpoint directly via the REST helper (not node-vikunja's
    // client.tasks.getTask), so these tests mock global fetch rather than
    // mockClient.
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch;

    const restOk = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify(body)),
      }) as unknown as Response;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = jest.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      // Every list-assignees call shares one auto-derived breaker name
      // ('vikunja-rest-tasks-assignees'); clear the process-wide registry
      // so one test's failure doesn't count against another's.
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should list assignees for a task', async () => {
      fetchMock.mockResolvedValue(
        restOk([mockUser, { id: 2, username: 'user2', email: 'user2@example.com' }]),
      );

      const result = await callTool('list-assignees', {
        id: 1,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/assignees',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('get');
      expect(markdown).toContain('Task 1 has 2 assignee(s)');
    });

    it('should handle task with no assignees', async () => {
      fetchMock.mockResolvedValue(restOk([]));

      const result = await callTool('list-assignees', {
        id: 1,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Task 1 has 0 assignee(s)');
    });

    it('forwards search/page/perPage as s/page/per_page query params', async () => {
      fetchMock.mockResolvedValue(restOk([mockUser]));

      await callTool('list-assignees', {
        id: 1,
        search: 'ali',
        page: 2,
        perPage: 10,
      });

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      const parsedUrl = new URL(url);
      expect(parsedUrl.pathname).toBe('/api/v1/tasks/1/assignees');
      expect(parsedUrl.searchParams.get('s')).toBe('ali');
      expect(parsedUrl.searchParams.get('page')).toBe('2');
      expect(parsedUrl.searchParams.get('per_page')).toBe('10');
    });

    it('should validate task ID is required', async () => {
      await expect(callTool('list-assignees', {})).rejects.toThrow(
        'Task id is required for list-assignees operation',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('should validate task ID format', async () => {
      await expect(callTool('list-assignees', { id: 0 })).rejects.toThrow(
        'id must be a positive integer',
      );
      await expect(callTool('list-assignees', { id: -1 })).rejects.toThrow(
        'id must be a positive integer',
      );
      await expect(callTool('list-assignees', { id: 1.5 })).rejects.toThrow(
        'id must be a positive integer',
      );
    });

    it('should handle a non-OK HTTP response', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: jest.fn(async () => 'boom'),
      } as unknown as Response);

      await expect(
        callTool('list-assignees', {
          id: 1,
        }),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1/assignees): HTTP 500 Internal Server Error — boom',
      );
    });

    it('should handle non-Error network failures', async () => {
      fetchMock.mockRejectedValue('Network failure');

      await expect(
        callTool('list-assignees', {
          id: 1,
        }),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1/assignees): Network failure',
      );
    });

    it('returns id/username/name/email per assignee and nothing else', async () => {
      fetchMock.mockResolvedValue(restOk([mockUser]));

      const result = await callTool('list-assignees', {
        id: 1,
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain(String(mockUser.id));
      expect(markdown).toContain(mockUser.username);
    });
  });

  describe('comment subcommand', () => {
    // handleComment calls the direct-REST helper (vikunjaRestRequest) for
    // GET/PUT /tasks/{id}/comments now, so these tests mock global fetch
    // rather than node-vikunja's mockClient.tasks methods.
    let fetchMock: jest.Mock;
    let originalFetch: typeof fetch;

    const restOk = (body: unknown): Response =>
      ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: jest.fn(async () => JSON.stringify(body)),
      }) as unknown as Response;

    const restError = (status: number, statusText: string, body = ''): Response =>
      ({
        ok: false,
        status,
        statusText,
        text: jest.fn(async () => body),
      }) as unknown as Response;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      fetchMock = jest.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should list comments for a task', async () => {
      fetchMock.mockResolvedValue(restOk([mockComment]));

      const result = await callTool('comment', {
        id: 1,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/comments',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('list');
    });

    it('should add a comment to a task', async () => {
      fetchMock.mockResolvedValue(restOk(mockComment));

      const result = await callTool('comment', {
        id: 1,
        comment: 'New comment',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/comments',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ comment: 'New comment' }),
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Comment added successfully');
    });

    it('should validate task ID is required', async () => {
      await expect(callTool('comment', {})).rejects.toThrow();
    });

    it('should handle comment errors', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(
        callTool('comment', {
          id: 1,
        }),
      ).rejects.toThrow('Failed to handle comment:');
    });

    it('should handle create comment errors', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'Cannot create comment'));

      await expect(
        callTool('comment', {
          id: 1,
          comment: 'Test',
        }),
      ).rejects.toThrow('Failed to handle comment:');
    });

    it('should handle non-Error API errors in comment', async () => {
      fetchMock.mockRejectedValue(false);

      await expect(
        callTool('comment', {
          id: 1,
        }),
      ).rejects.toThrow('Failed to handle comment:');
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle network errors', async () => {
      const networkError = new Error('Network error');
      (networkError as any).code = 'ECONNREFUSED';
      // Cross-project aggregation fails the whole listing only when
      // getProjects itself fails (per-project getProjectTasks failures are
      // caught and skipped - see PR #22).
      mockClient.projects.getProjects.mockRejectedValue(networkError);

      // GET /projects now goes through vikunjaRestRequest, which wraps the
      // underlying failure into an MCPError (propagated as-is by listTasks).
      await expect(callTool('list')).rejects.toThrow(
        'Vikunja REST request failed (GET /projects?per_page=1000): Network error',
      );
    });

    it('should handle rate limiting', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).response = { status: 429 };
      mockClient.projects.getProjects.mockRejectedValue(rateLimitError);

      await expect(callTool('list')).rejects.toThrow(
        'Vikunja REST request failed (GET /projects?per_page=1000): Rate limit exceeded',
      );
    });

    it('should handle malformed JSON responses', async () => {
      // This would typically happen at the node-vikunja level
      mockClient.projects.getProjects.mockRejectedValue(new SyntaxError('Unexpected token'));

      await expect(callTool('list')).rejects.toThrow(
        'Vikunja REST request failed (GET /projects?per_page=1000): Unexpected token',
      );
    });

    it('should handle client initialization errors', async () => {
      (getClientFromContext as jest.Mock).mockImplementation(() => {
        throw new Error('Failed to initialize client');
      });
      (getClientFromContext as jest.Mock).mockRejectedValue(new Error('Failed to initialize client'));

      await expect(callTool('list')).rejects.toThrow('Failed to initialize client');
    });

    it('should handle empty responses gracefully', async () => {
      mockClient.projects.getProjects.mockResolvedValue([]);

      const result = await callTool('list');
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('list-tasks');
      expect(parsed.getOperationMetadata().count).toBe('0');
    });

    it('should handle undefined optional fields', async () => {
      const taskWithUndefinedFields: Task = {
        ...mockTask,
        description: undefined as any,
        labels: undefined as any,
        assignees: undefined as any,
        dueDate: undefined as any,
      };

      mockClient.tasks.getTask.mockResolvedValue(taskWithUndefinedFields);

      const result = await callTool('get', { id: 1 });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(result).toBeDefined();
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });
  });

  describe('bulk-update subcommand', () => {
    // Bulk core ops (GET/POST /tasks/{id}) go through vikunjaRestRequest ->
    // fetch after the #70 migration, so fetch is routed back to the
    // node-vikunja `mockClient.tasks` methods (keeping every call-count/arg
    // assertion valid). setTaskLabels' POST /tasks/{id}/labels/bulk (#71) is
    // routed to `labelWrite` so label-write failures can be simulated
    // independently of the core create/update fetches.
    let fetchMock: jest.Mock;
    let labelWrite: jest.Mock;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      mockClient.tasks.updateTask = jest
        .fn()
        .mockImplementation((id: number, data: any) =>
          Promise.resolve({ ...mockTask, id, ...data }),
        );
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, title: `Task ${id}` }),
      );
      mockClient.tasks.removeUserFromTask = jest.fn().mockResolvedValue({});
      mockClient.tasks.bulkAssignUsersToTask = jest.fn().mockResolvedValue({});
      mockClient.tasks.assignUserToTask = jest.fn().mockResolvedValue({});

      originalFetch = globalThis.fetch;
      labelWrite = jest.fn().mockResolvedValue(undefined);
      fetchMock = makeTaskCrudFetchRouter(labelWrite);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should bulk update multiple tasks via per-task merge (never native bulk API)', async () => {
      const taskIds = [1, 2, 3];
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({
          ...mockTask,
          id,
          description: `desc ${id}`,
          priority: 4,
          done: false,
        }),
      );

      const result = await callTool('bulk-update', {
        taskIds,
        field: 'done',
        value: true,
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.getTask).toHaveBeenCalledTimes(3);
      expect(mockClient.tasks.updateTask).toHaveBeenCalledTimes(3);
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          description: 'desc 1',
          priority: 4,
          done: true,
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('update-task');
      expect(markdown).toContain('Successfully updated 3 tasks');
    });

    it('should preserve description and priority when bulk-marking done (issue #46)', async () => {
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({
          ...mockTask,
          id,
          description: 'important notes',
          priority: 3,
          done: false,
        }),
      );

      await callTool('bulk-update', {
        taskIds: [10, 11],
        field: 'done',
        value: true,
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        10,
        expect.objectContaining({
          description: 'important notes',
          priority: 3,
          done: true,
        }),
      );
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          description: 'important notes',
          priority: 3,
          done: true,
        }),
      );
    });

    it('should handle string "false" value for done field in bulk update', async () => {
      const taskIds = [1, 2];
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, done: true }),
      );

      const result = await callTool('bulk-update', {
        taskIds,
        field: 'done',
        value: 'false' as any,
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ done: false }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
    });

    it('should validate required fields for bulk update', async () => {
      await expect(callTool('bulk-update', {})).rejects.toThrow(
        'taskIds array is required for bulk update operation',
      );

      await expect(callTool('bulk-update', { taskIds: [] })).rejects.toThrow(
        'taskIds array is required for bulk update operation',
      );

      await expect(callTool('bulk-update', { taskIds: [1, 2] })).rejects.toThrow(
        'field is required for bulk update operation',
      );

      await expect(callTool('bulk-update', { taskIds: [1, 2], field: 'done' })).rejects.toThrow(
        'value is required for bulk update operation',
      );
    });

    it('should validate task IDs in bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [0, 1, 2],
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('task ID must be a positive integer');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, -5, 3],
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('task ID must be a positive integer');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2.5, 3],
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('task ID must be a positive integer');
    });

    it('should validate allowed fields for bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'invalid_field',
          value: 'test',
        }),
      ).rejects.toThrow(
        'Invalid field: invalid_field. Allowed fields: done, priority, due_date, start_date, end_date, project_id, assignees, labels',
      );
    });

    it('should validate priority value in bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'priority',
          value: -1,
        }),
      ).rejects.toThrow('Priority must be between 0 and 5');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'priority',
          value: 6,
        }),
      ).rejects.toThrow('Priority must be between 0 and 5');
    });

    it('should validate due_date format in bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'due_date',
          value: 'invalid-date',
        }),
      ).rejects.toThrow('due_date must be a valid ISO 8601 date string');
    });

    it('should validate project_id in bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'project_id',
          value: 0,
        }),
      ).rejects.toThrow('project_id must be a positive integer');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'project_id',
          value: -1,
        }),
      ).rejects.toThrow('project_id must be a positive integer');
    });

    it('should handle API errors in bulk update', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ id: 1, title: 'Task 1', project_id: 1 });
      mockClient.tasks.updateTask.mockRejectedValue(new Error('Bulk update failed'));

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('Bulk update failed. Could not update any tasks');
    });

    it('should handle non-Error API errors in bulk update', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ id: 1, title: 'Task 1', project_id: 1 });
      mockClient.tasks.updateTask.mockRejectedValue('String error');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('Bulk update failed. Could not update any tasks');
    });

    it('should handle string boolean values in bulk update', async () => {
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, done: false }),
      );

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'done',
        value: 'true',
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ done: true }),
      );
      expect(result.content[0].text).toContain('Successfully updated 2 tasks');
    });

    it('should handle string numeric values in bulk update', async () => {
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, priority: 0 }),
      );

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'priority',
        value: '5',
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ priority: 5 }),
      );
      expect(result.content[0].text).toContain('Successfully updated 2 tasks');
    });

    it('should validate recurring fields in bulk update', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'repeat_after',
          value: -1,
        }),
      ).rejects.toThrow('repeat_after must be a non-negative number');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'repeat_mode',
          value: 'invalid',
        }),
        // Valid modes are the REPEAT_MODE_MAP keys (constants.ts), matching
        // the API's TaskRepeatMode integer enum - not the 'day'/'week'/'year'
        // interval units used by the unrelated task-create repeatMode field.
      ).rejects.toThrow('Invalid repeat_mode: invalid. Valid modes: default, month, from_current');
    });

    it('should bulk update recurring settings', async () => {
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, repeat_after: 0 }),
      );

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'repeat_after',
        value: 7,
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ repeat_after: 7 }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(parsed.getAorpStatus().type).toBe('success');
    });

    it('should validate max tasks limit', async () => {
      const tooManyTasks = Array.from({ length: 101 }, (_, i) => i + 1);

      await expect(
        callTool('bulk-update', {
          taskIds: tooManyTasks,
          field: 'done',
          value: true,
        }),
      ).rejects.toThrow('Too many tasks for bulk operation. Maximum allowed: 100');
    });

    it('should validate done field type', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'done',
          value: 'not-a-boolean',
        }),
      ).rejects.toThrow('done field must be a boolean value');
    });

    it('should validate assignees field type', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'assignees',
          value: 'not-an-array',
        }),
      ).rejects.toThrow('assignees must be an array of numbers');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'assignees',
          value: [1, -1],
        }),
      ).rejects.toThrow('assignees ID must be a positive integer');
    });

    it('should validate labels field type', async () => {
      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'labels',
          value: 'not-an-array',
        }),
      ).rejects.toThrow('labels must be an array of numbers');

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'labels',
          value: [1, 0],
        }),
      ).rejects.toThrow('labels ID must be a positive integer');
    });

    it('should update via individual merge when setting done', async () => {
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id }),
      );
      mockClient.tasks.updateTask.mockImplementation((id: number, data: any) =>
        Promise.resolve({ ...mockTask, id, done: true }),
      );

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'done',
        value: true,
      });

      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledTimes(2);
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ done: true }),
      );
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ done: true }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
    });

    it('should handle bulk update for assignees field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, assignees: [] });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'assignees',
        value: [1, 2],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      // Per-user additive assign (assignUserToTask) replaces the broken bulk endpoint (#27).
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalled();
    });

    it('should handle bulk update for labels field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, labels: [] });
      mockClient.tasks.updateTask.mockResolvedValue({ ...mockTask });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'labels',
        value: [1, 2, 3],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      // Labels route through the field-preserving per-task path, never the
      // native /tasks/bulk endpoint (which does not apply label relations).
      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledTimes(2);
      // setTaskLabels (src/utils/label-bulk.ts) persists via the direct-REST
      // helper — POST /tasks/{id}/labels/bulk with the { labels: [{ id }] } shape.
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }, { id: 3 }] }),
        }),
      );
    });

    it('should handle bulk update for due_date field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, due_date: '2024-01-01T00:00:00Z' });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'due_date',
        value: '2024-12-31T23:59:59Z',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ due_date: '2024-12-31T23:59:59Z' }),
      );
    });

    it('should handle bulk update for project_id field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, project_id: 1 });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'project_id',
        value: 5,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ project_id: 5 }),
      );
    });

    it('should handle bulk update for repeat_mode field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, repeat_mode: 0 });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'repeat_mode',
        value: 'month',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ repeat_mode: 1 }),
      );
    });

    it('should handle bulk update for repeat_after field', async () => {
      mockClient.tasks.getTask.mockResolvedValue({ ...mockTask, repeat_after: 0 });

      const result = await callTool('bulk-update', {
        taskIds: [1, 2],
        field: 'repeat_after',
        value: 86400,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully updated 2 tasks');
      expect(mockClient.tasks.bulkUpdateTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ repeat_after: 86400 }),
      );
    });

    it('should handle generic errors in bulk update', async () => {
      mockClient.tasks.getTask.mockImplementation(() => {
        throw new TypeError('Cannot read property of undefined');
      });

      await expect(
        callTool('bulk-update', {
          taskIds: [1, 2],
          field: 'priority',
          value: 5,
        }),
      ).rejects.toThrow('Bulk update failed. Could not update any tasks. Failed IDs: 1, 2');
    });
  });

  describe('bulk-delete subcommand', () => {
    beforeEach(() => {
      mockClient.tasks.deleteTask = jest.fn().mockResolvedValue(undefined);
      mockClient.tasks.getTask.mockImplementation((id: number) =>
        Promise.resolve({ ...mockTask, id, title: `Task ${id}` }),
      );
    });

    it('should bulk delete multiple tasks', async () => {
      const taskIds = [1, 2, 3];

      const result = await callTool('bulk-delete', { taskIds });

      // Should fetch each task before deletion
      expect(mockClient.tasks.getTask).toHaveBeenCalledTimes(3);

      // Should delete each task
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledTimes(3);
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(2);
      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(3);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('delete-task');
      expect(markdown).toContain('Successfully deleted 3 tasks');
    });

    it('should validate required fields for bulk delete', async () => {
      await expect(callTool('bulk-delete', {})).rejects.toThrow(
        'taskIds array is required for bulk delete operation',
      );

      await expect(callTool('bulk-delete', { taskIds: [] })).rejects.toThrow(
        'taskIds array is required for bulk delete operation',
      );
    });

    it('should validate task IDs in bulk delete', async () => {
      await expect(
        callTool('bulk-delete', {
          taskIds: [0, 1, 2],
        }),
      ).rejects.toThrow('task ID must be a positive integer');

      await expect(
        callTool('bulk-delete', {
          taskIds: [1, -5, 3],
        }),
      ).rejects.toThrow('task ID must be a positive integer');
    });

    it('should handle partial failures in bulk delete', async () => {
      const taskIds = [1, 2, 3];

      // Mock first two deletions to succeed, third to fail
      mockClient.tasks.deleteTask
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Delete failed'));

      const result = await callTool('bulk-delete', { taskIds });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain(
        'Bulk delete partially completed. Successfully deleted 2 tasks',
      );

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledTimes(3);
    });

    it('should handle all deletions failing', async () => {
      const taskIds = [1, 2];
      mockClient.tasks.deleteTask.mockRejectedValue(new Error('Delete failed'));

      await expect(callTool('bulk-delete', { taskIds })).rejects.toThrow(
        'Bulk delete failed. Could not delete any tasks. Failed IDs: 1, 2',
      );
    });

    it('should handle non-Error exceptions in bulk delete when deletion fails', async () => {
      mockClient.tasks.getTask.mockResolvedValue(mockTask);
      mockClient.tasks.deleteTask.mockRejectedValue('String error');

      await expect(callTool('bulk-delete', { taskIds: [1, 2] })).rejects.toThrow(
        'Bulk delete failed. Could not delete any tasks. Failed IDs: 1, 2',
      );
    });

    it('should validate max tasks limit for bulk delete', async () => {
      const tooManyTasks = Array.from({ length: 101 }, (_, i) => i + 1);

      await expect(
        callTool('bulk-delete', {
          taskIds: tooManyTasks,
        }),
      ).rejects.toThrow('Too many tasks for bulk operation. Maximum allowed: 100');
    });

    it('should handle non-MCPError exceptions in bulk delete', async () => {
      // Mock getTask to throw a TypeError (non-MCPError)
      mockClient.tasks.getTask.mockImplementation(() => {
        throw new TypeError('Cannot read property of undefined');
      });

      // New batch processing system handles fetch errors gracefully
      // and continues with the deletion operation
      const result = await callTool('bulk-delete', { taskIds: [1] });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      // Previous state might be populated depending on whether getTask succeeded first
    });
  });

  describe('bulk-create subcommand', () => {
    // The real withRetry() wraps operations in a shared opossum circuit breaker
    // (see src/utils/retry.ts). Bulk-create invokes withRetry once per label/assignee
    // update, and the breaker instance is reused across calls, so exercising the real
    // implementation here would make these tests order-dependent on unrelated global
    // breaker state. Bypass it the same way tests/tools/tasks/bulk-operations.test.ts
    // does, so each test only exercises the mocked client call it configured.
    let withRetrySpy: ReturnType<typeof jest.spyOn>;
    // Bulk core ops (PUT /projects/{id}/tasks create, DELETE /tasks/{id}
    // cleanup) go through vikunjaRestRequest -> fetch after the #70
    // migration, routed back to the node-vikunja `mockClient.tasks` methods.
    // setTaskLabels' POST /tasks/{id}/labels/bulk (#71) is routed to
    // `labelWrite`; tests that exercise a label-write failure override it.
    let fetchMock: jest.Mock;
    let labelWrite: jest.Mock;
    let originalFetch: typeof fetch;

    beforeEach(() => {
      withRetrySpy = jest
        .spyOn(retryUtils, 'withRetry')
        .mockImplementation((operation: () => Promise<unknown>) => operation());

      originalFetch = globalThis.fetch;
      labelWrite = jest.fn().mockResolvedValue(undefined);
      fetchMock = makeTaskCrudFetchRouter(labelWrite);
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      circuitBreakerRegistry.clear();
    });

    afterEach(() => {
      withRetrySpy.mockRestore();
      globalThis.fetch = originalFetch;
    });

    it('should create multiple tasks successfully', async () => {
      const tasks = [
        { title: 'Task 1', description: 'Description 1', priority: 3 },
        { title: 'Task 2', dueDate: '2024-05-25T10:00:00Z', labels: [1, 2] },
        { title: 'Task 3', assignees: [1], repeatAfter: 86400, repeatMode: 'day' },
      ];

      const createdTasks = tasks.map((task, index) => ({
        id: index + 1,
        ...task,
        project_id: 1,
        done: false,
        labels: task.labels ? task.labels.map((id) => ({ id, title: `Label ${id}` })) : [],
        assignees: task.assignees
          ? task.assignees.map((id) => ({ id, username: `user${id}` }))
          : [],
      }));

      mockClient.tasks.createTask.mockImplementation(async (projectId, task) => {
        const id = mockClient.tasks.createTask.mock.calls.length;
        return { ...task, id, project_id: projectId };
      });

      mockClient.tasks.getTask.mockImplementation(async (id) => createdTasks[id - 1]);
      mockClient.tasks.bulkAssignUsersToTask.mockResolvedValue(undefined);

      const result = await callTool('bulk-create', { projectId: 1, tasks });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(3);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully created 3 tasks');
      expect(markdown).toContain('**Results:** 3 item(s)');
    });

    it('should require projectId', async () => {
      await expect(
        callTool('bulk-create', {
          tasks: [{ title: 'Task 1' }],
        }),
      ).rejects.toThrow('projectId is required for bulk create operation');
    });

    it('should require tasks array', async () => {
      await expect(
        callTool('bulk-create', {
          projectId: 1,
        }),
      ).rejects.toThrow('tasks array is required and must contain at least one task');

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [],
        }),
      ).rejects.toThrow('tasks array is required and must contain at least one task');
    });

    it('should validate task titles', async () => {
      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [{ title: '' }],
        }),
      ).rejects.toThrow('Task at index 0 must have a non-empty title');

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [{ title: '   ' }],
        }),
      ).rejects.toThrow('Task at index 0 must have a non-empty title');
    });

    it('should validate date formats', async () => {
      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [{ title: 'Task 1', dueDate: 'invalid-date' }],
        }),
      ).rejects.toThrow('tasks[0].dueDate must be a valid ISO 8601 date string');
    });

    it('should validate assignee and label IDs', async () => {
      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [{ title: 'Task 1', assignees: [0] }],
        }),
      ).rejects.toThrow('tasks[0].assignee ID must be a positive integer');

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: [{ title: 'Task 1', labels: [-1] }],
        }),
      ).rejects.toThrow('tasks[0].label ID must be a positive integer');
    });

    it('should handle partial failures', async () => {
      const tasks = [{ title: 'Task 1' }, { title: 'Task 2' }, { title: 'Task 3' }];

      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 1, title: 'Task 1', project_id: 1 })
        .mockRejectedValueOnce(new Error('Failed to create task 2'))
        .mockResolvedValueOnce({ id: 3, title: 'Task 3', project_id: 1 });

      mockClient.tasks.getTask
        .mockResolvedValueOnce({ id: 1, title: 'Task 1', project_id: 1 })
        .mockResolvedValueOnce({ id: 3, title: 'Task 3', project_id: 1 });

      const result = await callTool('bulk-create', { projectId: 1, tasks });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('error');
      expect(markdown).toContain('Bulk create partially completed');
      expect(markdown).toContain('Successfully created 2 tasks, 1 failed');
      expect(markdown).toContain('**count:** 2');
      expect(markdown).toContain('**FailedCount**:\n1');
    });

    it('should handle complete failure', async () => {
      const tasks = [{ title: 'Task 1' }, { title: 'Task 2' }];

      mockClient.tasks.createTask.mockRejectedValue(new Error('API Error'));

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks,
        }),
      ).rejects.toThrow('Bulk create failed. Could not create any tasks');
    });

    it('should add labels and assignees after task creation', async () => {
      const tasks = [{ title: 'Task 1', labels: [1, 2], assignees: [3, 4] }];

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1,
        title: 'Task 1',
        project_id: 1,
      });

      mockClient.tasks.getTask.mockResolvedValue({
        id: 1,
        title: 'Task 1',
        project_id: 1,
        labels: [
          { id: 1, title: 'Label 1' },
          { id: 2, title: 'Label 2' },
        ],
        assignees: [
          { id: 3, username: 'user3' },
          { id: 4, username: 'user4' },
        ],
      });

      mockClient.tasks.bulkAssignUsersToTask.mockResolvedValue(undefined);

      const result = await callTool('bulk-create', { projectId: 1, tasks });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/tasks/1/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 3);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 4);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Label 1');
      expect(markdown).toContain('Label 2');
      expect(markdown).toContain('user3');
      expect(markdown).toContain('user4');
    });

    it('should clean up task if labels/assignees fail', async () => {
      const tasks = [{ title: 'Task 1', labels: [1, 2] }];

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1,
        title: 'Task 1',
        project_id: 1,
      });

      labelWrite.mockRejectedValue(new Error('Label update failed'));
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks,
        }),
      ).rejects.toThrow('Label update failed');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });

    it('should validate max tasks limit', async () => {
      const tooManyTasks = Array(101).fill({ title: 'Task' });

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks: tooManyTasks,
        }),
      ).rejects.toThrow('Too many tasks for bulk operation. Maximum allowed: 100');
    });

    it('should handle failed cleanup after label/assignee error', async () => {
      const tasks = [{ title: 'Task 1', labels: [1, 2] }];

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1,
        title: 'Task 1',
        project_id: 1,
      });

      labelWrite.mockRejectedValue(new Error('Label update failed'));
      mockClient.tasks.deleteTask.mockRejectedValue(new Error('Delete failed'));

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks,
        }),
      ).rejects.toThrow('Label update failed');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });

    it('should handle task creation without ID', async () => {
      const tasks = [{ title: 'Task 1' }];

      // Create task without ID
      mockClient.tasks.createTask.mockResolvedValue({
        title: 'Task 1',
        project_id: 1,
      });

      const result = await callTool('bulk-create', { projectId: 1, tasks });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Successfully created 1 tasks');
    });

    it('should handle non-MCPError exceptions in bulk create', async () => {
      const tasks = [{ title: 'Task 1' }];

      // Mock createTask to succeed
      mockClient.tasks.createTask.mockResolvedValue({ id: 1, title: 'Task 1', project_id: 1 });
      mockClient.tasks.getTask.mockResolvedValue({ id: 1, title: 'Task 1', project_id: 1 });

      // Mock JSON.stringify to throw an error when trying to stringify the response
      // This will happen in the try block but outside Promise.allSettled
      const originalStringify = JSON.stringify;
      JSON.stringify = jest.fn().mockImplementation((value, replacer, space) => {
        if (value && value.operation === 'create' && value.tasks) {
          throw new RangeError('Maximum call stack size exceeded');
        }
        return originalStringify.call(null, value, replacer, space);
      });

      // The implementation now handles JSON.stringify errors gracefully
      const result = await callTool('bulk-create', { projectId: 1, tasks });
      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');

      // Restore JSON.stringify
      JSON.stringify = originalStringify;
    });

    it('should throw non-auth errors from assignee operations in bulk create', async () => {
      const tasks = [{ title: 'Task 1', assignees: [999] }];

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1,
        title: 'Task 1',
        project_id: 1,
      });

      // Mock assignee operation to fail with non-auth error
      mockClient.tasks.assignUserToTask.mockRejectedValue(new Error('Invalid user ID'));
      mockClient.tasks.deleteTask.mockResolvedValue(undefined);

      await expect(
        callTool('bulk-create', {
          projectId: 1,
          tasks,
        }),
      ).rejects.toThrow('Invalid user ID');

      expect(mockClient.tasks.deleteTask).toHaveBeenCalledWith(1);
    });
  });

  describe('attach subcommand', () => {
    it('should reject when neither filePath nor fileContent is provided', async () => {
      await expect(
        callTool('attach', {
          id: 1,
        }),
      ).rejects.toThrow('attach requires filePath or fileContent');
    });
  });

  describe('unknown subcommand', () => {
    it('should throw validation error for unknown subcommand', async () => {
      await expect(
        toolHandler({
          subcommand: 'unknown' as any,
        }),
      ).rejects.toThrow('Unknown subcommand: unknown');
    });
  });

  describe('main handler error handling', () => {
    it('should handle non-Error exceptions in main handler', async () => {
      // Mock getClientFromContext to throw a non-Error directly
      (getClientFromContext as jest.Mock).mockImplementation(() => {
        throw 'String error from client initialization';
      });
      (getClientFromContext as jest.Mock).mockRejectedValue('String error from client initialization');

      await expect(callTool('list')).rejects.toThrow(
        'Task operation error: String error from client initialization',
      );
    });
  });

  describe('tool registration', () => {
    it('should register the vikunja_tasks tool', () => {
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_tasks',
        'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, set position, lookup by per-project index). download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead.',
        expect.any(Object),
        expect.any(Function),
      );
    });

    it('should have the correct tool handler', () => {
      expect(typeof toolHandler).toBe('function');
    });
  });
});
