/**
 * Tests for ClientSideFilteringStrategy
 *
 * Covers the cross-project aggregation behavior introduced to work around
 * Vikunja's unreliable GET /tasks/all endpoint (HTTP 400 "Invalid model
 * provided" on some servers, reproduced on v2.3.0). Cross-project listings
 * now aggregate GET /projects/{id}/tasks across every accessible project.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { ClientSideFilteringStrategy } from '../../../src/utils/filtering/ClientSideFilteringStrategy';
import type { FilteringParams } from '../../../src/utils/filtering/types';
import type { MockVikunjaClient } from '../../types/mocks';
import type { Task, Project } from 'node-vikunja';

// Mock the client
jest.mock('../../../src/client', () => ({
  getClientFromContext: jest.fn(),
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

import { getClientFromContext } from '../../../src/client';
import { validateId } from '../../../src/tools/tasks/validation';
import { logger } from '../../../src/utils/logger';

describe('ClientSideFilteringStrategy', () => {
  let strategy: ClientSideFilteringStrategy;
  let mockClient: MockVikunjaClient;

  const makeTask = (id: number, projectId: number): Task =>
    ({
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
    }) as Task;

  const makeProject = (id: number): Project =>
    ({
      id,
      title: `Project ${id}`,
    }) as Project;

  beforeEach(() => {
    jest.clearAllMocks();

    strategy = new ClientSideFilteringStrategy();

    mockClient = {
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
      projects: {
        getProjects: jest.fn(),
        createProject: jest.fn(),
        getProject: jest.fn(),
        updateProject: jest.fn(),
        deleteProject: jest.fn(),
        createLinkShare: jest.fn(),
        getLinkShares: jest.fn(),
        getLinkShare: jest.fn(),
        deleteLinkShare: jest.fn(),
      },
    } as unknown as MockVikunjaClient;

    (getClientFromContext as jest.MockedFunction<typeof getClientFromContext>).mockResolvedValue(
      mockClient,
    );
    (validateId as jest.MockedFunction<typeof validateId>).mockImplementation(() => {});
  });

  describe('single-project path', () => {
    it('calls getProjectTasks directly and does not aggregate when projectId is set and allProjects is not', async () => {
      const projectId = 42;
      const task = makeTask(1, projectId);
      const params: FilteringParams = {
        args: { projectId, allProjects: false },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 10 },
      };

      mockClient.tasks.getProjectTasks.mockResolvedValue([task]);

      const result = await strategy.execute(params);

      expect(validateId).toHaveBeenCalledWith(projectId, 'projectId');
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledTimes(1);
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(projectId, {
        page: 1,
        per_page: 10,
      });
      // Aggregation entry points must not be touched on the single-project path.
      expect(mockClient.projects.getProjects).not.toHaveBeenCalled();
      expect(mockClient.tasks.getAllTasks).not.toHaveBeenCalled();
      expect(result.tasks).toEqual([task]);
      expect(result.metadata.serverSideFilteringUsed).toBe(false);
      expect(result.metadata.serverSideFilteringAttempted).toBe(false);
    });
  });

  describe('cross-project aggregation', () => {
    it('aggregates tasks across all projects instead of calling getAllTasks (allProjects: true)', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
      };

      mockClient.projects.getProjects.mockResolvedValue([makeProject(1), makeProject(2)]);
      const taskA = makeTask(10, 1);
      const taskB = makeTask(20, 2);
      mockClient.tasks.getProjectTasks.mockImplementation(async (id: number) => {
        if (id === 1) return [taskA];
        if (id === 2) return [taskB];
        return [];
      });

      const result = await strategy.execute(params);

      // getAllTasks must never be used for cross-project listing.
      expect(mockClient.tasks.getAllTasks).not.toHaveBeenCalled();
      expect(mockClient.projects.getProjects).toHaveBeenCalledWith({ per_page: 1000 });
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledTimes(2);
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(1, { page: 1, per_page: 50 });
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(2, { page: 1, per_page: 50 });
      expect(result.tasks).toEqual([taskA, taskB]);
    });

    it('aggregates when projectId is omitted entirely', async () => {
      const params: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
      };

      mockClient.projects.getProjects.mockResolvedValue([makeProject(3)]);
      const task = makeTask(30, 3);
      mockClient.tasks.getProjectTasks.mockResolvedValue([task]);

      const result = await strategy.execute(params);

      expect(mockClient.tasks.getAllTasks).not.toHaveBeenCalled();
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(3, { page: 1, per_page: 50 });
      expect(result.tasks).toEqual([task]);
    });

    it('skips pseudo-projects with a negative id (e.g. Favorites) to avoid duplicate tasks', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
      };

      // -1 (Favorites pseudo-project), 0 (invalid), and a valid real project.
      mockClient.projects.getProjects.mockResolvedValue([
        makeProject(-1),
        makeProject(0),
        makeProject(5),
      ]);
      const realTask = makeTask(50, 5);
      mockClient.tasks.getProjectTasks.mockResolvedValue([realTask]);

      const result = await strategy.execute(params);

      // Only the real project (id 5) should be fetched.
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledTimes(1);
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(5, { page: 1, per_page: 50 });
      expect(mockClient.tasks.getProjectTasks).not.toHaveBeenCalledWith(-1, expect.anything());
      expect(mockClient.tasks.getProjectTasks).not.toHaveBeenCalledWith(0, expect.anything());
      expect(result.tasks).toEqual([realTask]);
    });

    it('skips a project whose id is not a number', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
      };

      mockClient.projects.getProjects.mockResolvedValue([
        { id: undefined, title: 'No id' } as unknown as Project,
        makeProject(7),
      ]);
      const realTask = makeTask(70, 7);
      mockClient.tasks.getProjectTasks.mockResolvedValue([realTask]);

      const result = await strategy.execute(params);

      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledTimes(1);
      expect(mockClient.tasks.getProjectTasks).toHaveBeenCalledWith(7, { page: 1, per_page: 50 });
      expect(result.tasks).toEqual([realTask]);
    });

    it('logs and skips a project whose fetch throws without failing the whole listing', async () => {
      const params: FilteringParams = {
        args: { allProjects: true },
        filterExpression: null,
        filterString: undefined,
        params: { page: 1, per_page: 50 },
      };

      mockClient.projects.getProjects.mockResolvedValue([makeProject(1), makeProject(2)]);
      const goodTask = makeTask(10, 1);
      mockClient.tasks.getProjectTasks.mockImplementation(async (id: number) => {
        if (id === 1) return [goodTask];
        throw new Error('boom on project 2');
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
      };

      mockClient.projects.getProjects.mockResolvedValue([makeProject(9)]);
      mockClient.tasks.getProjectTasks.mockImplementation(async () => {
        throw 'plain string failure';
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
      const doneTask = { ...makeTask(1, 1), done: true } as Task;
      const openTask = { ...makeTask(2, 1), done: false } as Task;
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
      };

      mockClient.projects.getProjects.mockResolvedValue([makeProject(1)]);
      mockClient.tasks.getProjectTasks.mockResolvedValue([doneTask, openTask]);

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
      };

      mockClient.projects.getProjects.mockResolvedValue([]);

      const result = await strategy.execute(params);

      expect(mockClient.tasks.getProjectTasks).not.toHaveBeenCalled();
      expect(result.tasks).toEqual([]);
      expect(result.metadata.clientSideFiltering).toBe(false);
    });
  });
});
