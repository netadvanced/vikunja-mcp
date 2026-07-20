/**
 * Targeted validation tests for tasks/crud.ts uncovered lines
 * This file specifically targets the remaining uncovered lines for complete coverage
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest` for the core create/get/update/delete calls.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTask, getTask, updateTask, deleteTask } from '../../src/tools/tasks/crud';
import { MCPError, ErrorCode } from '../../src/types';
import type { AuthManager } from '../../src/auth/AuthManager';
import { parseMarkdown } from '../utils/markdown';

// Mock the direct-REST helper used by the migrated CRUD services
jest.mock('../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Mock the client module (still used by createTask/updateTask for the
// labels/assignees sub-resource — sibling item M-B — when requested)
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

describe('Tasks CRUD - Validation Coverage', () => {
  const mockAuthManager = {} as AuthManager;
  const mockRest = vikunjaRestRequest as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('missing validation error paths', () => {
    it('should handle missing title in createTask (line 36)', async () => {
      await expect(
        createTask({
          projectId: 1,
          title: undefined as any, // Missing title
        }, mockAuthManager)
      ).rejects.toThrow('title is required to create a task');
    });

    it('should handle empty string title in createTask', async () => {
      await expect(
        createTask({
          projectId: 1,
          title: '', // Empty title
        }, mockAuthManager)
      ).rejects.toThrow('title is required to create a task');
    });

    it('should handle missing projectId in createTask (line 30)', async () => {
      await expect(
        createTask({
          projectId: undefined as any, // Missing projectId
          title: 'Test Task',
        }, mockAuthManager)
      ).rejects.toThrow('projectId is required to create a task');
    });

    it('should handle missing id in getTask (line 202)', async () => {
      await expect(
        getTask({
          id: undefined as any, // Missing id
        }, mockAuthManager)
      ).rejects.toThrow('Task id is required for get operation');
    });

    it('should handle missing id in updateTask (line 252)', async () => {
      await expect(
        updateTask({
          id: undefined as any, // Missing id
          title: 'Updated Title',
        }, mockAuthManager)
      ).rejects.toThrow('Task id is required for update operation');
    });

    it('should handle missing id in deleteTask (line 420)', async () => {
      await expect(
        deleteTask({
          id: undefined as any, // Missing id
        }, mockAuthManager)
      ).rejects.toThrow('Task id is required for delete operation');
    });
  });

  describe('error propagation paths', () => {
    it('should handle generic Error in createTask (line 187)', async () => {
      // Mock createTask (PUT /projects/{id}/tasks) to throw a generic Error
      mockRest.mockRejectedValue(new Error('Generic error'));

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
        }, mockAuthManager)
      ).rejects.toThrow('Failed to create task: Generic error');
    });

    it('should handle non-Error object in createTask (line 189)', async () => {
      // Mock createTask to throw a non-Error object
      mockRest.mockRejectedValue({ status: 500, message: 'Server error' });

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
        }, mockAuthManager)
      ).rejects.toThrow('Failed to create task: Unknown error');
    });

    it('should handle generic Error in getTask (line 229)', async () => {
      // Mock getTask (GET /tasks/{id}) to throw a generic Error
      mockRest.mockRejectedValue(new Error('Database error'));

      await expect(
        getTask({
          id: 1,
        }, mockAuthManager)
      ).rejects.toThrow('Failed to get task: Database error');
    });

    it('should handle non-Error object in getTask (line 231)', async () => {
      // Mock getTask to throw a non-Error object
      mockRest.mockRejectedValue({ code: 'DB_ERROR', details: 'Connection lost' });

      await expect(
        getTask({
          id: 1,
        }, mockAuthManager)
      ).rejects.toThrow('Failed to get task: Unknown error');
    });

    it('should handle generic Error in updateTask (line 407)', async () => {
      // Mock initial GET /tasks/{id} (analyzeUpdateState) to succeed, then the
      // POST /tasks/{id} update call to throw a generic Error.
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
      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        .mockRejectedValueOnce(new Error('Update failed')); // POST /tasks/{id}

      await expect(
        updateTask({
          id: 1,
          title: 'Updated Title',
        }, mockAuthManager)
      ).rejects.toThrow('Failed to update task: Update failed');
    });

    it('should handle non-Error object in updateTask (line 409)', async () => {
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
      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        // Mock updateTask to throw a non-Error object. Use a plain object (not a
        // string) here: the error handler intentionally preserves string
        // rejections as the message (consistent with transform(), see
        // src/utils/error-handler.ts) and only collapses non-Error/non-string
        // shapes to "Unknown error" to avoid leaking arbitrary object payloads.
        .mockRejectedValueOnce({ status: 503, message: 'Update service unavailable' });

      await expect(
        updateTask({
          id: 1,
          title: 'Updated Title',
        }, mockAuthManager)
      ).rejects.toThrow('Failed to update task: Unknown error');
    });

    it('should handle generic Error in deleteTask (line 459)', async () => {
      // Mock pre-delete GET to succeed, then DELETE to throw a generic Error
      const mockTask = { id: 1, title: 'Test Task' };
      mockRest
        .mockResolvedValueOnce(mockTask) // gatherDeletionContext's GET
        .mockRejectedValueOnce(new Error('Delete failed')); // DELETE

      await expect(
        deleteTask({
          id: 1,
        }, mockAuthManager)
      ).rejects.toThrow('Failed to delete task: Delete failed');
    });

    it('should handle non-Error object in deleteTask (line 461)', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      mockRest
        .mockResolvedValueOnce(mockTask) // gatherDeletionContext's GET
        .mockRejectedValueOnce(null); // DELETE

      await expect(
        deleteTask({
          id: 1,
        }, mockAuthManager)
      ).rejects.toThrow('Failed to delete task: Unknown error');
    });
  });

  describe('MCPError propagation', () => {
    it('should re-throw MCPError in createTask without wrapping', async () => {
      const originalError = new MCPError(ErrorCode.VALIDATION_ERROR, 'Custom validation error');
      mockRest.mockRejectedValue(originalError);

      await expect(
        createTask({
          projectId: 1,
          title: 'Test Task',
        }, mockAuthManager)
      ).rejects.toThrow(originalError);
    });

    it('should re-throw MCPError in updateTask without wrapping', async () => {
      const originalError = new MCPError(ErrorCode.API_ERROR, 'Custom API error');

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
      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        .mockRejectedValueOnce(originalError); // POST /tasks/{id}

      await expect(
        updateTask({
          id: 1,
          title: 'Updated Title',
        }, mockAuthManager)
      ).rejects.toThrow(originalError);
    });
  });

  describe('affectedFields tracking', () => {
    it('should track field changes correctly in updateTask', async () => {
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

      const updatedTask = {
        ...mockTask,
        title: 'New Title',
        priority: 5,
        done: true,
      };

      mockRest
        .mockResolvedValueOnce(mockTask) // analyzeUpdateState's GET
        .mockResolvedValueOnce(updatedTask) // POST /tasks/{id}
        .mockResolvedValueOnce(updatedTask); // final GET /tasks/{id}

      const result = await updateTask({
        id: 1,
        title: 'New Title',
        priority: 5,
        done: true,
      }, mockAuthManager);

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(markdown).toContain("## ✅ Success");
      expect(markdown).toContain('update-task');
      expect(markdown).toContain('Task updated successfully');
    });
  });
});
