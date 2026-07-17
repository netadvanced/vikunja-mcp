/**
 * Task Reminders Tests
 * Tests for task reminder operations
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerTasksTool } from '../../src/tools/tasks';
import { MCPError, ErrorCode } from '../../src/types';
import type { Task } from 'node-vikunja';
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';

// Import the functions we're mocking
import { getClientFromContext } from '../../src/client';

// Mock the modules
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');

describe('Tasks Tool - Reminders', () => {
  let mockClient: MockVikunjaClient;
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({
      subcommand,
      ...args,
    });
  }

  const mockTask: Task = {
    id: 1,
    title: 'Test Task',
    description: 'Test Task with Reminders',
    done: false,
    doneAt: null,
    priority: 0,
    labels: [],
    assignees: [],
    dueDate: null,
    startDate: null,
    endDate: null,
    repeatAfter: 0,
    repeatFromCurrentDate: false,
    reminderDates: [],
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    bucketId: 0,
    position: 0,
    createdBy: { id: 1, username: 'test', email: '', name: '' },
    project: { id: 1, title: 'Test Project', description: '', isArchived: false },
    isFavorite: false,
    subscription: null,
    attachments: [],
    coverImageAttachmentId: null,
    percentDone: 0,
    relatedTasks: {},
    reactions: {},
    reminders: [],
  };

  // Vikunja's real API shape for reminders (models.TaskReminder) is
  // `{ reminder, relative_period?, relative_to? }` — there is no `id` field,
  // on either write or read. node-vikunja's typed model (`{ id,
  // reminder_date }`) does not match what the server actually returns.
  const mockTaskWithReminders: Task = {
    ...mockTask,
    reminders: [
      { reminder: '2024-12-25T10:00:00Z' },
      { reminder: '2024-12-31T23:59:00Z' },
    ] as unknown as Task['reminders'],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock Vikunja client
    mockClient = {
      tasks: {
        getTask: jest.fn(),
        updateTask: jest.fn(),
        getAllTasks: jest.fn(),
        getProjectTasks: jest.fn(),
        createTask: jest.fn(),
        deleteTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        createTaskComment: jest.fn(),
        getTaskComments: jest.fn(),
      },
      projects: {
        getAllProjects: jest.fn(),
        createProject: jest.fn(),
      },
      labels: {
        getAllLabels: jest.fn(),
      },
      teams: {
        getAllTeams: jest.fn(),
      },
      users: {
        getAllUsers: jest.fn(),
      },
    } as any;

    // Create mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockReturnValue({
        apiUrl: 'https://api.vikunja.io',
        apiToken: 'test-token',
      }),
    } as any;

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as any;

    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    registerTasksTool(mockServer as McpServer, mockAuthManager as AuthManager);

    // Get the tool handler
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

  describe('add-reminder', () => {
    it('should add a reminder to a task', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);
      mockClient.tasks.updateTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }] as unknown as Task['reminders'],
      });
      mockClient.tasks.getTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }] as unknown as Task['reminders'],
      });

      const result = await callTool('add-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(1);
      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          reminders: [{ reminder: '2024-12-25T10:00:00Z' }],
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('add-reminder');
      expect(markdown).toContain('Reminder added successfully');
    });

    it('should add multiple reminders to a task', async () => {
      const taskWithOneReminder = {
        ...mockTask,
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }],
      };

      mockClient.tasks.getTask.mockResolvedValueOnce(taskWithOneReminder);
      mockClient.tasks.updateTask.mockResolvedValueOnce(mockTaskWithReminders);
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      const result = await callTool('add-reminder', {
        id: 1,
        reminderDate: '2024-12-31T23:59:00Z',
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          reminders: [
            { reminder: '2024-12-25T10:00:00Z' },
            { reminder: '2024-12-31T23:59:00Z' },
          ],
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('add-reminder');
    });

    it('should require task id', async () => {
      await expect(
        callTool('add-reminder', {
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should require reminder date', async () => {
      await expect(
        callTool('add-reminder', {
          id: 1,
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should validate reminder date format', async () => {
      await expect(
        callTool('add-reminder', {
          id: 1,
          reminderDate: 'invalid-date',
        }),
      ).rejects.toThrow(MCPError);
    });
  });

  describe('remove-reminder', () => {
    it('should remove a reminder from a task by reminderDate', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);
      mockClient.tasks.updateTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }] as unknown as Task['reminders'],
      });
      mockClient.tasks.getTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }] as unknown as Task['reminders'],
      });

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          reminders: [{ reminder: '2024-12-31T23:59:00Z' }],
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('remove-reminder');
      expect(markdown).toContain('Reminder 2024-12-25T10:00:00Z removed successfully');
    });

    it('should remove a reminder from a task by reminderIndex', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);
      mockClient.tasks.updateTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }] as unknown as Task['reminders'],
      });
      mockClient.tasks.getTask.mockResolvedValueOnce({
        ...mockTask,
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }] as unknown as Task['reminders'],
      });

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderIndex: 0,
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          reminders: [{ reminder: '2024-12-31T23:59:00Z' }],
        }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('Reminder 2024-12-25T10:00:00Z removed successfully');
    });

    it('should remove a reminder by reminderIndex when reminderDate also matches', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);
      mockClient.tasks.updateTask.mockResolvedValueOnce(mockTask);
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderIndex: 0,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
    });

    it('should error when reminderIndex and reminderDate disagree', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderIndex: 0,
          reminderDate: '2024-12-31T23:59:00Z',
        }),
      ).rejects.toThrow('does not match reminderDate');
    });

    it('should error when reminderIndex is out of bounds', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderIndex: 5,
        }),
      ).rejects.toThrow('reminderIndex 5 not found in task');
    });

    it('should error when reminderIndex is negative', async () => {
      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderIndex: -1,
        }),
      ).rejects.toThrow('reminderIndex must be a non-negative integer');
    });

    it('should error when reminderIndex is not an integer', async () => {
      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderIndex: 1.5,
        }),
      ).rejects.toThrow('reminderIndex must be a non-negative integer');
    });

    it('should validate reminderDate format', async () => {
      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: 'not-a-date',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should handle removing all reminders', async () => {
      const taskWithOneReminder = {
        ...mockTask,
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }] as unknown as Task['reminders'],
      };

      mockClient.tasks.getTask.mockResolvedValueOnce(taskWithOneReminder);
      mockClient.tasks.updateTask.mockResolvedValueOnce(mockTask);
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(mockClient.tasks.updateTask).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          reminders: [],
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('remove-reminder');
    });

    it('should require task id', async () => {
      await expect(
        callTool('remove-reminder', {
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should require reminderDate or reminderIndex', async () => {
      await expect(
        callTool('remove-reminder', {
          id: 1,
        }),
      ).rejects.toThrow('Either reminderDate or reminderIndex is required');
    });

    it('should error if task has no reminders', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Task has no reminders to remove');
    });

    it('should error if reminder date not found', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: '2030-01-01T00:00:00Z',
        }),
      ).rejects.toThrow('Reminder with date 2030-01-01T00:00:00Z not found in task');
    });
  });

  describe('list-reminders', () => {
    it('should list all reminders for a task', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      const result = await callTool('list-reminders', {
        id: 1,
      });

      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(1);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list-reminders');
      expect(markdown).toContain('Found 2 reminder(s)');
    });

    it('should handle task with no reminders', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);

      const result = await callTool('list-reminders', {
        id: 1,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('Found 0 reminder(s)');
    });

    it('should require task id', async () => {
      await expect(callTool('list-reminders')).rejects.toThrow(MCPError);
    });

    it('should include task info in response', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);

      const result = await callTool('list-reminders', {
        id: 1,
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('Test Task');
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockClient.tasks.getTask.mockRejectedValueOnce(new Error('API Error'));

      await expect(
        callTool('add-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Failed to add reminder: API Error');
    });

    it('should require authentication', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      await expect(
        callTool('list-reminders', {
          id: 1,
        }),
      ).rejects.toThrow('Authentication required');
    });

    it('should handle add-reminder API error during task update', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask);
      mockClient.tasks.updateTask.mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        callTool('add-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Failed to add reminder: Update failed');
    });

    it('should handle remove-reminder API error during task update', async () => {
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTaskWithReminders);
      mockClient.tasks.updateTask.mockRejectedValueOnce(new Error('Update failed'));

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Failed to remove reminder: Update failed');
    });

    it('should handle generic errors in list-reminders', async () => {
      // Mock a non-Error exception
      mockClient.tasks.getTask.mockImplementation(() => {
        throw 'String error';
      });

      await expect(
        callTool('list-reminders', {
          id: 1,
        }),
      ).rejects.toThrow('Failed to list reminders: String error');
    });
  });
});
