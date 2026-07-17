/**
 * Tests for the Zod-based filter utilities in src/utils/filters.ts
 *
 * This suite was rewritten against the current architecture. The previous
 * version tested `parseSimpleFilter`/`applyClientSideFilter` and a
 * `SimpleFilter` type, all of which predate the Zod-based grammar and no
 * longer exist. The equivalent "apply a filter to a list of tasks"
 * capability now lives in `applyFilter` under
 * `src/tools/tasks/filtering/evaluators.ts` (see
 * tests/tools/tasks-simple-filters.test.ts) and is exercised together with
 * `parseFilterString` from this module.
 */

import { describe, it, expect } from '@jest/globals';
import {
  validateCondition,
  validateFilterExpression,
  conditionToString,
  groupToString,
  expressionToString,
  parseFilterString,
  FilterBuilder,
  SecurityValidator,
} from '../../src/utils/filters';
import type { FilterCondition, FilterExpression, FilterGroup } from '../../src/types/index';

describe('Consolidated Filter Utilities', () => {
  describe('validateCondition', () => {
    it('should validate simple valid conditions', () => {
      const condition: FilterCondition = {
        field: 'done',
        operator: '=',
        value: true,
      };

      const errors = validateCondition(condition);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid field names with a Zod-derived error', () => {
      const condition = {
        field: 'invalidField',
        operator: '=',
        value: true,
      };

      const errors = validateCondition(condition as unknown as FilterCondition);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Invalid field name');
    });

    it('should reject invalid operators with a Zod-derived error', () => {
      const condition = {
        field: 'done',
        operator: 'invalid',
        value: true,
      };

      const errors = validateCondition(condition as unknown as FilterCondition);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Invalid field name');
    });

    it('should accept string "true"/"false" for boolean fields', () => {
      const condition: FilterCondition = {
        field: 'done',
        operator: '=',
        value: 'true',
      };

      const errors = validateCondition(condition);
      expect(errors).toHaveLength(0);
    });

    it('should reject non-boolean, non "true"/"false" values for the done field', () => {
      const condition: FilterCondition = {
        field: 'done',
        operator: '=',
        value: 'yes',
      };

      const errors = validateCondition(condition);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Field "done" requires a boolean value');
    });

    it('should reject non-numeric values for priority field', () => {
      const condition: FilterCondition = {
        field: 'priority',
        operator: '=',
        value: 'high', // string instead of number
      };

      const errors = validateCondition(condition);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('Field "priority" requires a numeric value');
    });
  });

  describe('validateFilterExpression', () => {
    it('should validate simple expressions', () => {
      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions: [
              {
                field: 'done',
                operator: '=',
                value: true,
              },
            ],
          },
        ],
      };

      const result = validateFilterExpression(expression);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should surface condition validation errors with group/condition context', () => {
      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions: [
              {
                field: 'priority',
                operator: '=',
                value: 'not-a-number' as unknown as number,
              },
            ],
          },
        ],
      };

      const result = validateFilterExpression(expression);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Group 1, Condition 1');
      expect(result.errors[0]).toContain('Field "priority" requires a numeric value');
    });

    it('should warn when the number of conditions exceeds the default performance threshold', () => {
      const conditions = Array(11)
        .fill(null)
        .map((_, i) => ({
          field: 'priority' as const,
          operator: '=' as const,
          value: i,
        }));

      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions,
          },
        ],
      };

      const result = validateFilterExpression(expression);
      expect(result.valid).toBe(true);
      expect(result.warnings?.[0]).toContain('Complex filters');
    });

    it('should respect a custom performanceWarningThreshold', () => {
      const conditions = Array(6)
        .fill(null)
        .map((_, i) => ({
          field: 'priority' as const,
          operator: '=' as const,
          value: i,
        }));

      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions,
          },
        ],
      };

      const resultNoWarning = validateFilterExpression(expression, {
        performanceWarningThreshold: 10,
      });
      expect(resultNoWarning.warnings).toBeUndefined();

      const resultWithWarning = validateFilterExpression(expression, {
        performanceWarningThreshold: 5,
      });
      expect(resultWithWarning.warnings?.[0]).toContain('Complex filters');
    });
  });

  describe('conditionToString', () => {
    it('should convert a simple condition to string', () => {
      const condition: FilterCondition = {
        field: 'done',
        operator: '=',
        value: true,
      };

      const result = conditionToString(condition);
      expect(result).toBe('done = true');
    });

    it('should quote string values only for the like operator', () => {
      const likeCondition: FilterCondition = {
        field: 'title',
        operator: 'like',
        value: 'test task',
      };
      expect(conditionToString(likeCondition)).toBe('title like "test task"');

      const eqCondition: FilterCondition = {
        field: 'title',
        operator: '=',
        value: 'test task',
      };
      expect(conditionToString(eqCondition)).toBe('title = test task');
    });

    it('should join array values with commas', () => {
      const condition: FilterCondition = {
        field: 'labels',
        operator: 'in',
        value: ['1', '2'],
      };
      expect(conditionToString(condition)).toBe('labels in 1, 2');
    });

    describe('camelCase to snake_case field-name translation for the server-side filter string', () => {
      // The DSL's camelCase field names must be translated to the API's
      // snake_case Task JSON field names before being sent as the server-side
      // `filter` query param - see FILTER_FIELD_TO_API_FIELD in
      // src/utils/filters.ts and the matching evaluateCondition switch in
      // src/tools/tasks/filtering/evaluators.ts used for client-side evaluation.
      it.each<[FilterCondition['field'], string, FilterCondition['value'], string]>([
        ['percentDone', '>=', 75, 'percent_done >= 75'],
        ['dueDate', '<', 'now', 'due_date < now'],
        ['startDate', '>=', '2024-01-01', 'start_date >= 2024-01-01'],
        ['endDate', '<=', '2024-12-31', 'end_date <= 2024-12-31'],
        ['doneAt', '!=', 'now', 'done_at != now'],
        // 'project' is not just camelCased differently - it renames to the
        // API's project_id field entirely.
        ['project', '=', 4, 'project_id = 4'],
      ])('translates %s to its API field name', (field, operator, value, expected) => {
        const condition: FilterCondition = {
          field,
          operator: operator as FilterCondition['operator'],
          value,
        };
        expect(conditionToString(condition)).toBe(expected);
      });

      it.each<FilterCondition['field']>([
        'done',
        'priority',
        'assignees',
        'labels',
        'created',
        'updated',
        'title',
        'description',
      ])('leaves %s unchanged (already matches the API field name)', (field) => {
        const value = field === 'done' ? true : field === 'assignees' || field === 'labels' ? [1] : 'x';
        const condition: FilterCondition = { field, operator: '=', value };
        expect(conditionToString(condition)).toBe(
          `${field} = ${Array.isArray(value) ? value.join(', ') : String(value)}`,
        );
      });

      it('translates every multi-word field name inside a built expression', () => {
        const expression: FilterExpression = {
          groups: [
            {
              operator: '&&',
              conditions: [
                { field: 'dueDate', operator: '<', value: 'now' },
                { field: 'startDate', operator: '>=', value: '2024-01-01' },
                { field: 'endDate', operator: '<=', value: '2024-12-31' },
                { field: 'doneAt', operator: '!=', value: 'now' },
                { field: 'percentDone', operator: '>=', value: 50 },
                { field: 'project', operator: '=', value: 4 },
              ],
            },
          ],
        };

        const result = expressionToString(expression);
        expect(result).toBe(
          '(due_date < now && start_date >= 2024-01-01 && end_date <= 2024-12-31 && done_at != now && percent_done >= 50 && project_id = 4)',
        );
      });

      it('translates the field name for "in"/"not in" operators too', () => {
        expect(conditionToString({ field: 'project', operator: 'in', value: [1, 2, 3] })).toBe(
          'project_id in 1, 2, 3',
        );
      });
    });
  });

  describe('groupToString', () => {
    it('should render a single-condition group without parentheses', () => {
      const group: FilterGroup = {
        operator: '&&',
        conditions: [
          {
            field: 'done',
            operator: '=',
            value: true,
          },
        ],
      };

      const result = groupToString(group);
      expect(result).toBe('done = true');
    });

    it('should wrap a multi-condition group in parentheses joined by its operator', () => {
      const group: FilterGroup = {
        operator: '||',
        conditions: [
          {
            field: 'done',
            operator: '=',
            value: true,
          },
          {
            field: 'priority',
            operator: '>',
            value: 3,
          },
        ],
      };

      const result = groupToString(group);
      expect(result).toBe('(done = true || priority > 3)');
    });
  });

  describe('expressionToString', () => {
    it('should join groups using the expression operator, defaulting to &&', () => {
      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions: [
              {
                field: 'done',
                operator: '=',
                value: true,
              },
            ],
          },
          {
            operator: '||',
            conditions: [
              {
                field: 'priority',
                operator: '>',
                value: 3,
              },
              {
                field: 'priority',
                operator: '<',
                value: 1,
              },
            ],
          },
        ],
        operator: '||',
      };

      const result = expressionToString(expression);
      expect(result).toBe('done = true || (priority > 3 || priority < 1)');
    });

    it('should default to && when no expression operator is set', () => {
      const expression: FilterExpression = {
        groups: [
          {
            operator: '&&',
            conditions: [{ field: 'done', operator: '=', value: true }],
          },
          {
            operator: '&&',
            conditions: [{ field: 'priority', operator: '>', value: 3 }],
          },
        ],
      };

      expect(expressionToString(expression)).toBe('done = true && priority > 3');
    });
  });

  describe('parseFilterString', () => {
    it('should reject non-string input', () => {
      const result = parseFilterString(123 as unknown as string);
      expect(result.expression).toBeNull();
      expect(result.error?.message).toBe('Filter input must be a string');
    });

    it('should reject overly long input', () => {
      const longString = 'a'.repeat(1001);
      const result = parseFilterString(longString);
      expect(result.expression).toBeNull();
      expect(result.error?.message).toContain('too long');
    });

    it('should reject empty input', () => {
      const result = parseFilterString('');
      expect(result.expression).toBeNull();
      expect(result.error?.message).toBe('Filter string cannot be empty');
    });

    it('should reject syntactically invalid input', () => {
      const result = parseFilterString('title = test; DROP TABLE users;');
      expect(result.expression).toBeNull();
      expect(result.error).toBeDefined();
    });

    it('should parse valid simple input with no error', () => {
      const result = parseFilterString('done = true');
      expect(result.expression).toEqual({
        groups: [
          {
            conditions: [{ field: 'done', operator: '=', value: true }],
            operator: '&&',
          },
        ],
      });
      expect(result.error).toBeUndefined();
    });

    it('should parse comma-separated values for the in operator', () => {
      const result = parseFilterString('labels in 1, 2');
      expect(result.error).toBeUndefined();
      expect(result.expression?.groups[0]?.conditions[0]).toEqual({
        field: 'labels',
        operator: 'in',
        value: ['1', '2'],
      });
    });
  });

  describe('SecurityValidator', () => {
    it('should validate allowed characters', () => {
      expect(SecurityValidator.validateAllowedChars('done = true')).toBe(true);
      expect(SecurityValidator.validateAllowedChars('title > "test"')).toBe(true);
    });

    it('should reject strings containing disallowed control characters', () => {
      // \x00 (NUL) falls outside the allowed printable/whitespace range.
      expect(SecurityValidator.validateAllowedChars('done = true\x00')).toBe(false);
    });

    it('should validate filter string length', () => {
      expect(SecurityValidator.validateLength('done = true').isValid).toBe(true);

      const tooLong = SecurityValidator.validateLength('a'.repeat(1001));
      expect(tooLong.isValid).toBe(false);
      expect(tooLong.error).toContain('Maximum length is 1000');
    });

    it('should validate individual value length', () => {
      expect(SecurityValidator.validateValue('short value').isValid).toBe(true);

      const tooLong = SecurityValidator.validateValue('a'.repeat(201));
      expect(tooLong.isValid).toBe(false);
      expect(tooLong.error).toContain('Maximum length is 200');
    });
  });

  describe('FilterBuilder', () => {
    it('should build simple conditions joined by &&', () => {
      const builder = new FilterBuilder();
      const result = builder.where('done', '=', true).where('priority', '>', 3).toString();

      expect(result).toBe('(done = true && priority > 3)');
    });

    it('should apply or() to the current group', () => {
      const builder = new FilterBuilder();
      const result = builder
        .where('done', '=', true)
        .where('priority', '=', 3)
        .or()
        .where('done', '=', false)
        .toString();

      expect(result).toBe('(done = true || priority = 3 || done = false)');
    });

    it('should support multiple groups combined with groupOperator', () => {
      const builder = new FilterBuilder();
      const result = builder
        .where('done', '=', true)
        .group('||')
        .where('priority', '>', 3)
        .where('priority', '<', 1)
        .groupOperator('||')
        .toString();

      expect(result).toBe('done = true || (priority > 3 || priority < 1)');
    });

    it('should build a FilterExpression via build()', () => {
      const builder = new FilterBuilder();
      const result = builder.where('done', '=', true).where('priority', '>', 3).build();

      expect(result.groups).toHaveLength(1);
      expect(result.groups[0]?.conditions).toHaveLength(2);
      expect(result.groups[0]?.conditions[0]?.field).toBe('done');
      expect(result.groups[0]?.conditions[1]?.field).toBe('priority');
    });

    it('should handle an empty builder', () => {
      const builder = new FilterBuilder();
      expect(builder.toString()).toBe('');
      expect(builder.build().groups).toHaveLength(0);
    });

    it('should handle a single condition without an explicit group', () => {
      const builder = new FilterBuilder();
      const result = builder.where('done', '=', false).build();

      expect(result.groups[0]?.conditions).toHaveLength(1);
      expect(result.groups[0]?.conditions[0]?.value).toBe(false);
    });

    it('should validate the built expression', () => {
      const builder = new FilterBuilder();
      const result = builder.where('done', '=', true).validate();

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
