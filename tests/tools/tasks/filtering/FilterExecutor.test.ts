/**
 * Tests for FilterExecutor's strategy-selection wiring.
 *
 * Focuses on the `crossProject` flag threaded into `FilteringContext`
 * (payload assertion — see docs/ENDPOINT-PLAYBOOK.md §6) and the
 * `authManager` pass-through required by `RestCrossProjectFilteringStrategy`.
 * Filtering-result mechanics themselves are covered by
 * tests/tools/tasks-filtering-orchestrator.test.ts and the per-strategy
 * test suites under tests/utils/filtering/.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import type { AuthManager } from '../../../../src/auth/AuthManager';

jest.mock('../../../../src/utils/filtering', () => ({
  FilteringContext: jest.fn().mockImplementation(() => ({
    execute: jest.fn().mockResolvedValue({
      tasks: [],
      metadata: {
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: false,
        clientSideFiltering: false,
        filteringNote: 'stub',
      },
    }),
  })),
}));

jest.mock('../../../../src/utils/memory', () => ({
  validateTaskCountLimit: jest.fn().mockReturnValue({ allowed: true, maxAllowed: 1000, estimatedMemoryMB: 1 }),
  createTaskLimitExceededMessage: jest.fn().mockReturnValue('exceeded'),
  logMemoryUsage: jest.fn(),
}));

jest.mock('../../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { FilterExecutor } from '../../../../src/tools/tasks/filtering/FilterExecutor';
import { FilteringContext } from '../../../../src/utils/filtering';
import type { TaskListingArgs } from '../../../../src/tools/tasks/types/filters';

describe('FilterExecutor.executeFiltering — strategy selection wiring', () => {
  const storage = {} as never;
  const mockAuthManager = {} as AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each<[string, TaskListingArgs, boolean]>([
    ['no projectId', {}, true],
    ['allProjects: true (with projectId)', { projectId: 5, allProjects: true }, true],
    ['a specific projectId, allProjects unset', { projectId: 5 }, false],
    ['a specific projectId, allProjects: false', { projectId: 5, allProjects: false }, false],
  ])('computes crossProject=%s for %s', async (_label, args, expectedCrossProject) => {
    await FilterExecutor.executeFiltering(args, null, undefined, {}, storage, mockAuthManager);

    expect(FilteringContext).toHaveBeenCalledWith(
      expect.objectContaining({ crossProject: expectedCrossProject }),
    );
  });

  it('passes authManager through to the filtering params when provided', async () => {
    const mockContextInstance = { execute: jest.fn().mockResolvedValue({
      tasks: [],
      metadata: {
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: false,
        clientSideFiltering: false,
        filteringNote: 'stub',
      },
    }) };
    (FilteringContext as jest.Mock).mockImplementation(() => mockContextInstance);

    await FilterExecutor.executeFiltering({}, null, undefined, {}, storage, mockAuthManager);

    expect(mockContextInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({ authManager: mockAuthManager }),
    );
  });

  it('omits authManager from the filtering params when not provided', async () => {
    const mockContextInstance = { execute: jest.fn().mockResolvedValue({
      tasks: [],
      metadata: {
        serverSideFilteringUsed: false,
        serverSideFilteringAttempted: false,
        clientSideFiltering: false,
        filteringNote: 'stub',
      },
    }) };
    (FilteringContext as jest.Mock).mockImplementation(() => mockContextInstance);

    await FilterExecutor.executeFiltering({}, null, undefined, {}, storage);

    const calledWith = mockContextInstance.execute.mock.calls[0][0] as Record<string, unknown>;
    expect('authManager' in calledWith).toBe(false);
  });
});
