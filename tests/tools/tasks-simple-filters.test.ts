/**
 * Tests for the current filter parsing + client-side application pipeline.
 *
 * This suite previously exercised `parseSimpleFilter`/`applyClientSideFilter`
 * from src/utils/filters.ts, a single-condition ("SimpleFilter") API that
 * predates the Zod-based grammar and no longer exists. The equivalent
 * functionality today is `parseFilterString` (src/utils/filters.ts), which
 * parses a filter string into a `FilterExpression` tree, combined with
 * `applyFilter` (src/tools/tasks/filtering/evaluators.ts, re-exported from
 * src/tools/tasks/filtering), which evaluates that expression against a list
 * of tasks. The old bracketed-array syntax (`labels in [1, 2]`) and its
 * JSON.parse-based sanitization no longer apply either: the current grammar
 * uses a comma-separated value list for `in`/`not in` (`labels in 1, 2`).
 */

import { describe, it, expect } from '@jest/globals';
import type { Task } from 'node-vikunja';
import { parseFilterString } from '../../src/utils/filters';
import { applyFilter } from '../../src/tools/tasks/filtering';
import type { FilterExpression } from '../../src/types/filters';

// Mock data
const mockTasks: Partial<Task>[] = [
  {
    id: 1,
    title: 'Completed Task',
    description: 'A task that is done',
    done: true,
    priority: 3,
    due_date: '2024-01-15T10:00:00Z',
    project_id: 1,
    created: '2024-01-01T10:00:00Z',
    updated: '2024-01-15T10:00:00Z',
    labels: [{ id: 1 }, { id: 2 }] as Task['labels'],
    assignees: [{ id: 1 }] as Task['assignees'],
  },
  {
    id: 2,
    title: 'High Priority Task',
    description: 'An important task',
    done: false,
    priority: 5,
    due_date: '2024-02-01T10:00:00Z',
    project_id: 1,
    created: '2024-01-10T10:00:00Z',
    updated: '2024-01-10T10:00:00Z',
    labels: [{ id: 2 }] as Task['labels'],
    assignees: [{ id: 2 }] as Task['assignees'],
  },
  {
    id: 3,
    title: 'Low Priority Incomplete Task',
    description: 'Not important and not done',
    done: false,
    priority: 1,
    due_date: null as unknown as string,
    project_id: 2,
    created: '2024-01-20T10:00:00Z',
    updated: '2024-01-20T10:00:00Z',
    labels: [] as Task['labels'],
    assignees: [] as Task['assignees'],
  },
];

/**
 * Parses a filter string and applies it to the given tasks, asserting that
 * parsing succeeded so callers get a clear failure if the filter syntax
 * itself is invalid rather than an obscure downstream assertion failure.
 */
function filterTasks(tasks: Partial<Task>[], filterStr: string): Task[] {
  const { expression, error } = parseFilterString(filterStr);
  expect(error).toBeUndefined();
  expect(expression).not.toBeNull();
  return applyFilter(tasks as Task[], expression as FilterExpression);
}

describe('Filter Parsing and Application', () => {
  describe('parseFilterString', () => {
    it('should parse a simple equality filter', () => {
      const { expression } = parseFilterString('done = true');
      expect(expression?.groups[0]?.conditions[0]).toEqual({
        field: 'done',
        operator: '=',
        value: true,
      });
    });

    it('should parse a comparison filter with priority', () => {
      const { expression } = parseFilterString('priority > 3');
      expect(expression?.groups[0]?.conditions[0]).toEqual({
        field: 'priority',
        operator: '>',
        value: 3,
      });
    });

    it('should parse a quoted string filter', () => {
      const { expression } = parseFilterString('title = "High Priority Task"');
      expect(expression?.groups[0]?.conditions[0]).toEqual({
        field: 'title',
        operator: '=',
        value: 'High Priority Task',
      });
    });

    it('should parse the like operator for substring matching', () => {
      const { expression } = parseFilterString('title like "Task"');
      expect(expression?.groups[0]?.conditions[0]).toEqual({
        field: 'title',
        operator: 'like',
        value: 'Task',
      });
    });

    it('should parse comma-separated values for the in operator', () => {
      const { expression } = parseFilterString('labels in 1, 2');
      expect(expression?.groups[0]?.conditions[0]).toEqual({
        field: 'labels',
        operator: 'in',
        value: ['1', '2'],
      });
    });

    it('should return a null expression and an error for invalid syntax', () => {
      const { expression, error } = parseFilterString('invalid filter syntax');
      expect(expression).toBeNull();
      expect(error).toBeDefined();
    });

    it('should return a null expression and an error for an empty filter', () => {
      const { expression, error } = parseFilterString('');
      expect(expression).toBeNull();
      expect(error?.message).toBe('Filter string cannot be empty');
    });

    it('should reject a legacy snake_case field name (due_date is not a valid field)', () => {
      const { expression, error } = parseFilterString('due_date < 2024-01-31');
      expect(expression).toBeNull();
      expect(error).toBeDefined();
    });
  });

  describe('applyFilter', () => {
    it('should filter tasks by done status', () => {
      const result = filterTasks(mockTasks, 'done = true');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should filter tasks by priority comparison', () => {
      const result = filterTasks(mockTasks, 'priority > 3');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(2);
    });

    it('should filter tasks by title substring', () => {
      const result = filterTasks(mockTasks, 'title like "High Priority"');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(2);
    });

    it('should filter tasks by label id membership', () => {
      const result = filterTasks(mockTasks, 'labels in 1');
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should return all tasks for an always-true condition', () => {
      const result = filterTasks(mockTasks, 'priority >= 0');
      expect(result).toHaveLength(3);
    });

    it('should handle due date comparisons', () => {
      const result = filterTasks(mockTasks, 'dueDate < 2024-01-31');
      // Task 1: 2024-01-15 (before) - included
      // Task 2: 2024-02-01 (after) - excluded
      // Task 3: no due date (unset dates only match !=) - excluded
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(1);
    });

    it('should treat tasks with no due date as only matching the != operator', () => {
      const result = filterTasks(mockTasks, 'dueDate != 2024-01-15');
      expect(result.map((t) => t.id).sort()).toEqual([2, 3]);
    });
  });

  describe('Integration scenarios', () => {
    it('should find incomplete tasks', () => {
      const result = filterTasks(mockTasks, 'done = false');
      expect(result.map((t) => t.id).sort()).toEqual([2, 3]);
    });

    it('should support progressive filtering by re-applying filterTasks', () => {
      // Step 1: high priority tasks
      const highPriority = filterTasks(mockTasks, 'priority > 2');
      expect(highPriority).toHaveLength(2);

      // Step 2: from those, find incomplete ones
      const finalResult = filterTasks(highPriority, 'done = false');
      expect(finalResult).toHaveLength(1);
      expect(finalResult[0]?.id).toBe(2);
    });

    it('should support combined AND/OR conditions in a single expression', () => {
      const result = filterTasks(mockTasks, '(priority > 2 && done = false) || labels in 1');
      // (priority > 2 && !done): task 2. labels in 1: task 1.
      expect(result.map((t) => t.id).sort()).toEqual([1, 2]);
    });
  });
});
