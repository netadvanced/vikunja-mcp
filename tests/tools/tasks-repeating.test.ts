import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerTasksTool } from '../../src/tools/tasks';
import { MCPError, ErrorCode } from '../../src/types';
import type { components } from '../../src/types/generated/vikunja-openapi';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';

type Task = components['schemas']['models.Task'];

// Import the function we're mocking
import { getClientFromContext, getAuthManagerFromContext } from '../../src/client';
import { vikunjaRestRequest } from '../../src/utils/vikunja-rest';

// Mock the modules. The tasks tool's session guard now calls
// getAuthManagerFromContext(); provide it so the guard resolves.
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
  hasRequestContext: jest.fn(() => false),
}));
jest.mock('../../src/auth/AuthManager');
// Migrated (Wave D, tasks-core): create/update's core calls go through
// vikunjaRestRequest now.
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

describe('Tasks Tool - Repeating Tasks', () => {
  let mockClient: MockVikunjaClient;
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;
  const mockRest = vikunjaRestRequest as jest.Mock;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({
      subcommand,
      ...args,
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
    identifier: '',
    index: 0,
    attachments: [],
    coverImageAttachmentId: null,
    isArchived: false,
    isFavorite: false,
    subscription: null,
    position: 0,
    kanbanPosition: 0,
    createdById: 0,
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    projectId: 1,
    relatedTasks: null,
    repeatMode: 0,
    bucketId: 0,
    comments: [],
  };

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock client
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
        getTask: jest.fn(),
        createTask: jest.fn(),
        updateTask: jest.fn(),
        deleteTask: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        createTaskComment: jest.fn(),
        getTaskComments: jest.fn(),
        bulkUpdateTasks: jest.fn(),
      },
    } as MockVikunjaClient;

    // Mock the imported function to return our mock client
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    // The tasks tool guards each call with getAuthManagerFromContext(); the
    // result is discarded (all ops use the injected authManager), so resolving
    // to any object is enough to pass the guard.
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue({});

    // Create mock auth manager that is authenticated
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockResolvedValue({
        apiUrl: 'https://vikunja.test',
        apiToken: 'test-token',
        tokenExpiry: new Date(Date.now() + 3600000),
        userId: '1',
      }),
      clearSession: jest.fn(),
      authenticate: jest.fn(),
      getAuthenticatedClient: jest.fn(),
      updateCredentials: jest.fn(),
      clearCredentials: jest.fn(),
      verifyCredentials: jest.fn(),
      getCredentials: jest.fn(),
      setSession: jest.fn(),
    } as MockAuthManager;

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Register the tool
    registerTasksTool(mockServer, mockAuthManager);

    // Get the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_tasks',
      'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, bulk set Kanban bucket, set position, lookup by per-project index, create/list subtasks, bulk create subtasks, duplicate, mark-read). download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead. create-subtask is a composite (resolve parent -> create task -> relate -> verify) with opt-in atomic rollback via `atomic: true` (default best-effort — see docs/ENDPOINT-PLAYBOOK.md §5). bulk-create-subtasks creates several subtasks under the same parent in one call (resolves the parent once, then creates/relates each sequentially, per-subtask atomic rollback, honest partial reporting of which subtasks were created/related/failed). bulk-set-bucket moves several tasks into the same Kanban bucket in one call (resolves the project/view once, then applies each move sequentially, honest partial reporting of failedIds). duplicate copies a task (labels, assignees, attachments, reminders) into the same project (PUT /tasks/{taskID}/duplicate, no body). mark-read removes the current unread status entry for a task (POST /tasks/{projecttask}/read).',
      expect.any(Object),
      expect.any(Object), // ToolAnnotations
      expect.any(Function),
    );
    const calls = mockServer.tool.mock.calls;
    if (calls.length > 0 && calls[0] && calls[0].length > 3) {
      toolHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  describe('create with repeat_mode', () => {
    it('should create a repeating task with daily repeat mode', async () => {
      const createdTask = {
        ...mockTask,
        id: 1,
        title: 'Stock up on space ice cream',
        project_id: 17,
        repeat_after: 30 * 24 * 60 * 60, // 30 days in seconds
        repeat_mode: 0, // Default mode
      };

      mockRest.mockResolvedValue(createdTask);

      const result = await callTool('create', {
        projectId: 17,
        title: 'Stock up on space ice cream',
        repeatMode: 'day',
        repeatAfter: 30,
      });

      // Verify the API was called with correct parameters
      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'PUT',
        '/projects/17/tasks',
        expect.objectContaining({
          title: 'Stock up on space ice cream',
          project_id: 17,
          repeat_after: 30 * 24 * 60 * 60, // 30 days in seconds
          repeat_mode: 0, // Default mode
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-task');
      expect(markdown).toContain('**projectId:**');
      expect(markdown).toContain('Task created successfully');
    });

    it('should handle weekly repeat mode', async () => {
      const createdTask = {
        ...mockTask,
        id: 2,
        title: 'Weekly review',
        project_id: 17,
        repeat_after: 1 * 7 * 24 * 60 * 60, // 1 week in seconds
        repeat_mode: 0, // Default mode
      };

      mockRest.mockResolvedValue(createdTask);

      const result = await callTool('create', {
        projectId: 17,
        title: 'Weekly review',
        repeatMode: 'week',
        repeatAfter: 1,
      });

      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'PUT',
        '/projects/17/tasks',
        expect.objectContaining({
          repeat_after: 1 * 7 * 24 * 60 * 60,
          repeat_mode: 0,
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-task');
      expect(markdown).toContain('Task created successfully');
    });

    it('should handle monthly repeat mode', async () => {
      const createdTask = {
        ...mockTask,
        id: 3,
        title: 'Monthly review',
        project_id: 17,
        repeat_after: 30 * 24 * 60 * 60, // Ignored for monthly mode
        repeat_mode: 1, // Monthly mode
      };

      mockRest.mockResolvedValue(createdTask);

      const result = await callTool('create', {
        projectId: 17,
        title: 'Monthly review',
        repeatMode: 'month',
        repeatAfter: 1, // This will be ignored by the API for monthly mode
      });

      // Verify the API was called with monthly mode
      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'PUT',
        '/projects/17/tasks',
        expect.objectContaining({
          repeat_mode: 1, // Monthly mode
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-task');
      expect(markdown).toContain('Task created successfully');
    });

    it('should handle yearly repeat mode', async () => {
      const createdTask = {
        ...mockTask,
        id: 4,
        title: 'Annual review',
        project_id: 17,
        repeat_after: 1 * 365 * 24 * 60 * 60, // 1 year in seconds
        repeat_mode: 0, // Default mode
      };

      mockRest.mockResolvedValue(createdTask);

      const result = await callTool('create', {
        projectId: 17,
        title: 'Annual review',
        repeatMode: 'year',
        repeatAfter: 1,
      });

      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'PUT',
        '/projects/17/tasks',
        expect.objectContaining({
          repeat_after: 1 * 365 * 24 * 60 * 60,
          repeat_mode: 0,
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-task');
      expect(markdown).toContain('Task created successfully');
    });

    it('should create tasks via bulk-create with repeat_mode', async () => {
      const createdTasks = [
        {
          ...mockTask,
          id: 1,
          title: 'Daily standup',
          project_id: 17,
          repeat_after: 1 * 24 * 60 * 60, // 1 day in seconds
          repeat_mode: 0, // Default mode
        },
        {
          ...mockTask,
          id: 2,
          title: 'Weekly review',
          project_id: 17,
          repeat_after: 1 * 7 * 24 * 60 * 60, // 1 week in seconds
          repeat_mode: 0, // Default mode
        },
      ];

      // Route by request shape rather than call order: bulk-create runs the
      // per-task PUT+GET pairs with concurrency, so call order across tasks
      // isn't guaranteed.
      mockRest.mockImplementation((_auth: unknown, method: string, path: string, body?: { title?: string }) => {
        if (method === 'PUT') {
          const match = createdTasks.find((t) => t.title === body?.title);
          return Promise.resolve(match);
        }
        if (method === 'GET') {
          const match = createdTasks.find((t) => path === `/tasks/${t.id}`);
          return Promise.resolve(match);
        }
        return Promise.resolve(undefined);
      });

      const result = await callTool('bulk-create', {
        projectId: 17,
        tasks: [
          {
            title: 'Daily standup',
            repeatAfter: 1,
            repeatMode: 'day',
          },
          {
            title: 'Weekly review',
            repeatAfter: 1,
            repeatMode: 'week',
          },
        ],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('create-tasks');
      expect(markdown).toContain('Successfully created 2 tasks');
      expect(markdown).toContain('**count:**');
    });
  });

  describe('update with repeat_mode', () => {
    it('should update task repeat settings', async () => {
      const existingTask = {
        ...mockTask,
        id: 1,
        repeat_after: 1 * 24 * 60 * 60, // 1 day
        repeat_mode: 0,
      };

      const updatedTask = {
        ...existingTask,
        repeat_after: 1 * 7 * 24 * 60 * 60, // 1 week
        repeat_mode: 0,
      };

      mockRest
        .mockResolvedValueOnce(existingTask) // analyzeUpdateState's GET
        .mockResolvedValueOnce(updatedTask) // POST /tasks/{id}
        .mockResolvedValueOnce(updatedTask); // final GET

      const result = await callTool('update', {
        id: 1,
        repeatAfter: 1,
        repeatMode: 'week',
      });

      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'POST',
        '/tasks/1',
        expect.objectContaining({
          repeat_after: 1 * 7 * 24 * 60 * 60,
          repeat_mode: 0,
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('update-task');
      expect(markdown).toContain('Task updated successfully');
      expect(markdown).toContain('**affectedFields:**');
    });
  });
});
