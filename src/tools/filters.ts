/**
 * Vikunja saved filters tool.
 *
 * `create`/`get`/`update`/`delete`/`list` are wired to Vikunja's real
 * server-side saved filter endpoints (`PUT /filters`, `GET|POST|DELETE
 * /filters/{id}` — see docs/vikunja-openapi.json `models.SavedFilter`).
 * Filters created through this tool persist on the server, are visible in
 * the Vikunja UI, and are shared with any other Vikunja client using the
 * same account — this used to be a documented fake backed by
 * `SimpleFilterStorage` (an in-memory, per-session store); it no longer is.
 * `SimpleFilterStorage` itself is untouched and still backs
 * `vikunja_templates` and the tasks tool's own session-scoped storage — see
 * `src/storage/SimpleFilterStorage.ts`.
 *
 * Two honesty notes baked into the design below (both driven by what the
 * vendored spec actually documents, not by node-vikunja's drifted types):
 *
 * 1. `models.SavedFilter` has no `project_id` field at all. Saved filters
 *    are never project-scoped via a create/update parameter — the previous
 *    implementation's `projectId` argument modeled a field the real API
 *    does not have. Vikunja scopes filters entirely differently: it exposes
 *    each saved filter as a *pseudo-project* with a negative id
 *    (alongside real projects, e.g. in the sidebar / `GET /projects`), and
 *    `is_favorite` controls whether it also shows in the favorites parent.
 *    That pseudo-project id is NOT the filter's own numeric id — the
 *    conversion is a documented Vikunja backend convention
 *    (`filterId = -1 - pseudoProjectId`, a self-inverse transform) that is
 *    NOT present in the vendored OpenAPI spec, so `list` (below) treats it
 *    as a best-effort hint, not fact: it converts, then verifies with a
 *    live `GET /filters/{id}` per entry, and reports unverified entries
 *    honestly (`hydrated: false`) instead of asserting data it couldn't
 *    confirm.
 * 2. There is no `GET /filters` (list-all) endpoint in the spec — only
 *    `PUT /filters` (create) and `GET|POST|DELETE /filters/{id}`
 *    (single-filter operations). `list` is therefore necessarily a
 *    best-effort derivation through `GET /projects`' pseudo-project
 *    entries, not a direct call to a documented listing endpoint.
 *
 * `build`/`validate` are unchanged: pure local utilities for constructing
 * or checking a filter query string. They never read or write a saved
 * filter and require no authentication.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import {
  FilterBuilder,
  validateFilterExpression,
  parseFilterString,
  expressionToString,
} from '../utils/filters';
import type { FilterField, FilterOperator } from '../types/filters';
import { logger } from '../utils/logger';
import { createStandardResponse } from '../types';
import { ErrorCode, MCPError } from '../types';
import { createValidationError } from '../utils/error-handler';
import { formatAorpAsMarkdown, createAorpErrorResponse } from '../utils/response-factory';
import { vikunjaRestRequest } from '../utils/vikunja-rest';
import type { components } from '../types/generated/vikunja-openapi';

type SavedFilterApi = components['schemas']['models.SavedFilter'];
type ProjectApi = components['schemas']['models.Project'];

/**
 * The filter DSL's supported fields, shared by `build`/`create`/`update`'s
 * `conditions` shorthand. Mirrors `FilterField` in `src/types/filters.ts`.
 */
const FILTER_FIELD_VALUES = [
  'done',
  'priority',
  'percentDone',
  'dueDate',
  'startDate',
  'endDate',
  'doneAt',
  'project',
  'assignees',
  'labels',
  'created',
  'updated',
  'title',
  'description',
] as const;

const FILTER_OPERATOR_VALUES = ['=', '!=', '>', '>=', '<', '<=', 'like', 'in', 'not in'] as const;

const ConditionSchema = z.object({
  field: z.enum(FILTER_FIELD_VALUES),
  operator: z.enum(FILTER_OPERATOR_VALUES),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
});

/**
 * Numeric saved filter id. Vikunja ids are always positive integers;
 * `z.coerce` tolerates a stringified id (e.g. `"12"`) the same way other
 * tools in this codebase do via `validateAndConvertId`.
 */
const FilterIdSchema = z.coerce.number().int().positive();

/**
 * Schema for listing filters.
 */
const ListFiltersSchema = z.object({
  page: z.number().int().positive().optional().describe('Page of the underlying GET /projects call'),
  perPage: z.number().int().positive().optional().describe('Items per page of the underlying GET /projects call'),
  favorite: z.boolean().optional().describe('Only include filters currently marked as favorite'),
});

/**
 * Schema for getting a filter.
 */
