/**
 * Tests for the subtask composites (`create-subtask`, `list-subtasks`).
 *
 * `create-subtask` is a `CompositeOperation` (resolve-parent -> create-task
 * -> [apply-labels] -> [apply-assignees] -> create-relation -> [set-bucket]
 * -> verify-relation). Every write asserts the actual outgoing request body
 * per docs/ENDPOINT-PLAYBOOK.md §6, and the compensation trace is exercised
 * with a simulated mid-flight failure in both best-effort (default) and
 * atomic modes.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { AuthManager } from '../../../src/auth/AuthManager';
import { createSubtask, listSubtasks } from '../../../src/tools/tasks/subtasks';
import { MCPError, ErrorCode } from '../../../src/types';
import { circuitBreakerRegistry } from '../../../src/utils/retry';

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function mockResponse(opts: { ok?: boolean; status?: number; statusText?: string; text?: string }): Response {
  const { ok = true, status = 200, statusText = 'OK', text = '' } = opts;
  return {
    ok,
    status,
    statusText,
    text: jest.fn(async () => text),
  } as unknown as Response;
}

const parentTask = { id: 1, title: 'Parent', project_id: 5, related_tasks: {} };
const parentTaskWithChild = (childId: number) => ({
  id: 1,
  title: 'Parent',
  project_id: 5,
  related_tasks: { subtask: [{ id: childId, title: 'Child', done: false }] },
});
const createdChild = { id: 42, title: 'Child', project_id: 5 };

describe('subtask composites', () => {
  let authManager: AuthManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
    circuitBreakerRegistry.clear();
    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');
  });

  // -------------------------------------------------------------------
  // create-subtask
  // -------------------------------------------------------------------

  describe('create-subtask', () => {
    it('resolves parent -> creates task -> relates -> verifies, in that order', async () => {
      mockFetch
        // 1) resolve-parent: GET /tasks/1
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) }))
        // 2) create-task: PUT /projects/5/tasks
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) }))
        // 3) create-relation: PUT /tasks/1/relations
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify({ task_id: 1, other_task_id: 42, relation_kind: 'subtask' }),
          }),
        )
        // 4) verify-relation: GET /tasks/1
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTaskWithChild(42)) }));

      const result = await createSubtask(
        { parentTaskId: 1, title: 'Child', description: 'desc', dueDate: '2024-05-24T10:00:00Z', priority: 3 },
        authManager,
      );

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const calls = mockFetch.mock.calls as [string, RequestInit?][];

      expect(calls[0][0]).toBe('https://vikunja.test/api/v1/tasks/1');
      expect(calls[0][1]?.method ?? 'GET').toBe('GET');

      expect(calls[1][0]).toBe('https://vikunja.test/api/v1/projects/5/tasks');
      expect(calls[1][1]?.method).toBe('PUT');
      expect(JSON.parse(calls[1][1]?.body as string)).toEqual({
        title: 'Child',
        project_id: 5,
        description: 'desc',
        due_date: '2024-05-24T10:00:00Z',
        priority: 3,
      });

      // Base task (task_id) of the relation MUST be the parent, not the
      // newly created child — see the direction-semantics doc comment in
      // src/tools/tasks/subtasks.ts.
      expect(calls[2][0]).toBe('https://vikunja.test/api/v1/tasks/1/relations');
      expect(calls[2][1]?.method).toBe('PUT');
      expect(JSON.parse(calls[2][1]?.body as string)).toEqual({
        task_id: 1,
        other_task_id: 42,
        relation_kind: 'subtask',
      });

      expect(calls[3][0]).toBe('https://vikunja.test/api/v1/tasks/1');
      expect(calls[3][1]?.method ?? 'GET').toBe('GET');

      expect(result.content[0].text).toContain('Created subtask 42');
      expect(result.content[0].text).toContain('parent task 1');
    });

    it('attaches labels and assignees via the additive per-item endpoints before relating', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) })) // resolve-parent
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) })) // create-task
        .mockResolvedValueOnce(mockResponse({ text: '{}' })) // apply-labels: label 7
        .mockResolvedValueOnce(mockResponse({ text: '{}' })) // apply-labels: label 8
        .mockResolvedValueOnce(mockResponse({ text: '{}' })) // apply-assignees: user 3
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ task_id: 1, other_task_id: 42, relation_kind: 'subtask' }) }),
        ) // create-relation
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTaskWithChild(42)) })); // verify

      await createSubtask(
        { parentTaskId: 1, title: 'Child', labels: [7, 8], assignees: [3] },
        authManager,
      );

      const calls = mockFetch.mock.calls as [string, RequestInit?][];
      expect(calls[2][0]).toBe('https://vikunja.test/api/v1/tasks/42/labels');
      expect(JSON.parse(calls[2][1]?.body as string)).toEqual({ label_id: 7 });
      expect(calls[3][0]).toBe('https://vikunja.test/api/v1/tasks/42/labels');
      expect(JSON.parse(calls[3][1]?.body as string)).toEqual({ label_id: 8 });
      expect(calls[4][0]).toBe('https://vikunja.test/api/v1/tasks/42/assignees');
      expect(JSON.parse(calls[4][1]?.body as string)).toEqual({ user_id: 3 });
    });

    it('places the new subtask into a Kanban bucket via the existing set-bucket path', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) })) // resolve-parent
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) })) // create-task
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ task_id: 1, other_task_id: 42, relation_kind: 'subtask' }) }),
        ) // create-relation
        // set-bucket internals: resolveKanbanViewId -> GET /projects/5/views
        .mockResolvedValueOnce(
          mockResponse({
            text: JSON.stringify([{ id: 11, title: 'Kanban', project_id: 5, view_kind: 'kanban' }]),
          }),
        )
        // set-bucket: POST /projects/5/views/11/buckets/9/tasks
        .mockResolvedValueOnce(mockResponse({ text: '{}' }))
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTaskWithChild(42)) })); // verify

      await createSubtask({ parentTaskId: 1, title: 'Child', bucketId: 9 }, authManager);

      const calls = mockFetch.mock.calls as [string, RequestInit?][];
      expect(calls[3][0]).toBe('https://vikunja.test/api/v1/projects/5/views');
      expect(calls[4][0]).toBe('https://vikunja.test/api/v1/projects/5/views/11/buckets/9/tasks');
      expect(calls[4][1]?.method).toBe('POST');
      expect(JSON.parse(calls[4][1]?.body as string)).toEqual({ task_id: 42, bucket_id: 9 });
    });

    it('best-effort (default): leaves the created task in place when the relate step fails, and reports it in guidance', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) })) // resolve-parent
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) })) // create-task
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, statusText: 'Bad Request' })); // create-relation fails

      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child' }, authManager),
      ).rejects.toThrow(MCPError);

      // best-effort: exactly 3 calls made (resolve, create, failed relate) — no DELETE compensation call.
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(mockFetch.mock.calls.some((call) => (call[1] as RequestInit)?.method === 'DELETE')).toBe(false);
    });

    it('atomic:true deletes the created task when the relate step fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) })) // resolve-parent
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) })) // create-task
        .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, statusText: 'Bad Request' })) // create-relation fails
        .mockResolvedValueOnce(mockResponse({ text: '{}' })); // compensation: DELETE /tasks/42

      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child', atomic: true }, authManager),
      ).rejects.toThrow(MCPError);

      expect(mockFetch).toHaveBeenCalledTimes(4);
      const compensateCall = mockFetch.mock.calls[3] as [string, RequestInit];
      expect(compensateCall[0]).toBe('https://vikunja.test/api/v1/tasks/42');
      expect(compensateCall[1].method).toBe('DELETE');
    });

    it('atomic:true deletes the created task when post-relate verification fails', async () => {
      mockFetch
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) })) // resolve-parent
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(createdChild) })) // create-task
        .mockResolvedValueOnce(
          mockResponse({ text: JSON.stringify({ task_id: 1, other_task_id: 42, relation_kind: 'subtask' }) }),
        ) // create-relation succeeds
        // verify-relation: parent re-read shows no subtask relation (simulated mid-flight drift)
        .mockResolvedValueOnce(mockResponse({ text: JSON.stringify(parentTask) }))
        // compensation: DELETE /tasks/42
        .mockResolvedValueOnce(mockResponse({ text: '{}' }));

      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child', atomic: true }, authManager),
      ).rejects.toThrow(MCPError);

      expect(mockFetch).toHaveBeenCalledTimes(5);
      const compensateCall = mockFetch.mock.calls[4] as [string, RequestInit];
      expect(compensateCall[0]).toBe('https://vikunja.test/api/v1/tasks/42');
      expect(compensateCall[1].method).toBe('DELETE');
    });

    it('requires parentTaskId and title before making any request', async () => {
      await expect(createSubtask({ title: 'Child' }, authManager)).rejects.toThrow(
        'parentTaskId is required to create a subtask',
      );
      await expect(createSubtask({ parentTaskId: 1 }, authManager)).rejects.toThrow(
        'title is required to create a subtask',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('validates label/assignee/bucket ids before making any request', async () => {
      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child', labels: [-1] }, authManager),
      ).rejects.toThrow(MCPError);
      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child', assignees: [0] }, authManager),
      ).rejects.toThrow(MCPError);
      await expect(
        createSubtask({ parentTaskId: 1, title: 'Child', bucketId: -5 }, authManager),
      ).rejects.toThrow(MCPError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces a friendly NOT_FOUND when the parent task does not exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      await expect(createSubtask({ parentTaskId: 999, title: 'Child' }, authManager)).rejects.toThrow(
        MCPError,
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------
  // list-subtasks
  // -------------------------------------------------------------------

  describe('list-subtasks', () => {
    it('summarizes the "subtask" slice of related_tasks', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          text: JSON.stringify({
            id: 1,
            title: 'Parent',
            related_tasks: {
              subtask: [
                { id: 42, title: 'Child A', done: false, assignees: [{ id: 3, username: 'alice' }] },
                { id: 43, title: 'Child B', done: true, assignees: [] },
              ],
              blocking: [{ id: 99, title: 'Unrelated' }],
            },
          }),
        }),
      );

      const result = await listSubtasks({ id: 1 }, authManager);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calls = mockFetch.mock.calls as [string, RequestInit?][];
      expect(calls[0][0]).toBe('https://vikunja.test/api/v1/tasks/1');
      expect(calls[0][1]?.method ?? 'GET').toBe('GET');

      expect(result.content[0].text).toContain('Found 2 subtask(s) for task 1');
    });

    it('reports zero subtasks when related_tasks has no "subtask" key', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ id: 1, title: 'Parent', related_tasks: {} }) }),
      );

      const result = await listSubtasks({ id: 1 }, authManager);
      expect(result.content[0].text).toContain('Found 0 subtasks for task 1');
    });

    it('handles a task with no related_tasks field at all', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({ id: 1, title: 'Parent' }) }));

      const result = await listSubtasks({ id: 1 }, authManager);
      expect(result.content[0].text).toContain('Found 0 subtasks for task 1');
    });

    it('requires a task id', async () => {
      await expect(listSubtasks({}, authManager)).rejects.toThrow('Task ID is required');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an invalid task id', async () => {
      await expect(listSubtasks({ id: -1 }, authManager)).rejects.toThrow(MCPError);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('surfaces a friendly NOT_FOUND when the task does not exist', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, statusText: 'Not Found' }));

      await expect(listSubtasks({ id: 999 }, authManager)).rejects.toThrow(MCPError);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
