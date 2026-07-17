/**
 * Tests for the direct Vikunja REST helper.
 *
 * Covers vikunjaRestRequest (URL normalization, body handling, HTTP errors,
 * network errors, empty/non-JSON bodies), resolveKanbanViewId, retry
 * behavior, named circuit breaker grouping/opening, and the multipart
 * variant used by the attach subcommand.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { AuthManager } from '../../src/auth/AuthManager';
import {
  vikunjaRestRequest,
  vikunjaRestMultipartRequest,
  resolveKanbanViewId,
  deriveRestBreakerName,
} from '../../src/utils/vikunja-rest';
import { MCPError, ErrorCode } from '../../src/types';
import { circuitBreakerRegistry } from '../../src/utils/retry';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/**
 * Builds a minimal Response-like object good enough for vikunjaRestRequest,
 * which only reads `.ok`, `.status`, `.statusText` and `.text()`.
 */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  text?: string;
  textThrows?: boolean;
}): Response {
  const {
    ok = true,
    status = 200,
    statusText = 'OK',
    text = '',
    textThrows = false,
  } = opts;
  return {
    ok,
    status,
    statusText,
    text: textThrows
      ? jest.fn(async () => {
          throw new Error('stream read error');
        })
      : jest.fn(async () => text),
  } as unknown as Response;
}