const GetFilterSchema = z.object({
  id: FilterIdSchema.describe("The filter's own numeric id (not a pseudo-project id)"),
});

/**
 * Schema for creating a filter.
 */
const CreateFilterSchema = z
  .object({
    title: z.string().min(1).max(250).describe('Filter title (models.SavedFilter.title)'),
    description: z.string().optional(),
    filter: z
      .string()
      .optional()
      .describe(
        "Filter query string in this server's DSL (camelCase fields, e.g. dueDate). " +
          'Parsed, validated, and translated to the API\'s snake_case field names ' +
          '(e.g. due_date) before being sent to Vikunja.',
      ),
    conditions: z
      .array(ConditionSchema)
      .optional()
      .describe('Alternative to `filter`: structured conditions built into a filter string'),
    groupOperator: z.enum(['&&', '||']).optional().describe('Operator joining `conditions` (default &&)'),
    isFavorite: z
      .boolean()
      .optional()
      .describe('Maps to is_favorite; favorite filters show up in the favorites parent alongside favorite projects'),
  })
  .refine((data) => Boolean(data.filter) || Boolean(data.conditions && data.conditions.length > 0), {
    message: 'Either filter or conditions must be provided',
  });

/**
 * Schema for updating a filter. Vikunja's `POST /filters/{id}` is a
 * full-model-replace endpoint (no PATCH variant exists) — the handler
 * fetches the current filter and merges these fields onto it before
 * writing the whole object back, per docs/ENDPOINT-PLAYBOOK.md §4.
 */
const UpdateFilterSchema = z.object({
  id: FilterIdSchema,
  title: z.string().min(1).max(250).optional(),
  description: z.string().optional(),
  filter: z.string().optional(),
  conditions: z.array(ConditionSchema).optional(),
  groupOperator: z.enum(['&&', '||']).optional(),
  isFavorite: z.boolean().optional(),
});

/**
 * Schema for deleting a filter.
 */
const DeleteFilterSchema = z.object({
  id: FilterIdSchema,
});

/**
 * Schema for building a filter (pure local utility, no server call).
 */
const BuildFilterSchema = z.object({
  conditions: z.array(ConditionSchema).describe('Filter conditions'),
  groupOperator: z.enum(['&&', '||']).optional().describe('Operator to combine conditions'),
});

/**
 * Schema for validating a filter (pure local utility, no server call).
 */
const ValidateFilterSchema = z.object({
  filter: z.string().describe('Filter query string to validate'),
});

type ConditionInput = {
  field: FilterField;
  operator: FilterOperator;
  value: string | number | boolean | (string | number)[];
};

/**
 * Parses, validates, and translates a caller-supplied DSL filter string into
 * the snake_case query string Vikunja's API expects.
 *
 * This is the "existing validated pipeline" the filters tool must route
 * through: `parseFilterString` (secure Zod-backed parser),
 * `validateFilterExpression` (field/operator/value semantics), and
 * `expressionToString` (applies `FILTER_FIELD_TO_API_FIELD`, e.g.
 * `dueDate` -> `due_date`) — see src/utils/filters.ts. Without the last
 * step, a DSL field name sent verbatim is not a Task field Vikunja
 * recognizes.
 *
 * @throws {MCPError} VALIDATION_ERROR when the filter fails to parse/validate
 */
function translateFilterString(filterStr: string): string {
  const parseResult = parseFilterString(filterStr);
  if (!parseResult.expression) {
    throw createValidationError(`Invalid filter: ${parseResult.error?.message || 'Invalid filter syntax'}`);
  }
  const validation = validateFilterExpression(parseResult.expression);
  if (!validation.valid) {
    throw createValidationError(`Invalid filter: ${validation.errors.join('; ')}`);
  }
  return expressionToString(parseResult.expression);
}

/**
 * Builds, validates, and translates a filter query string from structured
 * `conditions` (the same pipeline as `translateFilterString`, entered via
 * `FilterBuilder` instead of the string parser).
 *
 * @throws {MCPError} VALIDATION_ERROR when the built expression fails
 *         semantic validation (e.g. an operator incompatible with a field)
 */
function buildFilterStringFromConditions(conditions: ConditionInput[], groupOperator?: '&&' | '||'): string {
  const builder = new FilterBuilder();
  conditions.forEach((condition, index) => {
    if (index > 0 && groupOperator === '||') {
      builder.or();
    }
    builder.where(condition.field, condition.operator, condition.value);
  });
  const expression = builder.build();
  const validation = validateFilterExpression(expression);
  if (!validation.valid) {
    throw createValidationError(`Invalid filter: ${validation.errors.join('; ')}`);
  }
  return expressionToString(expression);
}

