/**
 * Tests for the vikunja_filters tool.
 *
 * `create`/`get`/`update`/`delete`/`list` now route through
 * `vikunjaRestRequest` against Vikunja's real saved-filter endpoints
 * (`PUT /filters`, `GET|POST|DELETE /filters/{id}`) instead of the old
 * in-memory `SimpleFilterStorage`. Mocks follow the same pattern as
 * tests/tools/webhooks.test.ts and tests/tools/projects/buckets.test.ts:
 * a mocked global `fetch`, asserted against the normalized `/api/v1/...`
 * URL vikunjaRestRequest produces, with per-test circuit breaker resets.
 *
 * `build`/`validate` are unchanged pure-local utilities and are tested
 * without any fetch mocking.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { registerFiltersTool } from '../../src/tools/filters';
import { AuthManager } from '../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../src/utils/retry';
import type { MockServer } from '../types/mocks';
import { parseMarkdown } from '../utils/markdown';
import { ConfigurationManager } from '../../src/config';
import { callAndCatch, isReadOnlyRejection } from '../utils/read-only-test-helpers';

jest.mock('../../src/utils/logger');

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal Response-like object matching what vikunjaRestRequest reads. */
function mockResponse(opts: { ok?: boolean; status?: number; statusText?: string; body?: unknown }): Response {
  const { ok = true, status = 200, statusText = 'OK', body } = opts;
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

describe('vikunja_filters tool', () => {
  let toolHandler: (args: any) => Promise<any>;
  let mockServer: MockServer;
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://api.vikunja.test', 'test-token-12345678');

    mockServer = {
      tool: jest.fn() as jest.MockedFunction<(name: string, schema: any, handler: any) => void>,
    } as MockServer;

    registerFiltersTool(mockServer, authManager);

    const calls = (mockServer.tool as jest.Mock).mock.calls;
    if (calls.length > 0) {
      toolHandler = calls[0][calls[0].length - 1];
    } else {
      throw new Error('Tool handler not found');
    }
  });

  const savedFilter = (overrides: Record<string, unknown> = {}) => ({
    id: 3,
    title: 'High priority',
    description: 'Everything urgent',
    is_favorite: false,
    owner: { id: 1, username: 'alice' },
    created: '2024-01-01T00:00:00Z',
    updated: '2024-01-01T00:00:00Z',
    filters: { filter: 'priority >= 4' },
    ...overrides,
  });

  describe('authentication', () => {
    it('requires authentication for create/get/update/delete/list', async () => {
      const unauth = new AuthManager();
      const server = { tool: jest.fn() } as unknown as MockServer;
      registerFiltersTool(server, unauth);
      const call = (server.tool as jest.Mock).mock.calls[0];
      const handler = call[call.length - 1];

      for (const action of ['list', 'get', 'create', 'update', 'delete']) {
        await expect(handler({ action, parameters: {} })).rejects.toThrow('Authentication required');
      }
    });

    it('does not require authentication for build/validate', async () => {
      const unauth = new AuthManager();
      const server = { tool: jest.fn() } as unknown as MockServer;
      registerFiltersTool(server, unauth);
      const call = (server.tool as jest.Mock).mock.calls[0];
      const handler = call[call.length - 1];

      const buildResult = await handler({
        action: 'build',
        parameters: { conditions: [{ field: 'done', operator: '=', value: false }] },
      });
      expect(buildResult.content[0].text).toContain('Filter built successfully');

      const validateResult = await handler({ action: 'validate', parameters: { filter: 'done = false' } });
      expect(validateResult.content[0].text).toContain('Filter is valid');
    });
  });

  describe('create action', () => {
    it('sends a PUT /filters payload with the translated filter string', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ status: 201, body: savedFilter({ title: 'Due soon', filters: { filter: 'due_date < now' } }) }),
      );

      const result = await toolHandler({
        action: 'create',
        parameters: { title: 'Due soon', description: 'Urgent stuff', filter: 'dueDate < now', isFavorite: true },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/filters',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            title: 'Due soon',
            filters: { filter: 'due_date < now' },
            description: 'Urgent stuff',
            is_favorite: true,
          }),
        }),
      );

      const markdown = result.content[0].text;
      const parsed = parseMarkdown(markdown);
      expect(parsed.hasHeading(2, /Success/)).toBe(true);
      expect(markdown).toContain('saved successfully');
    });

    it('builds the payload from structured conditions when no filter string is given', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, body: savedFilter() }));

      await toolHandler({
        action: 'create',
        parameters: {
          title: 'High priority',
          conditions: [
            { field: 'priority', operator: '>=', value: 4 },
            { field: 'done', operator: '=', value: false },
          ],
          groupOperator: '&&',
        },
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse((call[1] as { body?: string }).body as string);
      expect(body.filters.filter).toBe('(priority >= 4 && done = false)');
    });

    it('translates camelCase DSL fields to the API snake_case names', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ status: 201, body: savedFilter() }));

      await toolHandler({
        action: 'create',
        parameters: { title: 'Percent done', filter: 'percentDone >= 75' },
      });

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse((call[1] as { body?: string }).body as string);
      expect(body.filters.filter).toBe('percent_done >= 75');
    });

    it('rejects when neither filter nor conditions are provided', async () => {
      const result = await toolHandler({ action: 'create', parameters: { title: 'Empty' } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('Either filter or conditions must be provided');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an invalid filter string before calling the API', async () => {
      const result = await toolHandler({
        action: 'create',
        parameters: { title: 'Bad filter', filter: 'not a valid filter (((' },
      });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('Invalid filter');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a syntactically valid but semantically invalid filter string', async () => {
      // Parses fine (a boolean field with a comparison operator), but fails
      // validateFilterExpression's field/operator compatibility check.
      const result = await toolHandler({
        action: 'create',
        parameters: { title: 'Bad semantics', filter: 'done > true' },
      });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('Invalid filter');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a title over 250 characters', async () => {
      const result = await toolHandler({
        action: 'create',
        parameters: { title: 'x'.repeat(251), filter: 'done = false' },
      });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('get action', () => {
    it('fetches GET /filters/{id} and maps the response', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 7 }) }));

      const result = await toolHandler({ action: 'get', parameters: { id: 7 } });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/filters/7',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain('Retrieved filter "High priority"');
    });

    it('coerces a numeric-string id', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 9 }) }));

      await toolHandler({ action: 'get', parameters: { id: '9' } });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.vikunja.test/api/v1/filters/9',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('maps a 404 to a NOT_FOUND error', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      const result = await toolHandler({ action: 'get', parameters: { id: 999 } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('not found');
    });

    it('maps a 403 (no access) to the same NOT_FOUND message as a 404', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 403, statusText: 'Forbidden' }));

      const result = await toolHandler({ action: 'get', parameters: { id: 5 } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('not found');
    });
  });

  describe('update action', () => {
    it('fetches the current filter, merges changes, and POSTs the full resource', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            body: savedFilter({
              id: 4,
              title: 'Original',
              description: 'Original description',
              is_favorite: false,
              filters: { filter: 'done = false', sort_by: ['priority'] },
            }),
          }),
        )
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4, title: 'Renamed' }) }));

      const result = await toolHandler({
        action: 'update',
        parameters: { id: 4, title: 'Renamed' },
      });

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://api.vikunja.test/api/v1/filters/4',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.vikunja.test/api/v1/filters/4',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            title: 'Renamed',
            description: 'Original description',
            is_favorite: false,
            filters: { filter: 'done = false', sort_by: ['priority'] },
          }),
        }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain('updated successfully');
    });

    it('preserves fields not supplied in the update (full-model-replace safety)', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            body: savedFilter({
              id: 4,
              title: 'Keep me',
              description: 'Keep this too',
              is_favorite: true,
              filters: { filter: 'done = false' },
            }),
          }),
        )
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }));

      await toolHandler({
        action: 'update',
        parameters: { id: 4, filter: 'priority > 3' },
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse((postCall[1] as { body?: string }).body as string);
      expect(body).toEqual({
        title: 'Keep me',
        description: 'Keep this too',
        is_favorite: true,
        filters: { filter: 'priority > 3' },
      });
    });

    it('translates a replacement filter string to snake_case', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4, filters: { filter: 'done = false' } }) }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }));

      await toolHandler({
        action: 'update',
        parameters: { id: 4, filter: 'startDate > now' },
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse((postCall[1] as { body?: string }).body as string);
      expect(body.filters.filter).toBe('start_date > now');
    });

    it('maps a 404 on the initial fetch to NOT_FOUND without POSTing', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      const result = await toolHandler({ action: 'update', parameters: { id: 404, title: 'X' } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('not found');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('reports affectedFields for only the supplied keys', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }));

      const result = await toolHandler({
        action: 'update',
        parameters: { id: 4, description: 'New description' },
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('description');
    });

    it('rebuilds the filter from structured conditions when supplied instead of a string', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4, filters: { filter: 'done = false' } }) }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }));

      await toolHandler({
        action: 'update',
        parameters: {
          id: 4,
          conditions: [
            { field: 'priority', operator: '=', value: 5 },
            { field: 'priority', operator: '=', value: 1 },
          ],
          groupOperator: '||',
        },
      });

      const postCall = mockFetch.mock.calls[1];
      const body = JSON.parse((postCall[1] as { body?: string }).body as string);
      expect(body.filters.filter).toBe('(priority = 5 || priority = 1)');
    });

    it('maps a 404 on the POST (e.g. deleted between fetch and write) to NOT_FOUND', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      const result = await toolHandler({ action: 'update', parameters: { id: 4, title: 'Renamed' } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('not found');
    });

    it('rejects semantically invalid structured conditions (wrong operator for field type)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 4 }) }));

      const result = await toolHandler({
        action: 'update',
        parameters: { id: 4, conditions: [{ field: 'done', operator: '>', value: true }] },
      });

      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('Invalid filter');
      // Only the initial GET happened - the invalid conditions were rejected
      // before any write.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete action', () => {
    it('fetches then DELETEs the filter', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 6, title: 'Gone soon' }) }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 6, title: 'Gone soon' }) }));

      const result = await toolHandler({ action: 'delete', parameters: { id: 6 } });

      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.vikunja.test/api/v1/filters/6',
        expect.objectContaining({ method: 'DELETE' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain('Filter "Gone soon" deleted successfully');
    });

    it('maps a 404 to NOT_FOUND without attempting the delete call', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      const result = await toolHandler({ action: 'delete', parameters: { id: 999 } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('not found');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('list action', () => {
    it('derives filters from GET /projects pseudo-project entries and hydrates each via GET /filters/{id}', async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockResponse({
            body: [
              { id: 1, title: 'Real project' },
              { id: -4, title: 'High priority (pseudo)' },
            ],
          }),
        )
        .mockResolvedValueOnce(
          mockResponse({ body: savedFilter({ id: 3, title: 'High priority', filters: { filter: 'priority >= 4' } }) }),
        );

      const result = await toolHandler({ action: 'list', parameters: {} });

      // pseudoProjectIdToFilterId(-4) === -1 - (-4) === 3
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://api.vikunja.test/api/v1/filters/3',
        expect.objectContaining({ method: 'GET' }),
      );

      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 1 saved filter');
      expect(markdown).not.toContain('could not be fully resolved');
    });

    it('degrades gracefully when the computed filter id does not resolve', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: [{ id: -10, title: 'Unresolvable' }] }))
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      const result = await toolHandler({ action: 'list', parameters: {} });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 1 saved filter');
      expect(markdown).toContain('could not be fully resolved');
    });

    it('excludes real (positive-id) projects from the derived list', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ body: [{ id: 1, title: 'Real project' }, { id: 2, title: 'Another real project' }] }),
      );

      const result = await toolHandler({ action: 'list', parameters: {} });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 0 saved filters');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('filters by favorite when requested', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ body: [{ id: -1, title: 'A' }, { id: -2, title: 'B' }] }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 0, is_favorite: true }) }))
        .mockResolvedValueOnce(mockResponse({ body: savedFilter({ id: 1, is_favorite: false }) }));

      const result = await toolHandler({ action: 'list', parameters: { favorite: true } });
      const markdown = result.content[0].text;
      expect(markdown).toContain('Found 1 saved filter');
    });
  });

  describe('build action (local utility, no server call)', () => {
    it('builds a filter string from conditions without calling the API', async () => {
      const result = await toolHandler({
        action: 'build',
        parameters: {
          conditions: [
            { field: 'done', operator: '=', value: false },
            { field: 'priority', operator: '>=', value: 3 },
          ],
          groupOperator: '&&',
        },
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('Filter built successfully');
      expect(markdown).toContain('(done = false && priority >= 3)');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('builds OR conditions', async () => {
      const result = await toolHandler({
        action: 'build',
        parameters: {
          conditions: [
            { field: 'priority', operator: '=', value: 5 },
            { field: 'priority', operator: '=', value: 1 },
          ],
          groupOperator: '||',
        },
      });

      const markdown = result.content[0].text;
      expect(markdown).toContain('(priority = 5 || priority = 1)');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('validate action (local utility, no server call)', () => {
    it('validates a well-formed filter string', async () => {
      const result = await toolHandler({
        action: 'validate',
        parameters: { filter: 'done = false && priority >= 3' },
      });

      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Success/)).toBe(true);
      expect(markdown).toContain('Filter is valid');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an empty filter string', async () => {
      const result = await toolHandler({ action: 'validate', parameters: { filter: '' } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
    });
  });

  describe('error handling', () => {
    it('handles an unknown action', async () => {
      const result = await toolHandler({ action: 'nonsense', parameters: {} });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
      expect(markdown).toContain('Unknown action');
    });

    it('surfaces a network-level failure as an error response', async () => {
      // mockRejectedValue (not -Once): vikunjaRestRequest retries transient
      // failures a couple of times before giving up, so every attempt must
      // fail the same way or a later retry would hit the default (empty)
      // mock implementation instead.
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));

      const result = await toolHandler({ action: 'get', parameters: { id: 1 } });
      const markdown = result.content[0].text;
      expect(parseMarkdown(markdown).hasHeading(2, /Error/)).toBe(true);
    }, 15000);
  });

  describe('global read-only mode', () => {
    afterEach(() => {
      ConfigurationManager.reset();
    });

    it('rejects create/update/delete when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { action: 'create', parameters: { title: 'x' } }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { action: 'update', parameters: { id: 1 } }),
        ),
      ).toBe(true);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { action: 'delete', parameters: { id: 1 } }),
        ),
      ).toBe(true);
    });

    it('does not raise the read-only error for list/get/build/validate when readOnly is on', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: true } });

      expect(
        isReadOnlyRejection(await callAndCatch(toolHandler, { action: 'list', parameters: {} })),
      ).toBe(false);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { action: 'get', parameters: { id: 1 } }),
        ),
      ).toBe(false);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, {
            action: 'build',
            parameters: { conditions: [{ field: 'done', operator: '=', value: false }] },
          }),
        ),
      ).toBe(false);
      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, {
            action: 'validate',
            parameters: { filter: 'done = false' },
          }),
        ),
      ).toBe(false);
    });

    it('does not raise the read-only error for create when readOnly is off', async () => {
      ConfigurationManager.reset();
      ConfigurationManager.getInstance({ sources: { readOnly: false } });

      expect(
        isReadOnlyRejection(
          await callAndCatch(toolHandler, { action: 'create', parameters: { title: 'x' } }),
        ),
      ).toBe(false);
    });
  });
});
