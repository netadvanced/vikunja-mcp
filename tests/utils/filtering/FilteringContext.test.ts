/**
 * Tests for FilteringContext
 * Ensures strategy selection logic is properly tested
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { FilteringContext } from '../../../src/utils/filtering/FilteringContext';
import type { FilteringParams, FilteringResult, StrategyConfig } from '../../../src/utils/filtering/types';
import type { Task } from 'node-vikunja';

// Mock the strategies
jest.mock('../../../src/utils/filtering/ClientSideFilteringStrategy', () => ({
  ClientSideFilteringStrategy: jest.fn().mockImplementation(() => ({
    execute: jest.fn()
  }))
}));

jest.mock('../../../src/utils/filtering/HybridFilteringStrategy', () => ({
  HybridFilteringStrategy: jest.fn().mockImplementation(() => ({
    execute: jest.fn()
  }))
}));

import { ClientSideFilteringStrategy } from '../../../src/utils/filtering/ClientSideFilteringStrategy';
import { HybridFilteringStrategy } from '../../../src/utils/filtering/HybridFilteringStrategy';

describe('FilteringContext', () => {
  let mockClientStrategy: jest.Mocked<ClientSideFilteringStrategy>;
  let mockHybridStrategy: jest.Mocked<HybridFilteringStrategy>;

  const mockTask: Task = {
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
  } as Task;

  const baseParams: FilteringParams = {
    args: {},
    filterExpression: null,
    filterString: 'priority >= 3',
    params: { page: 1, per_page: 10 }
  };

  const mockResult: FilteringResult = {
    tasks: [mockTask],
    metadata: {
      serverSideFilteringUsed: false,
      serverSideFilteringAttempted: false,
      clientSideFiltering: true,
      filteringNote: 'Test filtering applied'
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClientStrategy = {
      execute: jest.fn().mockResolvedValue(mockResult)
    } as any;

    mockHybridStrategy = {
      execute: jest.fn().mockResolvedValue(mockResult)
    } as any;

    (ClientSideFilteringStrategy as jest.MockedClass<typeof ClientSideFilteringStrategy>).mockImplementation(() => mockClientStrategy);
    (HybridFilteringStrategy as jest.MockedClass<typeof HybridFilteringStrategy>).mockImplementation(() => mockHybridStrategy);
  });

  describe('strategy selection', () => {
    it('should use HybridFilteringStrategy when server-side filtering is enabled', () => {
      const config: StrategyConfig = { enableServerSide: true };

      new FilteringContext(config);

      expect(HybridFilteringStrategy).toHaveBeenCalled();
      expect(ClientSideFilteringStrategy).not.toHaveBeenCalled();
    });

    it('should use ClientSideFilteringStrategy when server-side filtering is disabled', () => {
      const config: StrategyConfig = { enableServerSide: false };

      new FilteringContext(config);

      expect(ClientSideFilteringStrategy).toHaveBeenCalled();
      expect(HybridFilteringStrategy).not.toHaveBeenCalled();
    });

    it('should select the strategy independently of NODE_ENV (no env gate)', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        new FilteringContext({ enableServerSide: true });

        expect(HybridFilteringStrategy).toHaveBeenCalled();
        expect(ClientSideFilteringStrategy).not.toHaveBeenCalled();
      } finally {
        if (originalNodeEnv === undefined) {
          delete process.env.NODE_ENV;
        } else {
          process.env.NODE_ENV = originalNodeEnv;
        }
      }
    });

    it('should select the strategy independently of VIKUNJA_ENABLE_SERVER_SIDE_FILTERING', () => {
      const original = process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING;
      process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING = 'false';
      try {
        new FilteringContext({ enableServerSide: true });

        expect(HybridFilteringStrategy).toHaveBeenCalled();
        expect(ClientSideFilteringStrategy).not.toHaveBeenCalled();
      } finally {
        if (original === undefined) {
          delete process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING;
        } else {
          process.env.VIKUNJA_ENABLE_SERVER_SIDE_FILTERING = original;
        }
      }
    });

    it('should use ClientSideFilteringStrategy when enableServerSide is undefined', () => {
      const config = {} as StrategyConfig;

      new FilteringContext(config);

      expect(ClientSideFilteringStrategy).toHaveBeenCalled();
      expect(HybridFilteringStrategy).not.toHaveBeenCalled();
    });

    it('should use ClientSideFilteringStrategy when enableServerSide is null', () => {
      const config = { enableServerSide: null } as unknown as StrategyConfig;

      new FilteringContext(config);

      expect(ClientSideFilteringStrategy).toHaveBeenCalled();
      expect(HybridFilteringStrategy).not.toHaveBeenCalled();
    });
  });

  describe('execute', () => {
    it('should delegate execution to the client-side strategy when disabled', async () => {
      const context = new FilteringContext({ enableServerSide: false });
      const result = await context.execute(baseParams);

      expect(mockClientStrategy.execute).toHaveBeenCalledWith(baseParams);
      expect(result).toEqual(mockResult);
    });

    it('should delegate execution to the hybrid strategy when enabled', async () => {
      const context = new FilteringContext({ enableServerSide: true });
      const result = await context.execute(baseParams);

      expect(mockHybridStrategy.execute).toHaveBeenCalledWith(baseParams);
      expect(result).toEqual(mockResult);
    });

    it('should propagate strategy execution errors', async () => {
      const executionError = new Error('Strategy execution failed');
      mockClientStrategy.execute.mockRejectedValue(executionError);

      const context = new FilteringContext({ enableServerSide: false });

      await expect(context.execute(baseParams)).rejects.toThrow(executionError);
    });

    it('should pass through all parameters unchanged', async () => {
      const complexParams: FilteringParams = {
        args: {
          projectId: 42,
          page: 3,
          perPage: 25,
          search: 'test',
          sort: 'priority',
          allProjects: true
        },
        filterExpression: {
          groups: [
            {
              conditions: [{ field: 'priority', operator: '>=', value: 3 }],
              operator: '&&'
            }
          ]
        },
        filterString: 'priority >= 3 && done = false',
        params: {
          page: 3,
          per_page: 25,
          sort_by: 'priority',
          s: 'test'
        }
      };

      const context = new FilteringContext({ enableServerSide: false });
      await context.execute(complexParams);

      expect(mockClientStrategy.execute).toHaveBeenCalledWith(complexParams);
    });
  });

  describe('strategy instantiation', () => {
    it('should create a strategy instance once per context', () => {
      new FilteringContext({ enableServerSide: false });
      new FilteringContext({ enableServerSide: false });

      expect(ClientSideFilteringStrategy).toHaveBeenCalledTimes(2);
    });

    it('should create different strategy types based on config', () => {
      new FilteringContext({ enableServerSide: false });
      new FilteringContext({ enableServerSide: true });

      expect(ClientSideFilteringStrategy).toHaveBeenCalledTimes(1);
      expect(HybridFilteringStrategy).toHaveBeenCalledTimes(1);
    });
  });
});