/**
 * Fetches a saved filter by id, mapping the API's 403/404 (Vikunja returns
 * 403 for both "doesn't exist" and "no access", per the spec's
 * `models.SavedFilter` responses) to a single honest NOT_FOUND error rather
 * than leaking the ambiguity to the caller as a raw HTTP error.
 */
async function fetchSavedFilterOrThrow(authManager: AuthManager, id: number): Promise<SavedFilterApi> {
  try {
    return await vikunjaRestRequest<SavedFilterApi>(authManager, 'GET', `/filters/${id}`);
  } catch (error) {
    throw mapNotFound(error, id);
  }
}

/** Maps a 403/404 REST error to NOT_FOUND; re-throws anything else as-is. */
function mapNotFound(error: unknown, id: number): unknown {
  if (error instanceof MCPError) {
    const statusCode = error.details?.statusCode;
    if (statusCode === 403 || statusCode === 404) {
      return new MCPError(ErrorCode.NOT_FOUND, `Filter with id ${id} not found (or you do not have access to it)`);
    }
  }
  return error;
}

/** Shapes a `models.SavedFilter` API object into the tool's response shape. */
function mapSavedFilterForResponse(filter: SavedFilterApi): Record<string, unknown> {
  return {
    id: filter.id,
    title: filter.title,
    description: filter.description,
    filter: filter.filters?.filter,
    isFavorite: filter.is_favorite,
    owner: filter.owner ? { id: filter.owner.id, username: filter.owner.username } : undefined,
    created: filter.created,
    updated: filter.updated,
  };
}

/**
 * Vikunja's own (undocumented-in-spec) transform between a saved filter's
 * pseudo-project id (as it appears in `GET /projects`) and its real numeric
 * filter id. Self-inverse: applying it twice returns the original value.
 * `list` uses this as a hint only — every candidate id it produces is
 * verified with a live `GET /filters/{id}` before being presented as real
 * data (see the module doc comment).
 */
function pseudoProjectIdToFilterId(pseudoProjectId: number): number {
  return -1 - pseudoProjectId;
}

interface ListedFilter {
  id: number | null;
  pseudoProjectId: number;
  title: string;
  description?: string | undefined;
  isFavorite?: boolean | undefined;
  filter?: string | undefined;
  created?: string | undefined;
  updated?: string | undefined;
  hydrated: boolean;
}

/**
 * Derives the list of saved filters from `GET /projects`' pseudo-project
 * entries (negative ids), verifying each candidate real filter id with a
 * live `GET /filters/{id}` call. See the module doc comment for why there
 * is no more direct way to do this against the current API.
 */
async function listSavedFilters(
  authManager: AuthManager,
  params: { page?: number | undefined; perPage?: number | undefined },
): Promise<ListedFilter[]> {
  const page = params.page ?? 1;
  const perPage = params.perPage ?? 100;

  const projects =
    (await vikunjaRestRequest<ProjectApi[]>(
      authManager,
      'GET',
      `/projects?page=${page}&per_page=${perPage}`,
    )) ?? [];

  const pseudoEntries = Array.isArray(projects)
    ? projects.filter((project): project is ProjectApi & { id: number } => typeof project.id === 'number' && project.id < 0)
    : [];

  return Promise.all(
    pseudoEntries.map(async (entry): Promise<ListedFilter> => {
      const candidateId = pseudoProjectIdToFilterId(entry.id);
      try {
        const full = await vikunjaRestRequest<SavedFilterApi>(authManager, 'GET', `/filters/${candidateId}`);
        return {
          id: full.id ?? candidateId,
          pseudoProjectId: entry.id,
          title: full.title ?? entry.title ?? '',
          description: full.description,
          isFavorite: full.is_favorite,
          filter: full.filters?.filter,
          created: full.created,
          updated: full.updated,
          hydrated: true,
        };
      } catch {
        // The computed id didn't resolve to a real filter (or the caller
        // lacks access to it) - report what GET /projects gave us instead
        // of asserting unverified data.
        return {
          id: null,
          pseudoProjectId: entry.id,
          title: entry.title ?? '',
          description: entry.description,
          isFavorite: entry.is_favorite,
          hydrated: false,
        };
      }
    }),
  );
}

/**
 * Register filters tool
 */
