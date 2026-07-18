/**
 * Tests for ClientSideFilteringStrategy
 *
 * Covers the cross-project aggregation behavior introduced to work around
 * Vikunja's unreliable GET /tasks/all endpoint (HTTP 400 "Invalid model
 * provided" on some servers, reproduced on v2.3.0). Cross-project listings
 * now aggregate GET /projects/{id}/tasks across every accessible project.
 *
 * Migrated (Wave D, tasks-core) off the node-vikunja client onto
 * `vikunjaRestRequest`, mirroring RestCrossProjectFilteringStrategy's test
 * mocking approach (mock the REST helper, assert on payload/path).
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ClientSideFilteringStrategy } from '../../../src/utils/filtering/ClientSideFilteringStrategy';
import type { FilteringParams } from '../../../src/utils/filtering/types';
import type { AuthManager } from '../../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../../src/types';

jest.mock('../../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Mock validation
jest.mock('../../../src/tools/tasks/validation', () => ({
  validateId: jest.fn(),
}));

import { vikunjaRestRequest } from '../../../src/utils/vikunja-rest';
import { validateId } from '../../../src/tools/tasks/validation';
import { logger } from '../../../src/utils/logger';

interface MockTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  priority: number;
  percent_done: number;
  created: string;
  updated: string;
  project_id: number;
  assignees: unknown[];
  labels: unknown[];
}

interface MockProject {
  id: number;
  title: string;
}

describe('ClientSideFilteringStrategy', () => {
  let strategy: ClientSideFilteringStrategy;
  let mockAuthManager: AuthManager;

  const makeTask = (id: number, projectId: number): MockTask => ({
    id,
    title: `Task ${id}`,
    description: '',
    done: false,
    priority: 1,
    percent_done: 0,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    project_id: projectId,
    assignees: [],
    labels: [],
  });

  const makeProject = (id: number): MockProject => ({
    id,
    title: `Project ${id}`,
  });

  beforeEach(() => {
    jest.clearAllMocks();

    strategy = new ClientSideFilteringStrategy();
    mockAuthManager = {} as AuthManager;

    (validateId as jest.MockedFunction<typeof validateId>).mockImplementation(() => {});
  });

  describe('missing authManager', () => {
    it('throws INTERNAL_ERROR when authManager is not provided', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: {},
      };

      await expect(strategy.execute(params)).rejects.toThrow(
        new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'ClientSideFilteringStrategy requires an authManager',
        ),
      );
      expect(vikunjaRestRequest).not.toHaveBeenCalled();
    });
  });

  describe('single-project path', () => {
    it('calls GET /projects/{id}/tasks directly and does not aggregate when projectId is set and allProjects is not', async () => {
      const projectId = 42;
      const task = makeTask(1, projectId);
      const params: FilteringParams = {
        args: { projectId, allProjects: false },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 10 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockResolvedValue([task]);

      const result = await strategy.execute(params);

      expect(validateId).toHaveBeenCalledWith(projectId, 'projectId');
      expect(vikunjaRestRequest).toHaveBeenCalledTimes(1);
      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/42/tasks?page=1&per_page=10',
      );
      expect(result.tasks).toEqual([task]);
      expect(result.metadata.serverSideFilteringUsed).toBe(false);
      expect(result.metadata.serverSideFilteringAttempted).toBe(false);
    });
  });

  describe('cross-project aggregation', () => {
    it('aggregates tasks across all projects instead of calling GET /tasks/all (allProjects: true)', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      const taskA = makeTask(10, 1);
      const taskB = makeTask(20, 2);
      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([makeProject(1), makeProject(2)]);
        if (path.startsWith('/projects/1/tasks')) return Promise.resolve([taskA]);
        if (path.startsWith('/projects/2/tasks')) return Promise.resolve([taskB]);
        return Promise.resolve([]);
      });

      const result = await strategy.execute(params);

      expect(vikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/projects?per_page=1000');
      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/1/tasks?page=1&per_page=50',
      );
      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/2/tasks?page=1&per_page=50',
      );
      expect(result.tasks).toEqual([taskA, taskB]);
    });

    it('aggregates when projectId is omitted entirely', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      const task = makeTask(30, 3);
      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([makeProject(3)]);
        return Promise.resolve([task]);
      });

      const result = await strategy.execute(params);

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/projects/3/tasks?page=1&per_page=50',
      );
      expect(result.tasks).toEqual([task]);
    });

    it('skips pseudo-projects with a negative id (e.g. Favorites) to avoid duplicate tasks', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      const realTask = makeTask(50, 5);
      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        // -1 (Favorites pseudo-project), 0 (invalid), and a valid real project.
        if (path === '/projects?per_page=1000') {
          return Promise.resolve([makeProject(-1), makeProject(0), makeProject(5)]);
        }
        if (path.startsWith('/projects/5/tasks')) return Promise.resolve([realTask]);
        return Promise.resolve([]);
      });

      const result = await strategy.execute(params);

      // Only the real project (id 5) should be fetched.
      const projectTaskCalls = (vikunjaRestRequest as jest.Mock).mock.calls.filter(
        (call) => typeof call[2] === 'string' && (call[2] as string).startsWith('/projects/') && (call[2] as string).includes('/tasks'),
      );
      expect(projectTaskCalls).toHaveLength(1);
      expect(projectTaskCalls[0]?.[2]).toBe('/projects/5/tasks?page=1&per_page=50');
      expect(result.tasks).toEqual([realTask]);
    });

    it('skips a project whose id is not a number', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      const realTask = makeTask(70, 7);
      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') {
          return Promise.resolve([{ id: undefined, title: 'No id' }, makeProject(7)]);
        }
        if (path.startsWith('/projects/7/tasks')) return Promise.resolve([realTask]);
        return Promise.resolve([]);
      });

      const result = await strategy.execute(params);

      expect(result.tasks).toEqual([realTask]);
    });

    it('logs and skips a project whose fetch throws without failing the whole listing', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      const goodTask = makeTask(10, 1);
      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([makeProject(1), makeProject(2)]);
        if (path.startsWith('/projects/1/tasks')) return Promise.resolve([goodTask]);
        if (path.startsWith('/projects/2/tasks')) return Promise.reject(new Error('boom on project 2'));
        return Promise.resolve([]);
      });

      const result = await strategy.execute(params);

      // The failing project is skipped; the good project's tasks still return.
      expect(result.tasks).toEqual([goodTask]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping a project that failed during all-projects task aggregation',
        expect.objectContaining({ projectId: 2, error: 'boom on project 2' }),
      );
    });

    it('stringifies non-Error thrown values when logging a skipped project', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([makeProject(9)]);
        // eslint-disable-next-line prefer-promise-reject-errors
        return Promise.reject('plain string failure');
      });

      const result = await strategy.execute(params);

      expect(result.tasks).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith(
        'Skipping a project that failed during all-projects task aggregation',
        expect.objectContaining({ projectId: 9, error: 'plain string failure' }),
      );
    });
  });

  describe('client-side filtering and metadata', () => {
    it('applies the filter expression to aggregated tasks and reports client-side metadata', async () => {
      const doneTask = { ...makeTask(1, 1), done: true };
      const openTask = { ...makeTask(2, 1), done: false };
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: {
          groups: [
            {
              conditions: [{ field: 'done', operator: '=', value: true }],
              operator: '&&',
            },
          ],
          operator: '&&',
        },
        filterString: 'done = true',
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([makeProject(1)]);
        return Promise.resolve([doneTask, openTask]);
      });

      const result = await strategy.execute(params);

      expect(result.tasks).toEqual([doneTask]);
      expect(result.metadata.clientSideFiltering).toBe(true);
      expect(result.metadata.serverSideFilteringUsed).toBe(false);
      expect(result.metadata.serverSideFilteringAttempted).toBe(false);
    });

    it('returns an empty task list when no projects are accessible', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      };

      (vikunjaRestRequest as jest.Mock).mockImplementation((_auth: unknown, _method: string, path: string) => {
        if (path === '/projects?per_page=1000') return Promise.resolve([]);
        return Promise.resolve([]);
      });

      const result = await strategy.execute(params);

      const projectTaskCalls = (vikunjaRestRequest as jest.Mock).mock.calls.filter(
        (call) => typeof call[2] === 'string' && (call[2] as string).startsWith('/projects/') && (call[2] as string).includes('/tasks'),
      );
      expect(projectTaskCalls).toHaveLength(0);
      expect(result.tasks).toEqual([]);
      expect(result.metadata.clientSideFiltering).toBe(false);
    });
  });
});
