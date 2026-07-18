/**
 * Regression test: add-reminder must send an absolute reminder under the
 * `reminder` key. The TaskReminder type calls it `reminder_date`, but the
 * server expects `reminder` and otherwise stores a zero (0001-01-01) reminder.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { addReminder } from '../src/tools/tasks/reminders';
import { AuthManager } from '../src/auth/AuthManager';
import { circuitBreakerRegistry } from '../src/utils/retry';

jest.mock('../src/utils/logger');

describe('add-reminder persists the `reminder` API field', () => {
  const TASK_ID = 4242;
  const NEW_DATE = '2028-02-28T08:00:00Z';

  // addReminder now fetches/updates the task via the direct-REST helper
  // (src/utils/task-rest-transport.ts) rather than node-vikunja's
  // getTask/updateTask, so these tests drive a mocked global fetch and a
  // real AuthManager session.
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

  beforeEach(() => {
    jest.clearAllMocks();
    circuitBreakerRegistry.clear();

    authManager = new AuthManager();
    authManager.connect('https://vikunja.test', 'tk_test-token');

    originalFetch = globalThis.fetch;
    fetchMock = jest.fn((url: string) => {
      if (url.endsWith(`/tasks/${TASK_ID}`)) {
        return Promise.resolve(restOk({ id: TASK_ID, title: 't', reminders: [] }));
      }
      return Promise.resolve(restOk({ id: TASK_ID }));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the new reminder under `reminder`, never `reminder_date`', async () => {
    await addReminder({ id: TASK_ID, reminderDate: NEW_DATE }, authManager);

    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse((postCalls[0]?.[1] as RequestInit).body as string) as {
      reminders: Array<Record<string, unknown>>;
    };
    expect(body.reminders).toEqual([{ reminder: NEW_DATE }]);
    expect(JSON.stringify(body.reminders)).not.toContain('reminder_date');
  });

  it('preserves existing reminders read from the `reminder` field', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith(`/tasks/${TASK_ID}`)) {
        return Promise.resolve(
          restOk({
            id: TASK_ID,
            title: 't',
            reminders: [{ reminder: '2027-01-01T00:00:00Z' }],
          }),
        );
      }
      return Promise.resolve(restOk({ id: TASK_ID }));
    });

    await addReminder({ id: TASK_ID, reminderDate: NEW_DATE }, authManager);

    const postCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    const body = JSON.parse((postCalls[0]?.[1] as RequestInit).body as string) as {
      reminders: Array<Record<string, unknown>>;
    };
    expect(body.reminders).toEqual([
      { reminder: '2027-01-01T00:00:00Z' },
      { reminder: NEW_DATE },
    ]);
  });
});
