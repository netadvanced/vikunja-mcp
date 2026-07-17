/**
 * Tests for FilterValidator.validateAndParseFilter — folding the `done` flag
 * into the server-side filter.
 *
 * BUG 1: `done` was never sent to Vikunja; it was applied client-side after
 * pagination, so open tasks were scattered unpredictably across raw pages.
 * It is now folded into the filter expression / string so Vikunja applies it
 * server-side, before pagination.
 */

import { describe, it, expect, jest } from '@jest/globals';

jest.mock('../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { FilterValidator } from '../../src/tools/tasks/filtering/FilterValidator';
import type { TaskListingArgs, TaskFilterStorage } from '../../src/tools/tasks/types/filters';

const storage = { get: jest.fn() } as unknown as TaskFilterStorage;

describe('FilterValidator.validateAndParseFilter — done folding', () => {
  it('folds done=false into the filter when no user filter is given', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      { done: false } as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBe('done = false');
    expect(result.filterExpression).not.toBeNull();
    expect(result.filterExpression?.groups[0]?.conditions[0]).toEqual({
      field: 'done',
      operator: '=',
      value: false,
    });
  });

  it('folds done=true into the filter', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      { done: true } as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBe('done = true');
  });

  it('produces no filter when neither done nor filter is given', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      {} as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBeUndefined();
    expect(result.filterExpression).toBeNull();
  });

  it('leaves a user filter untouched when done is not given', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      { filter: 'priority >= 4' } as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBe('priority >= 4');
  });

  it('ANDs done onto a single-group user filter', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      { filter: 'priority >= 4', done: false } as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBe('priority >= 4 && done = false');
  });

  it('parenthesises an OR user filter before ANDing done', async () => {
    const result = await FilterValidator.validateAndParseFilter(
      { filter: 'priority >= 4 || priority = 3', done: false } as TaskListingArgs,
      storage,
    );

    expect(result.filterString).toBe('(priority >= 4 || priority = 3) && done = false');
  });
});
