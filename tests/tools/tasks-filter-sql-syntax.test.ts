/**
 * Tests for SQL-like filter syntax handling
 * Tests filtering functionality with complex boolean expressions
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AuthManager } from '../../src/auth/AuthManager';
import { createMockTestableAuthManager } from '../utils/test-utils';
import { registerTasksTool } from '../../src/tools/tasks';
import { MCPError } from '../../src/types';
import type { components } from '../../src/types/generated/vikunja-openapi';

type Task = components['schemas']['models.Task'];
import type { MockVikunjaClient, MockAuthManager, MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Import the function we're mocking
import { getAuthManagerFromContext } from '../../src/client';

// Mock the modules
jest.mock('../../src/client', () => ({
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));
jest.mock('../../src/auth/AuthManager');
jest.mock('../../src/utils/logger');

// Cross-project listing (no projectId / allProjects) now goes through the
// direct-REST GET /tasks strategy first (RestCrossProjectFilteringStrategy)
// rather than node-vikunja's getAllTasks. Mock global fetch so those tests
// exercise the real primary path instead of falling back and hitting the
// (deliberately incomplete) mockClient.projects stub.
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

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

/** Mocks a single successful `GET /tasks` REST call returning `tasks`. */
function mockRestTasksSuccess(tasks: Task[]): void {
  mockFetch.mockResolvedValueOnce(mockRestResponse({ text: JSON.stringify(tasks) }));
}

/**
 * Builds the expected `GET /tasks` URL from ordered query entries, using
 * `URLSearchParams` (as the production code does) rather than
 * `encodeURIComponent` so percent-encoding matches exactly (e.g. spaces as
 * `+`, not `%20`).
 */
function expectedTasksUrl(entries: Array<[string, string]>): string {
  const query = new URLSearchParams();
  for (const [key, value] of entries) {
    query.set(key, value);
  }
  return `https://api.vikunja.test/api/v1/tasks?${query.toString()}`;
}