export function registerFiltersTool(server: McpServer, authManager: AuthManager, _clientFactory?: VikunjaClientFactory): void {
  server.tool(
    'vikunja_filters',
    'Manage Vikunja saved filters and build/validate ad-hoc filter query strings. ' +
      "'create'/'get'/'update'/'delete' operate on Vikunja's real server-side " +
      'saved filters (PUT /filters, GET/POST/DELETE /filters/{id}) - changes ' +
      'persist on the server and are visible in the Vikunja UI and to other ' +
      "clients. Saved filters are NOT project-scoped (the API's SavedFilter " +
      'model has no project_id field); Vikunja instead surfaces each one as a ' +
      "pseudo-project with a negative id, and 'isFavorite' controls whether it " +
      "also shows in the favorites parent. The API has no dedicated list-all " +
      "endpoint, so 'list' is a best-effort derivation from GET /projects' " +
      'pseudo-project entries, verified per-item against GET /filters/{id}; ' +
      "entries that could not be verified are still returned (title only) " +
      "with hydrated:false rather than silently dropped. 'build'/'validate' " +
      'remain pure local utilities - they construct or check a filter query ' +
      'string without contacting the server or touching any saved filter.',
    {
      action: z.enum(['list', 'get', 'create', 'update', 'delete', 'build', 'validate']),
      parameters: z.record(z.string(), z.unknown()),
    },
    async ({ action, parameters }) => {
      logger.info(`Executing vikunja_filters action: ${action}`);

      // build/validate are pure local utilities and need no server access.
      if (action !== 'build' && action !== 'validate' && !authManager.isAuthenticated()) {
        throw new MCPError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please use vikunja_auth.connect first.',
        );
      }

      try {
        switch (action) {
          case 'list': {
            const params = ListFiltersSchema.parse(parameters);
            logger.debug('Listing saved filters', params);

            let filters = await listSavedFilters(authManager, params);
            if (params.favorite !== undefined) {
              filters = filters.filter((f) => f.isFavorite === params.favorite);
            }

            const anyUnhydrated = filters.some((f) => !f.hydrated);

            const response = createStandardResponse(
              'list-saved-filters',
              `Found ${filters.length} saved filter${filters.length !== 1 ? 's' : ''}` +
                (anyUnhydrated ? ' (some entries could not be fully resolved - see hydrated:false)' : ''),
              {
                filters,
                note:
                  "Vikunja has no dedicated list-saved-filters endpoint. This list is " +
                  "derived from GET /projects' pseudo-project entries (negative ids) " +
                  "and verified per-item against GET /filters/{id}; unverified " +
                  'entries are still included with hydrated:false rather than dropped.',
              },
              { count: filters.length },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'get': {
            const params = GetFilterSchema.parse(parameters);
            logger.debug(`Getting filter with id: ${params.id}`);

            const filter = await fetchSavedFilterOrThrow(authManager, params.id);

            const response = createStandardResponse(
              'get-saved-filter',
              `Retrieved filter "${filter.title}"`,
              { filter: mapSavedFilterForResponse(filter) },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'create': {
            const params = CreateFilterSchema.parse(parameters);
            logger.debug(`Creating filter with title: ${params.title}`);

            // CreateFilterSchema's .refine() already guarantees one of these
            // is usable before the handler ever runs.
            const filterQuery = params.filter
              ? translateFilterString(params.filter)
              : buildFilterStringFromConditions(params.conditions ?? [], params.groupOperator);

            const payload: SavedFilterApi = {
              title: params.title,
              filters: { filter: filterQuery },
            };
            if (params.description !== undefined) payload.description = params.description;
            if (params.isFavorite !== undefined) payload.is_favorite = params.isFavorite;

            const created = await vikunjaRestRequest<SavedFilterApi>(authManager, 'PUT', '/filters', payload);

            const response = createStandardResponse(
              'create-saved-filter',
              `Filter "${created.title}" saved successfully`,
              { filter: mapSavedFilterForResponse(created) },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'update': {
            const params = UpdateFilterSchema.parse(parameters);
            logger.debug(`Updating filter with id: ${params.id}`);

            const current = await fetchSavedFilterOrThrow(authManager, params.id);

            let filterQuery = current.filters?.filter;
            if (params.filter) {
              filterQuery = translateFilterString(params.filter);
            } else if (params.conditions && params.conditions.length > 0) {
              filterQuery = buildFilterStringFromConditions(params.conditions, params.groupOperator);
            }

            const affectedFields = (['title', 'description', 'filter', 'conditions', 'isFavorite'] as const).filter(
              (key) => params[key] !== undefined,
            );

            const mergedDescription = params.description ?? current.description;
            const mergedIsFavorite = params.isFavorite ?? current.is_favorite;

            // POST /filters/{id} replaces the whole resource (no PATCH
            // variant exists - see docs/ENDPOINT-PLAYBOOK.md §4), so every
            // field not explicitly supplied is carried forward from the
            // fetch above rather than omitted. Fields are only assigned when
            // defined (rather than via a bare `?? current.x`) because
            // `exactOptionalPropertyTypes` treats an explicit `undefined`
            // assignment differently from omitting the key entirely.
            const payload: SavedFilterApi = {
              title: params.title ?? current.title ?? '',
              ...(mergedDescription !== undefined ? { description: mergedDescription } : {}),
              ...(mergedIsFavorite !== undefined ? { is_favorite: mergedIsFavorite } : {}),
              filters: {
                ...current.filters,
                ...(filterQuery !== undefined ? { filter: filterQuery } : {}),
              },
            };

            let updated: SavedFilterApi;
            try {
              updated = await vikunjaRestRequest<SavedFilterApi>(authManager, 'POST', `/filters/${params.id}`, payload);
            } catch (error) {
              throw mapNotFound(error, params.id);
            }

            const response = createStandardResponse(
              'update-saved-filter',
              `Filter "${updated.title}" updated successfully`,
              { filter: mapSavedFilterForResponse(updated) },
              { affectedFields },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'delete': {
            const params = DeleteFilterSchema.parse(parameters);
            logger.debug(`Deleting filter with id: ${params.id}`);

            // Fetch first so the response can report the deleted filter's
            // title and so a nonexistent id produces the same NOT_FOUND
            // message 'get' does, rather than a raw HTTP error.
            const filter = await fetchSavedFilterOrThrow(authManager, params.id);

            await vikunjaRestRequest(authManager, 'DELETE', `/filters/${params.id}`);

            const response = createStandardResponse(
              'delete-saved-filter',
              `Filter "${filter.title}" deleted successfully`,
              { success: true },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'build': {
            const params = BuildFilterSchema.parse(parameters);
            logger.debug('Building filter from conditions');

            const builder = new FilterBuilder();

            params.conditions.forEach((condition, index) => {
              if (index > 0 && params.groupOperator === '||') {
                builder.or();
              }
              builder.where(condition.field, condition.operator, condition.value);
            });

            const filterString = builder.toString();

            const response = createStandardResponse(
              'build-filter',
              'Filter built successfully',
              {
                filter: filterString,
                valid: true,
                warnings: [],
              },
              { conditionCount: params.conditions.length },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          case 'validate': {
            const params = ValidateFilterSchema.parse(parameters);
            logger.debug(`Validating filter: ${params.filter}`);

            const parseResult = parseFilterString(params.filter);

            if (!parseResult.expression) {
              const errorMsg = parseResult.error?.message || 'Invalid filter syntax';
              throw createValidationError(`Invalid filter: ${errorMsg}`);
            }

            const validationResult = validateFilterExpression(parseResult.expression);

            const response = createStandardResponse(
              'validate-filter',
              validationResult.valid ? 'Filter is valid' : 'Filter validation failed',
              {
                valid: validationResult.valid,
                warnings: validationResult.warnings || [],
                errors: validationResult.errors || [],
                filter: params.filter,
              },
            );

            return {
              content: [{ type: 'text' as const, text: formatAorpAsMarkdown(response) }],
            };
          }

          default:
            throw new MCPError(ErrorCode.NOT_IMPLEMENTED, `Unknown action: ${action as string}`);
        }
      } catch (error) {
        logger.error(`Error in vikunja_filters tool:`, error);

        const isNotFound = error instanceof MCPError && error.code === ErrorCode.NOT_FOUND;

        const operation =
          action === 'get' && isNotFound
            ? 'get-saved-filter'
            : action === 'delete' && isNotFound
              ? 'delete-saved-filter'
              : action === 'update' && isNotFound
                ? 'update-saved-filter'
                : `${action}-filter`;

        const aorpErrorResult = createAorpErrorResponse(operation, error instanceof Error ? error.message : String(error));

        // Create compatibility result with required SimpleAorpResponse properties
        const compatibilityResult = {
          content: aorpErrorResult.content,
          immediate: {
            status: 'error' as const,
            key_insight: aorpErrorResult.content.split('\n')[0] || 'Error occurred',
            confidence: 0.0,
          },
          summary: aorpErrorResult.content.split('\n')[0] || 'Error occurred',
          metadata: {
            timestamp: aorpErrorResult.metadata?.timestamp || new Date().toISOString(),
            operation: `${action}-filter`,
            success: false,
            ...(aorpErrorResult.metadata || {}),
          },
        };

        return {
          content: [{ type: 'text' as const, text: formatAorpAsMarkdown(compatibilityResult) }],
        };
      }
    },
  );
}
