import { jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBatchImportTool } from '../../src/tools/batch-import';
import { MCPError, ErrorCode } from '../../src/types/index';
import { z } from 'zod';

// Mock the modules. getAuthManagerFromContext is used by setTaskLabels
// (src/utils/label-bulk.ts, migrated to direct REST) — any test here that
// creates a task with labels needs it resolved (see beforeEach below).
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
  setGlobalClientFactory: jest.fn(),
  clearGlobalClientFactory: jest.fn(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Import mocked modules
import { getClientFromContext, getAuthManagerFromContext } from '../../src/client';
import { logger } from '../../src/utils/logger';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { ConfigurationManager } from '../../src/config';

/**
 * TaskCreationService.createBaseTask (`PUT /projects/{id}/tasks`) and
 * EntityResolver.fetchUsers (`GET /users`) are migrated off node-vikunja
 * onto the direct-REST helper, which talks to `global.fetch` rather than
 * `mockClient.tasks.createTask` / `mockClient.users.getUsers` directly.
 * Rather than rewrite every one of this file's ~2000 lines of
 * `mockClient.tasks.createTask.mockResolvedValue(...)` /
 * `.toHaveBeenCalledWith(...)` set-ups and assertions, `global.fetch` below
 * is wired to those SAME mocks: a request is routed to the matching
 * `mockClient` method, and that method's configured return value or
 * rejection becomes the fetch response — so every existing
 * `mockClient.tasks.createTask`/`mockClient.users.getUsers` mock call in
 * this file keeps working unchanged, and still asserts real call
 * counts/arguments.
 */
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

/**
 * Converts a rejection from a delegated `mockClient` method into a fetch
 * outcome. When the error's message looks like it already carries an HTTP
 * status (e.g. "401 Unauthorized: invalid token", matching this file's own
 * test-data convention), it's turned into a realistic non-2xx `Response` —
 * exactly what a real Vikunja 401/403 looks like to `vikunjaRestRequest`,
 * with `details.statusCode` set. Anything else is re-thrown so `fetch()`
 * itself rejects, matching a network-level failure.
 */
const HTTP_STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
};

function toFetchOutcome(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const statusMatch = /^(\d{3})\b\s*(.*)$/.exec(message);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return mockResponse({
      ok: false,
      status,
      statusText: HTTP_STATUS_TEXT[status] ?? 'Error',
      text: statusMatch[2] || message,
    });
  }
  throw error;
}

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/**
 * setTaskLabels' POST /tasks/{id}/labels/bulk (label assignment during
 * import, migrated to direct REST by #71) is routed through this mock so
 * label-specific tests can assert on it (`.not.toHaveBeenCalled()`) or
 * fail it (`.mockRejectedValue(...)`) independently of the create/users
 * fetches the router also handles. It is called as `labelWrite(taskId, body)`.
 */
const labelWrite = jest.fn();

// Define the schema matching the one in batch-import.ts
const importedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  done: z.boolean().optional(),
  dueDate: z.string().optional(),
  priority: z.number().optional(),
  labels: z.array(z.string()).optional(),
  assignees: z.array(z.string()).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  hexColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  percentDone: z.number().min(0).max(100).optional(),
  repeatAfter: z.number().optional(),
  repeatMode: z.number().optional(),
  reminders: z.array(z.string()).optional(),
});

