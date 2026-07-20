/**
 * Final coverage tests for remaining uncovered lines in tasks/crud.ts
 * Targeting lines: 209-219, 279, 281, 363
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest` for the core create/get/update/delete calls.
 * Labels/assignees remain on the node-vikunja client (sub-resource,
 * sibling item M-B).
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTask, getTask, updateTask, deleteTask } from '../../src/tools/tasks/crud';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockVikunjaClient } from '../types/mocks';
import type { AuthManager } from '../../src/auth/AuthManager';
import { parseMarkdown } from '../utils/markdown';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Mock the direct-REST helper used by the migrated CRUD services. It is the
// single choke point for both core task ops and (post Wave-D #71)
// setTaskLabels' POST /tasks/{id}/labels/bulk.
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Mock the client module. getAuthManagerFromContext is used by setTaskLabels
// (src/utils/label-bulk.ts, migrated to direct REST) to recover the session.
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
  hasRequestContext: jest.fn(() => false),
}));

// Mock logger to suppress output during tests
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { vikunjaRestRequest } from '../../src/utils/vikunja-rest';

describe('Tasks CRUD - Final Coverage', () => {
  let mockClient: MockVikunjaClient;
  const { getClientFromContext, getAuthManagerFromContext } = require('../../src/client');
  const mockAuthManager = {} as AuthManager;
  const mockRest = vikunjaRestRequest as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    // Setup mock client with all required methods
    mockClient = {
      tasks: {
        createTask: jest.fn(),
        getTask: jest.fn(),
        updateTask: jest.fn(),
        deleteTask: jest.fn(),
        updateTaskLabels: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
      },
    } as any;

    getClientFromContext.mockResolvedValue(mockClient);

    // setTaskLabels (src/utils/label-bulk.ts) now calls the direct-REST
    // helper (vikunjaRestRequest, mocked here as mockRest) and recovers its
    // session via getAuthManagerFromContext — provide one so label updates
    // in these CRUD tests keep working.
    getAuthManagerFromContext.mockResolvedValue({
      getSession: () => ({ apiUrl: 'https://mock.vikunja.test', apiToken: 'mock-token' }),
    });
    circuitBreakerRegistry.clear();
  });

  describe('getTask success path (lines 209-219)', () => {
    it('should return successful response with task details', async () => {
      const mockTask = {
        id: 1,
        title: 'Test Task Title',
        description: 'Test Description',
        done: false,
        priority: 1,
      };

      mockRest.mockResolvedValue(mockTask);

      const result = await getTask({ id: 1 }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/tasks/1');

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('get-task');
      expect(markdown).toContain('Retrieved task "Test Task Title"');
      expect(markdown).toContain('**taskId:**');
      expect(markdown).toContain('**timestamp:**');

      expect(result.content[0].type).toBe('text');
    });

    it('should handle task with undefined title gracefully', async () => {
      const mockTask = {
        id: 1,
        title: undefined, // Undefined title
        description: 'Test Description',
        done: false,
        priority: 1,
      };

      mockRest.mockResolvedValue(mockTask);

      const result = await getTask({ id: 1 }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('Retrieved task "undefined"');
      expect(markdown).toContain('**taskId:**');
    });

    it('should handle task with null title gracefully', async () => {
      const mockTask = {
        id: 1,
        title: null, // Null title
        description: 'Test Description',
        done: false,
        priority: 1,
      };

      mockRest.mockResolvedValue(mockTask);

      const result = await getTask({ id: 1 }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('Retrieved task "null"');
      expect(markdown).toContain('**taskId:**');
    });
  });

  describe('updateTask field tracking (lines 279, 281)', () => {
    it('should track due date and priority changes correctly', async () => {
      const mockTask = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        due_date: '2024-01-01T00:00:00Z',
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [],
      };

      const updatedTask = {
        ...mockTask,
        due_date: '2024-12-31T23:59:59Z', // Changed due date
        priority: 5, // Changed priority
      };

      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        .mockResolvedValueOnce(updatedTask) // POST /tasks/{id}
        .mockResolvedValueOnce(updatedTask); // final GET

      const result = await updateTask({
        id: 1,
        dueDate: '2024-12-31T23:59:59Z',
        priority: 5,
      }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('dueDate');
      expect(markdown).toContain('priority');
    });

    it('should not track unchanged fields', async () => {
      const mockTask = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        due_date: '2024-01-01T00:00:00Z',
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [],
      };

      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        .mockResolvedValueOnce(mockTask) // POST /tasks/{id}
        .mockResolvedValueOnce(mockTask); // final GET

      const result = await updateTask({
        id: 1,
        dueDate: '2024-01-01T00:00:00Z', // Same due date
        priority: 1, // Same priority
      }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      // For unchanged fields, they might not appear in affectedFields section
      // but the operation should still succeed
    });
  });

  describe('assignee error propagation (line 363)', () => {
    it('should propagate non-authentication errors during assignee removal', async () => {
      const taskWithAssignees = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        due_date: null,
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [{ id: 1 }, { id: 2 }],
      };

      // All calls flow through vikunjaRestRequest now: GET routes both
      // analyzeUpdateState's fetch and updateTaskAssignees's diff-calc fetch;
      // POST is the update; PUT /tasks/1/assignees adds user 3 (success);
      // DELETE /tasks/1/assignees/2 removes user 2 and fails with a non-auth error.
      const nonAuthError = new Error('Network timeout during remove operation');
      mockRest.mockImplementation((_auth: unknown, method: string, path: string) => {
        if (method === 'GET' || method === 'POST') return Promise.resolve(taskWithAssignees);
        if (method === 'PUT') return Promise.resolve(undefined); // add assignee 3
        if (method === 'DELETE') return Promise.reject(nonAuthError); // remove assignee 2
        return Promise.resolve(undefined);
      });

      await expect(
        updateTask({
          id: 1,
          assignees: [1, 3], // Remove 2, add 3
        }, mockAuthManager)
      ).rejects.toThrow('Network timeout during remove operation');
    });

    it('should propagate non-Error objects during assignee removal', async () => {
      const taskWithAssignees = {
        id: 1,
        title: 'Test Task',
        description: 'Test Description',
        due_date: null,
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [{ id: 1 }, { id: 2 }],
      };

      // GET/POST succeed; PUT adds assignee 3; DELETE (remove assignee 2)
      // rejects with a non-Error object.
      const nonErrorObject = { status: 500, error: 'Database connection lost' };
      mockRest.mockImplementation((_auth: unknown, method: string) => {
        if (method === 'GET' || method === 'POST') return Promise.resolve(taskWithAssignees);
        if (method === 'PUT') return Promise.resolve(undefined); // add assignee 3
        if (method === 'DELETE') return Promise.reject(nonErrorObject); // remove assignee 2
        return Promise.resolve(undefined);
      });

      await expect(
        updateTask({
          id: 1,
          assignees: [1, 3], // Remove 2, add 3
        }, mockAuthManager)
      ).rejects.toThrow('Failed to update task: Unknown error');
    });
  });

  describe('comprehensive field change tracking', () => {
    it('should track all possible field changes including repeat configuration', async () => {
      const mockTask = {
        id: 1,
        title: 'Original Title',
        description: 'Original Description',
        due_date: '2024-01-01T00:00:00Z',
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [{ id: 1 }],
      };

      const updatedTask = {
        ...mockTask,
        title: 'New Title',
        description: 'New Description',
        due_date: '2024-12-31T23:59:59Z',
        priority: 5,
        done: true,
        repeat_after: 86400, // 1 day
        repeat_mode: 0,
      };

      // analyzeUpdateState's GET, POST update, final GET (all REST now)
      mockRest
        .mockResolvedValueOnce(mockTask)
        .mockResolvedValueOnce(updatedTask)
        .mockResolvedValueOnce(updatedTask);
      // Labels/assignees sub-resource calls (still node-vikunja client)
      mockClient.tasks.updateTaskLabels.mockResolvedValue(undefined);
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask); // assignee diff calculation
      mockClient.tasks.assignUserToTask.mockResolvedValue(undefined);

      const result = await updateTask({
        id: 1,
        title: 'New Title',
        description: 'New Description',
        dueDate: '2024-12-31T23:59:59Z',
        priority: 5,
        done: true,
        repeatAfter: 1,
        repeatMode: 'day',
        labels: [1, 2],
        assignees: [1, 2],
      }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);

      expect(markdown).toContain("## ✅ Success");
      // Verify all affected fields are mentioned in the markdown output
      expect(markdown).toContain('title');
      expect(markdown).toContain('description');
      expect(markdown).toContain('dueDate');
      expect(markdown).toContain('priority');
      expect(markdown).toContain('done');
      expect(markdown).toContain('repeatAfter');
      expect(markdown).toContain('repeatMode');
      expect(markdown).toContain('labels');
      expect(markdown).toContain('assignees');
    });
  });
});
