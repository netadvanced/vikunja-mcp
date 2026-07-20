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

// Mock the direct-REST helper used by the migrated CRUD services.
// resolveKanbanViewId (used by moveTaskToBucket, see ../buckets) is mocked
// separately rather than left to its real implementation: it internally
// calls this same module's vikunjaRestRequest via a same-module reference
// that bypasses the mock override below, so it must be driven directly by
// each bucketId test instead of through the GET-routing fixtures.
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
  resolveKanbanViewId: jest.fn(),
}));

// Mock the client module (still used for labels/assignees sub-resource calls)
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

import { vikunjaRestRequest, resolveKanbanViewId } from '../../src/utils/vikunja-rest';

describe('Tasks CRUD - Edge Cases and Defensive Programming', () => {
  let mockClient: MockVikunjaClient;
  const { getClientFromContext } = require('../../src/client');
  const mockAuthManager = {} as AuthManager;
  const mockRest = vikunjaRestRequest as jest.Mock;
  const mockResolveKanbanViewId = resolveKanbanViewId as jest.Mock;

  /** Sentinel wrapper marking a routeRest handler value as a rejection. */
  const REJECT = (value: unknown): { __reject: true; value: unknown } => ({ __reject: true, value });

  type RestHandler = unknown | ((path: string) => unknown);

  /**
   * Routes vikunjaRestRequest calls to per-HTTP-method fixtures/errors. Good
   * enough for these tests since each one does at most a handful of calls
   * per method (GET for fetch/re-fetch, POST for update, PUT for create,
   * DELETE for delete/rollback). Wrap a handler in `REJECT(...)` to make
   * that method's calls reject instead of resolve — plain `instanceof Error`
   * detection isn't reliable here since some tests deliberately reject with
   * non-Error values (strings, plain objects, undefined).
   *
   * Since the label/assignee sub-resource adds now also go through
   * vikunjaRestRequest (PUT /tasks/{id}/labels, PUT /tasks/{id}/assignees) —
   * the same method (PUT) as the base-task create (PUT /projects/{id}/tasks) —
   * a method handler may be a function of the request path so one method can
   * succeed for one path and fail for another.
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

      // GET routes both analyzeUpdateState's fetch and updateTaskAssignees's
      // diff-calculation fetch (both now GET /tasks/1 via vikunjaRestRequest).
      routeRest({ GET: taskWithAssignees, POST: taskWithAssignees, DELETE: null });

      const result = await updateTask({
        id: 1,
        assignees: [], // Remove all assignees
      }, mockAuthManager);

      // Should remove all existing assignees via DELETE /tasks/1/assignees/{userId}
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1/assignees/1');
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1/assignees/2');
      // Should not add any assignees (no PUT to the assignees endpoint)
      expect(mockRest).not.toHaveBeenCalledWith(
        mockAuthManager,
        'PUT',
        '/tasks/1/assignees',
        expect.anything(),
      );

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

      routeRest({ GET: taskWithNullAssignees, POST: taskWithNullAssignees, PUT: {} });

      const result = await updateTask({
        id: 1,
        assignees: [1, 2], // Add assignees to task with null assignees
      }, mockAuthManager);

      // Should add all assignees (since current is empty due to null), one
      // additive per-user PUT /tasks/1/assignees { user_id } call each
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/tasks/1/assignees', { user_id: 1 });
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'PUT', '/tasks/1/assignees', { user_id: 2 });
      // Should not remove any assignees (no DELETE to the assignees endpoint)
      expect(mockRest).not.toHaveBeenCalledWith(
        mockAuthManager,
        'DELETE',
        expect.stringContaining('/tasks/1/assignees/'),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
    });
  });

  // Item E1 (battle-tested friction #1): `update`'s `bucketId` field was
  // previously accepted by the tool schema but never read here, so a Kanban
  // move requested alongside other field updates was silently dropped.
  describe('updateTask bucketId (Kanban bucket move)', () => {
    const bucketTask = {
      id: 1,
      title: 'Original Title',
      description: 'Original Description',
      due_date: '2024-01-01T00:00:00Z',
      priority: 1,
      done: false,
      repeat_after: 0,
      repeat_mode: 0,
      project_id: 5,
      assignees: [],
    };

    it('applies bucketId via the same view/bucket resolution set-bucket uses, and honestly reports it', async () => {
      routeRest({
        GET: bucketTask,
        POST: (path: string) => {
          if (path === '/tasks/1') return bucketTask;
          if (path === '/projects/5/views/11/buckets/7/tasks') return {};
          return undefined;
        },
      });
      mockResolveKanbanViewId.mockResolvedValue(11);

      const result = await updateTask(
        { id: 1, dueDate: '2024-06-01T00:00:00Z', bucketId: 7 },
        mockAuthManager,
      );

      // Same resolution helper set-bucket uses (see ../buckets.ts), given
      // the project id resolved from the task itself (project_id: 5)
      expect(mockResolveKanbanViewId).toHaveBeenCalledWith(mockAuthManager, 5);
      // The dedicated bucket-move endpoint was called with the TaskBucket payload
      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'POST',
        '/projects/5/views/11/buckets/7/tasks',
        { task_id: 1, bucket_id: 7 },
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      const aorpStatus = parsed.getAorpStatus();
      expect(aorpStatus.type).toBe('success');
      // affectedFields must honestly include bucketId alongside the other
      // changed field, not silently drop it (the friction this item fixes).
      expect(markdown).toContain('bucketId');
      expect(markdown).toContain('dueDate');
    });

    it('resolves project and view the same way set-bucket does when both are omitted', async () => {
      let bucketPostCalled = false;
      routeRest({
        GET: bucketTask,
        POST: (path: string) => {
          if (path === '/tasks/1') return bucketTask;
          if (path === '/projects/5/views/11/buckets/9/tasks') {
            bucketPostCalled = true;
            return {};
          }
          return undefined;
        },
      });
      mockResolveKanbanViewId.mockResolvedValue(11);

      await updateTask({ id: 1, bucketId: 9 }, mockAuthManager);

      expect(bucketPostCalled).toBe(true);
    });

    it('uses an explicit viewId without calling resolveKanbanViewId', async () => {
      routeRest({
        GET: bucketTask,
        POST: (path: string) => {
          if (path === '/tasks/1') return bucketTask;
          if (path === '/projects/5/views/22/buckets/9/tasks') return {};
          return undefined;
        },
      });

      await updateTask({ id: 1, bucketId: 9, viewId: 22 }, mockAuthManager);

      expect(mockResolveKanbanViewId).not.toHaveBeenCalled();
      expect(mockRest).toHaveBeenCalledWith(
        mockAuthManager,
        'POST',
        '/projects/5/views/22/buckets/9/tasks',
        { task_id: 1, bucket_id: 9 },
      );
    });

    it('does not call the bucket-move endpoint when bucketId is omitted (unchanged behavior)', async () => {
      routeRest({ GET: bucketTask, POST: bucketTask });

      const result = await updateTask({ id: 1, title: 'New Title' }, mockAuthManager);

      expect(mockRest).not.toHaveBeenCalledWith(
        mockAuthManager,
        'POST',
        expect.stringContaining('/buckets/'),
        expect.anything(),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(parsed.getAorpStatus().type).toBe('success');
      expect(markdown).not.toContain('bucketId');
    });

    it('rejects a non-positive bucketId before making any REST calls', async () => {
      await expect(
        updateTask({ id: 1, bucketId: 0 }, mockAuthManager),
      ).rejects.toThrow('bucketId must be a positive integer');
      expect(mockRest).not.toHaveBeenCalled();
    });

    it('rejects a non-positive viewId before making any REST calls', async () => {
      await expect(
        updateTask({ id: 1, bucketId: 7, viewId: -1 }, mockAuthManager),
      ).rejects.toThrow('viewId must be a positive integer');
      expect(mockRest).not.toHaveBeenCalled();
    });

    it('propagates a bucket-move failure as the update failure (no partial silent success)', async () => {
      routeRest({
        GET: bucketTask,
        POST: (path: string) => {
          if (path === '/tasks/1') return bucketTask;
          return undefined;
        },
      });
      mockResolveKanbanViewId.mockRejectedValue(
        new MCPError(ErrorCode.NOT_FOUND, 'Project 5 has no Kanban view, so it has no buckets'),
      );

      await expect(
        updateTask({ id: 1, bucketId: 7 }, mockAuthManager),
      ).rejects.toThrow('Project 5 has no Kanban view, so it has no buckets');
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
      // PUT /projects/1/tasks (create) succeeds; PUT /tasks/1/assignees (assign)
      // fails; DELETE (rollback) succeeds.
      const assigneeError = new Error('Assignee assignment failed');
      routeRest({
        PUT: (path) =>
          path === '/projects/1/tasks' ? createdTask : REJECT(assigneeError),
        DELETE: null,
      });

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
      // PUT /projects/1/tasks (create) succeeds; PUT /tasks/1/labels (label add)
      // fails; DELETE (rollback) also fails.
      const deleteError = new Error('Delete failed');
      const labelError = new Error('Label assignment failed');
      routeRest({
        PUT: (path) => (path === '/projects/1/tasks' ? createdTask : REJECT(labelError)),
        DELETE: REJECT(deleteError),
      });

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
