/**
 * Filter validation for task filtering operations
 * Handles validation of filter expressions and task listing parameters
 */

import type { components } from '../../../types/generated/vikunja-openapi';
import type { FilterExpression, FilterGroup, ParseResult } from '../../../types/filters';
import type { TaskListingArgs, TaskFilterValidationConfig, TaskFilterStorage } from '../types/filters';
import { MCPError, ErrorCode } from '../../../types';
import { parseFilterString, expressionToString } from '../../../utils/filters';
import { validateTaskCountLimit } from '../../../utils/memory';
import { logger } from '../../../utils/logger';
import { VALID_SORT_FIELDS, SORT_FIELD_ALIASES } from '../constants';

/** `models.Task` per the OpenAPI spec — sample task for memory estimation. */
type Task = components['schemas']['models.Task'];

const VALID_SORT_FIELD_SET = new Set<string>(VALID_SORT_FIELDS);

/**
 * Normalizes a `sort` argument (comma-separated `sort_by` field list) by
 * translating this tool's camelCase field aliases to the API's snake_case
 * names (`dueDate` -> `due_date`, mirroring `FILTER_FIELD_TO_API_FIELD`),
 * then checks every resulting token against `VALID_SORT_FIELDS`.
 *
 * Without this, an unrecognized `sort_by` value is silently ignored by
 * Vikunja (tasks come back in default order with no error) — exactly the
 * "free-form field selector that silently no-ops" pattern this validation
 * closes, per the field/enum allowlist ergonomics sweep.
 */
function normalizeAndValidateSort(sort: string): { normalized: string; invalidTokens: string[] } {
  const invalidTokens: string[] = [];
  const normalizedTokens = sort.split(',').map((rawToken) => {
    const token = rawToken.trim();
    const apiField = SORT_FIELD_ALIASES[token] ?? token;
    if (!VALID_SORT_FIELD_SET.has(apiField)) {
      invalidTokens.push(token);
    }
    return apiField;
  });
  return { normalized: normalizedTokens.join(','), invalidTokens };
}

/**
 * Validates filter parameters for task listing operations
 */
