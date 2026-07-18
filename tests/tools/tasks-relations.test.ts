/**
 * Task Relations Tool Tests
 */

import { beforeEach, afterEach, describe, expect, it, jest } from '@jest/globals';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTasksTool } from '../../src/tools/tasks';
import { AuthManager } from '../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../src/types/errors';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { parseMarkdown } from '../utils/markdown';

// Define RelationKind enum for tests
const RelationKind = {
  UNKNOWN: 'unknown',
  SUBTASK: 'subtask',
  PARENTTASK: 'parenttask',
  RELATED: 'related',
  DUPLICATEOF: 'duplicateof',
  DUPLICATES: 'duplicates',
  BLOCKING: 'blocking',
  BLOCKED: 'blocked',
  PRECEDES: 'precedes',
  FOLLOWS: 'follows',
  COPIEDFROM: 'copiedfrom',
  COPIEDTO: 'copiedto',
};

// Mock logger to reduce test noise
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock storage manager
jest.mock('../../src/storage/SimpleFilterStorage', () => ({
  storageManager: {
    getStorage: jest.fn().mockReturnValue({
      get: jest.fn(),
      save: jest.fn(),
      list: jest.fn(),
      delete: jest.fn(),
    }),
    clearAll: jest.fn(),
  },
}));

// Mock data
const mockTask = {
  id: 1,
  title: 'Test Task',
  project_id: 1,
  related_tasks: [
    { task_id: 2, relation_kind: RelationKind.SUBTASK },
    { task_id: 3, relation_kind: RelationKind.BLOCKING },
  ],
};

// relate/unrelate/relations drive every Vikunja call through the direct-REST
// helper (vikunjaRestRequest) now: PUT/DELETE /tasks/{taskID}/relations... for
// the writes, and GET /tasks/{id} (via getTaskViaRest) to refresh the response
// task. There is no node-vikunja client involved any more, so the tests route
// a single mocked global fetch for all of it.

// Helper to create a mock server
function createMockServer(): McpServer & { executeTool: (name: string, args: unknown) => Promise<unknown> } {
  const registeredTools = new Map<string, any>();

  const mockServer = {
    // The handler is always the last argument (server.tool now optionally
    // takes a ToolAnnotations object between the schema and the handler).
    tool: jest.fn((name: string, ...rest: any[]) => {
      registeredTools.set(name, rest[rest.length - 1]);
    }),
    // Helper to execute a tool
    executeTool: async (name: string, args: unknown) => {
      const handler = registeredTools.get(name);
      if (!handler) {
        throw new Error(`Tool ${name} not registered`);
      }
      return handler(args);
    },
  };

  return mockServer as unknown as McpServer & { executeTool: (name: string, args: unknown) => Promise<unknown> };
}

