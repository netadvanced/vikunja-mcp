/**
 * Comprehensive authentication error tests for tasks/crud.ts
 * This test file specifically targets uncovered authentication error handling paths
 * to achieve 95%+ test coverage requirement
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest` for the core create/get/update/delete calls.
 * Labels/assignees remain on the node-vikunja client (sub-resource,
 * sibling item M-B) — every scenario in this file is specifically about
 * those sub-resource auth-error paths, so `mockClient` stays the primary
 * mock for label/assignee methods.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { createTask, getTask, updateTask, deleteTask } from '../../src/tools/tasks/crud';
import { MCPError, ErrorCode } from '../../src/types';
import type { MockVikunjaClient } from '../types/mocks';
import type { AuthManager } from '../../src/auth/AuthManager';

// Mock the direct-REST helper used by the migrated CRUD services
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Mock the client module. getAuthManagerFromContext is used by
// setTaskLabels (src/utils/label-bulk.ts, migrated to direct REST) — any
// test here that updates a task's labels needs both this and a mocked
// global fetch (see beforeEach below).
jest.mock('../../src/client', () => ({
  getClientFromContext: jest.fn(),
  getAuthManagerFromContext: jest.fn(),
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

// Mock retry utility to speed up tests but preserve everything else (real
// circuit breaker registry/createCircuitBreaker/RETRY_CONFIG) — the direct-
// REST helper (src/utils/vikunja-rest.ts), now exercised via setTaskLabels,
// also imports createCircuitBreaker/isRetryableError from this module, so a
// partial mock missing them breaks REST calls with
// "createCircuitBreaker is not a function".
jest.mock('../../src/utils/retry', () => {
  const actual = jest.requireActual('../../src/utils/retry');
  return {
    ...actual,
    withRetry: jest.fn().mockImplementation((fn) => fn()),
  };
});

// Import circuit breaker registry after mock setup
import { circuitBreakerRegistry } from '../../src/utils/retry';
import { vikunjaRestRequest } from '../../src/utils/vikunja-rest';

describe('Tasks CRUD - Authentication Error Handling', () => {
  let mockClient: MockVikunjaClient;
  const { getClientFromContext, getAuthManagerFromContext } = require('../../src/client');
  const mockAuthManager = {} as AuthManager;
  const mockRest = vikunjaRestRequest as jest.Mock;

  /** Sentinel wrapper marking a routeRest handler value as a rejection. */
  const REJECT = (value: unknown): { __reject: true; value: unknown } => ({ __reject: true, value });

  /**
   * Routes vikunjaRestRequest calls to per-HTTP-method fixtures/errors.
   *
   * Post Wave-D sub-resource migration (#71), `setTaskLabels` also flows
   * through `vikunjaRestRequest` (POST `/tasks/{id}/labels/bulk`), so a
   * `labels` handler routes that path independently of the core task POST.
   */
  function routeRest(
    handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', unknown>> & { labels?: unknown },
  ): void {
    mockRest.mockImplementation((_auth: unknown, method: string, path?: unknown) => {
      const isLabelBulk = typeof path === 'string' && path.includes('/labels/bulk');
      const handler =
        isLabelBulk && 'labels' in handlers
          ? handlers.labels
          : handlers[method as 'GET' | 'POST' | 'PUT' | 'DELETE'];
      if (handler && typeof handler === 'object' && (handler as { __reject?: true }).__reject === true) {
        return Promise.reject((handler as { value: unknown }).value);
      }
      return Promise.resolve(handler);
    });
  }

  // Create authentication errors with proper structure
  const createAuthError = (status: number, message?: string): Error & { status: number } => {
    const error = new Error(message || 'Authentication failed');
    (error as any).status = status;
    return error as Error & { status: number };
  };

  const createAxiosAuthError = (status: number, message?: string): Error & { response: { status: number } } => {
    const error = new Error(message || 'Authentication failed');
    (error as any).response = { status };
    return error as Error & { response: { status: number } };
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Reset circuit breakers to prevent state leakage between tests
    // This prevents "CircuitBreakerOpenError" from affecting subsequent tests
    await circuitBreakerRegistry.resetAll();

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

    // setTaskLabels (src/utils/label-bulk.ts) now calls the direct-REST
    // helper (vikunjaRestRequest, mocked here as mockRest) rather than
    // mockClient.tasks.updateTaskLabels, and recovers its session via
    // getAuthManagerFromContext — provide one so incidental label updates
    // in these CRUD tests keep working. Tests that specifically exercise
    // label-path errors route the `/labels/bulk` POST via routeRest's
    // `labels` handler.
    getAuthManagerFromContext.mockResolvedValue({
      getSession: () => ({ apiUrl: 'https://mock.vikunja.test', apiToken: 'mock-token' }),
    });
  });

  describe('createTask authentication errors', () => {
    it('should handle authentication error in label assignment (line 92)', async () => {
      // Mock successful task creation, and successful rollback delete
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, DELETE: null });

      // Mock label assignment failure with 401 auth error
      const authError = createAuthError(401, 'Unauthorized to assign labels');
      mockClient.tasks.addLabelToTask.mockRejectedValue(authError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify the error message includes authentication guidance
      try {
        await createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2],
        }, mockAuthManager);
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).message).toContain('Task ID: 1');
      }

      // Verify rollback was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');
    });

    it('should handle authentication error in label assignment with Axios-style error', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, DELETE: null });

      // Mock label assignment failure with 403 Axios-style auth error
      const authError = createAxiosAuthError(403, 'Forbidden to assign labels');
      mockClient.tasks.addLabelToTask.mockRejectedValue(authError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify rollback was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');
    });

    it('should handle authentication error in assignee assignment (line 118)', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, DELETE: null });
      mockClient.tasks.addLabelToTask.mockResolvedValue(undefined);

      // Mock assignee assignment failure with 401 auth error
      const authError = createAuthError(401, 'Unauthorized to assign users');
      mockClient.tasks.assignUserToTask.mockRejectedValue(authError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1],
          assignees: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify the error message includes retry information
      try {
        await createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1],
          assignees: [1, 2],
        }, mockAuthManager);
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).message).toContain('(Retried');
        expect((error as MCPError).message).toContain('Task ID: 1');
      }

      // Verify rollback was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');
    });

    it('should handle authentication error in assignee assignment with 403 error', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, DELETE: null });

      // Mock assignee assignment failure with 403 auth error
      const authError = createAxiosAuthError(403, 'Forbidden to assign users');
      mockClient.tasks.assignUserToTask.mockRejectedValue(authError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          assignees: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify rollback was attempted
      expect(mockRest).toHaveBeenCalledWith(mockAuthManager, 'DELETE', '/tasks/1');
    });
  });

  describe('updateTask authentication errors', () => {
    const mockTask = {
      id: 1,
      title: 'Original Title',
      description: 'Original Description',
      due_date: null,
      priority: 1,
      done: false,
      repeat_after: 0,
      repeat_mode: 0,
      assignees: [{ id: 1 }, { id: 2 }],
    };

    it('should handle authentication error in label update (lines 328-331)', async () => {
      // Core task fetch/update succeed; the label-bulk POST fails with a
      // 401 auth error.
      routeRest({
        GET: mockTask,
        POST: mockTask,
        labels: REJECT(createAuthError(401, 'Unauthorized to update labels')),
      });

      await expect(
        updateTask({
          id: 1,
          title: 'Updated Title',
          labels: [1, 2, 3],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify the specific auth error message is thrown
      try {
        await updateTask({
          id: 1,
          title: 'Updated Title',
          labels: [1, 2, 3],
        }, mockAuthManager);
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).code).toBe(ErrorCode.API_ERROR);
      }
    });

    it('should handle authentication error in label update with 403 error', async () => {
      // Core task fetch/update succeed; the label-bulk POST fails with a
      // 403 auth error (setTaskLabels rethrows it, updateTaskLabels wraps
      // it as an MCPError).
      routeRest({
        GET: mockTask,
        POST: mockTask,
        labels: REJECT(createAuthError(403, 'Forbidden to update labels')),
      });

      await expect(
        updateTask({
          id: 1,
          title: 'Updated Title',
          labels: [1, 2, 3],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);
    });

    it('should handle authentication error in assignee removal (line 361)', async () => {
      // Mock task with current assignees
      const taskWithAssignees = {
        ...mockTask,
        assignees: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };

      routeRest({ GET: taskWithAssignees, POST: taskWithAssignees });
      // updateTaskAssignees's diff-calculation fetch (still node-vikunja client)
      mockClient.tasks.getTask.mockResolvedValue(taskWithAssignees);

      // Mock successful assignee addition but failed removal with auth error
      mockClient.tasks.assignUserToTask.mockResolvedValue(undefined);
      const authError = createAuthError(401, 'Unauthorized to remove assignee');
      mockClient.tasks.removeUserFromTask.mockRejectedValue(authError);

      await expect(
        updateTask({
          id: 1,
          assignees: [1, 4], // Remove 2 and 3, add 4
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify the specific auth error message is thrown
      try {
        await updateTask({
          id: 1,
          assignees: [1, 4], // Remove 2 and 3, add 4
        }, mockAuthManager);
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).code).toBe(ErrorCode.API_ERROR);
      }
    });

    it('should handle authentication error in assignee removal with 403 error', async () => {
      const taskWithAssignees = {
        ...mockTask,
        assignees: [{ id: 1 }, { id: 2 }],
      };

      routeRest({ GET: taskWithAssignees, POST: taskWithAssignees });
      mockClient.tasks.getTask.mockResolvedValue(taskWithAssignees);

      // Mock failed removal with 403 auth error
      const authError = createAxiosAuthError(403, 'Forbidden to remove assignee');
      mockClient.tasks.removeUserFromTask.mockRejectedValue(authError);

      await expect(
        updateTask({
          id: 1,
          assignees: [1], // Remove assignee 2
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);
    });

    it('should handle authentication error in general assignee update (line 369)', async () => {
      routeRest({ GET: mockTask, POST: mockTask });

      // Mock assignee operations failure with auth error at the top level
      const authError = createAuthError(401, 'Unauthorized assignee operation');

      // Make the diff-calculation getTask call fail with auth error (test
      // calls updateTask twice, so this must persist across both calls)
      mockClient.tasks.getTask.mockRejectedValue(authError);

      await expect(
        updateTask({
          id: 1,
          assignees: [1, 2, 3],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);

      // Verify the error message includes retry information
      try {
        await updateTask({
          id: 1,
          assignees: [1, 2, 3],
        }, mockAuthManager);
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).message).toContain('(Retried');
      }
    });

    it('should handle authentication error in general assignee update with 403 error', async () => {
      routeRest({ GET: mockTask, POST: mockTask });

      // Mock assignee operations failure with 403 auth error
      const authError = createAxiosAuthError(403, 'Forbidden assignee operation');

      // Make the assignee addition fail with auth error
      mockClient.tasks.getTask.mockResolvedValueOnce(mockTask); // diff calculation
      mockClient.tasks.assignUserToTask.mockRejectedValue(authError);

      await expect(
        updateTask({
          id: 1,
          assignees: [1, 2, 3],
        }, mockAuthManager)
      ).rejects.toThrow(MCPError);
    });
  });

  describe('error propagation and non-auth errors', () => {
    it('should properly propagate non-authentication errors in createTask', async () => {
      const createdTask = { id: 1, title: 'Test Task', project_id: 1 };
      routeRest({ PUT: createdTask, DELETE: null });

      // Mock label assignment failure with non-auth error
      const nonAuthError = new Error('Network timeout');
      mockClient.tasks.addLabelToTask.mockRejectedValue(nonAuthError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1, 2],
        }, mockAuthManager)
      ).rejects.toThrow('Failed to complete task creation: Network timeout');
    });

    it('should properly propagate non-authentication errors in updateTask', async () => {
      const mockTask = {
        id: 1,
        title: 'Original Title',
        description: 'Original Description',
        due_date: null,
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        assignees: [],
      };

      // Core task fetch/update succeed; the label-bulk POST fails with a
      // non-auth (network-level) error.
      routeRest({
        GET: mockTask,
        POST: mockTask,
        labels: REJECT(new Error('Database connection failed')),
      });

      await expect(
        updateTask({
          id: 1,
          labels: [1, 2, 3],
        }, mockAuthManager)
      ).rejects.toThrow('Database connection failed');
    });
  });

  describe('edge cases for complete coverage', () => {
    it('should fail createTask when labels requested but task has no ID', async () => {
      // Mock task creation returning undefined/null ID
      const createdTaskNoId = { title: 'Test Task', project_id: 1, id: undefined };
      routeRest({ PUT: createdTaskNoId });

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
          labels: [1],
        }, mockAuthManager),
      ).rejects.toThrow('did not return a task id');

      // Verify no label operations were attempted due to missing task ID
      expect(mockClient.tasks.addLabelToTask).not.toHaveBeenCalled();
      // Verify no DELETE (rollback) call was made since there's no ID
      expect(mockRest).not.toHaveBeenCalledWith(mockAuthManager, 'DELETE', expect.anything());
    });

    it('should handle updateTask with task having no assignees field', async () => {
      const taskWithoutAssignees = {
        id: 1,
        title: 'Test Task',
        description: '',
        due_date: null,
        priority: 1,
        done: false,
        repeat_after: 0,
        repeat_mode: 0,
        // assignees field is missing
      };

      routeRest({ GET: taskWithoutAssignees, POST: taskWithoutAssignees });
      mockClient.tasks.getTask.mockResolvedValueOnce(taskWithoutAssignees); // diff calculation
      mockClient.tasks.assignUserToTask.mockResolvedValue(undefined);

      await updateTask({
        id: 1,
        assignees: [1, 2],
      }, mockAuthManager);

      // Should handle undefined assignees gracefully and add new ones
      // (one additive per-user call each)
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 1);
      expect(mockClient.tasks.assignUserToTask).toHaveBeenCalledWith(1, 2);
      expect(mockClient.tasks.bulkAssignUsersToTask).not.toHaveBeenCalled();
    });
  });
});