export const FilterValidator = {
  /**
   * Validates and processes filter string or filter ID
   */
  async validateAndParseFilter(
    args: TaskListingArgs,
    storage: TaskFilterStorage
  ): Promise<{
    filterExpression: FilterExpression | null;
    filterString: string | undefined;
    validationWarnings: string[];
  }> {
    let filterExpression: FilterExpression | null = null;
    let filterString: string | undefined;
    const validationWarnings: string[] = [];

    try {
      // Resolve the user-supplied filter - either a direct filter string or a
      // saved filter referenced by id.
      let userFilter: string | undefined;
      if (args.filterId) {
        const savedFilter = await storage.get(args.filterId);
        if (!savedFilter) {
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            `Filter with id ${args.filterId} not found`
          );
        }
        userFilter = savedFilter.filter;
      } else if (args.filter !== undefined) {
        userFilter = args.filter;
      }

      // Parse the user-supplied filter into an expression.
      if (userFilter) {
        const parseResult: ParseResult = parseFilterString(userFilter);
        if (parseResult.error) {
          throw new MCPError(
            ErrorCode.VALIDATION_ERROR,
            `Invalid filter syntax: ${parseResult.error.message}${parseResult.error.context ? `\n${parseResult.error.context}` : ''}`
          );
        }
        filterExpression = parseResult.expression;
      }

      // Fold the `done` flag into the filter expression so it is applied
      // server-side (before pagination) rather than trimming an already
      // paginated page. Without this, `done=false` scattered open tasks
      // unpredictably across raw pages.
      if (args.done !== undefined) {
        const doneGroup: FilterGroup = {
          conditions: [{ field: 'done', operator: '=', value: args.done }],
          operator: '&&',
        };
        if (!filterExpression) {
          filterExpression = { groups: [doneGroup] };
        } else if (filterExpression.groups.length === 1) {
          // Single user group: AND `done` on as a second group. The user's
          // group is parenthesised when serialised, so its own &&/|| operator
          // is preserved.
          filterExpression = {
            groups: [...filterExpression.groups, doneGroup],
            operator: '&&',
          };
        }
        // Multi-group user filter: left untouched - appending a group here
        // could change group-join semantics. `done` is still enforced by
        // FilterExecutor.applyPostProcessingFilters in that case.
      }

      // Serialise the final expression for Vikunja's server-side `filter`
      // query param. When `done` was not folded in, keep the user's original
      // string verbatim.
      if (filterExpression) {
        filterString =
          args.done === undefined ? userFilter : expressionToString(filterExpression);
      }

      if (filterString) {
        // Log that we're preparing to attempt hybrid filtering
        logger.info('Preparing hybrid filtering (server-side attempt + client-side fallback)', {
          filter: filterString,
        });
      }

      return { filterExpression, filterString, validationWarnings };
    } catch (error) {
      if (error instanceof MCPError) {
        throw error;
      }
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        `Filter validation failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  },

  /**
   * Validates pagination and memory constraints
   */
  validateMemoryConstraints(
    args: TaskListingArgs,
    requestedPageSize: number
  ): {
    isValid: boolean;
    warnings: string[];
    maxAllowed?: number;
  } {
    const warnings: string[] = [];

    // Validate pagination limits for memory protection with enhanced analysis
    const taskCountValidation = validateTaskCountLimit(
      requestedPageSize,
      undefined,
      args.filter ? {
        filterExpression: args.filter,
        operationType: 'list'
      } : undefined
    );

    if (!taskCountValidation.allowed) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        `Task count limit exceeded. Requested: ${requestedPageSize}, Max allowed: ${taskCountValidation.maxAllowed}. ` +
        `Estimated memory usage: ${taskCountValidation.estimatedMemoryMB}MB (risk: ${taskCountValidation.riskLevel}). ` +
        'Reduce the perPage parameter, use pagination with smaller page sizes, or apply more specific filters.'
      );
    }

    // Add warnings for large page sizes
    if (requestedPageSize > 500) {
      warnings.push(`Large page size (${requestedPageSize}) may impact performance. Consider using smaller pages or more specific filters.`);
    }

    // Include enhanced memory validation warnings
    if (taskCountValidation.warnings.length > 0) {
      warnings.push(...taskCountValidation.warnings);
    }

    return {
      isValid: true,
      warnings,
      maxAllowed: taskCountValidation.maxAllowed
    } as {
      isValid: boolean;
      warnings: string[];
      maxAllowed?: number;
      riskLevel?: 'low' | 'medium' | 'high';
      estimatedMemoryMB?: number;
    };
  },

  /**
   * Validates the actual loaded task count against limits
   */
  validateLoadedTasks(actualTaskCount: number, sampleTask?: Task): {
    isValid: boolean;
    warnings: string[];
    shouldThrow: boolean;
    riskLevel?: 'low' | 'medium' | 'high';
    estimatedMemoryMB?: number;
  } {
    const warnings: string[] = [];
    const finalTaskCountValidation = validateTaskCountLimit(actualTaskCount, sampleTask);

    if (!finalTaskCountValidation.allowed) {
      // Log warning but don't fail since tasks are already loaded
      logger.warn('Loaded task count exceeds recommended limits', {
        actualCount: actualTaskCount,
        maxRecommended: finalTaskCountValidation.maxAllowed,
        estimatedMemoryMB: finalTaskCountValidation.estimatedMemoryMB,
        riskLevel: finalTaskCountValidation.riskLevel
      });

      warnings.push(
        `Loaded ${actualTaskCount} tasks, which exceeds recommended limit of ${finalTaskCountValidation.maxAllowed}. ` +
        `Estimated memory usage: ${finalTaskCountValidation.estimatedMemoryMB}MB (risk: ${finalTaskCountValidation.riskLevel}).`
      );

      // For extremely large datasets, still enforce hard limits
      if (actualTaskCount > finalTaskCountValidation.maxAllowed * 1.5) {
        return {
          isValid: false,
          warnings,
          shouldThrow: true,
          riskLevel: finalTaskCountValidation.riskLevel,
          estimatedMemoryMB: finalTaskCountValidation.estimatedMemoryMB
        };
      }
    }

    // Include warnings from enhanced validation
    if (finalTaskCountValidation.warnings.length > 0) {
      warnings.push(...finalTaskCountValidation.warnings);
    }

    return {
      isValid: true,
      warnings,
      shouldThrow: false,
      riskLevel: finalTaskCountValidation.riskLevel,
      estimatedMemoryMB: finalTaskCountValidation.estimatedMemoryMB
    };
  },

  /**
   * Validates task listing arguments
   */
  validateTaskListingArgs(args: TaskListingArgs): string[] {
    const errors: string[] = [];

    // Validate numeric parameters
    if (args.page !== undefined && (args.page < 1 || !Number.isInteger(args.page))) {
      errors.push('Page number must be a positive integer');
    }

    if (args.perPage !== undefined && (args.perPage < 1 || !Number.isInteger(args.perPage))) {
      errors.push('Per page count must be a positive integer');
    }

    if (args.projectId !== undefined && (args.projectId < 1 || !Number.isInteger(args.projectId))) {
      errors.push('Project ID must be a positive integer');
    }

    // Validate boolean parameters
    if (args.done !== undefined && typeof args.done !== 'boolean') {
      errors.push('Done parameter must be a boolean value');
    }

    // Validate string parameters
    if (args.search !== undefined && typeof args.search !== 'string') {
      errors.push('Search parameter must be a string');
    }

    if (args.sort !== undefined && typeof args.sort !== 'string') {
      errors.push('Sort parameter must be a string');
    } else if (args.sort !== undefined && args.sort.trim() !== '') {
      const { normalized, invalidTokens } = normalizeAndValidateSort(args.sort);
      if (invalidTokens.length > 0) {
        errors.push(
          `Invalid sort field(s): ${invalidTokens.join(', ')}. Valid fields: ${VALID_SORT_FIELDS.join(', ')} ` +
            `(camelCase aliases also accepted: ${Object.keys(SORT_FIELD_ALIASES).join(', ')})`,
        );
      } else {
        // Normalize in place so the corrected (snake_case) value is what
        // actually reaches the API — validation runs before
        // FilterExecutor.prepareQueryParameters reads args.sort.
        args.sort = normalized;
      }
    }

    if (args.filter !== undefined && typeof args.filter !== 'string') {
      errors.push('Filter parameter must be a string');
    }

    if (args.filterId !== undefined && typeof args.filterId !== 'string') {
      errors.push('Filter ID parameter must be a string');
    }

    return errors;
  },

  /**
   * Performs comprehensive validation of task filtering parameters
   */
  async validateTaskFiltering(
    args: TaskListingArgs,
    storage: TaskFilterStorage,
    _config: TaskFilterValidationConfig = {}
  ): Promise<{
    filterExpression: FilterExpression | null;
    filterString: string | undefined;
    validationWarnings: string[];
    memoryValidation: {
      isValid: boolean;
      warnings: string[];
      maxAllowed?: number;
    };
  }> {
    const allWarnings: string[] = [];

    // Validate basic arguments
    const argValidationErrors = FilterValidator.validateTaskListingArgs(args);
    if (argValidationErrors.length > 0) {
      throw new MCPError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid task listing arguments: ${argValidationErrors.join(', ')}`
      );
    }

    // Validate and parse filter
    const filterValidation = await FilterValidator.validateAndParseFilter(args, storage);
    allWarnings.push(...filterValidation.validationWarnings);

    // Validate memory constraints
    const pageSize = args.perPage || 1000; // Default pagination
    const memoryValidation = FilterValidator.validateMemoryConstraints(args, pageSize);
    allWarnings.push(...memoryValidation.warnings);

    return {
      filterExpression: filterValidation.filterExpression,
      filterString: filterValidation.filterString,
      validationWarnings: allWarnings,
      memoryValidation
    };
  },
};