describe('Task Relations Tool', () => {
  let server: McpServer & { executeTool: (name: string, args: unknown) => Promise<unknown> };
  let authManager: AuthManager;
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
    jest.clearAllMocks();
    server = createMockServer();
    authManager = new AuthManager();

    // Set up authenticated state
    authManager.connect('https://vikunja.test', 'test-token');

    // relate/unrelate go through vikunjaRestRequest now, so mock global
    // fetch and clear the process-wide circuit breaker registry so one
    // test's failure doesn't count against another's.
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue(restOk({}));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    circuitBreakerRegistry.clear();

    // Register the tool
    registerTasksTool(server, authManager);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('relate subcommand', () => {
    it('should create a task relation successfully', async () => {
      const result = await server.executeTool('vikunja_tasks', {
        subcommand: 'relate',
        id: 1,
        otherTaskId: 4,
        relationKind: 'related',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/relations',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            task_id: 1,
            other_task_id: 4,
            relation_kind: RelationKind.RELATED,
          }),
        }),
      );
      // The task is refreshed afterwards via GET /tasks/{id} (direct-REST).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = (result as any).content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
      expect(markdown).toContain('## ✅ Success');
      expect(markdown).toContain('**Operation:** relate');
      expect(markdown).toContain('Successfully created related relation');
    });

    it('should validate required task ID', async () => {
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should validate required other task ID', async () => {
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should validate required relation kind', async () => {
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          otherTaskId: 2,
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should validate relation kind is valid', async () => {
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'invalid',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should handle all relation kinds', async () => {
      const relationKinds = [
        'unknown',
        'subtask',
        'parenttask',
        'related',
        'duplicateof',
        'duplicates',
        'blocking',
        'blocked',
        'precedes',
        'follows',
        'copiedfrom',
        'copiedto',
      ];

      for (const kind of relationKinds) {
        fetchMock.mockResolvedValue(restOk({}));

        const result = await server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          otherTaskId: 2,
          relationKind: kind,
        });

        const markdown = (result as any).content[0].text;
        const parsed = parseMarkdown(markdown);
        const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
        expect(markdown).toContain(kind);
      }
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: jest.fn(async () => 'API Error'),
      } as unknown as Response);

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow('API Error');
    });

    it('should handle non-Error thrown values', async () => {
      fetchMock.mockRejectedValue('String error thrown');

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow('String error thrown');
    });
  });

  describe('unrelate subcommand', () => {
    it('should remove a task relation successfully', async () => {
      const result = await server.executeTool('vikunja_tasks', {
        subcommand: 'unrelate',
        id: 1,
        otherTaskId: 2,
        relationKind: 'subtask',
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/relations/subtask/2',
        expect.objectContaining({
          method: 'DELETE',
          body: JSON.stringify({
            task_id: 1,
            other_task_id: 2,
            relation_kind: RelationKind.SUBTASK,
          }),
        }),
      );
      // The task is refreshed afterwards via GET /tasks/{id} (direct-REST).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = (result as any).content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
      expect(markdown).toContain('unrelate');
      expect(markdown).toContain('Successfully removed subtask relation');
    });

    it('should validate required fields', async () => {
      // Missing task ID
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow(MCPError);

      // Missing other task ID
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          id: 1,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow(MCPError);

      // Missing relation kind
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          id: 1,
          otherTaskId: 2,
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should handle API errors', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn(async () => 'Not found'),
      } as unknown as Response);

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow('Not found');
    });

    it('should handle non-Error thrown values', async () => {
      fetchMock.mockRejectedValue({ code: 'NETWORK_ERROR', message: 'Connection failed' });

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'subtask',
        }),
      ).rejects.toThrow('[object Object]');
    });
  });

  describe('relations subcommand', () => {
    it('should list task relations successfully', async () => {
      // Vikunja's real API shape: related_tasks is a map of relation kind ->
      // Task[] (models.RelatedTaskMap), not a flat array. The 'relations'
      // subcommand's only network call is GET /tasks/{id} (direct-REST).
      fetchMock.mockResolvedValue(
        restOk({
          ...mockTask,
          related_tasks: {
            subtask: [{ id: 2, title: 'Related Task' }],
            blocking: [{ id: 3, title: 'Blocking Task' }],
          },
        }),
      );

      const result = await server.executeTool('vikunja_tasks', {
        subcommand: 'relations',
        id: 1,
      });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = (result as any).content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
      expect(markdown).toContain('relations');
      expect(markdown).toContain('Found 2 relation(s) for task 1 (subtask: 1, blocking: 1)');
    });

    it('should handle tasks with no relations', async () => {
      fetchMock.mockResolvedValue(
        restOk({
          ...mockTask,
          related_tasks: {},
        }),
      );

      const result = await server.executeTool('vikunja_tasks', {
        subcommand: 'relations',
        id: 1,
      });

      const markdown = (result as any).content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
      expect(markdown).toContain('Found 0 relation(s) for task 1');
    });

    it('should handle tasks with undefined relations', async () => {
      // JSON.stringify drops the undefined key, so GET /tasks/{id} returns a
      // task with no related_tasks field at all — the source coerces that to {}.
      fetchMock.mockResolvedValue(
        restOk({
          ...mockTask,
          related_tasks: undefined,
        }),
      );

      const result = await server.executeTool('vikunja_tasks', {
        subcommand: 'relations',
        id: 1,
      });

      const markdown = (result as any).content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success'); // New format returns success for successful operations
      expect(markdown).toContain('Found 0 relation(s) for task 1');
    });

    it('should validate required task ID', async () => {
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relations',
        }),
      ).rejects.toThrow(MCPError);
    });

    it('should handle API errors', async () => {
      // The 'relations' refresh is GET /tasks/{id} (direct-REST); a non-OK
      // response surfaces as an MCPError carrying the HTTP status and body. A
      // 404 is not retried, so this resolves without any backoff delay. The
      // REST-origin MCPError gets the conventional "Failed to ..." wrapping
      // restored (wrapIfRestOrigin) rather than leaking its raw message.
      fetchMock.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: jest.fn(async () => 'Task not found'),
      } as unknown as Response);

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relations',
          id: 1,
        }),
      ).rejects.toThrow(
        'Failed to get task relations: Vikunja REST request failed (GET /tasks/1): HTTP 404 Not Found — Task not found',
      );
    });

    it('should handle non-Error thrown values', async () => {
      // A non-Error rejection from fetch is stringified by the REST helper into
      // the wrapped MCPError message rather than leaking through raw, and that
      // MCPError in turn gets the "Failed to ..." wrapping restored.
      fetchMock.mockRejectedValue(12345);

      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'relations',
          id: 1,
        }),
      ).rejects.toThrow('Failed to get task relations: Vikunja REST request failed (GET /tasks/1): 12345');
    });
  });

  describe('authentication checks', () => {
    it('should require authentication for all relation operations', async () => {
      // Disconnect auth
      authManager.disconnect();

      const operations = [
        { subcommand: 'relate', id: 1, otherTaskId: 2, relationKind: 'subtask' },
        { subcommand: 'unrelate', id: 1, otherTaskId: 2, relationKind: 'subtask' },
        { subcommand: 'relations', id: 1 },
      ];

      for (const op of operations) {
        await expect(server.executeTool('vikunja_tasks', op)).rejects.toThrow(
          'Authentication required',
        );
      }
    });
  });

  describe('ID validation', () => {
    it('should validate task ID is positive integer', async () => {
      const invalidIds = [0, -1, 1.5, NaN];

      for (const id of invalidIds) {
        await expect(
          server.executeTool('vikunja_tasks', {
            subcommand: 'relate',
            id: id,
            otherTaskId: 2,
            relationKind: 'subtask',
          }),
        ).rejects.toThrow(MCPError);
      }
    });

    it('should validate other task ID is positive integer', async () => {
      const invalidIds = [0, -1, 1.5, NaN];

      for (const id of invalidIds) {
        await expect(
          server.executeTool('vikunja_tasks', {
            subcommand: 'relate',
            id: 1,
            otherTaskId: id,
            relationKind: 'subtask',
          }),
        ).rejects.toThrow(MCPError);
      }
    });
  });

  describe('edge cases', () => {
    it('should validate relation kind with invalid map entry in unrelate', async () => {
      // This covers the uncovered branch where relationKind is not found;
      // validation rejects before any network call is made.
      await expect(
        server.executeTool('vikunja_tasks', {
          subcommand: 'unrelate',
          id: 1,
          otherTaskId: 2,
          relationKind: 'invalid_kind',
        }),
      ).rejects.toThrow('Invalid relation kind');
    });

    it('should throw error for invalid relation subcommand', async () => {
      // Import the handleRelationSubcommands function directly
      const { handleRelationSubcommands } = require('../../src/tools/tasks-relations');

      // Call it with an invalid subcommand
      await expect(
        handleRelationSubcommands(
          {
            subcommand: 'invalid-subcommand' as any,
            id: 1,
          },
          authManager,
        ),
      ).rejects.toThrow('Invalid relation subcommand');
    });
  });
});
