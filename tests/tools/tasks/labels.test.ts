import { applyLabels, removeLabels, listTaskLabels } from '../../../src/tools/tasks/labels';
import { AuthManager } from '../../../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../../../src/utils/retry';
import { MCPError } from '../../../src/types/index';

// applyLabels/removeLabels/listTaskLabels drive every Vikunja call through the
// direct-REST helper (vikunjaRestRequest) now: the label-on-task endpoints for
// the writes, and GET /tasks/{id} (via getTaskViaRest) to refresh the task
// afterwards. There is no node-vikunja client involved any more, so the tests
// route a single mocked global fetch for all of it.

// Mock withRetry with a lightweight retry that HONORS the caller's shouldRetry
// predicate but skips the production backoff delays. This is deliberate: the
// #154 regression was that a non-auth 403 got retried and misclassified, so the
// tests must actually exercise the retry predicate and be able to assert call
// counts (e.g. "a 403 is attempted exactly once, a 401 is retried"). A plain
// pass-through mock hid that branch entirely.
jest.mock('../../../src/utils/retry', () => {
  const actual = jest.requireActual('../../../src/utils/retry');
  return {
    ...actual,
    withRetry: async <T>(
      operation: () => Promise<T>,
      options?: { maxRetries?: number; shouldRetry?: (error: unknown) => boolean },
    ): Promise<T> => {
      const maxRetries = options?.maxRetries ?? 0;
      const shouldRetry = options?.shouldRetry ?? (() => false);
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      for (;;) {
        try {
          return await operation();
        } catch (error) {
          if (attempt < maxRetries && shouldRetry(error)) {
            attempt += 1;
            continue;
          }
          throw error;
        }
      }
    },
  };
});