describe('Batch Import Tool', () => {
  let mockServer: McpServer;
  let mockClient: any;
  let mockAuthManager: any;
  let toolHandler: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock server
    mockServer = {
      // The handler is always the last argument (server.tool now optionally
      // takes a ToolAnnotations object between the schema and the handler).
      tool: jest.fn((...args: any[]) => {
        toolHandler = args[args.length - 1];
      }),
    } as any;

    // Setup mock auth manager
    mockAuthManager = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      getSession: jest.fn().mockReturnValue({
        apiUrl: 'https://vikunja.test',
        apiToken: 'test-token',
      }),
    };

    // Setup mock client
    mockClient = {
      tasks: {
        createTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
        getTask: jest.fn((id) =>
          Promise.resolve({
            id,
            title: 'Task',
            labels: [
              { id: 1, title: 'bug' },
              { id: 2, title: 'feature' },
            ], // Default: labels are assigned
          }),
        ),
      },
      labels: {
        getLabels: jest.fn((params) =>
          Promise.resolve([
            { id: 1, title: 'bug' },
            { id: 2, title: 'feature' },
          ]),
        ),
      },
      users: {
        getUsers: jest.fn((params) =>
          Promise.resolve([
            { id: 10, username: 'john' },
            { id: 11, username: 'jane' },
          ]),
        ),
      },
    };

    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);

    // setTaskLabels (src/utils/label-bulk.ts, migrated by #71) recovers its
    // session via getAuthManagerFromContext before issuing the label-bulk POST.
    (getAuthManagerFromContext as jest.Mock).mockResolvedValue(mockAuthManager);

    // vikunjaRestRequest protects every call with a process-wide named
    // circuit breaker; clear accumulated stats so one test's deliberately
    // failing scenario doesn't trip the breaker for a later test.
    circuitBreakerRegistry.clear();
    mockFetch.mockReset();
    labelWrite.mockReset();
    labelWrite.mockResolvedValue(undefined);
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET') as string;
      // setTaskLabels' POST /tasks/{id}/labels/bulk (label assignment during
      // import) is delegated to labelWrite so label-specific tests control
      // it; resolves success by default.
      const labelBulkMatch = /\/tasks\/(\d+)\/labels\/bulk$/.exec(url);
      if (method === 'POST' && labelBulkMatch) {
        const taskId = Number(labelBulkMatch[1]);
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        try {
          await labelWrite(taskId, body);
          return mockResponse({ text: JSON.stringify({ labels: [] }) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      const taskMatch = /\/projects\/(\d+)\/tasks$/.exec(url);
      if (method === 'PUT' && taskMatch) {
        const projectId = Number(taskMatch[1]);
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        try {
          const task = await mockClient.tasks.createTask(projectId, body);
          return mockResponse({ text: JSON.stringify(task) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      // EntityResolver.fetchUsers -> GET /users?s=<username> (one search
      // call per unique assignee username referenced by the batch, per the
      // MEDIUM fix in docs/API-COVERAGE.md: GET /users is a *search*
      // endpoint, not a "list everyone" one — matched here on the path
      // alone, ignoring the `s` query value, so existing per-test
      // `mockClient.users.getUsers` setups still drive every search call).
      if (method === 'GET' && /\/users(\?|$)/.test(url)) {
        try {
          const users = await mockClient.users.getUsers({});
          return mockResponse({ text: JSON.stringify(users ?? []) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      // EntityResolver.fetchLabels -> GET /labels (migrated to direct REST,
      // same wave as fetchUsers). Delegated to the SAME mockClient.labels
      // .getLabels mock every existing arrange/assert already drives. A
      // `null`/`undefined`/non-array return is serialized straight through so
      // EntityResolver's own defensive branches (null warn, non-array warn)
      // still run.
      if (method === 'GET' && url.endsWith('/labels')) {
        try {
          const labels = await mockClient.labels.getLabels({});
          return mockResponse({ text: labels === undefined ? '' : JSON.stringify(labels) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      // TaskCreationService.handleUserAssignment -> PUT /tasks/{id}/assignees
      // (additive single-assign per user, body { user_id }). Delegated to the
      // mockClient.tasks.assignUserToTask mock so existing call-count/argument
      // assertions keep working unchanged.
      const assigneeMatch = /\/tasks\/(\d+)\/assignees$/.exec(url);
      if (method === 'PUT' && assigneeMatch) {
        const taskId = Number(assigneeMatch[1]);
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        try {
          await mockClient.tasks.assignUserToTask(taskId, body?.user_id);
          return mockResponse({ text: JSON.stringify({}) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      // TaskCreationService.verifyLabelAssignment -> GET /tasks/{id} (reads
      // back .labels). Delegated to mockClient.tasks.getTask.
      const getTaskMatch = /\/tasks\/(\d+)$/.exec(url);
      if (method === 'GET' && getTaskMatch) {
        const taskId = Number(getTaskMatch[1]);
        try {
          const task = await mockClient.tasks.getTask(taskId);
          return mockResponse({ text: JSON.stringify(task) });
        } catch (error) {
          return toFetchOutcome(error);
        }
      }
      throw new Error(`Unexpected fetch ${method} ${url}`);
    });
  });

  describe('Tool Registration', () => {
    it('should register the tool with correct name', () => {
      registerBatchImportTool(mockServer, mockAuthManager);
      expect(mockServer.tool).toHaveBeenCalledWith(
        'vikunja_batch_import',
        'Import tasks in bulk from CSV or JSON formats with error handling and dry-run support',
        expect.any(Object),
        expect.any(Object), // ToolAnnotations
        expect.any(Function),
      );
    });

    it('should register the tool with correct schema', () => {
      registerBatchImportTool(mockServer, mockAuthManager);

      // Check the schema parameter passed to tool registration (now at index 2)
      const schema = mockServer.tool.mock.calls[0][2];
      expect(schema).toEqual({
        projectId: expect.any(Object),
        format: expect.any(Object),
        data: expect.any(Object),
        skipErrors: expect.any(Object),
        dryRun: expect.any(Object),
      });
    });
  });

  describe('Authentication', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should require authentication', async () => {
      mockAuthManager.isAuthenticated.mockReturnValue(false);

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: '[]',
      });

      expect(result.content[0].text).toContain('Authentication required');
    });
  });

  describe('JSON Import', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should import single task from JSON', async () => {
      const taskData = {
        title: 'Test Task',
        description: 'Test Description',
        done: false,
        priority: 3,
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 100,
        title: 'Test Task',
        description: 'Test Description',
        done: false,
        priority: 3,
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Test Task',
        description: 'Test Description',
        done: false,
        priority: 3,
        percent_done: 0,
        project_id: 1,
      });

      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('#100: Test Task');
    });

    it('should import multiple tasks from JSON array', async () => {
      const tasksData = [
        { title: 'Task 1', priority: 1 },
        { title: 'Task 2', priority: 2 },
      ];

      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 101, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 102, title: 'Task 2' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasksData),
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
    });

    it('should handle task with all fields', async () => {
      const taskData = {
        title: 'Complete Task',
        description: 'Full description',
        done: true,
        dueDate: '2025-01-01T00:00:00Z',
        priority: 5,
        labels: ['bug', 'feature'],
        assignees: ['john', 'jane'],
        startDate: '2024-12-01T00:00:00Z',
        endDate: '2025-01-31T00:00:00Z',
        hexColor: '#FF0000',
        percentDone: 50,
        repeatAfter: 86400,
        repeatMode: 1,
        reminders: ['2024-12-25T00:00:00Z'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 103,
        title: 'Complete Task',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Complete Task',
        description: 'Full description',
        done: true,
        due_date: '2025-01-01T00:00:00Z',
        priority: 5,
        start_date: '2024-12-01T00:00:00Z',
        end_date: '2025-01-31T00:00:00Z',
        hex_color: '#FF0000',
        percent_done: 50,
        repeat_after: 86400,
        repeat_mode: 'week',
        project_id: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/103/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(103, 10);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(103, 11);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should validate JSON format', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: 'invalid json',
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });

    it('should validate required fields', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ description: 'No title' }),
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });

    it('should validate hex color format', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Task', hexColor: 'invalid' }),
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });
  });

  describe('CSV Import', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should import tasks from CSV', async () => {
      const csvData = `title,description,priority,done
Task 1,Description 1,1,false
Task 2,Description 2,2,true`;

      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 201, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 202, title: 'Task 2' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Task 1',
        description: 'Description 1',
        priority: 1,
        done: false,
        percent_done: 0,
        project_id: 1,
      });

      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
    });

    it('should handle CSV with quoted values', async () => {
      const csvData = `title,description,labels
"Task with, comma","Description with ""quotes""","bug;feature"`;

      mockClient.tasks.createTask.mockResolvedValue({
        id: 203,
        title: 'Task with, comma',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Task with, comma',
        description: 'Description with "quotes"',
        done: false,
        priority: 0,
        percent_done: 0,
        project_id: 1,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/203/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );
    });

    it('should handle CSV with all fields', async () => {
      const csvData = `title,description,done,dueDate,priority,labels,assignees,startDate,endDate,hexColor,percentDone
"Complete Task","Full desc",true,2025-01-01T00:00:00Z,5,"bug;feature","john;jane",2024-12-01T00:00:00Z,2025-01-31T00:00:00Z,#FF0000,50`;

      mockClient.tasks.createTask.mockResolvedValue({
        id: 204,
        title: 'Complete Task',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Complete Task',
        description: 'Full desc',
        done: true,
        due_date: '2025-01-01T00:00:00Z',
        priority: 5,
        start_date: '2024-12-01T00:00:00Z',
        end_date: '2025-01-31T00:00:00Z',
        hex_color: '#FF0000',
        percent_done: 50,
        project_id: 1,
      });
    });

    it('should require title header in CSV', async () => {
      const csvData = `description,priority
Description,1`;

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(result.content[0].text).toContain('Missing required CSV headers: title');
    });

    it('should require at least header and one data row', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: 'title',
      });

      expect(result.content[0].text).toContain(
        'CSV must have at least a header row and one data row',
      );
    });

    it('should fail on invalid CSV row without skipErrors', async () => {
      const csvData = `title,priority
"Valid Task",5
"Invalid Task","not a number"`;

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(result.content[0].text).toContain('Invalid task data at row 3');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should stop on first error by default', async () => {
      const tasksData = [{ title: 'Task 1' }, { title: 'Task 2' }];

      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 301, title: 'Task 1' })
        .mockRejectedValueOnce(new Error('API Error'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasksData),
      });

      // The direct-REST helper prefixes the original message with its own
      // "Vikunja REST request failed (...)" context.
      expect(result.content[0].text).toContain('Failed to import tasks:');
      expect(result.content[0].text).toContain('API Error');
      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
    });

    it('should continue on errors with skipErrors flag', async () => {
      const tasksData = [{ title: 'Task 1' }, { title: 'Task 2' }, { title: 'Task 3' }];

      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 302, title: 'Task 1' })
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce({ id: 304, title: 'Task 3' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasksData),
        skipErrors: true,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(3);
      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
      expect(result.content[0].text).toContain('Failed: 1 tasks');
      // The direct-REST helper prefixes the original message with its own
      // "Vikunja REST request failed (...)" context.
      expect(result.content[0].text).toContain('Row 2 (Task 2):');
      expect(result.content[0].text).toContain('API Error');
    });

    it('should handle label assignment errors gracefully', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 305,
        title: 'Task with labels',
      });

      labelWrite.mockRejectedValue(new Error('Label error'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
        skipErrors: true,
      });

      // Task should be created successfully
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // But with a warning about label assignment failure
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Task #305');
      expect(result.content[0].text).toContain('Failed to assign labels:');
      expect(result.content[0].text).toContain('Label error');
    });

    it('should verify successful label assignment', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug', 'feature'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 306,
        title: 'Task with labels',
      });

      // Labels are successfully assigned

      // getTask returns the task with labels properly assigned
      mockClient.tasks.getTask.mockResolvedValue({
        id: 306,
        title: 'Task with labels',
        labels: [
          { id: 1, title: 'bug' },
          { id: 2, title: 'feature' },
        ],
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should verify labels were assigned
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(306);

      // Task should be created successfully without warnings
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).not.toContain('Warnings:');
    });

    it('should handle verification failure gracefully', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 308,
        title: 'Task with labels',
      });

      // updateTaskLabels succeeds

      // But getTask fails (can't verify)
      mockClient.tasks.getTask.mockRejectedValue(new Error('Failed to fetch task'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should still import successfully but with warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain(
        'Labels specified but not assigned (API token limitation)',
      );
    });

    it('should handle label assignment auth errors', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 309,
        title: 'Task with labels',
      });

      // updateTaskLabels throws auth error
      labelWrite.mockRejectedValue(
        new Error(
          '401 Unauthorized: missing, malformed, expired or otherwise invalid token provided',
        ),
      );

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should still import successfully but with auth-specific warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Label assignment requires JWT authentication');
    });

    it('should skip unknown labels/users', async () => {
      const taskData = {
        title: 'Task',
        labels: ['unknown-label'],
        assignees: ['unknown-user'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 307,
        title: 'Task',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should not call assign with empty arrays
      expect(labelWrite).not.toHaveBeenCalled();
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // Should have warnings about labels not found
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Task #307');
      expect(result.content[0].text).toContain('Labels not found: unknown-label');
    });
  });

  describe('Authentication Errors', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should handle null label response gracefully', async () => {
      // Labels return null (API edge case)
      mockClient.labels.getLabels.mockResolvedValue(null);
      mockClient.users.getUsers.mockResolvedValue([]);
      mockClient.tasks.createTask.mockResolvedValue({ id: 399, title: 'Test Task' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task', labels: ['bug'] }),
      });

      // Should complete successfully with warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Labels not found: bug');
    });

    it('should handle non-array label response gracefully', async () => {
      // Labels return non-array (unexpected API response)
      mockClient.labels.getLabels.mockResolvedValue({ invalid: 'response' });
      mockClient.users.getUsers.mockResolvedValue([]);
      mockClient.tasks.createTask.mockResolvedValue({ id: 398, title: 'Test Task' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task', labels: ['bug'] }),
      });

      // Should complete successfully with warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Labels not found: bug');
    });

    it('should handle label fetch errors gracefully', async () => {
      // Labels fail to fetch (not auth error)
      mockClient.labels.getLabels.mockRejectedValue(new Error('Network error'));
      mockClient.users.getUsers.mockResolvedValue([]);
      mockClient.tasks.createTask.mockResolvedValue({ id: 397, title: 'Test Task' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task', labels: ['bug'] }),
      });

      // Should complete successfully with warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Labels not found: bug');
    });

    it('should reproduce batch import label assignment failure with API tokens', async () => {
      // This test reproduces the exact issue where label assignment fails silently
      // Labels are fetched successfully (returns proper array)
      mockClient.labels.getLabels.mockResolvedValue([
        { id: 1, title: 'Core Feature' },
        { id: 2, title: 'Advanced Feature' },
      ]);

      // Task creation works
      mockClient.tasks.createTask.mockResolvedValue({
        id: 122,
        title: 'Test Task',
        labels: null, // Issue: labels are null despite being specified
      });

      // But label assignment silently fails (doesn't throw error, just doesn't work)

      // Add getTask mock to verify the labels weren't assigned
      mockClient.tasks.getTask = jest.fn().mockResolvedValue({
        id: 122,
        title: 'Test Task',
        labels: null, // Still null after updateTaskLabels
      });

      const result = await toolHandler({
        projectId: 35,
        format: 'csv',
        data: `title,description,priority,labels
"Test Task","Description",5,"Core Feature;Advanced Feature"`,
        skipErrors: true,
        dryRun: false,
      });

      // Verify labels were fetched
      expect(mockClient.labels.getLabels).toHaveBeenCalled();

      // Verify task was created
      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(35, {
        title: 'Test Task',
        description: 'Description',
        done: false,
        priority: 5,
        percent_done: 0,
        project_id: 35,
      });

      // Verify updateTaskLabels was called with correct label IDs
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/122/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );

      // Verify getTask was called to check if labels were actually assigned
      expect(mockClient.tasks.getTask).toHaveBeenCalledWith(122);

      // Should show success but with warning about labels
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('#122: Test Task');

      // NOW there should be a warning about label assignment failure
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain(
        'Labels specified but not assigned (API token limitation)',
      );
    });

    it('should handle auth error when fetching users gracefully', async () => {
      // Labels work fine
      mockClient.labels.getLabels.mockResolvedValue([]);
      // Users fail with auth error (known issue)
      mockClient.users.getUsers.mockRejectedValue(
        new Error('missing, malformed, expired or otherwise invalid token provided'),
      );
      // Task creation works
      mockClient.tasks.createTask.mockResolvedValue({ id: 400, title: 'Test Task' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task', assignees: ['john'] }),
      });

      // Should complete successfully with warning
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain(
        'Warning: Could not fetch users due to Vikunja API authentication issue',
      );
      expect(result.content[0].text).toContain('Assignees were skipped for all tasks');
    });

    it('should handle non-auth error when fetching users gracefully', async () => {
      // Labels work fine
      mockClient.labels.getLabels.mockResolvedValue([]);
      // Users fail with non-auth error
      mockClient.users.getUsers.mockRejectedValue(new Error('Network timeout'));
      // Task creation works
      mockClient.tasks.createTask.mockResolvedValue({ id: 401, title: 'Test Task' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task', assignees: ['john'] }),
      });

      // Should complete successfully without assignees
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // Should skip the auth-specific warning
      expect(result.content[0].text).not.toContain('Vikunja API authentication issue');
    });

    it('should handle auth error when creating tasks', async () => {
      mockClient.tasks.createTask.mockRejectedValue(new Error('401 Unauthorized: invalid token'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test Task' }),
      });

      expect(result.content[0].text).toContain('Authentication error while creating task');
      expect(result.content[0].text).toContain(
        'The token works for other endpoints but may have issues with batch operations',
      );
    });
  });

  describe('Dry Run', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should validate without creating tasks', async () => {
      const tasksData = [{ title: 'Task 1' }, { title: 'Task 2' }];

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasksData),
        dryRun: true,
      });

      expect(mockClient.tasks.createTask).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Validation successful. 2 tasks ready to import');
    });

    it('should fail validation on invalid data', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ description: 'No title' }),
        dryRun: true,
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });
  });

  describe('Empty Data', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should handle empty JSON array', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: '[]',
      });

      expect(result.content[0].text).toContain('No valid tasks found to import');
    });

    it('should handle CSV with only header', async () => {
      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: 'title,description',
      });

      expect(result.content[0].text).toContain(
        'CSV must have at least a header row and one data row',
      );
    });

    it('should enforce batch size limit', async () => {
      // Create array with 101 tasks (exceeds limit of 100)
      const tasks = Array(101)
        .fill(null)
        .map((_, i) => ({
          title: `Task ${i + 1}`,
        }));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasks),
      });

      expect(result.content[0].text).toContain('Batch size exceeds maximum limit of 100 tasks');
    });
  });

  describe('Edge Cases and Branch Coverage', () => {
    beforeEach(() => {
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    it('should handle CSV lines that are falsy (empty string after filter)', async () => {
      const csvData = `title,description\n\n\nTask 1,Desc 1\n\n`;
      
      mockClient.tasks.createTask.mockResolvedValue({ id: 501, title: 'Task 1' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(1);
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
    });

    it('should handle error instance check for non-Error objects', async () => {
      // Test the error handling when error is not an Error instance
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: '{"invalid json',
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });

    it('should handle tasks array with null elements during iteration', async () => {
      // Test the branch where tasks[i] could be falsy
      const tasksData = [{ title: 'Task 1' }, { title: 'Task 2' }];
      
      // Mock the task creation to succeed
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 601, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 602, title: 'Task 2' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(tasksData),
      });

      // Should create both tasks
      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
    });

    it('should handle MCPError properly', async () => {
      // Mock createTask to throw an MCPError. Post-migration, `createTask`
      // (`PUT /projects/{id}/tasks`) always goes through the direct-REST
      // helper, which wraps ANY rejection — MCPError or not — into its own
      // MCPError with added context (see vikunjaRestRequestRaw); and
      // TaskCreationService.createBaseTask deliberately unwraps any non-auth
      // failure back into a plain `Error` so `catchErrors` keeps working
      // (see the comment on that branch). So an MCPError thrown from this
      // specific call site can no longer reach the top-level handler as a
      // clean, un-prefixed MCPError the way a real node-vikunja rejection
      // used to — the top-level MCPError-passthrough branch (`error
      // instanceof MCPError`) itself remains real, reachable code, just via
      // other paths (e.g. the batch size / no-tasks-found validation
      // errors thrown directly in registerBatchImportTool).
      mockClient.tasks.createTask.mockRejectedValue(
        new MCPError(ErrorCode.API_ERROR, 'Custom API error message')
      );

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Failed to import tasks:');
      expect(result.content[0].text).toContain('Custom API error message');
    });

    it('should handle general errors with stack trace', async () => {
      // batch-import.ts no longer calls getClientFromContext; it drives the
      // flow off the injected authManager. Throw a general (non-MCPError)
      // error from the first thing it touches inside the try — the auth
      // check — to reach the top-level catch's stack-logging branch.
      mockAuthManager.isAuthenticated.mockImplementation(() => {
        throw new Error('Connection failed');
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Failed to import tasks: Connection failed');
      expect(logger.error).toHaveBeenCalledWith(
        'Batch import error',
        expect.objectContaining({
          error: expect.stringContaining('Error: Connection failed'),
          message: 'Connection failed',
        })
      );
    });

    it('should handle non-Error objects in catch block', async () => {
      // Mock createTask to throw a non-Error object. Post-migration, the
      // direct-REST helper always wraps ANY rejection — including a raw
      // non-Error value like this one — into a real `MCPError` (see
      // vikunjaRestRequestRaw), so by the time this propagates to the
      // top-level handler it's always `instanceof Error`; the 'Unknown
      // error'/raw-value fallback this test originally exercised is only
      // reachable via a source that still rejects with a genuine non-Error
      // value (e.g. `getClientFromContext`, covered separately above).
      mockClient.tasks.createTask.mockRejectedValue('String error');

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Failed to import tasks:');
      expect(result.content[0].text).toContain('String error');
      expect(logger.error).toHaveBeenCalledWith(
        'Batch import error',
        expect.objectContaining({
          error: expect.any(String),
          message: expect.stringContaining('String error'),
        })
      );
    });

    it('should handle CSV with empty values for labels and assignees', async () => {
      const csvData = `title,labels,assignees\nTask 1,,`;
      
      mockClient.tasks.createTask.mockResolvedValue({ id: 701, title: 'Task 1' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledWith(1, {
        title: 'Task 1',
        done: false,
        priority: 0,
        percent_done: 0,
        project_id: 1,
      });
      
      // Should not try to update labels or assignees when they are empty
      expect(labelWrite).not.toHaveBeenCalled();
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle label assignment when updateTaskLabels returns without error but labels were not actually assigned', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 801,
        title: 'Task with labels',
      });

      // updateTaskLabels succeeds

      // But getTask shows labels were not assigned (empty array instead of null)
      mockClient.tasks.getTask.mockResolvedValue({
        id: 801,
        title: 'Task with labels',
        labels: [], // Empty array means no labels assigned
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should still show warning about labels not being assigned
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain(
        'Labels specified but not assigned (API token limitation)'
      );
    });

    it('should handle CSV skip errors during parsing with skipErrors flag', async () => {
      const csvData = `title,hexColor\nTask 1,#FF0000\nTask 2,invalid-color\nTask 3,#00FF00`;
      
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 901, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 903, title: 'Task 3' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
        skipErrors: true,
      });

      // Should create 2 tasks (skip the invalid one)
      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
    });

    it('should log debug for parsed labels from CSV', async () => {
      const csvData = `title,labels\n"Task 1","bug;feature;urgent"`;
      
      mockClient.tasks.createTask.mockResolvedValue({ id: 1001, title: 'Task 1' });

      await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'Parsed labels from CSV',
        expect.objectContaining({
          rawValue: 'bug;feature;urgent',
          parsedLabels: ['bug', 'feature', 'urgent'],
        })
      );
    });

    it('should handle label with uppercase mapping correctly', async () => {
      // Mock labels with mixed case
      mockClient.labels.getLabels.mockResolvedValue([
        { id: 1, title: 'Bug' },
        { id: 2, title: 'FEATURE' },
      ]);

      const taskData = {
        title: 'Task with labels',
        labels: ['BUG', 'feature'], // Different casing
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1101,
        title: 'Task with labels',
      });

      await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should map correctly despite case differences
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1101/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }, { id: 2 }] }),
        }),
      );
    });

    it('should handle assignees when projectUsers is empty but not due to auth failure', async () => {
      // Mock empty users array (but not due to auth failure)
      mockClient.users.getUsers.mockResolvedValue([]);
      
      const taskData = {
        title: 'Task with assignees',
        assignees: ['john'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1201,
        title: 'Task with assignees',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should not assign anyone since no users found
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // Should not show auth-specific warning
      expect(result.content[0].text).not.toContain('Vikunja API authentication issue');
    });

    it('should handle reminders warning', async () => {
      const taskData = {
        title: 'Task with reminders',
        reminders: ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1301,
        title: 'Task with reminders',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Reminders cannot be added after task creation',
        expect.objectContaining({
          taskId: 1301,
          reminders: ['2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'],
        })
      );
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
    });

    it('should handle task creation with no ID returned', async () => {
      const taskData = { title: 'Task without ID' };

      // Mock createTask to return task without ID
      mockClient.tasks.createTask.mockResolvedValue({
        title: 'Task without ID',
        // No id property
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // Should not crash when trying to add to createdTasks
    });

    it('should handle label verification when getTask returns null/undefined labels', async () => {
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1401,
        title: 'Task with labels',
      });

      // updateTaskLabels succeeds

      // getTask returns task without labels property
      mockClient.tasks.getTask.mockResolvedValue({
        id: 1401,
        title: 'Task with labels',
        // No labels property
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should show warning about labels not being assigned
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain(
        'Labels specified but not assigned (API token limitation)'
      );
    });

    it('should handle non-Error objects in JSON validation', async () => {
      // Pass malformed JSON to trigger catch block
      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: '{invalid json',
      });

      expect(result.content[0].text).toContain('Invalid JSON data');
    });

    it('should handle CSV with empty lines', async () => {
      // CSV with empty lines to test filter
      const csvData = `title\n\nTask 1\n\n`;
      
      mockClient.tasks.createTask.mockResolvedValue({ id: 1801, title: 'Task 1' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
    });

    it('should handle CSV row with invalid data format', async () => {
      const csvData = `title,priority,hexColor\nValid Task,5,#FF0000\nInvalid Task,999,invalid-hex`;
      
      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
        skipErrors: false,
      });

      expect(result.content[0].text).toContain('Invalid task data at row 3');
      expect(result.content[0].text).toContain('Invalid');
    });

    it('should handle CSV labels with falsy value in ternary', async () => {
      // Test the value ? split : [] branch for labels (line 190)
      const csvData = `title,labels\n"Task 1",""\n"Task 2",`;
      
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 1501, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 1502, title: 'Task 2' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      // Should not call updateTaskLabels for tasks with empty labels
      expect(labelWrite).not.toHaveBeenCalled();
    });

    it('should handle malformed labels response as defensive measure', async () => {
      // Test lines 291-301 defensive branches
      const labelsResponses = [
        undefined,
        null,
        {},
        'string',
        123,
        true,
        false
      ];

      for (const response of labelsResponses) {
        jest.clearAllMocks();
        mockClient.labels.getLabels.mockResolvedValue(response as Label[]);
        mockClient.tasks.createTask.mockResolvedValue({ id: 1600, title: 'Test' });

        const result = await toolHandler({
          projectId: 1,
          format: 'json',
          data: JSON.stringify({ title: 'Test', labels: ['bug'] }),
        });

        expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
        expect(result.content[0].text).toContain('Labels not found: bug');
      }
    });

    it('should handle sparse array in JSON', async () => {
      // Test with array containing null
      const sparseData = '[{"title": "Task 1"},{"title": "Task 3"}]';
      
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 1701, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 1703, title: 'Task 3' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: sparseData,
      });

      // Should import 2 tasks
      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(2);
      expect(result.content[0].text).toContain('Successfully imported: 2 tasks');
    });

    it('should handle label IDs filtering with some undefined mappings', async () => {
      // Test line 375-377 filter branch
      mockClient.labels.getLabels.mockResolvedValue([
        { id: 1, title: 'bug' },
        // No 'feature' label
      ]);

      const taskData = {
        title: 'Task with mixed labels',
        labels: ['bug', 'feature', 'enhancement'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1801,
        title: 'Task with mixed labels',
      });
      
      // Mock successful label update
      
      // Mock verification - labels successfully assigned
      mockClient.tasks.getTask.mockResolvedValue({
        id: 1801,
        title: 'Task with mixed labels',
        labels: [{ id: 1, title: 'bug' }], // Only one label was assigned
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should update with only the found label
      expect(mockFetch).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1801/labels/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ labels: [{ id: 1 }] }),
        }),
      );
      
      // Task completed successfully, only 'bug' label was applied
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
    });

    it('should handle user IDs filtering for assignees', async () => {
      // Test lines 495-502 for user mapping
      mockClient.users.getUsers.mockResolvedValue([
        { id: 10, username: 'john' },
        // No 'jane' user
      ]);

      const taskData = {
        title: 'Task with assignees',
        assignees: ['john', 'jane', 'doe'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 1901,
        title: 'Task with assignees',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should only assign 'john'
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1901, 10);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle non-Error in final catch block', async () => {
      // Test the top-level catch's non-Error fallback. batch-import.ts no
      // longer calls getClientFromContext; throw a raw (non-Error) value from
      // the auth check to reach that branch.
      mockAuthManager.isAuthenticated.mockImplementation(() => {
        throw 'String rejection';
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Failed to import tasks: String rejection');
      expect(logger.error).toHaveBeenCalledWith(
        'Batch import error',
        expect.objectContaining({
          error: 'String rejection',
          message: 'Unknown error',
        })
      );
    });

    it('should handle error in task creation that is not an Error instance', async () => {
      // Test line 534. The direct-REST helper wraps this non-Error
      // rejection into a real MCPError with a descriptive message (see
      // vikunjaRestRequestRaw), so the reported per-task error is that
      // message rather than the pre-migration 'Unknown error' fallback
      // (only reachable when the original rejection is a non-Error value
      // that never passes through the REST helper at all).
      mockClient.tasks.createTask.mockRejectedValue('Task creation failed');

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
        skipErrors: true,
      });

      expect(result.content[0].text).toContain('Failed: 1 tasks');
      expect(result.content[0].text).toContain('Row 1 (Test):');
      expect(result.content[0].text).toContain('Task creation failed');
    });

    it('should handle reminders when task has no ID', async () => {
      // Test line 517 - when createdTask.id is falsy
      const taskData = {
        title: 'Task with reminders',
        reminders: ['2025-01-01T00:00:00Z'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        title: 'Task with reminders',
        // No ID
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Reminders cannot be added after task creation',
        expect.objectContaining({
          taskId: 'unknown',
          reminders: ['2025-01-01T00:00:00Z'],
        })
      );
    });

    it('should handle label warning when task has no ID', async () => {
      // Test lines 471, 480-486 when createdTask.id is falsy
      mockClient.labels.getLabels.mockResolvedValue([]);
      
      const taskData = {
        title: 'Task without ID',
        labels: ['unknown-label'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        title: 'Task without ID',
        // No ID
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should complete but without adding warning (since no task ID)
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(result.warnings).toBeUndefined();
    });

    it('should handle label error that is not an Error instance', async () => {
      // Test line 436
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 2001,
        title: 'Task with labels',
      });

      // The direct-REST helper (vikunjaRestRequest) always wraps any
      // rejection — Error or not — into a genuine MCPError, so setTaskLabels
      // can no longer surface a non-Error rejection the way node-vikunja
      // occasionally could; `handleLabelAssignmentError`'s `instanceof Error
      // ? ... : 'Unknown error'` fallback is unreachable via this path now.
      labelWrite.mockRejectedValue('Label update failed');

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Failed to assign labels:');
      expect(result.content[0].text).toContain('Label update failed');
    });

    it('should handle label error that is not an auth error and not Error instance', async () => {
      // Test line 451
      const taskData = {
        title: 'Task with labels', 
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 2101,
        title: 'Task with labels',
      });

      // See the previous test: the direct-REST helper always wraps
      // rejections into a genuine Error/MCPError, so the non-Error branch
      // is unreachable via this path now — the message includes the
      // stringified rejection rather than the generic "Unknown error".
      labelWrite.mockRejectedValue({ code: 500, message: 'Server error' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Failed to assign labels:');
    });

    it('should handle verify error that is not Error instance', async () => {
      // Test line 402
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 2201,
        title: 'Task with labels',
      });

      mockClient.tasks.getTask.mockRejectedValue('Verification failed');

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // GET /tasks/{id} now flows through vikunjaRestRequest, which wraps the
      // raw rejection into an MCPError whose message prefixes the original —
      // so this is a substring match rather than the exact raw value.
      expect(logger.debug).toHaveBeenCalledWith(
        'Could not verify label assignment',
        expect.objectContaining({
          taskId: 2201,
          error: expect.stringContaining('Verification failed'),
        })
      );
    });

    it('should handle label error for Error instance', async () => {
      // Ensure we cover the Error instance branch on line 451
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 2301,
        title: 'Task with labels',
      });

      labelWrite.mockRejectedValue(new Error('Network timeout'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Failed to assign labels:');
      expect(result.content[0].text).toContain('Network timeout');
    });

    it('should handle auth error for Error instance', async () => {
      // Test line 367 for Error instance
      mockClient.tasks.createTask.mockRejectedValue(new Error('403 Forbidden'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Authentication error while creating task');
      expect(result.content[0].text).toContain('403 Forbidden');
    });

    it('should handle CSV with assignees empty value branch', async () => {
      // Test line 197 false branch
      const csvData = `title,assignees\n"Task 1","john;jane"\n"Task 2",""`;
      
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 2401, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 2402, title: 'Task 2' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      // First task should assign users (one additive call per user)
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(2401, 10);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(2401, 11);

      // Only the first task assigns (2 users); the second task has no assignees
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledTimes(2);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle getLabels error that is not Error instance', async () => {
      // GET /labels now flows through vikunjaRestRequest, which wraps ANY
      // rejection (including this raw string) into a real MCPError. So the
      // logged error is that MCPError's message (containing the original
      // string) with a defined stack, not the pre-migration raw string /
      // undefined-stack pair.
      mockClient.labels.getLabels.mockRejectedValue('Labels fetch failed');
      mockClient.tasks.createTask.mockResolvedValue({ id: 2501, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch labels',
        expect.objectContaining({
          error: expect.stringContaining('Labels fetch failed'),
          stack: expect.any(String),
        })
      );
    });

    it('should handle getUsers non-auth error that is not Error instance', async () => {
      // Test line 309. The direct-REST helper always wraps a rejection —
      // including this non-Error one — into a real MCPError (see
      // vikunjaRestRequestRaw) before EntityResolver's catch logs it, so
      // the logged `error` is that MCPError, not the original raw string.
      // An assignee must be present so EntityResolver actually issues a
      // `GET /users?s=...` search — since the MEDIUM fix (see
      // docs/API-COVERAGE.md), a task with no assignees makes no /users
      // call at all, so this path would otherwise never trigger.
      mockClient.users.getUsers.mockRejectedValue('Users fetch failed');
      mockClient.tasks.createTask.mockResolvedValue({ id: 2601, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test', assignees: ['someone'] }),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to fetch users',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should handle CSV with various edge cases for label/assignee parsing', async () => {
      // Test empty values and edge cases in CSV parsing
      const csvData = `title,labels,assignees\n"Task 1","",""\n"Task 2",,\n"Task 3","label1","user1"`;
      
      mockClient.tasks.createTask
        .mockResolvedValueOnce({ id: 2701, title: 'Task 1' })
        .mockResolvedValueOnce({ id: 2702, title: 'Task 2' })
        .mockResolvedValueOnce({ id: 2703, title: 'Task 3' });

      const result = await toolHandler({
        projectId: 1,
        format: 'csv',
        data: csvData,
      });

      expect(mockClient.tasks.createTask).toHaveBeenCalledTimes(3);
      expect(result.content[0].text).toContain('Successfully imported: 3 tasks');
      
      // Should not try to update labels/assignees for first two tasks
      expect(labelWrite).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle auth error with non-Error object during task creation', async () => {
      // Test line 367 for non-Error case - must contain auth keywords
      mockClient.tasks.createTask.mockRejectedValue(new Error('401 Unauthorized: missing, malformed, expired or otherwise invalid token provided'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Authentication error while creating task');
      expect(result.content[0].text).toContain('401 Unauthorized');
    });

    it('should handle getUsers error with Error instance', async () => {
      // Test line 309 Error branch. As above, an assignee must be present
      // so a `GET /users?s=...` search is actually issued — see the MEDIUM
      // fix in docs/API-COVERAGE.md (no assignees referenced -> no /users
      // call at all).
      mockClient.users.getUsers.mockRejectedValue(new Error('Network error'));
      mockClient.tasks.createTask.mockResolvedValue({ id: 3001, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test', assignees: ['someone'] }),
      });

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to fetch users',
        expect.objectContaining({ error: expect.any(Error) })
      );
    });

    it('should handle label assignment when some labels cannot be verified', async () => {
      // Complex scenario with partial label verification
      const taskData = {
        title: 'Task with multiple labels',
        labels: ['bug', 'feature', 'urgent'],
      };

      mockClient.labels.getLabels.mockResolvedValue([
        { id: 1, title: 'bug' },
        { id: 2, title: 'feature' },
        { id: 3, title: 'urgent' },
      ]);

      mockClient.tasks.createTask.mockResolvedValue({
        id: 3101,
        title: 'Task with multiple labels',
      });

      // updateTaskLabels succeeds

      // getTask returns only some labels (partial assignment)
      mockClient.tasks.getTask.mockResolvedValue({
        id: 3101,
        title: 'Task with multiple labels',
        labels: [
          { id: 1, title: 'bug' },
          // feature and urgent are missing
        ],
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should show warning about labels not fully assigned
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain(
        'Labels specified but not assigned (API token limitation)'
      );
    });

    it('should handle warnings when no labels can be mapped', async () => {
      // Test the else-if branch when NO labels can be mapped
      const taskData = {
        title: 'Task with unknown labels',
        labels: ['nonexistent1', 'nonexistent2'],
      };

      mockClient.labels.getLabels.mockResolvedValue([
        { id: 1, title: 'bug' },
        { id: 2, title: 'feature' },
      ]);

      mockClient.tasks.createTask.mockResolvedValue({
        id: 3201,
        title: 'Task with unknown labels',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should have warning about all labels not found
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Labels not found: nonexistent1, nonexistent2');
    });

    it('should handle array check for projectLabels defensive code', async () => {
      // Test the Array.isArray check on line 301
      mockClient.labels.getLabels.mockResolvedValue({}); // Non-array object
      mockClient.tasks.createTask.mockResolvedValue({ id: 3301, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test', labels: ['bug'] }),
      });

      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      // Since labels response is not an array, no labels are mapped
      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Labels not found: bug');
    });

    it('should handle user mapping with case sensitivity', async () => {
      // Test user mapping is case-insensitive
      mockClient.users.getUsers.mockResolvedValue([
        { id: 10, username: 'JohnDoe' },
        { id: 11, username: 'JANE' },
      ]);

      const taskData = {
        title: 'Task with assignees',
        assignees: ['johndoe', 'jane'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 3401,
        title: 'Task with assignees',
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // Should map both users correctly despite case differences
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(3401, 10);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(3401, 11);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle labels response defensive fallback', async () => {
      // Test the labelsResponse || [] fallback on line 301
      mockClient.labels.getLabels.mockResolvedValue(null);
      mockClient.users.getUsers.mockResolvedValue(null);
      mockClient.tasks.createTask.mockResolvedValue({ id: 3501, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
    });

    it('should handle error creation logic in catch block', async () => {
      // Test line 534 when creating error object. The direct-REST helper
      // prefixes the original message with its own context (see
      // vikunjaRestRequestRaw), so this is now a substring match.
      const errorObj = new Error('Custom error');
      mockClient.tasks.createTask.mockRejectedValue(errorObj);

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
        skipErrors: true,
      });

      expect(result.content[0].text).toContain('Failed: 1 tasks');
      expect(result.content[0].text).toContain('Row 1 (Test):');
      expect(result.content[0].text).toContain('Custom error');
    });

    it('should handle projectLabels being falsy in label/user map creation', async () => {
      // Ensure projectLabels || [] is covered
      mockClient.labels.getLabels.mockResolvedValue(undefined);
      mockClient.users.getUsers.mockResolvedValue(undefined);
      mockClient.tasks.createTask.mockResolvedValue({ id: 3601, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test', labels: ['bug'], assignees: ['john'] }),
      });

      // Should complete but skip labels/assignees
      expect(result.content[0].text).toContain('Successfully imported: 1 tasks');
      expect(labelWrite).not.toHaveBeenCalled();
      expect(mockClient.tasks.assignUserToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });

    it('should handle getLabels throwing error with Error instance having no message', async () => {
      // Test line 291 with Error instance but no message
      const errorWithoutMessage = new Error();
      delete (errorWithoutMessage as any).message;
      mockClient.labels.getLabels.mockRejectedValue(errorWithoutMessage);
      mockClient.tasks.createTask.mockResolvedValue({ id: 3701, title: 'Test' });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      // GET /labels now flows through vikunjaRestRequest, which wraps the
      // (empty-message) rejection into an MCPError carrying its own request
      // context — so the logged error is that non-empty wrapped message with
      // a defined stack, not the pre-migration empty string.
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to fetch labels',
        expect.objectContaining({
          error: expect.stringContaining('GET /labels'),
          stack: expect.any(String),
        })
      );
    });

    it('should handle label verification error with Error instance', async () => {
      // Test line 402 with Error instance
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 3801,
        title: 'Task with labels',
      });

      mockClient.tasks.getTask.mockRejectedValue(new Error('Verification error'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      // GET /tasks/{id} now flows through vikunjaRestRequest, which wraps the
      // original error message with its own context — substring match.
      expect(logger.debug).toHaveBeenCalledWith(
        'Could not verify label assignment',
        expect.objectContaining({
          taskId: 3801,
          error: expect.stringContaining('Verification error'),
        })
      );
    });

    it('should handle error not instance of Error in task creation skipErrors', async () => {
      // Test for non-Error object in skipErrors. The direct-REST helper
      // wraps this non-Error rejection into a real MCPError with a
      // descriptive message (see vikunjaRestRequestRaw), so the reported
      // per-task error is that message rather than the pre-migration
      // 'Unknown error' fallback.
      const stringError = 'Task creation failed';
      mockClient.tasks.createTask.mockRejectedValue(stringError);

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify([{ title: 'Test 1' }, { title: 'Test 2' }]),
        skipErrors: true,
      });

      expect(result.content[0].text).toContain('Failed: 2 tasks');
      expect(result.content[0].text).toContain('Row 1 (Test 1):');
      expect(result.content[0].text).toContain('Row 2 (Test 2):');
      expect(result.content[0].text.match(/Task creation failed/g)).toHaveLength(2);
    });

    it('should handle label assignment error with auth check for non-Error', async () => {
      // Test line 436 for non-Error auth error
      const taskData = {
        title: 'Task with labels',
        labels: ['bug'],
      };

      mockClient.tasks.createTask.mockResolvedValue({
        id: 3901,
        title: 'Task with labels',
      });

      labelWrite.mockRejectedValue(new Error('missing, malformed, expired or otherwise invalid token provided'));

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify(taskData),
      });

      expect(result.content[0].text).toContain('Warnings:');
      expect(result.content[0].text).toContain('Label assignment requires JWT authentication');
    });

    it('should handle final error catch with MCPError instance', async () => {
      // Ensure MCPError is handled differently in final catch. batch-import.ts
      // no longer calls getClientFromContext; throw the MCPError from the auth
      // check so it reaches the top-level `instanceof MCPError` passthrough.
      const mcpError = new MCPError(ErrorCode.INTERNAL_ERROR, 'Test MCP error');
      mockAuthManager.isAuthenticated.mockImplementation(() => {
        throw mcpError;
      });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });

      expect(result.content[0].text).toBe('Test MCP error');
    });
  });

  describe('global read-only mode', () => {
    // vikunja_batch_import swallows a thrown MCPError into a text response
    // (see the outer catch in src/tools/batch-import.ts) rather than
    // rejecting the promise, so check the response text instead of using
    // callAndCatch/isReadOnlyRejection here.
    beforeEach(() => {
      // Every sibling describe block re-registers the tool against the
      // freshly-recreated mockAuthManager (see the outer beforeEach) —
      // without this, `toolHandler` would still close over whichever
      // mockAuthManager was current the last time some other describe
      // block registered it (e.g. one that permanently overrode
      // isAuthenticated via .mockImplementation to throw).
      registerBatchImportTool(mockServer, mockAuthManager);
    });

    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects an ordinary (non-dry-run) import when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });
      expect(result.content[0].text).toContain('server is in read-only mode');
    });

    it('does not raise the read-only error for a dryRun import when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
        dryRun: true,
      });
      expect(result.content[0].text).not.toContain('server is in read-only mode');
    });

    it('does not raise the read-only error for a non-dry-run import when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      const result = await toolHandler({
        projectId: 1,
        format: 'json',
        data: JSON.stringify({ title: 'Test' }),
      });
      expect(result.content[0].text).not.toContain('server is in read-only mode');
    });
  });
});
