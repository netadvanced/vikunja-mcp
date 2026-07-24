/**
 * Tests for the `setup-kanban` composite (`setupKanban`,
 * src/tools/projects/kanban-setup.ts).
 *
 * Covers: validation, the new-project happy path (project + view + ordered
 * buckets + placed tasks), existing-project reuse (exact-title match reuse,
 * leftover-bucket rename, no duplicate buckets), an unknown column name on
 * a task, partial task-creation failure (honest per-task reporting), the
 * date-only -> RFC3339 normalization end to end, and the bucket ordering
 * guarantee (explicit `position` pinned to each column's requested index
 * regardless of a reused/renamed bucket's original position).
 *
 * Uses a tiny path+method router around the mocked global `fetch` (rather
 * than ordinal `mockResolvedValueOnce` chaining, as this composite issues
 * many REST calls whose count/order legitimately varies by scenario) so
 * each test only needs to declare the endpoints it cares about.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { setupKanban } from '../../../src/tools/projects/kanban-setup';
import { MCPError, ErrorCode } from '../../../src/types';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

const BASE = 'https://vikunja.test/api/v1';

interface RouteHandler {
  method: string;
  match: (path: string) => boolean;
  respond: (path: string, body: unknown, callIndex: number) => unknown;
}

interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

function jsonResponse(body: unknown, opts: { ok?: boolean; status?: number; statusText?: string } = {}): Response {
  const { ok = true, status = 200, statusText = 'OK' } = opts;
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

function createRouter(): {
  fetchImpl: jest.Mock;
  calls: RecordedCall[];
  on: (method: string, match: RegExp | string, respond: RouteHandler['respond']) => void;
} {
  const handlers: RouteHandler[] = [];
  const calls: RecordedCall[] = [];
  let matchedCount = 0;

  const fetchImpl = jest.fn(async (url: unknown, init?: { method?: string; body?: unknown }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = String(url).replace(BASE, '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ method, path, body });

    for (const h of handlers) {
      if (h.method === method && h.match(path)) {
        matchedCount += 1;
        const result = h.respond(path, body, matchedCount);
        if (result && typeof result === 'object' && 'ok' in result) {
          return result as Response;
        }
        return jsonResponse(result);
      }
    }
    throw new Error(`Unmocked request in test: ${method} ${path}`);
  });

  return {
    fetchImpl,
    calls,
    on(method, match, respond) {
      handlers.push({
        method,
        match: typeof match === 'string' ? (p) => p === match : (p) => match.test(p),
        respond,
      });
    },
  };
}

describe('setupKanban', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  describe('validation', () => {
    it('throws when columns is missing', async () => {
      await expect(setupKanban({ title: 'Board' }, authManager)).rejects.toThrow(
        'columns is required for setup-kanban operation',
      );
    });

    it('throws when columns is empty', async () => {
      await expect(setupKanban({ title: 'Board', columns: [] }, authManager)).rejects.toThrow(
        'columns is required for setup-kanban operation',
      );
    });

    it('throws when a column entry is blank', async () => {
      await expect(
        setupKanban({ title: 'Board', columns: ['To Do', '   '] }, authManager),
      ).rejects.toThrow('Every entry in columns must be a non-empty string.');
    });

    it('throws when neither id nor title is provided', async () => {
      await expect(setupKanban({ columns: ['To Do'] }, authManager)).rejects.toThrow(
        'Either id (an existing project to set up the board on) or title',
      );
    });

    it('throws when a task has a blank title', async () => {
      await expect(
        setupKanban(
          { title: 'Board', columns: ['To Do'], tasks: [{ title: '  ' }] },
          authManager,
        ),
      ).rejects.toThrow('tasks[0].title is required');
    });

    it('throws when there are too many tasks', async () => {
      const tasks = Array.from({ length: 101 }, (_, i) => ({ title: `task-${i}` }));
      await expect(
        setupKanban({ title: 'Board', columns: ['To Do'], tasks }, authManager),
      ).rejects.toThrow('Too many tasks for setup-kanban');
    });
  });

  describe('new project happy path', () => {
    it('creates the project, view-resolves the Kanban view, creates buckets in order, and creates+places tasks', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 501, title: 'Q3 Offsite' }));
      router.on('GET', '/projects/501/views', () => [
        { id: 10, title: 'List', project_id: 501, view_kind: 'list' },
        { id: 11, title: 'Kanban', project_id: 501, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/501/views/11/buckets', () => []);

      let bucketCounter = 900;
      router.on('PUT', '/projects/501/views/11/buckets', (_p, body) => {
        bucketCounter += 1;
        const b = body as { title: string; position?: number };
        return { id: bucketCounter, title: b.title, position: b.position };
      });

      const createdTasks = new Map<number, Record<string, unknown>>();
      let taskCounter = 2000;
      router.on('PUT', '/projects/501/tasks', (_p, body) => {
        taskCounter += 1;
        const task = { id: taskCounter, project_id: 501, ...(body as Record<string, unknown>) };
        createdTasks.set(taskCounter, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => {
        const id = Number(path.split('/')[2]);
        return createdTasks.get(id);
      });
      router.on('POST', /^\/projects\/501\/views\/11\/buckets\/\d+\/tasks$/, () => ({}));

      const result = await setupKanban(
        {
          title: 'Q3 Offsite',
          columns: ['To Do', 'Doing', 'Done'],
          tasks: [
            { title: 'Book venue', column: 'To Do', priority: 3 },
            { title: 'Send invites', column: 'Doing' },
            { title: 'Wrap up', column: 'Done' },
          ],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup completed');
      expect(text).toContain('**projectCreated:** true');
      expect(text).toContain('3/3 columns ready');
      expect(text).toContain('3/3 tasks created');

      // Buckets created in requested order with explicit, index-based positions.
      const bucketCreateCalls = router.calls.filter(
        (c) => c.method === 'PUT' && c.path === '/projects/501/views/11/buckets',
      );
      expect(bucketCreateCalls).toHaveLength(3);
      expect((bucketCreateCalls[0]?.body as { title: string; position: number }).title).toBe('To Do');
      expect((bucketCreateCalls[0]?.body as { title: string; position: number }).position).toBe(0);
      expect((bucketCreateCalls[1]?.body as { title: string; position: number }).title).toBe('Doing');
      expect((bucketCreateCalls[1]?.body as { title: string; position: number }).position).toBe(1);
      expect((bucketCreateCalls[2]?.body as { title: string; position: number }).title).toBe('Done');
      expect((bucketCreateCalls[2]?.body as { title: string; position: number }).position).toBe(2);

      // Every task got placed via the move endpoint.
      const moveCalls = router.calls.filter((c) => /\/buckets\/\d+\/tasks$/.test(c.path) && c.method === 'POST');
      expect(moveCalls).toHaveLength(3);
    });
  });

  describe('existing project reuse', () => {
    it('reuses an exact-title-matching bucket and renames a leftover bucket instead of creating duplicates', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('GET', '/projects/77/views', () => [
        { id: 20, title: 'Kanban', project_id: 77, view_kind: 'kanban' },
      ]);
      // Existing buckets: "Done" (exact match for the requested "Done"
      // column) and "Backlog" (a leftover default bucket matching none of
      // the requested column names).
      router.on('GET', '/projects/77/views/20/buckets', () => [
        { id: 301, title: 'Backlog', position: 0 },
        { id: 302, title: 'Done', position: 1 },
      ]);

      router.on('POST', /^\/projects\/77\/views\/20\/buckets\/\d+$/, (path, body) => {
        const id = Number(path.split('/').pop());
        return { id, ...(body as Record<string, unknown>) };
      });
      let bucketCounter = 900;
      router.on('PUT', '/projects/77/views/20/buckets', (_p, body) => {
        bucketCounter += 1;
        const b = body as { title: string; position?: number };
        return { id: bucketCounter, title: b.title, position: b.position };
      });

      const result = await setupKanban(
        { id: 77, columns: ['To Do', 'Doing', 'Done'] },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('project 77 reused');
      expect(text).toContain('3/3 columns ready');

      // No project was created.
      expect(router.calls.some((c) => c.method === 'PUT' && c.path === '/projects')).toBe(false);

      // "Done" was reused (POST to its own bucket id, not a PUT create).
      const doneUpdate = router.calls.find(
        (c) => c.method === 'POST' && c.path === '/projects/77/views/20/buckets/302',
      );
      expect(doneUpdate).toBeDefined();

      // "Backlog" (id 301) was renamed to "To Do" (the first unmatched column) — a POST update, not a new bucket.
      const backlogRename = router.calls.find(
        (c) => c.method === 'POST' && c.path === '/projects/77/views/20/buckets/301',
      );
      expect(backlogRename).toBeDefined();
      expect((backlogRename?.body as { title?: string }).title).toBe('To Do');

      // Only ONE brand-new bucket was created ("Doing" — no existing bucket left to reuse).
      const created = router.calls.filter((c) => c.method === 'PUT' && c.path === '/projects/77/views/20/buckets');
      expect(created).toHaveLength(1);
      expect((created[0]?.body as { title: string }).title).toBe('Doing');
    });
  });

  describe('unknown column name on a task', () => {
    it('creates the task but reports created-not-placed with a clear reason', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 55, title: 'Board' }));
      router.on('GET', '/projects/55/views', () => [
        { id: 12, title: 'Kanban', project_id: 55, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/55/views/12/buckets', () => []);
      let bucketCounter = 800;
      router.on('PUT', '/projects/55/views/12/buckets', (_p, body) => {
        bucketCounter += 1;
        return { id: bucketCounter, ...(body as Record<string, unknown>) };
      });

      const createdTasks = new Map<number, Record<string, unknown>>();
      let taskCounter = 3000;
      router.on('PUT', '/projects/55/tasks', (_p, body) => {
        taskCounter += 1;
        const task = { id: taskCounter, project_id: 55, ...(body as Record<string, unknown>) };
        createdTasks.set(taskCounter, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));

      const result = await setupKanban(
        {
          title: 'Board',
          columns: ['To Do', 'Done'],
          tasks: [{ title: 'Mystery task', column: 'Review' }],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup partially completed');
      expect(text).toContain('Created but not placed');
      expect(text).toContain('is not one of the requested columns');
      expect(text).toContain('Mystery task');

      // The task was still created — no move call was ever attempted.
      const moveCalls = router.calls.filter((c) => /\/buckets\/\d+\/tasks$/.test(c.path));
      expect(moveCalls).toHaveLength(0);
    });
  });

  describe('partial task failure', () => {
    it('reports one failed task while the others succeed', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 66, title: 'Board' }));
      router.on('GET', '/projects/66/views', () => [
        { id: 13, title: 'Kanban', project_id: 66, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/66/views/13/buckets', () => []);
      let bucketCounter = 700;
      router.on('PUT', '/projects/66/views/13/buckets', (_p, body) => {
        bucketCounter += 1;
        return { id: bucketCounter, ...(body as Record<string, unknown>) };
      });

      const createdTasks = new Map<number, Record<string, unknown>>();
      let taskCounter = 4000;
      router.on('PUT', '/projects/66/tasks', (_p, body) => {
        const b = body as { title: string };
        if (b.title === 'Bad task') {
          // 400, not 500 — avoids retry-driven wall-clock delay in this test.
          return jsonResponse('bad request', { ok: false, status: 400, statusText: 'Bad Request' });
        }
        taskCounter += 1;
        const task = { id: taskCounter, project_id: 66, ...b };
        createdTasks.set(taskCounter, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));
      router.on('POST', /^\/projects\/66\/views\/13\/buckets\/\d+\/tasks$/, () => ({}));

      const result = await setupKanban(
        {
          title: 'Board',
          columns: ['To Do'],
          tasks: [
            { title: 'Good task 1', column: 'To Do' },
            { title: 'Bad task', column: 'To Do' },
            { title: 'Good task 2', column: 'To Do' },
          ],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup partially completed');
      expect(text).toContain('2/3 tasks created');
      expect(text).toContain('Failed tasks');
      expect(text).toContain('#1 "Bad task"');
      expect(text).toContain('**Failures**');
      expect(text).toContain('"index": 1');
    });
  });

  describe('date-only dates', () => {
    it('normalizes a date-only dueDate to RFC3339 midnight UTC before sending it', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 88, title: 'Board' }));
      router.on('GET', '/projects/88/views', () => [
        { id: 14, title: 'Kanban', project_id: 88, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/88/views/14/buckets', () => []);
      router.on('PUT', '/projects/88/views/14/buckets', (_p, body) => ({ id: 901, ...(body as Record<string, unknown>) }));

      const createdTasks = new Map<number, Record<string, unknown>>();
      router.on('PUT', '/projects/88/tasks', (_p, body) => {
        const task = { id: 5001, project_id: 88, ...(body as Record<string, unknown>) };
        createdTasks.set(5001, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));
      router.on('POST', /^\/projects\/88\/views\/14\/buckets\/\d+\/tasks$/, () => ({}));

      await setupKanban(
        {
          title: 'Board',
          columns: ['To Do'],
          tasks: [{ title: 'Ship it', column: 'To Do', dueDate: '2026-09-01' }],
        },
        authManager,
      );

      const createCall = router.calls.find((c) => c.method === 'PUT' && c.path === '/projects/88/tasks');
      expect((createCall?.body as { due_date?: string }).due_date).toBe('2026-09-01T00:00:00Z');
    });
  });

  describe('ordering guarantee', () => {
    it('pins position to the requested column index even when reusing buckets in a different original order', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('GET', '/projects/99/views', () => [
        { id: 15, title: 'Kanban', project_id: 99, view_kind: 'kanban' },
      ]);
      // Existing buckets are in the OPPOSITE order of the requested columns.
      router.on('GET', '/projects/99/views/15/buckets', () => [
        { id: 401, title: 'Done', position: 0 },
        { id: 402, title: 'To Do', position: 1 },
      ]);
      router.on('POST', /^\/projects\/99\/views\/15\/buckets\/\d+$/, (path, body) => {
        const id = Number(path.split('/').pop());
        return { id, ...(body as Record<string, unknown>) };
      });

      const result = await setupKanban({ id: 99, columns: ['To Do', 'Done'] }, authManager);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('2/2 columns ready');

      const toDoUpdate = router.calls.find(
        (c) => c.method === 'POST' && c.path === '/projects/99/views/15/buckets/402',
      );
      const doneUpdate = router.calls.find(
        (c) => c.method === 'POST' && c.path === '/projects/99/views/15/buckets/401',
      );
      // "To Do" is requested column index 0, "Done" is index 1 — regardless
      // of their original positions (1 and 0, respectively) above.
      expect((toDoUpdate?.body as { position?: number }).position).toBe(0);
      expect((doneUpdate?.body as { position?: number }).position).toBe(1);
    });
  });

  describe('total column failure', () => {
    it('throws when every requested column fails to resolve', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 111, title: 'Board' }));
      router.on('GET', '/projects/111/views', () => [
        { id: 16, title: 'Kanban', project_id: 111, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/111/views/16/buckets', () => []);
      // 400 (not 500/429) so the retry loop doesn't add wall-clock delay —
      // this test only cares that every column fails, not the status code.
      router.on('PUT', '/projects/111/views/16/buckets', () =>
        jsonResponse('bad request', { ok: false, status: 400, statusText: 'Bad Request' }),
      );

      let caught: unknown;
      try {
        await setupKanban({ title: 'Board', columns: ['To Do', 'Doing'] }, authManager);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MCPError);
      expect((caught as MCPError).message).toMatch(/Kanban setup failed/);
    });
  });

  describe('missing Kanban view', () => {
    it('propagates a clear NOT_FOUND error when the existing project has no Kanban view', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('GET', '/projects/44/views', () => [
        { id: 1, title: 'List', project_id: 44, view_kind: 'list' },
      ]);

      await expect(setupKanban({ id: 44, columns: ['To Do'] }, authManager)).rejects.toThrow(
        'Project 44 has no Kanban view',
      );
    });
  });

  describe('label resolution and task fields', () => {
    it('resolves label titles via ensureLabelByTitle and creates a task with no column (left unplaced)', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 200, title: 'Board' }));
      router.on('GET', '/projects/200/views', () => [
        { id: 21, title: 'Kanban', project_id: 200, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/200/views/21/buckets', () => []);
      router.on('PUT', '/projects/200/views/21/buckets', (_p, body) => ({
        id: 950,
        ...(body as Record<string, unknown>),
      }));

      // Existing label "urgent" is reused via ensureLabelByTitle's exact-match path.
      router.on('GET', /^\/labels\?s=/, () => [{ id: 77, title: 'urgent' }]);

      const createdTasks = new Map<number, Record<string, unknown>>();
      router.on('PUT', '/projects/200/tasks', (_p, body) => {
        const task = { id: 6001, project_id: 200, ...(body as Record<string, unknown>) };
        createdTasks.set(6001, task);
        return task;
      });
      router.on('POST', '/tasks/6001/labels/bulk', () => null);
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));

      const result = await setupKanban(
        {
          title: 'Board',
          columns: ['To Do'],
          tasks: [{ title: 'Labeled, unplaced task', labels: ['urgent'] }],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup completed');
      expect(text).toContain('1/1 tasks created');

      // Label was resolved (reused, not created) and attached.
      const labelSearch = router.calls.find((c) => c.method === 'GET' && /^\/labels\?s=/.test(c.path));
      expect(labelSearch).toBeDefined();
      const labelAttach = router.calls.find((c) => c.method === 'POST' && c.path === '/tasks/6001/labels/bulk');
      expect(labelAttach).toBeDefined();
      expect((labelAttach?.body as { labels: Array<{ id: number }> }).labels).toEqual([{ id: 77 }]);

      // No column requested -> no move call, and the task result is 'created' (not 'placed').
      expect(text).toContain('"status": "created"');
      const moveCalls = router.calls.filter((c) => /\/buckets\/\d+\/tasks$/.test(c.path));
      expect(moveCalls).toHaveLength(0);
    });
  });

  describe('bucket move failure', () => {
    it('reports created-not-placed when the bucket move request itself fails', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 210, title: 'Board' }));
      router.on('GET', '/projects/210/views', () => [
        { id: 22, title: 'Kanban', project_id: 210, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/210/views/22/buckets', () => []);
      router.on('PUT', '/projects/210/views/22/buckets', (_p, body) => ({
        id: 960,
        ...(body as Record<string, unknown>),
      }));

      const createdTasks = new Map<number, Record<string, unknown>>();
      router.on('PUT', '/projects/210/tasks', (_p, body) => {
        const task = { id: 7001, project_id: 210, ...(body as Record<string, unknown>) };
        createdTasks.set(7001, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));
      router.on('POST', /^\/projects\/210\/views\/22\/buckets\/\d+\/tasks$/, () =>
        // 400, not 500 — avoids retry-driven wall-clock delay in this test.
        jsonResponse('bad request', { ok: false, status: 400, statusText: 'Bad Request' }),
      );

      const result = await setupKanban(
        {
          title: 'Board',
          columns: ['To Do'],
          tasks: [{ title: 'Stuck task', column: 'To Do' }],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup partially completed');
      expect(text).toContain('Created but not placed');
      expect(text).toContain('Stuck task');
    });
  });

  describe('partial column failure (not all columns fail)', () => {
    it('reports failed columns in the message and metadata while successful columns still resolve', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 220, title: 'Board' }));
      router.on('GET', '/projects/220/views', () => [
        { id: 23, title: 'Kanban', project_id: 220, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/220/views/23/buckets', () => []);

      let call = 0;
      router.on('PUT', '/projects/220/views/23/buckets', (_p, body) => {
        call += 1;
        const b = body as { title: string; position?: number };
        if (b.title === 'Doing') {
          // 400, not 500 — see the comment in the "column requested but its
          // bucket failed to resolve" test on why a retried 5xx here risks
          // spuriously tripping the shared bucket-domain circuit breaker.
          return jsonResponse('bad request', { ok: false, status: 400, statusText: 'Bad Request' });
        }
        return { id: 970 + call, title: b.title, position: b.position };
      });

      const result = await setupKanban(
        { title: 'Board', columns: ['To Do', 'Doing', 'Done'] },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup partially completed');
      expect(text).toContain('2/3 columns ready');
      expect(text).toContain('Failed columns');
      expect(text).toContain('"Doing"');
      expect(text).toContain('**Failures**');
    });
  });

  describe('server returns no numeric id', () => {
    it('throws when project creation returns no numeric id', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;
      router.on('PUT', '/projects', () => ({ title: 'Board' }));

      await expect(
        setupKanban({ title: 'Board', columns: ['To Do'] }, authManager),
      ).rejects.toThrow('was created but returned no numeric id');
    });

    it('reports a failed column when bucket creation returns no numeric id', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 230, title: 'Board' }));
      router.on('GET', '/projects/230/views', () => [
        { id: 24, title: 'Kanban', project_id: 230, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/230/views/24/buckets', () => []);
      router.on('PUT', '/projects/230/views/24/buckets', (_p, body) => ({
        title: (body as { title: string }).title,
      }));

      let caught: unknown;
      try {
        await setupKanban({ title: 'Board', columns: ['To Do'] }, authManager);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(MCPError);
      expect((caught as MCPError).message).toMatch(/Kanban setup failed/);
    });

    it('reports a failed task when task creation returns no numeric id', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 240, title: 'Board' }));
      router.on('GET', '/projects/240/views', () => [
        { id: 25, title: 'Kanban', project_id: 240, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/240/views/25/buckets', () => []);
      router.on('PUT', '/projects/240/views/25/buckets', (_p, body) => ({
        id: 980,
        ...(body as Record<string, unknown>),
      }));
      router.on('PUT', '/projects/240/tasks', (_p, body) => ({ ...(body as Record<string, unknown>) }));

      const result = await setupKanban(
        { title: 'Board', columns: ['To Do'], tasks: [{ title: 'No id task' }] },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Kanban setup partially completed');
      expect(text).toContain('Failed tasks');
      expect(text).toContain('No id task');
    });
  });

  describe('column requested but its bucket failed to resolve', () => {
    it('reports a distinct reason when a task names a column that WAS requested but failed', async () => {
      const router = createRouter();
      global.fetch = router.fetchImpl as unknown as typeof fetch;

      router.on('PUT', '/projects', () => ({ id: 250, title: 'Board' }));
      router.on('GET', '/projects/250/views', () => [
        { id: 26, title: 'Kanban', project_id: 250, view_kind: 'kanban' },
      ]);
      router.on('GET', '/projects/250/views/26/buckets', () => []);
      // A second column so the "all columns failed" hard-throw doesn't fire.
      let bucketCounter = 990;
      router.on('PUT', '/projects/250/views/26/buckets', (_p, body) => {
        const b = body as { title: string };
        if (b.title === 'To Do') {
          // 400 (not 500/429) so `defaultRestShouldRetry` does NOT retry this
          // failure — the bucket-domain circuit breaker is shared across
          // GET views/GET buckets/PUT create/POST update (see
          // `deriveRestBreakerName`'s "first two non-numeric segments"
          // grouping), so a retried 5xx here would inflate this breaker's
          // failure count enough to spuriously trip it for the OTHER
          // (successful) column's request later in this same test.
          return jsonResponse('bad request', { ok: false, status: 400, statusText: 'Bad Request' });
        }
        bucketCounter += 1;
        return { id: bucketCounter, ...(body as Record<string, unknown>) };
      });

      const createdTasks = new Map<number, Record<string, unknown>>();
      router.on('PUT', '/projects/250/tasks', (_p, body) => {
        const task = { id: 8001, project_id: 250, ...(body as Record<string, unknown>) };
        createdTasks.set(8001, task);
        return task;
      });
      router.on('GET', /^\/tasks\/\d+$/, (path) => createdTasks.get(Number(path.split('/')[2])));

      const result = await setupKanban(
        {
          title: 'Board',
          columns: ['To Do', 'Done'],
          tasks: [{ title: 'Targets failed column', column: 'To Do' }],
        },
        authManager,
      );

      const text = result.content[0]?.text ?? '';
      expect(text).toContain('was requested but its bucket could not be resolved');
    });
  });
});
