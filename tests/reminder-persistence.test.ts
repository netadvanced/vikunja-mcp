/**
 * Regression test: add-reminder must send an absolute reminder under the
 * `reminder` key. The TaskReminder type calls it `reminder_date`, but the
 * server expects `reminder` and otherwise stores a zero (0001-01-01) reminder.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { addReminder } from '../src/tools/tasks/reminders';
import { getClientFromContext } from '../src/client';

jest.mock('../src/client');
jest.mock('../src/utils/logger');

describe('add-reminder persists the `reminder` API field', () => {
  const TASK_ID = 4242;
  const NEW_DATE = '2028-02-28T08:00:00Z';
  const mockClient = {
    tasks: {
      getTask: jest.fn(),
      updateTask: jest.fn(),
    },
  } as Record<string, Record<string, jest.Mock>>;

  beforeEach(() => {
    jest.clearAllMocks();
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    mockClient.tasks.getTask.mockResolvedValue({ id: TASK_ID, title: 't', reminders: [] });
    mockClient.tasks.updateTask.mockResolvedValue({ id: TASK_ID });
  });

  it('sends the new reminder under `reminder`, never `reminder_date`', async () => {
    await addReminder({ id: TASK_ID, reminderDate: NEW_DATE });

    expect(mockClient.tasks.updateTask).toHaveBeenCalledTimes(1);
    const body = mockClient.tasks.updateTask.mock.calls[0][1] as {
      reminders: Array<Record<string, unknown>>;
    };
    expect(body.reminders).toEqual([{ reminder: NEW_DATE }]);
    expect(JSON.stringify(body.reminders)).not.toContain('reminder_date');
  });

  it('preserves existing reminders read from the `reminder` field', async () => {
    mockClient.tasks.getTask.mockResolvedValue({
      id: TASK_ID,
      title: 't',
      reminders: [{ reminder: '2027-01-01T00:00:00Z' }],
    });

    await addReminder({ id: TASK_ID, reminderDate: NEW_DATE });

    const body = mockClient.tasks.updateTask.mock.calls[0][1] as {
      reminders: Array<Record<string, unknown>>;
    };
    expect(body.reminders).toEqual([
      { reminder: '2027-01-01T00:00:00Z' },
      { reminder: NEW_DATE },
    ]);
  });
});
