/**
 * Edge case tests for tasks/crud.ts to ensure comprehensive coverage
 * Targets defensive programming patterns and boundary conditions
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest` for the core create/get/update/delete calls.
 * Labels/assignees remain on the node-vikunja client (sub-resource,
 * sibling item M-B).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTask, getTask, updateTask, deleteTask } from '../../src/tools/tasks/crud';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockVikunjaClient } from '../types/mocks';
import type { AuthManager } from '../../src/auth/AuthManager';
import { parseMarkdown } from '../utils/markdown';

// Mock the direct-REST helper used by the migrated CRUD services
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Mock the client module (still used for labels/assignees sub-resource calls)
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
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

describe('Tasks CRUD - Edge Cases and Defensive Programming', () => {
  let mockClient: MockVikunjaClient;
  const { getClientFromContext } = require('../../src/client');
  const mockAuthManager = {} as AuthManager;
  const mockRest = vikunjaRestRequest as jest.Mock;

  /** Sentinel wrapper marking a routeRest handler value as a rejection. */
  const REJECT = (value: unknown): { __reject: true; value: unknown } => ({ __reject: true, value });

  /**
   * Routes vikunjaRestRequest calls to per-HTTP-method fixtures/errors. Good
   * enough for these tests since each one does at most a handful of calls
   * per method (GET for fetch/re-fetch, POST for update, PUT for create,
   * DELETE for delete/rollback). Wrap a handler in `REJECT(...)` to make
   * that method's calls reject instead of resolve — plain `instanceof Error`
   * detection isn't reliable here since some tests deliberately reject with
   * non-Error values (strings, plain objects, undefined).
   */
  function routeRest(handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', unknown>>): void {
    mockRest.mockImplementation((_auth: unknown, method: string) => {
      const handler = handlers[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
      if (handler && typeof handler === 'object' && (handler as { __reject?: true }).__reject === true) {
        return Promise.reject((handler as { value: unknown }).value);
      }
      return Promise.resolve(handler);
    });
  }

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
        addLabelToTask: jest.fn(),
        bulkAssignUsersToTask: jest.fn(),
        assignUserToTask: jest.fn(),
        removeUserFromTask: jest.fn(),
      },
    } as any;

    getClientFromContext.mockResolvedValue(mockClient);
  });

  describe('createTask edge cases', () => {
    it('should handle empty description field correctly', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, GET: createdTask });

      const result = await createTask({
        projectId: 1,
        title: 'Test Task',
        description: '', // Empty string
      }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/projects/1/tasks', {
        title: 'Test Task',
        project_id: 1,
        description: '',
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle undefined optional fields correctly', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, GET: createdTask });

      const result = await createTask({
        projectId: 1,
        title: 'Test Task',
        description: undefined,
        dueDate: undefined,
        priority: undefined,
      }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/projects/1/tasks', {
        title: 'Test Task',
        project_id: 1,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle zero values correctly', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1, priority: 0 };
      routeRest({ PUT: createdTask, GET: createdTask });

      const result = await createTask({
        projectId: 1,
        title: 'Test Task',
        priority: 0, // Zero is valid
        repeatAfter: 0, // Zero is valid
      }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/projects/1/tasks', {
        title: 'Test Task',
        project_id: 1,
        priority: 0,
        repeat_after: 0, // Should include repeat fields when provided
        repeat_mode: 0,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle empty arrays correctly', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, GET: createdTask });

      const result = await createTask({
        projectId: 1,
        title: 'Test Task',
        labels: [], // Empty array
        assignees: [], // Empty array
      }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/projects/1/tasks', {
        title: 'Test Task',
        project_id: 1,
      });

      // Empty arrays should not trigger label/assignee operations
      expect(mockClient.tasks.addLabelToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should fail when labels are requested but task has no ID', async () => {
      const createdTaskNoId = { title: 'Test Task', project_id: 1 }; // No ID
      routeRest({ PUT: createdTaskNoId });

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2], // Labels provided but task has no ID
        }, mockAuthManager),
      ).rejects.toThrow('did not return a task id');

      // Should not attempt label operations without task ID
      expect(mockClient.tasks.addLabelToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.getTask).not.toHaveBeenCalled();
    });

    it('should fail when assignees are requested but task has no ID', async () => {
      const createdTaskNoId = { title: 'Test Task', project_id: 1 }; // No ID
      routeRest({ PUT: createdTaskNoId });

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          assignees: [1, 2], // Assignees provided but task has no ID
        }, mockAuthManager),
      ).rejects.toThrow('did not return a task id');

      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
      expect(mockClient.tasks.getTask).not.toHaveBeenCalled();
    });
  });

  describe('updateTask edge cases', () => {
    const mockTask = {
      id: 1,
      title: 'Original Title',
      description: 'Original Description',
      due_date: '2024-01-01T00:00:00Z',
      priority: 1,
      done: false,
      repeat_after: 0,
      repeat_mode: 0,
      assignees: [],
    };

    it('should handle updating with same values (no changes)', async () => {
      routeRest({ GET: mockTask, POST: mockTask });

      const result = await updateTask({
        id: 1,
        title: 'Original Title', // Same value
        description: 'Original Description', // Same value
        priority: 1, // Same value
        done: false, // Same value
      }, mockAuthManager);

      // Should still call the update endpoint but with no affected fields
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'POST', '/tasks/1', {
        ...mockTask,
        title: 'Original Title',
        description: 'Original Description',
        priority: 1,
        done: false,
      });

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Task updated successfully');
    });

    it('should handle undefined repeat configuration correctly', async () => {
      const currentTask = {
        ...mockTask,
        repeat_after: 86400, // 1 day
        repeat_mode: 1,
      };

      routeRest({ GET: currentTask, POST: currentTask });

      const result = await updateTask({
        id: 1,
        repeatMode: 'week', // Should convert to number
      }, mockAuthManager);

      // Should call the update endpoint with expected repeat configuration
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'POST', '/tasks/1', expect.objectContaining({
        repeat_mode: 0, // Week mode converts to 0
      }));

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle partial repeat configuration updates', async () => {
      const currentTask = {
        ...mockTask,
        repeat_after: 0,
        repeat_mode: 0,
      };

      routeRest({ GET: currentTask, POST: currentTask });

      const result = await updateTask({
        id: 1,
        repeatAfter: 5, // Only update repeat after
      }, mockAuthManager);

      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'POST',
        '/tasks/1',
        expect.objectContaining({
          repeat_after: 5, // Without repeatMode, value is used as-is (seconds)
        })
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle empty assignee list updates', async () => {
      const taskWithAssignees = {
        ...mockTask,
        assignees: [{ id: 1 }, { id: 2 }],
      };

      routeRest({ GET: taskWithAssignees, POST: taskWithAssignees });
      // updateTaskAssignees's diff-calculation fetch (still node-vikunja client)
      mockClient.tasks.getTask.mockResolvedValue(taskWithAssignees);
      mockClient.tasks.removeUserFromTask.mockResolvedValue(undefined);

      const result = await updateTask({
        id: 1,
        assignees: [], // Remove all assignees
      }, mockAuthManager);

      // Should remove all existing assignees
      expect(mockClient.tasks.removeUserFromTask).toHaveBeenCalledWith(1, 1);
      expect(mockClient.tasks.removeUserFromTask).toHaveBeenCalledWith(1, 2);
      // Should not add any assignees
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });

    it('should handle assignee updates with null/undefined assignees on current task', async () => {
      const taskWithNullAssignees = {
        ...mockTask,
        assignees: null, // Null assignees
      };

      routeRest({ GET: taskWithNullAssignees, POST: taskWithNullAssignees });
      mockClient.tasks.getTask.mockResolvedValue(taskWithNullAssignees);
      mockClient.tasks.assignUserToTask.mockResolvedValue(undefined);

      const result = await updateTask({
        id: 1,
        assignees: [1, 2], // Add assignees to task with null assignees
      }, mockAuthManager);

      // Should add all assignees (since current is empty due to null), one
      // additive per-user call each
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 1);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 2);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
      // Should not remove any assignees
      expect(mockClient.tasks.removeUserFromTask).not.toHaveBeenCalled();

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });
  });

  describe('deleteTask edge cases', () => {
    it('should handle task not found during pre-delete fetch gracefully', async () => {
      // Mock GET to fail (task not found), DELETE to succeed
      routeRest({ GET: REJECT(new Error('Task not found')), DELETE: null });

      const result = await deleteTask({ id: 1 }, mockAuthManager);

      // Should still proceed with deletion
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      expect(markdown).toContain('Task 1 deleted successfully');
      // Task details not available when pre-fetch fails
    });

    it('should handle various error types during deletion', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      // Mock DELETE to fail with non-Error object
      routeRest({ GET: mockTask, DELETE: REJECT({ status: 500, message: 'Server error' }) });

      await expect(deleteTask({ id: 1 }, mockAuthManager)).rejects.toThrow(
        'Failed to delete task: Unknown error'
      );
    });

    it('should handle string errors during deletion', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      // Mock DELETE to fail with string
      routeRest({ GET: mockTask, DELETE: REJECT('String error message') });

      // The error handler now preserves string messages for better debugging
      await expect(deleteTask({ id: 1 }, mockAuthManager)).rejects.toThrow(
        'Failed to delete task: String error message'
      );
    });
  });

  describe('getTask edge cases', () => {
    it('should handle various error types in getTask', async () => {
      routeRest({ GET: REJECT({ code: 404, message: 'Not found' }) });

      await expect(getTask({ id: 1 }, mockAuthManager)).rejects.toThrow(
        'Failed to get task: Unknown error'
      );
    });

    it('should handle string errors in getTask', async () => {
      routeRest({ GET: REJECT('Database connection lost') });

      // The error handler now preserves string messages for better debugging
      await expect(getTask({ id: 1 }, mockAuthManager)).rejects.toThrow(
        'Failed to get task: Database connection lost'
      );
    });

    it('should handle undefined error in getTask', async () => {
      routeRest({ GET: REJECT(undefined) });

      // Undefined errors still show as "Unknown error"
      await expect(getTask({ id: 1 }, mockAuthManager)).rejects.toThrow(
        'Failed to get task: Unknown error'
      );
    });
  });

  describe('validation edge cases', () => {
    it('should handle validation errors for zero and negative IDs', async () => {
      // Zero projectId triggers the "required" check first
      await expect(createTask({ projectId: 0, title: 'Test' }, mockAuthManager)).rejects.toThrow(
        'projectId is required to create a task'
      );

      await expect(createTask({ projectId: -1, title: 'Test' }, mockAuthManager)).rejects.toThrow(
        'projectId must be a positive integer'
      );

      await expect(getTask({ id: 0 }, mockAuthManager)).rejects.toThrow(
        'Task id is required for get operation'
      );

      await expect(updateTask({ id: -1, title: 'Test' }, mockAuthManager)).rejects.toThrow(
        'id must be a positive integer'
      );

      await expect(deleteTask({ id: 0 }, mockAuthManager)).rejects.toThrow(
        'Task id is required for delete operation'
      );
    });

    it('should handle validation errors for invalid dates', async () => {
      await expect(
        createTask({
          projectId: 1,
          title: 'Test',
          dueDate: 'invalid-date',
        }, mockAuthManager)
      ).rejects.toThrow('dueDate must be a valid ISO 8601 date string');

      await expect(
        updateTask({
          id: 1,
          dueDate: '2024-13-45', // Invalid date
        }, mockAuthManager)
      ).rejects.toThrow('dueDate must be a valid ISO 8601 date string');
    });

    it('should handle validation errors for invalid assignee IDs in createTask', async () => {
      await expect(
        createTask({
          projectId: 1,
          title: 'Test',
          assignees: [1, 0, 2], // 0 is invalid
        }, mockAuthManager)
      ).rejects.toThrow('assignee ID must be a positive integer');

      await expect(
        createTask({
          projectId: 1,
          title: 'Test',
          assignees: [1, -5, 2], // -5 is invalid
        }, mockAuthManager)
      ).rejects.toThrow('assignee ID must be a positive integer');
    });
  });

  describe('simple error context tests', () => {
    it('should handle assignee failure during createTask', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      // PUT (create) succeeds; DELETE (rollback) succeeds.
      routeRest({ PUT: createdTask, DELETE: null });

      // Mock assignee assignment failure
      const assigneeError = new Error('Assignee assignment failed');
      mockClient.tasks.assignUserToTask.mockRejectedValue(assigneeError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          assignees: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow('Failed to complete task creation: Assignee assignment failed');

      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');
    });

    it('should handle rollback failure during createTask', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      // PUT (create) succeeds; DELETE (rollback) fails.
      const deleteError = new Error('Delete failed');
      routeRest({ PUT: createdTask, DELETE: REJECT(deleteError) });

      // Mock label assignment failure
      const labelError = new Error('Label assignment failed');
      mockClient.tasks.addLabelToTask.mockRejectedValue(labelError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow('Task rollback also failed');
    });
  });
});
