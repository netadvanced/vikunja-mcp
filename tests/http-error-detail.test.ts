/**
 * Tests for `src/utils/http-error-detail.ts` and the integration with
 * `updateTaskLabels` in `TaskUpdateService`.
 *
 * Verifies that a label-update failure surfaces the real HTTP status + body
 * of the underlying Vikunja error instead of being replaced with the
 * generic LABEL_UPDATE "known limitation" message.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { extractHttpErrorDetail, extractHttpStatus } from '../src/utils/http-error-detail';
import { updateTask } from '../src/tools/tasks/crud/TaskUpdateService';
import { getClientFromContext } from '../src/client';
import { isAuthenticationError } from '../src/utils/auth-error-handler';
import { MCPError } from '../src/types';

jest.mock('../src/client');
jest.mock('../src/utils/auth-error-handler');
jest.mock('../src/utils/logger');

describe('extractHttpStatus', () => {
  it('reads `.status` when present', () => {
    const err = Object.assign(new Error('boom'), { status: 403 });
    expect(extractHttpStatus(err)).toBe(403);
  });

  it('reads `.statusCode` as a fallback', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 422 });
    expect(extractHttpStatus(err)).toBe(422);
  });

  it('reads `.response.status` (axios-style)', () => {
    const err = Object.assign(new Error('boom'), { response: { status: 401 } });
    expect(extractHttpStatus(err)).toBe(401);
  });

  it('returns null when no HTTP signal is available', () => {
    expect(extractHttpStatus(new Error('plain'))).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(extractHttpStatus('nope')).toBeNull();
    expect(extractHttpStatus(undefined)).toBeNull();
  });
});

describe('extractHttpErrorDetail', () => {
  it('includes status and JSON-stringified response.data', () => {
    const err = Object.assign(new Error('Request failed'), {
      status: 403,
      response: { status: 403, data: { code: 1004, message: 'forbidden' } },
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail).toContain('HTTP 403');
    expect(detail).toContain('forbidden');
    expect(detail).toMatch(/^\(HTTP 403:/);
  });

  it('falls back to error message when no body is present', () => {
    const err = Object.assign(new Error('Request failed with status code 422'), {
      status: 422,
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail).toContain('HTTP 422');
    expect(detail).toContain('Request failed with status code 422');
  });

  it('truncates very long bodies', () => {
    const longBody = 'x'.repeat(2000);
    const err = Object.assign(new Error('boom'), {
      status: 500,
      response: { status: 500, data: longBody },
    });
    const detail = extractHttpErrorDetail(err);
    expect(detail.length).toBeLessThan(500);
    expect(detail).toContain('HTTP 500');
    expect(detail.endsWith('…)')).toBe(true);
  });

  it('returns empty string when no status can be inferred', () => {
    expect(extractHttpErrorDetail(new Error('plain'))).toBe('');
    expect(extractHttpErrorDetail('nope')).toBe('');
  });
});

describe('updateTaskLabels surfaces real HTTP status', () => {
  const TASK_ID = 4242;
  const baseTask = {
    id: TASK_ID,
    title: 'pinned task',
    description: 'existing description',
    project_id: 7,
    priority: 2,
    done: false,
    due_date: '0001-01-01T00:00:00Z',
    labels: [],
    assignees: [],
  } as Record<string, unknown>;

  const mockClient = {
    tasks: {
      getTask: jest.fn(),
      updateTask: jest.fn(),
      updateTaskLabels: jest.fn(),
      bulkAssignUsersToTask: jest.fn(),
      removeUserFromTask: jest.fn(),
    },
  } as Record<string, Record<string, jest.Mock>>;

  beforeEach(() => {
    jest.clearAllMocks();
    (getClientFromContext as jest.Mock).mockResolvedValue(mockClient);
    mockClient.tasks.getTask.mockResolvedValue({ ...baseTask });
    mockClient.tasks.updateTask.mockResolvedValue({ ...baseTask });
  });

  it('propagates HTTP 403 status + body for an auth-classified label failure', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(true);
    const vikunjaError = Object.assign(new Error('Forbidden'), {
      status: 403,
      response: { status: 403, data: { code: 7003, message: 'You do not have access' } },
    });
    mockClient.tasks.updateTaskLabels.mockRejectedValueOnce(vikunjaError);

    let captured: MCPError | null = null;
    try {
      await updateTask({ id: TASK_ID, labels: [5] });
    } catch (err) {
      captured = err instanceof MCPError ? err : null;
    }
    expect(captured).not.toBeNull();
    expect(captured!.message).toContain('HTTP 403');
    expect(captured!.message).toContain('You do not have access');
  });

  it('propagates HTTP 422 status + body for a non-auth label failure', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    const vikunjaError = Object.assign(new Error('Unprocessable Entity'), {
      status: 422,
      response: { status: 422, data: { code: 4001, message: 'Invalid label id' } },
    });
    mockClient.tasks.updateTaskLabels.mockRejectedValueOnce(vikunjaError);

    let capturedMessage = '';
    try {
      await updateTask({ id: TASK_ID, labels: [99999] });
    } catch (err) {
      capturedMessage = err instanceof MCPError ? err.message : String(err);
    }
    expect(capturedMessage).toContain('Failed to update task labels');
    expect(capturedMessage).toContain('HTTP 422');
    expect(capturedMessage).toContain('Invalid label id');
    expect(capturedMessage).not.toMatch(/^Label operations may have authentication issues/);
  });

  it('preserves the original error when no HTTP status can be inferred', async () => {
    (isAuthenticationError as jest.Mock).mockReturnValue(false);
    const opaqueError = new Error('network blip');
    mockClient.tasks.updateTaskLabels.mockRejectedValueOnce(opaqueError);

    let capturedMessage = '';
    try {
      await updateTask({ id: TASK_ID, labels: [5] });
    } catch (err) {
      capturedMessage = err instanceof Error ? err.message : String(err);
    }
    expect(capturedMessage).toContain('network blip');
  });
});