describe('Tasks Tool - SQL-like Filter Syntax', () => {
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

  // Mock data
  const mockHighPriorityTask: Task = {
    id: 1,
    title: 'High Priority Task',
    description: 'Important task',
    done: false,
    priority: 5,
    project_id: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  } as Task;

  const mockLowPriorityTask: Task = {
    id: 2,
    title: 'Low Priority Task',
    description: 'Less important task',
    done: false,
    priority: 2,
    project_id: 1,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  } as Task;

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks();
    mockFetch.mockReset();
    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats between tests so a
    // deliberately failing scenario doesn't trip the breaker for a later
    // test sharing the same auto-derived breaker name.
    circuitBreakerRegistry.clear();

    // Create fresh mock instances
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
        getTask: jest.fn(),
        updateTask: jest.fn(),
        deleteTask: jest.fn(),
        getTaskComments: jest.fn(),
        createTaskComment: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
        bulkUpdateTasks: jest.fn(),
      },
    } as MockVikunjaClient;

    mockAuthManager = createMockTestableAuthManager();
    mockAuthManager.isAuthenticated.mockReturnValue(true);
    mockAuthManager.getSession.mockReturnValue({
      apiUrl: 'https://api.vikunja.test',
      apiToken: 'test-token',
      authType: 'api-token' as const,
      userId: 'test-user-123'
    });
    mockAuthManager.getAuthType.mockReturnValue('api-token');

    // Setup mock server
    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, description: string, schema: any, handler: any) => void>,
    } as MockServer;

    // Set up the session guard (returns the AuthManager now; the actual task
    // listing goes through the mocked global fetch).
    (
      getAuthManagerFromContext as jest.MockedFunction<typeof getAuthManagerFromContext>
    ).mockResolvedValue(mockAuthManager as unknown as AuthManager);

    // Register the tool
    registerTasksTool(mockServer, mockAuthManager);

    // Get the tool handler
    expect(mockServer.tool).toHaveBeenCalledWith(
      'vikunja_tasks',
      'Manage tasks with comprehensive operations (create, update, delete, list, assign, attach/list/delete files, comment, bulk operations, set Kanban bucket, set position, lookup by per-project index, create/list subtasks). download-attachment cannot deliver file bytes through MCP (no binary channel) — it returns the direct download URL and auth guidance instead. create-subtask is a composite (resolve parent -> create task -> relate -> verify) with opt-in atomic rollback via `atomic: true` (default best-effort — see docs/ENDPOINT-PLAYBOOK.md §5).',
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

  describe('Filter string with special characters', () => {
    it('should pass simple filter with parentheses directly to API', async () => {
      // Simple filter with parentheses
      const filter = '(priority >= 4)';

      // Mock successful response - the API should handle the filter correctly
      mockRestTasksSuccess([mockHighPriorityTask]);

      const result = await callTool('list', { filter });

      // Cross-project listing goes straight to the direct-REST GET /tasks
      // endpoint, with the raw filter string passed through as a query param.
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(
        expectedTasksUrl([
          ['page', '1'],
          ['per_page', '1000'],
          ['filter', filter],
        ]),
      );
      expect(mockClient.tasks.getAllTasks).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('list-tasks');
      expect(markdown).toContain('1 task');
    });

    it('should handle complex filter that cannot be converted', async () => {
      // This is the exact filter from the issue report - too complex to convert
      const filter = '(priority >= 4 && done = false)';

      // The direct REST call fails, and so does the per-project aggregation
      // fallback (this file's mock client stubs `projects` as `{}`).
      mockFetch.mockRejectedValue(new Error('mock: REST GET /tasks unavailable'));

      await expect(callTool('list', { filter })).rejects.toThrow(MCPError);
    });

    it('should handle filter without parentheses', async () => {
      const filter = 'priority >= 4 && done = false';

      mockFetch.mockRejectedValue(new Error('mock: REST GET /tasks unavailable'));

      await expect(callTool('list', { filter })).rejects.toThrow(MCPError);
    });

    it('should handle simple filter expressions', async () => {
      const filter = 'priority >= 4';

      mockRestTasksSuccess([mockHighPriorityTask]);

      const result = await callTool('list', { filter });

      // Cross-project listing goes straight to the direct-REST GET /tasks
      // endpoint, with the raw filter string passed through as a query param.
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(
        expectedTasksUrl([
          ['page', '1'],
          ['per_page', '1000'],
          ['filter', filter],
        ]),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
    });

    it('should handle complex filter with multiple conditions', async () => {
      const filter = "(priority >= 3 && priority <= 5) || (done = true && updated > '2024-01-01')";

      mockFetch.mockRejectedValue(new Error('mock: REST GET /tasks unavailable'));

      await expect(callTool('list', { filter })).rejects.toThrow(MCPError);
    });

    it('should handle filter with project-specific tasks', async () => {
      const projectId = 42;
      const filter = '(priority >= 4 && done = false)';

      // Single-project + filter goes through ServerSideFilteringStrategy
      // (direct REST GET /projects/{id}/tasks), not node-vikunja's
      // getProjectTasks.
      mockRestTasksSuccess([mockHighPriorityTask]);

      const result = await callTool('list', { projectId, filter });

      const query = new URLSearchParams();
      query.set('page', '1');
      query.set('per_page', '1000');
      query.set('filter', filter);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(`https://api.vikunja.test/api/v1/projects/${projectId}/tasks?${query.toString()}`);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
    });

    it('should combine filter with other query parameters', async () => {
      const filter = '(priority >= 4 && done = false)';

      mockRestTasksSuccess([mockHighPriorityTask]);

      const result = await callTool('list', {
        filter,
        page: 2,
        perPage: 20,
        sort: 'priority',
        search: 'urgent',
      });

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe(
        expectedTasksUrl([
          ['page', '2'],
          ['per_page', '20'],
          ['s', 'urgent'],
          ['sort_by', 'priority'],
          ['filter', filter],
        ]),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
    });

    it('should handle API errors gracefully', async () => {
      const filter = '(priority >= 4 && done = false)';

      // Simulate the failure: direct REST fails, and so does the
      // per-project aggregation fallback's own GET /projects call (which
      // vikunjaRestRequest wraps as an MCPError, propagated as-is by
      // listTasks rather than re-wrapped generically).
      mockFetch.mockRejectedValue(new Error('Internal Server Error'));

      await expect(callTool('list', { filter })).rejects.toThrow(MCPError);
      await expect(callTool('list', { filter })).rejects.toMatchObject({
        code: 'API_ERROR',
        message: expect.stringContaining('Vikunja REST request failed'),
      });
    });
  });

  describe('Filter operators', () => {
    const testCases = [
      {
        filter: 'priority = 5',
        description: 'equals operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: 'priority > 3',
        description: 'greater than operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: 'priority >= 4',
        description: 'greater than or equal operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: 'priority < 3',
        description: 'less than operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: 'priority <= 2',
        description: 'less than or equal operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: "title like 'urgent'",
        description: 'like operator',
        expected: { page: 1, per_page: 1000 },
      },
      {
        filter: 'priority in 3,4,5',
        description: 'in operator',
        expected: { page: 1, per_page: 1000 },
      },
    ];

    testCases.forEach(({ filter, description, expected }) => {
      it(`should handle ${description}`, async () => {
        mockRestTasksSuccess([mockHighPriorityTask]);

        const result = await callTool('list', { filter });

        // Cross-project listing goes straight to the direct-REST GET /tasks
        // endpoint, with the raw filter string passed through as a query param.
        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toBe(
          expectedTasksUrl([
            ['page', String(expected.page)],
            ['per_page', String(expected.per_page)],
            ['filter', filter],
          ]),
        );

        const markdown = result.content[0].text;
        const parsed = parseMarkdown(markdown);
        expect(markdown).toContain("## ✅ Success");
      });
    });
  });

  describe('Filter logical operators', () => {
    const testCases = [
      { filter: 'priority >= 4 && done = false', description: 'AND operator' },
      { filter: 'priority >= 5 || done = true', description: 'OR operator' },
      {
        filter: '(priority >= 4 && done = false) || assignees in 1',
        description: 'combined operators with parentheses',
      },
    ];

    testCases.forEach(({ filter, description }) => {
      it(`should handle ${description}`, async () => {
        mockRestTasksSuccess([mockHighPriorityTask]);

        const result = await callTool('list', { filter });

        // Cross-project listing goes straight to the direct-REST GET /tasks
        // endpoint, with the raw filter string passed through as a query param.
        const [url] = mockFetch.mock.calls[0] as [string];
        expect(url).toBe(
          expectedTasksUrl([
            ['page', '1'],
            ['per_page', '1000'],
            ['filter', filter],
          ]),
        );

        const markdown = result.content[0].text;
        const parsed = parseMarkdown(markdown);
        expect(markdown).toContain("## ✅ Success");
      });
    });
  });
});