describe('Label operations', () => {
  let authManager: AuthManager;
  let fetchMock: jest.Mock;
  let originalFetch: typeof fetch;

  const restOk = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: jest.fn(async () => JSON.stringify(body)),
    }) as unknown as Response;

  const restError = (status: number, statusText: string, body = ''): Response =>
    ({
      ok: false,
      status,
      statusText,
      text: jest.fn(async () => body),
    }) as unknown as Response;

  beforeEach(() => {
    // Use resetAllMocks to also reset mock implementations (not just call history)
    jest.resetAllMocks();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Default: task has no labels yet, label writes succeed, and the GET
    // /tasks/{id} refresh returns a bare task (its content is not asserted).
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/labels')) {
        return Promise.resolve(restOk([]));
      }
      return Promise.resolve(restOk({}));
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('applyLabels', () => {
    it('should apply labels to a task successfully', async () => {
      const result = await applyLabels({ id: 1, labels: [1] }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ label_id: 1 }) }),
      );
      // The task is refreshed afterwards via GET /tasks/{id} (direct-REST).
      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('Label applied to task successfully');
    });

    it('should throw error if task id is missing', async () => {
      await expect(applyLabels({ labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should throw error if labels array is empty', async () => {
      await expect(applyLabels({ id: 1, labels: [] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle multiple labels', async () => {
      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(2);
      expect(result.content[0].text).toContain('Labels applied to task successfully');
    });

    it('should skip labels already present on the task', async () => {
      // Label 1 is already on the task; only label 2 should be applied.
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([{ id: 1, title: 'research' }]));
        }
        return Promise.resolve(restOk({}));
      });
      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(1);
      expect(putCalls[0]?.[1]).toMatchObject({ body: JSON.stringify({ label_id: 2 }) });
      expect(result.content[0].text).toContain('already present');
    });

    it('should not abort when a label is already on the task', async () => {
      // GET /labels reports nothing, but the first PUT races and rejects the
      // first label as a duplicate; the rest must still be applied.
      let putCalls = 0;
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        if (init?.method === 'PUT') {
          putCalls += 1;
          if (putCalls === 1) {
            return Promise.resolve(restError(400, 'Bad Request', 'This label already exists on the task'));
          }
          return Promise.resolve(restOk({}));
        }
        return Promise.resolve(restOk({}));
      });
      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      expect(putCalls).toBe(2);
      expect(result.content[0].text).toContain('Label applied to task successfully');
    });

    it('should report when every requested label is already present', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(
            restOk([
              { id: 1, title: 'research' },
              { id: 2, title: 'ops' },
            ]),
          );
        }
        return Promise.resolve(restOk({}));
      });
      const result = await applyLabels({ id: 1, labels: [1, 2] }, authManager);

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(0);
      expect(result.content[0].text).toContain('No labels applied');
    });

    it('should handle API errors gracefully', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        return Promise.resolve(restError(400, 'Bad Request', 'API Error'));
      });

      await expect(applyLabels({ id: 1, labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });

    it('surfaces a non-auth 403 on apply as the real error, not a retried auth failure', async () => {
      // #154 audit: a resource-level 403 must not be masked as an auth retry.
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        return Promise.resolve(restError(403, 'Forbidden'));
      });

      await expect(applyLabels({ id: 1, labels: [1] }, authManager)).rejects.toThrow(/HTTP 403/);

      // A resource 403 on apply is attempted once, not retried as auth.
      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(1);
    });

    it('still surfaces a genuine 401 on apply as an auth error, and DOES retry it', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'GET' && url.endsWith('/labels')) {
          return Promise.resolve(restOk([]));
        }
        return Promise.resolve(restError(401, 'Unauthorized'));
      });

      await expect(applyLabels({ id: 1, labels: [1] }, authManager)).rejects.toThrow(
        /Retried 3 times/,
      );

      const putCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'PUT',
      );
      expect(putCalls).toHaveLength(4);
    });
  });

  describe('applyLabels with labelTitles', () => {
    // These exercise the `labelTitles` get-or-create-and-attach path: each
    // title is resolved via ensureLabelByTitle (GET /labels?s=<title>, then
    // PUT /labels on a miss) before the resolved ids merge into the normal
    // apply-label flow. A dedicated router replaces the file's generic
    // beforeEach mock so GET .../labels?s=<title> (label search) is
    // distinguished from GET .../tasks/{id}/labels (current task labels).
    function routedFetchMock(opts: {
      existingLabelsByTitle?: Record<string, { id: number; title: string }>;
      nextCreatedId?: number;
      taskLabels?: Array<{ id: number; title: string }>;
    }): jest.Mock {
      const { existingLabelsByTitle = {}, taskLabels = [] } = opts;
      let nextId = opts.nextCreatedId ?? 100;
      return jest.fn((url: string, init?: RequestInit) => {
        const method = init?.method;
        const parsed = new URL(url);

        // Label title search: GET /labels?s=<title>
        if (method === 'GET' && parsed.pathname.endsWith('/labels') && parsed.searchParams.has('s')) {
          const searched = parsed.searchParams.get('s') ?? '';
          const match = Object.values(existingLabelsByTitle).find(
            (label) => label.title.toLowerCase() === searched.toLowerCase(),
          );
          return Promise.resolve(restOk(match ? [match] : []));
        }

        // Label create: PUT /labels (no query string)
        if (method === 'PUT' && parsed.pathname === '/api/v1/labels') {
          const body = JSON.parse((init?.body as string) ?? '{}') as { title: string };
          const created = { id: nextId, title: body.title };
          nextId += 1;
          return Promise.resolve(restOk(created));
        }

        // Current labels already on the task: GET /tasks/{id}/labels
        if (method === 'GET' && parsed.pathname.endsWith('/labels')) {
          return Promise.resolve(restOk(taskLabels));
        }

        // Apply a label to the task: PUT /tasks/{id}/labels
        if (method === 'PUT' && /\/tasks\/\d+\/labels$/.test(parsed.pathname)) {
          return Promise.resolve(restOk({}));
        }

        // Task refresh: GET /tasks/{id}
        return Promise.resolve(restOk({}));
      });
    }

    it('resolves a labelTitle to an existing label id, case-insensitively (reuse)', async () => {
      fetchMock = routedFetchMock({ existingLabelsByTitle: { bug: { id: 7, title: 'Bug' } } });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await applyLabels({ id: 1, labelTitles: ['bug'] }, authManager);

      // No PUT /labels (create) call — only the apply PUT.
      const createCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && new URL(url as string).pathname === '/api/v1/labels',
      );
      expect(createCalls).toHaveLength(0);
      const applyCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && /\/tasks\/1\/labels$/.test(url as string),
      );
      expect(applyCalls).toHaveLength(1);
      expect(JSON.parse((applyCalls[0]?.[1] as RequestInit).body as string)).toEqual({ label_id: 7 });
      expect(result.content[0].text).toContain('Label applied to task successfully');
      expect(result.content[0].text).toContain('reused');
      expect(result.content[0].text).toContain('Bug');
    });

    it('creates a new label for a labelTitle with no existing match, then attaches it', async () => {
      fetchMock = routedFetchMock({ nextCreatedId: 55 });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await applyLabels({ id: 1, labelTitles: ['Urgent'] }, authManager);

      const createCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && new URL(url as string).pathname === '/api/v1/labels',
      );
      expect(createCalls).toHaveLength(1);
      const applyCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && /\/tasks\/1\/labels$/.test(url as string),
      );
      expect(applyCalls).toHaveLength(1);
      expect(JSON.parse((applyCalls[0]?.[1] as RequestInit).body as string)).toEqual({ label_id: 55 });
      expect(result.content[0].text).toContain('created');
      expect(result.content[0].text).toContain('Urgent');
    });

    it('merges numeric labels and labelTitles, applying both', async () => {
      fetchMock = routedFetchMock({
        existingLabelsByTitle: { research: { id: 3, title: 'research' } },
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await applyLabels({ id: 1, labels: [9], labelTitles: ['research'] }, authManager);

      const applyCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && /\/tasks\/1\/labels$/.test(url as string),
      );
      expect(applyCalls).toHaveLength(2);
      const appliedIds = applyCalls
        .map(([, init]) => JSON.parse((init as RequestInit).body as string).label_id as number)
        .sort();
      expect(appliedIds).toEqual([3, 9]);
      expect(result.content[0].text).toContain('Labels applied to task successfully');
    });

    it('dedupes when a labelTitle resolves to an id already present in labels', async () => {
      fetchMock = routedFetchMock({
        existingLabelsByTitle: { research: { id: 9, title: 'research' } },
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const result = await applyLabels({ id: 1, labels: [9], labelTitles: ['research'] }, authManager);

      // id 9 appears both directly and via the resolved title — must only be
      // applied once.
      const applyCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          (init as RequestInit)?.method === 'PUT' && /\/tasks\/1\/labels$/.test(url as string),
      );
      expect(applyCalls).toHaveLength(1);
      expect(JSON.parse((applyCalls[0]?.[1] as RequestInit).body as string)).toEqual({ label_id: 9 });
      expect(result.content[0].text).toContain('Label applied to task successfully');
    });

    it('throws a validation error when neither labels nor labelTitles is provided', async () => {
      await expect(applyLabels({ id: 1 }, authManager)).rejects.toThrow(MCPError);
      await expect(applyLabels({ id: 1, labels: [], labelTitles: [] }, authManager)).rejects.toThrow(
        /label id.*label title|At least one/i,
      );
    });
  });

  describe('removeLabels', () => {
    it('should remove labels from a task successfully', async () => {
      const result = await removeLabels({ id: 1, labels: [1] }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels/1',
        expect.objectContaining({ method: 'DELETE' }),
      );
      expect(result.content[0].text).toContain('Label removed from task successfully');
    });

    it('should throw error if task id is missing', async () => {
      await expect(removeLabels({ labels: [1] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should throw error if labels array is empty', async () => {
      await expect(removeLabels({ id: 1, labels: [] }, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle multiple labels removal', async () => {
      const result = await removeLabels({ id: 1, labels: [1, 2] }, authManager);

      const deleteCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(2);
      expect(result.content[0].text).toContain('Labels removed from task successfully');
    });

    it('treats removing a label that is not attached as an idempotent no-op (Vikunja 403)', async () => {
      // Regression for #154: Vikunja returns 403 when the label is not attached
      // to the task. The old code misclassified that as an auth failure, retried
      // 3×, and surfaced a misleading "(Retried 3 times)" error.
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method;
        if (method === 'DELETE') return Promise.resolve(restError(403, 'Forbidden'));
        // Reconcile: the label is genuinely not attached.
        if (url.endsWith('/tasks/1/labels')) return Promise.resolve(restOk([]));
        return Promise.resolve(restOk({}));
      });

      const result = await removeLabels({ id: 1, labels: [25] }, authManager);
      const text = result.content[0].text;
      expect(text).toContain('already not attached');
      expect(text).not.toContain('Retried');

      // The crux of #154: a non-auth 403 must be attempted exactly ONCE, never
      // retried. The old code retried it 3× (4 calls) before failing.
      const deleteCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(1);
    });

    it('reports a clear, task/label-specific error when a label is still attached after a failed removal', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method;
        if (method === 'DELETE') return Promise.resolve(restError(403, 'Forbidden'));
        // Reconcile: the label is STILL attached (e.g. no write access).
        if (url.endsWith('/tasks/1/labels')) return Promise.resolve(restOk([{ id: 25 }]));
        return Promise.resolve(restOk({}));
      });

      await expect(removeLabels({ id: 1, labels: [25] }, authManager)).rejects.toThrow(
        /Could not remove label 25 from task 1/,
      );
    });

    it('still surfaces a genuine 401 as an auth error, and DOES retry it', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return Promise.resolve(restError(401, 'Unauthorized'));
        return Promise.resolve(restOk({}));
      });

      await expect(removeLabels({ id: 1, labels: [1] }, authManager)).rejects.toThrow(
        /Retried 3 times/,
      );

      // A genuine 401 is still retried (1 initial + 3 retries): the fix narrows
      // WHICH statuses count as auth, it does not weaken real auth handling.
      const deleteCalls = fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit)?.method === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(4);
    });

    it('removes attached labels while skipping ones already absent', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method;
        if (method === 'DELETE' && url.endsWith('/labels/25')) {
          return Promise.resolve(restError(403, 'Forbidden'));
        }
        if (method === 'DELETE') return Promise.resolve(restOk({})); // label 1 removed
        if (url.endsWith('/tasks/1/labels')) return Promise.resolve(restOk([])); // neither attached now
        return Promise.resolve(restOk({}));
      });

      const result = await removeLabels({ id: 1, labels: [1, 25] }, authManager);
      const text = result.content[0].text;
      expect(text).toContain('Label removed from task successfully');
      expect(text).toContain('1 already not attached, skipped');
    });

    it('reports failure when a removal fails and the current labels cannot be reconciled', async () => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        const method = init?.method;
        if (method === 'DELETE') return Promise.resolve(restError(403, 'Forbidden'));
        // Reconcile GET itself fails — fall back to trusting the failed DELETE.
        if (url.endsWith('/tasks/1/labels')) return Promise.resolve(restError(500, 'Server Error'));
        return Promise.resolve(restOk({}));
      });

      await expect(removeLabels({ id: 1, labels: [25] }, authManager)).rejects.toThrow(
        /Could not remove label 25 from task 1/,
      );
    });
  });

  describe('listTaskLabels', () => {
    it('should list labels for a task successfully', async () => {
      fetchMock.mockResolvedValue(restOk([{ id: 1, title: 'research', hex_color: '3498db' }]));
      const result = await listTaskLabels({ id: 1 }, authManager);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://vikunja.test/api/v1/tasks/1/labels',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result.content[0].text).toContain('Task has 1 label(s)');
    });

    it('should throw error if task id is missing', async () => {
      await expect(listTaskLabels({}, authManager)).rejects.toThrow(MCPError);
    });

    it('should handle task with no labels', async () => {
      fetchMock.mockResolvedValue(restOk([]));
      const result = await listTaskLabels({ id: 1 }, authManager);

      expect(result.content[0].text).toContain('Task has 0 label(s)');
    });

    it('should handle undefined task id', async () => {
      await expect(listTaskLabels({ id: undefined }, authManager)).rejects.toThrow(MCPError);
    });
  });
});
