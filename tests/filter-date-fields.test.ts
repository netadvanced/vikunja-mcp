/**
 * Tests for the startDate / endDate / doneAt / project filter fields.
 *
 * Vikunja's task model already exposes start_date, end_date, done_at, and
 * project_id, but the MCP wrapper did not surface them as filter fields.
 * These tests pin: the field catalog, parser ordering (longest-token first
 * so 'done' does not shadow 'doneAt'), the validator, the evaluator's
 * '0001-01-01T00:00:00Z' unset-sentinel handling, and the bulk validator.
 */

import { describe, it, expect } from '@jest/globals';
import type { Task } from '../src/types/vikunja';
import {
  parseFilterString,
  validateCondition,
  validateFilterExpression,
} from '../src/utils/filters';
import { evaluateCondition } from '../src/tools/tasks/filtering/evaluators';
import { applyFieldUpdate } from '../src/tools/tasks/validation';
import { bulkOperationValidator } from '../src/tools/tasks/bulk/BulkOperationValidator';
import { MCPError } from '../src/types';
import { FIELD_TYPES, type FilterCondition, type FilterField } from '../src/types/filters';

describe('startDate / endDate / doneAt / project filter fields', () => {
  describe('FIELD_TYPES catalog', () => {
    it.each([
      ['startDate', 'date'],
      ['endDate', 'date'],
      ['doneAt', 'date'],
      ['project', 'number'],
    ] as Array<[FilterField, string]>)('maps %s to %s', (field, expected) => {
      expect(FIELD_TYPES[field]).toBe(expected);
    });
  });

  describe('parseFilterString', () => {
    it.each(['startDate', 'endDate', 'doneAt'])('accepts %s with a relative date', (field) => {
      const result = parseFilterString(`${field} < now`);
      expect(result.error).toBeUndefined();
      expect(result.expression?.groups[0]?.conditions[0]?.field).toBe(field);
    });

    it('does not let "done" shadow "doneAt" (longest-first ordering)', () => {
      const result = parseFilterString('doneAt < now');
      expect(result.error).toBeUndefined();
      expect(result.expression?.groups[0]?.conditions[0]?.field).toBe('doneAt');
    });

    it('does not let "dueDate" or other prefixes shadow "startDate"', () => {
      const result = parseFilterString('startDate >= 2026-01-01');
      expect(result.error).toBeUndefined();
      expect(result.expression?.groups[0]?.conditions[0]?.field).toBe('startDate');
    });

    it('accepts project filter with a numeric value', () => {
      const result = parseFilterString('project = 3');
      expect(result.error).toBeUndefined();
      const cond = result.expression?.groups[0]?.conditions[0];
      expect(cond?.field).toBe('project');
      expect(cond?.value).toBe(3);
    });
  });

  describe('validateCondition / validateFilterExpression', () => {
    it.each(['startDate', 'endDate', 'doneAt'] as FilterField[])(
      'accepts %s with a valid ISO date',
      (field) => {
        const condition: FilterCondition = { field, operator: '>=', value: '2026-01-01' };
        expect(validateCondition(condition)).toHaveLength(0);
      },
    );

    it('rejects startDate with a malformed date', () => {
      const condition: FilterCondition = {
        field: 'startDate',
        operator: '=',
        value: 'not-a-date',
      };
      expect(validateCondition(condition).join(' ')).toContain('valid date');
    });

    it('rejects project with a non-numeric value', () => {
      const condition: FilterCondition = { field: 'project', operator: '=', value: 'abc' };
      expect(validateCondition(condition).join(' ')).toContain('numeric value');
    });

    it('accepts a compound expression mixing the new fields', () => {
      const result = validateFilterExpression({
        groups: [
          {
            operator: '&&',
            conditions: [
              { field: 'startDate', operator: '<=', value: 'now' },
              { field: 'endDate', operator: '>=', value: 'now' },
              { field: 'project', operator: '=', value: 3 },
            ],
          },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('evaluateCondition', () => {
    const baseTask: Task = {
      id: 1,
      title: 't',
      done: false,
      project_id: 3,
      start_date: '2026-05-20T00:00:00Z',
      end_date: '2026-05-30T00:00:00Z',
      done_at: '0001-01-01T00:00:00Z', // Vikunja's sentinel for "unset"
    } as unknown as Task;

    it('matches startDate before today via < now', () => {
      expect(
        evaluateCondition(baseTask, { field: 'startDate', operator: '<', value: 'now' }),
      ).toBe(true);
    });

    it('treats start_date = "0001-01-..." as unset', () => {
      const unsetTask = { ...baseTask, start_date: '0001-01-01T00:00:00Z' } as Task;
      expect(
        evaluateCondition(unsetTask, { field: 'startDate', operator: '=', value: 'now' }),
      ).toBe(false);
      expect(
        evaluateCondition(unsetTask, { field: 'startDate', operator: '!=', value: 'now' }),
      ).toBe(true);
    });

    it('treats missing done_at as unset (the != escape hatch)', () => {
      expect(
        evaluateCondition(baseTask, { field: 'doneAt', operator: '!=', value: 'now' }),
      ).toBe(true);
      expect(
        evaluateCondition(baseTask, { field: 'doneAt', operator: '=', value: 'now' }),
      ).toBe(false);
    });

    it('compares project against task.project_id', () => {
      expect(evaluateCondition(baseTask, { field: 'project', operator: '=', value: 3 })).toBe(
        true,
      );
      expect(evaluateCondition(baseTask, { field: 'project', operator: '=', value: 99 })).toBe(
        false,
      );
    });
  });

  describe('applyFieldUpdate (bulk-update + per-task update glue)', () => {
    it('writes start_date when field is snake_case', () => {
      const task = {} as Task;
      applyFieldUpdate(task, 'start_date', '2026-06-01T00:00:00Z');
      expect(task.start_date).toBe('2026-06-01T00:00:00Z');
    });

    it('writes start_date when field is camelCase', () => {
      const task = {} as Task;
      applyFieldUpdate(task, 'startDate', '2026-06-02T00:00:00Z');
      expect(task.start_date).toBe('2026-06-02T00:00:00Z');
    });

    it('writes end_date for both snake_case and camelCase', () => {
      const a = {} as Task;
      const b = {} as Task;
      applyFieldUpdate(a, 'end_date', '2026-06-10T00:00:00Z');
      applyFieldUpdate(b, 'endDate', '2026-06-11T00:00:00Z');
      expect(a.end_date).toBe('2026-06-10T00:00:00Z');
      expect(b.end_date).toBe('2026-06-11T00:00:00Z');
    });
  });

  describe('bulkOperationValidator', () => {
    it('accepts start_date and end_date in allowedFields with a valid date', () => {
      expect(() =>
        bulkOperationValidator.validateFieldConstraints({
          taskIds: [1],
          field: 'start_date',
          value: '2026-06-01T00:00:00Z',
        }),
      ).not.toThrow();

      expect(() =>
        bulkOperationValidator.validateFieldConstraints({
          taskIds: [1],
          field: 'end_date',
          value: '2026-06-30T00:00:00Z',
        }),
      ).not.toThrow();
    });

    it('rejects an invalid date string for start_date', () => {
      expect(() =>
        bulkOperationValidator.validateFieldConstraints({
          taskIds: [1],
          field: 'start_date',
          value: 'tomorrow-ish',
        }),
      ).toThrow(MCPError);
    });

    it('rejects an unknown field name', () => {
      expect(() =>
        bulkOperationValidator.validateFieldConstraints({
          taskIds: [1],
          field: 'banana',
          value: 'x',
        }),
      ).toThrow(/Invalid field/);
    });
  });
});