describe('vikunja-rest helper', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    // The circuit breaker registry in `../../src/utils/retry` is a
    // process-wide singleton keyed by breaker name, and many tests below
    // reuse the same path (so the same auto-derived breaker name) with a
    // deliberately failing response. Without clearing accumulated
    // stats/open-state between tests, a handful of consecutive failures
    // trips the breaker open and every later test in this file starts
    // failing with "Breaker is open" instead of exercising its own
    // scenario. `resetAll()` alone isn't enough — it only closes an open
    // breaker, it doesn't forget the failure counts that got it there.
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('vikunjaRestRequest', () => {
    it('performs a GET request and parses the JSON body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 7 }) }));

      const result = await vikunjaRestRequest(authManager, 'GET', '/tasks/7');

      expect(result).toEqual({ id: 7 });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      // apiUrl had no /api/v1 prefix, so it must have been appended.
      expect(url).toBe('https://vikunja.test/api/v1/tasks/7');
      expect(init.method).toBe('GET');
      expect((init.headers as Record<string, string>).Authorization).toBe(
        'Bearer tk_test-token',
      );
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json',
      );
      // No body when none is supplied.
      expect(init.body).toBeUndefined();
    });

    it('serializes the body as JSON when one is provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      await vikunjaRestRequest(authManager, 'POST', '/things', { a: 1 });

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('POST');
      expect(init.body).toBe(JSON.stringify({ a: 1 }));
    });

    it('does not normalize an apiUrl that already includes the /api/v1 prefix', async () => {
      authManager = new AuthManager();
      authManager.connect('https://vikunja.test/api/v1', 'tk_token');
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await vikunjaRestRequest(authManager, 'GET', '/projects/4/views');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/projects/4/views');
    });

    it('strips a trailing slash from the apiUrl before building the URL', async () => {
      authManager = new AuthManager();
      authManager.connect('https://vikunja.test/', 'tk_token');
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await vikunjaRestRequest(authManager, 'GET', '/projects');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/projects');
    });

    it('recognizes an /api/v2 versioned root', async () => {
      authManager = new AuthManager();
      authManager.connect('https://vikunja.test/api/v2', 'tk_token');
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '[]' }));

      await vikunjaRestRequest(authManager, 'GET', '/projects');

      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v2/projects');
    });

    it('returns null when the response body is empty', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      const result = await vikunjaRestRequest(authManager, 'GET', '/empty');

      expect(result).toBeNull();
    });

    it('returns null when the response body is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: 'not json at all' }));

      const result = await vikunjaRestRequest(authManager, 'GET', '/weird');

      expect(result).toBeNull();
    });

    it('throws an MCPError when fetch rejects (network error)', async () => {
      // Persistent rejection: this test makes two assertion calls. Retry is
      // disabled since this test is about the MCPError wrapping/message,
      // not retry behavior (which has its own dedicated tests below) — the
      // message itself ("connection refused") would otherwise be retried
      // by the default policy, and each retry attempt fires the breaker
      // again, risking it tripping open partway through this test.
      mockFetch.mockRejectedValue(new Error('connection refused'));
      const noRetry = { retry: { maxRetries: 0 } };

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, noRetry),
      ).rejects.toThrow(MCPError);
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, noRetry),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1): connection refused',
      );
    });

    it('includes the error code API_ERROR on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('boom'));

      try {
        await vikunjaRestRequest(authManager, 'GET', '/tasks/1');
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).code).toBe(ErrorCode.API_ERROR);
      }
    });

    it('stringifies a non-Error rejection value', async () => {
      mockFetch.mockRejectedValueOnce('plain string failure');

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1'),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1): plain string failure',
      );
    });

    it('throws an MCPError with the response detail when the response is not OK', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 404,
          statusText: 'Not Found',
          text: 'task does not exist',
        }),
      );

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/999'),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/999): HTTP 404 Not Found — task does not exist',
      );
    });

    it('omits the detail suffix when the error body is empty', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: '',
        }),
      );

      // A bare 500 is retryable by default; disable retry here since this
      // test is about the message formatting, not retry behavior (which
      // has its own dedicated tests below).
      try {
        await vikunjaRestRequest(authManager, 'POST', '/things', undefined, {
          retry: { maxRetries: 0 },
        });
        throw new Error('should have thrown');
      } catch (error) {
        expect((error as MCPError).message).toBe(
          'Vikunja REST request failed (POST /things): HTTP 500 Internal Server Error',
        );
      }
    });

    it('truncates an oversized error body to 500 characters', async () => {
      const longBody = 'x'.repeat(2000);
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: longBody,
        }),
      );

      try {
        await vikunjaRestRequest(authManager, 'GET', '/tasks/1');
        throw new Error('should have thrown');
      } catch (error) {
        const message = (error as MCPError).message;
        // 500 chars of 'x' should be present, but not the full 2000.
        expect(message).toContain('x'.repeat(500));
        expect(message).not.toContain('x'.repeat(501));
      }
    });

    it('attaches the HTTP status code to the thrown MCPError details', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: 'invalid token',
        }),
      );

      try {
        await vikunjaRestRequest(authManager, 'GET', '/webhooks/events');
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).details?.statusCode).toBe(401);
      }
    });

    it('falls back to the status line when the error body cannot be read', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          ok: false,
          status: 502,
          statusText: 'Bad Gateway',
          textThrows: true,
        }),
      );

      // 502 is retryable by default; disable retry since this test targets
      // the "body unreadable" fallback message, not retry behavior.
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, {
          retry: { maxRetries: 0 },
        }),
      ).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1): HTTP 502 Bad Gateway',
      );
    });
  });

  describe('resolveKanbanViewId', () => {
    it('returns the id of the Kanban view when one exists', async () => {
      const views = [
        { id: 10, title: 'List', project_id: 4, view_kind: 'list' },
        { id: 11, title: 'Kanban', project_id: 4, view_kind: 'kanban' },
        { id: 12, title: 'Gantt', project_id: 4, view_kind: 'gantt' },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(views) }));

      const viewId = await resolveKanbanViewId(authManager, 4);

      expect(viewId).toBe(11);
      const [url] = mockFetch.mock.calls[0] as [string];
      expect(url).toBe('https://vikunja.test/api/v1/projects/4/views');
    });

    it('throws NOT_FOUND when the project has no Kanban view', async () => {
      const views = [{ id: 10, title: 'List', project_id: 4, view_kind: 'list' }];
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(views) }));

      await expect(resolveKanbanViewId(authManager, 4)).rejects.toThrow(
        new MCPError(
          ErrorCode.NOT_FOUND,
          'Project 4 has no Kanban view, so it has no buckets',
        ),
      );
    });

    it('throws NOT_FOUND when the views response is not an array', async () => {
      // A 2xx non-JSON body resolves to null inside vikunjaRestRequest.
      mockFetch.mockResolvedValueOnce(mockResponse({ text: '' }));

      try {
        await resolveKanbanViewId(authManager, 9);
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).code).toBe(ErrorCode.NOT_FOUND);
        expect((error as MCPError).message).toBe(
          'Project 9 has no Kanban view, so it has no buckets',
        );
      }
    });

    it('propagates an MCPError raised by the underlying request', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 403, statusText: 'Forbidden', text: 'nope' }),
      );

      await expect(resolveKanbanViewId(authManager, 4)).rejects.toThrow(MCPError);
    });
  });

  describe('deriveRestBreakerName', () => {
    it('groups by the first two non-numeric path segments', () => {
      expect(deriveRestBreakerName('/webhooks/events')).toBe('vikunja-rest-webhooks-events');
      expect(deriveRestBreakerName('/projects/4/webhooks')).toBe(
        'vikunja-rest-projects-webhooks',
      );
      expect(deriveRestBreakerName('/tasks/7')).toBe('vikunja-rest-tasks');
      expect(deriveRestBreakerName('/teams/3/members/alice')).toBe('vikunja-rest-teams-members');
    });

    it('falls back to "root" for a path with no non-numeric segments', () => {
      expect(deriveRestBreakerName('/42')).toBe('vikunja-rest-root');
    });
  });

  describe('retry behavior', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('retries a transient network error and succeeds', async () => {
      // Real fetch() failures carry the actual cause code on `.code` (or
      // nested in `.cause.code` for undici); a bare `new Error('ECONNRESET')`
      // with no such property is NOT what a real network failure looks
      // like and must not be treated as retryable by coincidence of its
      // message text.
      const connReset = Object.assign(new Error('read ECONNRESET'), {
        code: 'ECONNRESET',
      });
      mockFetch
        .mockRejectedValueOnce(connReset)
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ ok: true }) }));

      const promise = vikunjaRestRequest(authManager, 'GET', '/tasks/1');
      // Default JSON retry initialDelay is 250ms.
      await jest.advanceTimersByTimeAsync(250);

      await expect(promise).resolves.toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry a network error with no recognizable transient signal', async () => {
      mockFetch.mockRejectedValueOnce(new Error('boom'));

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1'),
      ).rejects.toThrow('boom');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries a network error surfaced via a nested `.cause.code` (undici fetch shape)', async () => {
      const fetchFailed = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
      });
      mockFetch
        .mockRejectedValueOnce(fetchFailed)
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ ok: true }) }));

      const promise = vikunjaRestRequest(authManager, 'GET', '/tasks/1');
      await jest.advanceTimersByTimeAsync(250);

      await expect(promise).resolves.toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries a 500 response up to the configured maxRetries, then throws', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', text: '' }),
      );

      const promise = vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, {
        retry: { maxRetries: 2, initialDelay: 10, maxDelay: 20 },
      });
      promise.catch(() => {});

      await jest.advanceTimersByTimeAsync(10);
      await jest.advanceTimersByTimeAsync(20);

      await expect(promise).rejects.toThrow(
        'Vikunja REST request failed (GET /tasks/1): HTTP 500 Internal Server Error',
      );
      // Initial attempt + 2 retries.
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not retry a 404 (non-retryable) response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 404, statusText: 'Not Found', text: '' }),
      );

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1'),
      ).rejects.toThrow('HTTP 404');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry a 401 by default, so getValidEvents-style callers fail fast into their fallback', async () => {
      // Mirrors docs/VIKUNJA_API_ISSUES.md #8: /webhooks/events can return
      // 401 with an otherwise-valid token. Retrying would only add latency
      // before webhooks.ts's getValidEvents falls back to its default list.
      mockFetch.mockResolvedValueOnce(
        mockResponse({ ok: false, status: 401, statusText: 'Unauthorized', text: '' }),
      );

      try {
        await vikunjaRestRequest(authManager, 'GET', '/webhooks/events');
        throw new Error('should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MCPError);
        expect((error as MCPError).details?.statusCode).toBe(401);
      }
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('named circuit breaker', () => {
    it('opens after repeated failures and fails fast without calling fetch again', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', text: '' }),
      );
      const opts = {
        breakerName: 'test-breaker-opens',
        retry: {
          maxRetries: 0,
          errorThresholdPercentage: 1,
          volumeThreshold: 2,
          resetTimeout: 60_000,
        },
      };

      // Two failing calls trip the breaker (volumeThreshold met, 100% > 1%).
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, opts),
      ).rejects.toThrow('HTTP 500');
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, opts),
      ).rejects.toThrow('HTTP 500');
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // The breaker is now open: a third call fails immediately with the
      // breaker's own error, and never reaches fetch again.
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/tasks/1', undefined, opts),
      ).rejects.toThrow('Breaker is open');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('keeps an unrelated endpoint group healthy while another groups breaker is open', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', text: '' }),
      );
      const failingOpts = {
        breakerName: 'test-breaker-group-a',
        retry: { maxRetries: 0, errorThresholdPercentage: 1, volumeThreshold: 1 },
      };

      await expect(
        vikunjaRestRequest(authManager, 'GET', '/a', undefined, failingOpts),
      ).rejects.toThrow('HTTP 500');
      // Group A's breaker is now open.
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/a', undefined, failingOpts),
      ).rejects.toThrow('Breaker is open');

      // A different, healthy endpoint group is unaffected.
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ ok: true }) }));
      await expect(
        vikunjaRestRequest(authManager, 'GET', '/b', undefined, {
          breakerName: 'test-breaker-group-b',
        }),
      ).resolves.toEqual({ ok: true });
    });
  });

  describe('vikunjaRestMultipartRequest', () => {
    const makeForm = (): FormData => {
      const form = new FormData();
      form.append('files', new Blob(['hi']), 'hi.txt');
      return form;
    };

    it('PUTs the form without a Content-Type header and parses the JSON response', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ success: [{ id: 1 }] }) }),
      );

      const form = makeForm();
      const result = await vikunjaRestMultipartRequest(
        authManager,
        'PUT',
        '/tasks/42/attachments',
        form,
      );

      expect(result).toEqual({ success: [{ id: 1 }] });
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://vikunja.test/api/v1/tasks/42/attachments');
      expect(init.method).toBe('PUT');
      expect(init.body).toBe(form);
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tk_test-token');
      expect(headers['Content-Type']).toBeUndefined();
    });

    it('does not retry on failure by default (unlike the JSON variant)', async () => {
      mockFetch.mockResolvedValue(
        mockResponse({ ok: false, status: 500, statusText: 'Internal Server Error', text: '' }),
      );

      await expect(
        vikunjaRestMultipartRequest(authManager, 'PUT', '/tasks/1/attachments', makeForm()),
      ).rejects.toThrow(
        'Vikunja REST request failed (PUT /tasks/1/attachments): HTTP 500 Internal Server Error',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('honors an explicit retry override', async () => {
      jest.useFakeTimers();
      try {
        const connReset = Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
        });
        mockFetch
          .mockRejectedValueOnce(connReset)
          .mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ success: [] }) }));

        const promise = vikunjaRestMultipartRequest(
          authManager,
          'PUT',
          '/tasks/1/attachments',
          makeForm(),
          { retry: { maxRetries: 1, initialDelay: 10 } },
        );
        await jest.advanceTimersByTimeAsync(10);

        await expect(promise).resolves.toEqual({ success: [] });
        expect(mockFetch).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('wraps a network error as an MCPError', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(
        vikunjaRestMultipartRequest(authManager, 'PUT', '/tasks/1/attachments', makeForm()),
      ).rejects.toThrow(
        'Vikunja REST request failed (PUT /tasks/1/attachments): ECONNREFUSED',
      );
    });
  });
});
