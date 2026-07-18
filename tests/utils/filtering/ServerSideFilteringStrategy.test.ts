/**
 * Tests for ServerSideFilteringStrategy
 * Ensures server-side filtering behavior is properly tested
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest`. The cross-project ("all projects") branch calls the
 * same (non-existent) `GET /tasks/all` path node-vikunja's `getAllTasks`
 * used pre-migration — see ServerSideFilteringStrategy's doc comment for why
 * that literal call-site migration is preserved rather than redirected to a
 * different, working endpoint. This branch is unreachable in production
 * (FilteringContext always routes cross-project listings through
 * RestCrossProjectFilteringStrategy first) but is still exercised directly
 * here since the class remains independently unit-tested.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ServerSideFilteringStrategy } from '../../../src/utils/filtering/ServerSideFilteringStrategy';
import type { FilteringParams } from '../../../src/utils/filtering/types';
import type { AuthManager } from '../../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../../src/types';

jest.mock('../../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../../src/tools/tasks/validation', () => ({
  validateId: jest.fn(),
}));

import { vikunjaRestRequest } from '../../../src/utils/vikunja-rest';
import { validateId } from '../../../src/tools/tasks/validation';

interface MockTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  priority: number;
  percent_done: number;
  due_date: string;
  created: string;
  updated: string;
  project_id: number;
  assignees: unknown[];
  labels: unknown[];
}

describe('ServerSideFilteringStrategy', () => {
  let strategy: ServerSideFilteringStrategy;
  let mockAuthManager: AuthManager;

  const mockTask: MockTask = {
    id: 1,
    title: 'Test Task',
    description: 'Test Description',
    done: false,
    priority: 5,
    percent_done: 0,
    due_date: '2025-01-15T00:00:00Z',
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    project_id: 1,
    assignees: [],
    labels: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    strategy = new ServerSideFilteringStrategy();
    mockAuthManager = {} as AuthManager;

    (validateId as jest.MockedFunction<typeof validateId>).mockImplementation(() => {});
  });

  describe('execute', () => {
    it('should throw error when no filter string is provided', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      await expect(strategy.execute(params)).rejects.toThrow(MCPError);
      await expect(strategy.execute(params)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Server-side filtering requires a filter string'
      });
    });

    it('should throw INTERNAL_ERROR when authManager is not provided', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
      };

      await expect(strategy.execute(params)).rejects.toMatchObject({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'ServerSideFilteringStrategy requires an authManager',
      });
      expect(vikunjaRestRequest).not.toHaveBeenCalled();
    });

    it('should use GET /tasks/all for all projects filtering', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute(params);

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/tasks/all?page=1&per_page=10&filter=priority+%3E%3D+3',
      );
      expect(result.tasks).toEqual([mockTask]);
      expect(result.metadata.serverSideFilteringUsed).toBe(true);
      expect(result.metadata.serverSideFilteringAttempted).toBe(true);
      expect(result.metadata.clientSideFiltering).toBe(false);
    });

    it('should use GET /tasks/all when no projectId is specified', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'done = false',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute(params);

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/tasks/all?page=1&per_page=10&filter=done+%3D+false',
      );
      expect(result.metadata.filteringNote).toBe('Server-side filtering used (modern Vikunja)');
    });

    it('should use GET /projects/{id}/tasks for specific project filtering', async () => {
      const projectId = 42;
      const params: FilteringParams = {
        args: { projectId, allProjects: false },
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute(params);

      expect(validateId).toHaveBeenCalledWith(projectId, 'projectId');
      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/42/tasks?page=1&per_page=10&filter=priority+%3E%3D+3',
      );
      expect(result.tasks).toEqual([mockTask]);
    });

    it('should re-throw API errors without modification', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      const apiError = new Error('Server-side filtering not supported');
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(apiError);

      await expect(strategy.execute(params)).rejects.toThrow(apiError);
    });

    it('should handle validation errors for invalid project IDs', async () => {
      const params: FilteringParams = {
        args: { projectId: -1 },
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      const validationError = new MCPError(ErrorCode.VALIDATION_ERROR, 'Invalid project ID');
      (validateId as jest.MockedFunction<typeof validateId>).mockImplementation(() => {
        throw validationError;
      });

      await expect(strategy.execute(params)).rejects.toThrow(validationError);
      expect(vikunjaRestRequest).not.toHaveBeenCalled();
    });

    it('should include filter string in API parameters', async () => {
      const filterString = 'created > now-7d && priority >= 3';
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString,
        params: { page: 2, per_page: 50, sort_by: 'priority' },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      await strategy.execute(params);

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        `/tasks/all?page=2&per_page=50&sort_by=priority&filter=${encodeURIComponent(filterString).replace(/%20/g, '+')}`,
      );
    });

    it('should return correct metadata structure', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute(params);

      expect(result.metadata).toEqual({
        serverSideFilteringUsed: true,
        serverSideFilteringAttempted: true,
        clientSideFiltering: false,
        filteringNote: 'Server-side filtering used (modern Vikunja)'
      });
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      const networkError = new Error('Network connection failed');
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(networkError);

      await expect(strategy.execute(params)).rejects.toThrow(networkError);
    });

    it('should handle API authentication errors', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      const authError = new Error('Unauthorized');
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(authError);

      await expect(strategy.execute(params)).rejects.toThrow(authError);
    });

    it('should handle malformed filter syntax errors', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'invalid filter syntax',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      const syntaxError = new Error('Invalid filter syntax');
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(syntaxError);

      await expect(strategy.execute(params)).rejects.toThrow(syntaxError);
    });
  });

  describe('edge cases', () => {
    it('should handle empty filter string', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: '',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      await expect(strategy.execute(params)).rejects.toThrow(MCPError);
    });

    it('should handle whitespace-only filter string', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: '   ',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      // Whitespace filter should be passed through to API (may cause server error)
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(new Error('Invalid filter'));

      await expect(strategy.execute(params)).rejects.toThrow();
    });

    it('should handle projectId = 0', async () => {
      const params: FilteringParams = {
        args: { projectId: 0, allProjects: false },
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([]);

      const result = await strategy.execute(params);

      expect(validateId).toHaveBeenCalledWith(0, 'projectId');
      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/0/tasks?page=1&per_page=10&filter=priority+%3E%3D+3',
      );
      expect(result.tasks).toEqual([]);
    });

    it('should handle API returning undefined (defensive programming)', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      // Mock API returning undefined (edge case)
      (vikunjaRestRequest as jest.Mock).mockResolvedValue(undefined);

      const result = await strategy.execute(params);

      expect(result.tasks).toEqual([]);
      expect(result.metadata.serverSideFilteringUsed).toBe(true);
    });
  });
});
