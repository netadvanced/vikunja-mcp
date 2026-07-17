/**
 * Tests for RestCrossProjectFilteringStrategy
 *
 * Covers the direct-REST GET /tasks primary path for cross-project listing
 * (replacing the N+1 per-project aggregation as the default), including
 * query-string construction (payload assertions, not just return values —
 * see docs/ENDPOINT-PLAYBOOK.md §6) and the fallback to per-project
 * aggregation when the REST call fails.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  RestCrossProjectFilteringStrategy,
  buildTasksListQuery,
} from '../../../src/utils/filtering/RestCrossProjectFilteringStrategy';
import type { FilteringParams, FilteringResult } from '../../../src/utils/filtering/types';
import type { AuthManager } from '../../../src/auth/AuthManager';
import { MCPError, ErrorCode } from '../../../src/types';
import type { Task } from 'node-vikunja';

jest.mock('../../../src/utils/vikunja-rest', () => ({
  vikunjaRestRequest: jest.fn(),
}));

jest.mock('../../../src/utils/filtering/ClientSideFilteringStrategy', () => ({
  ClientSideFilteringStrategy: jest.fn().mockImplementation(() => ({
    execute: jest.fn(),
  })),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { vikunjaRestRequest } from '../../../src/utils/vikunja-rest';
import { ClientSideFilteringStrategy } from '../../../src/utils/filtering/ClientSideFilteringStrategy';

describe('RestCrossProjectFilteringStrategy', () => {
  let strategy: RestCrossProjectFilteringStrategy;
  let mockAuthManager: AuthManager;
  let mockClientStrategy: { execute: jest.Mock };

  const mockTask: Task = {
    id: 1,
    title: 'Test Task',
    description: '',
    done: false,
    priority: 3,
    percent_done: 0,
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    project_id: 5,
    assignees: [],
    labels: [],
  } as Task;

  const baseParams: FilteringParams = {
    args: {},
    filterExpression: null,
    filterString: undefined,
    params: { page: 1, per_page: 50 },
    authManager: {} as AuthManager,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new RestCrossProjectFilteringStrategy();
    mockAuthManager = {} as AuthManager;
    mockClientStrategy = { execute: jest.fn() };
    (ClientSideFilteringStrategy as jest.MockedClass<typeof ClientSideFilteringStrategy>).mockImplementation(
      () => mockClientStrategy as unknown as ClientSideFilteringStrategy,
    );
  });

  describe('buildTasksListQuery', () => {
    it('includes only the params that are set', () => {
      const query = buildTasksListQuery({}, undefined, {});
      expect(query).toBe('');
    });

    it('includes page/per_page/s/sort_by from the shared API params', () => {
      const query = buildTasksListQuery(
        { page: 2, per_page: 20, s: 'urgent', sort_by: 'priority' },
        undefined,
        {},
      );
      expect(query).toBe('page=2&per_page=20&s=urgent&sort_by=priority');
    });

    it('includes filter when filterString is present', () => {
      const query = buildTasksListQuery({ page: 1 }, 'priority >= 3', {});
      expect(query).toBe('page=1&filter=priority+%3E%3D+3');
    });

    it('includes order_by, filter_timezone, filter_include_nulls and expand from args', () => {
      const query = buildTasksListQuery(
        {},
        undefined,
        {
          orderBy: 'desc',
          filterTimezone: 'Europe/Zurich',
          filterIncludeNulls: true,
          expand: ['subtasks', 'comments'],
        },
      );
      expect(query).toBe(
        'order_by=desc&filter_timezone=Europe%2FZurich&filter_include_nulls=true&expand=subtasks&expand=comments',
      );
    });

    it('serializes filter_include_nulls=false explicitly (not omitted)', () => {
      const query = buildTasksListQuery({}, undefined, { filterIncludeNulls: false });
      expect(query).toBe('filter_include_nulls=false');
    });

    it('omits expand entirely when the array is empty', () => {
      const query = buildTasksListQuery({}, undefined, { expand: [] });
      expect(query).toBe('');
    });
  });

  describe('execute — direct REST success', () => {
    it('calls GET /tasks with no query string when nothing is set', async () => {
      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute({
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: {},
        authManager: mockAuthManager,
      });

      expect(vikunjaRestRequest).toHaveBeenCalledWith(mockAuthManager, 'GET', '/tasks');
      expect(result.tasks).toEqual([mockTask]);
      expect(result.metadata).toEqual({
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: true,
        clientSideFiltering: false,
        filteringNote:
          'Cross-project listing via direct REST GET /tasks (single call, no per-project aggregation)',
      });
      expect(mockClientStrategy.execute).not.toHaveBeenCalled();
    });

    it('calls GET /tasks with the filter query string and reports serverSideFilteringUsed', async () => {
      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      const result = await strategy.execute({
        args: {},
        filterExpression: null,
        filterString: 'priority >= 3',
        params: { page: 1, per_page: 50 },
        authManager: mockAuthManager,
      });

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/tasks?page=1&per_page=50&filter=priority+%3E%3D+3',
      );
      expect(result.metadata.serverSideFilteringUsed).toBe(true);
      expect(result.metadata.filteringNote).toBe(
        'Server-side filtering used via direct REST GET /tasks',
      );
    });

    it('treats a non-array REST response as an empty task list', async () => {
      (vikunjaRestRequest as jest.Mock).mockResolvedValue(null);

      const result = await strategy.execute(baseParams);

      expect(result.tasks).toEqual([]);
    });

    it('wires order_by/filter_include_nulls/expand from args into the request', async () => {
      (vikunjaRestRequest as jest.Mock).mockResolvedValue([mockTask]);

      await strategy.execute({
        args: { orderBy: 'desc', filterIncludeNulls: true, expand: ['subtasks'] },
        filterExpression: null,
        filterString: undefined,
        params: {},
        authManager: mockAuthManager,
      });

      expect(vikunjaRestRequest).toHaveBeenCalledWith(
        mockAuthManager,
        'GET',
        '/tasks?order_by=desc&filter_include_nulls=true&expand=subtasks',
      );
    });
  });

  describe('execute — fallback to per-project aggregation', () => {
    it('falls back to ClientSideFilteringStrategy when the REST call fails', async () => {
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(new Error('HTTP 400'));

      const fallbackResult: FilteringResult = {
        tasks: [mockTask],
        metadata: {
          serverSideFilteringUsed: false,
          serverSideFilteringAttempted: false,
          clientSideFiltering: true,
          filteringNote: 'No filter applied; tasks returned as loaded',
        },
      };
      mockClientStrategy.execute.mockResolvedValue(fallbackResult);

      const result = await strategy.execute(baseParams);

      expect(mockClientStrategy.execute).toHaveBeenCalledWith(baseParams);
      expect(result.tasks).toEqual([mockTask]);
      expect(result.metadata).toEqual({
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: true,
        clientSideFiltering: true,
        filteringNote: 'Direct REST GET /tasks failed; used per-project aggregation fallback',
      });
    });

    it('propagates a fallback failure when both the REST call and aggregation fail', async () => {
      (vikunjaRestRequest as jest.Mock).mockRejectedValue(new Error('HTTP 400'));
      const fallbackError = new Error('aggregation also failed');
      mockClientStrategy.execute.mockRejectedValue(fallbackError);

      await expect(strategy.execute(baseParams)).rejects.toThrow(fallbackError);
    });

    it('stringifies a non-Error thrown value when logging the REST failure', async () => {
      (vikunjaRestRequest as jest.Mock).mockRejectedValue('plain string failure');

      const fallbackResult: FilteringResult = {
        tasks: [],
        metadata: {
          serverSideFilteringUsed: false,
          serverSideFilteringAttempted: false,
          clientSideFiltering: false,
          filteringNote: 'No filter applied; tasks returned as loaded',
        },
      };
      mockClientStrategy.execute.mockResolvedValue(fallbackResult);

      await strategy.execute(baseParams);

      const { logger } = jest.requireMock('../../../src/utils/logger') as {
        logger: { warn: jest.Mock };
      };
      expect(logger.warn).toHaveBeenCalledWith(
        'Direct REST GET /tasks failed for cross-project listing, falling back to per-project aggregation',
        expect.objectContaining({ error: 'plain string failure' }),
      );
    });
  });

  describe('execute — missing authManager', () => {
    it('throws INTERNAL_ERROR when authManager is not provided', async () => {
      const paramsWithoutAuth: FilteringParams = {
        args: {},
        filterExpression: null,
        filterString: undefined,
        params: {},
      };

      await expect(strategy.execute(paramsWithoutAuth)).rejects.toThrow(
        new MCPError(
          ErrorCode.INTERNAL_ERROR,
          'RestCrossProjectFilteringStrategy requires an authManager',
        ),
      );
      expect(vikunjaRestRequest).not.toHaveBeenCalled();
    });
  });
});
