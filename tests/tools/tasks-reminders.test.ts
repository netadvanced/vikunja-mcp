/**
 * Task Reminders Tests
 * Tests for task reminder operations
 *
 * Reminders "ride on" the full task-update endpoint (POST /tasks/{id}, a
 * full-model-replace) via the direct-REST helper
 * (src/utils/task-rest-transport.ts) rather than node-vikunja's
 * getTask/updateTask, so these tests drive a mocked global fetch.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { registerTasksTool } from '../../src/tools/tasks';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Import the functions we're mocking
import { getAuthManagerFromContext } from '../../src/client';

// Mock the modules
jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');

describe('Tasks Tool - Reminders', () => {
  let mockAuthManager: MockAuthManager;
  let mockServer: MockServer;
  let toolHandler: (args: any) => Promise<any>;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  // Helper function to call a tool
  async function callTool(subcommand: string, args: Record<string, any> = {}) {
    return toolHandler({
      subcommand,
      ...args,
    });
  }

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

  const mockTask = {
    id: 1,
    title: 'Test Task',
    description: 'Test Task with Reminders',
    done: false,
    priority: 0,
    labels: [],
    assignees: [],
    reminders: [],
  };

  // Vikunja's real API shape for reminders (models.TaskReminder) is
  // `{ reminder, relative_period?, relative_to? }` — there is no `id` field,
  // on either write or read. node-vikunja's typed model (`{ id,
  // reminder_date }`) does not match what the server actually returns.
  const mockTaskWithReminders = {
    ...mockTask,
    reminders: [
      { reminder: '2024-12-25T10:00:00Z' },
      { reminder: '2024-12-31T23:59:00Z' },
    ],
  };

  /** Configures fetchMock: GET returns `getResponse`, POST captures the body and returns it. */
  function mockFetchTaskFlow(getResponse: Response | (() => Response)) {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        return Promise.resolve(restOk(body));
      }
      return Promise.resolve(typeof getResponse === 'function' ? getResponse() : getResponse);
    });
  }

  function postedBody(): Record<string, unknown> {
    const postCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    return JSON.parse((postCall?.[1] as RequestInit).body as string);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreakerRegistry.clear();

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

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue(restOk(mockTask));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockAuthManager);
    registerTasksTool(mockServer as McpServer, mockAuthManager as AuthManager);

    // Get the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_tasks',
      'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, set position, lookup by per-project index, create/list subtasks). download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead. create-subtask is a composite (resolve parent -> create task -> relate -> verify) with opt-in atomic rollback via `atomic: true` (default best-effort — see docs/ENDPOINT-PLAYBOOK.md §5).',
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

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('add-reminder', () => {
    it('should add a reminder to a task', async () => {
      mockFetchTaskFlow(restOk(mockTask));

      const result = await callTool('add-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.io/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(postedBody()).toMatchObject({
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }],
      });

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
      mockFetchTaskFlow(restOk(taskWithOneReminder));

      const result = await callTool('add-reminder', {
        id: 1,
        reminderDate: '2024-12-31T23:59:00Z',
      });

      expect(postedBody()).toMatchObject({
        reminders: [
          { reminder: '2024-12-25T10:00:00Z' },
          { reminder: '2024-12-31T23:59:00Z' },
        ],
      });

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
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(postedBody()).toMatchObject({
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }],
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('remove-reminder');
      expect(markdown).toContain('Reminder 2024-12-25T10:00:00Z removed successfully');
    });

    it('should remove a reminder from a task by reminderIndex', async () => {
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderIndex: 0,
      });

      expect(postedBody()).toMatchObject({
        reminders: [{ reminder: '2024-12-31T23:59:00Z' }],
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('Reminder 2024-12-25T10:00:00Z removed successfully');
    });

    it('should remove a reminder by reminderIndex when reminderDate also matches', async () => {
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderIndex: 0,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain("## ✅ Success");
    });

    it('should error when reminderIndex and reminderDate disagree', async () => {
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderIndex: 0,
          reminderDate: '2024-12-31T23:59:00Z',
        }),
      ).rejects.toThrow('does not match reminderDate');
    });

    it('should error when reminderIndex is out of bounds', async () => {
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

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
        reminders: [{ reminder: '2024-12-25T10:00:00Z' }],
      };
      mockFetchTaskFlow(restOk(taskWithOneReminder));

      const result = await callTool('remove-reminder', {
        id: 1,
        reminderDate: '2024-12-25T10:00:00Z',
      });

      expect(postedBody()).toMatchObject({ reminders: [] });

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
      mockFetchTaskFlow(restOk(mockTask));

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Task has no reminders to remove');
    });

    it('should error if reminder date not found', async () => {
      mockFetchTaskFlow(restOk(mockTaskWithReminders));

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
      fetchMock.mockResolvedValue(restOk(mockTaskWithReminders));

      const result = await callTool('list-reminders', {
        id: 1,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.vikunja.io/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list-reminders');
      expect(markdown).toContain('Found 2 reminder(s)');
    });

    it('should handle task with no reminders', async () => {
      fetchMock.mockResolvedValue(restOk(mockTask));

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
      fetchMock.mockResolvedValue(restOk(mockTaskWithReminders));

      const result = await callTool('list-reminders', {
        id: 1,
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('Test Task');
    });
  });

  describe('Error handling', () => {
    it('should handle API errors gracefully', async () => {
      fetchMock.mockResolvedValue(restError(400, 'Bad Request', 'API Error'));

      await expect(
        callTool('add-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('API Error');
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
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(restError(400, 'Bad Request', 'Update failed'));
        }
        return Promise.resolve(restOk(mockTask));
      });

      await expect(
        callTool('add-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Update failed');
    });

    it('should handle remove-reminder API error during task update', async () => {
      fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(restError(400, 'Bad Request', 'Update failed'));
        }
        return Promise.resolve(restOk(mockTaskWithReminders));
      });

      await expect(
        callTool('remove-reminder', {
          id: 1,
          reminderDate: '2024-12-25T10:00:00Z',
        }),
      ).rejects.toThrow('Update failed');
    });

    it('should handle generic errors in list-reminders', async () => {
      // Mock a non-Error exception
      fetchMock.mockRejectedValue('String error');

      await expect(
        callTool('list-reminders', {
          id: 1,
        }),
      ).rejects.toThrow('String error');
    });
  });
});
